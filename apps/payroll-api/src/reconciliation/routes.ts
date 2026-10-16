import { z } from 'zod';
import { AppError, notFound, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { loadRunResult, type RunResult } from '../analysis/run-data';
import { sendReport } from '../output/report-export';
import type { ReportData } from '../output/templates';
import { explanationStatus, reconcile, type ChangeKind, type EmployeeDiff, type Explanation } from './compare';

const CLASSES = ['EXPECTED', 'DISCREPANCY', 'RESOLVED'] as const;
const NOTE_WRITERS = ['payroll.calculate', 'payroll.approve'];

function assertAmounts(user: AuthUser) {
  if (!user.permissions.has('payroll.view_amounts')) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts, which reconciliation compares.');
}

const pairQuery = {
  baseRunId: z.string().uuid('Choose the month to compare against.'),
  compareRunId: z.string().uuid('Choose the month to check.'),
};
const filterQuery = {
  ...pairQuery,
  department: z.string().trim().max(100).optional(),
  search: z.string().trim().max(100).optional(),
  component: z.string().trim().max(40).optional(),
  change: z.enum(['ALL', 'DIFFERENCES', 'NEW', 'MISSING', 'CHANGED', 'UNCHANGED']).default('DIFFERENCES'),
  explanation: z.enum(['ALL', 'UNRESOLVED', 'UNEXPLAINED', 'EXPECTED', 'DISCREPANCY', 'RESOLVED']).default('ALL'),
};

async function loadPair(baseRunId: string, compareRunId: string): Promise<[RunResult, RunResult]> {
  if (baseRunId === compareRunId) throw new AppError('VALIDATION_ERROR', 'Choose two different payroll months.', { fields: [{ path: 'compareRunId', message: 'Must differ from the comparison month.' }] });
  return Promise.all([loadRunResult(baseRunId), loadRunResult(compareRunId)]);
}

type NoteRow = Awaited<ReturnType<typeof prisma.reconciliationNote.findMany>>[number];

async function build(q: z.infer<z.ZodObject<typeof filterQuery>>) {
  const [base, compare] = await loadPair(q.baseRunId, q.compareRunId);
  const rec = reconcile(base, compare);
  const notes = await prisma.reconciliationNote.findMany({ where: { baseRunId: base.runId, compareRunId: compare.runId } });
  const noteBy = new Map<string, NoteRow>(notes.map((n) => [`${n.employeeId}:${n.componentCode}`, n]));
  const view = (n: NoteRow | undefined) =>
    n ? { id: n.id, classification: n.classification, note: n.note, updatedByName: n.updatedByName ?? n.createdByName, updatedAt: n.updatedAt } : null;

  const enriched = rec.employees.map((e) => {
    const note = noteBy.get(`${e.employeeId}:`);
    return {
      ...e,
      note: view(note),
      explanation: explanationStatus(e.change, note?.classification),
      components: e.components.map((c) => ({ ...c, note: view(noteBy.get(`${e.employeeId}:${c.code}`)) })),
    };
  });

  const summary = { expected: 0, unresolved: 0, discrepancies: 0, resolved: 0, unexplained: 0 };
  for (const e of enriched) {
    if (e.change === 'UNCHANGED') continue;
    if (e.explanation === 'EXPECTED') summary.expected++;
    else if (e.explanation === 'RESOLVED') summary.resolved++;
    else {
      summary.unresolved++;
      if (e.explanation === 'DISCREPANCY') summary.discrepancies++;
      else summary.unexplained++;
    }
  }

  const departments = [...new Set(rec.employees.map((e) => e.departmentName).filter((d): d is string => !!d))].sort();
  const matches = (e: (typeof enriched)[number]) => {
    if (q.change === 'DIFFERENCES' && e.change === 'UNCHANGED') return false;
    if (!['ALL', 'DIFFERENCES'].includes(q.change) && e.change !== (q.change as ChangeKind)) return false;
    if (q.explanation === 'UNRESOLVED' && !(e.explanation === 'UNEXPLAINED' || e.explanation === 'DISCREPANCY')) return false;
    if (!['ALL', 'UNRESOLVED'].includes(q.explanation) && e.explanation !== (q.explanation as Explanation)) return false;
    if (q.department && e.departmentName !== q.department) return false;
    if (q.search) {
      const s = q.search.toLowerCase();
      if (!e.employeeCode.toLowerCase().includes(s) && !e.employeeName.toLowerCase().includes(s)) return false;
    }
    if (q.component && !e.components.some((c) => c.code === q.component && c.change !== 'UNCHANGED')) return false;
    return true;
  };

  return {
    base: { runId: base.runId, period: base.period, status: base.status, rulesApproved: base.rulesApproved, employees: base.employees.size },
    compare: { runId: compare.runId, period: compare.period, status: compare.status, rulesApproved: compare.rulesApproved, employees: compare.employees.size },
    totals: rec.totals,
    components: rec.components,
    counts: rec.counts,
    summary,
    departments,
    employees: enriched.filter(matches),
  };
}

const CHANGE_LABEL: Record<ChangeKind, string> = { NEW: 'New this month', MISSING: 'Not in this month', CHANGED: 'Changed', UNCHANGED: 'Unchanged' };
const EXPLANATION_LABEL: Record<Explanation, string> = { UNEXPLAINED: 'Not yet explained', EXPECTED: 'Expected', DISCREPANCY: 'Discrepancy', RESOLVED: 'Resolved' };

export function registerReconciliationRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/reconciliation',
    tag: 'Reconciliation',
    summary: 'Compare two calculated payroll months: employee-wise and component-wise differences with explanations',
    permission: 'reports.view',
    query: z.object(filterQuery),
    handler: async ({ query, user }) => {
      assertAmounts(user);
      return { ...(await build(query)), canExplain: NOTE_WRITERS.some((p) => user.permissions.has(p)) };
    },
  });

  r.add({
    method: 'get',
    path: '/reconciliation/export',
    tag: 'Reconciliation',
    summary: 'Download the reconciliation as PDF or XLSX (same filters as the screen)',
    permission: 'reports.view',
    produces: 'xlsx',
    query: z.object({ ...filterQuery, format: z.enum(['pdf', 'xlsx']).default('xlsx') }),
    handler: async ({ query, res, user, ip }) => {
      assertAmounts(user);
      const d = await build(query);
      const rows: ReportData['rows'] = [];
      const pctText = (p: string | null) => (p === null ? '' : `${Number(p) > 0 ? '+' : ''}${Number(p).toFixed(1)}%`);
      for (const e of d.employees as (EmployeeDiff & { explanation: Explanation | null; note: { note: string } | null })[]) {
        rows.push({
          code: e.employeeCode,
          name: e.employeeName,
          department: e.departmentName ?? '',
          change: CHANGE_LABEL[e.change],
          baseNet: e.base?.net ?? null,
          compareNet: e.compare?.net ?? null,
          diff: e.difference.net,
          pct: pctText(e.netChangePercent),
          components: e.components.filter((c) => c.change !== 'UNCHANGED').map((c) => `${c.name} ${Number(c.difference) > 0 ? '+' : ''}${c.difference}`).join('; '),
          explanation: e.explanation ? EXPLANATION_LABEL[e.explanation] : '',
          note: e.note?.note ?? '',
        });
      }
      const report: ReportData = {
        title: `Payroll reconciliation — ${d.compare.period} vs ${d.base.period}`,
        subtitle: `${d.summary.unresolved} unresolved · ${d.summary.expected} expected · ${d.summary.resolved} resolved · net ${d.totals.base.net} → ${d.totals.compare.net} (${pctText(d.totals.netChangePercent) || 'n/a'})`,
        banners: [
          ...[d.base, d.compare].filter((x) => x.status !== 'FINALISED').map((x) => `${x.period} is not finalised (${x.status.replace('_', ' ').toLowerCase()}); figures may change.`),
          ...([d.base, d.compare].some((x) => !x.rulesApproved) ? ['PROVISIONAL — calculation rules not yet reconciled with the client-approved workbook.'] : []),
        ],
        columns: [
          { header: 'Employee ID', key: 'code' },
          { header: 'Name', key: 'name' },
          { header: 'Department', key: 'department' },
          { header: 'Change', key: 'change' },
          { header: `Net ${d.base.period}`, key: 'baseNet', numeric: true },
          { header: `Net ${d.compare.period}`, key: 'compareNet', numeric: true },
          { header: 'Difference', key: 'diff', numeric: true },
          { header: '%', key: 'pct' },
          { header: 'Changed components', key: 'components' },
          { header: 'Status', key: 'explanation' },
          { header: 'Explanation', key: 'note' },
        ],
        rows,
        totals: { code: 'Total (all employees)', name: '', department: '', change: '', baseNet: d.totals.base.net, compareNet: d.totals.compare.net, diff: d.totals.difference.net, pct: pctText(d.totals.netChangePercent), components: '', explanation: '', note: '' },
      };
      await audit.write({ actorId: user.id, action: 'reconciliation.exported', entity: 'payroll_run', entityId: d.compare.runId, metadata: { baseRunId: d.base.runId, format: query.format, rows: rows.length }, ip });
      const slug = (p: string) => p.toLowerCase().replace(/\s+/g, '-');
      return sendReport(res, query.format, report, `reconciliation-${slug(d.compare.period)}-vs-${slug(d.base.period)}`);
    },
  });

  r.add({
    method: 'put',
    path: '/reconciliation/notes',
    tag: 'Reconciliation',
    summary: 'Record or update the explanation for an employee (or one of their components) between two months',
    permission: NOTE_WRITERS,
    body: z.object({
      ...pairQuery,
      employeeId: z.string().uuid(),
      componentCode: z.string().trim().max(40).default(''),
      classification: z.enum(CLASSES),
      note: z.string().trim().min(5, 'Explain the difference in at least 5 characters.').max(1000),
    }),
    handler: async ({ body, user, ip }) => {
      assertAmounts(user);
      const [base, compare] = await loadPair(body.baseRunId, body.compareRunId);
      const inBase = base.employees.get(body.employeeId);
      const inCompare = compare.employees.get(body.employeeId);
      if (!inBase && !inCompare) throw notFound('Employee in either payroll month');
      if (body.componentCode && ![...(inBase?.lines ?? []), ...(inCompare?.lines ?? [])].some((l) => l.code === body.componentCode)) {
        throw new AppError('VALIDATION_ERROR', 'This component is not part of the employee’s payroll in either month.', { fields: [{ path: 'componentCode', message: 'Unknown for this employee.' }] });
      }
      const key = { baseRunId_compareRunId_employeeId_componentCode: { baseRunId: base.runId, compareRunId: compare.runId, employeeId: body.employeeId, componentCode: body.componentCode } };
      return prisma.$transaction(async (tx) => {
        const before = await tx.reconciliationNote.findUnique({ where: key });
        const saved = await tx.reconciliationNote.upsert({
          where: key,
          create: { ...key.baseRunId_compareRunId_employeeId_componentCode, classification: body.classification, note: body.note, createdById: user.id, createdByName: user.name, updatedById: user.id, updatedByName: user.name },
          update: { classification: body.classification, note: body.note, updatedById: user.id, updatedByName: user.name },
        });
        await audit.tx(tx, {
          actorId: user.id,
          action: before ? 'reconciliation.note_updated' : 'reconciliation.note_created',
          entity: 'reconciliation_note',
          entityId: saved.id,
          before: before ? { classification: before.classification, note: before.note } : undefined,
          after: { classification: saved.classification, note: saved.note },
          metadata: { baseRunId: base.runId, compareRunId: compare.runId, employeeId: body.employeeId, componentCode: body.componentCode || null },
          ip,
        });
        return { id: saved.id, classification: saved.classification, note: saved.note, updatedByName: saved.updatedByName, updatedAt: saved.updatedAt };
      });
    },
  });
}
