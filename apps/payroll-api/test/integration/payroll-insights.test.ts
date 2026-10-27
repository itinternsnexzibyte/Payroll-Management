/**
 * Template-generated salaries, the PF / ESI wage band, automatic payroll, the branded payslip,
 * Form 16, the organisation structure and the payroll intelligence tools (digital twin, explainer,
 * fraud investigation, policy lab, readiness monitor). Rates used here are test fixtures only.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { prisma, Prisma } from '../../src/db';
import { setBankKeyForTests } from '../../src/bank/crypto';
import { payslipData } from '../../src/output/routes';
import { login, ORIGIN, resetDb } from '../helpers';

let admin: Agent;
const emp: Record<string, string> = {};
let runId: string;

const post = (a: Agent, path: string, body?: object) => a.post(path).set('Origin', ORIGIN).send(body ?? {});
const put = (a: Agent, path: string, body: object) => a.put(path).set('Origin', ORIGIN).send(body);
const lines = async (employeeId: string) =>
  Object.fromEntries((await prisma.payrollLine.findMany({ where: { payrollRunId: runId, employeeId } })).map((l) => [l.componentCode, l.amount.toString()]));

beforeAll(async () => {
  await resetDb();
  setBankKeyForTests(randomBytes(32));
  const dept = await prisma.department.create({ data: { name: 'Engineering' } });
  await prisma.salaryComponent.create({ data: { code: 'BASIC', name: 'Basic', type: 'EARNING', basis: 'FIXED', sortOrder: 1 } });
  await prisma.salaryComponent.create({ data: { code: 'HRA', name: 'HRA', type: 'EARNING', basis: 'PERCENTAGE', percentOfCode: 'BASIC', defaultPercentage: new Prisma.Decimal(40), sortOrder: 2 } });
  await prisma.salaryComponent.create({ data: { code: 'SPECIAL', name: 'Special Allowance', type: 'EARNING', basis: 'FIXED', sortOrder: 3 } });
  await prisma.salaryComponent.create({ data: { code: 'PT', name: 'Professional Tax', type: 'DEDUCTION', basis: 'FIXED', sortOrder: 20 } });
  // A plain "12% of basic" PF, as many installations start with; the standard setup converts it.
  await prisma.salaryComponent.create({ data: { code: 'PF', name: 'Provident Fund', type: 'DEDUCTION', basis: 'PERCENTAGE', percentOfCode: 'BASIC', defaultPercentage: new Prisma.Decimal(12), sortOrder: 10 } });
  admin = await login('admin@test.local');
  for (const [key, code, name] of [['lead', 'T-1', 'Team Lead'], ['low', 'T-2', 'Low Earner'], ['high', 'T-3', 'High Earner']]) {
    const res = await post(admin, '/employees', { employeeCode: code, fullName: name, joiningDate: '2026-01-01', departmentId: dept.id });
    expect(res.status).toBe(201);
    emp[key] = res.body.id;
  }
});
afterAll(() => setBankKeyForTests(undefined));

describe('automatic salary structures', () => {
  it('previews the split of a monthly gross or annual CTC', async () => {
    const res = await post(admin, '/salary-template/preview', { annualCtc: 1_500_000 });
    expect(res.status).toBe(200);
    expect(res.body.problems).toEqual([]);
    expect(res.body.lines.map((l: { code: string; amount: string }) => [l.code, l.amount])).toEqual([
      ['BASIC', '62500.00'],
      ['HRA', '25000.00'],
      ['SPECIAL', '37500.00'],
      ['PT', '200.00'],
    ]);
  });

  it('creates salary versions from a gross, recording the gross', async () => {
    for (const [key, gross] of [['lead', 200000], ['low', 18000], ['high', 125000]] as const) {
      const res = await post(admin, `/employees/${emp[key]}/salary/auto`, { monthlyGross: gross, effectiveFrom: '2026-01-01', changeReason: 'Initial structure' });
      expect(res.status).toBe(201);
      expect(res.body.monthlyGross).toBe(String(gross));
    }
    const v = await prisma.salaryVersion.findFirstOrThrow({ where: { employeeId: emp.low }, include: { values: { include: { component: true } } } });
    expect(Object.fromEntries(v.values.map((x) => [x.component.code, x.value.toString()]))).toEqual({ BASIC: '9000', HRA: '40', SPECIAL: '5400', PT: '200' });
  });
});

describe('organisation structure', () => {
  it('sets reporting managers and refuses loops', async () => {
    expect((await put(admin, `/employees/${emp.low}/manager`, { managerId: emp.lead })).status).toBe(200);
    expect((await put(admin, `/employees/${emp.high}/manager`, { managerId: emp.lead })).status).toBe(200);
    const loop = await put(admin, `/employees/${emp.lead}/manager`, { managerId: emp.low });
    expect(loop.status).toBe(400);
    expect(loop.body.error.message).toMatch(/loop/);
    const org = await admin.get('/organization');
    expect(org.body.stats).toMatchObject({ headcount: 3, managers: 1, levels: 2, topLevel: 1 });
    expect(org.body.people.find((p: { id: string }) => p.id === emp.lead).directReports).toBe(2);
  });

  it('keeps PAN, UAN and PF number on the employee', async () => {
    const e = (await admin.get(`/employees/${emp.high}`)).body;
    const res = await put(admin, `/employees/${emp.high}`, { ...e, departmentId: e.department.id, designationId: null, managerId: emp.lead, panNumber: 'abcde1234f', uanNumber: '102242295762', pfNumber: 'APKKP0068871' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ panNumber: 'ABCDE1234F', uanNumber: '102242295762', manager: { id: emp.lead } });
    expect((await put(admin, `/employees/${emp.high}`, { ...e, departmentId: e.department.id, panNumber: 'BAD' })).status).toBe(400);
  });
});

describe('PF / ESI wage band and automatic payroll', () => {
  it('applies standard PF and ESI with the band and converts the plain PF component', async () => {
    const res = await post(admin, '/statutory/standard-setup', { threshold: 20000 });
    expect(res.status).toBe(200);
    expect(res.body.settings.wageBand).toEqual({ enabled: true, threshold: 20000 });
    expect(res.body.problems).toEqual({ PF: [], ESI: [], TDS: [] });
    expect(await prisma.salaryComponent.findUnique({ where: { code: 'PF' } })).toMatchObject({ basis: 'FORMULA', formulaRef: 'STATUTORY_PF' });
    expect(await prisma.salaryComponent.findFirst({ where: { formulaRef: 'STATUTORY_ESI' } })).not.toBeNull();
  });

  it('creates, fills and calculates the month in one step', async () => {
    const res = await post(admin, '/payroll-runs/auto', { year: 2026, month: 9 });
    expect(res.status).toBe(200);
    runId = res.body.runId;
    expect(res.body.steps.map((s: { step: string; status: string }) => [s.step, s.status])).toEqual([
      ['Create payroll run', 'DONE'],
      ['Apply attendance', 'SKIPPED'],
      ['Fill leave, advances and bonuses', 'SKIPPED'],
      ['Calculate', 'DONE'],
    ]);
    expect(res.body.result).toMatchObject({ ok: 3, error: 0 });
    // Gross 18,000 is at or below the band: ESI and no PF. Above it: PF and no ESI.
    expect(await lines(emp.low)).toMatchObject({ BASIC: '9000', PF: '0', ESI_EMPLOYEE: '135' });
    expect(await lines(emp.high)).toMatchObject({ BASIC: '62500', PF: '1800', ESI_EMPLOYEE: '0' });
    const again = await post(admin, '/payroll-runs/auto', { year: 2026, month: 9 });
    expect(again.body.steps[0].status).toBe('SKIPPED');
  });

  it('records pay days and employer costs, including gratuity', async () => {
    const m = await prisma.payrollRunEmployee.findFirstOrThrow({ where: { payrollRunId: runId, employeeId: emp.high } });
    expect(m.calcSummary).toMatchObject({ daysInMonth: 30, employedDays: 30, payableDays: '30', employerPf: '1800.00', employerEsi: '0.00', gratuity: '3006.25' });
  });
});

describe('branded payslip', () => {
  it('separates contributions from other deductions and writes net pay in words', async () => {
    await put(admin, '/settings', { branding: { companyName: 'Technogen India Pvt Ltd', address: 'Gachibowli, Hyderabad', logoDataUrl: null, primaryColor: '#123456', accentColor: '#654321', employerPan: 'AAACT1234A', employerTan: 'HYDT01234A' } });
    const d = await payslipData(runId, [emp.high]);
    expect(d).toMatchObject({ companyName: 'Technogen India Pvt Ltd', primaryColor: '#123456', periodShort: 'SEP 2026' });
    expect(d.logoDataUrl).toMatch(/^data:image\/png;base64,/);
    const s = d.slips[0];
    expect(s.contributions).toEqual([{ name: 'Provident Fund', amount: '1800' }]);
    expect(s.deductions).toEqual([{ name: 'Professional Tax', amount: '200' }]);
    expect(s).toMatchObject({ pan: 'ABCDE1234F', uan: '102242295762', manager: 'Team Lead', gross: '125000', net: '123000', netInWords: 'One Lakh Twenty Three Thousand Rupees only' });
    expect(s.employer).toMatchObject({ pf: '1800.00', gratuity: '3006.25', ctc: '129806.25' });
  });
});

describe('payroll intelligence', () => {
  it('explains every line and verifies it against a fresh calculation', async () => {
    const res = await admin.get(`/payroll-runs/${runId}/employees/${emp.high}/explain`);
    expect(res.status).toBe(200);
    expect(res.body.verification.status).toBe('MATCH');
    const pf = res.body.lines.find((l: { componentCode: string }) => l.componentCode === 'PF');
    expect(pf.steps.join(' ')).toMatch(/PF applies/);
    expect(res.body.salaryVersion.monthlyGross).toBe('125000');
    expect(await prisma.auditLog.count({ where: { action: 'payroll.explained' } })).toBe(1);
  });

  it('simulates a scenario without touching payroll', async () => {
    const before = await prisma.payrollLine.count();
    const res = await post(admin, '/simulator/run', { year: 2026, month: 9, horizonMonths: 12, incrementPercent: 10, newHires: [{ label: 'Engineer', department: 'Engineering', count: 2, monthlyGross: 50000 }] });
    expect(res.status).toBe(200);
    expect(res.body.delta.headcount).toBe(2);
    expect(Number(res.body.delta.costToCompany)).toBeGreaterThan(0);
    expect(res.body.departments.map((d: { department: string }) => d.department)).toContain('Engineering');
    expect(await prisma.payrollLine.count()).toBe(before);
    const saved = await post(admin, '/simulator/scenarios', { name: 'Ten percent', config: { incrementPercent: 10 } });
    expect(saved.status).toBe(201);
  });

  it('tests a policy against a past month and flags who changes', async () => {
    const ctx = (await admin.get('/policy-lab/context')).body;
    const res = await post(admin, '/policy-lab/test', { source: { type: 'RUN', runId }, policy: { statutory: { ...ctx.settings.statutory, wageBand: { enabled: true, threshold: 10000 } } } });
    expect(res.status).toBe(200);
    const low = res.body.rows.find((r: { employeeCode: string }) => r.employeeCode === 'T-2');
    expect(low.flags.join(' ')).toMatch(/Statutory cover changes: ESI → PF/);
    expect(res.body.summary.employees).toBe(3);
  });

  it('finds employees paid into the same bank account', async () => {
    const account = { accountHolder: 'Same Person', accountNumber: '083248302006', ifsc: 'HSBC0500002', bankName: 'HSBC' };
    expect((await put(admin, `/employees/${emp.low}/bank`, account)).status).toBe(200);
    expect((await put(admin, `/employees/${emp.high}/bank`, { ...account, accountHolder: 'Someone Else' })).status).toBe(200);
    const res = await admin.get(`/fraud/scan?runId=${runId}`);
    expect(res.status).toBe(200);
    const shared = res.body.findings.find((f: { rule: string }) => f.rule === 'SHARED_BANK_ACCOUNT');
    expect(shared.severity).toBe('HIGH');
    expect(shared.employees.map((e: { id: string }) => e.id).sort()).toEqual([emp.low, emp.high].sort());
    expect(res.body.findings.some((f: { rule: string }) => f.rule === 'BANK_CHANGED_BEFORE_PAYROLL')).toBe(false); // changed after calculation
    const timeline = await admin.get(`/fraud/employees/${emp.low}/timeline`);
    expect(timeline.body.events.some((e: { title: string }) => e.title === 'bank_account.created')).toBe(true);
  });

  it('reports readiness for the month', async () => {
    const res = await admin.get('/readiness?year=2026&month=9');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.checks.map((c: { id: string; status: string }) => [c.id, c.status]));
    expect(byId).toMatchObject({ 'salary-structure': 'PASS', 'salary-automatic': 'PASS', statutory: 'PASS', run: 'PASS', 'run-errors': 'PASS', 'bank-details': 'FAIL' });
    expect(res.body.overall).toBe('BLOCKED');
  });
});

describe('Form 16', () => {
  it('builds the certificate from finalised payroll only', async () => {
    expect((await admin.get(`/form16/employees/${emp.high}?fy=2026`)).status).toBe(404);
    expect((await post(admin, `/payroll-runs/${runId}/submit-review`, { acknowledgeWarnings: true })).status).toBe(200);
    expect((await post(admin, `/payroll-runs/${runId}/approve`)).status).toBe(200);
    expect((await post(admin, `/payroll-runs/${runId}/finalise`)).status).toBe(200);
    expect((await admin.get('/form16/years')).body).toEqual([{ fy: 2026, label: 'FY 2026-27' }]);
    const res = await admin.get(`/form16/employees/${emp.high}?fy=2026&regime=OLD`);
    expect(res.status).toBe(200);
    expect(res.body.employer).toMatchObject({ pan: 'AAACT1234A', tan: 'HYDT01234A' });
    expect(res.body.partA.quarters[1]).toEqual({ label: 'Q2 (Jul–Sep)', amountPaid: '125000.00', taxDeducted: '0.00' });
    expect(res.body.partB).toMatchObject({ grossSalary: '125000.00', professionalTax: '200.00', employeePf: '1800.00', section80C: '1800.00' });
    const list = await admin.get('/form16/employees?fy=2026');
    expect(list.body.map((r: { employeeCode: string }) => r.employeeCode)).toEqual(['T-1', 'T-2', 'T-3']);
  });
});
