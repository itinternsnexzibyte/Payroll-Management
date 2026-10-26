import { z } from 'zod';
import { AppError, idParam, isoDate, notFound, toIsoDate, type ApiRegistry } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';

/** Admin daily attendance register: one record per employee per day. */

const attendanceTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time in HH:MM format.').nullable().optional().or(z.literal('').transform(() => null));
const attendanceRecordBody = z
  .object({
    employeeId: z.string().uuid(),
    attendanceDate: isoDate,
    loginTime: attendanceTime,
    logoutTime: attendanceTime,
    status: z.enum(['PRESENT', 'ABSENT', 'LEAVE']).default('PRESENT'),
    workingMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.loginTime && v.logoutTime && v.logoutTime < v.loginTime) {
      ctx.addIssue({ code: 'custom', path: ['logoutTime'], message: 'Check-out must be after check-in on the selected day.' });
    }
  });

type AttendanceRecordRow = Prisma.AttendanceRecordGetPayload<{ include: { employee: { select: { id: true; employeeCode: true; fullName: true } } } }>;
const serializeAttendanceRecord = (r: AttendanceRecordRow) => ({
  id: r.id,
  employeeId: r.employee.id,
  employeeCode: r.employee.employeeCode,
  employeeName: r.employee.fullName,
  attendanceDate: toIsoDate(r.attendanceDate),
  loginTime: r.loginTime,
  logoutTime: r.logoutTime,
  status: r.status,
  workingMinutes: r.workingMinutes,
});

export function registerAttendanceRoutes(r: ApiRegistry) {
  // -------------------------------------------------------------- Admin daily attendance register
  r.add({
    method: 'get',
    path: '/attendance-records',
    tag: 'Attendance',
    summary: 'List employee attendance records by date and employee',
    permission: 'attendance.view',
    query: z.object({ date: isoDate.optional(), employeeId: z.string().uuid().optional() }),
    handler: async ({ query }) => {
      const rows = await prisma.attendanceRecord.findMany({
        where: { ...(query.date ? { attendanceDate: query.date } : {}), ...(query.employeeId ? { employeeId: query.employeeId } : {}) },
        include: { employee: { select: { id: true, employeeCode: true, fullName: true } } },
        orderBy: [{ attendanceDate: 'desc' }, { employee: { employeeCode: 'asc' } }],
        take: 500,
      });
      return rows.map(serializeAttendanceRecord);
    },
  });

  r.add({
    method: 'post',
    path: '/attendance-records',
    tag: 'Attendance',
    summary: 'Create or update an employee attendance record for one day',
    permission: 'attendance.manage',
    body: attendanceRecordBody,
    handler: async ({ body, user, ip }) => {
      const employee = await prisma.employee.findUnique({ where: { id: body.employeeId }, select: { id: true, employeeCode: true } });
      if (!employee) throw notFound('Employee');
      const where = { employeeId_attendanceDate: { employeeId: body.employeeId, attendanceDate: body.attendanceDate } };
      const before = await prisma.attendanceRecord.findUnique({ where });
      if (before && await prisma.attendanceWorkSession.count({ where: { attendanceRecordId: before.id } })) {
        throw new AppError('INVALID_STATE', 'Session-tracked attendance cannot be replaced through manual entry.');
      }
      const record = await prisma.attendanceRecord.upsert({
        where,
        create: { ...body, workingMinutes: body.workingMinutes ?? null, createdById: user.id, updatedById: user.id },
        update: { ...body, workingMinutes: body.workingMinutes ?? null, updatedById: user.id },
        include: { employee: { select: { id: true, employeeCode: true, fullName: true } } },
      });
      await audit.write({
        actorId: user.id,
        action: before ? 'attendance.record_updated' : 'attendance.record_created',
        entity: 'attendance_record',
        entityId: record.id,
        before: before ? { status: before.status, loginTime: before.loginTime, logoutTime: before.logoutTime, workingMinutes: before.workingMinutes } : undefined,
        after: { employeeCode: employee.employeeCode, attendanceDate: toIsoDate(record.attendanceDate), status: record.status, loginTime: record.loginTime, logoutTime: record.logoutTime, workingMinutes: record.workingMinutes },
        ip,
      });
      return serializeAttendanceRecord(record);
    },
  });

  r.add({
    method: 'put',
    path: '/attendance-records/:id',
    tag: 'Attendance',
    summary: 'Edit an employee daily attendance record',
    permission: 'attendance.manage',
    params: idParam,
    body: attendanceRecordBody,
    handler: async ({ params, body, user, ip }) => {
      const before = await prisma.attendanceRecord.findUnique({ where: { id: params.id } });
      if (!before) throw notFound('Attendance record');
      if (await prisma.attendanceWorkSession.count({ where: { attendanceRecordId: before.id } })) {
        throw new AppError('INVALID_STATE', 'Session-tracked attendance cannot be edited through manual entry.');
      }
      const employee = await prisma.employee.findUnique({ where: { id: body.employeeId }, select: { id: true, employeeCode: true } });
      if (!employee) throw notFound('Employee');
      let record: AttendanceRecordRow;
      try {
        record = await prisma.attendanceRecord.update({
          where: { id: params.id },
          data: { ...body, workingMinutes: body.workingMinutes ?? null, updatedById: user.id },
          include: { employee: { select: { id: true, employeeCode: true, fullName: true } } },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new AppError('CONFLICT', 'An attendance record already exists for this employee and date.');
        }
        throw e;
      }
      await audit.write({
        actorId: user.id,
        action: 'attendance.record_updated',
        entity: 'attendance_record',
        entityId: record.id,
        before: { employeeId: before.employeeId, attendanceDate: toIsoDate(before.attendanceDate), status: before.status, loginTime: before.loginTime, logoutTime: before.logoutTime, workingMinutes: before.workingMinutes },
        after: { employeeCode: employee.employeeCode, attendanceDate: toIsoDate(record.attendanceDate), status: record.status, loginTime: record.loginTime, logoutTime: record.logoutTime, workingMinutes: record.workingMinutes },
        ip,
      });
      return serializeAttendanceRecord(record);
    },
  });

  r.add({
    method: 'delete',
    path: '/attendance-records/:id',
    tag: 'Attendance',
    summary: 'Delete an employee daily attendance record',
    permission: 'attendance.manage',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const record = await prisma.attendanceRecord.findUnique({ where: { id: params.id }, include: { employee: { select: { employeeCode: true } } } });
      if (!record) throw notFound('Attendance record');
      if (await prisma.attendanceWorkSession.count({ where: { attendanceRecordId: record.id, endedAt: null } })) {
        throw new AppError('INVALID_STATE', 'Check out the active attendance session before deleting this record.');
      }
      await prisma.attendanceRecord.delete({ where: { id: record.id } });
      await audit.write({
        actorId: user.id,
        action: 'attendance.record_deleted',
        entity: 'attendance_record',
        entityId: record.id,
        before: { employeeCode: record.employee.employeeCode, attendanceDate: toIsoDate(record.attendanceDate), status: record.status, loginTime: record.loginTime, logoutTime: record.logoutTime, workingMinutes: record.workingMinutes },
        ip,
      });
      return { deleted: true };
    },
  });
}
