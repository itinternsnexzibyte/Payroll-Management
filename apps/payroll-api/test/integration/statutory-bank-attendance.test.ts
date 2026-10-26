/**
 * Statutory payroll (PF, ESI, TDS), employee bank details with the bank salary file, and live
 * attendance sync. Rates used here are test fixtures only — the application ships with none.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request, { type Agent } from 'supertest';
import { prisma, Prisma } from '../../src/db';
import { setBankKeyForTests } from '../../src/bank/crypto';
import { app, login, ORIGIN, PASSWORD, resetDb, seedMasters } from '../helpers';
import { createUser } from '../../src/bootstrap';

let admin: Agent;
let user: Agent;
let m: Awaited<ReturnType<typeof seedMasters>>;
const emp: Record<string, string> = {};
let aprilRun: string;
let mayRun: string;

const post = (a: Agent, path: string, body?: object) => a.post(path).set('Origin', ORIGIN).send(body ?? {});
const put = (a: Agent, path: string, body: object) => a.put(path).set('Origin', ORIGIN).send(body);

const statutory = {
  confirmedBy: 'Test Payroll Lead',
  confirmedOn: '2026-04-01',
  reference: 'Test fixture',
  pf: { enabled: true, employeeRatePercent: 12, employerRatePercent: 12, wageComponents: ['BASIC'], wageCeiling: 15000, capAtCeiling: true },
  esi: { enabled: true, employeeRatePercent: 0.75, employerRatePercent: 3.25, wageComponents: ['BASIC'], eligibilityLimit: 21000 },
  tds: {
    enabled: true,
    taxableComponents: ['BASIC'],
    standardDeduction: 50000,
    slabs: [{ upTo: 300000, ratePercent: 0 }, { upTo: 700000, ratePercent: 5 }, { upTo: null, ratePercent: 10 }],
    rebateLimit: null,
    cessPercent: 4,
    overrideInputKey: 'TDS_OVERRIDE',
  },
};

beforeAll(async () => {
  await resetDb();
  m = await seedMasters();
  for (const key of ['TDS_OVERRIDE', 'DAYS_WORKED']) await prisma.payrollInputDefinition.create({ data: { key, label: key, dataType: 'NUMBER', minValue: new Prisma.Decimal(0) } });
  admin = await login('admin@test.local');
  user = await login('user@test.local');
  for (const [key, code, name, basic] of [['a', 'E-1', 'Asha Rao', '20000'], ['b', 'E-2', 'Vikram Singh', '100000']]) {
    const res = await post(admin, '/employees', { employeeCode: code, fullName: name, joiningDate: '2026-01-01', departmentId: m.dept.id });
    emp[key] = res.body.id;
    await post(admin, `/employees/${res.body.id}/salary`, { effectiveFrom: '2026-01-01', changeReason: 'Initial', values: [{ componentId: m.basic.id, value: basic }] });
  }
  setBankKeyForTests(randomBytes(32));
});
afterAll(() => setBankKeyForTests(undefined));

const lineOf = async (runId: string, employeeId: string, code: string) =>
  prisma.payrollLine.findFirst({ where: { payrollRunId: runId, employeeId, componentCode: code } });

describe('statutory payroll', () => {
  it('ships with every statutory section off and no rates', async () => {
    const res = await admin.get('/statutory');
    expect(res.status).toBe(200);
    expect(res.body.settings.pf).toMatchObject({ enabled: false, employeeRatePercent: null });
    expect(res.body.settings.tds.slabs).toEqual([]);
  });

  it('refuses to switch a section on until it is complete and confirmed', async () => {
    const res = await put(admin, '/statutory', { ...statutory, confirmedBy: null, pf: { ...statutory.pf, employeeRatePercent: null } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/confirmed/);
    expect(res.body.error.message).toMatch(/Employee PF rate is required/);
    const slabs = await put(admin, '/statutory', { ...statutory, tds: { ...statutory.tds, slabs: [{ upTo: 300000, ratePercent: 0 }] } });
    expect(slabs.body.error.message).toMatch(/last tax slab/);
    expect((await put(user, '/statutory', statutory)).status).toBe(403);
  });

  it('creates the deduction components once', async () => {
    for (const kind of ['PF', 'ESI', 'TDS']) expect((await post(admin, '/statutory/components', { kind })).status).toBe(200);
    expect((await post(admin, '/statutory/components', { kind: 'PF' })).status).toBe(409);
    const comps = (await admin.get('/salary-components')).body.items.filter((c: { formulaStatus: string }) => c.formulaStatus === 'STATUTORY');
    expect(comps.map((c: { code: string }) => c.code).sort()).toEqual(['ESI_EMPLOYEE', 'PF_EMPLOYEE', 'TDS']);
  });

  it('adds nothing while switched off', async () => {
    aprilRun = (await post(admin, '/payroll-runs', { year: 2026, month: 4 })).body.id;
    expect((await post(admin, `/payroll-runs/${aprilRun}/calculate`)).status).toBe(200);
    expect(await lineOf(aprilRun, emp.a, 'PF_EMPLOYEE')).toBeNull();
  });

  it('calculates PF, ESI and TDS from the confirmed settings for every employee', async () => {
    expect((await put(admin, '/statutory', statutory)).status).toBe(200);
    // The settings changed after calculation, so the run is stale until recalculated.
    const stale = await post(admin, `/payroll-runs/${aprilRun}/submit-review`, { acknowledgeWarnings: true });
    expect(stale.status).toBe(409);
    expect(stale.body.error.reason).toBe('STALE_CALCULATION');
    await put(admin, `/payroll-runs/${aprilRun}/inputs`, { entries: [{ employeeId: emp.a, inputKey: 'TDS_OVERRIDE', value: '999' }] });
    expect((await post(admin, `/payroll-runs/${aprilRun}/calculate`)).status).toBe(200);

    const pfA = await lineOf(aprilRun, emp.a, 'PF_EMPLOYEE');
    expect(pfA?.amount.toString()).toBe('1800'); // 12% of BASIC 20000 capped at 15000
    expect(pfA?.calcDetail).toMatchObject({ pfWages: '15000.00', employerContribution: '1800.00', formulaRef: 'STATUTORY_PF' });
    expect((await lineOf(aprilRun, emp.a, 'ESI_EMPLOYEE'))?.amount.toString()).toBe('150'); // 0.75% of 20000 (≤ 21000)
    expect((await lineOf(aprilRun, emp.b, 'ESI_EMPLOYEE'))?.amount.toString()).toBe('0'); // above the limit
    expect((await lineOf(aprilRun, emp.a, 'TDS'))?.amount.toString()).toBe('999'); // override input
    // E-2: 100000 × 12 − 50000 = 1150000 → 0 + 5% × 400000 + 10% × 450000 = 65000, + 4% cess = 67600, ÷ 12
    expect((await lineOf(aprilRun, emp.b, 'TDS'))?.amount.toString()).toBe('5633.33');
    const b = await prisma.payrollRunEmployee.findFirstOrThrow({ where: { payrollRunId: aprilRun, employeeId: emp.b } });
    expect(b.net?.toString()).toBe(new Prisma.Decimal('100000').sub('1800').sub('0').sub('5633.33').toString());
  });

  it('reports wages, employee and employer contributions', async () => {
    const rep = await admin.get(`/reports/statutory?runId=${aprilRun}`);
    expect(rep.status).toBe(200);
    const a = rep.body.rows.find((r: { code: string }) => r.code === 'E-1');
    expect(a).toMatchObject({ pfWages: '15000.00', pfEmployee: '1800', pfEmployer: '1800.00', esiEmployee: '150', esiEmployer: '650.00', tds: '999', tdsMethod: 'override input' });
    expect(rep.body.totals).toMatchObject({ pfEmployee: '3600.00', tds: '6632.33' });
    expect((await admin.get(`/reports/statutory?runId=${aprilRun}&format=xlsx`)).status).toBe(200);
  });

  it('cannot be changed through the general settings endpoint', async () => {
    await put(admin, '/settings', { statutory: { ...statutory, pf: { ...statutory.pf, employeeRatePercent: 50 } } });
    expect((await admin.get('/statutory')).body.settings.pf.employeeRatePercent).toBe(12);
  });
});

describe('bank details and bank salary file', () => {
  it('stores the account number encrypted and shows only the last four digits', async () => {
    expect((await put(admin, `/employees/${emp.a}/bank`, { accountHolder: 'Asha Rao', accountNumber: '0012 3456 7890', ifsc: 'bad' })).status).toBe(400);
    const res = await put(admin, `/employees/${emp.a}/bank`, { accountHolder: 'Asha Rao', accountNumber: '0012 3456 7890', ifsc: 'abcd0123456', bankName: 'Test Bank' });
    expect(res.status).toBe(200);
    expect(res.body.bank).toMatchObject({ accountNumberMasked: '•••• 7890', ifsc: 'ABCD0123456' });
    expect(JSON.stringify(res.body)).not.toContain('001234567890');
    const row = await prisma.employeeBankAccount.findUniqueOrThrow({ where: { employeeId: emp.a } });
    expect(row.accountNumberEnc).toMatch(/^v1:/);
    expect(row.accountNumberEnc).not.toContain('001234567890');
    const logs = await prisma.auditLog.findMany({ where: { entityId: emp.a, action: { startsWith: 'bank_account' } } });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs.map((l) => [l.before, l.after, l.metadata]))).not.toContain('001234567890');
    expect((await admin.get('/bank/accounts')).body.items.find((i: { employeeCode: string }) => i.employeeCode === 'E-1').bank.accountNumberMasked).toBe('•••• 7890');
  });

  it('keeps bank details from users without the bank permissions', async () => {
    expect((await user.get('/bank/accounts')).status).toBe(403);
    expect((await put(user, `/employees/${emp.a}/bank`, { accountHolder: 'X', accountNumber: '123456', ifsc: 'ABCD0123456' })).status).toBe(403);
    expect((await user.get(`/payroll-runs/${aprilRun}/bank-export?paymentDate=2026-04-30`)).status).toBe(403);
  });

  it('lets an employee add their own account, which the payroll team sees masked', async () => {
    const self = await prisma.employee.create({ data: { employeeCode: 'E-SELF', fullName: 'Self Service', joiningDate: new Date('2025-01-01T00:00:00Z') } });
    const account = await createUser('self.bank@test.local', 'Self Service', 'EMPLOYEE', PASSWORD, false);
    await prisma.user.update({ where: { id: account.id }, data: { employeeId: self.id } });
    const me = await login('self.bank@test.local');
    expect((await me.get('/me/bank')).body).toMatchObject({ keyConfigured: true, bank: null });
    expect((await put(me, '/me/bank', { accountHolder: 'Self Service', accountNumber: '555566667777', ifsc: 'bad' })).status).toBe(400);
    const res = await put(me, '/me/bank', { accountHolder: 'Self Service', accountNumber: '5555 6666 7777', ifsc: 'hdfc0001234', bankName: 'HDFC Bank' });
    expect(res.status).toBe(200);
    expect(res.body.bank).toMatchObject({ accountNumberMasked: '•••• 7777', ifsc: 'HDFC0001234' });
    expect(JSON.stringify((await me.get('/me/bank')).body)).not.toContain('555566667777');
    const items = (await admin.get('/bank/accounts')).body.items as { employeeCode: string; bank: { accountNumberMasked: string; enteredByEmployee: boolean } | null }[];
    expect(items.find((i) => i.employeeCode === 'E-SELF')!.bank).toMatchObject({ accountNumberMasked: '•••• 7777', enteredByEmployee: true });
    expect(items.find((i) => i.employeeCode === 'E-1')!.bank).toMatchObject({ enteredByEmployee: false });
    // Self-service reaches only the linked employee's own account.
    expect((await me.get('/bank/accounts')).status).toBe(403);
    expect((await put(me, `/employees/${emp.a}/bank`, { accountHolder: 'X', accountNumber: '123456', ifsc: 'ABCD0123456' })).status).toBe(403);
  });

  it('is switched off without an encryption key', async () => {
    setBankKeyForTests(null);
    const res = await put(admin, `/employees/${emp.b}/bank`, { accountHolder: 'Vikram Singh', accountNumber: '998877665544', ifsc: 'WXYZ0654321' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/BANK_DATA_KEY/);
    setBankKeyForTests(randomBytes(32));
  });

  it('generates the file only for finalised payroll and names who is missing', async () => {
    expect((await admin.get(`/payroll-runs/${aprilRun}/bank-export?paymentDate=2026-04-30`)).status).toBe(409);
    await post(admin, `/payroll-runs/${aprilRun}/submit-review`, { acknowledgeWarnings: true });
    await post(admin, `/payroll-runs/${aprilRun}/approve`);
    expect((await post(admin, `/payroll-runs/${aprilRun}/finalise`)).status).toBe(200);
    // The key used to store E-1's account was replaced above, so store it again with the current key.
    await put(admin, `/employees/${emp.a}/bank`, { accountHolder: 'Asha Rao', accountNumber: '001234567890', ifsc: 'ABCD0123456' });
    const preview = await admin.get(`/payroll-runs/${aprilRun}/bank-export/preview`);
    expect(preview.body).toMatchObject({ ready: true, employees: 1, missing: [{ employeeCode: 'E-2' }] });
    const blocked = await admin.get(`/payroll-runs/${aprilRun}/bank-export?paymentDate=2026-04-30`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toMatch(/E-2/);
  });

  it('writes the configured layout with full account numbers and logs the export', async () => {
    const res = await admin.get(`/payroll-runs/${aprilRun}/bank-export?paymentDate=2026-04-30&skipMissing=true`).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const text = res.text ?? res.body.toString();
    const net = (await prisma.payrollRunEmployee.findFirstOrThrow({ where: { payrollRunId: aprilRun, employeeId: emp.a } })).net!.toFixed(2);
    expect(text.split('\r\n')).toEqual([
      'Employee ID,Beneficiary Name,Account Number,IFSC,Amount,Payment Date,Narration',
      `E-1,Asha Rao,001234567890,ABCD0123456,${net},30/04/2026,Salary April 2026`,
      '',
    ]);
    const exp = await prisma.bankExport.findFirstOrThrow({ where: { payrollRunId: aprilRun } });
    expect(exp).toMatchObject({ employeeCount: 1, skippedCount: 1, format: 'CSV' });
    await expect(prisma.bankExport.update({ where: { id: exp.id }, data: { employeeCount: 9 } })).rejects.toThrow(/append-only/);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'bank_file.generated' } });
    expect(JSON.stringify([log.before, log.after, log.metadata])).not.toContain('001234567890');
  });

  it('supports other layouts', async () => {
    const layout = { format: 'XLSX', includeHeader: true, dateFormat: 'DDMMYYYY', columns: [{ header: 'Txn', field: 'FIXED', value: 'NEFT' }, { header: 'Acct', field: 'ACCOUNT_NUMBER', value: null }, { header: 'Amt', field: 'NET_PAY', value: null }] };
    expect((await put(user, '/bank/layout', layout)).status).toBe(403);
    expect((await put(admin, '/bank/layout', layout)).status).toBe(200);
    const res = await admin.get(`/payroll-runs/${aprilRun}/bank-export?paymentDate=2026-04-30&skipMissing=true`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  });
});

describe('live attendance sync', () => {
  let key: string;
  let keyId: string;
  const push = (body: object, token = key) => request(app).post('/integrations/attendance').set('Authorization', `Bearer ${token}`).send(body);

  it('issues API keys shown once and stores only a hash', async () => {
    expect((await post(user, '/attendance-sync/keys', { name: 'x' })).status).toBe(403);
    const res = await post(admin, '/attendance-sync/keys', { name: 'Attendance app' });
    expect(res.status).toBe(201);
    key = res.body.key;
    keyId = res.body.id;
    expect(key).toMatch(/^nzatt_[0-9a-f]{8}\./);
    const row = await prisma.integrationKey.findUniqueOrThrow({ where: { id: keyId } });
    expect(row.keyHash).not.toContain(key);
    expect((await admin.get('/attendance-sync')).body.keys[0]).not.toHaveProperty('key');
  });

  it('rejects unknown keys, a switched-off sync, and cookie requests without an origin', async () => {
    mayRun = (await post(admin, '/payroll-runs', { year: 2026, month: 5 })).body.id;
    const body = { year: 2026, month: 5, records: [{ employeeCode: 'E-1', values: { present_days: 22 } }] };
    expect((await push(body, 'nzatt_00000000.wrong')).status).toBe(401);
    expect((await push(body)).status).toBe(409);
    expect((await admin.post('/integrations/attendance').send(body)).status).toBe(403);
  });

  it('validates the field mapping', async () => {
    expect((await put(admin, '/attendance-sync/settings', { enabled: true, autoApply: false, fieldMap: [{ source: 'present_days', inputKey: 'NOPE' }] })).status).toBe(400);
    expect((await put(admin, '/attendance-sync/settings', { enabled: true, autoApply: false, fieldMap: [{ source: 'present_days', inputKey: 'DAYS_WORKED' }] })).status).toBe(200);
  });

  it('receives a batch once, previews it and applies it through input validation', async () => {
    const body = { batchId: 'may-1', year: 2026, month: 5, records: [{ employeeCode: 'E-1', values: { present_days: 22, late_marks: 1 } }, { employeeCode: 'E-404', values: { present_days: 20 } }] };
    const first = await push(body);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ duplicate: false, batch: { status: 'RECEIVED', recordCount: 2 } });
    expect((await push(body)).body).toMatchObject({ duplicate: true, batch: { id: first.body.batch.id } });

    const preview = await admin.get(`/attendance-sync/batches/${first.body.batch.id}`);
    expect(preview.body.preview).toMatchObject({ writes: [{ inputKey: 'DAYS_WORKED', value: '22' }], problems: [{ employeeCode: 'E-404' }], unmappedFields: ['late_marks'] });
    expect(await prisma.payrollInput.count({ where: { payrollRunId: mayRun } })).toBe(0);

    const applied = await post(admin, `/attendance-sync/batches/${first.body.batch.id}/apply`);
    expect(applied.body).toMatchObject({ status: 'PARTIAL', saved: 1 });
    expect((await prisma.payrollInput.findFirstOrThrow({ where: { payrollRunId: mayRun, employeeId: emp.a, inputKey: 'DAYS_WORKED' } })).value).toBe('22');
    // A partly applied batch can be retried (e.g. after adding the missing employee).
    expect((await post(admin, `/attendance-sync/batches/${first.body.batch.id}/apply`)).body).toMatchObject({ status: 'PARTIAL' });
  });

  it('auto-applies when switched on, but never to finalised payroll', async () => {
    await put(admin, '/attendance-sync/settings', { enabled: true, autoApply: true, fieldMap: [{ source: 'present_days', inputKey: 'DAYS_WORKED' }] });
    const ok = await push({ year: 2026, month: 5, records: [{ employeeCode: 'E-2', values: { present_days: '-3' } }, { employeeCode: 'E-1', values: { present_days: 21 } }] });
    expect(ok.body.batch).toMatchObject({ status: 'PARTIAL', appliedCount: 1 });
    expect(ok.body.batch.errors[0]).toMatchObject({ employeeCode: 'E-2', field: 'DAYS_WORKED' });
    const locked = await push({ year: 2026, month: 4, records: [{ employeeCode: 'E-1', values: { present_days: 20 } }] });
    expect(locked.body.batch.status).toBe('RECEIVED');
    expect(locked.body.batch.errors[0].message).toMatch(/finalised/);
    expect(await prisma.payrollInput.count({ where: { payrollRunId: aprilRun, inputKey: 'DAYS_WORKED' } })).toBe(0);
  });

  it('stops accepting a revoked key', async () => {
    expect((await post(admin, `/attendance-sync/keys/${keyId}/revoke`)).status).toBe(200);
    expect((await push({ year: 2026, month: 5, records: [{ employeeCode: 'E-1', values: { present_days: 1 } }] })).status).toBe(401);
  });
});
