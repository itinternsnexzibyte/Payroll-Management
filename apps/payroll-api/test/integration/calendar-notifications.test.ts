import { beforeAll, describe, expect, it } from 'vitest';
import type { Agent } from 'supertest';
import { createUser } from '../../src/bootstrap';
import { prisma } from '../../src/db';
import { login, ORIGIN, resetDb } from '../helpers';

let admin: Agent;
let employeeUser: Agent;
let employeeId: string;
let otherEmployeeId: string;
const post = (agent: Agent, path: string, body: object) => agent.post(path).set('Origin', ORIGIN).send(body);
const put = (agent: Agent, path: string, body: object) => agent.put(path).set('Origin', ORIGIN).send(body);

beforeAll(async () => {
  await resetDb();
  admin = await login('admin@test.local');
  const employee = await prisma.employee.create({
    data: { employeeCode: 'CAL-001', fullName: 'Calendar Test', joiningDate: new Date('2024-01-01T00:00:00Z') },
  });
  const other = await prisma.employee.create({
    data: { employeeCode: 'CAL-002', fullName: 'Other Calendar Employee', joiningDate: new Date('2024-01-01T00:00:00Z') },
  });
  employeeId = employee.id;
  otherEmployeeId = other.id;
  await createUser('calendar-employee@test.local', 'Calendar Employee', 'EMPLOYEE', 'TestPassw0rd-Strong', false);
  await prisma.user.update({ where: { email: 'calendar-employee@test.local' }, data: { employeeId } });
  employeeUser = await login('calendar-employee@test.local');
});

