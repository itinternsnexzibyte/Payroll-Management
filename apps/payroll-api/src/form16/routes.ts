/**
 * Form 16 — annual certificate of salary paid and tax deducted at source, per employee and
 * financial year (April–March). Built only from FINALISED payroll runs, so it always matches the
 * payslips issued. Part A summarises tax deducted per quarter; Part B computes taxable salary
 * under the chosen regime using the confirmed TDS settings.
 *
 * It is a working certificate from payroll records: the TRACES-issued Part A (with challan and
 * BIN details) remains the authoritative document for filing.
 */
import { z } from 'zod';
import { AppError, Dec, createTemplateEngine, dec, money, notFound, renderPdf, toIsoDate, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { config } from '../config';
import { getSettings } from '../settings';
import { MONTHS } from '../payroll/service';
import { annualTax } from '../statutory/rules';
import { sendPdf } from '../output/report-export';
import { DEFAULT_LOGO_DATA_URL } from '../output/brand-logo';

const QUARTERS = [
  { label: 'Q1 (Apr–Jun)', months: [4, 5, 6] },
  { label: 'Q2 (Jul–Sep)', months: [7, 8, 9] },
  { label: 'Q3 (Oct–Dec)', months: [10, 11, 12] },
  { label: 'Q4 (Jan–Mar)', months: [1, 2, 3] },
];
/** 80C limit applied to the employee PF contribution under the old regime. */
const SECTION_80C_LIMIT = 150000;

const fyMonths = (fy: number) => [...[4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ year: fy, month: m })), ...[1, 2, 3].map((m) => ({ year: fy + 1, month: m }))];
const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
const sum = (list: Dec[]) => list.reduce((a, b) => a.add(b), new Dec(0));
const refOf = (detail: unknown) => String((detail as Record<string, unknown> | null)?.formulaRef ?? '');
const isTds = (l: { componentCode: string; componentName: string; calcDetail: unknown }) => refOf(l.calcDetail) === 'STATUTORY_TDS' || /^TDS$/i.test(l.componentCode) || /income tax/i.test(l.componentName);
const isPf = (l: { componentCode: string; calcDetail: unknown }) => refOf(l.calcDetail) === 'STATUTORY_PF' || /^E?PF(_|$)/i.test(l.componentCode);
const isPt = (l: { componentCode: string; componentName: string }) => /^PT$/i.test(l.componentCode) || /professional tax/i.test(l.componentName);

export type Regime = 'NEW' | 'OLD';

