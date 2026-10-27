import { z } from 'zod';
import {
  AppError,
  FileStorage,
  dec,
  Dec,
  idParam,
  money,
  notFound,
  renderPdf,
  type ApiRegistry,
  type AuthUser,
} from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { config } from '../config';
import { MONTHS, periodLabel } from '../payroll/service';
import { employedDaysInMonth, type CalcSummary } from '../payroll/engine';
import { getSettings } from '../settings';
import { DEFAULT_LOGO_DATA_URL } from './brand-logo';
import { amountInWords, renderPayslipHtml, type PayslipData, type ReportColumn, type ReportData } from './templates';
import { sendPdf, sendReport } from './report-export';
import { notifyRun } from '../notify';

export const storage = new FileStorage(config.STORAGE_DIR);

const fmtNow = () => new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const CONTRIBUTION_REFS = new Set(['STATUTORY_PF', 'STATUTORY_ESI']);
/** Employee PF / ESI go under "Contributions (B)"; everything else under "Taxes & Deductions (C)". */
const isContribution = (l: { componentCode: string; calcDetail: Prisma.JsonValue }) =>
  CONTRIBUTION_REFS.has(String((l.calcDetail as Record<string, unknown> | null)?.formulaRef ?? '')) || /^(E?PF|ESI|ESIC)(_|$)/i.test(l.componentCode);

const fmtDay = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
const sumAmounts = (list: { amount: string }[]) => money(list.reduce((acc, l) => acc.add(dec(l.amount)), new Dec(0)));

