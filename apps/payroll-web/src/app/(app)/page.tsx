'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, ClipboardCheck, FilePen, FileText, Upload, UsersRound, Wallet } from 'lucide-react';
import { Card, EmptyState, ErrorState, PageHeader, Spinner, StatCard, StatusBadge, errorMessage, formatDateTime, formatMoney, get, humanize, useAuth } from '@nexzi/ui';
import { SimpleBarChart } from '@/components/bar-chart';

interface Dashboard {
  activeEmployees: number | null;
  currentPeriod: { label: string; runId: string | null; status: string | null };
  draftRuns: number;
  awaitingReview: number;
  awaitingApproval: number;
  rulesApproved: boolean;
  recentFinalised: { id: string; period: string; finalisedAt: string; employeeCount: number; totalNet: string | null }[];
  netTrend: { label: string; totalNet: string }[] | null;
  recentActivity: { action: string; period: string; runId: string; actorName: string | null; occurredAt: string; reason: string | null }[];
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/dashboard') });
  const d = q.data;

  const quick = [
    { label: 'Employees', href: '/employees', icon: UsersRound, show: can('employees.view') },
    { label: 'Salary components', href: '/salary-components', icon: Wallet, show: can('salary.view') },
    { label: 'Payroll runs', href: '/payroll', icon: CalendarClock, show: can('payroll.view') },
    { label: 'Payslips & reports', href: '/reports', icon: FileText, show: can('reports.view') },
    { label: 'Import employees', href: '/employees/import', icon: Upload, show: can('employees.manage') },
  ].filter((x) => x.show);

  return (
    <>
      <PageHeader title={`Welcome, ${user?.name.split(' ')[0] ?? ''}`} description="Payroll status and pending work, from live data." />
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {d && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {d.activeEmployees !== null && <StatCard label="Active employees" value={d.activeEmployees} icon={<UsersRound className="h-4 w-4" />} href="/employees?status=ACTIVE" />}
            <StatCard
              label={`Payroll · ${d.currentPeriod.label}`}
              value={d.currentPeriod.status ? humanize(d.currentPeriod.status) : 'Not started'}
              hint={d.currentPeriod.runId ? 'Open the current month' : can('payroll.input') ? 'Start this month’s run' : undefined}
              href={d.currentPeriod.runId ? `/payroll/${d.currentPeriod.runId}` : '/payroll'}
              icon={<CalendarClock className="h-4 w-4" />}
            />
            <StatCard label="Draft / calculated runs" value={d.draftRuns} icon={<FilePen className="h-4 w-4" />} href="/payroll?status=DRAFT" />
            <StatCard
              label="Awaiting review / approval"
              value={`${d.awaitingReview} / ${d.awaitingApproval}`}
              hint="Under review / approved, not finalised"
              tone={d.awaitingReview + d.awaitingApproval > 0 ? 'attention' : 'default'}
              icon={<ClipboardCheck className="h-4 w-4" />}
              href="/payroll?status=UNDER_REVIEW"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card title="Net pay — last finalised months" className="xl:col-span-2">
              {d.netTrend === null ? (
                <EmptyState title="Amounts hidden" hint="Your role does not include permission to view payroll amounts." />
              ) : d.netTrend.length === 0 ? (
                <EmptyState title="No finalised payroll yet" hint="Totals appear here once a month is finalised." />
              ) : (
                <SimpleBarChart data={d.netTrend.map((t) => ({ label: t.label, value: Number(t.totalNet) }))} valueLabel="Total net pay" money />
              )}
              {!d.rulesApproved && d.netTrend && d.netTrend.length > 0 && <p className="mt-2 text-xs text-warning">Provisional — calculation rules not yet client-approved.</p>}
            </Card>
            <Card title="Quick actions">
              <ul className="grid gap-2">
                {quick.map((x) => (
                  <li key={x.href}>
                    <Link href={x.href} className="flex items-center gap-3 rounded-md border border-line px-3 py-2.5 text-sm font-medium text-ink hover:border-cobalt/40 hover:bg-mist/30">
                      <x.icon className="h-4 w-4 text-haze" /> {x.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Recently finalised" padded={false}>
              {d.recentFinalised.length === 0 ? (
                <EmptyState title="No finalised payroll runs" />
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentFinalised.map((r) => (
                    <li key={r.id}>
                      <Link href={`/payroll/${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-mist/25">
                        <span>
                          <span className="block text-sm font-medium text-ink">{r.period}</span>
                          <span className="block text-xs text-muted">
                            {r.employeeCount} employees · finalised {formatDateTime(r.finalisedAt)}
                          </span>
                        </span>
                        <span className="text-right text-sm tabular-nums text-ink">{r.totalNet !== null ? formatMoney(r.totalNet) : <CheckCircle2 className="h-4 w-4 text-success" />}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Recent payroll activity" padded={false}>
              {d.recentActivity.length === 0 ? (
                <EmptyState title="No activity yet" />
              ) : (
                <ul className="divide-y divide-line">
                  {d.recentActivity.map((a, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 px-5 py-3">
                      <span className="min-w-0">
                        <Link href={`/payroll/${a.runId}`} className="text-sm font-medium text-ink hover:text-cobalt">
                          {a.period}
                        </Link>
                        <span className="ml-2">
                          <StatusBadge status={a.action === 'FINALISED' ? 'FINALISED' : a.action === 'REOPENED' ? 'WARNING' : 'PENDING'} label={humanize(a.action)} />
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted">
                          {a.actorName ?? 'System'}
                          {a.reason ? ` — ${a.reason}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{formatDateTime(a.occurredAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
