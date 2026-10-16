/**
 * Loans and salary advances. Each loan has a fixed monthly instalment recovered through the
 * payroll input mapped as "advance recovery". Recovered amounts are read from FINALISED payroll
 * runs (never stored separately), so a re-opened or corrected month is always reflected.
 * One active loan or advance per employee keeps recoveries unambiguous.
 */
import { z } from 'zod';
import { AppError, Dec, dec, idParam, money, notFound, type ApiRegistry } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { getSettings } from '../settings';
import { periodLabel } from '../payroll/service';

const amount = z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, 'Enter an amount, e.g. 10000');
const ym = (y: number, m: number) => y * 12 + (m - 1);

type LoanRow = Prisma.LoanGetPayload<{ include: { employee: { select: { id: true; employeeCode: true; fullName: true } } } }>;

/** Recoveries per loan from finalised runs, in month order. */
async function recoveries(loans: LoanRow[]) {
  const key = (await getSettings()).inputMappings.advanceRecovery;
  const out = new Map<string, { period: string; year: number; month: number; amount: string }[]>();
  if (!key || !loans.length) return { key, out };
  const inputs = await prisma.payrollInput.findMany({
    where: { inputKey: key, employeeId: { in: [...new Set(loans.map((l) => l.employeeId))] }, payrollRun: { status: 'FINALISED' } },
    include: { payrollRun: { select: { year: true, month: true } } },
  });
  for (const l of loans) {
    const start = ym(l.startYear, l.startMonth);
    let remaining = dec(l.principal);
    const rows = inputs
      .filter((i) => i.employeeId === l.employeeId && ym(i.payrollRun.year, i.payrollRun.month) >= start && (!l.closedAt || ym(i.payrollRun.year, i.payrollRun.month) <= ym(l.closedAt.getUTCFullYear(), l.closedAt.getUTCMonth() + 1)))
      .sort((a, b) => ym(a.payrollRun.year, a.payrollRun.month) - ym(b.payrollRun.year, b.payrollRun.month));
    const list: { period: string; year: number; month: number; amount: string }[] = [];
    for (const i of rows) {
      if (remaining.lte(0)) break;
      const v = Dec.min(dec(i.value), remaining);
      if (v.lte(0)) continue;
      remaining = remaining.sub(v);
      list.push({ period: periodLabel(i.payrollRun.year, i.payrollRun.month), year: i.payrollRun.year, month: i.payrollRun.month, amount: money(v) });
    }
    out.set(l.id, list);
  }
  return { key, out };
}

function summarise(l: LoanRow, recs: { amount: string }[]) {
  const recovered = recs.reduce((a, r) => a.add(dec(r.amount)), dec(0));
  const outstanding = Dec.max(dec(l.principal).sub(recovered), dec(0));
  return {
    id: l.id,
    employee: { id: l.employee.id, code: l.employee.employeeCode, name: l.employee.fullName },
    kind: l.kind,
    principal: money(dec(l.principal)),
    instalment: money(dec(l.instalment)),
    startPeriod: periodLabel(l.startYear, l.startMonth),
    startYear: l.startYear,
    startMonth: l.startMonth,
    status: l.status,
    recovered: money(recovered),
    outstanding: money(outstanding),
    repaid: outstanding.isZero(),
    nextInstalment: l.status === 'ACTIVE' ? money(Dec.min(dec(l.instalment), outstanding)) : '0.00',
    note: l.note,
    createdByName: l.createdByName,
    createdAt: l.createdAt,
    closedAt: l.closedAt,
    closedReason: l.closedReason,
  };
}

const include = { employee: { select: { id: true, employeeCode: true, fullName: true } } } as const;

/** Next instalment per employee for a payroll month (used to fill payroll inputs). */
export async function advanceInstalments(year: number, month: number, employeeIds: string[]) {
  const loans = await prisma.loan.findMany({ where: { status: 'ACTIVE', employeeId: { in: employeeIds } }, include });
  const due = loans.filter((l) => ym(l.startYear, l.startMonth) <= ym(year, month));
  const { out } = await recoveries(due);
  const result = new Map<string, Prisma.Decimal>();
  for (const l of due) {
    // Recoveries from finalised months before this one only (this month is being prepared).
    const prior = (out.get(l.id) ?? []).filter((r) => ym(r.year, r.month) < ym(year, month));
    const s = summarise(l, prior);
    if (dec(s.nextInstalment).gt(0)) result.set(l.employeeId, new Prisma.Decimal(s.nextInstalment));
  }
  return result;
}

