'use client';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, CheckCheck, Download, Eye, FileStack, Lock, Printer, RotateCcw, Send, Undo2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  KeyValue,
  PageHeader,
  RequirePermission,
  Select,
  Spinner,
  StatusBadge,
  Tabs,
  cn,
  download,
  errorMessage,
  formatDateTime,
  formatMoney,
  get,
  humanize,
  openPdf,
  post,
  useAuth,
  useToast,
} from '@nexzi/ui';
import { InputGrid } from '@/components/input-grid';
import type { RunDetail, RunStatus } from '@/lib/types';

type Tab = 'inputs' | 'results' | 'exceptions' | 'payslips' | 'timeline';
type Action = 'calculate' | 'submit' | 'return' | 'approve' | 'finalise' | 'reopen';

export default function RunPage() {
  return (
    <RequirePermission permission="payroll.view">
      <RunWorkspace />
    </RequirePermission>
  );
}

const STEPS: RunStatus[] = ['DRAFT', 'CALCULATED', 'UNDER_REVIEW', 'APPROVED', 'FINALISED'];

function Stepper({ status, requireApproval }: { status: RunStatus; requireApproval: boolean }) {
  const steps = requireApproval ? STEPS : STEPS.filter((s) => s !== 'APPROVED');
  const idx = steps.indexOf(status);
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2" aria-label="Payroll status">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
              i < idx && 'border-cobalt/30 bg-mist/50 text-cobalt',
              i === idx && 'border-primary bg-primary text-white',
              i > idx && 'border-line bg-white text-muted',
            )}
            aria-current={i === idx ? 'step' : undefined}
          >
            <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px]', i === idx ? 'bg-white/20' : 'bg-white')}>{i + 1}</span>
            {humanize(s)}
          </span>
          {i < steps.length - 1 && <span className="h-px w-5 bg-line" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function RunWorkspace() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('inputs');
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [ackWarnings, setAckWarnings] = useState(false);
  const q = useQuery({ queryKey: ['run', id], queryFn: () => get<RunDetail>(`/payroll-runs/${id}`) });
  const run = q.data;

  const act = useMutation({
    mutationFn: ({ action, reason }: { action: Action; reason?: string }) => {
      const path = { calculate: 'calculate', submit: 'submit-review', return: 'return', approve: 'approve', finalise: 'finalise', reopen: 'reopen' }[action];
      const body = action === 'submit' ? { acknowledgeWarnings: ackWarnings } : reason !== undefined ? { reason } : undefined;
      return post<{ status: string; ok?: number; warning?: number; error?: number }>(`/payroll-runs/${id}/${path}`, body);
    },
    onSuccess: (res, { action }) => {
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ['run', id] });
      qc.invalidateQueries({ queryKey: ['run-inputs', id] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      if (action === 'calculate') {
        toast.success(`Calculated: ${res.ok} OK, ${res.warning} with warnings, ${res.error} with errors.`);
        setTab(res.error || res.warning ? 'exceptions' : 'results');
      } else toast.success(`Payroll is now ${humanize(res.status)}.`);
    },
    onError: (e) => {
      setConfirm(null);
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: ['run', id] });
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error || !run) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;

  const has = (a: string) => run.allowedActions.includes(a);
  const errors = run.resultCounts.ERROR ?? 0;
  const warnings = run.resultCounts.WARNING ?? 0;
  const pending = run.resultCounts.PENDING ?? 0;
  const exceptionCount = run.employees.filter((e) => e.exceptions.length).length;

  const confirmCopy: Record<Action, { title: string; message: string; label: string; tone?: 'danger'; reason?: { label: string; minLength: number } }> = {
    calculate: { title: 'Calculate payroll', message: 'All amounts are recalculated on the server from the current salary structures and saved inputs. Previous results for this run are replaced.', label: 'Calculate' },
    submit: { title: 'Submit for review', message: warnings ? `${warnings} employee(s) have warnings. Submitting confirms you have reviewed them.` : 'The results will be locked for review.', label: 'Submit for review' },
    return: { title: 'Return for correction', message: 'The run goes back to Calculated so inputs can be corrected and recalculated.', label: 'Return', reason: { label: 'Reason', minLength: 5 } },
    approve: { title: 'Approve payroll', message: `Approve ${run.period} payroll for ${run.employeeCount} employees${run.canSeeAmounts ? ` with total net pay ${formatMoney(run.totalNet)}` : ''}?`, label: 'Approve' },
    finalise: {
      title: 'Finalise payroll',
      message: 'Finalising locks every result as an immutable snapshot. Later salary or master changes will not alter it. Only an Administrator can re-open it, with a reason.',
      label: 'Finalise',
      tone: 'danger',
    },
    reopen: { title: 'Re-open finalised payroll', message: 'Re-opening unlocks the results for correction and supersedes issued payslips. This is recorded in the audit log.', label: 'Re-open', tone: 'danger', reason: { label: 'Reason for re-opening', minLength: 10 } },
  };

  return (
    <>
      <PageHeader
        title={`${run.period} payroll`}
        badge={
          <>
            <StatusBadge status={run.status} />
            {run.status !== 'DRAFT' && (run.rulesApproved ? <Badge tone="success">Rules approved</Badge> : <Badge tone="warning">Provisional rules</Badge>)}
          </>
        }
        description={`${run.employeeCount} employees${run.calculatedAt ? ` · calculated ${formatDateTime(run.calculatedAt)}` : ''}${run.finalisedAt ? ` · finalised ${formatDateTime(run.finalisedAt)}` : ''}`}
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Payroll runs', href: '/payroll' }, { label: run.period }]}
        actions={
          <>
            {has('calculate') && (
              <Button icon={<Calculator className="h-4 w-4" />} onClick={() => setConfirm('calculate')}>
                {run.status === 'DRAFT' ? 'Calculate' : 'Recalculate'}
              </Button>
            )}
            {has('submit') && (
              <Button variant="secondary" icon={<Send className="h-4 w-4" />} disabled={errors + pending > 0} title={errors + pending > 0 ? 'Resolve blocking exceptions first' : undefined} onClick={() => setConfirm('submit')}>
                Submit for review
              </Button>
            )}
            {has('return') && (
              <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => setConfirm('return')}>
                Return
              </Button>
            )}
            {has('approve') && (
              <Button icon={<CheckCheck className="h-4 w-4" />} onClick={() => setConfirm('approve')}>
                Approve
              </Button>
            )}
            {has('finalise') && (
              <Button icon={<Lock className="h-4 w-4" />} onClick={() => setConfirm('finalise')}>
                Finalise
              </Button>
            )}
            {has('reopen') && (
              <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm('reopen')}>
                Re-open
              </Button>
            )}
          </>
        }
      />
      <Stepper status={run.status} requireApproval={run.requireApprovalStep} />

      {run.status !== 'DRAFT' && (errors > 0 || pending > 0) && (
        <Alert tone="danger" className="mb-4" title={`${errors + pending} employee(s) have blocking exceptions`}>
          Missing inputs, missing salary structures or unconfigured formulas must be resolved and the payroll recalculated before it can be submitted.
        </Alert>
      )}
      {run.status === 'FINALISED' && !run.rulesApproved && (
        <Alert tone="warning" className="mb-4">This run was finalised with provisional calculation rules. Payslips are watermarked PROVISIONAL.</Alert>
      )}

      {run.canSeeAmounts && run.status !== 'DRAFT' && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {[
            ['Total earnings', run.totalEarnings],
            ['Total deductions', run.totalDeductions],
            ['Total net pay', run.totalNet],
          ].map(([l, v]) => (
            <div key={l} className="rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{l}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-primary">{formatMoney(v)}</p>
            </div>
          ))}
        </div>
      )}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'inputs', label: 'Monthly inputs' },
          { id: 'results', label: 'Results', hidden: run.status === 'DRAFT' },
          { id: 'exceptions', label: `Exceptions (${exceptionCount})`, hidden: run.status === 'DRAFT' },
          { id: 'payslips', label: 'Payslips', hidden: run.status === 'DRAFT' || !can('payslips.generate') },
          { id: 'timeline', label: 'Timeline' },
        ]}
      />
      <Card padded={false}>
        {tab === 'inputs' && <InputGrid runId={run.id} editable={has('editInputs')} onSaved={() => q.refetch()} />}
        {tab === 'results' && <Results run={run} />}
        {tab === 'exceptions' && <Exceptions run={run} />}
        {tab === 'payslips' && <Payslips run={run} />}
        {tab === 'timeline' && <Timeline run={run} />}
      </Card>

      {confirm && (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          onConfirm={(reason) => act.mutate({ action: confirm, reason: confirmCopy[confirm].reason ? reason : undefined })}
          loading={act.isPending}
          title={confirmCopy[confirm].title}
          message={
            <div className="space-y-3">
              <p>{confirmCopy[confirm].message}</p>
              {confirm === 'submit' && warnings > 0 && (
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" className="accent-primary" checked={ackWarnings} onChange={(e) => setAckWarnings(e.target.checked)} /> I have reviewed the warnings
                </label>
              )}
            </div>
          }
          confirmLabel={confirmCopy[confirm].label}
          tone={confirmCopy[confirm].tone}
          reason={confirmCopy[confirm].reason}
        />
      )}
    </>
  );
}

