import { z } from 'zod';
import { AppError, idParam, isoDate, notFound, toIsoDate, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { notifyEmployees } from '../notifications';

const eventInclude = { employee: { select: { id: true, employeeCode: true, fullName: true } } } satisfies Prisma.CalendarEventInclude;
type CalendarEventRow = Prisma.CalendarEventGetPayload<{ include: typeof eventInclude }>;

const serializeEvent = (event: CalendarEventRow, editable: boolean) => ({
  id: event.id,
  title: event.title,
  description: event.description,
  eventDate: toIsoDate(event.eventDate),
  eventTime: event.eventTime,
  color: event.color,
  employee: event.employee,
  createdAt: event.createdAt,
  updatedAt: event.updatedAt,
  editable,
});

const eventBody = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(10000).nullable().optional().or(z.literal('').transform(() => null)),
  eventDate: isoDate,
  eventTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time in HH:MM format.').nullable().optional().or(z.literal('').transform(() => null)),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hexadecimal color.').default('#f3c440'),
  employeeId: z.string().uuid().nullable().optional(),
});

const rangeQuery = z.object({
  start: isoDate.optional(),
  end: isoDate.optional(),
}).superRefine((query, ctx) => {
  if (query.start && query.end && query.start > query.end) {
    ctx.addIssue({ code: 'custom', path: ['end'], message: 'End date must be on or after the start date.' });
  }
});

async function activeRecipients(tx: Prisma.TransactionClient, employeeId: string | null) {
  const rows = await tx.employee.findMany({
    where: employeeId ? { id: employeeId, status: 'ACTIVE' } : { status: 'ACTIVE' },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function ensureActiveEmployee(employeeId: string | null | undefined) {
  if (!employeeId) return null;
  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, status: true } });
  if (!employee || employee.status !== 'ACTIVE') throw notFound('Active employee');
  return employee.id;
}

const eventMessage = (event: { title: string; eventDate: Date; eventTime: string | null; description: string | null }) =>
  `${event.title} — ${toIsoDate(event.eventDate)} ${event.eventTime ?? 'All day'}.${event.description ? ` ${event.description}` : ''}`;

const linkedEmployeeId = async (userId: string) => (await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } }))?.employeeId ?? null;

/**
 * The calendar team (calendar.manage) changes any event. An employee changes only the personal
 * events they created for themselves; shared events and events assigned by the team stay read-only.
 */
const canChange = (event: { createdById: string | null; employeeId: string | null }, user: AuthUser, ownEmployeeId: string | null) =>
  user.permissions.has('calendar.manage') || (ownEmployeeId !== null && event.employeeId === ownEmployeeId && event.createdById === user.id);

/** Who an event is saved for: any active employee (or everyone) for the team, always themselves for an employee. */
async function eventAudience(user: AuthUser, requested: string | null | undefined) {
  if (user.permissions.has('calendar.manage')) return { employeeId: await ensureActiveEmployee(requested), personal: false };
  const own = await linkedEmployeeId(user.id);
  if (!own) throw new AppError('INVALID_STATE', 'Your account must be linked to an employee record to add calendar events.');
  return { employeeId: own, personal: true };
}

const eventUrl = (event: { id: string; eventDate: Date }) => `/calendar?date=${toIsoDate(event.eventDate)}&event=${encodeURIComponent(event.id)}`;

