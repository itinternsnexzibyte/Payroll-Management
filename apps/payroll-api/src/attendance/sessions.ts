import { z } from 'zod';
import { AppError, idParam, isoDate, notFound, toIsoDate, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { notifyEmployees } from '../notifications';
import { notifyAttendance } from '../notify';

export const ATTENDANCE_HEARTBEAT_TIMEOUT_MS = 120_000;

const sessionInclude = { breaks: { orderBy: { startedAt: 'asc' } } } satisfies Prisma.AttendanceWorkSessionInclude;
type SessionRow = Prisma.AttendanceWorkSessionGetPayload<{ include: typeof sessionInclude }>;
const dayInclude = {
  employee: { select: { id: true, employeeCode: true, fullName: true } },
  workSessions: { include: sessionInclude, orderBy: { startedAt: 'asc' } },
} satisfies Prisma.AttendanceRecordInclude;
type DayRow = Prisma.AttendanceRecordGetPayload<{ include: typeof dayInclude }>;

const checkInBody = z.object({ locationConsent: z.boolean().default(false) });
const accessRequestBody = z.object({ reason: z.string().trim().min(10).max(2000) });
const reviewBody = z.object({ decision: z.enum(['APPROVED', 'REJECTED']) });
const locationBody = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(0).max(100_000).nullable().optional(),
});
const reviewQuery = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') });

function indiaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const toDbDate = (day: string) => new Date(`${day}T00:00:00.000Z`);

function indiaTime(value: Date | null | undefined) {
  return value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value) : null;
}

