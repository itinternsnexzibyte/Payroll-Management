'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Microscope, TriangleAlert } from 'lucide-react';
import { Alert, Badge, Card, EmptyState, ErrorState, Field, KeyValue, PageHeader, RequirePermission, Select, Spinner, StatusBadge, errorMessage, formatDateTime, formatMoney, get, humanize, type Page } from '@nexzi/ui';
import type { RunDetail, RunSummary } from '@/lib/types';

interface Explanation {
  run: { id: string; period: string; status: string; calculatedAt: string | null; finalisedAt: string | null; calcHash: string | null };
  employee: { id: string; employeeCode: string; employeeName: string; department: string | null; designation: string | null };
  salaryVersion: { versionNo: number; effectiveFrom: string; effectiveTo: string | null; changeReason: string | null; monthlyGross: string | null; createdBy: string | null; createdAt: string } | null;
  inputs: { inputKey: string; value: string; updatedBy: string | null; updatedAt: string }[];
  lines: { componentCode: string; componentName: string; type: 'EARNING' | 'DEDUCTION'; basis: string; amount: string; showOnPayslip: boolean; steps: string[] }[];
  totals: { gross: string | null; deductions: string | null; net: string | null; grossFormula: string; deductionsFormula: string };
  summary: { daysInMonth?: number; employedDays?: number; lopDays?: string; payableDays?: string; prorated?: boolean; employerPf?: string; employerEsi?: string; gratuity?: string };
  rounding: { scale: number; mode: string; level: string };
  exceptions: { severity: string; message: string }[];
  verification: { status: 'MATCH' | 'DIFFERENT' | 'NOT_CHECKED'; message: string; differences: { componentCode: string; stored: string | null; recalculated: string | null }[] };
  runEvents: { action: string; toStatus: string; actorName: string | null; reason: string | null; occurredAt: string }[];
  auditTrail: { occurredAt: string; action: string; actor: string | null }[];
}

export default function ExplainerPage() {
  return (
    <RequirePermission permission="payroll.view_amounts">
      <PageHeader
        title="Payroll calculation explainer"
        description="Trace every payslip amount to its source — salary structure, rates, attendance and inputs, statutory rules and rounding — and confirm it against a fresh recalculation."
        breadcrumbs={[{ label: 'Payroll runs', href: '/payroll' }, { label: 'Calculation explainer' }]}
      />
      <Suspense fallback={<Spinner />}>
        <Explainer />
      </Suspense>
    </RequirePermission>
  );
}

