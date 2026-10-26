import { beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { prisma } from '../../src/db';
import { login, ORIGIN, resetDb } from '../helpers';

let admin: Agent;
let user: Agent;
let employeeId: string;

beforeAll(async () => {
  await resetDb();
  admin = await login('admin@test.local');
  user = await login('user@test.local');
  const e = await prisma.employee.create({ data: { employeeCode: 'AN-001', fullName: 'Analytics Person', joiningDate: new Date('2024-01-01T00:00:00Z') } });
  employeeId = e.id;
  const rows = [
    { d: '2026-10-01', login: '09:00', mins: 540, status: 'PRESENT' as const },
    { d: '2026-10-02', login: '10:00', mins: 480, status: 'PRESENT' as const },
    { d: '2026-10-03', login: null, mins: null, status: 'ABSENT' as const },
    { d: '2026-10-04', login: null, mins: null, status: 'LEAVE' as const },
  ];
  for (const r of rows) {
    await prisma.attendanceRecord.create({ data: { employeeId, attendanceDate: new Date(`${r.d}T00:00:00Z`), loginTime: r.login, status: r.status, workingMinutes: r.mins } });
  }
});

describe('analytics and search', () => {
  it('returns the overview for users with report access', async () => {
    const res = await admin.get('/analytics/overview');
    expect(res.status).toBe(200);
    expect(res.body.headcount.active).toBeGreaterThanOrEqual(1);
    expect(res.body.hiring).toHaveLength(12);
    expect(Array.isArray(res.body.byDepartment)).toBe(true);
  });

  it('finds employees by name or code and rejects too-short queries', async () => {
    const hit = await admin.get('/analytics/search?q=Analytics');
    expect(hit.status).toBe(200);
    expect(hit.body.results.some((r: { title: string }) => r.title === 'Analytics Person')).toBe(true);
    expect((await admin.get('/analytics/search?q=a')).status).toBe(400);
  });

  it('requires the audit permission for the activity feed', async () => {
    expect((await admin.get('/analytics/activity?limit=5')).status).toBe(200);
    expect((await user.get('/analytics/activity')).status).toBe(403);
  });
});

describe('daily attendance to payroll inputs', () => {
  it('summarises present, absent, leave, late and overtime figures per employee', async () => {
    const res = await admin.get('/attendance-records/payroll-summary?year=2026&month=10&lateAfter=09:30');
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: { employeeCode: string }) => r.employeeCode === 'AN-001');
    expect(row).toMatchObject({ present_days: 2, absent_days: 1, leave_days: 1, late_days: 1, worked_hours: 17, overtime_hours: 1, hasRecords: true });
  });

  it('refuses to apply without a payroll run or field mapping', async () => {
    const res = await admin.post('/attendance-records/apply-to-payroll').set('Origin', ORIGIN).send({ year: 2026, month: 10 });
    expect(res.status).toBe(404);
  });

  it('saves the column mapping for administrators only, with known numeric columns', async () => {
    const put = (a: Agent, fieldMap: object[]) => a.put('/attendance-records/payroll-mapping').set('Origin', ORIGIN).send({ fieldMap });
    for (const key of ['PRESENT_DAYS', 'ABSENT_DAYS']) await prisma.payrollInputDefinition.create({ data: { key, label: key, dataType: 'NUMBER' } });
    expect((await put(user, [{ source: 'present_days', inputKey: 'PRESENT_DAYS' }])).status).toBe(403);
    expect((await put(admin, [{ source: 'present_days', inputKey: 'NOPE' }])).status).toBe(400);
    expect((await put(admin, [{ source: 'not_a_total', inputKey: 'PRESENT_DAYS' }])).status).toBe(400);
    expect((await put(admin, [{ source: 'present_days', inputKey: 'PRESENT_DAYS' }, { source: 'present_days', inputKey: 'ABSENT_DAYS' }])).status).toBe(400);
    const ok = await put(admin, [{ source: 'present_days', inputKey: 'PRESENT_DAYS' }, { source: 'absent_days', inputKey: 'ABSENT_DAYS' }]);
    expect(ok.status).toBe(200);
    const summary = await admin.get('/attendance-records/payroll-summary?year=2026&month=10');
    expect(summary.body.fieldMap).toEqual([{ source: 'present_days', inputKey: 'PRESENT_DAYS' }, { source: 'absent_days', inputKey: 'ABSENT_DAYS' }]);
  });

  it('writes the mapped totals into the payroll month', async () => {
    const run = await admin.post('/payroll-runs').set('Origin', ORIGIN).send({ year: 2026, month: 10 });
    expect(run.status).toBe(201);
    const res = await admin.post('/attendance-records/apply-to-payroll').set('Origin', ORIGIN).send({ year: 2026, month: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ saved: 2, errors: [] });
    const inputs = await prisma.payrollInput.findMany({ where: { payrollRunId: run.body.id, employeeId }, orderBy: { inputKey: 'asc' } });
    expect(inputs.map((i) => [i.inputKey, i.value])).toEqual([['ABSENT_DAYS', '1'], ['PRESENT_DAYS', '2']]);
  });

});