export function registerCalendarNotificationRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/calendar/events',
    tag: 'Calendar',
    summary: 'List visible calendar events',
    permission: 'calendar.view',
    query: rangeQuery,
    handler: async ({ query, user }) => {
      const employeeId = user.permissions.has('calendar.manage') ? undefined : await linkedEmployeeId(user.id);
      if (!user.permissions.has('calendar.manage') && !employeeId) {
        throw new AppError('INVALID_STATE', 'Your account must be linked to an employee record to view calendar events.');
      }
      const rows = await prisma.calendarEvent.findMany({
        where: {
          ...(employeeId ? { OR: [{ employeeId: null }, { employeeId }] } : {}),
          ...(query.start || query.end ? { eventDate: { ...(query.start ? { gte: query.start } : {}), ...(query.end ? { lte: query.end } : {}) } } : {}),
        },
        include: eventInclude,
        orderBy: [{ eventDate: 'asc' }, { eventTime: 'asc' }, { title: 'asc' }],
        take: 500,
      });
      return rows.map((row) => serializeEvent(row, canChange(row, user, employeeId ?? null)));
    },
  });

  r.add({
    method: 'post',
    path: '/calendar/events',
    tag: 'Calendar',
    summary: 'Create a general or employee-specific calendar event (employees: a personal event for themselves)',
    permission: ['calendar.manage', 'calendar.view'],
    body: eventBody,
    status: 201,
    handler: async ({ body, user, ip }) => {
      const { employeeId, personal } = await eventAudience(user, body.employeeId);
      const event = await prisma.$transaction(async (tx) => {
        const created = await tx.calendarEvent.create({
          data: {
            title: body.title,
            description: body.description ?? null,
            eventDate: body.eventDate,
            eventTime: body.eventTime ?? null,
            color: body.color,
            employeeId,
            createdById: user.id,
          },
          include: eventInclude,
        });
        // A personal event is the employee's own note; nobody else needs to be told about it.
        if (!personal) {
          const recipients = await activeRecipients(tx, employeeId);
          await notifyEmployees(tx, recipients, { title: 'New scheduled event', message: eventMessage(created), kind: 'CALENDAR_EVENT', targetUrl: eventUrl(created) });
        }
        return created;
      });
      await audit.write({ actorId: user.id, action: 'calendar.event_created', entity: 'calendar_event', entityId: event.id, metadata: { employeeId, personal }, ip });
      return serializeEvent(event, true);
    },
  });

  r.add({
    method: 'put',
    path: '/calendar/events/:id',
    tag: 'Calendar',
    summary: 'Edit a calendar event and notify affected employees (employees: their own personal events)',
    permission: ['calendar.manage', 'calendar.view'],
    params: idParam,
    body: eventBody,
    handler: async ({ params, body, user, ip }) => {
      const { employeeId, personal } = await eventAudience(user, body.employeeId);
      const event = await prisma.$transaction(async (tx) => {
        const existing = await tx.calendarEvent.findUnique({ where: { id: params.id } });
        if (!existing || !canChange(existing, user, personal ? employeeId : null)) throw notFound('Calendar event');
        const previousRecipients = await activeRecipients(tx, existing.employeeId);
        const updated = await tx.calendarEvent.update({
          where: { id: existing.id },
          data: {
            title: body.title,
            description: body.description ?? null,
            eventDate: body.eventDate,
            eventTime: body.eventTime ?? null,
            color: body.color,
            employeeId,
          },
          include: eventInclude,
        });
        if (!personal) {
          const recipients = await activeRecipients(tx, employeeId);
          await notifyEmployees(tx, recipients, { title: 'Event updated', message: eventMessage(updated), kind: 'CALENDAR_EVENT', targetUrl: eventUrl(updated) });
          const removed = previousRecipients.filter((id) => !recipients.includes(id));
          await notifyEmployees(tx, removed, { title: 'Event no longer assigned to you', message: updated.title, kind: 'CALENDAR_EVENT', targetUrl: '/calendar' });
        }
        return { updated, previousEmployeeId: existing.employeeId };
      });
      await audit.write({ actorId: user.id, action: 'calendar.event_updated', entity: 'calendar_event', entityId: event.updated.id, before: { employeeId: event.previousEmployeeId }, after: { employeeId }, ip });
      return serializeEvent(event.updated, true);
    },
  });

  r.add({
    method: 'delete',
    path: '/calendar/events/:id',
    tag: 'Calendar',
    summary: 'Cancel a calendar event and notify affected employees (employees: their own personal events)',
    permission: ['calendar.manage', 'calendar.view'],
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const manager = user.permissions.has('calendar.manage');
      const own = manager ? null : await linkedEmployeeId(user.id);
      const event = await prisma.$transaction(async (tx) => {
        const existing = await tx.calendarEvent.findUnique({ where: { id: params.id } });
        if (!existing || !canChange(existing, user, own)) throw notFound('Calendar event');
        await tx.calendarEvent.delete({ where: { id: existing.id } });
        if (manager) {
          const recipients = await activeRecipients(tx, existing.employeeId);
          await notifyEmployees(tx, recipients, { title: 'Event cancelled', message: `${existing.title} on ${toIsoDate(existing.eventDate)}`, kind: 'CALENDAR_EVENT', targetUrl: '/calendar' });
        }
        return existing;
      });
      await audit.write({ actorId: user.id, action: 'calendar.event_cancelled', entity: 'calendar_event', entityId: event.id, metadata: { employeeId: event.employeeId }, ip });
      return { message: 'Event cancelled and affected employees notified.' };
    },
  });

  r.add({
    method: 'get',
    path: '/employee-notifications',
    tag: 'Notifications',
    summary: 'List notifications for the linked employee',
    permission: 'notifications.view',
    handler: async ({ user }) => {
      const employeeId = (await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } }))?.employeeId;
      if (!employeeId) throw new AppError('INVALID_STATE', 'Your account must be linked to an employee record to view notifications.');
      const where = { employeeId };
      const [items, unreadCount] = await Promise.all([
        prisma.employeeNotification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
        prisma.employeeNotification.count({ where: { ...where, readAt: null } }),
      ]);
      return {
        unreadCount,
        items: items.map((item) => ({
          id: item.id,
          title: item.title,
          message: item.message,
          kind: item.kind,
          targetUrl: item.targetUrl,
          isRead: Boolean(item.readAt),
          createdAt: item.createdAt,
        })),
      };
    },
  });

  r.add({
    method: 'post',
    path: '/notifications/read-all',
    tag: 'Notifications',
    summary: 'Mark all linked employee notifications as read',
    permission: 'notifications.view',
    handler: async ({ user, ip }) => {
      const employeeId = (await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } }))?.employeeId;
      if (!employeeId) throw new AppError('INVALID_STATE', 'Your account must be linked to an employee record to manage notifications.');
      const result = await prisma.employeeNotification.updateMany({ where: { employeeId, readAt: null }, data: { readAt: new Date() } });
      await audit.write({ actorId: user.id, action: 'notification.read_all', entity: 'employee_notification', entityId: null, metadata: { count: result.count }, ip });
      return { updated: result.count };
    },
  });

  r.add({
    method: 'post',
    path: '/notifications/:id/read',
    tag: 'Notifications',
    summary: 'Mark one linked employee notification as read',
    permission: 'notifications.view',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const employeeId = (await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } }))?.employeeId;
      if (!employeeId) throw new AppError('INVALID_STATE', 'Your account must be linked to an employee record to manage notifications.');
      const result = await prisma.employeeNotification.updateMany({
        where: { id: params.id, employeeId },
        data: { readAt: new Date() },
      });
      if (!result.count) throw notFound('Notification');
      await audit.write({ actorId: user.id, action: 'notification.read', entity: 'employee_notification', entityId: params.id, ip });
      return { message: 'Notification marked as read.' };
    },
  });
}
