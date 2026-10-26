/**
 * Organisation structure: who reports to whom. Each employee has at most one reporting manager
 * (employees.managerId); the chart is built from those links. Cycles are refused.
 */
import { z } from 'zod';
import { AppError, idParam, notFound, toIsoDate, type ApiRegistry } from '@nexzi/server-core';
import { prisma, type Tx } from '../db';
import { audit } from '../audit';

type Db = Tx | typeof prisma;

/** Refuses a manager link that would make an employee report (directly or indirectly) to themself. */
export async function assertValidManager(employeeId: string | null, managerId: string | null | undefined, db: Db = prisma) {
  if (!managerId) return;
  if (employeeId && managerId === employeeId) throw new AppError('VALIDATION_ERROR', 'An employee cannot report to themself.', { fields: [{ path: 'managerId', message: 'Choose someone else.' }] });
  const manager = await db.employee.findUnique({ where: { id: managerId }, select: { id: true, status: true } });
  if (!manager) throw new AppError('VALIDATION_ERROR', 'The reporting manager does not exist.', { fields: [{ path: 'managerId', message: 'Unknown employee.' }] });
  if (manager.status === 'EXITED') throw new AppError('VALIDATION_ERROR', 'An exited employee cannot be a reporting manager.', { fields: [{ path: 'managerId', message: 'This employee has exited.' }] });
  if (!employeeId) return;
  const links = new Map((await db.employee.findMany({ select: { id: true, managerId: true } })).map((e) => [e.id, e.managerId]));
  let cursor: string | null | undefined = managerId;
  for (let hops = 0; cursor && hops < links.size + 1; hops++) {
    if (cursor === employeeId) throw new AppError('VALIDATION_ERROR', 'This would create a reporting loop: the chosen manager already reports to this employee.', { fields: [{ path: 'managerId', message: 'Reporting loop.' }] });
    cursor = links.get(cursor);
  }
}

export function registerOrganizationRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/organization',
    tag: 'Organisation',
    summary: 'Organisation chart: every employee with their reporting manager, plus structure statistics',
    permission: 'employees.view',
    query: z.object({ includeExited: z.enum(['true', 'false']).default('false') }),
    handler: async ({ query }) => {
      const rows = await prisma.employee.findMany({
        where: query.includeExited === 'true' ? {} : { status: { not: 'EXITED' } },
        include: { department: { select: { name: true } }, designation: { select: { name: true } } },
        orderBy: [{ fullName: 'asc' }],
      });
      const ids = new Set(rows.map((e) => e.id));
      const people = rows.map((e) => ({
        id: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        department: e.department?.name ?? null,
        designation: e.designation?.name ?? null,
        status: e.status,
        joiningDate: toIsoDate(e.joiningDate),
        // A manager outside the visible set (e.g. exited) is treated as no manager in the chart.
        managerId: e.managerId && ids.has(e.managerId) ? e.managerId : null,
      }));
      const reports = new Map<string, number>();
      for (const p of people) if (p.managerId) reports.set(p.managerId, (reports.get(p.managerId) ?? 0) + 1);
      const parent = new Map(people.map((p) => [p.id, p.managerId]));
      const depthOf = (id: string) => {
        let d = 0;
        for (let c = parent.get(id); c && d < people.length; c = parent.get(c)) d++;
        return d;
      };
      const managers = [...reports.values()];
      return {
        people: people.map((p) => ({ ...p, directReports: reports.get(p.id) ?? 0 })),
        stats: {
          headcount: people.length,
          topLevel: people.filter((p) => !p.managerId).length,
          managers: managers.length,
          averageSpan: managers.length ? Math.round((managers.reduce((a, b) => a + b, 0) / managers.length) * 10) / 10 : 0,
          widestSpan: managers.length ? Math.max(...managers) : 0,
          levels: people.length ? Math.max(...people.map((p) => depthOf(p.id))) + 1 : 0,
          // Top-level people who manage nobody: probably not placed in the structure yet.
          unplaced: people.filter((p) => !p.managerId && !reports.has(p.id)).length,
        },
      };
    },
  });

  r.add({
    method: 'put',
    path: '/employees/:id/manager',
    tag: 'Organisation',
    summary: 'Set or clear the reporting manager of an employee (moves them in the organisation chart)',
    permission: 'employees.manage',
    params: idParam,
    body: z.object({ managerId: z.string().uuid().nullable() }),
    handler: async ({ params, body, user, ip }) => {
      const existing = await prisma.employee.findUnique({ where: { id: params.id }, select: { id: true, managerId: true } });
      if (!existing) throw notFound('Employee');
      await assertValidManager(existing.id, body.managerId);
      await prisma.employee.update({ where: { id: existing.id }, data: { managerId: body.managerId, updatedById: user.id } });
      await audit.write({ actorId: user.id, action: 'employee.manager_changed', entity: 'employee', entityId: existing.id, before: { managerId: existing.managerId }, after: { managerId: body.managerId }, ip });
      return { id: existing.id, managerId: body.managerId };
    },
  });
}
