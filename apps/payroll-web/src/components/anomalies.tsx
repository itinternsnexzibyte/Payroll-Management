'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, History, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Select, Spinner, Textarea, cn, errorMessage, formatDateTime, get, post, useToast } from '@nexzi/ui';
import type { Anomaly, AnomalyCounts, Severity } from '@/lib/types';

const SEVERITY: Record<Severity, { tone: 'danger' | 'warning' | 'neutral'; label: string }> = {
  HIGH: { tone: 'danger', label: 'High' },
  MEDIUM: { tone: 'warning', label: 'Medium' },
  LOW: { tone: 'neutral', label: 'Low' },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge tone={SEVERITY[severity].tone}>{SEVERITY[severity].label}</Badge>;
}

export function AlertStatusBadge({ a }: { a: Pick<Anomaly, 'status' | 'reviewOutcomeLabel'> }) {
  if (a.status === 'OPEN') return <Badge tone="warning">Needs review</Badge>;
  if (a.status === 'REVIEWED') return <Badge tone="success">{a.reviewOutcomeLabel ?? 'Reviewed'}</Badge>;
  return <Badge tone="neutral">Cleared</Badge>;
}

const OUTCOMES = [
  { id: 'EXPECTED', label: 'Expected change', hint: 'The figure is right (e.g. approved bonus or revision).' },
  { id: 'CORRECTED', label: 'Corrected in payroll', hint: 'An input was wrong and has been fixed and recalculated.' },
  { id: 'NOT_AN_ISSUE', label: 'Not an issue', hint: 'The rule does not apply here.' },
];

