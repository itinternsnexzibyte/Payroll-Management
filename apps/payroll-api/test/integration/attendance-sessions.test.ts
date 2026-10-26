import { beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { prisma } from '../../src/db';
import { runAttendanceWatchdog } from '../../src/attendance/sessions';
import { createUser } from '../../src/bootstrap';
import { app, login, ORIGIN, PASSWORD, resetDb } from '../helpers';

let admin: Agent;
let employee: Agent;
let employeeId: string;
const post = (agent: Agent, path: string, body?: object) => agent.post(path).set('Origin', ORIGIN).send(body ?? {});
const put = (agent: Agent, path: string, body: object) => agent.put(path).set('Origin', ORIGIN).send(body);

beforeAll(async () => {
  await resetDb();
  admin = await login('admin@test.local');
  const row = await prisma.employee.create({
    data: { employeeCode: 'ATT-SESSION-001', fullName: 'Attendance Session Test', joiningDate: new Date('2024-01-01T00:00:00Z') },
  });
  employeeId = row.id;
  await createUser('attendance@test.local', 'Attendance Test', 'EMPLOYEE', PASSWORD, false);
  await prisma.user.update({ where: { email: 'attendance@test.local' }, data: { employeeId } });
  employee = await login('attendance@test.local');
});

describe('integrated attendance sessions', () => {
  it('records consented session locations, breaks, check-out and daily totals', async () => {
    const checkIn = await post(employee, '/attendance-sessions/check-in', { locationConsent: false });
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(201);
    const sessionId = checkIn.body.session.id as string;

    expect((await employee.get('/attendance-sessions/me')).body).toMatchObject({
      attendanceEnabled: true,
      day: { employeeId, isOnline: true, checkInCount: 1 },
    });
    expect((await post(employee, '/attendance-sessions/location', { latitude: 12.9716, longitude: 77.5946 })).status).toBe(403);

    expect((await put(employee, '/attendance-sessions/location-consent', { enabled: true })).status).toBe(200);
    const point = await post(employee, '/attendance-sessions/location', { latitude: 12.9716, longitude: 77.5946, accuracyMeters: 9 });
    expect(point.status).toBe(200);
    expect(Number(point.body.distanceFromStartMeters)).toBe(0);
    expect((await admin.get(`/attendance-sessions/${sessionId}/locations`)).status).toBe(200);
    expect((await employee.get(`/attendance-sessions/${sessionId}/locations`)).status).toBe(403);

    expect((await post(employee, '/attendance-sessions/break-start')).status).toBe(200);
    expect((await post(employee, '/attendance-sessions/break-start')).status).toBe(409);
    expect((await post(employee, '/attendance-sessions/break-end')).status).toBe(200);
    const checkOut = await post(employee, '/attendance-sessions/check-out');
    expect(checkOut.status).toBe(200);
    expect(checkOut.body).toMatchObject({ employeeId, isOnline: false, checkOutCount: 1, sessions: [{ id: sessionId, locationConsent: true }] });
    expect((await admin.get('/attendance-sessions')).body[0]).toMatchObject({ employeeId, checkInCount: 1, checkOutCount: 1 });

    const day = await prisma.attendanceRecord.findFirstOrThrow({ where: { employeeId } });
    expect((await put(admin, `/attendance-records/${day.id}`, {
      employeeId,
      attendanceDate: day.attendanceDate.toISOString().slice(0, 10),
      loginTime: '09:00',
      logoutTime: '17:00',
      status: 'PRESENT',
      workingMinutes: 480,
    })).status).toBe(409);
    expect(await prisma.payrollRun.count()).toBe(0);
  });

  it('lists attendance for a calendar month and rejects oversized date ranges', async () => {
    const result = await admin.get('/attendance-sessions?start=2026-10-01&end=2026-10-31');
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(1);
    expect(result.body[0]).toMatchObject({ employeeId, checkInCount: 1 });
    expect(result.body[0].attendanceDate).toMatch(/^2026-10-/);
    expect((await admin.get('/attendance-sessions?start=2026-10-01&end=2026-11-01')).status).toBe(400);
  });

  it('forces stale sessions out and requires administrator approval to reactivate', async () => {
    const current = await prisma.attendanceWorkSession.findFirstOrThrow({ where: { employeeId } });
    const staleAt = new Date(Date.now() - 10 * 60_000);
    await prisma.attendanceWorkSession.update({
      where: { id: current.id },
      data: { startedAt: new Date(staleAt.getTime() - 60_000), endedAt: null, lastHeartbeatAt: staleAt, forcedCheckout: false },
    });
    await prisma.user.update({ where: { employeeId }, data: { attendanceEnabled: true } });

    expect(await runAttendanceWatchdog(new Date(), 120_000)).toBe(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { employeeId } })).toMatchObject({ attendanceEnabled: false });
    expect(await prisma.attendanceWorkSession.findUniqueOrThrow({ where: { id: current.id } })).toMatchObject({ endedAt: staleAt, forcedCheckout: true });
    expect((await post(employee, '/attendance-sessions/check-in', {})).status).toBe(403);

    const request = await post(employee, '/attendance-sessions/access-request', { reason: 'My network disconnected while my work session was active.' });
    expect(request.status).toBe(201);
    const pending = await admin.get('/attendance-access-requests');
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({ employeeId, status: 'PENDING', sessionId: current.id });

    const reviewed = await post(admin, `/attendance-access-requests/${request.body.id}/review`, { decision: 'APPROVED' });
    expect(reviewed.status).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { employeeId } })).toMatchObject({ attendanceEnabled: true });
    expect((await employee.get('/attendance-sessions/me')).body).toMatchObject({ attendanceEnabled: true });
    expect(await prisma.employeeNotification.count({ where: { employeeId, kind: 'ATTENDANCE_FORCED_CHECKOUT' } })).toBe(1);
  });
});
