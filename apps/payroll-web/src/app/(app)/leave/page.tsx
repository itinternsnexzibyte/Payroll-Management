'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Check, Plus, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  RequirePermission,
  SearchInput,
  Select,
  Tabs,
  Toolbar,
  errorMessage,
  formatDate,
  get,
  post,
  put,
  qs,
  useAuth,
  useListParams,
  useToast,
  type Page,
} from '@nexzi/ui';
import { LEAVE_STATUS, RequestDialog, useLeaveTypes, type Balance, type LeaveRequest, type LeaveType } from '@/components/leave';

type Tab = 'requests' | 'balances' | 'types';

export default function LeavePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('requests');
  return (
    <RequirePermission permission={['leave.view', 'leave.manage', 'leave.approve']}>
      <PageHeader
        title="Leave"
        description="Leave requests, approvals and yearly balances. Approved unpaid leave can fill the mapped payroll input; how unpaid days affect pay follows the client's approved formula."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Leave' }]}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'requests', label: 'Requests' },
          { id: 'balances', label: 'Balances' },
          { id: 'types', label: 'Leave types', hidden: !can('leave.manage') },
        ]}
      />
      {tab === 'requests' && <Requests />}
      {tab === 'balances' && <Balances />}
      {tab === 'types' && <Types />}
    </RequirePermission>
  );
}

