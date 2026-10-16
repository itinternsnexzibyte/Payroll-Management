/**
 * Bonuses and incentives: amounts per employee and payroll month, proposed by one person and
 * approved by another with Approve payroll rights. Approved amounts feed the mapped payroll inputs.
 * Amounts are entered as agreed — incentive formulas come from the client and are not computed here.
 */
import { z } from 'zod';
import { AppError, dec, idParam, money, notFound, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { periodLabel } from '../payroll/service';

const include = { employee: { select: { id: true, employeeCode: true, fullName: true } } } as const;
type Row = Prisma.BonusEntryGetPayload<{ include: typeof include }>;
const serialize = (b: Row) => ({
  id: b.id,
  employee: { id: b.employee.id, code: b.employee.employeeCode, name: b.employee.fullName },
  kind: b.kind,
  year: b.year,
  month: b.month,
  period: periodLabel(b.year, b.month),
  amount: money(dec(b.amount)),
  reason: b.reason,
  status: b.status,
  proposedByName: b.proposedByName,
  decidedByName: b.decidedByName,
  decidedAt: b.decidedAt,
  decisionNote: b.decisionNote,
  createdAt: b.createdAt,
});

function assertAmounts(user: AuthUser) {
  if (!user.permissions.has('payroll.view_amounts')) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts.');
}

/** Approved bonus and incentive totals per employee for a payroll month. */
export async function approvedBonuses(year: number, month: number, employeeIds: string[]) {
  const rows = await prisma.bonusEntry.groupBy({ by: ['employeeId', 'kind'], where: { year, month, status: 'APPROVED', employeeId: { in: employeeIds } }, _sum: { amount: true } });
  const bonus = new Map<string, Prisma.Decimal>();
  const incentive = new Map<string, Prisma.Decimal>();
  for (const r of rows) (r.kind === 'BONUS' ? bonus : incentive).set(r.employeeId, r._sum.amount ?? new Prisma.Decimal(0));
  return { bonus, incentive };
}

export function registerBonusRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/bonuses',
    tag: 'Bonuses & Incentives',
    summary: 'Bonuses and incentives for a payroll month',
    permission: ['bonuses.manage', 'payroll.approve'],
    query: z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12), status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED']).optional() }),
    handler: async ({ query, user }) => {
      assertAmounts(user);
      const rows = await prisma.bonusEntry.findMany({ where: { year: query.year, month: query.month, ...(query.status ? { status: query.status } : {}) }, include, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
      const approved = rows.filter((x) => x.status === 'APPROVED').reduce((a, x) => a.add(dec(x.amount)), dec(0));
      return { items: rows.map(serialize), approvedTotal: money(approved), canApprove: user.permissions.has('payroll.approve') };
    },
  });
  r.add({
    method: 'post',
    path: '/bonuses',
    tag: 'Bonuses & Incentives',
    summary: 'Propose a bonus or incentive for an employee and payroll month',
    permission: 'bonuses.manage',
    status: 201,
    body: z.object({
      employeeId: z.string().uuid(),
      kind: z.enum(['BONUS', 'INCENTIVE']),
      year: z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
      amount: z.string().trim().regex(/^\d{1,13}(\.\d{1,2})?$/, 'Enter an amount, e.g. 5000'),
      reason: z.string().trim().min(3, 'Explain what this is for.').max(300),
    }),
    handler: async ({ body, user, ip }) => {
      assertAmounts(user);
      const emp = await prisma.employee.findUnique({ where: { id: body.employeeId } });
      if (!emp) throw notFound('Employee');
      if (dec(body.amount).lte(0)) throw new AppError('VALIDATION_ERROR', 'The amount must be more than zero.', { fields: [{ path: 'amount', message: 'Must be more than zero.' }] });
      const finalised = await prisma.payrollRun.findFirst({ where: { year: body.year, month: body.month, status: 'FINALISED' } });
      if (finalised) throw new AppError('INVALID_STATE', `${periodLabel(body.year, body.month)} payroll is already finalised. Choose a later month.`);
      const b = await prisma.bonusEntry.create({
        data: { employeeId: emp.id, kind: body.kind, year: body.year, month: body.month, amount: new Prisma.Decimal(body.amount), reason: body.reason, proposedById: user.id, proposedByName: user.name },
        include,
      });
      await audit.write({ actorId: user.id, action: 'bonus.proposed', entity: 'bonus_entry', entityId: b.id, after: { employee: emp.employeeCode, kind: b.kind, period: periodLabel(b.year, b.month), amount: body.amount }, ip });
      return serialize(b);
    },
  });
  for (const action of ['approve', 'reject'] as const) {
    r.add({
      method: 'post',
      path: `/bonuses/:id/${action}`,
      tag: 'Bonuses & Incentives',
      summary: action === 'approve' ? 'Approve a proposed bonus or incentive (not your own proposal)' : 'Reject a proposed bonus or incentive',
      permission: 'payroll.approve',
      params: idParam,
      body: z.object({ note: action === 'reject' ? z.string().trim().min(3, 'Give a reason.').max(300) : z.string().trim().max(300).optional() }),
      handler: async ({ params, body, user, ip }) => {
        assertAmounts(user);
        const b = await prisma.bonusEntry.findUnique({ where: { id: params.id } });
        if (!b) throw notFound('Bonus');
        if (b.proposedById === user.id) throw new AppError('FORBIDDEN', 'A bonus must be approved by someone other than the person who proposed it.');
        const res = await prisma.bonusEntry.updateMany({ where: { id: params.id, status: 'PROPOSED' }, data: { status: action === 'approve' ? 'APPROVED' : 'REJECTED', decidedById: user.id, decidedByName: user.name, decidedAt: new Date(), decisionNote: body.note || null } });
        if (res.count !== 1) throw new AppError('CONFLICT', 'This entry has already been decided.');
        await audit.write({ actorId: user.id, action: action === 'approve' ? 'bonus.approved' : 'bonus.rejected', entity: 'bonus_entry', entityId: params.id, before: { status: 'PROPOSED' }, after: { status: action === 'approve' ? 'APPROVED' : 'REJECTED' }, metadata: body.note ? { note: body.note } : undefined, ip });
        return serialize(await prisma.bonusEntry.findUniqueOrThrow({ where: { id: params.id }, include }));
      },
    });
  }
}