function Explainer() {
  const router = useRouter();
  const params = useSearchParams();
  const [runId, setRunId] = useState(params.get('runId') ?? '');
  const [employeeId, setEmployeeId] = useState(params.get('employeeId') ?? '');
  const runs = useQuery({ queryKey: ['runs-for-explainer'], queryFn: () => get<Page<RunSummary>>('/payroll-runs?pageSize=60&sortBy=period&sortDir=desc') });
  const run = useQuery({ queryKey: ['run', runId], queryFn: () => get<RunDetail>(`/payroll-runs/${runId}`), enabled: Boolean(runId) });
  const ex = useQuery({ queryKey: ['explain', runId, employeeId], queryFn: () => get<Explanation>(`/payroll-runs/${runId}/employees/${employeeId}/explain`), enabled: Boolean(runId && employeeId) });
  useEffect(() => {
    if (!runId && runs.data?.items.length) setRunId(runs.data.items.find((r) => r.status !== 'DRAFT')?.id ?? '');
  }, [runs.data, runId]);
  useEffect(() => {
    if (runId && employeeId) router.replace(`/explainer?runId=${runId}&employeeId=${employeeId}`, { scroll: false });
  }, [runId, employeeId, router]);

  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payroll month" htmlFor="ex-run">
            <Select id="ex-run" value={runId} onChange={(e) => { setRunId(e.target.value); setEmployeeId(''); }}>
              <option value="">Choose a month…</option>
              {runs.data?.items.filter((r) => r.status !== 'DRAFT').map((r) => (
                <option key={r.id} value={r.id}>
                  {r.period} · {humanize(r.status)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Employee" htmlFor="ex-emp">
            <Select id="ex-emp" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={!run.data}>
              <option value="">Choose an employee…</option>
              {run.data?.employees.map((m) => (
                <option key={m.employeeId} value={m.employeeId}>
                  {m.employeeCode} · {m.employeeName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      {!employeeId ? (
        <Card>
          <EmptyState icon={<Microscope className="h-6 w-6" />} title="Choose a month and an employee" hint="Every amount is broken down into the values, rates and rules that produced it." />
        </Card>
      ) : ex.isLoading ? (
        <Spinner />
      ) : ex.error ? (
        <ErrorState message={errorMessage(ex.error)} onRetry={() => ex.refetch()} />
      ) : (
        ex.data && <Result d={ex.data} />
      )}
    </div>
  );
}

function Result({ d }: { d: Explanation }) {
  const v = d.verification;
  const days = d.summary;
  return (
    <>
      <Alert tone={v.status === 'MATCH' ? 'success' : v.status === 'DIFFERENT' ? 'warning' : 'info'} title={v.status === 'MATCH' ? 'Verified' : v.status === 'DIFFERENT' ? 'Differs from today’s data' : 'Not verified'}>
        <span className="inline-flex items-start gap-2">
          {v.status === 'MATCH' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
          {v.message}
        </span>
        {v.differences.length > 0 && (
          <ul className="ml-6 mt-2 list-disc">
            {v.differences.map((x) => (
              <li key={x.componentCode}>
                {x.componentCode}: stored {x.stored === null ? '—' : formatMoney(x.stored)}, today {x.recalculated === null ? '—' : formatMoney(x.recalculated)}
              </li>
            ))}
          </ul>
        )}
      </Alert>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={`${d.employee.employeeCode} · ${d.employee.employeeName}`} className="xl:col-span-2">
          <KeyValue
            columns={3}
            items={[
              { label: 'Month', value: <span className="flex items-center gap-2">{d.run.period} <StatusBadge status={d.run.status} /></span> },
              { label: 'Calculated', value: formatDateTime(d.run.calculatedAt) },
              { label: 'Finalised', value: d.run.finalisedAt ? formatDateTime(d.run.finalisedAt) : '—' },
              { label: 'Gross', value: formatMoney(d.totals.gross) },
              { label: 'Deductions', value: formatMoney(d.totals.deductions) },
              { label: 'Net pay', value: <strong>{formatMoney(d.totals.net)}</strong> },
            ]}
          />
          <div className="mt-4 space-y-1 rounded-md bg-surface p-3 text-xs text-muted">
            <p><strong className="text-ink">Gross</strong> = {d.totals.grossFormula}</p>
            <p><strong className="text-ink">Deductions</strong> = {d.totals.deductionsFormula}</p>
            <p><strong className="text-ink">Net</strong> = Gross − Deductions · rounding {d.rounding.mode.replace('_', ' ').toLowerCase()} to {d.rounding.scale} decimals per {d.rounding.level.toLowerCase()}</p>
          </div>
        </Card>
        <Card title="Pay days">
          {days.daysInMonth ? (
            <KeyValue
              columns={2}
              items={[
                { label: 'Days in month', value: days.daysInMonth },
                { label: 'Days employed', value: days.employedDays },
                { label: 'Loss-of-pay days', value: days.lopDays },
                { label: 'Days payable', value: days.payableDays },
                { label: 'Employer PF / ESI', value: `${formatMoney(days.employerPf)} / ${formatMoney(days.employerEsi)}` },
                { label: 'Gratuity accrued', value: formatMoney(days.gratuity) },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">Calculated before pay-day summaries were recorded. Recalculate an open month to see them.</p>
          )}
        </Card>
      </div>
      <Card title="Line by line" padded={false}>
        <ol className="divide-y divide-line">
          {d.lines.map((l) => (
            <li key={l.componentCode} className="grid gap-2 px-4 py-3 sm:grid-cols-[260px_1fr_140px]">
              <div>
                <p className="font-medium text-ink">{l.componentName}</p>
                <p className="text-xs text-muted">
                  {l.componentCode} · <Badge tone={l.type === 'EARNING' ? 'success' : 'warning'}>{l.type.toLowerCase()}</Badge> <Badge tone="neutral">{l.basis.toLowerCase()}</Badge>
                  {!l.showOnPayslip && <Badge tone="neutral">hidden on payslip</Badge>}
                </p>
              </div>
              <ul className="space-y-1 text-sm text-ink">
                {l.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
              <p className="text-right text-base font-semibold tabular-nums">{formatMoney(l.amount)}</p>
            </li>
          ))}
        </ol>
      </Card>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Salary structure used">
          {d.salaryVersion ? (
            <KeyValue
              columns={1}
              items={[
                { label: 'Version', value: `v${d.salaryVersion.versionNo}, ${d.salaryVersion.effectiveFrom} → ${d.salaryVersion.effectiveTo ?? 'open'}` },
                { label: 'Generated from', value: d.salaryVersion.monthlyGross ? `monthly gross ${formatMoney(d.salaryVersion.monthlyGross)} by the template` : 'values entered by hand' },
                { label: 'Reason', value: d.salaryVersion.changeReason ?? '—' },
                { label: 'Created', value: `${formatDateTime(d.salaryVersion.createdAt)} by ${d.salaryVersion.createdBy ?? 'unknown'}` },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">No salary structure.</p>
          )}
          <Link href={`/employees/${d.employee.id}`} className="mt-3 inline-block text-sm text-cobalt hover:underline">
            Open employee →
          </Link>
        </Card>
        <Card title="Monthly inputs">
          {d.inputs.length ? (
            <ul className="space-y-2 text-sm">
              {d.inputs.map((i) => (
                <li key={i.inputKey}>
                  <span className="font-medium">{i.inputKey}</span> = {i.value}
                  <span className="block text-xs text-muted">
                    {i.updatedBy ?? 'Filled automatically'} · {formatDateTime(i.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No monthly inputs for this employee.</p>
          )}
        </Card>
        <Card title="Audit trail">
          <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
            {[...d.runEvents.map((e) => ({ at: e.occurredAt, what: `Run ${e.action.toLowerCase().replace(/_/g, ' ')}${e.reason ? ` — ${e.reason}` : ''}`, who: e.actorName })), ...d.auditTrail.map((a) => ({ at: a.occurredAt, what: a.action, who: a.actor }))]
              .sort((a, b) => b.at.localeCompare(a.at))
              .map((x, i) => (
                <li key={i}>
                  {x.what}
                  <span className="block text-xs text-muted">
                    {formatDateTime(x.at)} · {x.who ?? 'system'}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
