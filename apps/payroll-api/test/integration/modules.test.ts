/**
 * Core gaps and advanced modules: employee contact details, monthly input import, payroll register,
 * leave management, loans and advances, bonuses and incentives, filling payroll inputs from those
 * modules, employee self-service and email notifications.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { devOutbox } from '@nexzi/server-core';
import { prisma, Prisma } from '../../src/db';
import { createUser } from '../../src/bootstrap';
import { login, ORIGIN, PASSWORD, resetDb, seedMasters } from '../helpers';

let admin: Agent;
let user: Agent;
let m: Awaited<ReturnType<typeof seedMasters>>;
const emp: Record<string, string> = {};
let runId: string;
let unpaid: string;
let casual: string;

const post = (a: Agent, path: string, body?: object) => a.post(path).set('Origin', ORIGIN).send(body ?? {});
const put = (a: Agent, path: string, body: object) => a.put(path).set('Origin', ORIGIN).send(body);

beforeAll(async () => {
  await resetDb();
  m = await seedMasters();
  // Extra monthly input columns and components that use them.
  for (const key of ['LOP_DAYS', 'ADVANCE_REC', 'INCENTIVE_IN']) await prisma.payrollInputDefinition.create({ data: { key, label: key.replace('_', ' '), dataType: 'NUMBER', minValue: new Prisma.Decimal(0) } });
  await prisma.salaryComponent.create({ data: { code: 'ADV', name: 'Advance recovery', type: 'DEDUCTION', basis: 'INPUT', inputKey: 'ADVANCE_REC', sortOrder: 20 } });
  await prisma.salaryComponent.create({ data: { code: 'INC', name: 'Incentive', type: 'EARNING', basis: 'INPUT', inputKey: 'INCENTIVE_IN', sortOrder: 4 } });
  admin = await login('admin@test.local');
  user = await login('user@test.local');
});

describe('employee contact details', () => {
  it('stores optional email and phone and validates them', async () => {
    const bad = await post(admin, '/employees', { employeeCode: 'E-BAD', fullName: 'Bad Contact', joiningDate: '2026-01-01', contactEmail: 'not-an-email', contactPhone: '12' });
    expect(bad.status).toBe(400);
    for (const [key, code, name] of [['a', 'E-1', 'Asha Rao'], ['b', 'E-2', 'Vikram Singh']]) {
      const res = await post(admin, '/employees', { employeeCode: code, fullName: name, joiningDate: '2026-01-01', departmentId: m.dept.id, contactEmail: `${key}@example.test`, contactPhone: '+91 98765 43210' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ contactEmail: `${key}@example.test`, contactPhone: '+91 98765 43210' });
      emp[key] = res.body.id;
      await post(admin, `/employees/${res.body.id}/salary`, { effectiveFrom: '2026-01-01', changeReason: 'Initial', values: [{ componentId: m.basic.id, value: '20000' }, { componentId: m.ded.id, value: '500' }] });
    }
  });
});

describe('leave management', () => {
  it('manages leave types', async () => {
    const a = await post(admin, '/leave/types', { code: 'LWP', name: 'Leave without pay', paid: false });
    const b = await post(admin, '/leave/types', { code: 'CL', name: 'Casual leave', paid: true, annualDays: '2' });
    expect([a.status, b.status]).toEqual([201, 201]);
    unpaid = a.body.id;
    casual = b.body.id;
  });

  it('validates requests: one month, days within dates, no overlaps, allowance', async () => {
    const base = { employeeId: emp.a, leaveTypeId: unpaid, reason: 'Family matter' };
    expect((await post(admin, '/leave/requests', { ...base, startDate: '2026-03-30', endDate: '2026-04-02', days: '3' })).status).toBe(400);
    expect((await post(admin, '/leave/requests', { ...base, startDate: '2026-03-10', endDate: '2026-03-11', days: '3' })).status).toBe(400);
    const ok = await post(admin, '/leave/requests', { ...base, startDate: '2026-03-10', endDate: '2026-03-11', days: '1.5' });
    expect(ok.status).toBe(201);
    expect((await post(admin, '/leave/requests', { ...base, startDate: '2026-03-11', endDate: '2026-03-12', days: '1' })).status).toBe(409);
    const tooMuch = await post(admin, '/leave/requests', { employeeId: emp.a, leaveTypeId: casual, startDate: '2026-03-20', endDate: '2026-03-22', days: '3' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toMatch(/Not enough Casual leave/);
  });

  it('approval: never by the person who entered it, and only once', async () => {
    const r = (await admin.get('/leave/requests?status=REQUESTED')).body.items[0];
    expect((await post(admin, `/leave/requests/${r.id}/approve`)).status).toBe(403);
    const approver = await prisma.role.create({ data: { code: 'LEAVE_APPROVER', name: 'Leave approver', permissions: { create: [{ permissionCode: 'leave.approve' }, { permissionCode: 'leave.view' }] } } });
    await createUser('approver@test.local', 'Leave Approver', approver.code, PASSWORD, false);
    const ap = await login('approver@test.local');
    const [x, y] = await Promise.all([post(ap, `/leave/requests/${r.id}/approve`), post(ap, `/leave/requests/${r.id}/approve`)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const bal = await admin.get(`/leave/balances?year=2026&employeeId=${emp.a}`);
    expect(bal.body[0].balances.find((b: { leaveType: { code: string } }) => b.leaveType.code === 'LWP')).toMatchObject({ approved: '1.5', allowance: null });
    expect(await prisma.auditLog.count({ where: { action: 'leave.approved', entityId: r.id } })).toBe(1);
  });
});

describe('loans, bonuses and filling payroll inputs', () => {
  it('records one active advance per employee and validates amounts', async () => {
    expect((await post(admin, '/loans', { employeeId: emp.a, kind: 'ADVANCE', principal: '1000', instalment: '2000', startYear: 2026, startMonth: 3 })).status).toBe(400);
    const ok = await post(admin, '/loans', { employeeId: emp.a, kind: 'ADVANCE', principal: '3000', instalment: '1000', startYear: 2026, startMonth: 3 });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ outstanding: '3000.00', nextInstalment: '1000.00' });
    expect((await post(admin, '/loans', { employeeId: emp.a, kind: 'LOAN', principal: '500', instalment: '100', startYear: 2026, startMonth: 3 })).status).toBe(409);
  });

  it('bonuses need a second person to approve', async () => {
    const b = await post(admin, '/bonuses', { employeeId: emp.b, kind: 'INCENTIVE', year: 2026, month: 3, amount: '2500', reason: 'Q1 target met' });
    expect(b.status).toBe(201);
    expect((await post(admin, `/bonuses/${b.body.id}/approve`)).status).toBe(403);
    const approverRole = await prisma.role.create({ data: { code: 'PAY_APPROVER', name: 'Payroll approver', permissions: { create: [{ permissionCode: 'payroll.approve' }, { permissionCode: 'payroll.view_amounts' }] } } });
    await createUser('payapprover@test.local', 'Pay Approver', approverRole.code, PASSWORD, false);
    const pa = await login('payapprover@test.local');
    expect((await post(pa, `/bonuses/${b.body.id}/approve`)).status).toBe(200);
    expect((await post(pa, `/bonuses/${b.body.id}/approve`)).status).toBe(409);
  });

  it('fills mapped inputs from approved leave, active advances and approved incentives', async () => {
    const run = await post(admin, '/payroll-runs', { year: 2026, month: 3 });
    runId = run.body.id;
    const notMapped = await post(admin, `/payroll-runs/${runId}/inputs/fill`);
    expect(notMapped.status).toBe(422);
    const s = (await admin.get('/settings')).body;
    expect((await put(admin, '/settings', { inputMappings: { unpaidLeaveDays: 'LOP_DAYS', advanceRecovery: 'ADVANCE_REC', bonus: null, incentive: 'INCENTIVE_IN' }, emailNotifications: s.emailNotifications })).status).toBe(200);
    const fill = await post(admin, `/payroll-runs/${runId}/inputs/fill`);
    expect(fill.status).toBe(200);
    expect(fill.body.summary).toMatchObject({ unpaidLeaveDays: { employees: 1, total: '1.50' }, advanceRecovery: { employees: 1, total: '1000.00' }, incentive: { employees: 1, total: '2500.00' } });
    const grid = (await admin.get(`/payroll-runs/${runId}/inputs`)).body.rows;
    const a = grid.find((r: { employeeId: string }) => r.employeeId === emp.a).values;
    const b = grid.find((r: { employeeId: string }) => r.employeeId === emp.b).values;
    expect([a.LOP_DAYS, a.ADVANCE_REC, b.INCENTIVE_IN]).toEqual(['1.5', '1000', '2500']);
  });
});

describe('monthly input import (attendance, leave, working days)', () => {
  it('provides a template and imports matching columns, reporting problems per row', async () => {
    const tpl = await admin.get(`/payroll-runs/${runId}/inputs/template`).buffer(true);
    expect(tpl.status).toBe(200);
    expect(tpl.headers['content-type']).toContain('spreadsheetml');
    const csv = 'Employee ID,LOP DAYS,Bonus input,Mystery column\nE-1,2,100,x\nE-2,abc,,\nE-404,1,,\n';
    const res = await admin.post(`/payroll-runs/${runId}/inputs/import`).set('Origin', ORIGIN).attach('file', Buffer.from(csv), 'attendance.csv');
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(2);
    expect(res.body.errors).toEqual([expect.objectContaining({ employeeCode: 'E-2', inputKey: 'LOP_DAYS' })]);
    expect(res.body.unmatchedEmployees).toEqual([{ row: 4, employeeCode: 'E-404' }]);
    expect(res.body.unknownColumns).toEqual(['Mystery column']);
    const a = (await admin.get(`/payroll-runs/${runId}/inputs`)).body.rows.find((r: { employeeId: string }) => r.employeeId === emp.a).values;
    expect([a.LOP_DAYS, a.BONUS_INPUT]).toEqual(['2', '100']);
    expect((await user.post(`/payroll-runs/${runId}/inputs/import`).set('Origin', ORIGIN).attach('file', Buffer.from(csv), 'x.txt')).status).toBe(415);
  });
});

describe('payroll register, advance recovery and email notifications', () => {
  it('produces a register with every component, gross, deductions and net', async () => {
    await post(admin, `/payroll-runs/${runId}/calculate`);
    const reg = await admin.get(`/reports/payroll-register?runId=${runId}`);
    expect(reg.status).toBe(200);
    const headers = reg.body.columns.map((c: { header: string }) => c.header);
    expect(headers).toEqual(expect.arrayContaining(['Basic', 'Incentive', 'Gross', 'Fixed deduction', 'Advance recovery', 'Total deductions', 'Net pay']));
    const a = reg.body.rows.find((r: { code: string }) => r.code === 'E-1');
    expect([a.c_ADV, a.gross, a.net]).toEqual(['1000.00', '20100.00', '18600.00']);
    expect(reg.body.totals.net).toBe('40600.00'); // 18600 + (20000 + 2500 − 500)
  });

  it('emails approvers on submit and finalisers on approval, without amounts', async () => {
    const before = devOutbox.length;
    expect((await post(admin, `/payroll-runs/${runId}/submit-review`, { acknowledgeWarnings: true })).status).toBe(200);
    expect((await post(admin, `/payroll-runs/${runId}/approve`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const mails = devOutbox.slice(before);
    expect(mails.some((x) => x.to === 'admin@test.local' && /waiting for approval/.test(x.subject))).toBe(true);
    expect(mails.some((x) => x.to === 'admin@test.local' && /ready to finalise/.test(x.subject))).toBe(true);
    expect(mails.every((x) => !/18,?600|39,?600/.test(x.text + x.html))).toBe(true);
    expect((await post(admin, `/payroll-runs/${runId}/finalise`)).status).toBe(200);
  });

  it('computes advance recovery from the finalised run', async () => {
    const loans = (await admin.get('/loans')).body.items;
    expect(loans[0]).toMatchObject({ recovered: '1000.00', outstanding: '2000.00', nextInstalment: '1000.00' });
    expect(loans[0].recoveries).toEqual([expect.objectContaining({ period: 'March 2026', amount: '1000.00' })]);
  });
});

describe('employee self-service', () => {
  let me: Agent;
  let otherPayslip: string;

  beforeAll(async () => {
    await createUser('asha@example.test', 'Asha Rao', 'EMPLOYEE', PASSWORD, false);
    const u = await prisma.user.findFirstOrThrow({ where: { email: 'asha@example.test' } });
    expect((await put(admin, `/users/${u.id}`, { employeeId: emp.a })).status).toBe(200);
    me = await login('asha@example.test');
  });

  it('links one account per employee', async () => {
    await createUser('dup@example.test', 'Duplicate', 'EMPLOYEE', PASSWORD, false);
    const d = await prisma.user.findFirstOrThrow({ where: { email: 'dup@example.test' } });
    expect((await put(admin, `/users/${d.id}`, { employeeId: emp.a })).status).toBe(409);
  });

  it('notifies the employee when payslips are generated and lists only their own', async () => {
    const before = devOutbox.length;
    expect((await post(admin, `/payroll-runs/${runId}/payslips/generate`)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    expect(devOutbox.slice(before).some((x) => x.to === 'asha@example.test' && /payslip for March 2026 is available/.test(x.subject))).toBe(true);
    const mine = await me.get('/me/payslips');
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].period).toBe('March 2026');
    const pdf = await me.get(`/me/payslips/${mine.body[0].id}`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    otherPayslip = (await prisma.payslip.findFirstOrThrow({ where: { employeeId: emp.b } })).id;
    expect((await me.get(`/me/payslips/${otherPayslip}`)).status).toBe(404);
  });

  it('shows own details and leave, lets the employee request leave, and blocks staff screens', async () => {
    const d = await me.get('/me/employee');
    expect(d.body).toMatchObject({ employeeCode: 'E-1', fullName: 'Asha Rao', contactEmail: 'a@example.test' });
    expect(JSON.stringify(d.body)).not.toMatch(/20000/);
    const req = await post(me, '/me/leave', { leaveTypeId: casual, startDate: '2026-04-06', endDate: '2026-04-06', days: '1', reason: 'Appointment' });
    expect(req.status).toBe(201);
    expect((await me.get('/me/leave?year=2026')).body.requests.some((x: { id: string }) => x.id === req.body.id)).toBe(true);
    for (const path of ['/employees', '/payroll-runs', '/reports/payroll-register?runId=' + runId, '/leave/requests', '/loans']) expect((await me.get(path)).status).toBe(403);
    expect((await post(me, '/leave/requests', { employeeId: emp.b, leaveTypeId: casual, startDate: '2026-04-07', endDate: '2026-04-07', days: '1' })).status).toBe(403);
    expect((await post(me, `/me/leave/${req.body.id}/cancel`)).status).toBe(200);
  });

  it('explains when an account is not linked', async () => {
    await createUser('unlinked@example.test', 'Not Linked', 'EMPLOYEE', PASSWORD, false);
    const u = await login('unlinked@example.test');
    const res = await u.get('/me/payslips');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/not linked/);
  });
});
