/**
 * Continuous payroll readiness monitor: validates attendance, employee details, salary structures,
 * bank information, statutory configuration and pending approvals throughout the pay period, so
 * missing data is found before the processing deadline rather than on payroll day. Read-only.
 */
import { z } from 'zod';
import { dec, type ApiRegistry } from '@nexzi/server-core';
import { prisma } from '../db';
import { getSettings } from '../settings';
import { isEligible, selectSalaryVersion } from '../payroll/engine';
import { periodLabel } from '../payroll/service';
import { statutoryProblems } from '../statutory/rules';
import { templateProblems } from '../modules/salary-template';

type Status = 'PASS' | 'WARN' | 'FAIL' | 'INFO';
interface Check {
  id: string;
  area: 'Employees' | 'Salary' | 'Bank' | 'Attendance' | 'Approvals' | 'Statutory' | 'Payroll run';
  title: string;
  status: Status;
  detail: string;
  count: number;
  items: { label: string; href?: string }[];
  href?: string;
}

/** The month that needs payroll next: after the latest finalised month, else the current month. */
async function nextPeriod() {
  const latest = await prisma.payrollRun.findFirst({ where: { status: 'FINALISED' }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  const now = new Date();
  if (!latest) return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  const open = await prisma.payrollRun.findFirst({ where: { status: { not: 'FINALISED' } }, orderBy: [{ year: 'asc' }, { month: 'asc' }] });
  if (open) return { year: open.year, month: open.month };
  return latest.month === 12 ? { year: latest.year + 1, month: 1 } : { year: latest.year, month: latest.month + 1 };
}

export async function readiness(year: number, month: number) {
  const settings = await getSettings();
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const [employees, components, run, attendance, leave, bonuses] = await Promise.all([
    prisma.employee.findMany({ include: { salaryVersions: true, bankAccount: true }, orderBy: { employeeCode: 'asc' } }),
    prisma.salaryComponent.findMany(),
    prisma.payrollRun.findUnique({ where: { year_month: { year, month } }, include: { employees: true, checklist: true, anomalies: { where: { status: 'OPEN' } } } }),
    prisma.attendanceRecord.groupBy({ by: ['employeeId'], where: { attendanceDate: { gte: monthStart, lte: monthEnd } }, _count: { _all: true } }),
    prisma.leaveRequest.findMany({ where: { status: 'REQUESTED', startDate: { lte: monthEnd }, endDate: { gte: monthStart } }, include: { employee: { select: { employeeCode: true, fullName: true } } } }),
    prisma.bonusEntry.findMany({ where: { year, month, status: 'PROPOSED' }, include: { employee: { select: { employeeCode: true, fullName: true } } } }),
  ]);
  const eligible = employees.filter((e) => isEligible(e, year, month));
  const label = (e: { employeeCode: string; fullName: string }) => `${e.employeeCode} · ${e.fullName}`;
  const empLink = (e: { id: string; employeeCode: string; fullName: string }) => ({ label: label(e), href: `/employees/${e.id}` });
  const checks: Check[] = [];
  const add = (c: Omit<Check, 'count' | 'items'> & { items?: Check['items'] }) => checks.push({ ...c, items: (c.items ?? []).slice(0, 50), count: c.items?.length ?? 0 });

  // Employees and salary
  const noVersion = eligible.filter((e) => !selectSalaryVersion(e.salaryVersions, year, month, settings.salaryVersionRule));
  add({ id: 'salary-structure', area: 'Salary', title: 'Every employee has a salary structure for the month', status: noVersion.length ? 'FAIL' : 'PASS', detail: noVersion.length ? `${noVersion.length} employee(s) cannot be paid: no salary version is effective.` : `${eligible.length} employee(s) covered.`, items: noVersion.map(empLink) });
  const manual = eligible.filter((e) => {
    const v = selectSalaryVersion(e.salaryVersions, year, month, settings.salaryVersionRule);
    return v && !v.monthlyGross;
  });
  add({ id: 'salary-automatic', area: 'Salary', title: 'Salary structures are generated from the template', status: manual.length ? 'WARN' : 'PASS', detail: manual.length ? `${manual.length} structure(s) were entered by hand. Regenerate them from a monthly gross so they follow the template.` : 'All structures come from the salary structure template.', items: manual.map(empLink), href: '/salary-components' });
  const tProblems = templateProblems(settings.salaryTemplate, components);
  add({ id: 'salary-template', area: 'Salary', title: 'Salary structure template is valid', status: tProblems.length ? 'WARN' : 'PASS', detail: tProblems[0] ?? 'Template lines match the configured components.', items: tProblems.map((p) => ({ label: p })), href: '/settings' });
  const joiners = eligible.filter((e) => e.joiningDate >= monthStart && e.joiningDate <= monthEnd);
  const leavers = eligible.filter((e) => e.exitDate && e.exitDate >= monthStart && e.exitDate <= monthEnd);
  add({ id: 'joiners-leavers', area: 'Employees', title: 'Joiners and leavers this month', status: 'INFO', detail: `${joiners.length} joining, ${leavers.length} leaving — their pay is pro-rated${settings.proration.enabled ? '' : ' only if proration is switched on'}.`, items: [...joiners, ...leavers].map(empLink) });

  // Identity and bank
  const noBank = eligible.filter((e) => !e.bankAccount);
  add({ id: 'bank-details', area: 'Bank', title: 'Bank details recorded for everyone to be paid', status: noBank.length ? 'FAIL' : 'PASS', detail: noBank.length ? `${noBank.length} employee(s) would be left out of the bank salary file.` : 'All eligible employees have a salary account.', items: noBank.map(empLink), href: '/bank' });
  const recentBank = eligible.filter((e) => e.bankAccount && e.bankAccount.updatedAt >= new Date(Date.now() - 7 * 86_400_000));
  add({ id: 'bank-recent', area: 'Bank', title: 'No bank details changed in the last 7 days', status: recentBank.length ? 'WARN' : 'PASS', detail: recentBank.length ? 'Confirm these changes with the employees before paying (see Fraud investigation).' : 'No recent changes.', items: recentBank.map(empLink), href: '/fraud' });
  const noPan = eligible.filter((e) => !e.panNumber);
  add({ id: 'pan', area: 'Employees', title: 'PAN recorded (needed for TDS and Form 16)', status: noPan.length ? 'WARN' : 'PASS', detail: noPan.length ? `${noPan.length} employee(s) without a PAN.` : 'All employees have a PAN.', items: noPan.map(empLink) });
  if (settings.statutory.pf.enabled) {
    const lastGross = new Map((await prisma.payrollRunEmployee.findMany({ where: { employeeId: { in: eligible.map((e) => e.id) }, payrollRun: { status: 'FINALISED' } }, orderBy: { payrollRun: { year: 'asc' } } })).map((m) => [m.employeeId, m.gross]));
    const threshold = settings.statutory.wageBand.enabled ? settings.statutory.wageBand.threshold : null;
    const noUan = eligible.filter((e) => !e.uanNumber && (threshold === null || !lastGross.get(e.id) || dec(lastGross.get(e.id)!.toString()).gt(threshold)));
    add({ id: 'uan', area: 'Employees', title: 'UAN recorded for PF members', status: noUan.length ? 'WARN' : 'PASS', detail: noUan.length ? `${noUan.length} likely PF member(s) without a UAN.` : 'PF members have a UAN.', items: noUan.map(empLink) });
  }

  // Attendance and approvals
  const withAttendance = new Set(attendance.map((a) => a.employeeId));
  const today = new Date();
  const started = today >= monthStart;
  const noAttendance = started ? eligible.filter((e) => !withAttendance.has(e.id)) : [];
  add({ id: 'attendance', area: 'Attendance', title: 'Attendance is being recorded this month', status: !started ? 'INFO' : noAttendance.length === eligible.length && eligible.length ? 'WARN' : noAttendance.length ? 'WARN' : 'PASS', detail: !started ? 'The month has not started yet.' : noAttendance.length ? `${noAttendance.length} employee(s) have no attendance records for ${periodLabel(year, month)}.` : 'Every employee has attendance records.', items: noAttendance.map(empLink), href: '/attendance' });
  add({ id: 'attendance-mapping', area: 'Attendance', title: 'Attendance and leave feed payroll automatically', status: settings.attendancePayrollMap.length || settings.inputMappings.unpaidLeaveDays ? 'PASS' : 'WARN', detail: settings.inputMappings.unpaidLeaveDays ? `Loss-of-pay days come from input ${settings.inputMappings.unpaidLeaveDays}.` : 'No input is mapped to unpaid leave, so loss-of-pay days are not deducted automatically.', href: '/attendance/payroll' });
  add({ id: 'leave-pending', area: 'Approvals', title: 'Leave requests for the month are decided', status: leave.length ? 'WARN' : 'PASS', detail: leave.length ? `${leave.length} request(s) awaiting a decision would change loss-of-pay days.` : 'No pending leave requests.', items: leave.map((l) => ({ label: `${label(l.employee)} · ${Number(l.days)} day(s)`, href: '/leave' })), href: '/leave' });
  add({ id: 'bonus-pending', area: 'Approvals', title: 'Bonuses and incentives for the month are approved', status: bonuses.length ? 'WARN' : 'PASS', detail: bonuses.length ? `${bonuses.length} proposal(s) awaiting approval.` : 'Nothing awaiting approval.', items: bonuses.map((b) => ({ label: `${label(b.employee)} · ${b.kind.toLowerCase()}`, href: '/bonuses' })), href: '/bonuses' });

  // Statutory
  const sp = statutoryProblems(settings.statutory);
  const spList = [...sp.PF, ...sp.ESI, ...sp.TDS];
  add({ id: 'statutory', area: 'Statutory', title: 'PF, ESI and TDS settings are complete', status: spList.length ? 'FAIL' : !settings.statutory.pf.enabled && !settings.statutory.esi.enabled ? 'WARN' : 'PASS', detail: spList[0] ?? (!settings.statutory.pf.enabled && !settings.statutory.esi.enabled ? 'PF and ESI are switched off.' : `PF ${settings.statutory.pf.enabled ? 'on' : 'off'}, ESI ${settings.statutory.esi.enabled ? 'on' : 'off'}${settings.statutory.wageBand.enabled ? `, ESI at or below ₹${settings.statutory.wageBand.threshold} and PF above` : ''}, TDS ${settings.statutory.tds.enabled ? 'on' : 'off'}.`), items: spList.map((p) => ({ label: p })), href: '/statutory' });

  // Payroll run
  if (!run) {
    add({ id: 'run', area: 'Payroll run', title: `Payroll run for ${periodLabel(year, month)} exists`, status: today > monthEnd ? 'FAIL' : 'WARN', detail: 'Not created yet. Use "Run payroll automatically" on the Payroll runs page.', href: '/payroll' });
  } else {
    const missingMembers = eligible.filter((e) => !run.employees.some((m) => m.employeeId === e.id));
    add({ id: 'run', area: 'Payroll run', title: `Payroll run for ${periodLabel(year, month)} exists`, status: 'PASS', detail: `Status: ${run.status.replace('_', ' ').toLowerCase()}.`, href: `/payroll/${run.id}` });
    add({ id: 'run-members', area: 'Payroll run', title: 'Every eligible employee is in the run', status: missingMembers.length ? 'WARN' : 'PASS', detail: missingMembers.length ? `${missingMembers.length} eligible employee(s) are not included.` : `${run.employees.length} employee(s) included.`, items: missingMembers.map(empLink), href: `/payroll/${run.id}` });
    const errors = run.employees.filter((m) => m.resultStatus === 'ERROR');
    add({ id: 'run-errors', area: 'Payroll run', title: 'No blocking calculation exceptions', status: run.status === 'DRAFT' ? 'INFO' : errors.length ? 'FAIL' : 'PASS', detail: run.status === 'DRAFT' ? 'Not calculated yet.' : errors.length ? `${errors.length} employee(s) have errors.` : 'All results calculated.', items: errors.map((m) => ({ label: `${m.employeeCode} · ${m.employeeName}`, href: `/payroll/${run.id}` })) });
    if (run.status === 'CALCULATED' && run.calculatedAt) {
      const changed = await prisma.payrollInput.count({ where: { payrollRunId: run.id, updatedAt: { gt: run.calculatedAt } } });
      if (changed) add({ id: 'run-stale', area: 'Payroll run', title: 'Calculation is up to date', status: 'WARN', detail: `${changed} input(s) changed after the last calculation.`, href: `/payroll/${run.id}` });
    }
    add({ id: 'run-alerts', area: 'Payroll run', title: 'Payroll alerts reviewed', status: run.anomalies.length ? 'WARN' : 'PASS', detail: run.anomalies.length ? `${run.anomalies.length} open alert(s).` : 'No open alerts.', href: '/alerts' });
    const pendingApproval = run.status === 'UNDER_REVIEW' || run.status === 'APPROVED';
    add({ id: 'run-approval', area: 'Approvals', title: 'Required approvals are complete', status: run.status === 'FINALISED' ? 'PASS' : pendingApproval ? 'WARN' : 'INFO', detail: run.status === 'FINALISED' ? 'Finalised.' : pendingApproval ? `Waiting for ${run.status === 'UNDER_REVIEW' && settings.requireApprovalStep ? 'approval' : 'finalisation'}.` : 'Not yet submitted for review.', href: `/payroll/${run.id}` });
    const checklistTotal = await prisma.checklistItem.count({ where: { active: true } });
    if (checklistTotal) {
      const done = run.checklist.filter((c) => c.done).length;
      add({ id: 'checklist', area: 'Approvals', title: 'Monthly checklist', status: done >= checklistTotal ? 'PASS' : 'INFO', detail: `${done} of ${checklistTotal} item(s) done.`, href: `/payroll/${run.id}` });
    }
  }

  const scored = checks.filter((c) => c.status !== 'INFO');
  const score = scored.length ? Math.round((scored.reduce((a, c) => a + (c.status === 'PASS' ? 1 : c.status === 'WARN' ? 0.5 : 0), 0) / scored.length) * 100) : 100;
  const daysLeft = Math.ceil((monthEnd.getTime() - today.getTime()) / 86_400_000);
  return {
    year,
    month,
    period: periodLabel(year, month),
    checkedAt: new Date(),
    score,
    overall: checks.some((c) => c.status === 'FAIL') ? 'BLOCKED' : checks.some((c) => c.status === 'WARN') ? 'AT_RISK' : 'READY',
    daysToMonthEnd: daysLeft,
    employees: eligible.length,
    counts: { pass: checks.filter((c) => c.status === 'PASS').length, warn: checks.filter((c) => c.status === 'WARN').length, fail: checks.filter((c) => c.status === 'FAIL').length, info: checks.filter((c) => c.status === 'INFO').length },
    checks,
  };
}

export function registerReadinessRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/readiness',
    tag: 'Readiness',
    summary: 'Payroll readiness checks for a month (default: the month that needs payroll next)',
    permission: 'payroll.view',
    query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), month: z.coerce.number().int().min(1).max(12).optional() }),
    handler: async ({ query }) => {
      const p = query.year && query.month ? { year: query.year, month: query.month } : await nextPeriod();
      return readiness(p.year, p.month);
    },
  });
}
