import { z } from 'zod';
import { AppError, idParam, listQuery, notFound, skipTake, toPage, type ApiRegistry, type AuthUser } from '@nexzi/server-core';
import { prisma, type Prisma } from '../db';
import { periodLabel } from '../payroll/service';
import { RULE_LABELS, type AnomalyRule } from './rules';
import { OUTCOME_LABELS, REVIEW_OUTCOMES, reopenAnomaly, reviewAnomaly, scanRun, type ReviewOutcome } from './service';

/** Alert messages quote amounts, so viewing them needs the amounts permission too. */
function assertAmounts(user: AuthUser) {
  if (!user.permissions.has('payroll.view_amounts')) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts, which payroll alerts include.');
}

const REVIEWERS = ['payroll.calculate', 'payroll.approve'];
const severityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

type AnomalyRow = Prisma.PayrollAnomalyGetPayload<{ include: { payrollRun: { select: { year: true; month: true; status: true } } } }>;
const serialize = (a: AnomalyRow) => ({
  id: a.id,
  runId: a.payrollRunId,
  period: periodLabel(a.payrollRun.year, a.payrollRun.month),
  runStatus: a.payrollRun.status,
  employeeId: a.employeeId,
  employeeCode: a.employeeCode,
  employeeName: a.employeeName,
  componentCode: a.componentCode,
  rule: a.rule,
  ruleLabel: RULE_LABELS[a.rule as AnomalyRule] ?? a.rule,
  severity: a.severity,
  status: a.status,
  message: a.message,
  details: a.details,
  reviewOutcome: a.reviewOutcome,
  reviewOutcomeLabel: a.reviewOutcome ? OUTCOME_LABELS[a.reviewOutcome as ReviewOutcome] : null,
  reviewComment: a.reviewComment,
  reviewedByName: a.reviewedByName,
  reviewedAt: a.reviewedAt,
  detectedAt: a.detectedAt,
  lastDetectedAt: a.lastDetectedAt,
  clearedAt: a.clearedAt,
});
const runSelect = { payrollRun: { select: { year: true, month: true, status: true } } } as const;

async function countsFor(where: Prisma.PayrollAnomalyWhereInput) {
  const rows = await prisma.payrollAnomaly.groupBy({ by: ['status', 'severity'], where, _count: { _all: true } });
  const c = { open: 0, reviewed: 0, cleared: 0, openHigh: 0, openMedium: 0, openLow: 0 };
  for (const r of rows) {
    const n = r._count._all;
    if (r.status === 'OPEN') {
      c.open += n;
      if (r.severity === 'HIGH') c.openHigh += n;
      else if (r.severity === 'MEDIUM') c.openMedium += n;
      else c.openLow += n;
    } else if (r.status === 'REVIEWED') c.reviewed += n;
    else c.cleared += n;
  }
  return c;
}