describe('calendar events and employee notifications', () => {
  it('scopes events and notifications and records event changes', async () => {
    const globalEvent = await post(admin, '/calendar/events', {
      title: 'Quarterly town hall',
      description: 'Company update',
      eventDate: '2026-11-10',
      eventTime: '14:30',
      color: '#123abc',
      employeeId: null,
    });
    expect(globalEvent.status).toBe(201);
    expect(globalEvent.body).toMatchObject({ title: 'Quarterly town hall', eventDate: '2026-11-10', eventTime: '14:30', color: '#123abc', employee: null });

    const privateEvent = await post(admin, '/calendar/events', {
      title: 'Other employee check-in',
      eventDate: '2026-11-11',
      employeeId: otherEmployeeId,
    });
    expect(privateEvent.status).toBe(201);

    const visibleEvents = await employeeUser.get('/calendar/events?start=2026-11-01&end=2026-11-30');
    expect(visibleEvents.status).toBe(200);
    expect(visibleEvents.body.map((event: { id: string }) => event.id)).toEqual([globalEvent.body.id]);

    const notifications = await employeeUser.get('/employee-notifications');
    expect(notifications.status).toBe(200);
    expect(notifications.body, JSON.stringify(notifications.body)).toMatchObject({ unreadCount: 1 });
    expect(notifications.body.items[0]).toMatchObject({ title: 'New scheduled event', targetUrl: `/calendar?date=2026-11-10&event=${globalEvent.body.id}`, isRead: false });
    expect((await employeeUser.get('/notifications')).body.items).toContainEqual(expect.objectContaining({ id: `employee-${notifications.body.items[0].id}` }));

    const changed = await put(admin, `/calendar/events/${globalEvent.body.id}`, {
      title: 'Updated town hall',
      description: 'Updated company update',
      eventDate: '2026-11-12',
      eventTime: null,
      color: '#f3c440',
      employeeId: otherEmployeeId,
    });
    expect(changed.status).toBe(200);
    expect((await employeeUser.get('/calendar/events')).body).toHaveLength(0);
    expect(await prisma.employeeNotification.count({ where: { employeeId, title: 'Event no longer assigned to you' } })).toBe(1);
    expect((await employeeUser.get('/employee-notifications')).body.unreadCount).toBe(2);

    const firstNotification = (await employeeUser.get('/employee-notifications')).body.items[0];
    expect((await post(employeeUser, `/notifications/${firstNotification.id}/read`, {})).status).toBe(200);
    expect((await employeeUser.get('/employee-notifications')).body.unreadCount).toBe(1);
    const readAll = await post(employeeUser, '/notifications/read-all', {});
    expect(readAll.status).toBe(200);
    expect(readAll.body.updated).toBe(1);
    expect((await employeeUser.get('/employee-notifications')).body.unreadCount).toBe(0);

    const canceled = await admin.delete(`/calendar/events/${privateEvent.body.id}`).set('Origin', ORIGIN);
    expect(canceled.status).toBe(200);
    expect(await prisma.employeeNotification.count({ where: { employeeId: otherEmployeeId, title: 'Event cancelled' } })).toBe(1);
  });

  it('validates event data, keeps employee notifications private and enforces permissions', async () => {
    expect((await admin.get('/calendar/events?start=2026-12-31&end=2026-01-01')).status).toBe(400);
    expect((await post(admin, '/calendar/events', { title: 'Invalid', eventDate: '2026-11-10', color: 'red' })).status).toBe(400);
    expect((await employeeUser.post('/calendar/events').set('Origin', ORIGIN).send({ title: 'No date' })).status).toBe(400);
    expect((await employeeUser.get('/employee-notifications')).status).toBe(200);

    const otherNotification = await prisma.employeeNotification.create({
      data: { employeeId: otherEmployeeId, title: 'Private', message: 'Private detail', kind: 'TEST' },
    });
    expect((await post(employeeUser, `/notifications/${otherNotification.id}/read`, {})).status).toBe(404);
  });

  it('lets an employee add, edit and cancel only their own personal events', async () => {
    const before = await prisma.employeeNotification.count();
    const mine = await post(employeeUser, '/calendar/events', { title: 'Dentist appointment', eventDate: '2026-12-03', eventTime: '10:00', employeeId: otherEmployeeId });
    expect(mine.status).toBe(201);
    // Always saved for the employee themselves, whatever audience was sent, and nobody is notified.
    expect(mine.body).toMatchObject({ title: 'Dentist appointment', employee: { id: employeeId }, editable: true });
    expect(await prisma.employeeNotification.count()).toBe(before);

    const shared = await post(admin, '/calendar/events', { title: 'Holiday party', eventDate: '2026-12-04', employeeId: null });
    const assigned = await post(admin, '/calendar/events', { title: 'Review meeting', eventDate: '2026-12-05', employeeId });
    const list = (await employeeUser.get('/calendar/events?start=2026-12-01&end=2026-12-31')).body as { id: string; editable: boolean }[];
    expect(list.map((e) => [e.id, e.editable])).toEqual([[mine.body.id, true], [shared.body.id, false], [assigned.body.id, false]]);
    expect((await admin.get('/calendar/events?start=2026-12-01&end=2026-12-31')).body.every((e: { editable: boolean }) => e.editable)).toBe(true);

    const edited = await put(employeeUser, `/calendar/events/${mine.body.id}`, { title: 'Dentist (moved)', eventDate: '2026-12-06', employeeId: null });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ title: 'Dentist (moved)', eventDate: '2026-12-06', employee: { id: employeeId } });
    for (const id of [shared.body.id, assigned.body.id]) {
      expect((await put(employeeUser, `/calendar/events/${id}`, { title: 'Hijacked', eventDate: '2026-12-06' })).status).toBe(404);
      expect((await employeeUser.delete(`/calendar/events/${id}`).set('Origin', ORIGIN)).status).toBe(404);
    }
    expect((await employeeUser.delete(`/calendar/events/${mine.body.id}`).set('Origin', ORIGIN)).status).toBe(200);
    expect(await prisma.calendarEvent.count({ where: { id: mine.body.id } })).toBe(0);
  });
});
