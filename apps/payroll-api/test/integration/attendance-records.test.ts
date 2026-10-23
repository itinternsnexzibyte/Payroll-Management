import { beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { prisma } from '../../src/db';
import { app, login, ORIGIN, resetDb } from '../helpers';

let admin: Agent;
let user: Agent;
let employeeId: string;
const post = (agent: Agent, path: string, body: object) => agent.post(path).set('Origin', ORIGIN).send(body);
const put = (agent: Agent, path: string, body: object) => agent.put(path).set('Origin', ORIGIN).send(body);

beforeAll(async () => {
  await resetDb();
  admin = await login('admin@test.local');
  user = await login('user@test.local');
  const employee = await prisma.employee.create({
    data: { employeeCode: 'ATT-001', fullName: 'Attendance Test', joiningDate: new Date('2024-01-01T00:00:00Z') },
  });
  employeeId = employee.id;
});

describe('admin daily attendance records', () => {
  it('restricts access to roles with attendance permissions', async () => {
    expect((await user.get('/attendance-records')).status).toBe(403);
    expect((await post(user, '/attendance-records', { employeeId, attendanceDate: '2026-10-23', status: 'PRESENT' })).status).toBe(403);
  });

  it('creates, filters and updates one record per employee and date', async () => {
    const body = { employeeId, attendanceDate: '2026-10-23', loginTime: '09:00', logoutTime: '17:30', status: 'PRESENT', workingMinutes: 510 };
    const created = await post(admin, '/attendance-records', body);
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ employeeId, employeeCode: 'ATT-001', employeeName: 'Attendance Test', attendanceDate: '2026-10-23', loginTime: '09:00', logoutTime: '17:30', status: 'PRESENT', workingMinutes: 510 });

    const list = await admin.get('/attendance-records?date=2026-10-23');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const updated = await post(admin, '/attendance-records', { ...body, loginTime: '09:15', logoutTime: '17:30', workingMinutes: 495 });
    expect(updated.body.id).toBe(created.body.id);
    expect(updated.body.loginTime).toBe('09:15');
    expect(await prisma.attendanceRecord.count()).toBe(1);

    const edited = await put(admin, `/attendance-records/${created.body.id}`, { ...body, attendanceDate: '2026-10-24', loginTime: '09:30' });
    expect(edited.status).toBe(200);
    expect(edited.body.id).toBe(created.body.id);
    expect(edited.body.attendanceDate).toBe('2026-10-24');
    expect(await prisma.attendanceRecord.count()).toBe(1);
  });

  it('rejects invalid times and excessive working minutes', async () => {
    const invalidTime = await post(admin, '/attendance-records', { employeeId, attendanceDate: '2026-10-24', loginTime: '18:00', logoutTime: '09:00', status: 'PRESENT' });
    expect(invalidTime.status).toBe(400);
    const invalidMinutes = await post(admin, '/attendance-records', { employeeId, attendanceDate: '2026-10-24', status: 'PRESENT', workingMinutes: 1441 });
    expect(invalidMinutes.status).toBe(400);
  });

  it('deletes a record and records the action in the audit log', async () => {
    const record = await prisma.attendanceRecord.findFirstOrThrow();
    const removed = await admin.delete(`/attendance-records/${record.id}`).set('Origin', ORIGIN);
    expect(removed.status).toBe(200);
    expect(await prisma.attendanceRecord.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'attendance.record_deleted', entityId: record.id } })).toBe(1);
  });
});
