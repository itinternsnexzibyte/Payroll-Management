/**
 * Email notifications for payroll events. Emails never contain salary amounts; they say what is
 * waiting and link to the application. Sending happens after the database change has committed;
 * a failure is logged and never undoes or blocks the payroll action.
 */
import { createLogger } from '@nexzi/server-core';
import { prisma } from './db';
import { mailer } from './mail';
import { config } from './config';
import { getSettings } from './settings';
import { periodLabel } from './payroll/service';

const log = createLogger('payroll-api-notify', config.LOG_LEVEL);
const APP = 'Payroll Management';
const appUrl = () => config.ALLOWED_ORIGINS[0] ?? '';

function html(heading: string, body: string, linkPath?: string) {
  const link = linkPath && appUrl() ? `<p style="margin:20px 0 0"><a href="${appUrl()}${linkPath}" style="background:#1e40af;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open ${APP}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0d1b45;color:#fff;padding:18px 24px;font-size:16px;font-weight:bold">${APP}</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 12px;font-size:18px;color:#1e40af">${heading}</h1><p style="margin:0;line-height:1.5">${body}</p>${link}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Active users whose role grants a permission (and is enabled). */
async function recipientsWith(permission: string) {
  return prisma.user.findMany({
    where: { status: 'ACTIVE', role: { enabled: true, permissions: { some: { permissionCode: permission } } } },
    select: { email: true, name: true },
  });
}

async function sendAll(to: { email: string }[], subject: string, text: string, body: string, linkPath?: string) {
  let sent = 0;
  for (const r of to) {
    try {
      await mailer.send({ to: r.email, subject: `${APP}: ${subject}`, text: `${text}${linkPath && appUrl() ? `\n\n${appUrl()}${linkPath}` : ''}`, html: html(subject, body, linkPath) });
      sent++;
    } catch (err) {
      log.error({ subject, err: (err as Error).message }, 'Notification email failed');
    }
  }
  return sent;
}

type RunEvent = 'SUBMITTED' | 'APPROVED' | 'PAYSLIPS';

/** Notifies the right people about a payroll run event. Never throws. */
export async function notifyRun(runId: string, event: RunEvent): Promise<number> {
  try {
    const settings = (await getSettings()).emailNotifications;
    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) return 0;
    const period = periodLabel(run.year, run.month);
    if (event === 'SUBMITTED' && settings.reviewRequests) {
      const subject = `${period} payroll is waiting for approval`;
      return sendAll(await recipientsWith('payroll.approve'), subject, `${period} payroll has been submitted for review and is waiting for your approval.`, `${period} payroll has been submitted for review and is waiting for your approval.`, `/payroll/${runId}`);
    }
    if (event === 'APPROVED' && settings.readyToFinalise) {
      const subject = `${period} payroll is approved and ready to finalise`;
      return sendAll(await recipientsWith('payroll.finalise'), subject, `${period} payroll has been approved and can now be finalised.`, `${period} payroll has been approved and can now be finalised.`, `/payroll/${runId}`);
    }
    if (event === 'PAYSLIPS' && settings.payslipsAvailable) {
      // Employees with a linked self-service account and a payslip in this run.
      const users = await prisma.user.findMany({
        where: { status: 'ACTIVE', employeeId: { not: null }, role: { enabled: true, permissions: { some: { permissionCode: 'self.service' } } }, employee: { payslips: { some: { payrollRunId: runId, supersededAt: null } } } },
        select: { email: true },
      });
      const subject = `Your payslip for ${period} is available`;
      return sendAll(users, subject, `Your payslip for ${period} is available. Sign in to view or download it.`, `Your payslip for ${period} is available. Sign in to view or download it.`, '/my');
    }
    return 0;
  } catch (err) {
    log.error({ runId, event, err: (err as Error).message }, 'Notification failed');
    return 0;
  }
}

/** Tells an employee (if they have a linked account) that their leave request was decided. */
export async function notifyLeaveDecision(requestId: string): Promise<number> {
  try {
    if (!(await getSettings()).emailNotifications.leaveDecisions) return 0;
    const r = await prisma.leaveRequest.findUnique({ where: { id: requestId }, include: { leaveType: true, employee: { include: { user: true } } } });
    const u = r?.employee.user;
    if (!r || !u || u.status !== 'ACTIVE') return 0;
    const when = `${r.startDate.toISOString().slice(0, 10)} to ${r.endDate.toISOString().slice(0, 10)}`;
    const subject = `Your ${r.leaveType.name.toLowerCase()} request was ${r.status === 'APPROVED' ? 'approved' : 'rejected'}`;
    return sendAll([u], subject, `Your ${r.leaveType.name} request for ${when} was ${r.status.toLowerCase()}.`, `Your ${r.leaveType.name} request for ${when} was ${r.status.toLowerCase()}.`, '/my/leave');
  } catch (err) {
    log.error({ requestId, err: (err as Error).message }, 'Leave notification failed');
    return 0;
  }
}

