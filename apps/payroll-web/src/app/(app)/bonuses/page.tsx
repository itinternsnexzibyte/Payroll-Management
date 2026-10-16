'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Gift, Plus, X } from 'lucide-react';
import { Alert, Badge, Button, Card, ConfirmDialog, DataTable, Dialog, EmptyState, Field, Input, PageHeader, RequirePermission, Select, Toolbar, errorMessage, formatMoney, get, post, qs, useAuth, useToast } from '@nexzi/ui';
import { useEmployeeOptions } from '@/lib/hooks';
import { MONTHS } from '@/lib/types';

interface Bonus {
  id: string;
  employee: { id: string; code: string; name: string };
  kind: 'BONUS' | 'INCENTIVE';
  period: string;
  amount: string;
  reason: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  proposedByName: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
}
const STATUS = { PROPOSED: { label: 'Waiting for approval', tone: 'warning' }, APPROVED: { label: 'Approved', tone: 'success' }, REJECTED: { label: 'Rejected', tone: 'danger' } } as const;

export default function BonusesPage() {
  return (
    <RequirePermission permission={['bonuses.manage', 'payroll.approve']}>
      <PageHeader
        title="Bonuses & incentives"
        description="Agreed bonus and incentive amounts for each payroll month. Someone other than the proposer approves them; approved amounts fill the mapped payroll inputs. Incentive formulas follow the client's rules and are not calculated here."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Bonuses & incentives' }]}
      />
      <Workspace />
    </RequirePermission>
  );
}

function Workspace() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<Bonus | null>(null);
  const q = useQuery({ queryKey: ['bonuses', year, month], queryFn: () => get<{ items: Bonus[]; approvedTotal: string; canApprove: boolean }>(`/bonuses${qs({ year, month })}`), enabled: can('payroll.view_amounts') });
  const decide = useMutation({
    mutationFn: ({ b, action, note }: { b: Bonus; action: 'approve' | 'reject'; note?: string }) => post(`/bonuses/${b.id}/${action}`, note ? { note } : {}),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'approve' ? 'Approved.' : 'Rejected.');
      setRejecting(null);
      qc.invalidateQueries({ queryKey: ['bonuses'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!can('payroll.view_amounts')) return <Alert tone="warning">Bonuses show amounts, and your role does not include permission to view payroll amounts.</Alert>;

  return (
    <Card
      padded={false}
      title={q.data ? `Approved for ${MONTHS[month - 1]} ${year}: ${formatMoney(q.data.approvedTotal)}` : 'Bonuses & incentives'}
      actions={can('bonuses.manage') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Propose</Button>}
    >
      <Toolbar>
        <Select aria-label="Month" className="sm:w-40" value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((n, i) => (<option key={n} value={i + 1}>{n}</option>))}</Select>
        <Select aria-label="Year" className="sm:w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[year - 1, year, year + 1].map((y) => (<option key={y} value={y}>{y}</option>))}</Select>
      </Toolbar>
      <DataTable<Bonus>
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error ? errorMessage(q.error) : null}
        rowKey={(b) => b.id}
        empty={<EmptyState icon={<Gift className="h-6 w-6" />} title="Nothing for this month" hint="Propose a bonus or incentive; an approver confirms it before it reaches payroll." />}
        columns={[
          { key: 'e', header: 'Employee', render: (b) => (<span><span className="block font-medium text-ink">{b.employee.code}</span><span className="text-xs text-muted">{b.employee.name}</span></span>) },
          { key: 'k', header: 'Type', render: (b) => (b.kind === 'BONUS' ? 'Bonus' : 'Incentive') },
          { key: 'r', header: 'For', render: (b) => b.reason },
          { key: 'a', header: 'Amount', align: 'right', render: (b) => <span className="font-medium">{formatMoney(b.amount)}</span> },
          { key: 's', header: 'Status', render: (b) => (<span title={b.decisionNote ?? undefined}><Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge><span className="block text-xs text-muted">by {b.proposedByName}{b.decidedByName ? ` · ${b.status.toLowerCase()} by ${b.decidedByName}` : ''}</span></span>) },
          {
            key: 'x',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (b) =>
              b.status === 'PROPOSED' && q.data?.canApprove && b.proposedByName !== user?.name ? (
                <span className="inline-flex gap-1">
                  <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} loading={decide.isPending && decide.variables?.b.id === b.id} onClick={() => decide.mutate({ b, action: 'approve' })}>Approve</Button>
                  <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5" />} onClick={() => setRejecting(b)}>Reject</Button>
                </span>
              ) : null,
          },
        ]}
      />
      {creating && <ProposeDialog year={year} month={month} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['bonuses'] }); }} />}
      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={(note) => rejecting && decide.mutate({ b: rejecting, action: 'reject', note })}
        loading={decide.isPending}
        title="Reject"
        message={rejecting ? `${rejecting.employee.name}: ${formatMoney(rejecting.amount)} — ${rejecting.reason}` : ''}
        confirmLabel="Reject"
        tone="danger"
        reason={{ label: 'Reason', minLength: 3 }}
      />
    </Card>
  );
}

function ProposeDialog({ year, month, onClose, onSaved }: { year: number; month: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const employees = useEmployeeOptions();
  const [f, setF] = useState({ employeeId: '', kind: 'BONUS', amount: '', reason: '', year, month });
  const m = useMutation({
    mutationFn: () => post('/bonuses', { ...f, amount: f.amount.trim(), reason: f.reason.trim() }),
    onSuccess: () => {
      toast.success('Proposed. An approver must confirm it.');
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = f.employeeId && /^\d+(\.\d{1,2})?$/.test(f.amount.trim()) && Number(f.amount) > 0 && f.reason.trim().length >= 3;
  return (
    <Dialog open onClose={onClose} title="Propose a bonus or incentive" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!valid} onClick={() => m.mutate()}>Propose</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee" htmlFor="bn-emp" required className="sm:col-span-2">
          <Select id="bn-emp" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            <option value="">Choose…</option>
            {employees.data?.items.map((x) => (<option key={x.id} value={x.id}>{x.employeeCode} · {x.fullName}</option>))}
          </Select>
        </Field>
        <Field label="Type" htmlFor="bn-kind">
          <Select id="bn-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="BONUS">Bonus</option>
            <option value="INCENTIVE">Incentive</option>
          </Select>
        </Field>
        <Field label="Payroll month" htmlFor="bn-month">
          <div className="flex gap-2">
            <Select id="bn-month" value={f.month} onChange={(e) => setF({ ...f, month: Number(e.target.value) })}>{MONTHS.map((n, i) => (<option key={n} value={i + 1}>{n}</option>))}</Select>
            <Select aria-label="Year" value={f.year} onChange={(e) => setF({ ...f, year: Number(e.target.value) })}>{[year - 1, year, year + 1].map((y) => (<option key={y} value={y}>{y}</option>))}</Select>
          </div>
        </Field>
        <Field label="Amount" htmlFor="bn-amt" required>
          <Input id="bn-amt" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="What it is for" htmlFor="bn-reason" required>
          <Input id="bn-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={300} />
        </Field>
      </div>
    </Dialog>
  );
}