/** Review an open alert with an outcome and a comment (both stored in the review trail). */
export function ReviewDialog({ alert, onClose, onDone }: { alert: Anomaly; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState('EXPECTED');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => post(`/anomalies/${alert.id}/review`, { outcome, comment: comment.trim() }),
    onSuccess: () => {
      toast.success('Alert marked as reviewed.');
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = () => {
    if (comment.trim().length < 5) return setError('Explain the review in at least 5 characters.');
    setError(null);
    m.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Review alert"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={submit} icon={<CheckCircle2 className="h-4 w-4" />}>
            Mark as reviewed
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-surface p-3 text-sm">
          <p className="mb-1 flex items-center gap-2 font-medium text-ink">
            <SeverityBadge severity={alert.severity} /> {alert.ruleLabel}
          </p>
          <p className="text-ink">{alert.message}</p>
          <p className="mt-1 text-xs text-muted">
            {alert.employeeCode} · {alert.employeeName} · {alert.period}
          </p>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">Outcome</legend>
          <div className="space-y-2">
            {OUTCOMES.map((o) => (
              <label key={o.id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2', outcome === o.id ? 'border-secondary bg-mist/60' : 'border-line hover:bg-surface')}>
                <input type="radio" name="outcome" className="mt-1 accent-primary" value={o.id} checked={outcome === o.id} onChange={() => setOutcome(o.id)} />
                <span>
                  <span className="block text-sm font-medium text-ink">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Comment" htmlFor="review-comment" required error={error ?? undefined} hint="Say what you checked. This is kept in the alert history.">
          <Textarea id="review-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} invalid={!!error} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Full history of one alert, with re-open for reviewers. */
export function AlertHistoryDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['anomaly', id], queryFn: () => get<Anomaly & { events: { id: string; action: string; comment: string | null; actorName: string | null; occurredAt: string }[]; canReview: boolean }>(`/anomalies/${id}`) });
  const [reason, setReason] = useState('');
  const reopen = useMutation({
    mutationFn: () => post(`/anomalies/${id}/reopen`, { comment: reason.trim() }),
    onSuccess: () => {
      toast.success('Alert re-opened.');
      onChanged();
      q.refetch();
      setReason('');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const a = q.data;
  const ACTION: Record<string, string> = { DETECTED: 'Detected', REVIEWED: 'Reviewed', REOPENED: 'Re-opened', CLEARED: 'Cleared', REDETECTED: 'Detected again' };
  return (
    <Dialog open onClose={onClose} title="Alert history" width="lg">
      {q.isLoading ? (
        <Spinner />
      ) : !a ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
              <SeverityBadge severity={a.severity} /> {a.ruleLabel} <AlertStatusBadge a={a} />
            </p>
            <p className="text-sm text-ink">{a.message}</p>
            <p className="text-xs text-muted">
              {a.employeeCode} · {a.employeeName} · <Link className="text-cobalt hover:underline" href={`/payroll/${a.runId}`}>{a.period}</Link>
            </p>
          </div>
          <ol className="relative space-y-3 border-l border-line pl-4">
            {a.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-secondary ring-4 ring-white" aria-hidden />
                <p className="text-sm font-medium text-ink">
                  {ACTION[e.action] ?? e.action} <span className="font-normal text-muted">· {e.actorName ?? 'System'} · {formatDateTime(e.occurredAt)}</span>
                </p>
                {e.comment && <p className="text-sm text-ink">{e.comment}</p>}
              </li>
            ))}
          </ol>
          {a.status === 'REVIEWED' && a.canReview && (
            <div className="space-y-2 border-t border-line pt-4">
              <Field label="Re-open with a reason" htmlFor="reopen-reason" hint="Use this if the review was wrong.">
                <Textarea id="reopen-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
              </Field>
              <div className="flex justify-end">
                <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} disabled={reason.trim().length < 5} loading={reopen.isPending} onClick={() => reopen.mutate()}>
                  Re-open alert
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

export function AlertList({ items, canReview, onReview, onHistory, showPeriod }: { items: Anomaly[]; canReview: boolean; onReview: (a: Anomaly) => void; onHistory: (a: Anomaly) => void; showPeriod?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => (
        <li key={a.id} className={cn('fx-row flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start', a.status === 'CLEARED' && 'opacity-70')}>
          <div className="flex shrink-0 items-center gap-2 sm:w-28 sm:flex-col sm:items-start">
            <SeverityBadge severity={a.severity} />
            <AlertStatusBadge a={a} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium text-ink">
              {a.ruleLabel}
              <span className="font-normal text-muted">
                {' '}
                · {a.employeeCode} {a.employeeName}
                {showPeriod && <> · {a.period}</>}
              </span>
            </p>
            <p className="text-sm leading-relaxed text-ink">{a.message}</p>
            {a.status === 'REVIEWED' && a.reviewComment && (
              <p className="text-xs text-muted">
                Reviewed by {a.reviewedByName} on {formatDateTime(a.reviewedAt)}: “{a.reviewComment}”
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="ghost" icon={<History className="h-4 w-4" />} onClick={() => onHistory(a)}>
              History
            </Button>
            {a.status === 'OPEN' && canReview && (
              <Button size="sm" variant="secondary" onClick={() => onReview(a)}>
                Review
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Alerts tab on the payroll run page. */
export function RunAlerts({ runId, canRescan }: { runId: string; canRescan: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('ACTIVE');
  const [reviewing, setReviewing] = useState<Anomaly | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['run-alerts', runId, status],
    queryFn: () => get<{ items: Anomaly[]; counts: AnomalyCounts; canReview: boolean; rulesConfigured: boolean }>(`/payroll-runs/${runId}/anomalies?status=${status}`),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['run-alerts', runId] });
    qc.invalidateQueries({ queryKey: ['alerts'] });
  };
  const scan = useMutation({
    mutationFn: () => post<{ enabled: boolean; detected: number; opened: number; reopened: number; cleared: number }>(`/payroll-runs/${runId}/anomalies/scan`),
    onSuccess: (r) => {
      refresh();
      toast.success(r.enabled ? `Checked: ${r.detected} alert(s), ${r.opened} new, ${r.reopened} re-opened, ${r.cleared} cleared.` : 'Payroll alerts are switched off in Payroll settings.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { items, counts, canReview } = q.data;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <p className="text-sm text-ink">
          <strong>{counts.open}</strong> need review
          {counts.open > 0 && (
            <span className="text-muted">
              {' '}
              ({counts.openHigh} high, {counts.openMedium} medium, {counts.openLow} low)
            </span>
          )}{' '}
          · {counts.reviewed} reviewed · {counts.cleared} cleared
        </p>
        <div className="flex-1" />
        <label className="sr-only" htmlFor="alert-status">
          Show
        </label>
        <Select id="alert-status" className="h-8 w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ACTIVE">Open and reviewed</option>
          <option value="OPEN">Needs review</option>
          <option value="REVIEWED">Reviewed</option>
          <option value="CLEARED">Cleared</option>
          <option value="ALL">All</option>
        </Select>
        {canRescan && (
          <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={scan.isPending} onClick={() => scan.mutate()}>
            Check again
          </Button>
        )}
      </div>
      {items.length ? (
        <AlertList items={items} canReview={canReview} onReview={setReviewing} onHistory={(a) => setHistory(a.id)} />
      ) : (
        <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No alerts to show" hint="Nothing unusual was found compared with earlier finalised months, or every alert is filtered out." />
      )}
      {reviewing && (
        <ReviewDialog
          alert={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            refresh();
          }}
        />
      )}
      {history && <AlertHistoryDialog id={history} onClose={() => setHistory(null)} onChanged={refresh} />}
    </div>
  );
}