export async function buildForm16(employeeId: string, fy: number, regime: Regime) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, include: { designation: true, department: true } });
  if (!employee) throw notFound('Employee');
  const periods = fyMonths(fy);
  const runs = await prisma.payrollRun.findMany({ where: { status: 'FINALISED', OR: periods.map((p) => ({ year: p.year, month: p.month })) } });
  const members = await prisma.payrollRunEmployee.findMany({ where: { employeeId, payrollRunId: { in: runs.map((r) => r.id) } } });
  const lines = await prisma.payrollLine.findMany({ where: { employeeId, payrollRunId: { in: members.map((m) => m.payrollRunId) } }, orderBy: [{ sortOrder: 'asc' }] });
  const settings = await getSettings();
  const tds = settings.statutory.tds;

  const monthly = periods.map((p) => {
    const run = runs.find((r) => r.year === p.year && r.month === p.month);
    const member = run && members.find((m) => m.payrollRunId === run.id);
    const mine = member ? lines.filter((l) => l.payrollRunId === run!.id) : [];
    const ded = mine.filter((l) => l.componentType === 'DEDUCTION');
    return {
      year: p.year,
      month: p.month,
      label: `${MONTHS[p.month - 1].slice(0, 3)} ${p.year}`,
      paid: Boolean(member),
      gross: member?.gross ? dec(member.gross.toString()) : new Dec(0),
      tds: sum(ded.filter(isTds).map((l) => dec(l.amount.toString()))),
      pf: sum(ded.filter(isPf).map((l) => dec(l.amount.toString()))),
      pt: sum(ded.filter(isPt).map((l) => dec(l.amount.toString()))),
      net: member?.net ? dec(member.net.toString()) : new Dec(0),
    };
  });
  if (!monthly.some((m) => m.paid)) throw new AppError('NOT_FOUND', `No finalised payroll for ${employee.fullName} in financial year ${fyLabel(fy)}.`);

  // Salary u/s 17(1), by component
  const byComponent = new Map<string, Dec>();
  for (const l of lines.filter((x) => x.componentType === 'EARNING')) byComponent.set(l.componentName, (byComponent.get(l.componentName) ?? new Dec(0)).add(dec(l.amount.toString())));
  const gross = sum(monthly.map((m) => m.gross));
  const totalTds = sum(monthly.map((m) => m.tds));
  const totalPf = sum(monthly.map((m) => m.pf));
  const totalPt = sum(monthly.map((m) => m.pt));
  const standardDeduction = Dec.min(gross, dec(String(tds.standardDeduction ?? 0)));
  const ptDeduction = regime === 'OLD' ? totalPt : new Dec(0);
  const incomeFromSalary = Dec.max(new Dec(0), gross.sub(standardDeduction).sub(ptDeduction));
  const section80C = regime === 'OLD' ? Dec.min(totalPf, new Dec(SECTION_80C_LIMIT)) : new Dec(0);
  const taxable = Dec.max(new Dec(0), incomeFromSalary.sub(section80C));
  const slabsConfigured = tds.slabs.length > 0;
  const taxOnIncome = slabsConfigured ? annualTax(taxable, tds) : null;

  const brand = settings.branding;
  const paidMonths = monthly.filter((m) => m.paid);
  const fyStart = new Date(Date.UTC(fy, 3, 1));
  const fyEnd = new Date(Date.UTC(fy + 1, 2, 31));
  return {
    financialYear: fyLabel(fy),
    assessmentYear: fyLabel(fy + 1),
    regime,
    employer: {
      name: brand.companyName || config.PAYSLIP_COMPANY_NAME,
      address: brand.address,
      pan: brand.employerPan,
      tan: brand.employerTan,
    },
    employee: {
      id: employee.id,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      designation: employee.designation?.name ?? null,
      department: employee.department?.name ?? null,
      pan: employee.panNumber,
      periodFrom: toIsoDate(employee.joiningDate > fyStart ? employee.joiningDate : fyStart),
      periodTo: toIsoDate(employee.exitDate && employee.exitDate < fyEnd ? employee.exitDate : fyEnd),
    },
    partA: {
      quarters: QUARTERS.map((q) => {
        const ms = monthly.filter((m) => q.months.includes(m.month));
        return { label: q.label, amountPaid: money(sum(ms.map((m) => m.gross))), taxDeducted: money(sum(ms.map((m) => m.tds))) };
      }),
      totalPaid: money(gross),
      totalTax: money(totalTds),
    },
    partB: {
      salaryComponents: [...byComponent.entries()].map(([name, amount]) => ({ name, amount: money(amount) })),
      grossSalary: money(gross),
      exemptions: money(new Dec(0)),
      standardDeduction: money(standardDeduction),
      professionalTax: money(ptDeduction),
      incomeFromSalary: money(incomeFromSalary),
      section80C: money(section80C),
      employeePf: money(totalPf),
      taxableIncome: money(taxable),
      taxOnIncome: taxOnIncome ? money(taxOnIncome) : null,
      tdsDeducted: money(totalTds),
      balance: taxOnIncome ? money(taxOnIncome.sub(totalTds)) : null,
    },
    months: monthly.map((m) => ({ label: m.label, paid: m.paid, gross: money(m.gross), tds: money(m.tds), pf: money(m.pf), pt: money(m.pt), net: money(m.net) })),
    monthsPaid: paidMonths.length,
    notes: [
      ...(slabsConfigured ? [] : ['Income-tax slabs are not configured in Statutory settings, so the tax on total income is not computed; only the TDS actually deducted is shown.']),
      'Exemptions u/s 10 (such as HRA) and Chapter VI-A declarations other than PF are not recorded in payroll and are shown as zero.',
      'Generated from finalised payroll. The TRACES-issued Part A remains the authoritative certificate for filing.',
    ],
  };
}

