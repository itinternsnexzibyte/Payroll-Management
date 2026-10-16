'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { Alert, Card, EmptyState, ErrorState, PageHeader, Pagination, RequirePermission, SearchInput, Select, Spinner, StatCard, Toolbar, errorMessage, get, qs, useAuth, useListParams, type Page } from '@nexzi/ui';
import { AlertHistoryDialog, AlertList, ReviewDialog } from '@/components/anomalies';
import type { Anomaly, AnomalyCounts } from '@/lib/types';

const RULES = [
  ['NET_CHANGE', 'Net pay changed sharply'],
  ['COMPONENT_CHANGE', 'Salary component changed'],
  ['COMPONENT_NEW', 'New salary component'],
  ['COMPONENT_REMOVED', 'Salary component missing'],
  ['ADJUSTMENT_OUTLIER', 'Unusual monthly amount'],
  ['ADJUSTMENT_FIRST_TIME', 'First monthly amount in a while'],
  ['REPEATED_ADJUSTMENT', 'Same monthly amount as last month'],
  ['DUPLICATE_EMPLOYEE', 'Possible duplicate employee'],
];

export default function AlertsPage() {
  return (
    <RequirePermission permission="payroll.view">
      <PageHeader
        title="Payroll alerts"
        description="Rule-based checks that compare each payroll with earlier finalised months and explain what looks unusual. Alerts never change payroll; reviewing them records who checked what."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Payroll alerts' }]}
      />
      <AlertsWorkspace />
    </RequirePermission>
  );
}

function AlertsWorkspace() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const lp = useListParams({ sortBy: 'detectedAt', sortDir: 'desc', filters: { status: 'OPEN', severity: '', rule: '' } });
  const [reviewing, setReviewing] = useState<Anomaly | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const allowed = can('payroll.view_amounts');
  const q = useQuery({ queryKey: ['alerts', lp.query], queryFn: () => get<Page<Anomaly> & { counts: AnomalyCounts }>(`/anomalies${qs(lp.query)}`), enabled: allowed });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['alerts'] });
    qc.invalidateQueries({ queryKey: ['run-alerts'] });
  };

  if (!allowed) return <Alert tone="warning">Payroll alerts quote salary amounts, and your role does not include permission to view payroll amounts.</Alert>;
  const counts = q.data?.counts;
  const canReview = can('payroll.calculate') || can('payroll.approve');

  return (
    <>
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Need review" value={counts?.open ?? '—'} tone={counts?.open ? 'attention' : 'default'} icon={<ShieldAlert className="h-4 w-4" />} />
        <StatCard label="High severity open" value={counts?.openHigh ?? '—'} tone={counts?.openHigh ? 'attention' : 'default'} />
        <StatCard label="Reviewed" value={counts?.reviewed ?? '—'} />
        <StatCard label="Cleared by recalculation" value={counts?.cleared ?? '—'} />
      </div>
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Employee ID, name or text…" className="sm:w-72" />
          <Select aria-label="Status" className="sm:w-44" value={lp.filters.status} onChange={(e) => lp.setFilter('status', e.target.value)}>
            <option value="OPEN">Needs review</option>
            <option value="REVIEWED">Reviewed</option>
            <option value="CLEARED">Cleared</option>
            <option value="ACTIVE">Open and reviewed</option>
            <option value="ALL">All</option>
          </Select>
          <Select aria-label="Severity" className="sm:w-36" value={lp.filters.severity} onChange={(e) => lp.setFilter('severity', e.target.value)}>
            <option value="">Any severity</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </Select>
          <Select aria-label="Rule" className="sm:w-64" value={lp.filters.rule} onChange={(e) => lp.setFilter('rule', e.target.value)}>
            <option value="">Any rule</option>
            {RULES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Toolbar>
        {q.isLoading ? (
          <Spinner />
        ) : q.error || !q.data ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : q.data.items.length ? (
          <>
            <AlertList items={q.data.items} canReview={canReview} onReview={setReviewing} onHistory={(a) => setHistory(a.id)} showPeriod />
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={lp.setPage} onPageSize={lp.setPageSize} />
          </>
        ) : (
          <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No alerts match" hint="Alerts appear after a payroll is calculated. Try another status or filter." />
        )}
      </Card>
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
    </>
  );
}