function Requests() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const lp = useListParams({ sortBy: 'startDate', sortDir: 'desc', filters: { status: 'REQUESTED' } });
  const q = useQuery({ queryKey: ['leave-requests', lp.query], queryFn: () => get<Page<LeaveRequest> & { pendingCount: number }>(`/leave/requests${qs(lp.query)}`), placeholderData: (p) => p });
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{ r: LeaveRequest; action: 'reject' | 'cancel' } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['leave-requests'] }).then(() => qc.invalidateQueries({ queryKey: ['leave-balances'] }));
  const act = useMutation({
    mutationFn: ({ r, action, note }: { r: LeaveRequest; action: 'approve' | 'reject' | 'cancel'; note?: string }) => post(`/leave/requests/${r.id}/${action}`, note ? { note } : {}),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'approve' ? 'Leave approved.' : v.action === 'reject' ? 'Leave rejected.' : 'Request cancelled.');
      setDeciding(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card padded={false} actions={can('leave.manage') && <Button size="sm" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>New request</Button>} title={q.data ? `${q.data.pendingCount} waiting for approval` : 'Requests'}>
      <Toolbar>
        <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Employee ID or name…" className="sm:w-64" />
        <Select aria-label="Status" className="sm:w-48" value={lp.filters.status} onChange={(e) => lp.setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          <option value="REQUESTED">Waiting for approval</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </Toolbar>
      <DataTable<LeaveRequest>
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error ? errorMessage(q.error) : null}
        rowKey={(r) => r.id}
        empty={<EmptyState title="No leave requests" hint="Requests appear here when they are recorded by the payroll team or submitted by employees." />}
        columns={[
          { key: 'e', header: 'Employee', render: (r) => (<span><span className="block font-medium text-ink">{r.employee.code}</span><span className="text-xs text-muted">{r.employee.name}</span></span>) },
          { key: 't', header: 'Type', render: (r) => (<span>{r.leaveType.name} {!r.leaveType.paid && <Badge tone="warning">Unpaid</Badge>}</span>) },
          { key: 'd', header: 'Dates', render: (r) => (r.startDate === r.endDate ? formatDate(r.startDate) : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`) },
          { key: 'n', header: 'Days', align: 'right', render: (r) => r.days },
          { key: 's', header: 'Status', render: (r) => (<span title={r.decisionNote ?? undefined}><Badge tone={LEAVE_STATUS[r.status].tone}>{LEAVE_STATUS[r.status].label}</Badge></span>) },
          { key: 'by', header: 'Entered by', render: (r) => <span className="text-xs text-muted">{r.requestedByName}{r.decidedByName && r.status !== 'REQUESTED' ? ` · ${r.status.toLowerCase()} by ${r.decidedByName}` : ''}</span> },
          {
            key: 'a',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (r) => (
              <span className="inline-flex gap-1">
                {r.status === 'REQUESTED' && can('leave.approve') && r.requestedByName !== user?.name && (
                  <>
                    <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} loading={act.isPending && act.variables?.r.id === r.id} onClick={() => act.mutate({ r, action: 'approve' })}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5" />} onClick={() => setDeciding({ r, action: 'reject' })}>
                      Reject
                    </Button>
                  </>
                )}
                {(r.status === 'REQUESTED' ? can('leave.manage') || can('leave.approve') : r.status === 'APPROVED' && can('leave.approve')) && (
                  <Button size="sm" variant="ghost" onClick={() => setDeciding({ r, action: 'cancel' })}>
                    Cancel
                  </Button>
                )}
              </span>
            ),
          },
        ]}
      />
      {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={lp.setPage} onPageSize={lp.setPageSize} />}
      {creating && <RequestDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />}
      <ConfirmDialog
        open={!!deciding}
        onClose={() => setDeciding(null)}
        onConfirm={(note) => deciding && act.mutate({ r: deciding.r, action: deciding.action, note })}
        loading={act.isPending}
        title={deciding?.action === 'reject' ? 'Reject leave request' : 'Cancel leave request'}
        message={deciding ? `${deciding.r.employee.name}: ${deciding.r.leaveType.name}, ${deciding.r.days} day(s) from ${formatDate(deciding.r.startDate)}.` : ''}
        confirmLabel={deciding?.action === 'reject' ? 'Reject' : 'Cancel request'}
        tone="danger"
        reason={deciding?.action === 'reject' ? { label: 'Reason', minLength: 3 } : undefined}
      />
    </Card>
  );
}

function Balances() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [search, setSearch] = useState('');
  const types = useLeaveTypes();
  const q = useQuery({ queryKey: ['leave-balances', year, search], queryFn: () => get<{ employee: { id: string; code: string; name: string }; balances: Balance[] }[]>(`/leave/balances${qs({ year, search })}`), placeholderData: (p) => p });
  const active = (types.data ?? []).filter((t) => t.active);
  return (
    <Card padded={false}>
      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Employee ID or name…" className="sm:w-64" />
        <Select aria-label="Year" className="sm:w-32" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[year - 1, year, year + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </Toolbar>
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        rowKey={(r) => r.employee.id}
        empty={<EmptyState title={active.length ? 'No employees found' : 'No leave types yet'} hint={active.length ? undefined : 'A leave manager adds leave types first (Leave types tab).'} />}
        columns={[
          { key: 'e', header: 'Employee', render: (r) => (<span><span className="block font-medium text-ink">{r.employee.code}</span><span className="text-xs text-muted">{r.employee.name}</span></span>) },
          ...active.map((t) => ({
            key: t.id,
            header: t.name,
            align: 'right' as const,
            render: (r: { balances: Balance[] }) => {
              const b = r.balances.find((x) => x.leaveType.id === t.id);
              if (!b) return '—';
              return (
                <span title={`Approved ${b.approved} · pending ${b.pending}${b.allowance ? ` · allowance ${b.allowance}` : ''}`}>
                  {b.remaining !== null ? <span className={Number(b.remaining) < 0 ? 'text-danger' : 'text-ink'}>{b.remaining} left</span> : <span className="text-ink">{b.approved} taken</span>}
                  {Number(b.pending) > 0 && <span className="block text-xs text-muted">{b.pending} pending</span>}
                </span>
              );
            },
          })),
        ]}
      />
    </Card>
  );
}

function Types() {
  const qc = useQueryClient();
  const toast = useToast();
  const types = useLeaveTypes();
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  return (
    <Card padded={false} actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add leave type</Button>}>
      <p className="border-b border-line px-5 py-3 text-sm text-muted">Use the client&apos;s own leave types and allowances. Mark leave without pay as <strong>unpaid</strong> so it can fill the unpaid-leave payroll input.</p>
      <DataTable<LeaveType>
        rows={types.data}
        loading={types.isLoading}
        rowKey={(t) => t.id}
        empty={<EmptyState title="No leave types yet" hint="Add the leave types the client uses, e.g. casual leave and leave without pay." />}
        columns={[
          { key: 'n', header: 'Leave type', render: (t) => (<span><span className="block font-medium text-ink">{t.name}</span><span className="text-xs text-muted">{t.code}</span></span>) },
          { key: 'p', header: 'Pay', render: (t) => (t.paid ? <Badge tone="success">Paid</Badge> : <Badge tone="warning">Unpaid</Badge>) },
          { key: 'a', header: 'Days per year', align: 'right', render: (t) => t.annualDays ?? 'No limit' },
          { key: 's', header: 'Status', render: (t) => (t.active ? 'Active' : 'Inactive') },
          { key: 'x', header: <span className="sr-only">Edit</span>, align: 'right', render: (t) => <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button> },
        ]}
      />
      {editing && <TypeDialog type={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['leave-types'] }); toast.success('Leave type saved.'); }} />}
    </Card>
  );
}

function TypeDialog({ type, onClose, onSaved }: { type: LeaveType | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ code: type?.code ?? '', name: type?.name ?? '', paid: type?.paid ?? true, annualDays: type?.annualDays ?? '', active: type?.active ?? true, sortOrder: String(type?.sortOrder ?? 0) });
  const m = useMutation({
    mutationFn: () => {
      const body = { name: f.name.trim(), paid: f.paid, annualDays: f.annualDays.trim() || null, active: f.active, sortOrder: Number(f.sortOrder) || 0 };
      return type ? put(`/leave/types/${type.id}`, body) : post('/leave/types', { ...body, code: f.code.trim().toUpperCase() });
    },
    onSuccess: onSaved,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title={type ? `Edit ${type.name}` : 'Add leave type'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={f.name.trim().length < 2 || (!type && !f.code.trim())} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" htmlFor="lt-code" required hint="Short code, e.g. CL or LWP. Cannot change later.">
          <Input id="lt-code" value={f.code} disabled={!!type} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={20} />
        </Field>
        <Field label="Name" htmlFor="lt-name" required>
          <Input id="lt-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} />
        </Field>
        <Field label="Days per year" htmlFor="lt-days" hint="Leave empty for no limit.">
          <Input id="lt-days" inputMode="decimal" value={f.annualDays} onChange={(e) => setF({ ...f, annualDays: e.target.value })} />
        </Field>
        <Field label="Order" htmlFor="lt-order">
          <Input id="lt-order" inputMode="numeric" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="Paid leave (untick for leave without pay)" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} />
          <Checkbox label="Active" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        </div>
      </div>
    </Dialog>
  );
}

