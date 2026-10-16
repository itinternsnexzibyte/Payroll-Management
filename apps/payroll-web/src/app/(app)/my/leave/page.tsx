'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { Alert, Badge, Button, Card, DataTable, EmptyState, PageHeader, RequirePermission, Select, Spinner, errorMessage, formatDate, get, post, useToast } from '@nexzi/ui';
import { LEAVE_STATUS, RequestDialog, type Balance, type LeaveRequest } from '@/components/leave';

export default function MyLeavePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [asking, setAsking] = useState(false);
  const q = useQuery({ queryKey: ['me-leave', year], queryFn: () => get<{ year: number; balances: Balance[]; requests: LeaveRequest[] }>(`/me/leave?year=${year}`), retry: false });
  const cancel = useMutation({
    mutationFn: (id: string) => post(`/me/leave/${id}/cancel`),
    onSuccess: () => {
      toast.success('Request cancelled.');
      qc.invalidateQueries({ queryKey: ['me-leave'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <RequirePermission permission="self.service">
      <PageHeader
        title="My leave"
        description="Your leave balances and requests. Requests are approved by the payroll team; you will get an email when yours is decided."
        breadcrumbs={[{ label: 'My payslips', href: '/my' }, { label: 'My leave' }]}
        actions={<Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setAsking(true)} disabled={!!q.error}>Request leave</Button>}
      />
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <Alert tone="warning">{errorMessage(q.error)}</Alert>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-end">
            <Select aria-label="Year" className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[year - 1, year, year + 1].map((y) => (<option key={y} value={y}>{y}</option>))}
            </Select>
          </div>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {q.data!.balances.map((b) => (
              <div key={b.leaveType.id} className="fx-card rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{b.leaveType.name}</p>
                <p className="mt-1 text-2xl font-semibold text-primary">{b.remaining ?? b.approved}<span className="ml-1 text-sm font-normal text-muted">{b.remaining !== null ? 'days left' : 'days taken'}</span></p>
                <p className="text-xs text-muted">{b.approved} approved · {b.pending} pending{b.allowance ? ` · ${b.allowance} per year` : ''}</p>
              </div>
            ))}
          </div>
          <Card title="My requests" padded={false}>
            <DataTable<LeaveRequest>
              rows={q.data!.requests}
              rowKey={(r) => r.id}
              empty={<EmptyState title="No requests yet" />}
              columns={[
                { key: 't', header: 'Type', render: (r) => r.leaveType.name },
                { key: 'd', header: 'Dates', render: (r) => (r.startDate === r.endDate ? formatDate(r.startDate) : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`) },
                { key: 'n', header: 'Days', align: 'right', render: (r) => r.days },
                { key: 's', header: 'Status', render: (r) => (<span title={r.decisionNote ?? undefined}><Badge tone={LEAVE_STATUS[r.status].tone}>{LEAVE_STATUS[r.status].label}</Badge>{r.decisionNote && <span className="block text-xs text-muted">{r.decisionNote}</span>}</span>) },
                { key: 'x', header: <span className="sr-only">Cancel</span>, align: 'right', render: (r) => (r.status === 'REQUESTED' ? <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === r.id} onClick={() => cancel.mutate(r.id)}>Cancel</Button> : null) },
              ]}
            />
          </Card>
        </>
      )}
      {asking && <RequestDialog self onClose={() => setAsking(false)} onSaved={() => { setAsking(false); qc.invalidateQueries({ queryKey: ['me-leave'] }); }} />}
    </RequirePermission>
  );
}