type Form16 = Awaited<ReturnType<typeof buildForm16>>;

const hb = createTemplateEngine();
const form16Template = hb.compile(`<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; font-size: 10.5px; margin: 0; }
  .bar { height: 6px; border-radius: 3px; background: linear-gradient(90deg, {{primary}}, {{accent}}); margin-bottom: 12px; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; }
  h1 { font-size: 20px; margin: 0; color: {{primary}}; }
  .sub { color: #4b5563; margin-top: 3px; }
  .logo { max-height: 44px; max-width: 190px; }
  h2 { font-size: 12px; color: {{primary}}; border-bottom: 2px solid {{primary}}; padding-bottom: 4px; margin: 16px 0 6px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #e5e7eb; padding: 4px 6px; text-align: left; }
  th { background: #f3f4f6; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .tot td { font-weight: bold; background: #f4f3fb; }
  .k { color: #6b7280; width: 22%; }
  .notes { margin-top: 12px; font-size: 9px; color: #6b7280; }
  .sign { margin-top: 28px; display: flex; justify-content: space-between; font-size: 10px; }
</style></head><body>
<div class="bar"></div>
<div class="top"><div><h1>FORM No. 16</h1><div class="sub">Certificate under section 203 of the Income-tax Act, 1961 for tax deducted at source on salary</div>
<div class="sub">Financial year {{f.financialYear}} · Assessment year {{f.assessmentYear}} · {{regimeLabel}}</div></div>
<img class="logo" src="{{logo}}" alt=""></div>
<h2>Employer and employee</h2>
<table>
<tr><td class="k">Employer</td><td>{{f.employer.name}}{{#if f.employer.address}}<br>{{nl2br f.employer.address}}{{/if}}</td><td class="k">Employee</td><td>{{f.employee.fullName}} ({{f.employee.employeeCode}}){{#if f.employee.designation}}<br>{{f.employee.designation}}{{/if}}</td></tr>
<tr><td class="k">PAN of deductor</td><td>{{or f.employer.pan}}</td><td class="k">PAN of employee</td><td>{{or f.employee.pan}}</td></tr>
<tr><td class="k">TAN of deductor</td><td>{{or f.employer.tan}}</td><td class="k">Period with employer</td><td>{{date f.employee.periodFrom}} to {{date f.employee.periodTo}}</td></tr>
</table>
<h2>Part A — tax deducted and deposited (quarterly)</h2>
<table><tr><th>Quarter</th><th class="num">Amount paid / credited</th><th class="num">Tax deducted</th></tr>
{{#each f.partA.quarters}}<tr><td>{{label}}</td><td class="num">{{money amountPaid}}</td><td class="num">{{money taxDeducted}}</td></tr>{{/each}}
<tr class="tot"><td>Total</td><td class="num">{{money f.partA.totalPaid}}</td><td class="num">{{money f.partA.totalTax}}</td></tr></table>
<h2>Part B — details of salary paid and tax deducted</h2>
<table>
<tr><td>1. Gross salary — salary as per section 17(1)</td><td class="num">{{money f.partB.grossSalary}}</td></tr>
{{#each f.partB.salaryComponents}}<tr><td>&nbsp;&nbsp;&nbsp;{{name}}</td><td class="num">{{money amount}}</td></tr>{{/each}}
<tr><td>2. Less: allowances exempt under section 10</td><td class="num">{{money f.partB.exemptions}}</td></tr>
<tr><td>3. Less: standard deduction u/s 16(ia)</td><td class="num">{{money f.partB.standardDeduction}}</td></tr>
<tr><td>4. Less: tax on employment (professional tax) u/s 16(iii)</td><td class="num">{{money f.partB.professionalTax}}</td></tr>
<tr class="tot"><td>5. Income chargeable under the head "Salaries"</td><td class="num">{{money f.partB.incomeFromSalary}}</td></tr>
<tr><td>6. Less: deduction u/s 80C (employee provident fund {{money f.partB.employeePf}})</td><td class="num">{{money f.partB.section80C}}</td></tr>
<tr class="tot"><td>7. Total taxable income</td><td class="num">{{money f.partB.taxableIncome}}</td></tr>
<tr><td>8. Tax on total income (including cess)</td><td class="num">{{#if f.partB.taxOnIncome}}{{money f.partB.taxOnIncome}}{{else}}Not computed{{/if}}</td></tr>
<tr><td>9. Tax deducted at source</td><td class="num">{{money f.partB.tdsDeducted}}</td></tr>
<tr class="tot"><td>10. Tax payable / (refundable)</td><td class="num">{{#if f.partB.balance}}{{money f.partB.balance}}{{else}}—{{/if}}</td></tr>
</table>
<h2>Month-wise salary and deductions</h2>
<table><tr><th>Month</th><th class="num">Gross</th><th class="num">PF</th><th class="num">Professional tax</th><th class="num">TDS</th><th class="num">Net paid</th></tr>
{{#each f.months}}{{#if paid}}<tr><td>{{label}}</td><td class="num">{{money gross}}</td><td class="num">{{money pf}}</td><td class="num">{{money pt}}</td><td class="num">{{money tds}}</td><td class="num">{{money net}}</td></tr>{{/if}}{{/each}}
</table>
<div class="notes">{{#each f.notes}}• {{this}}<br>{{/each}}</div>
<div class="sign"><div>Place: ____________<br>Date: {{today}}</div><div>Signature of the person responsible for deduction of tax<br><br>____________________________</div></div>
</body></html>`);
hb.registerHelper('or', (v: unknown) => (v === null || v === undefined || v === '' ? 'Not recorded' : String(v)));

