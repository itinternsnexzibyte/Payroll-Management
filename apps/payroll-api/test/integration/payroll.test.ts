import { beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { prisma } from '../../src/db';
import { login, ORIGIN, resetDb, seedMasters } from '../helpers';

let admin: Agent;
let user: Agent;
let masters: Awaited<ReturnType<typeof seedMasters>>;
let emp1: string;
let emp2: string;
let runId: string;

beforeAll(async () => {
  await resetDb();
  masters = await seedMasters();
  admin = await login('admin@test.local');
  user = await login('user@test.local');
});

const post = (a: Agent, path: string, body?: object) => a.post(path).set('Origin', ORIGIN).send(body ?? {});
const put = (a: Agent, path: string, body: object) => a.put(path).set('Origin', ORIGIN).send(body);

describe('employees and salary structures', () => {
  it('creates employees and detects duplicate IDs (case-insensitive)', async () => {
    const a = await post(admin, '/employees', { employeeCode: 'EMP-1', fullName: 'First Employee', departmentId: masters.dept.id, joiningDate: '2024-01-01' });
    expect(a.status).toBe(201);
    emp1 = a.body.id;
    const b = await post(admin, '/employees', { employeeCode: 'EMP-2', fullName: 'Second Employee', joiningDate: '2025-06-01' });
    emp2 = b.body.id;
    const dup = await post(admin, '/employees', { employeeCode: 'emp-1', fullName: 'Dup', joiningDate: '2024-01-01' });
    expect(dup.status).toBe(409);
  });

  it('versions salary structures without overwriting history', async () => {
    const v1 = await post(admin, `/employees/${emp1}/salary`, {
      effectiveFrom: '2024-01-01',
      changeReason: 'Initial structure',
      values: [
        { componentId: masters.basic.id, value: '20000' },
        { componentId: masters.pct.id, value: '10' },
        { componentId: masters.ded.id, value: '750.50' },
      ],
    });
    expect(v1.status).toBe(201);
    const v2 = await post(admin, `/employees/${emp1}/salary`, {
      effectiveFrom: '2026-10-01',
      changeReason: 'Increment',
      values: [
        { componentId: masters.basic.id, value: '25000' },
        { componentId: masters.pct.id, value: '10' },
      ],
    });
    expect(v2.status).toBe(201);
    expect(v2.body.versionNo).toBe(2);
    const backdated = await post(admin, `/employees/${emp1}/salary`, { effectiveFrom: '2025-01-01', changeReason: 'Backdated', values: [{ componentId: masters.basic.id, value: '1' }] });
    expect(backdated.status).toBe(400);
    const history = await admin.get(`/employees/${emp1}/salary-history`);
    expect(history.body).toHaveLength(2);
    expect(history.body[1].effectiveTo).toBe('2026-09-30');
    expect(history.body[0].changes.find((c: { code: string }) => c.code === 'BASIC')).toMatchObject({ from: '20000', to: '25000' });
    await post(admin, `/employees/${emp2}/salary`, { effectiveFrom: '2025-06-01', changeReason: 'Initial', values: [{ componentId: masters.basic.id, value: '15000.75' }] });
  });

  it('prevents salary changes by users without permission', async () => {
    const res = await post(user, `/employees/${emp1}/salary`, { effectiveFrom: '2027-01-01', changeReason: 'Unauthorised', values: [{ componentId: masters.basic.id, value: '99999' }] });
    expect(res.status).toBe(403);
  });
});

describe('monthly payroll lifecycle', () => {
  it('starts a run and blocks a duplicate run for the same month', async () => {
    const res = await post(user, '/payroll-runs', { year: 2026, month: 9 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    runId = res.body.id;
    const dup = await post(admin, '/payroll-runs', { year: 2026, month: 9 });
    expect(dup.status).toBe(409);
  });

  it('saves valid input cells and reports invalid ones without losing data', async () => {
    const res = await put(user, `/payroll-runs/${runId}/inputs`, {
      entries: [
        { employeeId: emp1, inputKey: 'BONUS_INPUT', value: '1000.10' },
        { employeeId: emp2, inputKey: 'BONUS_INPUT', value: '-5' },
      ],
    });
    expect(res.body.saved).toBe(1);
    expect(res.body.errors).toHaveLength(1);
    const grid = await user.get(`/payroll-runs/${runId}/inputs`);
    expect(grid.body.rows.find((r: { employeeId: string }) => r.employeeId === emp1).values.BONUS_INPUT).toBe('1000.10');
  });

  it('calculates on the server, deterministically', async () => {
    const first = await post(user, `/payroll-runs/${runId}/calculate`);
    expect(first.status).toBe(200);
    const second = await post(user, `/payroll-runs/${runId}/calculate`);
    expect(second.body.hash).toBe(first.body.hash);
    const det = await user.get(`/payroll-runs/${runId}`);
    const e1 = det.body.employees.find((e: { employeeId: string }) => e.employeeId === emp1);
    // Sept 2026 uses version 1 (rule MONTH_END; v2 starts 1 Oct)
    expect(e1.lines).toEqual({ BASIC: '20000', PCT: '2000', BONUS: '1000.1', DED: '750.5' });
    expect(e1.gross).toBe('23000.1');
    expect(e1.net).toBe('22249.6');
    expect(det.body.totalNet).toBe('37250.35');
    expect(det.body.rulesApproved).toBe(false);
  });

  it('enforces approval and finalisation permissions', async () => {
    expect((await post(user, `/payroll-runs/${runId}/submit-review`)).status).toBe(200);
    expect((await post(user, `/payroll-runs/${runId}/approve`)).status).toBe(403);
    expect((await post(admin, `/payroll-runs/${runId}/finalise`)).status).toBe(409); // approval step required first
    expect((await post(admin, `/payroll-runs/${runId}/approve`)).status).toBe(200);
  });

  it('finalises atomically; only one concurrent finalise succeeds', async () => {
    const results = await Promise.all([post(admin, `/payroll-runs/${runId}/finalise`), post(admin, `/payroll-runs/${runId}/finalise`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const events = await prisma.payrollRunEvent.count({ where: { payrollRunId: runId, action: 'FINALISED' } });
    expect(events).toBe(1);
  });

  it('makes finalised results immutable (API and database)', async () => {
    expect((await put(user, `/payroll-runs/${runId}/inputs`, { entries: [{ employeeId: emp1, inputKey: 'BONUS_INPUT', value: '1' }] })).status).toBe(409);
    expect((await post(admin, `/payroll-runs/${runId}/calculate`)).status).toBe(409);
    await expect(prisma.payrollLine.updateMany({ where: { payrollRunId: runId }, data: { amount: 1 } })).rejects.toThrow(/finalised/);
    await expect(prisma.payrollLine.deleteMany({ where: { payrollRunId: runId } })).rejects.toThrow(/finalised/);
  });

  it('keeps finalised results unchanged after salary master updates', async () => {
    await post(admin, `/employees/${emp2}/salary`, { effectiveFrom: '2026-09-20', changeReason: 'Late change', values: [{ componentId: masters.basic.id, value: '99999' }] });
    await put(admin, `/salary-components/${masters.basic.id}`, { name: 'Basic RENAMED', type: 'EARNING', basis: 'FIXED', sortOrder: 1, active: true, showOnPayslip: true });
    const det = await admin.get(`/payroll-runs/${runId}`);
    expect(det.body.status).toBe('FINALISED');
    expect(det.body.employees.find((e: { employeeId: string }) => e.employeeId === emp2).net).toBe('15000.75');
    expect(det.body.componentColumns.find((c: { code: string }) => c.code === 'BASIC').name).toBe('Basic');
  });

  it('generates and re-serves a stored payslip PDF', async () => {
    const res = await admin.get(`/payroll-runs/${runId}/employees/${emp1}/payslip`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect(await prisma.payslip.count({ where: { payrollRunId: runId } })).toBe(1);
    await admin.get(`/payroll-runs/${runId}/employees/${emp1}/payslip`);
    expect(await prisma.payslip.count({ where: { payrollRunId: runId } })).toBe(1);
  });

  it('re-opens only with Administrator permission and a reason, audit-logged', async () => {
    expect((await post(user, `/payroll-runs/${runId}/reopen`, { reason: 'Need to fix inputs' })).status).toBe(403);
    expect((await post(admin, `/payroll-runs/${runId}/reopen`, { reason: 'short' })).status).toBe(400);
    const ok = await post(admin, `/payroll-runs/${runId}/reopen`, { reason: 'Correction requested by finance' });
    expect(ok.status).toBe(200);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'payroll.reopened', entityId: runId } });
    expect(audit?.metadata).toMatchObject({ reason: 'Correction requested by finance' });
    expect(await prisma.payslip.count({ where: { payrollRunId: runId, supersededAt: null } })).toBe(0);
  });

  it('detects stale calculations after a master change', async () => {
    // emp2 got a new version effective 20 Sep, so the stored results no longer match.
    const submit = await post(admin, `/payroll-runs/${runId}/submit-review`, { acknowledgeWarnings: true });
    expect(submit.status).toBe(409);
    expect(submit.body.error.reason).toBe('STALE_CALCULATION');
    await post(admin, `/payroll-runs/${runId}/calculate`);
    const det = await admin.get(`/payroll-runs/${runId}`);
    expect(det.body.employees.find((e: { employeeId: string }) => e.employeeId === emp2).net).toBe('99999');
  });

  it('blocks submission while employees have missing mandatory inputs', async () => {
    await prisma.payrollInputDefinition.create({ data: { key: 'REQUIRED_X', label: 'Required X', dataType: 'NUMBER', mandatory: true } });
    await post(admin, `/payroll-runs/${runId}/calculate`);
    const det = await admin.get(`/payroll-runs/${runId}`);
    expect(det.body.resultCounts.ERROR).toBe(2);
    const submit = await post(admin, `/payroll-runs/${runId}/submit-review`, { acknowledgeWarnings: true });
    expect(submit.status).toBe(409);
    await prisma.payrollInputDefinition.update({ where: { key: 'REQUIRED_X' }, data: { active: false } });
  });

  it('hides amounts from users without the amounts permission', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'PAYROLL_USER' } });
    await prisma.rolePermission.delete({ where: { roleId_permissionCode: { roleId: role.id, permissionCode: 'payroll.view_amounts' } } });
    const det = await user.get(`/payroll-runs/${runId}`);
    expect(det.body.totalNet).toBeNull();
    expect(det.body.employees[0].net).toBeNull();
    expect((await user.get(`/reports/net-payable?runId=${runId}`)).status).toBe(403);
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionCode: 'payroll.view_amounts' } });
  });
});