function dayBounds(day: Date) {
  const date = toIsoDate(day);
  const start = new Date(`${date}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function clippedDuration(start: Date, end: Date, from: Date, to: Date) {
  return Math.max(0, Math.min(end.getTime(), to.getTime()) - Math.max(start.getTime(), from.getTime()));
}

function workedMinutes(record: Pick<DayRow, 'attendanceDate' | 'workSessions' | 'workingMinutes'>, now: Date) {
  const { start, end } = dayBounds(record.attendanceDate);
  const intervals = record.workSessions
    .map((session) => [new Date(session.startedAt), new Date(session.endedAt ?? now)] as const)
    .map(([from, to]) => [Math.max(from.getTime(), start.getTime()), Math.min(to.getTime(), end.getTime())] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let active: [number, number] | null = null;
  for (const interval of intervals) {
    if (!active) active = [interval[0], interval[1]];
    else if (interval[0] <= active[1]) active[1] = Math.max(active[1], interval[1]);
    else {
      total += active[1] - active[0];
      active = [interval[0], interval[1]];
    }
  }
  if (active) total += active[1] - active[0];
  const breaks = record.workSessions.flatMap((session) =>
    session.breaks.map((br) => clippedDuration(new Date(br.startedAt), new Date(br.endedAt ?? now), start, end)),
  );
  return Math.max(0, Math.floor((total - breaks.reduce((sum, duration) => sum + duration, 0)) / 60_000));
}

function serializeSession(session: SessionRow) {
  const breaks = session.breaks.map((br) => ({
    id: br.id,
    startedAt: br.startedAt,
    endedAt: br.endedAt,
    durationMinutes: Math.max(0, Math.floor(((br.endedAt ?? new Date()).getTime() - br.startedAt.getTime()) / 60_000)),
  }));
  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastHeartbeatAt: session.lastHeartbeatAt,
    forcedCheckout: session.forcedCheckout,
    checkoutReason: session.checkoutReason,
    locationConsent: session.locationConsent,
    breaks,
  };
}

function serializeDay(day: DayRow, now = new Date()) {
  const sessions = day.workSessions.map(serializeSession);
  const active = day.workSessions.find((session) => !session.endedAt);
  const checkIns = day.workSessions.map((session) => session.startedAt);
  const checkOuts = day.workSessions.flatMap((session) => session.endedAt ? [session.endedAt] : []);
  const breakMinutes = day.workSessions.flatMap((session) => session.breaks).reduce((sum, br) =>
    sum + Math.max(0, Math.floor(((br.endedAt ?? now).getTime() - br.startedAt.getTime()) / 60_000)), 0);
  return {
    id: day.id,
    employeeId: day.employeeId,
    employeeCode: day.employee.employeeCode,
    employeeName: day.employee.fullName,
    attendanceDate: toIsoDate(day.attendanceDate),
    status: active ? (active.breaks.some((br) => !br.endedAt) ? 'ON_BREAK' : 'ONLINE') : day.status,
    loginTime: indiaTime(checkIns[0] ?? (day.loginTime ? new Date(`${toIsoDate(day.attendanceDate)}T${day.loginTime}:00+05:30`) : null)),
    logoutTime: active ? null : indiaTime(checkOuts.at(-1) ?? (day.logoutTime ? new Date(`${toIsoDate(day.attendanceDate)}T${day.logoutTime}:00+05:30`) : null)),
    workingMinutes: day.workSessions.length ? workedMinutes(day, now) : day.workingMinutes,
    checkInCount: day.workSessions.length,
    checkOutCount: checkOuts.length,
    breakMinutes,
    isOnline: Boolean(active),
    onBreak: Boolean(active?.breaks.some((br) => !br.endedAt)),
    sessions,
  };
}

async function linkedEmployee(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true, attendanceEnabled: true } });
  if (!user?.employeeId) throw new AppError('INVALID_STATE', 'Your account must be linked to an employee record to use attendance.');
  return { employeeId: user.employeeId, attendanceEnabled: user.attendanceEnabled };
}

async function activeSession(tx: Prisma.TransactionClient, employeeId: string) {
  return tx.attendanceWorkSession.findFirst({
    where: { employeeId, endedAt: null },
    include: sessionInclude,
    orderBy: { startedAt: 'desc' },
  });
}

async function refreshDailySummary(tx: Prisma.TransactionClient, recordId: string, now: Date) {
  const day = await tx.attendanceRecord.findUniqueOrThrow({ where: { id: recordId }, include: dayInclude });
  const allSessions = day.workSessions;
  const active = allSessions.find((session) => !session.endedAt);
  const first = allSessions[0]?.startedAt;
  const last = allSessions.flatMap((session) => session.endedAt ? [session.endedAt] : []).at(-1);
  await tx.attendanceRecord.update({
    where: { id: recordId },
    data: {
      status: 'PRESENT',
      loginTime: indiaTime(first) ?? day.loginTime,
      logoutTime: active ? null : indiaTime(last) ?? day.logoutTime,
      workingMinutes: workedMinutes(day, now),
    },
  });
}

function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function registerAttendanceSessionRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/attendance-sessions/me',
    tag: 'Attendance',
    summary: 'Get the linked employee’s attendance session status for today',
    permission: 'self.service',
    handler: async ({ user }) => {
      const linked = await linkedEmployee(user.id);
      const today = indiaDate();
      const day = await prisma.attendanceRecord.findUnique({
        where: { employeeId_attendanceDate: { employeeId: linked.employeeId, attendanceDate: toDbDate(today) } },
        include: dayInclude,
      });
      const pendingRequest = await prisma.attendanceAccessRequest.findFirst({
        where: { employeeId: linked.employeeId, status: 'PENDING' },
        select: { id: true, reason: true, createdAt: true },
      });
      return {
        attendanceEnabled: linked.attendanceEnabled,
        pendingRequest,
        day: day ? serializeDay(day) : null,
      };
    },
  });

  r.add({
    method: 'get',
    path: '/attendance-sessions/me/history',
    tag: 'Attendance',
    summary: 'List the linked employee’s attendance sessions and breaks by date range',
    permission: 'self.service',
    query: z.object({
      start: isoDate.optional(),
      end: isoDate.optional(),
    }).superRefine((query, ctx) => {
      if (query.start && query.end && query.start > query.end) {
        ctx.addIssue({ code: 'custom', path: ['end'], message: 'End date must be on or after the start date.' });
      }
    }),
    handler: async ({ user, query }) => {
      const linked = await linkedEmployee(user.id);
      const end = query.end ? toIsoDate(query.end)! : indiaDate();
      const start = query.start ? toIsoDate(query.start)! : indiaDate(new Date(new Date(`${end}T00:00:00+05:30`).getTime() - 30 * 24 * 60 * 60 * 1000));
      if (new Date(`${end}T00:00:00+05:30`).getTime() - new Date(`${start}T00:00:00+05:30`).getTime() > 90 * 24 * 60 * 60 * 1000) {
        throw new AppError('VALIDATION_ERROR', 'Attendance history range cannot exceed 90 days.');
      }
      const days = await prisma.attendanceRecord.findMany({
        where: { employeeId: linked.employeeId, attendanceDate: { gte: toDbDate(start), lte: toDbDate(end) } },
        include: dayInclude,
        orderBy: { attendanceDate: 'desc' },
        take: 100,
      });
      return days.map((day) => serializeDay(day));
    },
  });

  r.add({
    method: 'post',
    path: '/attendance-sessions/check-in',
    tag: 'Attendance',
    summary: 'Start an employee attendance session',
    permission: 'self.service',
    body: checkInBody,
    status: 201,
    handler: async ({ body, user, ip }) => {
      const linked = await linkedEmployee(user.id);
      if (!linked.attendanceEnabled) throw new AppError('FORBIDDEN', 'Attendance is disabled pending an administrator’s review of your reactivation request.');
      const now = new Date();
      const day = indiaDate(now);
      try {
        const result = await prisma.$transaction(async (tx) => {
          const record = await tx.attendanceRecord.upsert({
            where: { employeeId_attendanceDate: { employeeId: linked.employeeId, attendanceDate: toDbDate(day) } },
            create: { employeeId: linked.employeeId, attendanceDate: toDbDate(day), status: 'PRESENT', loginTime: indiaTime(now) },
            update: { status: 'PRESENT', logoutTime: null, updatedById: user.id },
          });
          const session = await tx.attendanceWorkSession.create({
            data: {
              attendanceRecordId: record.id,
              employeeId: linked.employeeId,
              startedAt: now,
              lastHeartbeatAt: now,
              locationConsent: body.locationConsent,
            },
            include: sessionInclude,
          });
          await refreshDailySummary(tx, record.id, now);
          await audit.tx(tx, { actorId: user.id, action: 'attendance.session_checked_in', entity: 'attendance_work_session', entityId: session.id, metadata: { locationConsent: body.locationConsent }, ip });
          return session;
        });
        return { session: serializeSession(result), serverTime: now };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new AppError('CONFLICT', 'An attendance session is already active. Check it out before starting another.');
        }
        throw error;
      }
    },
  });

  r.add({
    method: 'post',
    path: '/attendance-sessions/heartbeat',
    tag: 'Attendance',
    summary: 'Refresh the current attendance session heartbeat',
    permission: 'self.service',
    handler: async ({ user }) => {
      const linked = await linkedEmployee(user.id);
      const now = new Date();
      const active = await prisma.attendanceWorkSession.findFirst({ where: { employeeId: linked.employeeId, endedAt: null } });
      if (!active) return { active: false, attendanceEnabled: linked.attendanceEnabled, serverTime: now };
      await prisma.attendanceWorkSession.updateMany({ where: { id: active.id, endedAt: null }, data: { lastHeartbeatAt: now } });
      return { active: true, serverTime: now };
    },
  });

  r.add({
    method: 'post',
    path: '/attendance-sessions/check-out',
    tag: 'Attendance',
    summary: 'End the active attendance session and any running break',
    permission: 'self.service',
    handler: async ({ user, ip }) => {
      const linked = await linkedEmployee(user.id);
      const now = new Date();
      const day = await prisma.$transaction(async (tx) => {
        const session = await activeSession(tx, linked.employeeId);
        if (!session) throw new AppError('INVALID_STATE', 'There is no active attendance session to check out.');
        await tx.attendanceWorkSession.update({ where: { id: session.id }, data: { endedAt: now } });
        await tx.attendanceBreak.updateMany({ where: { sessionId: session.id, endedAt: null }, data: { endedAt: now } });
        await refreshDailySummary(tx, session.attendanceRecordId, now);
        await audit.tx(tx, { actorId: user.id, action: 'attendance.session_checked_out', entity: 'attendance_work_session', entityId: session.id, ip });
        return tx.attendanceRecord.findUniqueOrThrow({ where: { id: session.attendanceRecordId }, include: dayInclude });
      });
      return serializeDay(day, now);
    },
  });

  for (const action of ['start', 'end'] as const) {
    r.add({
      method: 'post',
      path: `/attendance-sessions/break-${action}`,
      tag: 'Attendance',
      summary: action === 'start' ? 'Start an attendance break' : 'End the active attendance break',
      permission: 'self.service',
      handler: async ({ user, ip }) => {
        const linked = await linkedEmployee(user.id);
        const now = new Date();
        const session = await prisma.$transaction(async (tx) => {
          const current = await activeSession(tx, linked.employeeId);
          if (!current) throw new AppError('INVALID_STATE', 'Check in before managing a break.');
          if (action === 'start') {
            if (current.breaks.some((br) => !br.endedAt)) throw new AppError('CONFLICT', 'A break is already active.');
            await tx.attendanceBreak.create({ data: { sessionId: current.id, startedAt: now } });
          } else {
            const running = current.breaks.find((br) => !br.endedAt);
            if (!running) throw new AppError('INVALID_STATE', 'There is no active break.');
            await tx.attendanceBreak.update({ where: { id: running.id }, data: { endedAt: now } });
          }
          await tx.attendanceWorkSession.update({ where: { id: current.id }, data: { lastHeartbeatAt: now } });
          await refreshDailySummary(tx, current.attendanceRecordId, now);
          await audit.tx(tx, { actorId: user.id, action: action === 'start' ? 'attendance.break_started' : 'attendance.break_ended', entity: 'attendance_work_session', entityId: current.id, ip });
          return tx.attendanceWorkSession.findUniqueOrThrow({ where: { id: current.id }, include: sessionInclude });
        });
        return serializeSession(session);
      },
    });
  }

  r.add({
    method: 'put',
    path: '/attendance-sessions/location-consent',
    tag: 'Attendance',
    summary: 'Enable or disable optional location capture for the active session',
    permission: 'self.service',
    body: z.object({ enabled: z.boolean() }),
    handler: async ({ body, user, ip }) => {
      const linked = await linkedEmployee(user.id);
      const session = await prisma.attendanceWorkSession.findFirst({ where: { employeeId: linked.employeeId, endedAt: null } });
      if (!session) throw new AppError('INVALID_STATE', 'There is no active attendance session.');
      await prisma.attendanceWorkSession.update({ where: { id: session.id }, data: { locationConsent: body.enabled } });
      await audit.write({ actorId: user.id, action: body.enabled ? 'attendance.location_consent_enabled' : 'attendance.location_consent_disabled', entity: 'attendance_work_session', entityId: session.id, ip });
      return { locationConsent: body.enabled };
    },
  });

  r.add({
    method: 'post',
    path: '/attendance-sessions/location',
    tag: 'Attendance',
    summary: 'Record a location point for an active session after employee consent',
    permission: 'self.service',
    body: locationBody,
    handler: async ({ body, user }) => {
      const linked = await linkedEmployee(user.id);
      const session = await prisma.attendanceWorkSession.findFirst({
        where: { employeeId: linked.employeeId, endedAt: null },
        include: { locations: { orderBy: { capturedAt: 'desc' }, take: 1 } },
      });
      if (!session) throw new AppError('INVALID_STATE', 'There is no active attendance session.');
      if (!session.locationConsent) throw new AppError('FORBIDDEN', 'Location capture is disabled for this session.');
      const previous = session.locations[0];
      const distanceFromPrev = previous ? haversineMeters(
        { latitude: Number(previous.latitude), longitude: Number(previous.longitude) },
        { latitude: body.latitude, longitude: body.longitude },
      ) : 0;
      const first = previous ? await prisma.attendanceLocation.findFirst({
        where: { sessionId: session.id },
        orderBy: { capturedAt: 'asc' },
      }) : null;
      const distanceFromStart = first ? haversineMeters(
        { latitude: Number(first.latitude), longitude: Number(first.longitude) },
        { latitude: body.latitude, longitude: body.longitude },
      ) : 0;
      const now = new Date();
      const point = await prisma.$transaction(async (tx) => {
        const created = await tx.attendanceLocation.create({
          data: {
            sessionId: session.id,
            capturedAt: now,
            latitude: body.latitude,
            longitude: body.longitude,
            accuracyMeters: body.accuracyMeters ?? null,
            distanceFromPrev,
            distanceFromStart,
          },
        });
        await tx.attendanceWorkSession.update({ where: { id: session.id }, data: { lastHeartbeatAt: now } });
        return created;
      });
      return { id: point.id, capturedAt: point.capturedAt, accuracyMeters: point.accuracyMeters, distanceFromStartMeters: point.distanceFromStart };
    },
  });

  r.add({
    method: 'get',
    path: '/attendance-sessions/me/locations',
    tag: 'Attendance',
    summary: 'List the linked employee’s consented attendance location points',
    permission: 'self.service',
    query: z.object({ date: isoDate.optional() }),
    handler: async ({ user, query }) => {
      const linked = await linkedEmployee(user.id);
      const rows = await prisma.attendanceLocation.findMany({
        where: { session: { employeeId: linked.employeeId, locationConsent: true, ...(query.date ? { attendanceRecord: { attendanceDate: query.date } } : {}) } },
        orderBy: { capturedAt: 'desc' },
        take: 500,
      });
      return rows.map((point) => ({
        id: point.id,
        capturedAt: point.capturedAt,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracyMeters: point.accuracyMeters,
        distanceFromStartMeters: point.distanceFromStart,
        distanceFromPreviousMeters: point.distanceFromPrev,
      }));
    },
  });

  r.add({
    method: 'post',
    path: '/attendance-sessions/access-request',
    tag: 'Attendance',
    summary: 'Request attendance reactivation after an automatic checkout',
    permission: 'self.service',
    body: accessRequestBody,
    status: 201,
    handler: async ({ body, user, ip }) => {
      const linked = await linkedEmployee(user.id);
      if (linked.attendanceEnabled) return { status: 'APPROVED', message: 'Attendance is already enabled.' };
      const pending = await prisma.attendanceAccessRequest.findFirst({ where: { employeeId: linked.employeeId, status: 'PENDING' } });
      if (pending) return { id: pending.id, status: pending.status, message: 'Your request is already waiting for administrator review.' };
      const session = await prisma.attendanceWorkSession.findFirst({ where: { employeeId: linked.employeeId, forcedCheckout: true }, orderBy: { endedAt: 'desc' } });
      const request = await prisma.attendanceAccessRequest.create({
        data: { employeeId: linked.employeeId, sessionId: session?.id, reason: body.reason },
      });
      await audit.write({ actorId: user.id, action: 'attendance.access_requested', entity: 'attendance_access_request', entityId: request.id, ip });
      void notifyAttendance(linked.employeeId, 'ACCESS_REQUESTED');
      return { id: request.id, status: request.status, message: 'Attendance reactivation request sent for administrator review.' };
    },
  });

  r.add({
    method: 'get',
    path: '/attendance-access-requests',
    tag: 'Attendance',
    summary: 'List employee attendance reactivation requests',
    permission: 'attendance.manage',
    query: reviewQuery,
    handler: async ({ query }) => prisma.attendanceAccessRequest.findMany({
      where: { status: query.status },
      include: { employee: { select: { id: true, employeeCode: true, fullName: true } }, session: { select: { id: true, startedAt: true, endedAt: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
  });

  r.add({
    method: 'post',
    path: '/attendance-access-requests/:id/review',
    tag: 'Attendance',
    summary: 'Approve or reject an employee attendance reactivation request',
    permission: 'attendance.manage',
    params: idParam,
    body: reviewBody,
    handler: async ({ params, body, user, ip }) => {
      const request = await prisma.$transaction(async (tx) => {
        const existing = await tx.attendanceAccessRequest.findUnique({ where: { id: params.id } });
        if (!existing) throw notFound('Attendance reactivation request');
        if (existing.status !== 'PENDING') throw new AppError('CONFLICT', 'This request has already been reviewed.');
        const reviewed = await tx.attendanceAccessRequest.update({
          where: { id: existing.id },
          data: { status: body.decision, reviewedById: user.id, reviewedAt: new Date() },
          include: { employee: { select: { employeeCode: true, fullName: true } } },
        });
        await tx.user.updateMany({ where: { employeeId: existing.employeeId }, data: { attendanceEnabled: body.decision === 'APPROVED' } });
        await notifyEmployees(tx, [existing.employeeId], {
          title: body.decision === 'APPROVED' ? 'Attendance access restored' : 'Attendance access request declined',
          message: body.decision === 'APPROVED' ? 'An administrator approved your attendance reactivation request.' : 'An administrator declined your attendance reactivation request.',
          kind: 'ATTENDANCE_ACCESS',
          targetUrl: '/my/attendance',
        });
        await audit.tx(tx, { actorId: user.id, action: body.decision === 'APPROVED' ? 'attendance.access_approved' : 'attendance.access_rejected', entity: 'attendance_access_request', entityId: existing.id, after: { employeeId: existing.employeeId }, ip });
        return reviewed;
      });
      void notifyAttendance(request.employeeId, body.decision === 'APPROVED' ? 'ACCESS_APPROVED' : 'ACCESS_REJECTED');
      return request;
    },
  });

  r.add({
    method: 'get',
    path: '/attendance-sessions',
    tag: 'Attendance',
    summary: 'List attendance sessions, breaks and daily work totals',
    permission: 'attendance.view',
    query: z.object({
      date: isoDate.optional(),
      start: isoDate.optional(),
      end: isoDate.optional(),
      employeeId: z.string().uuid().optional(),
    }).superRefine((query, ctx) => {
      if (query.date && (query.start || query.end)) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Use either a single date or a date range.' });
      if (Boolean(query.start) !== Boolean(query.end)) ctx.addIssue({ code: 'custom', path: ['end'], message: 'Provide both start and end dates.' });
      if (query.start && query.end) {
        const start = toIsoDate(query.start)!;
        const end = toIsoDate(query.end)!;
        const range = toDbDate(end).getTime() - toDbDate(start).getTime();
        if (range < 0) ctx.addIssue({ code: 'custom', path: ['end'], message: 'End date must be on or after start date.' });
        if (range > 30 * 24 * 60 * 60 * 1000) ctx.addIssue({ code: 'custom', path: ['end'], message: 'Attendance report range cannot exceed 31 days.' });
      }
    }),
    handler: async ({ query }) => {
      const date = query.date ? toIsoDate(query.date)! : indiaDate();
      const start = query.start ? toIsoDate(query.start)! : date;
      const end = query.end ? toIsoDate(query.end)! : date;
      const days = await prisma.attendanceRecord.findMany({
        where: {
          attendanceDate: query.start && query.end ? { gte: toDbDate(start), lte: toDbDate(end) } : toDbDate(date),
          ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        },
        include: dayInclude,
        orderBy: query.start ? [{ attendanceDate: 'asc' }, { employee: { employeeCode: 'asc' } }] : { employee: { employeeCode: 'asc' } },
        take: query.start ? 15_500 : 500,
      });
      return days.map((day) => serializeDay(day));
    },
  });

  r.add({
    method: 'get',
    path: '/attendance-sessions/:id/locations',
    tag: 'Attendance',
    summary: 'View consented location history for an attendance session',
    permission: 'attendance.location.view',
    params: idParam,
    handler: async ({ params }) => {
      const session = await prisma.attendanceWorkSession.findUnique({ where: { id: params.id }, select: { id: true, locationConsent: true } });
      if (!session) throw notFound('Attendance session');
      if (!session.locationConsent) throw new AppError('INVALID_STATE', 'Location was not enabled for this attendance session.');
      const rows = await prisma.attendanceLocation.findMany({ where: { sessionId: session.id }, orderBy: { capturedAt: 'asc' }, take: 500 });
      return rows.map((point) => ({
        id: point.id,
        capturedAt: point.capturedAt,
        latitude: point.latitude,
        longitude: point.longitude,
        accuracyMeters: point.accuracyMeters,
        distanceFromStartMeters: point.distanceFromStart,
        distanceFromPreviousMeters: point.distanceFromPrev,
      }));
    },
  });
}

export async function runAttendanceWatchdog(now = new Date(), timeoutMs = ATTENDANCE_HEARTBEAT_TIMEOUT_MS) {
  const cutoff = new Date(now.getTime() - timeoutMs);
  const stale = await prisma.attendanceWorkSession.findMany({
    where: { endedAt: null, lastHeartbeatAt: { lte: cutoff } },
    select: { id: true, attendanceRecordId: true, employeeId: true, lastHeartbeatAt: true },
    take: 100,
  });
  let forced = 0;
  for (const candidate of stale) {
    const endedAt = candidate.lastHeartbeatAt ?? cutoff;
    const changed = await prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceWorkSession.updateMany({
        where: { id: candidate.id, endedAt: null, lastHeartbeatAt: { lte: cutoff } },
        data: { endedAt, forcedCheckout: true, checkoutReason: 'HEARTBEAT_TIMEOUT' },
      });
      if (!updated.count) return false;
      await tx.attendanceBreak.updateMany({ where: { sessionId: candidate.id, endedAt: null }, data: { endedAt } });
      const user = await tx.user.findUnique({ where: { employeeId: candidate.employeeId }, select: { id: true } });
      if (user) await tx.user.update({ where: { id: user.id }, data: { attendanceEnabled: false } });
      await refreshDailySummary(tx, candidate.attendanceRecordId, endedAt);
      await tx.attendanceRecord.update({ where: { id: candidate.attendanceRecordId }, data: { status: 'PRESENT', logoutTime: indiaTime(endedAt) } });
      await tx.attendanceAccessRequest.updateMany({
        where: { employeeId: candidate.employeeId, status: 'PENDING' },
        data: { sessionId: candidate.id },
      });
      await notifyEmployees(tx, [candidate.employeeId], {
        title: 'Attendance session ended automatically',
        message: 'Your attendance session stopped sending heartbeats and was automatically checked out. Submit a reason in My attendance to request access again.',
        kind: 'ATTENDANCE_FORCED_CHECKOUT',
        targetUrl: '/my/attendance',
      });
      await audit.tx(tx, {
        actorId: null,
        action: 'attendance.session_forced_checkout',
        entity: 'attendance_work_session',
        entityId: candidate.id,
        metadata: { reason: 'HEARTBEAT_TIMEOUT' },
      });
      return true;
    });
    if (changed) {
      forced += 1;
      void notifyAttendance(candidate.employeeId, 'FORCED_CHECKOUT');
    }
  }
  return forced;
}

export async function runAttendanceWatchdogSafely(logger: { error: (obj: object, message: string) => void }) {
  try {
    const forced = await runAttendanceWatchdog();
    if (forced) logger.error({ forced }, 'Attendance sessions automatically checked out after heartbeat timeout');
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : String(error) }, 'Attendance session watchdog failed');
  }
}