export async function payslipData(runId: string, employeeIds?: string[]): Promise<PayslipData> {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound('Payroll run');
  if (run.status === 'DRAFT') throw new AppError('INVALID_STATE', 'Calculate the payroll before generating payslips.');
  const members = await prisma.payrollRunEmployee.findMany({
    where: { payrollRunId: runId, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) },
    include: { employee: { include: { manager: { select: { fullName: true } }, bankAccount: true } } },
    orderBy: { employeeCode: 'asc' },
  });
  if (!members.length) throw notFound('Employee in this payroll run');
  const errored = members.filter((m) => m.resultStatus === 'ERROR' || m.resultStatus === 'PENDING');
  if (errored.length && run.status === 'FINALISED') throw new AppError('INVALID_STATE', 'Some results are incomplete.');
  const [lines, settings] = await Promise.all([
    prisma.payrollLine.findMany({ where: { payrollRunId: runId, showOnPayslip: true, employeeId: { in: members.map((m) => m.employeeId) } }, orderBy: [{ sortOrder: 'asc' }, { componentCode: 'asc' }] }),
    getSettings(),
  ]);
  const brand = settings.branding;
  const daysInMonth = new Date(Date.UTC(run.year, run.month, 0)).getUTCDate();
  return {
    companyName: brand.companyName || config.PAYSLIP_COMPANY_NAME,
    companyAddress: brand.address,
    logoDataUrl: brand.logoDataUrl ?? DEFAULT_LOGO_DATA_URL,
    primaryColor: brand.primaryColor,
    accentColor: brand.accentColor,
    period: periodLabel(run.year, run.month),
    periodShort: `${MONTHS[run.month - 1].slice(0, 3).toUpperCase()} ${run.year}`,
    runStatus: run.status.replace('_', ' '),
    generatedAt: fmtNow(),
    watermark: run.status === 'FINALISED' ? null : 'DRAFT — NOT FINAL',
    banners: [],
    slips: members
      .filter((m) => m.resultStatus !== 'ERROR' && m.resultStatus !== 'PENDING')
      .map((m) => {
        // Zero lines (e.g. PF for an employee in the ESI band) are left off the payslip.
        const mine = lines.filter((l) => l.employeeId === m.employeeId && !l.amount.isZero());
        const amount = (l: (typeof mine)[number]) => ({ name: l.componentName, amount: l.amount.toString() });
        const earnings = mine.filter((l) => l.componentType === 'EARNING').map(amount);
        const contributions = mine.filter((l) => l.componentType === 'DEDUCTION' && isContribution(l)).map(amount);
        const deductions = mine.filter((l) => l.componentType === 'DEDUCTION' && !isContribution(l)).map(amount);
        const summary = (m.calcSummary ?? {}) as Partial<CalcSummary>;
        // Results calculated before pay-day summaries existed: derive what is known.
        const employerShare = (ref: string) =>
          money(lines.filter((l) => l.employeeId === m.employeeId && (l.calcDetail as Record<string, unknown> | null)?.formulaRef === ref).reduce((acc, l) => acc.add(dec(String((l.calcDetail as Record<string, unknown>).employerContribution ?? '0'))), new Dec(0)));
        const employedDays = summary.employedDays ?? employedDaysInMonth(m.employee, run.year, run.month);
        // Gratuity: runs calculated before it was reported fall back to today's policy (rate × base components).
        const gratuityFallback = () => {
          const g = settings.gratuity;
          if (!g?.enabled) return '0.00';
          const base = mine.filter((l) => l.componentType === 'EARNING' && g.baseComponents.includes(l.componentCode)).reduce((acc, l) => acc.add(dec(l.amount.toString())), new Dec(0));
          return money(base.mul(dec(String(g.ratePercent))).div(100));
        };
        const employer = { pf: summary.employerPf ?? employerShare('STATUTORY_PF'), esi: summary.employerEsi ?? employerShare('STATUTORY_ESI'), gratuity: summary.gratuity ?? gratuityFallback() };
        const gross = m.gross?.toString() ?? '0';
        const net = m.net?.toString() ?? '0';
        const bank = m.employee.bankAccount;
        return {
          employeeCode: m.employeeCode,
          employeeName: m.employeeName,
          department: m.departmentName ?? 'N/A',
          designation: m.designationName ?? 'N/A',
          dateJoined: fmtDay(m.employee.joiningDate),
          manager: m.employee.manager?.fullName ?? 'N/A',
          paymentMode: bank ? 'Bank Transfer' : 'Not set',
          bankName: bank?.bankName ?? 'N/A',
          ifsc: bank?.ifsc ?? 'N/A',
          bankAccount: bank ? `XXXXXXXX${bank.accountLast4}` : 'N/A',
          uan: m.employee.uanNumber ?? 'N/A',
          pfNumber: m.employee.pfNumber ?? 'N/A',
          pan: m.employee.panNumber ?? 'N/A',
          days: {
            daysInMonth: String(summary.daysInMonth ?? daysInMonth),
            employedDays: String(employedDays),
            lopDays: summary.lopDays ?? '0',
            payableDays: summary.payableDays ?? String(employedDays),
          },
          earnings,
          contributions,
          deductions,
          gross,
          totalContributions: sumAmounts(contributions),
          totalOtherDeductions: sumAmounts(deductions),
          totalDeductions: m.deductions?.toString() ?? '0',
          net,
          netInWords: amountInWords(money(dec(net))),
          employer: {
            ...employer,
            ctc: money(dec(gross).add(dec(employer.pf)).add(dec(employer.esi)).add(dec(employer.gratuity))),
          },
        };
      }),
  };
}

const canSeeAmounts = (u: AuthUser) => u.permissions.has('payroll.view_amounts');