function Results({ run }: { run: RunDetail }) {
  const [filter, setFilter] = useState<'ALL' | 'ERROR' | 'WARNING'>('ALL');
  const [detail, setDetail] = useState<string | null>(null);
  const rows = run.employees.filter((e) => filter === 'ALL' || e.resultStatus === filter);
  if (!run.canSeeAmounts) return <EmptyState title="Amounts hidden" hint="Your role does not include permission to view payroll amounts." />;
  const earnCols = run.componentColumns.filter((c) => c.type === 'EARNING');
  const dedCols = run.componentColumns.filter((c) => c.type === 'DEDUCTION');
  return (
    <>
      <div className="no-print flex items-center gap-3 border-b border-line px-4 py-3">
        <Select className="h-9 w-48" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter results">
          <option value="ALL">All employees</option>
          <option value="ERROR">Errors only</option>
          <option value="WARNING">Warnings only</option>
        </Select>
        <span className="text-xs text-muted">Select a row to see how each amount was calculated.</span>
      </div>
      <DataTable
        dense
        rows={rows}
        rowKey={(e) => e.employeeId}
        empty={<EmptyState title="No employees match this filter" />}
        columns={[
          {
            key: 'emp',
            header: 'Employee',
            render: (e) => (
              <button className="text-left" onClick={() => setDetail(e.employeeId)}>
                <span className="font-medium text-cobalt hover:underline">{e.employeeCode}</span>
                <span className="block text-xs text-muted">{e.employeeName}</span>
              </button>
            ),
          },
          { key: 'st', header: 'Result', render: (e) => <StatusBadge status={e.resultStatus} /> },
          ...earnCols.map((c) => ({ key: `c_${c.code}`, header: c.name, align: 'right' as const, render: (e: RunDetail['employees'][number]) => formatMoney(e.lines[c.code] ?? null) })),
          { key: 'gross', header: 'Gross', align: 'right', render: (e) => <strong>{formatMoney(e.gross)}</strong> },
          ...dedCols.map((c) => ({ key: `c_${c.code}`, header: c.name, align: 'right' as const, render: (e: RunDetail['employees'][number]) => formatMoney(e.lines[c.code] ?? null) })),
          { key: 'ded', header: 'Deductions', align: 'right', render: (e) => formatMoney(e.deductions) },
          { key: 'net', header: 'Net pay', align: 'right', render: (e) => <strong className={cn(e.net?.startsWith('-') && 'text-danger')}>{formatMoney(e.net)}</strong> },
        ]}
      />
      <div className="flex justify-end gap-8 border-t border-line bg-mist/25 px-4 py-3 text-sm">
        <span>
          Gross <strong className="tabular-nums">{formatMoney(run.totalEarnings)}</strong>
        </span>
        <span>
          Deductions <strong className="tabular-nums">{formatMoney(run.totalDeductions)}</strong>
        </span>
        <span>
          Net <strong className="tabular-nums text-primary">{formatMoney(run.totalNet)}</strong>
        </span>
      </div>
      {detail && <EmployeeDetail runId={run.id} employeeId={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function EmployeeDetail({ runId, employeeId, onClose }: { runId: string; employeeId: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['run-emp', runId, employeeId],
    queryFn: () =>
      get<{
        employeeCode: string;
        employeeName: string;
        salaryVersion: { versionNo: number; effectiveFrom: string } | null;
        gross: string | null;
        deductions: string | null;
        net: string | null;
        exceptions: { severity: string; message: string }[];
        inputs: Record<string, string>;
        lines: { code: string; name: string; type: string; basis: string; amount: string; detail: Record<string, string | null> | null }[];
      }>(`/payroll-runs/${runId}/employees/${employeeId}`),
  });
  const d = q.data;
  return (
    <Dialog open onClose={onClose} title={d ? `${d.employeeCode} · ${d.employeeName}` : 'Employee result'} width="lg">
      {!d ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <KeyValue
            columns={3}
            items={[
              { label: 'Salary version', value: d.salaryVersion ? `v${d.salaryVersion.versionNo} from ${d.salaryVersion.effectiveFrom}` : 'None' },
              { label: 'Gross', value: formatMoney(d.gross) },
              { label: 'Net pay', value: <strong>{formatMoney(d.net)}</strong> },
            ]}
          />
          {d.exceptions.map((x, i) => (
            <Alert key={i} tone={x.severity === 'ERROR' ? 'danger' : 'warning'}>
              {x.message}
            </Alert>
          ))}
          <table className="w-full text-sm">
            <thead className="bg-mist/35 text-left text-xs uppercase tracking-wide text-primary">
              <tr>
                <th className="px-3 py-2">Component</th>
                <th className="px-3 py-2">How calculated</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.code} className="border-b border-line">
                  <td className="px-3 py-2">
                    {l.name} <span className="text-xs text-muted">({l.type === 'EARNING' ? 'earning' : 'deduction'})</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {l.basis === 'FIXED' && 'Fixed monthly amount'}
                    {l.basis === 'PERCENTAGE' && `${l.detail?.rate}% of ${l.detail?.baseComponent} (${formatMoney(l.detail?.baseAmount ?? null)})`}
                    {l.basis === 'INPUT' && `Monthly input ${l.detail?.inputKey}`}
                    {l.basis === 'FORMULA' && `Formula ${l.detail?.formulaRef}`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}

function Exceptions({ run }: { run: RunDetail }) {
  const rows = run.employees.filter((e) => e.exceptions.length);
  if (!rows.length) return <EmptyState title="No exceptions" hint="Every employee was calculated without errors or warnings." />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((e) => (
        <li key={e.employeeId} className="flex flex-wrap items-start gap-4 px-5 py-3">
          <div className="w-56">
            <p className="text-sm font-medium text-ink">{e.employeeCode}</p>
            <p className="text-xs text-muted">{e.employeeName}</p>
          </div>
          <ul className="flex-1 space-y-1">
            {e.exceptions.map((x, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <StatusBadge status={x.severity} />
                <span className="text-ink">{x.message}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function Payslips({ run }: { run: RunDetail }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['payslips', run.id],
    queryFn: () => get<{ isFinal: boolean; items: { employeeId: string; employeeCode: string; employeeName: string; resultStatus: string; payslipId: string | null; generatedAt: string | null }[] }>(`/payroll-runs/${run.id}/payslips`),
  });
  const gen = useMutation({
    mutationFn: () => post<{ generated: number; alreadyPresent: number }>(`/payroll-runs/${run.id}/payslips/generate`),
    onSuccess: (r) => {
      toast.success(`${r.generated} payslip(s) generated (${r.alreadyPresent} already stored).`);
      qc.invalidateQueries({ queryKey: ['payslips', run.id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const run1 = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['payslips', run.id] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const valid = useMemo(() => q.data?.items.filter((i) => i.resultStatus !== 'ERROR' && i.resultStatus !== 'PENDING') ?? [], [q.data]);
  return (
    <>
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        {!q.data?.isFinal && <Badge tone="warning">Preview only — payroll not finalised</Badge>}
        <div className="flex-1" />
        {q.data?.isFinal && (
          <Button size="sm" variant="secondary" icon={<FileStack className="h-4 w-4" />} loading={gen.isPending} onClick={() => gen.mutate()}>
            Generate &amp; store all
          </Button>
        )}
        <Button size="sm" icon={<Printer className="h-4 w-4" />} loading={busy === 'bulk'} disabled={!valid.length} onClick={() => run1('bulk', () => download(`/payroll-runs/${run.id}/payslips/bulk`, 'payslips.pdf'))}>
          Bulk PDF (print-ready)
        </Button>
      </div>
      <DataTable
        dense
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error ? errorMessage(q.error) : null}
        rowKey={(i) => i.employeeId}
        columns={[
          { key: 'emp', header: 'Employee', render: (i) => (<span><span className="font-medium">{i.employeeCode}</span> <span className="text-muted">· {i.employeeName}</span></span>) },
          { key: 'st', header: 'Result', render: (i) => <StatusBadge status={i.resultStatus} /> },
          { key: 'gen', header: 'Stored payslip', render: (i) => (i.generatedAt ? formatDateTime(i.generatedAt) : '—') },
          {
            key: 'a',
            header: '',
            align: 'right',
            render: (i) =>
              i.resultStatus === 'ERROR' || i.resultStatus === 'PENDING' ? (
                <span className="text-xs text-muted">No valid result</span>
              ) : (
                <span className="inline-flex gap-1">
                  <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} loading={busy === `v${i.employeeId}`} onClick={() => run1(`v${i.employeeId}`, () => openPdf(`/payroll-runs/${run.id}/employees/${i.employeeId}/payslip?disposition=inline`))}>
                    View / print
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} loading={busy === `d${i.employeeId}`} onClick={() => run1(`d${i.employeeId}`, () => download(`/payroll-runs/${run.id}/employees/${i.employeeId}/payslip`, 'payslip.pdf'))}>
                    Download
                  </Button>
                </span>
              ),
          },
        ]}
      />
      <p className="px-4 py-3 text-xs text-muted">Payslip layout is an internal provisional format until the client&apos;s approved payslip template is supplied.</p>
    </>
  );
}

function Timeline({ run }: { run: RunDetail }) {
  return (
    <ol className="space-y-0 px-5 py-4">
      {run.events.map((e, i) => (
        <li key={i} className="relative border-l-2 border-mist pb-5 pl-5 last:pb-0">
          <span className="absolute -left-[7px] top-1 h-3 w-3 rounded-full border-2 border-white bg-cobalt" aria-hidden />
          <p className="text-sm font-medium text-ink">
            {humanize(e.action)} <span className="font-normal text-muted">→ {humanize(e.toStatus)}</span>
          </p>
          <p className="text-xs text-muted">
            {e.actorName ?? 'System'} · {formatDateTime(e.occurredAt)}
          </p>
          {e.reason && <p className="mt-1 rounded bg-canvas px-2 py-1 text-xs text-ink">“{e.reason}”</p>}
        </li>
      ))}
    </ol>
  );
}
