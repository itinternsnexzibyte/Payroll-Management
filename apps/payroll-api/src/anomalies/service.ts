import { AppError, notFound, type AuthUser } from '@nexzi/server-core';
import { prisma, Prisma, type Tx } from '../db';
import { audit } from '../audit';
import { getSettings } from '../settings';
import { finalisedRunsBefore, loadResults, loadRunResult } from '../analysis/run-data';
import { detectAnomalies } from './rules';

export const REVIEW_OUTCOMES = ['EXPECTED', 'CORRECTED', 'NOT_AN_ISSUE'] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];
export const OUTCOME_LABELS: Record<ReviewOutcome, string> = { EXPECTED: 'Expected change', CORRECTED: 'Corrected in payroll', NOT_AN_ISSUE: 'Not an issue' };

type Actor = Pick<AuthUser, 'id' | 'name'> | null;

/**
 * Runs the anomaly rules for a calculated run and reconciles them with stored alerts:
 * new findings are opened, unchanged reviewed alerts keep their review, reviewed alerts whose
 * numbers changed are re-opened, and alerts that are no longer found are marked cleared.
 * Serialised per run with an advisory lock so concurrent scans cannot create duplicates.
 */
export async function scanRun(runId: string, actor: Actor, ip: string | null) {
  const settings = await getSettings();
  const rules = settings.anomalyRules;
  const current = await loadRunResult(runId);
  if (!rules.enabled) return { enabled: false, detected: 0, opened: 0, reopened: 0, cleared: 0 };

  const earlier = await finalisedRunsBefore(current.year, current.month, rules.historyMonths);
  const history = await loadResults(earlier, prisma, [...current.employees.keys()]);
  const detections = detectAnomalies(current, history[0] ?? null, history, rules);
  const now = new Date();

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'anomaly-scan:' + runId}))`;
      const existing = await tx.payrollAnomaly.findMany({ where: { payrollRunId: runId } });
      const byFp = new Map(existing.map((a) => [a.fingerprint, a]));
      const seen = new Set<string>();
      const counts = { detected: detections.length, opened: 0, reopened: 0, cleared: 0 };
      const event = (anomalyId: string, action: string, comment?: string) =>
        tx.payrollAnomalyEvent.create({ data: { anomalyId, action, comment, actorId: actor?.id ?? null, actorName: actor?.name ?? 'System' } });

      for (const d of detections) {
        seen.add(d.fingerprint);
        const data = {
          employeeId: d.employeeId,
          employeeCode: d.employeeCode,
          employeeName: d.employeeName,
          componentCode: d.componentCode,
          rule: d.rule,
          severity: d.severity,
          message: d.message,
          details: d.details as Prisma.InputJsonValue,
          signature: d.signature,
          lastDetectedAt: now,
        };
        const prev = byFp.get(d.fingerprint);
        if (!prev) {
          const created = await tx.payrollAnomaly.create({ data: { ...data, payrollRunId: runId, fingerprint: d.fingerprint } });
          await event(created.id, 'DETECTED');
          counts.opened++;
        } else if (prev.status === 'CLEARED') {
          await tx.payrollAnomaly.update({ where: { id: prev.id }, data: { ...data, status: 'OPEN', clearedAt: null } });
          await event(prev.id, 'REDETECTED');
          counts.opened++;
        } else if (prev.status === 'REVIEWED' && prev.signature !== d.signature) {
          await tx.payrollAnomaly.update({ where: { id: prev.id }, data: { ...data, status: 'OPEN' } });
          await event(prev.id, 'REOPENED', 'The figures behind this alert changed after it was reviewed.');
          counts.reopened++;
        } else {
          await tx.payrollAnomaly.update({ where: { id: prev.id }, data });
        }
      }
      for (const a of existing) {
        if (seen.has(a.fingerprint) || a.status === 'CLEARED') continue;
        await tx.payrollAnomaly.update({ where: { id: a.id }, data: { status: 'CLEARED', clearedAt: now } });
        await event(a.id, 'CLEARED', 'No longer detected after recalculation.');
        counts.cleared++;
      }
      await audit.tx(tx, { actorId: actor?.id ?? null, action: 'payroll.anomalies_scanned', entity: 'payroll_run', entityId: runId, metadata: counts, ip });
      return counts;
    },
    { timeout: 60_000 },
  );
  return { enabled: true, ...result };
}

/** Marks an open alert as reviewed. Conditional update, so a double submit cannot review twice. */
export async function reviewAnomaly(user: AuthUser, id: string, outcome: ReviewOutcome, comment: string, ip: string | null) {
  return prisma.$transaction(async (tx: Tx) => {
    const a = await tx.payrollAnomaly.findUnique({ where: { id } });
    if (!a) throw notFound('Alert');
    const res = await tx.payrollAnomaly.updateMany({
      where: { id, status: 'OPEN' },
      data: { status: 'REVIEWED', reviewOutcome: outcome, reviewComment: comment, reviewedById: user.id, reviewedByName: user.name, reviewedAt: new Date() },
    });
    if (res.count !== 1) throw new AppError('CONFLICT', a.status === 'REVIEWED' ? 'This alert has already been reviewed.' : 'This alert is no longer open.');
    await tx.payrollAnomalyEvent.create({ data: { anomalyId: id, action: 'REVIEWED', comment: `${OUTCOME_LABELS[outcome]}: ${comment}`, actorId: user.id, actorName: user.name } });
    await audit.tx(tx, { actorId: user.id, action: 'payroll.anomaly_reviewed', entity: 'payroll_anomaly', entityId: id, before: { status: a.status }, after: { status: 'REVIEWED', outcome }, metadata: { runId: a.payrollRunId, rule: a.rule }, ip });
    return tx.payrollAnomaly.findUniqueOrThrow({ where: { id } });
  });
}

/** Re-opens a reviewed alert (e.g. the review was wrong). */
export async function reopenAnomaly(user: AuthUser, id: string, comment: string, ip: string | null) {
  return prisma.$transaction(async (tx: Tx) => {
    const a = await tx.payrollAnomaly.findUnique({ where: { id } });
    if (!a) throw notFound('Alert');
    const res = await tx.payrollAnomaly.updateMany({ where: { id, status: 'REVIEWED' }, data: { status: 'OPEN' } });
    if (res.count !== 1) throw new AppError('CONFLICT', 'Only reviewed alerts can be re-opened.');
    await tx.payrollAnomalyEvent.create({ data: { anomalyId: id, action: 'REOPENED', comment, actorId: user.id, actorName: user.name } });
    await audit.tx(tx, { actorId: user.id, action: 'payroll.anomaly_reopened', entity: 'payroll_anomaly', entityId: id, before: { status: 'REVIEWED' }, after: { status: 'OPEN' }, metadata: { runId: a.payrollRunId }, ip });
    return tx.payrollAnomaly.findUniqueOrThrow({ where: { id } });
  });
}
