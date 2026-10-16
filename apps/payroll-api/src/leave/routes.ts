/**
 * Leave management: leave types with yearly allowances, per-employee overrides, requests and
 * approvals. Approved unpaid leave feeds the mapped payroll input ("Fill from leave, advances and
 * bonuses"); how unpaid days affect pay is decided by the client's formula, not here.
 */
import { z } from 'zod';
import { AppError, dec, idParam, isoDate, listQuery, money, notFound, skipTake, toIsoDate, toPage, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { notifyLeaveDecision } from '../notify';

const VIEW = ['leave.view', 'leave.manage', 'leave.approve'];
const daysValue = z.string().trim().regex(/^\d{1,3}(\.5|\.0)?$/, 'Use whole or half days, for example 1 or 1.5.');

const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1));
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0));
const spanDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;

type RequestRow = Prisma.LeaveRequestGetPayload<{ include: { leaveType: true; employee: { select: { id: true; employeeCode: true; fullName: true } } } }>;
export const serializeLeave = (r: RequestRow) => ({
  id: r.id,
  employee: { id: r.employee.id, code: r.employee.employeeCode, name: r.employee.fullName },
  leaveType: { id: r.leaveType.id, code: r.leaveType.code, name: r.leaveType.name, paid: r.leaveType.paid },
  startDate: toIsoDate(r.startDate),
  endDate: toIsoDate(r.endDate),
  days: r.days.toString(),
  reason: r.reason,
  status: r.status,
  requestedByName: r.requestedByName,
  decidedByName: r.decidedByName,
  decidedAt: r.decidedAt,
  decisionNote: r.decisionNote,
  createdAt: r.createdAt,
});
const include = { leaveType: true, employee: { select: { id: true, employeeCode: true, fullName: true } } } as const;

/** Allowance for an employee, type and year: the override if set, else the type's yearly days. */
async function allowance(employeeId: string, leaveTypeId: string, year: number, typeDays: Prisma.Decimal | null) {
  const o = await prisma.leaveEntitlement.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } } });
  return o ? o.days : typeDays;
}

/** Days already used or requested this year (approved + pending), optionally excluding one request. */
async function usedDays(employeeId: string, leaveTypeId: string, year: number, excludeId?: string) {
  const agg = await prisma.leaveRequest.aggregate({
    where: { employeeId, leaveTypeId, status: { in: ['APPROVED', 'REQUESTED'] }, startDate: { gte: monthStart(year, 1), lte: monthEnd(year, 12) }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    _sum: { days: true },
  });
  return agg._sum.days ?? new Prisma.Decimal(0);
}

export const requestBody = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate,
  days: daysValue,
  reason: z.string().trim().max(500).optional(),
});

/** Validates and creates a leave request. Used by staff and by employee self-service. */
export async function createLeaveRequest(user: AuthUser, employeeId: string, body: z.infer<typeof requestBody>, ip: string | null) {
  const [emp, type] = await Promise.all([prisma.employee.findUnique({ where: { id: employeeId } }), prisma.leaveType.findUnique({ where: { id: body.leaveTypeId } })]);
  if (!emp) throw notFound('Employee');
  if (!type || !type.active) throw new AppError('VALIDATION_ERROR', 'Choose an active leave type.', { fields: [{ path: 'leaveTypeId', message: 'Not available.' }] });
  const fields: { path: string; message: string }[] = [];
  if (body.endDate < body.startDate) fields.push({ path: 'endDate', message: 'The end date is before the start date.' });
  else if (body.startDate.getUTCFullYear() !== body.endDate.getUTCFullYear() || body.startDate.getUTCMonth() !== body.endDate.getUTCMonth()) {
    fields.push({ path: 'endDate', message: 'A request must stay within one month. Split longer leave into one request per month.' });
  }
  const days = dec(body.days);
  if (days.lte(0)) fields.push({ path: 'days', message: 'Enter at least half a day.' });
  if (!fields.length && days.gt(spanDays(body.startDate, body.endDate))) fields.push({ path: 'days', message: `At most ${spanDays(body.startDate, body.endDate)} day(s) for these dates.` });
  if (body.startDate < emp.joiningDate) fields.push({ path: 'startDate', message: 'Before the employee joined.' });
  if (emp.exitDate && body.endDate > emp.exitDate) fields.push({ path: 'endDate', message: 'After the employee left.' });
  if (fields.length) throw new AppError('VALIDATION_ERROR', 'Please correct the highlighted fields.', { fields });

  const overlap = await prisma.leaveRequest.findFirst({ where: { employeeId, status: { in: ['REQUESTED', 'APPROVED'] }, startDate: { lte: body.endDate }, endDate: { gte: body.startDate } } });
  if (overlap) throw new AppError('CONFLICT', `These dates overlap another ${overlap.status === 'APPROVED' ? 'approved' : 'pending'} request (${toIsoDate(overlap.startDate)} to ${toIsoDate(overlap.endDate)}).`);

  const year = body.startDate.getUTCFullYear();
  const limit = await allowance(employeeId, type.id, year, type.annualDays);
  if (limit !== null) {
    const used = await usedDays(employeeId, type.id, year);
    if (used.add(days).gt(limit)) {
      throw new AppError('VALIDATION_ERROR', `Not enough ${type.name} left for ${year}: ${money(dec(limit).sub(used), 1)} day(s) remaining including pending requests.`, { fields: [{ path: 'days', message: 'More than the remaining allowance.' }] });
    }
  }
  const created = await prisma.leaveRequest.create({
    data: { employeeId, leaveTypeId: type.id, startDate: body.startDate, endDate: body.endDate, days: new Prisma.Decimal(body.days), reason: body.reason || null, requestedById: user.id, requestedByName: user.name },
    include,
  });
  await audit.write({ actorId: user.id, action: 'leave.requested', entity: 'leave_request', entityId: created.id, after: { employee: emp.employeeCode, type: type.code, startDate: toIsoDate(created.startDate), endDate: toIsoDate(created.endDate), days: body.days }, ip });
  return serializeLeave(created);
}