export function registerOutputRoutes(r: ApiRegistry) {
  // ------------------------------------------------------------------ Payslips
  r.add({
    method: 'get',
    path: '/payroll-runs/:id/payslips',
    tag: 'Payslips',
    summary: 'Payslip status per employee for a run',
    permission: 'payslips.generate',
    params: idParam,
    handler: async ({ params }) => {
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw notFound('Payroll run');
      const [members, slips] = await Promise.all([
        prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, orderBy: { employeeCode: 'asc' } }),
        prisma.payslip.findMany({ where: { payrollRunId: run.id, supersededAt: null } }),
      ]);
      return {
        runStatus: run.status,
        isFinal: run.status === 'FINALISED',
        items: members.map((m) => {
          const slip = slips.find((s) => s.employeeId === m.employeeId);
          return { employeeId: m.employeeId, employeeCode: m.employeeCode, employeeName: m.employeeName, resultStatus: m.resultStatus, payslipId: slip?.id ?? null, generatedAt: slip?.generatedAt ?? null };
        }),
      };
    },
  });

  r.add({
    method: 'get',
    path: '/payroll-runs/:id/employees/:employeeId/payslip',
    tag: 'Payslips',
    summary: 'Payslip PDF for one employee. Finalised runs: generated once, stored and re-served. Otherwise: watermarked preview.',
    permission: 'payslips.generate',
    produces: 'pdf',
    params: z.object({ id: z.string().uuid(), employeeId: z.string().uuid() }),
    query: z.object({ disposition: z.enum(['inline', 'attachment']).default('attachment') }),
    handler: async ({ params, query, res, user, ip }) => {
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw notFound('Payroll run');
      const member = await prisma.payrollRunEmployee.findUnique({ where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: params.employeeId } } });
      if (!member) throw notFound('Employee in this payroll run');
      if (member.resultStatus === 'ERROR' || member.resultStatus === 'PENDING') throw new AppError('INVALID_STATE', 'This employee has no valid calculated result.');
      const filename = `payslip-${member.employeeCode}-${run.year}-${String(run.month).padStart(2, '0')}.pdf`;
      if (run.status === 'FINALISED') {
        const existing = await prisma.payslip.findFirst({ where: { payrollRunId: run.id, employeeId: params.employeeId, supersededAt: null }, orderBy: { generatedAt: 'desc' } });
        let pdf = existing ? await storage.read(existing.fileKey) : null;
        if (!pdf) {
          pdf = await renderPdf(renderPayslipHtml(await payslipData(run.id, [params.employeeId])), { footerText: `Payslip ${periodLabel(run.year, run.month)} · ${member.employeeCode}` });
          const saved = await storage.save(pdf, 'pdf', 'payslips');
          await prisma.payslip.create({ data: { payrollRunId: run.id, employeeId: params.employeeId, fileKey: saved.key, sha256: saved.sha256, sizeBytes: saved.size, generatedById: user.id } });
          await audit.write({ actorId: user.id, action: 'payslip.generated', entity: 'payroll_run', entityId: run.id, metadata: { employeeCode: member.employeeCode }, ip });
        }
        await audit.write({ actorId: user.id, action: 'payslip.downloaded', entity: 'payroll_run', entityId: run.id, metadata: { employeeCode: member.employeeCode }, ip });
        return sendPdf(res, pdf, filename, query.disposition === 'inline');
      }
      const pdf = await renderPdf(renderPayslipHtml(await payslipData(run.id, [params.employeeId])), { footerText: 'PREVIEW — payroll not finalised' });
      return sendPdf(res, pdf, filename.replace('.pdf', '-preview.pdf'), query.disposition === 'inline');
    },
  });

  r.add({
    method: 'post',
    path: '/payroll-runs/:id/payslips/generate',
    tag: 'Payslips',
    summary: 'Generate and store payslips for all employees of a finalised run',
    permission: 'payslips.generate',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw notFound('Payroll run');
      if (run.status !== 'FINALISED') throw new AppError('INVALID_STATE', 'Payslips can be generated only after the payroll is finalised. Use preview for draft results.');
      const members = await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, orderBy: { employeeCode: 'asc' } });
      const existing = new Set((await prisma.payslip.findMany({ where: { payrollRunId: run.id, supersededAt: null } })).map((p) => p.employeeId));
      let generated = 0;
      for (const m of members) {
        if (existing.has(m.employeeId)) continue;
        const pdf = await renderPdf(renderPayslipHtml(await payslipData(run.id, [m.employeeId])), { footerText: `Payslip ${periodLabel(run.year, run.month)} · ${m.employeeCode}` });
        const saved = await storage.save(pdf, 'pdf', 'payslips');
        await prisma.payslip.create({ data: { payrollRunId: run.id, employeeId: m.employeeId, fileKey: saved.key, sha256: saved.sha256, sizeBytes: saved.size, generatedById: user.id } });
        generated++;
      }
      await audit.write({ actorId: user.id, action: 'payslip.bulk_generated', entity: 'payroll_run', entityId: run.id, metadata: { generated, alreadyPresent: existing.size }, ip });
      if (generated > 0) void notifyRun(run.id, 'PAYSLIPS');
      return { generated, alreadyPresent: existing.size, total: members.length };
    },
  });

  r.add({
    method: 'get',
    path: '/payroll-runs/:id/payslips/bulk',
    tag: 'Payslips',
    summary: 'All payslips of a run in one print-ready PDF (one employee per page)',
    permission: 'payslips.generate',
    produces: 'pdf',
    params: idParam,
    handler: async ({ params, res, user, ip }) => {
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw notFound('Payroll run');
      const data = await payslipData(run.id);
      if (!data.slips.length) throw new AppError('INVALID_STATE', 'There are no valid results to print.');
      const pdf = await renderPdf(renderPayslipHtml(data), { footerText: `Payslips ${data.period}${run.status === 'FINALISED' ? '' : ' — PREVIEW'}` });
      await audit.write({ actorId: user.id, action: 'payslip.bulk_downloaded', entity: 'payroll_run', entityId: run.id, metadata: { count: data.slips.length }, ip });
      sendPdf(res, pdf, `payslips-${run.year}-${String(run.month).padStart(2, '0')}.pdf`, false);
    },
  });

  // ------------------------------------------------------------------ Reports
  const formatQ = z.enum(['json', 'pdf', 'xlsx']).default('json');

  async function loadRun(runId: string) {
    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) throw notFound('Payroll run');
    if (run.status === 'DRAFT') throw new AppError('INVALID_STATE', 'This payroll has not been calculated yet.');
    return run;
  }

  const runStatusNote = (run: { status: string; rulesApproved: boolean }) => [
    ...(run.status !== 'FINALISED' ? [`Payroll status: ${run.status.replace('_', ' ')} — figures are not final.`] : []),
  ];

  r.add({
    method: 'get',
    path: '/reports/monthly-summary',
    tag: 'Reports',
    summary: 'Monthly payroll summary: employee-wise gross, deductions and net with totals',
    permission: ['reports.view'],
    produces: 'xlsx',
    query: z.object({ runId: z.string().uuid(), format: formatQ }),
    handler: async ({ query, res, user, ip }) => {
      if (!canSeeAmounts(user)) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts.');
      const run = await loadRun(query.runId);
      const members = await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, orderBy: { employeeCode: 'asc' } });
      const columns: ReportColumn[] = [
        { header: 'Employee ID', key: 'code' },
        { header: 'Employee Name', key: 'name' },
        { header: 'Department', key: 'department' },
        { header: 'Gross', key: 'gross', numeric: true },
        { header: 'Deductions', key: 'deductions', numeric: true },
        { header: 'Net Pay', key: 'net', numeric: true },
      ];
      const rows = members.map((m) => ({ code: m.employeeCode, name: m.employeeName, department: m.departmentName ?? '', gross: m.gross?.toString() ?? '', deductions: m.deductions?.toString() ?? '', net: m.net?.toString() ?? '' }));
      const report: ReportData = {
        title: `Monthly Payroll Summary — ${periodLabel(run.year, run.month)}`,
        subtitle: `${members.length} employees · generated ${fmtNow()}`,
        banners: runStatusNote(run),
        columns,
        rows,
        totals: { code: 'Total', name: '', department: '', gross: run.totalEarnings?.toString() ?? '', deductions: run.totalDeductions?.toString() ?? '', net: run.totalNet?.toString() ?? '' },
      };
      if (query.format !== 'json') await audit.write({ actorId: user.id, action: 'report.exported', entity: 'payroll_run', entityId: run.id, metadata: { report: 'monthly-summary', format: query.format }, ip });
      return sendReport(res, query.format, report, `payroll-summary-${run.year}-${String(run.month).padStart(2, '0')}`);
    },
  });

  r.add({
    method: 'get',
    path: '/reports/components',
    tag: 'Reports',
    summary: 'Earnings report / deductions report: component-wise totals and per-employee breakdown',
    permission: ['reports.view'],
    produces: 'xlsx',
    query: z.object({ runId: z.string().uuid(), type: z.enum(['EARNING', 'DEDUCTION']), format: formatQ }),
    handler: async ({ query, res, user, ip }) => {
      if (!canSeeAmounts(user)) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts.');
      const run = await loadRun(query.runId);
      const [members, lines] = await Promise.all([
        prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, orderBy: { employeeCode: 'asc' } }),
        prisma.payrollLine.findMany({ where: { payrollRunId: run.id, componentType: query.type }, orderBy: [{ sortOrder: 'asc' }, { componentCode: 'asc' }] }),
      ]);
      const comps = [...new Map(lines.map((l) => [l.componentCode, l.componentName])).entries()];
      const columns: ReportColumn[] = [{ header: 'Employee ID', key: 'code' }, { header: 'Employee Name', key: 'name' }, ...comps.map(([code, name]) => ({ header: name, key: `c_${code}`, numeric: true })), { header: 'Total', key: 'total', numeric: true }];
      const totals: Record<string, Dec> = {};
      const rows = members.map((m) => {
        const mine = lines.filter((l) => l.employeeId === m.employeeId);
        const row: Record<string, string> = { code: m.employeeCode, name: m.employeeName };
        let total = new Dec(0);
        for (const [code] of comps) {
          const l = mine.find((x) => x.componentCode === code);
          row[`c_${code}`] = l ? l.amount.toString() : '';
          if (l) {
            total = total.add(dec(l.amount));
            totals[code] = (totals[code] ?? new Dec(0)).add(dec(l.amount));
          }
        }
        row.total = money(total);
        return row;
      });
      const grand = Object.values(totals).reduce((a, b) => a.add(b), new Dec(0));
      const report: ReportData = {
        title: `${query.type === 'EARNING' ? 'Earnings' : 'Deductions'} Report — ${periodLabel(run.year, run.month)}`,
        subtitle: `Component-wise totals · generated ${fmtNow()}`,
        banners: runStatusNote(run),
        columns,
        rows,
        totals: { code: 'Total', name: '', ...Object.fromEntries(comps.map(([code]) => [`c_${code}`, money(totals[code] ?? new Dec(0))])), total: money(grand) },
      };
      if (query.format !== 'json') await audit.write({ actorId: user.id, action: 'report.exported', entity: 'payroll_run', entityId: run.id, metadata: { report: query.type, format: query.format }, ip });
      return sendReport(res, query.format, report, `${query.type === 'EARNING' ? 'earnings' : 'deductions'}-${run.year}-${String(run.month).padStart(2, '0')}`);
    },
  });

  r.add({
    method: 'get',
    path: '/reports/payroll-register',
    tag: 'Reports',
    summary: 'Monthly payroll register: every earning and deduction per employee, with gross, deductions, net and totals',
    permission: ['reports.view'],
    produces: 'xlsx',
    query: z.object({ runId: z.string().uuid(), format: formatQ }),
    handler: async ({ query, res, user, ip }) => {
      if (!canSeeAmounts(user)) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts.');
      const run = await loadRun(query.runId);
      const [members, lines] = await Promise.all([
        prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, orderBy: { employeeCode: 'asc' } }),
        prisma.payrollLine.findMany({ where: { payrollRunId: run.id }, orderBy: [{ sortOrder: 'asc' }, { componentCode: 'asc' }] }),
      ]);
      const comps = [...new Map(lines.map((l) => [l.componentCode, { name: l.componentName, type: l.componentType }])).entries()];
      const earnings = comps.filter(([, c]) => c.type === 'EARNING');
      const deductions = comps.filter(([, c]) => c.type === 'DEDUCTION');
      const columns: ReportColumn[] = [
        { header: 'Employee ID', key: 'code' },
        { header: 'Employee Name', key: 'name' },
        { header: 'Department', key: 'dept' },
        ...earnings.map(([code, c]) => ({ header: c.name, key: `c_${code}`, numeric: true })),
        { header: 'Gross', key: 'gross', numeric: true },
        ...deductions.map(([code, c]) => ({ header: c.name, key: `c_${code}`, numeric: true })),
        { header: 'Total deductions', key: 'deductions', numeric: true },
        { header: 'Net pay', key: 'net', numeric: true },
      ];
      const totals: Record<string, Dec> = {};
      const add = (k: string, v: Dec) => (totals[k] = (totals[k] ?? new Dec(0)).add(v));
      const rows = members.map((m) => {
        const row: Record<string, string> = { code: m.employeeCode, name: m.employeeName, dept: m.departmentName ?? '' };
        for (const [code] of comps) {
          const l = lines.find((x) => x.employeeId === m.employeeId && x.componentCode === code);
          row[`c_${code}`] = l ? money(dec(l.amount)) : '';
          if (l) add(`c_${code}`, dec(l.amount));
        }
        for (const [k, v] of [['gross', m.gross], ['deductions', m.deductions], ['net', m.net]] as const) {
          row[k] = v === null ? '' : money(dec(v));
          if (v !== null) add(k, dec(v));
        }
        return row;
      });
      const report: ReportData = {
        title: `Payroll Register — ${periodLabel(run.year, run.month)}`,
        subtitle: `${members.length} employee(s) · generated ${fmtNow()}`,
        banners: runStatusNote(run),
        columns,
        rows,
        totals: { code: 'Total', name: '', dept: '', ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, money(v)])) },
      };
      if (query.format !== 'json') await audit.write({ actorId: user.id, action: 'report.exported', entity: 'payroll_run', entityId: run.id, metadata: { report: 'payroll-register', format: query.format }, ip });
      return sendReport(res, query.format, report, `payroll-register-${run.year}-${String(run.month).padStart(2, '0')}`);
    },
  });

  r.add({
    method: 'get',
    path: '/reports/net-payable',
    tag: 'Reports',
    summary: 'Net payable report for a run',
    permission: ['reports.view'],
    produces: 'xlsx',
    query: z.object({ runId: z.string().uuid(), format: formatQ }),
    handler: async ({ query, res, user, ip }) => {
      if (!canSeeAmounts(user)) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts.');
      const run = await loadRun(query.runId);
      const members = await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, orderBy: { employeeCode: 'asc' } });
      const report: ReportData = {
        title: `Net Payable — ${periodLabel(run.year, run.month)}`,
        subtitle: `${members.length} employees · generated ${fmtNow()}`,
        banners: runStatusNote(run),
        columns: [
          { header: 'Employee ID', key: 'code' },
          { header: 'Employee Name', key: 'name' },
          { header: 'Department', key: 'department' },
          { header: 'Designation', key: 'designation' },
          { header: 'Net Payable', key: 'net', numeric: true },
        ],
        rows: members.map((m) => ({ code: m.employeeCode, name: m.employeeName, department: m.departmentName ?? '', designation: m.designationName ?? '', net: m.net?.toString() ?? '' })),
        totals: { code: 'Total', name: '', department: '', designation: '', net: run.totalNet?.toString() ?? '' },
      };
      if (query.format !== 'json') await audit.write({ actorId: user.id, action: 'report.exported', entity: 'payroll_run', entityId: run.id, metadata: { report: 'net-payable', format: query.format }, ip });
      return sendReport(res, query.format, report, `net-payable-${run.year}-${String(run.month).padStart(2, '0')}`);
    },
  });

  r.add({
    method: 'get',
    path: '/reports/employee-statement',
    tag: 'Reports',
    summary: 'Employee-wise salary statement (month by month)',
    permission: ['reports.view'],
    produces: 'xlsx',
    query: z.object({ employeeId: z.string().uuid(), year: z.coerce.number().int().min(2000).max(2100).optional(), format: formatQ }),
    handler: async ({ query, res, user, ip }) => {
      if (!canSeeAmounts(user)) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts.');
      const emp = await prisma.employee.findUnique({ where: { id: query.employeeId } });
      if (!emp) throw notFound('Employee');
      const rowsDb = await prisma.payrollRunEmployee.findMany({
        where: { employeeId: emp.id, payrollRun: { status: { not: 'DRAFT' }, ...(query.year ? { year: query.year } : {}) } },
        include: { payrollRun: true },
        orderBy: [{ payrollRun: { year: 'asc' } }, { payrollRun: { month: 'asc' } }],
      });
      let g = new Dec(0), d = new Dec(0), n = new Dec(0);
      const rows = rowsDb.map((m) => {
        g = g.add(dec(m.gross)); d = d.add(dec(m.deductions)); n = n.add(dec(m.net));
        return { period: periodLabel(m.payrollRun.year, m.payrollRun.month), status: m.payrollRun.status.replace('_', ' '), gross: m.gross?.toString() ?? '', deductions: m.deductions?.toString() ?? '', net: m.net?.toString() ?? '' };
      });
      const report: ReportData = {
        title: `Salary Statement — ${emp.fullName} (${emp.employeeCode})`,
        subtitle: `${query.year ? `Year ${query.year}` : 'All periods'} · generated ${fmtNow()}`,
        banners: [...(rowsDb.some((m) => m.payrollRun.status !== 'FINALISED') ? ['Includes payroll months that are not finalised.'] : [])],
        columns: [
          { header: 'Month', key: 'period' },
          { header: 'Payroll Status', key: 'status' },
          { header: 'Gross', key: 'gross', numeric: true },
          { header: 'Deductions', key: 'deductions', numeric: true },
          { header: 'Net Pay', key: 'net', numeric: true },
        ],
        rows,
        totals: { period: 'Total', status: '', gross: money(g), deductions: money(d), net: money(n) },
      };
      if (query.format !== 'json') await audit.write({ actorId: user.id, action: 'report.exported', entity: 'employee', entityId: emp.id, metadata: { report: 'employee-statement', format: query.format }, ip });
      return sendReport(res, query.format, report, `salary-statement-${emp.employeeCode}`);
    },
  });

  // ------------------------------------------------------------------ Dashboard & notifications
  r.add({
    method: 'get',
    path: '/dashboard',
    tag: 'Dashboard',
    summary: 'Dashboard figures from live data (amounts only with permission)',
    handler: async ({ user }) => {
      const now = new Date();
      const [activeEmployees, drafts, awaitingReview, awaitingApproval, recentFinalised, current, recentEvents, trend] = await Promise.all([
        user.permissions.has('employees.view') ? prisma.employee.count({ where: { status: 'ACTIVE' } }) : Promise.resolve(null),
        prisma.payrollRun.count({ where: { status: { in: ['DRAFT', 'CALCULATED'] } } }),
        prisma.payrollRun.count({ where: { status: 'UNDER_REVIEW' } }),
        prisma.payrollRun.count({ where: { status: 'APPROVED' } }),
        prisma.payrollRun.findMany({ where: { status: 'FINALISED' }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 5 }),
        prisma.payrollRun.findUnique({ where: { year_month: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 } } }),
        user.permissions.has('payroll.view') ? prisma.payrollRunEvent.findMany({ orderBy: { occurredAt: 'desc' }, take: 8, include: { payrollRun: { select: { year: true, month: true } } } }) : Promise.resolve([]),
        prisma.payrollRun.findMany({ where: { status: 'FINALISED' }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 6 }),
      ]);
      const show = canSeeAmounts(user);
      return {
        activeEmployees,
        currentPeriod: { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, label: periodLabel(now.getUTCFullYear(), now.getUTCMonth() + 1), runId: current?.id ?? null, status: current?.status ?? null },
        draftRuns: drafts,
        awaitingReview,
        awaitingApproval,
        rulesApproved: config.PAYROLL_RULES_APPROVED,
        recentFinalised: recentFinalised.map((r) => ({ id: r.id, period: periodLabel(r.year, r.month), finalisedAt: r.finalisedAt, employeeCount: r.employeeCount, totalNet: show ? r.totalNet?.toString() ?? null : null })),
        netTrend: show ? trend.reverse().map((r) => ({ period: `${r.year}-${String(r.month).padStart(2, '0')}`, label: periodLabel(r.year, r.month).slice(0, 3) + ' ' + r.year, totalNet: r.totalNet?.toString() ?? '0', totalEarnings: r.totalEarnings?.toString() ?? '0', totalDeductions: r.totalDeductions?.toString() ?? '0' })) : null,
        recentActivity: recentEvents.map((e) => ({ action: e.action, period: periodLabel(e.payrollRun.year, e.payrollRun.month), runId: e.payrollRunId, actorName: e.actorName, occurredAt: e.occurredAt, reason: e.reason })),
      };
    },
  });

  r.add({
    method: 'get',
    path: '/notifications',
    tag: 'Dashboard',
    summary: 'Pending payroll actions for the current user',
    handler: async ({ user }) => {
      const items: { id: string; message: string; href: string }[] = [];
      const p = user.permissions;
      if (p.has('payroll.approve')) {
        for (const r of await prisma.payrollRun.findMany({ where: { status: 'UNDER_REVIEW' }, take: 10 })) items.push({ id: `review-${r.id}`, message: `${periodLabel(r.year, r.month)} payroll is awaiting approval`, href: `/payroll/${r.id}` });
      }
      if (p.has('payroll.finalise')) {
        for (const r of await prisma.payrollRun.findMany({ where: { status: 'APPROVED' }, take: 10 })) items.push({ id: `final-${r.id}`, message: `${periodLabel(r.year, r.month)} payroll is approved and ready to finalise`, href: `/payroll/${r.id}` });
      }
      if (p.has('payroll.calculate')) {
        for (const r of await prisma.payrollRun.findMany({ where: { status: 'DRAFT' }, take: 10 })) items.push({ id: `draft-${r.id}`, message: `${periodLabel(r.year, r.month)} payroll is in draft`, href: `/payroll/${r.id}` });
      }
      if (p.has('users.manage')) {
        const pending = await prisma.user.findMany({ where: { status: 'PENDING' }, include: { role: true }, orderBy: { createdAt: 'asc' }, take: 10 });
        for (const u of pending) items.push({ id: `account-${u.id}`, message: `${u.name} requested a ${u.role.name} account`, href: '/admin/users?status=PENDING' });
      }
      if (p.has('notifications.view')) {
        const employeeId = (await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } }))?.employeeId;
        if (employeeId) {
          const notifications = await prisma.employeeNotification.findMany({
            where: { employeeId, readAt: null },
            orderBy: { createdAt: 'desc' },
            take: 10,
          });
          for (const n of notifications) items.push({ id: `employee-${n.id}`, message: `${n.title}: ${n.message}`, href: n.targetUrl ?? '/notifications' });
        }
      }
      return { items };
    },
  });
}

export { Prisma };