describe('employee import', () => {
  it('previews, imports valid rows and provides an error report for the rest', async () => {
    const csv = ['Employee ID,Employee Name,Department,Joining Date', 'IMP-1,Imported One,Test Dept,2024-02-01', 'IMP-2,Imported Two,Nowhere,2024-02-01', 'EMP-1,Clash,,2024-02-01'].join('\n');
    const preview = await admin.post('/employees/import/preview').set('Origin', ORIGIN).attach('file', Buffer.from(csv), 'employees.csv');
    expect(preview.status).toBe(201);
    expect(preview.body.validRows).toBe(1);
    const commit = await post(admin, `/employees/import/${preview.body.jobId}/commit`, { mapping: preview.body.mapping });
    expect(commit.body).toMatchObject({ status: 'PARTIAL', imported: 1, failed: 2 });
    const errors = await admin.get(`/import-jobs/${preview.body.jobId}/errors`);
    expect(errors.text).toContain('Unknown department');
    expect(errors.text).toContain('already exists');
    const again = await post(admin, `/employees/import/${preview.body.jobId}/commit`, { mapping: preview.body.mapping });
    expect(again.status).toBe(409);
  });

  it('rejects unsupported file types', async () => {
    const res = await admin.post('/employees/import/preview').set('Origin', ORIGIN).attach('file', Buffer.from('MZ'), 'evil.exe');
    expect(res.status).toBe(415);
  });

  it('neutralises formula injection in exports', async () => {
    await post(admin, '/employees', { employeeCode: 'INJ-1', fullName: '=HYPERLINK("http://x")', joiningDate: '2024-01-01' });
    const res = await admin.get('/employees/export?format=csv');
    expect(res.text).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});
