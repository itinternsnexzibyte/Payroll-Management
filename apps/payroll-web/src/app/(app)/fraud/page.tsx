'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Fingerprint, History, ShieldCheck } from 'lucide-react';
import { Alert, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, RequirePermission, Select, Spinner, StatCard, Toolbar, errorMessage, formatDate, formatDateTime, get, humanize, type Page } from '@nexzi/ui';
import type { RunSummary } from '@/lib/types';

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
interface Finding {
  id: string;
  rule: string;
  severity: Severity;
  title: string;
  description: string;
  employees: { id: string; employeeCode: string; fullName: string }[];
  evidence: { label: string; value: string }[];
}
interface Scan {
  run: { id: string; period: string; status: string };
  windowDays: number;
  jumpPercent: number;
  bankComparison: 'FULL' | 'MASKED';
  summary: { high: number; medium: number; low: number; employeesChecked: number };
  rules: Record<string, string>;
  findings: Finding[];
}
interface Timeline {
  employee: { id: string; employeeCode: string; fullName: string; status: string; joiningDate: string; exitDate: string | null; bank: { last4: string; ifsc: string; holder: string; updatedAt: string } | null };
  events: { at: string; kind: 'AUDIT' | 'SALARY' | 'PAYROLL'; title: string; detail: string }[];
}

const TONE: Record<Severity, 'danger' | 'warning' | 'neutral'> = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' };

export default function FraudPage() {
  return (
    <RequirePermission permission="payroll.view_amounts">
      <PageHeader
        title="Payroll fraud investigation"
        description="Connects employee records, bank accounts, salary revisions, approvals and payment history to surface suspicious patterns before salary is paid — with the evidence behind each one."
        breadcrumbs={[{ label: 'Payroll alerts', href: '/alerts' }, { label: 'Fraud investigation' }]}
      />
      <Investigation />
    </RequirePermission>
  );
}

function Investigation() {
  const runs = useQuery({ queryKey: ['runs-for-fraud'], queryFn: () => get<Page<RunSummary>>('/payroll-runs?pageSize=60&sortBy=period&sortDir=desc') });
  const [runId, setRunId] = useState('');
  const [windowDays, setWindowDays] = useState('10');
  const [jump, setJump] = useState('25');
  const [severity, setSeverity] = useState<'' | Severity>('');
  const [person, setPerson] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['fraud', runId, windowDays, jump],
    queryFn: () => get<Scan>(`/fraud/scan?${new URLSearchParams({ ...(runId ? { runId } : {}), windowDays: String(Number(windowDays) || 10), jumpPercent: String(Number(jump) || 25) })}`),
  });
  const findings = (q.data?.findings ?? []).filter((f) => !severity || f.severity === severity);
  return (
    <div className="space-y-6">
      <Card padded={false}>
        <Toolbar>
          <Field label="Payroll month" htmlFor="fr-run" className="w-60">
            <Select id="fr-run" value={runId} onChange={(e) => setRunId(e.target.value)}>
              <option value="">Latest calculated month</option>
              {runs.data?.items.filter((r) => r.status !== 'DRAFT').map((r) => (
                <option key={r.id} value={r.id}>
                  {r.period} · {humanize(r.status)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Look-back window (days)" htmlFor="fr-w" className="w-44">
            <Input id="fr-w" inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} />
          </Field>
          <Field label="Salary jump to flag (%)" htmlFor="fr-j" className="w-44">
            <Input id="fr-j" inputMode="decimal" value={jump} onChange={(e) => setJump(e.target.value)} />
          </Field>
          <Field label="Severity" htmlFor="fr-s" className="w-36">
            <Select id="fr-s" value={severity} onChange={(e) => setSeverity(e.target.value as '' | Severity)}>
              <option value="">All</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </Select>
          </Field>
        </Toolbar>
      </Card>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : (
        q.data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label={`Employees checked · ${q.data.run.period}`} value={q.data.summary.employeesChecked} icon={<Fingerprint className="h-4 w-4" />} />
              <StatCard label="High severity" value={q.data.summary.high} tone={q.data.summary.high ? 'attention' : 'default'} />
              <StatCard label="Medium severity" value={q.data.summary.medium} />
              <StatCard label="Low severity" value={q.data.summary.low} />
            </div>
            {q.data.bankComparison === 'MASKED' && <Alert tone="info">The bank encryption key is not configured here, so shared accounts are matched on IFSC, last four digits and holder name only.</Alert>}
            {findings.length === 0 ? (
              <Card>
                <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No suspicious patterns found" hint={`Checked ${Object.keys(q.data.rules).length} rules for ${q.data.run.period}.`} />
              </Card>
            ) : (
              <div className="space-y-3">
                {findings.map((f) => (
                  <Card key={f.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                          <Badge tone={TONE[f.severity]}>{f.severity.toLowerCase()}</Badge>
                          {f.title}
                        </p>
                        <p className="mt-1 text-xs text-muted">{f.description}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {f.employees.map((e) => (
                          <Button key={e.id} size="sm" variant="secondary" icon={<History className="h-3.5 w-3.5" />} onClick={() => setPerson(e.id)}>
                            {e.employeeCode} · {e.fullName}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      {f.evidence.map((ev, i) => (
                        <div key={i} className="flex gap-2 border-b border-line/60 py-1">
                          <dt className="w-48 shrink-0 text-muted">{ev.label}</dt>
                          <dd className="min-w-0 break-words text-ink">{ev.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </Card>
                ))}
              </div>
            )}
            <Card title="Rules checked">
              <ul className="grid gap-1 text-sm text-muted sm:grid-cols-2">
                {Object.entries(q.data.rules).map(([k, v]) => (
                  <li key={k}>• {v}</li>
                ))}
              </ul>
            </Card>
          </>
        )
      )}
      {person && <TimelineDialog employeeId={person} onClose={() => setPerson(null)} />}
    </div>
  );
}

function TimelineDialog({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['fraud-timeline', employeeId], queryFn: () => get<Timeline>(`/fraud/employees/${employeeId}/timeline`) });
  const d = q.data;
  return (
    <Dialog open onClose={onClose} width="lg" title={d ? `Investigation timeline · ${d.employee.employeeCode} ${d.employee.fullName}` : 'Investigation timeline'}>
      {!d ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p>
              Status <strong>{d.employee.status.toLowerCase()}</strong> · joined {formatDate(d.employee.joiningDate)}
              {d.employee.exitDate && ` · exited ${formatDate(d.employee.exitDate)}`}
            </p>
            <p>{d.employee.bank ? `Bank •••• ${d.employee.bank.last4} (${d.employee.bank.ifsc}), holder ${d.employee.bank.holder}, updated ${formatDateTime(d.employee.bank.updatedAt)}` : 'No bank account on file'}</p>
          </div>
          <ol className="max-h-[55vh] space-y-2 overflow-y-auto border-l-2 border-mist pl-4">
            {d.events.map((e, i) => (
              <li key={i} className="relative">
                <span className={`absolute -left-[22px] top-1.5 h-2.5 w-2.5 rounded-full ${e.kind === 'SALARY' ? 'bg-warning' : e.kind === 'PAYROLL' ? 'bg-accent' : 'bg-secondary'}`} aria-hidden />
                <p className="text-sm font-medium text-ink">{e.title}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(e.at)} {e.detail && `· ${e.detail}`}
                </p>
              </li>
            ))}
          </ol>
          <Link href={`/employees/${d.employee.id}`} className="text-sm text-cobalt hover:underline">
            Open employee record →
          </Link>
        </div>
      )}
    </Dialog>
  );
}