/** Approved unpaid leave days per employee for a payroll month (used to fill payroll inputs). */
export async function unpaidLeaveDays(year: number, month: number, employeeIds: string[]) {
  const rows = await prisma.leaveRequest.groupBy({
    by: ['employeeId'],
    where: { employeeId: { in: employeeIds }, status: 'APPROVED', leaveType: { paid: false }, startDate: { gte: monthStart(year, month), lte: monthEnd(year, month) } },
    _sum: { days: true },
  });
  return new Map(rows.map((r) => [r.employeeId, r._sum.days ?? new Prisma.Decimal(0)]));
}

/** Balances for one employee and year, per active leave type. */
export async function balancesFor(employeeId: string, year: number) {
  const types = await prisma.leaveType.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  const out = [];
  for (const t of types) {
    const limit = await allowance(employeeId, t.id, year, t.annualDays);
    const [approved, pending] = await Promise.all(
      (['APPROVED', 'REQUESTED'] as const).map(async (status) =>
        (
          await prisma.leaveRequest.aggregate({ where: { employeeId, leaveTypeId: t.id, status, startDate: { gte: monthStart(year, 1), lte: monthEnd(year, 12) } }, _sum: { days: true } })
        )._sum.days ?? new Prisma.Decimal(0),
      ),
    );
    out.push({
      leaveType: { id: t.id, code: t.code, name: t.name, paid: t.paid },
      allowance: limit === null ? null : limit.toString(),
      approved: approved.toString(),
      pending: pending.toString(),
      remaining: limit === null ? null : dec(limit).sub(approved).sub(pending).toString(),
    });
  }
  return out;
}