async function renderForm16(f: Form16) {
  const brand = (await getSettings()).branding;
  const html = form16Template({ f, regimeLabel: f.regime === 'NEW' ? 'New tax regime (section 115BAC)' : 'Old tax regime', logo: brand.logoDataUrl ?? DEFAULT_LOGO_DATA_URL, primary: brand.primaryColor, accent: brand.accentColor, today: new Date().toISOString().slice(0, 10) });
  return renderPdf(html, { footerText: `Form 16 · FY ${f.financialYear} · ${f.employee.employeeCode}` });
}

const fyQuery = z.object({ fy: z.coerce.number().int().min(2000).max(2100), regime: z.enum(['NEW', 'OLD']).default('NEW') });

async function myEmployeeId(user: AuthUser) {
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } });
  if (!u?.employeeId) throw new AppError('INVALID_STATE', 'Your account is not linked to an employee record yet.');
  return u.employeeId;
}

/** Financial years that have at least one finalised payroll run, newest first. */
async function financialYears(employeeId?: string) {
  const runs = await prisma.payrollRun.findMany({ where: { status: 'FINALISED', ...(employeeId ? { employees: { some: { employeeId } } } : {}) }, select: { year: true, month: true } });
  const years = [...new Set(runs.map((r) => (r.month >= 4 ? r.year : r.year - 1)))].sort((a, b) => b - a);
  return years.map((fy) => ({ fy, label: `FY ${fyLabel(fy)}` }));
}

