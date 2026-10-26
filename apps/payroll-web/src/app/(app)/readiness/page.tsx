'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { OVERALL, ScoreRing, type Readiness, type ReadinessStatus } from '@/components/readiness-score';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ChevronRight, Info, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, RequirePermission, Select, Spinner, StatCard, errorMessage, formatDateTime, get } from '@nexzi/ui';
import { MONTHS } from '@/lib/types';

type Status = ReadinessStatus;

const ICON: Record<Status, ReactNode> = {
  PASS: <CheckCircle2 className="h-5 w-5 text-success" aria-label="Passed" />,
  WARN: <TriangleAlert className="h-5 w-5 text-warning" aria-label="Warning" />,
  FAIL: <XCircle className="h-5 w-5 text-danger" aria-label="Failed" />,
  INFO: <Info className="h-5 w-5 text-secondary" aria-label="Information" />,
};
export default function ReadinessPage() {
  return (
    <RequirePermission permission="payroll.view">
      <PageHeader
        title="Payroll readiness monitor"
        description="Continuously checks attendance, employee details, salary structures, bank information, statutory settings and approvals during the pay period. Refreshes every minute."
        breadcrumbs={[{ label: 'Payroll runs', href: '/payroll' }, { label: 'Readiness monitor' }]}
      />
      <Monitor />
    </RequirePermission>
  );
}

function Monitor() {
  const [period, setPeriod] = useState<{ year: number; month: number } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = useQuery({
    queryKey: ['readiness', period],
    queryFn: () => get<Readiness>(`/readiness${period ? `?year=${period.year}&month=${period.month}` : ''}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const o = OVERALL[d.overall];
  const areas = [...new Set(d.checks.map((c) => c.area))];
  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-6">
          <ScoreRing score={d.score} colour={o.ring} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-lg font-semibold text-ink">
              {d.period} <Badge tone={o.tone}>{o.label}</Badge>
            </p>
            <p className="text-sm text-muted">
              {d.employees} employee(s) to pay · {d.daysToMonthEnd >= 0 ? `${d.daysToMonthEnd} day(s) to month end` : `month ended ${-d.daysToMonthEnd} day(s) ago`} · last checked {formatDateTime(d.checkedAt)}
            </p>
          </div>
          <div className="flex items-end gap-2">
            <Field label="Month" htmlFor="rd-m">
              <Select id="rd-m" value={d.month} onChange={(e) => setPeriod({ year: d.year, month: Number(e.target.value) })}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Year" htmlFor="rd-y">
              <Input id="rd-y" type="number" className="w-24" value={d.year} onChange={(e) => setPeriod({ year: Number(e.target.value), month: d.month })} />
            </Field>
            <Button variant="secondary" icon={<RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />} onClick={() => q.refetch()}>
              Check now
            </Button>
          </div>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Blocking" value={d.counts.fail} tone={d.counts.fail ? 'attention' : 'default'} hint="Must be fixed before payroll" />
        <StatCard label="Warnings" value={d.counts.warn} hint="Review before the deadline" />
        <StatCard label="Passed" value={d.counts.pass} />
        <StatCard label="For information" value={d.counts.info} />
      </div>
      {areas.map((area) => (
        <Card key={area} title={area} padded={false}>
          <ul className="divide-y divide-line">
            {d.checks
              .filter((c) => c.area === area)
              .map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    {ICON[c.status]}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{c.title}</p>
                      <p className="text-sm text-muted">{c.detail}</p>
                      {c.items.length > 0 && (
                        <button className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-cobalt hover:underline" onClick={() => toggle(c.id)} aria-expanded={open.has(c.id)}>
                          {open.has(c.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {c.count} item(s)
                        </button>
                      )}
                      {open.has(c.id) && (
                        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                          {c.items.map((i, k) => (
                            <li key={k}>{i.href ? <Link className="text-cobalt hover:underline" href={i.href}>{i.label}</Link> : i.label}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {c.href && (
                      <Link href={c.href} className="shrink-0 text-sm text-cobalt hover:underline">
                        Fix →
                      </Link>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