export function registerAnomalyRoutes(r: ApiRegistry) {
  const statusQ = z.enum(['OPEN', 'REVIEWED', 'CLEARED', 'ACTIVE', 'ALL']).default('ACTIVE');
  const filterWhere = (q: { status: string; severity?: string; rule?: string }) =>
    ({
      ...(q.status === 'ACTIVE' ? { status: { in: ['OPEN', 'REVIEWED'] } } : q.status === 'ALL' ? {} : { status: q.status }),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.rule ? { rule: q.rule } : {}),
    }) as Prisma.PayrollAnomalyWhereInput;

  r.add({
    method: 'get',
    path: '/payroll-runs/:id/anomalies',
    tag: 'Payroll Alerts',
    summary: 'Explainable anomaly alerts for one payroll run, with counts',
    permission: 'payroll.view',
    params: idParam,
    query: z.object({ status: statusQ, severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(), rule: z.string().max(40).optional() }),
    handler: async ({ params, query, user }) => {
      assertAmounts(user);
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw notFound('Payroll run');
      const rows = await prisma.payrollAnomaly.findMany({ where: { payrollRunId: run.id, ...filterWhere(query) }, include: runSelect });
      rows.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || (a.employeeCode ?? '').localeCompare(b.employeeCode ?? '') || a.rule.localeCompare(b.rule));
      const settings = await prisma.payrollSetting.findUnique({ where: { key: 'anomalyRules' } });
      return {
        items: rows.map(serialize),
        counts: await countsFor({ payrollRunId: run.id }),
        canReview: REVIEWERS.some((p) => user.permissions.has(p)),
        rulesConfigured: settings !== null,
        rules: Object.entries(RULE_LABELS).map(([code, label]) => ({ code, label })),
      };
    },
  });

  r.add({
    method: 'post',
    path: '/payroll-runs/:id/anomalies/scan',
    tag: 'Payroll Alerts',
    summary: 'Re-run the anomaly rules for a calculated run (idempotent; never changes payroll results)',
    permission: REVIEWERS,
    params: idParam,
    handler: async ({ params, user, ip }) => {
      assertAmounts(user);
      return scanRun(params.id, user, ip);
    },
  });

  r.add({
    method: 'get',
    path: '/anomalies',
    tag: 'Payroll Alerts',
    summary: 'Alert history across payroll runs (search, filter, paginate)',
    permission: 'payroll.view',
    query: listQuery(['detectedAt', 'severity', 'employeeCode'], 'detectedAt', {
      status: statusQ,
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      rule: z.string().max(40).optional(),
      runId: z.string().uuid().optional(),
    }),
    handler: async ({ query, user }) => {
      assertAmounts(user);
      const where: Prisma.PayrollAnomalyWhereInput = {
        ...filterWhere(query),
        ...(query.runId ? { payrollRunId: query.runId } : {}),
        ...(query.search
          ? { OR: [{ employeeCode: { contains: query.search, mode: 'insensitive' } }, { employeeName: { contains: query.search, mode: 'insensitive' } }, { message: { contains: query.search, mode: 'insensitive' } }] }
          : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.payrollAnomaly.count({ where }),
        prisma.payrollAnomaly.findMany({ where, include: runSelect, orderBy: [{ [query.sortBy]: query.sortDir }, { id: 'asc' }], ...skipTake(query.page, query.pageSize) }),
      ]);
      return { ...toPage(rows.map(serialize), total, query.page, query.pageSize), counts: await countsFor({}) };
    },
  });

  r.add({
    method: 'get',
    path: '/anomalies/:id',
    tag: 'Payroll Alerts',
    summary: 'One alert with its full review history',
    permission: 'payroll.view',
    params: idParam,
    handler: async ({ params, user }) => {
      assertAmounts(user);
      const a = await prisma.payrollAnomaly.findUnique({ where: { id: params.id }, include: { ...runSelect, events: { orderBy: { occurredAt: 'asc' } } } });
      if (!a) throw notFound('Alert');
      return { ...serialize(a), events: a.events.map((e) => ({ id: e.id, action: e.action, comment: e.comment, actorName: e.actorName, occurredAt: e.occurredAt })), canReview: REVIEWERS.some((p) => user.permissions.has(p)) };
    },
  });

  const comment = z.string().trim().min(5, 'Explain the review in at least 5 characters.').max(1000);
  r.add({
    method: 'post',
    path: '/anomalies/:id/review',
    tag: 'Payroll Alerts',
    summary: 'Mark an open alert as reviewed with an outcome and comment',
    permission: REVIEWERS,
    params: idParam,
    body: z.object({ outcome: z.enum(REVIEW_OUTCOMES), comment }),
    handler: async ({ params, body, user, ip }) => {
      assertAmounts(user);
      const a = await reviewAnomaly(user, params.id, body.outcome, body.comment, ip);
      return serialize(await prisma.payrollAnomaly.findUniqueOrThrow({ where: { id: a.id }, include: runSelect }));
    },
  });

  r.add({
    method: 'post',
    path: '/anomalies/:id/reopen',
    tag: 'Payroll Alerts',
    summary: 'Re-open a reviewed alert (reason required)',
    permission: REVIEWERS,
    params: idParam,
    body: z.object({ comment }),
    handler: async ({ params, body, user, ip }) => {
      assertAmounts(user);
      const a = await reopenAnomaly(user, params.id, body.comment, ip);
      return serialize(await prisma.payrollAnomaly.findUniqueOrThrow({ where: { id: a.id }, include: runSelect }));
    },
  });
}