export function registerForm16Routes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/form16/years',
    tag: 'Form 16',
    summary: 'Financial years with finalised payroll',
    permission: 'reports.view',
    handler: () => financialYears(),
  });

  r.add({
    method: 'get',
    path: '/form16/employees',
    tag: 'Form 16',
    summary: 'Employees paid in a financial year with their total salary and TDS',
    permission: 'reports.view',
    query: fyQuery,
    handler: async ({ query }) => {
      const runs = await prisma.payrollRun.findMany({ where: { status: 'FINALISED', OR: fyMonths(query.fy).map((p) => ({ year: p.year, month: p.month })) }, select: { id: true } });
      const ids = runs.map((x) => x.id);
      const [members, lines] = await Promise.all([
        prisma.payrollRunEmployee.findMany({ where: { payrollRunId: { in: ids } }, include: { employee: { select: { panNumber: true } } } }),
        prisma.payrollLine.findMany({ where: { payrollRunId: { in: ids }, componentType: 'DEDUCTION' } }),
      ]);
      const out = new Map<string, { employeeId: string; employeeCode: string; employeeName: string; pan: string | null; months: number; gross: Dec; tds: Dec }>();
      for (const m of members) {
        const row = out.get(m.employeeId) ?? { employeeId: m.employeeId, employeeCode: m.employeeCode, employeeName: m.employeeName, pan: m.employee.panNumber, months: 0, gross: new Dec(0), tds: new Dec(0) };
        row.months++;
        row.gross = row.gross.add(dec(m.gross?.toString() ?? '0'));
        out.set(m.employeeId, row);
      }
      for (const l of lines.filter(isTds)) {
        const row = out.get(l.employeeId);
        if (row) row.tds = row.tds.add(dec(l.amount.toString()));
      }
      return [...out.values()].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode)).map((x) => ({ ...x, gross: money(x.gross), tds: money(x.tds) }));
    },
  });

  r.add({
    method: 'get',
    path: '/form16/employees/:employeeId',
    tag: 'Form 16',
    summary: 'Form 16 for one employee and financial year (JSON)',
    permission: 'reports.view',
    params: z.object({ employeeId: z.string().uuid() }),
    query: fyQuery,
    handler: ({ params, query }) => buildForm16(params.employeeId, query.fy, query.regime),
  });

  r.add({
    method: 'get',
    path: '/form16/employees/:employeeId/pdf',
    tag: 'Form 16',
    summary: 'Form 16 for one employee and financial year (PDF)',
    permission: 'reports.view',
    produces: 'pdf',
    params: z.object({ employeeId: z.string().uuid() }),
    query: fyQuery,
    handler: async ({ params, query, res, user, ip }) => {
      const f = await buildForm16(params.employeeId, query.fy, query.regime);
      const pdf = await renderForm16(f);
      await audit.write({ actorId: user.id, action: 'form16.downloaded', entity: 'employee', entityId: params.employeeId, metadata: { fy: f.financialYear }, ip });
      sendPdf(res, pdf, `form16-${f.employee.employeeCode}-FY${f.financialYear}.pdf`, false);
    },
  });

  // ------------------------------------------------------------- Self-service (own record only)
  r.add({
    method: 'get',
    path: '/me/form16/years',
    tag: 'Self-service',
    summary: 'Financial years in which I was paid through finalised payroll',
    permission: 'self.service',
    handler: async ({ user }) => financialYears(await myEmployeeId(user)),
  });

  r.add({
    method: 'get',
    path: '/me/form16',
    tag: 'Self-service',
    summary: 'My Form 16 for a financial year',
    permission: 'self.service',
    query: fyQuery,
    handler: async ({ user, query }) => buildForm16(await myEmployeeId(user), query.fy, query.regime),
  });

  r.add({
    method: 'get',
    path: '/me/form16/pdf',
    tag: 'Self-service',
    summary: 'Download my Form 16 (PDF)',
    permission: 'self.service',
    produces: 'pdf',
    query: fyQuery,
    handler: async ({ user, query, res, ip }) => {
      const f = await buildForm16(await myEmployeeId(user), query.fy, query.regime);
      const pdf = await renderForm16(f);
      await audit.write({ actorId: user.id, action: 'self.form16_downloaded', entity: 'employee', entityId: f.employee.id, metadata: { fy: f.financialYear }, ip });
      sendPdf(res, pdf, `form16-${f.employee.employeeCode}-FY${f.financialYear}.pdf`, false);
    },
  });
}