export function registerLoanRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/loans',
    tag: 'Loans & Advances',
    summary: 'Loans and salary advances with recovered and outstanding amounts',
    permission: 'loans.manage',
    query: z.object({ status: z.enum(['ACTIVE', 'CLOSED', 'CANCELLED', 'ALL']).default('ACTIVE'), search: z.string().trim().max(100).optional() }),
    handler: async ({ query, user }) => {
      if (!user.permissions.has('payroll.view_amounts')) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts.');
      const loans = await prisma.loan.findMany({
        where: {
          ...(query.status === 'ALL' ? {} : { status: query.status }),
          ...(query.search ? { employee: { OR: [{ employeeCode: { contains: query.search, mode: 'insensitive' } }, { fullName: { contains: query.search, mode: 'insensitive' } }] } } : {}),
        },
        include,
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      const { key, out } = await recoveries(loans);
      return { items: loans.map((l) => ({ ...summarise(l, out.get(l.id) ?? []), recoveries: out.get(l.id) ?? [] })), mappedInput: key };
    },
  });
  r.add({
    method: 'post',
    path: '/loans',
    tag: 'Loans & Advances',
    summary: 'Record a loan or salary advance with a monthly instalment',
    permission: 'loans.manage',
    status: 201,
    body: z.object({
      employeeId: z.string().uuid(),
      kind: z.enum(['LOAN', 'ADVANCE']),
      principal: amount,
      instalment: amount,
      startYear: z.number().int().min(2000).max(2100),
      startMonth: z.number().int().min(1).max(12),
      note: z.string().trim().max(500).optional(),
    }),
    handler: async ({ body, user, ip }) => {
      if (!user.permissions.has('payroll.view_amounts')) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts.');
      const emp = await prisma.employee.findUnique({ where: { id: body.employeeId } });
      if (!emp) throw notFound('Employee');
      if (emp.status !== 'ACTIVE') throw new AppError('INVALID_STATE', 'Loans can only be recorded for active employees.');
      if (dec(body.principal).lte(0) || dec(body.instalment).lte(0)) throw new AppError('VALIDATION_ERROR', 'Amounts must be more than zero.', { fields: [{ path: 'principal', message: 'Must be more than zero.' }] });
      if (dec(body.instalment).gt(dec(body.principal))) throw new AppError('VALIDATION_ERROR', 'The instalment cannot be more than the amount.', { fields: [{ path: 'instalment', message: 'More than the amount.' }] });
      const active = await prisma.loan.findFirst({ where: { employeeId: emp.id, status: 'ACTIVE' } });
      if (active) throw new AppError('CONFLICT', `${emp.fullName} already has an active ${active.kind === 'LOAN' ? 'loan' : 'advance'}. Close it before recording a new one.`);
      const l = await prisma.loan.create({
        data: { employeeId: emp.id, kind: body.kind, principal: new Prisma.Decimal(body.principal), instalment: new Prisma.Decimal(body.instalment), startYear: body.startYear, startMonth: body.startMonth, note: body.note || null, createdById: user.id, createdByName: user.name },
        include,
      });
      await audit.write({ actorId: user.id, action: 'loan.created', entity: 'loan', entityId: l.id, after: { employee: emp.employeeCode, kind: l.kind, principal: body.principal, instalment: body.instalment, start: periodLabel(l.startYear, l.startMonth) }, ip });
      return summarise(l, []);
    },
  });
  r.add({
    method: 'post',
    path: '/loans/:id/close',
    tag: 'Loans & Advances',
    summary: 'Close a loan (repaid or settled outside payroll) or cancel one entered by mistake',
    permission: 'loans.manage',
    params: idParam,
    body: z.object({ outcome: z.enum(['CLOSED', 'CANCELLED']), reason: z.string().trim().min(3, 'Give a reason.').max(500) }),
    handler: async ({ params, body, user, ip }) => {
      const res = await prisma.loan.updateMany({ where: { id: params.id, status: 'ACTIVE' }, data: { status: body.outcome, closedAt: new Date(), closedReason: body.reason } });
      if (res.count !== 1) throw new AppError('CONFLICT', 'Only active loans can be closed.');
      await audit.write({ actorId: user.id, action: body.outcome === 'CLOSED' ? 'loan.closed' : 'loan.cancelled', entity: 'loan', entityId: params.id, after: { status: body.outcome }, metadata: { reason: body.reason }, ip });
      const l = await prisma.loan.findUniqueOrThrow({ where: { id: params.id }, include });
      const { out } = await recoveries([l]);
      return summarise(l, out.get(l.id) ?? []);
    },
  });
}
