'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, FileDown, FileSpreadsheet, MessageSquareText } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  RequirePermission,
  SearchInput,
  Select,
  Spinner,
  StatCard,
  Textarea,
  Toolbar,
  cn,
  download,
  errorMessage,
  formatMoney,
  get,
  put,
  qs,
  useAuth,
  useToast,
  type Page,
} from '@nexzi/ui';
import type { ChangeKind, Explanation, ReconEmployee, Reconciliation, RunSummary } from '@/lib/types';

const CHANGE: Record<ChangeKind, { label: string; tone: 'brand' | 'warning' | 'info' | 'neutral' }> = {
  NEW: { label: 'New this month', tone: 'brand' },
  MISSING: { label: 'Not in this month', tone: 'warning' },
  CHANGED: { label: 'Changed', tone: 'info' },
  UNCHANGED: { label: 'Unchanged', tone: 'neutral' },
};
const EXPLAIN: Record<Explanation, { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }> = {
  UNEXPLAINED: { label: 'Not yet explained', tone: 'warning' },
  DISCREPANCY: { label: 'Discrepancy', tone: 'danger' },
  EXPECTED: { label: 'Expected', tone: 'success' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
};

const pct = (p: string | null) => (p === null ? '—' : `${Number(p) > 0 ? '+' : ''}${Number(p).toFixed(1)}%`);
const signed = (v: string) => (Number(v) > 0 ? `+${formatMoney(v)}` : formatMoney(v));
const diffClass = (v: string) => (Number(v) > 0 ? 'text-accent-ink' : Number(v) < 0 ? 'text-danger' : 'text-muted');

export default function ReconciliationPage() {
  return (
    <RequirePermission permission="reports.view">
      <PageHeader
        title="Reconciliation"
        description="Compare two payroll months employee by employee and component by component. Explain each difference as expected, or flag it as a discrepancy until it is resolved."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Reconciliation' }]}
      />
      <Workspace />
    </RequirePermission>
  );
}

function Workspace() {
  const { can } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const runsQ = useQuery({ queryKey: ['runs', 'recon'], queryFn: () => get<Page<RunSummary>>(`/payroll-runs${qs({ pageSize: 200, sortBy: 'period', sortDir: 'desc' })}`), enabled: can('payroll.view') });
  const runs = useMemo(() => (runsQ.data?.items ?? []).filter((r) => r.status !== 'DRAFT').sort((a, b) => b.year - a.year || b.month - a.month), [runsQ.data]);

  const compareRunId = sp.get('compareRunId') ?? '';
  const baseRunId = sp.get('baseRunId') ?? '';
  const setParams = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`/reconciliation?${next.toString()}`, { scroll: false });
  };
  // Default: latest calculated month vs the month before it.
  useEffect(() => {
    if (!runs.length) return;
    const cmp = compareRunId && runs.some((r) => r.id === compareRunId) ? compareRunId : runs[0].id;
    const idx = runs.findIndex((r) => r.id === cmp);
    const base = baseRunId && runs.some((r) => r.id === baseRunId) && baseRunId !== cmp ? baseRunId : runs[idx + 1]?.id ?? '';
    if (cmp !== compareRunId || base !== baseRunId) setParams({ compareRunId: cmp, baseRunId: base });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, compareRunId, baseRunId]);

  if (!can('payroll.view_amounts')) return <Alert tone="warning">Reconciliation compares payroll amounts, and your role does not include permission to view them.</Alert>;
  if (runsQ.isLoading) return <Spinner />;
  if (runs.length < 2)
    return (
      <Card>
        <EmptyState icon={<ArrowLeftRight className="h-6 w-6" />} title="Two calculated months are needed" hint="Reconciliation compares calculated or finalised payroll runs. Calculate at least two months to compare them." />
      </Card>
    );

  return (
    <>
      <Card className="mb-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <Field label="Compare against (earlier month)" htmlFor="base">
            <Select id="base" value={baseRunId} onChange={(e) => setParams({ baseRunId: e.target.value })}>
              {runs.map((r) => (
                <option key={r.id} value={r.id} disabled={r.id === compareRunId}>
                  {r.period} · {r.status === 'FINALISED' ? 'Finalised' : 'Not final'}
                </option>
              ))}
            </Select>
          </Field>
          <ArrowLeftRight className="mx-auto hidden h-5 w-5 text-secondary sm:mb-2.5 sm:block" aria-hidden />
          <Field label="Month to check" htmlFor="compare">
            <Select id="compare" value={compareRunId} onChange={(e) => setParams({ compareRunId: e.target.value })}>
              {runs.map((r) => (
                <option key={r.id} value={r.id} disabled={r.id === baseRunId}>
                  {r.period} · {r.status === 'FINALISED' ? 'Finalised' : 'Not final'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      {baseRunId && compareRunId && baseRunId !== compareRunId && <Comparison baseRunId={baseRunId} compareRunId={compareRunId} />}
    </>
  );
}

function Comparison({ baseRunId, compareRunId }: { baseRunId: string; compareRunId: string }) {
  const toast = useToast();
  const [filters, setFilters] = useState({ change: 'DIFFERENCES', explanation: 'ALL', department: '', component: '', search: '' });
  const [open, setOpen] = useState<ReconEmployee | null>(null);
  const params = { baseRunId, compareRunId, ...filters };
  const q = useQuery({ queryKey: ['reconciliation', params], queryFn: () => get<Reconciliation>(`/reconciliation${qs(params)}`), placeholderData: (prev) => prev });
  const [exporting, setExporting] = useState<string | null>(null);
  const exportAs = async (format: 'pdf' | 'xlsx') => {
    setExporting(format);
    try {
      await download(`/reconciliation/export${qs({ ...params, format })}`, `reconciliation.${format}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(null);
    }
  };

  if (q.isLoading && !q.data) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data;
  const set = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const notFinal = [d.base, d.compare].filter((x) => x.status !== 'FINALISED');

  return (
    <>
      {notFinal.length > 0 && (
        <Alert tone="info" className="mb-4">
          {notFinal.map((x) => x.period).join(' and ')} {notFinal.length > 1 ? 'are' : 'is'} not finalised, so figures can still change.
        </Alert>
      )}
      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`Net pay ${d.compare.period}`} value={formatMoney(d.totals.compare.net)} hint={<span className={diffClass(d.totals.difference.net)}>{signed(d.totals.difference.net)} ({pct(d.totals.netChangePercent)}) vs {d.base.period}</span>} />
        <StatCard label="Unresolved differences" value={d.summary.unresolved} tone={d.summary.unresolved ? 'attention' : 'default'} hint={`${d.summary.unexplained} not explained · ${d.summary.discrepancies} discrepancies`} />
        <StatCard label="Explained" value={d.summary.expected + d.summary.resolved} hint={`${d.summary.expected} expected · ${d.summary.resolved} resolved`} />
        <StatCard label="Employees" value={`${d.compare.employees} vs ${d.base.employees}`} hint={`${d.counts.NEW} new · ${d.counts.MISSING} not in ${d.compare.period} · ${d.counts.CHANGED} changed`} />
      </div>

      <Card title="Component totals" className="mb-5" padded={false}>
        <DataTable
          dense
          rows={d.components}
          rowKey={(c) => c.code}
          caption="Component totals"
          columns={[
            { key: 'name', header: 'Component', render: (c) => <span className="font-medium text-ink">{c.name}</span> },
            { key: 'type', header: 'Type', render: (c) => (c.type === 'EARNING' ? 'Earning' : 'Deduction') },
            { key: 'base', header: d.base.period, align: 'right', render: (c) => formatMoney(c.base) },
            { key: 'compare', header: d.compare.period, align: 'right', render: (c) => formatMoney(c.compare) },
            { key: 'diff', header: 'Difference', align: 'right', render: (c) => <span className={diffClass(c.difference)}>{signed(c.difference)}</span> },
            { key: 'pct', header: '%', align: 'right', render: (c) => pct(c.changePercent) },
          ]}
        />
      </Card>

      <Card padded={false} title="Employee differences" actions={
        <>
          <Button size="sm" variant="secondary" icon={<FileDown className="h-4 w-4" />} loading={exporting === 'pdf'} onClick={() => exportAs('pdf')}>
            PDF
          </Button>
          <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={exporting === 'xlsx'} onClick={() => exportAs('xlsx')}>
            XLSX
          </Button>
        </>
      }>
        <Toolbar>
          <SearchInput value={filters.search} onChange={(v) => set('search', v)} placeholder="Employee ID or name…" className="sm:w-60" />
          <Select aria-label="Change" className="sm:w-48" value={filters.change} onChange={(e) => set('change', e.target.value)}>
            <option value="DIFFERENCES">All differences</option>
            <option value="CHANGED">Changed</option>
            <option value="NEW">New this month</option>
            <option value="MISSING">Not in this month</option>
            <option value="UNCHANGED">Unchanged</option>
            <option value="ALL">Everyone</option>
          </Select>
          <Select aria-label="Explanation" className="sm:w-48" value={filters.explanation} onChange={(e) => set('explanation', e.target.value)}>
            <option value="ALL">Any explanation</option>
            <option value="UNRESOLVED">Unresolved</option>
            <option value="UNEXPLAINED">Not yet explained</option>
            <option value="DISCREPANCY">Discrepancy</option>
            <option value="EXPECTED">Expected</option>
            <option value="RESOLVED">Resolved</option>
          </Select>
          <Select aria-label="Department" className="sm:w-44" value={filters.department} onChange={(e) => set('department', e.target.value)}>
            <option value="">All departments</option>
            {d.departments.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
          <Select aria-label="Component" className="sm:w-44" value={filters.component} onChange={(e) => set('component', e.target.value)}>
            <option value="">Any component</option>
            {d.components.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Toolbar>
        <DataTable
          rows={d.employees}
          rowKey={(e) => e.employeeId}
          caption="Employee differences"
          empty={<EmptyState title="Nothing to reconcile" hint="No employee matches these filters." />}
          columns={[
            {
              key: 'emp',
              header: 'Employee',
              render: (e) => (
                <span>
                  <span className="block font-medium text-ink">{e.employeeCode}</span>
                  <span className="block text-xs text-muted">{e.employeeName}</span>
                </span>
              ),
            },
            { key: 'dept', header: 'Department', render: (e) => e.departmentName ?? '—' },
            { key: 'change', header: 'Change', render: (e) => <Badge tone={CHANGE[e.change].tone}>{CHANGE[e.change].label}</Badge> },
            { key: 'base', header: `Net ${d.base.period}`, align: 'right', render: (e) => (e.base ? formatMoney(e.base.net) : '—') },
            { key: 'cmp', header: `Net ${d.compare.period}`, align: 'right', render: (e) => (e.compare ? formatMoney(e.compare.net) : '—') },
            { key: 'diff', header: 'Difference', align: 'right', render: (e) => <span className={cn('font-medium', diffClass(e.difference.net))}>{signed(e.difference.net)}</span> },
            { key: 'pct', header: '%', align: 'right', render: (e) => pct(e.netChangePercent) },
            {
              key: 'status',
              header: 'Status',
              render: (e) =>
                e.explanation ? (
                  <span title={e.note?.note}>
                    <Badge tone={EXPLAIN[e.explanation].tone}>{EXPLAIN[e.explanation].label}</Badge>
                  </span>
                ) : (
                  '—'
                ),
            },
            {
              key: 'act',
              header: <span className="sr-only">Details</span>,
              align: 'right',
              render: (e) => (
                <Button size="sm" variant="ghost" icon={<MessageSquareText className="h-4 w-4" />} onClick={() => setOpen(e)}>
                  {d.canExplain && e.change !== 'UNCHANGED' && !e.note ? 'Explain' : 'Details'}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      {open && <EmployeeDialog e={open} d={d} onClose={() => setOpen(null)} onSaved={(fresh) => setOpen(fresh)} />}
    </>
  );
}

function EmployeeDialog({ e, d, onClose, onSaved }: { e: ReconEmployee; d: Reconciliation; onClose: () => void; onSaved: (fresh: ReconEmployee) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const changed = e.components.filter((c) => c.change !== 'UNCHANGED');
  const [target, setTarget] = useState('');
  const current = target ? e.components.find((c) => c.code === target)?.note : e.note;
  const [classification, setClassification] = useState<string>(current?.classification ?? 'EXPECTED');
  const [note, setNote] = useState(current?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const n = target ? e.components.find((c) => c.code === target)?.note : e.note;
    setClassification(n?.classification ?? 'EXPECTED');
    setNote(n?.note ?? '');
    setError(null);
  }, [target, e]);

  const m = useMutation({
    mutationFn: () => put('/reconciliation/notes', { baseRunId: d.base.runId, compareRunId: d.compare.runId, employeeId: e.employeeId, componentCode: target, classification, note: note.trim() }),
    onSuccess: async () => {
      toast.success('Explanation saved.');
      await qc.invalidateQueries({ queryKey: ['reconciliation'] });
      const fresh = await get<Reconciliation>(`/reconciliation${qs({ baseRunId: d.base.runId, compareRunId: d.compare.runId, change: 'ALL', search: e.employeeCode })}`);
      const row = fresh.employees.find((x) => x.employeeId === e.employeeId);
      if (row) onSaved(row);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Dialog open onClose={onClose} width="lg" title={`${e.employeeCode} · ${e.employeeName}`}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={CHANGE[e.change].tone}>{CHANGE[e.change].label}</Badge>
          {e.explanation && <Badge tone={EXPLAIN[e.explanation].tone}>{EXPLAIN[e.explanation].label}</Badge>}
          <span className="text-muted">
            Net {e.base ? formatMoney(e.base.net) : '—'} → {e.compare ? formatMoney(e.compare.net) : '—'} (<span className={diffClass(e.difference.net)}>{signed(e.difference.net)}</span>, {pct(e.netChangePercent)})
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Component</th>
                <th className="px-3 py-2 text-right">{d.base.period}</th>
                <th className="px-3 py-2 text-right">{d.compare.period}</th>
                <th className="px-3 py-2 text-right">Difference</th>
                <th className="px-3 py-2 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {e.components.map((c) => (
                <tr key={c.code} className={cn('border-t border-line', c.change === 'UNCHANGED' && 'text-muted')}>
                  <td className="px-3 py-2">
                    {c.name} <span className="text-xs text-muted">({c.type === 'EARNING' ? 'earning' : 'deduction'})</span>
                    {c.note && <p className="text-xs text-accent-ink">“{c.note.note}”</p>}
                  </td>
                  <td className="px-3 py-2 text-right">{c.base === null ? '—' : formatMoney(c.base)}</td>
                  <td className="px-3 py-2 text-right">{c.compare === null ? '—' : formatMoney(c.compare)}</td>
                  <td className={cn('px-3 py-2 text-right', diffClass(c.difference))}>{signed(c.difference)}</td>
                  <td className="px-3 py-2 text-right">{pct(c.changePercent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {e.note && (
          <p className="text-sm text-ink">
            <span className="font-medium">Explanation:</span> {e.note.note} <span className="text-xs text-muted">— {e.note.updatedByName}</span>
          </p>
        )}
        {d.canExplain ? (
          <div className="space-y-3 border-t border-line pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Explain" htmlFor="explain-target">
                <Select id="explain-target" value={target} onChange={(ev) => setTarget(ev.target.value)}>
                  <option value="">The employee’s overall difference</option>
                  {changed.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} only
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status" htmlFor="explain-class">
                <Select id="explain-class" value={classification} onChange={(ev) => setClassification(ev.target.value)}>
                  <option value="EXPECTED">Expected — the change is correct</option>
                  <option value="DISCREPANCY">Discrepancy — needs correction</option>
                  <option value="RESOLVED">Resolved — the discrepancy was fixed</option>
                </Select>
              </Field>
            </div>
            <Field label="Explanation" htmlFor="explain-note" required error={error ?? undefined} hint="For example: salary revision from September, festival bonus, left on 31 July.">
              <Textarea id="explain-note" value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={1000} invalid={!!error} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button
                loading={m.isPending}
                onClick={() => {
                  if (note.trim().length < 5) return setError('Explain the difference in at least 5 characters.');
                  m.mutate();
                }}
              >
                Save explanation
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">Only users who calculate or approve payroll can record explanations.</p>
        )}
      </div>
    </Dialog>
  );
}
