'use client';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, ListChecks } from 'lucide-react';
import { EmptyState, ErrorState, Spinner, cn, errorMessage, formatDateTime, get, put, useToast } from '@nexzi/ui';

interface ChecklistRow {
  itemId: string;
  label: string;
  description: string | null;
  article: { id: string; title: string } | null;
  done: boolean;
  note: string | null;
  doneByName: string | null;
  doneAt: string | null;
}

/** Monthly checklist for a payroll run. Tracks the process only; it never changes payroll. */
export function RunChecklist({ runId }: { runId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ['run-checklist', runId];
  const q = useQuery({ queryKey: key, queryFn: () => get<{ items: ChecklistRow[]; done: number; total: number; canUpdate: boolean }>(`/payroll-runs/${runId}/checklist`) });
  const m = useMutation({
    mutationFn: ({ itemId, done }: { itemId: string; done: boolean }) => put(`/payroll-runs/${runId}/checklist/${itemId}`, { done }),
    onMutate: async ({ itemId, done }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<typeof q.data>(key);
      if (prev) qc.setQueryData(key, { ...prev, done: prev.done + (done ? 1 : -1), items: prev.items.map((i) => (i.itemId === itemId ? { ...i, done } : i)) });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const { items, done, total, canUpdate } = q.data;
  if (!total) return <EmptyState icon={<ListChecks className="h-6 w-6" />} title="No checklist configured" hint="Knowledge managers can add steps in the Knowledge centre → Monthly checklist." />;
  const pct = Math.round((done / total) * 100);

  return (
    <div>
      <div className="border-b border-line px-5 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-ink">
            {done} of {total} steps done
          </span>
          <span className="text-muted">{pct}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Checklist progress">
          <div className="h-full rounded-full bg-gradient-to-r from-secondary to-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ul className="divide-y divide-line">
        {items.map((i) => (
          <li key={i.itemId} className="flex items-start gap-3 px-5 py-3">
            <input
              type="checkbox"
              className="fx-check mt-0.5"
              id={`step-${i.itemId}`}
              checked={i.done}
              disabled={!canUpdate || m.isPending}
              onChange={(e) => m.mutate({ itemId: i.itemId, done: e.target.checked })}
            />
            <div className="min-w-0 flex-1">
              <label htmlFor={`step-${i.itemId}`} className={cn('block cursor-pointer text-sm font-medium', i.done ? 'text-muted line-through decoration-accent/60' : 'text-ink')}>
                {i.label}
              </label>
              {i.description && <p className="text-xs text-muted">{i.description}</p>}
              {i.done && i.doneByName && (
                <p className="text-xs text-accent-ink">
                  Done by {i.doneByName} · {formatDateTime(i.doneAt)}
                </p>
              )}
            </div>
            {i.article && (
              <Link href={`/knowledge/${i.article.id}`} className="flex shrink-0 items-center gap-1 text-xs font-medium text-cobalt hover:underline">
                <BookOpen className="h-3.5 w-3.5" /> How to
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
