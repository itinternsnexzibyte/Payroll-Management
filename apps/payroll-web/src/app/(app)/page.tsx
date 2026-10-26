'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardCheck, FilePen, FileText, Sparkles, Upload, UsersRound, Wallet } from 'lucide-react';
import { Card, EmptyState, ErrorState, Spinner, StatCard, StatusBadge, errorMessage, formatDateTime, formatMoney, get, humanize, useAuth } from '@nexzi/ui';
import { SimpleBarChart } from '@/components/bar-chart';
import { OVERALL, ScoreRing, type Readiness } from '@/components/readiness-score';

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
  const router = useRouter();
  // Employee self-service accounts have their own home page.
  const selfOnly = !can('payroll.view') && can('self.service');
  useEffect(() => {
    if (selfOnly) router.replace('/my');
  }, [selfOnly, router]);
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/dashboard'), enabled: !selfOnly });
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
      <WelcomeHero name={user?.name.split(' ')[0] ?? ''} period={d?.currentPeriod.label} status={d?.currentPeriod.status ?? null} pending={d ? d.awaitingReview + d.awaitingApproval : 0} />
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
          {can('payroll.view') && <ReadinessCard />}

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
                    <Link href={x.href} className="group flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-ink transition-all duration-300 hover:-translate-y-0.5 hover:border-secondary/50 hover:bg-mist/30 hover:shadow-[0_8px_20px_-14px_rgb(30_64_175/0.5)]">
                      <span className="rounded-md bg-mist/70 p-1.5 text-cobalt transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                        <x.icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1">{x.label}</span>
                      <ArrowRight className="h-4 w-4 -translate-x-1 text-haze opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
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

/** Live readiness of the month that needs payroll next (refreshes every minute). */
function ReadinessCard() {
  const q = useQuery({ queryKey: ['readiness', null], queryFn: () => get<Readiness>('/readiness'), refetchInterval: 60_000 });
  if (!q.data) return null;
  const d = q.data;
  const o = OVERALL[d.overall];
  const top = d.checks.filter((c) => c.status === 'FAIL' || c.status === 'WARN').slice(0, 4);
  return (
    <Card title={`Payroll readiness · ${d.period}`} actions={<Link href="/readiness" className="text-sm text-cobalt hover:underline">Open monitor →</Link>}>
      <div className="flex flex-wrap items-center gap-6">
        <ScoreRing score={d.score} colour={o.ring} size={80} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">
            {o.label} · {d.counts.fail} blocking, {d.counts.warn} warning(s)
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-muted">
            {top.length ? top.map((c) => <li key={c.id}>• {c.title}: {c.detail}</li>) : <li>Everything needed for payroll is in place.</li>}
          </ul>
        </div>
      </div>
    </Card>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Brand-coloured welcome banner with the month's status at a glance. */
function WelcomeHero({ name, period, status, pending }: { name: string; period?: string; status: string | null; pending: number }) {
  return (
    <section className="fx-enter relative mb-6 overflow-hidden rounded-[var(--radius-card)] bg-gradient-to-br from-navy via-primary to-cobalt px-6 py-6 text-white shadow-[0_24px_48px_-28px_rgb(13_27_69/0.8)] sm:px-8">
      <div className="fx-blob fx-blob--b pointer-events-none !absolute !-right-24 !-top-40 !h-80 !w-80 !opacity-40" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(500px_200px_at_85%_120%,rgb(12_184_132/0.35),transparent)]" aria-hidden />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting()}, {name}
          </h1>
          <p className="mt-1 text-sm text-haze">Payroll status and pending work, from live data.</p>
        </div>
        {period && (
          <div className="flex flex-wrap gap-2">
            <span className="fx-glass rounded-full px-3 py-1.5 text-xs">
              {period}: <strong className="font-semibold">{status ? humanize(status) : 'not started'}</strong>
            </span>
            <span className={`fx-glass rounded-full px-3 py-1.5 text-xs ${pending ? 'text-accent' : ''}`}>
              {pending ? `${pending} awaiting review or approval` : 'Nothing awaiting approval'}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