export function registerLeaveRoutes(r: ApiRegistry) {
  // ---- Leave types
  const typeBody = z.object({
    code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Use upper-case letters, digits and underscores (e.g. CL).'),
    name: z.string().trim().min(2).max(60),
    paid: z.boolean(),
    annualDays: z.string().trim().regex(/^\d{1,3}(\.\d)?$/, 'Enter days per year, e.g. 12').nullable().optional(),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(999).default(0),
  });
  r.add({
    method: 'get',
    path: '/leave/types',
    tag: 'Leave',
    summary: 'Leave types',
    permission: [...VIEW, 'self.service'],
    handler: async () => (await prisma.leaveType.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map((t) => ({ ...t, annualDays: t.annualDays?.toString() ?? null })),
  });
  r.add({
    method: 'post',
    path: '/leave/types',
    tag: 'Leave',
    summary: 'Create a leave type',
    permission: 'leave.manage',
    status: 201,
    body: typeBody,
    handler: async ({ body, user, ip }) => {
      if (await prisma.leaveType.findUnique({ where: { code: body.code } })) throw new AppError('CONFLICT', `Leave type ${body.code} already exists.`, { fields: [{ path: 'code', message: 'Already used.' }] });
      const t = await prisma.leaveType.create({ data: { ...body, annualDays: body.annualDays ? new Prisma.Decimal(body.annualDays) : null } });
      await audit.write({ actorId: user.id, action: 'leave.type_created', entity: 'leave_type', entityId: t.id, after: { code: t.code, name: t.name, paid: t.paid, annualDays: body.annualDays ?? null }, ip });
      return { ...t, annualDays: t.annualDays?.toString() ?? null };
    },
  });
  r.add({
    method: 'put',
    path: '/leave/types/:id',
    tag: 'Leave',
    summary: 'Edit or deactivate a leave type (the code cannot change)',
    permission: 'leave.manage',
    params: idParam,
    body: typeBody.omit({ code: true }).partial(),
    handler: async ({ params, body, user, ip }) => {
      const before = await prisma.leaveType.findUnique({ where: { id: params.id } });
      if (!before) throw notFound('Leave type');
      const t = await prisma.leaveType.update({ where: { id: params.id }, data: { ...body, ...(body.annualDays !== undefined ? { annualDays: body.annualDays ? new Prisma.Decimal(body.annualDays) : null } : {}) } });
      await audit.write({ actorId: user.id, action: 'leave.type_updated', entity: 'leave_type', entityId: t.id, before: { name: before.name, paid: before.paid, annualDays: before.annualDays?.toString() ?? null, active: before.active }, after: { name: t.name, paid: t.paid, annualDays: t.annualDays?.toString() ?? null, active: t.active }, ip });
      return { ...t, annualDays: t.annualDays?.toString() ?? null };
    },
  });

  // ---- Allowance overrides and balances
  r.add({
    method: 'put',
    path: '/leave/entitlements',
    tag: 'Leave',
    summary: "Set an employee's yearly allowance for a leave type (overrides the type default)",
    permission: 'leave.manage',
    body: z.object({ employeeId: z.string().uuid(), leaveTypeId: z.string().uuid(), year: z.number().int().min(2000).max(2100), days: z.string().trim().regex(/^\d{1,3}(\.\d)?$/, 'Enter days, e.g. 12') }),
    handler: async ({ body, user, ip }) => {
      const key = { employeeId_leaveTypeId_year: { employeeId: body.employeeId, leaveTypeId: body.leaveTypeId, year: body.year } };
      const before = await prisma.leaveEntitlement.findUnique({ where: key });
      const saved = await prisma.leaveEntitlement.upsert({ where: key, create: { ...key.employeeId_leaveTypeId_year, days: new Prisma.Decimal(body.days), updatedById: user.id }, update: { days: new Prisma.Decimal(body.days), updatedById: user.id } });
      await audit.write({ actorId: user.id, action: 'leave.entitlement_set', entity: 'employee', entityId: body.employeeId, before: before ? { days: before.days.toString() } : undefined, after: { days: body.days, leaveTypeId: body.leaveTypeId, year: body.year }, ip });
      return { ...saved, days: saved.days.toString() };
    },
  });
  r.add({
    method: 'get',
    path: '/leave/balances',
    tag: 'Leave',
    summary: 'Leave balances per employee and type for a year',
    permission: VIEW,
    query: z.object({ year: z.coerce.number().int().min(2000).max(2100), employeeId: z.string().uuid().optional(), search: z.string().trim().max(100).optional() }),
    handler: async ({ query }) => {
      const employees = await prisma.employee.findMany({
        where: { ...(query.employeeId ? { id: query.employeeId } : { status: 'ACTIVE' }), ...(query.search ? { OR: [{ employeeCode: { contains: query.search, mode: 'insensitive' } }, { fullName: { contains: query.search, mode: 'insensitive' } }] } : {}) },
        orderBy: { employeeCode: 'asc' },
        take: 300,
      });
      return Promise.all(employees.map(async (e) => ({ employee: { id: e.id, code: e.employeeCode, name: e.fullName }, balances: await balancesFor(e.id, query.year) })));
    },
  });

  // ---- Requests
  r.add({
    method: 'get',
    path: '/leave/requests',
    tag: 'Leave',
    summary: 'Leave requests (filter by status, employee, month)',
    permission: VIEW,
    query: listQuery(['startDate', 'createdAt'], 'startDate', {
      status: z.enum(['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
      employeeId: z.string().uuid().optional(),
      year: z.coerce.number().int().min(2000).max(2100).optional(),
      month: z.coerce.number().int().min(1).max(12).optional(),
    }),
    handler: async ({ query }) => {
      const where: Prisma.LeaveRequestWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.year && query.month ? { startDate: { gte: monthStart(query.year, query.month), lte: monthEnd(query.year, query.month) } } : query.year ? { startDate: { gte: monthStart(query.year, 1), lte: monthEnd(query.year, 12) } } : {}),
        ...(query.search ? { employee: { OR: [{ employeeCode: { contains: query.search, mode: 'insensitive' } }, { fullName: { contains: query.search, mode: 'insensitive' } }] } } : {}),
      };
      const [total, rows, pending] = await Promise.all([
        prisma.leaveRequest.count({ where }),
        prisma.leaveRequest.findMany({ where, include, orderBy: [{ [query.sortBy]: query.sortDir }, { id: 'asc' }], ...skipTake(query.page, query.pageSize) }),
        prisma.leaveRequest.count({ where: { status: 'REQUESTED' } }),
      ]);
      return { ...toPage(rows.map(serializeLeave), total, query.page, query.pageSize), pendingCount: pending };
    },
  });
  r.add({
    method: 'post',
    path: '/leave/requests',
    tag: 'Leave',
    summary: 'Record a leave request for an employee (one calendar month at most)',
    permission: 'leave.manage',
    status: 201,
    body: requestBody.extend({ employeeId: z.string().uuid() }),
    handler: async ({ body, user, ip }) => createLeaveRequest(user, body.employeeId, body, ip),
  });

  for (const action of ['approve', 'reject'] as const) {
    r.add({
      method: 'post',
      path: `/leave/requests/:id/${action}`,
      tag: 'Leave',
      summary: action === 'approve' ? 'Approve a leave request' : 'Reject a leave request (note required)',
      permission: 'leave.approve',
      params: idParam,
      body: z.object({ note: action === 'reject' ? z.string().trim().min(3, 'Give a reason.').max(500) : z.string().trim().max(500).optional() }),
      handler: async ({ params, body, user, ip }) => {
        const req = await prisma.leaveRequest.findUnique({ where: { id: params.id } });
        if (!req) throw notFound('Leave request');
        if (req.requestedById === user.id) throw new AppError('FORBIDDEN', 'You cannot decide a leave request you entered yourself.');
        const res = await prisma.leaveRequest.updateMany({
          where: { id: params.id, status: 'REQUESTED' },
          data: { status: action === 'approve' ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedByName: user.name, decidedAt: new Date(), decisionNote: body.note || null },
        });
        if (res.count !== 1) throw new AppError('CONFLICT', 'This request has already been decided or cancelled.');
        await audit.write({ actorId: user.id, action: action === 'approve' ? 'leave.approved' : 'leave.rejected', entity: 'leave_request', entityId: params.id, before: { status: 'REQUESTED' }, after: { status: action === 'approve' ? 'APPROVED' : 'REJECTED' }, metadata: body.note ? { note: body.note } : undefined, ip });
        void notifyLeaveDecision(params.id);
        return serializeLeave(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: params.id }, include }));
      },
    });
  }
  r.add({
    method: 'post',
    path: '/leave/requests/:id/cancel',
    tag: 'Leave',
    summary: 'Cancel a pending request (Leave managers), or an approved one (Leave approvers)',
    permission: ['leave.manage', 'leave.approve'],
    params: idParam,
    body: z.object({ note: z.string().trim().max(500).optional() }),
    handler: async ({ params, body, user, ip }) => {
      const req = await prisma.leaveRequest.findUnique({ where: { id: params.id } });
      if (!req) throw notFound('Leave request');
      const allowed = req.status === 'REQUESTED' || (req.status === 'APPROVED' && user.permissions.has('leave.approve'));
      if (!allowed) throw new AppError('INVALID_STATE', req.status === 'APPROVED' ? 'Only a leave approver can cancel approved leave.' : 'This request is already closed.');
      const res = await prisma.leaveRequest.updateMany({ where: { id: params.id, status: req.status }, data: { status: 'CANCELLED', decisionNote: body.note || null, decidedById: user.id, decidedByName: user.name, decidedAt: new Date() } });
      if (res.count !== 1) throw new AppError('CONFLICT', 'This request changed while you were working. Reload and try again.');
      await audit.write({ actorId: user.id, action: 'leave.cancelled', entity: 'leave_request', entityId: params.id, before: { status: req.status }, after: { status: 'CANCELLED' }, ip });
      return serializeLeave(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: params.id }, include }));
    },
  });
}
