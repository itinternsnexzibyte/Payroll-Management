'use client';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, HandCoins, Plus } from 'lucide-react';
import { Alert, Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, RequirePermission, SearchInput, Select, Spinner, Toolbar, cn, errorMessage, formatDate, formatMoney, get, post, qs, useAuth, useToast } from '@nexzi/ui';
import { useEmployeeOptions } from '@/lib/hooks';
import { MONTHS } from '@/lib/types';

interface Loan {
  id: string;
  employee: { id: string; code: string; name: string };
  kind: 'LOAN' | 'ADVANCE';
  principal: string;
  instalment: string;
  startPeriod: string;
  status: 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  recovered: string;
  outstanding: string;
  repaid: boolean;
  nextInstalment: string;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
  closedAt: string | null;
  closedReason: string | null;
  recoveries: { period: string; amount: string }[];
}

export default function AdvancesPage() {
  return (
    <RequirePermission permission="loans.manage">
      <PageHeader
        title="Loans & advances"
        description="Record loans and salary advances with a monthly instalment. Instalments fill the mapped payroll input; amounts recovered are read from finalised payroll months."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Loans & advances' }]}
      />
      <Workspace />
    </RequirePermission>
  );
}

function Workspace() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState<{ loan: Loan; outcome: 'CLOSED' | 'CANCELLED' } | null>(null);
  const q = useQuery({ queryKey: ['loans', status, search], queryFn: () => get<{ items: Loan[]; mappedInput: string | null }>(`/loans${qs({ status, search })}`), placeholderData: (p) => p, enabled: can('payroll.view_amounts') });
  const close = useMutation({
    mutationFn: ({ loan, outcome, reason }: { loan: Loan; outcome: string; reason: string }) => post(`/loans/${loan.id}/close`, { outcome, reason }),
    onSuccess: () => {
      toast.success('Saved.');
      setClosing(null);
      qc.invalidateQueries({ queryKey: ['loans'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!can('payroll.view_amounts')) return <Alert tone="warning">Loans and advances show amounts, and your role does not include permission to view payroll amounts.</Alert>;

  return (
    <>
      {q.data && !q.data.mappedInput && (
        <Alert tone="warning" className="mb-4">
          No payroll input column is mapped for advance recovery, so instalments cannot be filled into payroll yet. An administrator can map one in <Link href="/settings" className="font-medium underline">Payroll settings → Inputs from modules</Link>.
        </Alert>
      )}
      <Card padded={false} actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New loan or advance</Button>}>
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Employee ID or name…" className="sm:w-64" />
          <Select aria-label="Status" className="sm:w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="ACTIVE">Active</option>
            <option value="CLOSED">Closed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="ALL">All</option>
          </Select>
        </Toolbar>
        {q.isLoading ? (
          <Spinner />
        ) : q.error || !q.data ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState icon={<HandCoins className="h-6 w-6" />} title="No loans or advances" hint="Record one to recover it automatically through payroll." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface text-left text-xs uppercase tracking-wide text-primary">
                <tr>
                  <th className="w-8 px-3 py-3" />
                  <th className="px-3 py-3">Employee</th>
                  <th className="px-3 py-3">Type</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                  <th className="px-3 py-3 text-right">Instalment</th>
                  <th className="px-3 py-3 text-right">Recovered</th>
                  <th className="px-3 py-3 text-right">Outstanding</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((l) => (
                  <Fragment key={l.id}>
                    <tr className="fx-row border-b border-line/70 hover:bg-mist/40">
                      <td className="px-3 py-3">
                        <button className="rounded p-1 text-muted hover:text-primary" aria-label={open === l.id ? 'Hide recoveries' : 'Show recoveries'} onClick={() => setOpen(open === l.id ? null : l.id)}>
                          {open === l.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-3"><span className="block font-medium text-ink">{l.employee.code}</span><span className="text-xs text-muted">{l.employee.name}</span></td>
                      <td className="px-3 py-3">{l.kind === 'LOAN' ? 'Loan' : 'Salary advance'}<span className="block text-xs text-muted">from {l.startPeriod}</span></td>
                      <td className="px-3 py-3 text-right">{formatMoney(l.principal)}</td>
                      <td className="px-3 py-3 text-right">{formatMoney(l.instalment)}</td>
                      <td className="px-3 py-3 text-right text-accent-ink">{formatMoney(l.recovered)}</td>
                      <td className="px-3 py-3 text-right font-medium">{formatMoney(l.outstanding)}</td>
                      <td className="px-3 py-3">
                        {l.status === 'ACTIVE' ? (l.repaid ? <Badge tone="success">Repaid — close it</Badge> : <Badge tone="brand">Active · next {formatMoney(l.nextInstalment)}</Badge>) : <Badge tone="neutral">{l.status === 'CLOSED' ? 'Closed' : 'Cancelled'}</Badge>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {l.status === 'ACTIVE' && (
                          <span className="inline-flex gap-1">
                            <Button size="sm" variant="secondary" onClick={() => setClosing({ loan: l, outcome: 'CLOSED' })}>Close</Button>
                            <Button size="sm" variant="ghost" onClick={() => setClosing({ loan: l, outcome: 'CANCELLED' })}>Cancel</Button>
                          </span>
                        )}
                      </td>
                    </tr>
                    {open === l.id && (
                      <tr className="border-b border-line/70 bg-surface/60">
                        <td />
                        <td colSpan={8} className="px-3 py-3 text-sm">
                          {l.recoveries.length ? (
                            <ul className="flex flex-wrap gap-2">
                              {l.recoveries.map((r) => (
                                <li key={r.period} className="rounded-full border border-line bg-white px-3 py-1 text-xs">{r.period}: <strong>{formatMoney(r.amount)}</strong></li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-muted">Nothing recovered yet. Recoveries appear when a payroll month that includes the instalment is finalised.</span>
                          )}
                          <p className="mt-2 text-xs text-muted">
                            Recorded by {l.createdByName} on {formatDate(l.createdAt)}
                            {l.note ? ` · ${l.note}` : ''}
                            {l.closedReason ? ` · ${l.status === 'CLOSED' ? 'closed' : 'cancelled'}: ${l.closedReason}` : ''}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <LoanDialog onClose={() => setCreating(false)} onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['loans'] }); }} />}
      <ConfirmDialog
        open={!!closing}
        onClose={() => setClosing(null)}
        onConfirm={(reason) => closing && close.mutate({ loan: closing.loan, outcome: closing.outcome, reason })}
        loading={close.isPending}
        title={closing?.outcome === 'CANCELLED' ? 'Cancel this record' : 'Close this loan'}
        message={closing ? `${closing.loan.employee.name}: outstanding ${formatMoney(closing.loan.outstanding)}. ${closing.outcome === 'CANCELLED' ? 'Use cancel only for a record entered by mistake.' : 'No further instalments will be filled into payroll.'}` : ''}
        confirmLabel={closing?.outcome === 'CANCELLED' ? 'Cancel record' : 'Close loan'}
        tone="danger"
        reason={{ label: 'Reason', minLength: 3 }}
      />
    </>
  );
}

function LoanDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const employees = useEmployeeOptions();
  const now = new Date();
  const [f, setF] = useState({ employeeId: '', kind: 'ADVANCE', principal: '', instalment: '', startYear: now.getFullYear(), startMonth: now.getMonth() + 1, note: '' });
  const m = useMutation({
    mutationFn: () => post('/loans', { ...f, principal: f.principal.trim(), instalment: f.instalment.trim(), note: f.note.trim() || undefined }),
    onSuccess: () => {
      toast.success('Saved.');
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const valid = f.employeeId && /^\d+(\.\d{1,2})?$/.test(f.principal.trim()) && /^\d+(\.\d{1,2})?$/.test(f.instalment.trim()) && Number(f.instalment) > 0 && Number(f.instalment) <= Number(f.principal);
  const months = Number(f.instalment) > 0 ? Math.ceil(Number(f.principal) / Number(f.instalment)) : 0;
  return (
    <Dialog open onClose={onClose} title="New loan or advance" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!valid} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee" htmlFor="ln-emp" required className="sm:col-span-2">
          <Select id="ln-emp" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            <option value="">Choose…</option>
            {employees.data?.items.map((x) => (<option key={x.id} value={x.id}>{x.employeeCode} · {x.fullName}</option>))}
          </Select>
        </Field>
        <Field label="Type" htmlFor="ln-kind">
          <Select id="ln-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="ADVANCE">Salary advance</option>
            <option value="LOAN">Loan</option>
          </Select>
        </Field>
        <Field label="First instalment month" htmlFor="ln-month">
          <div className="flex gap-2">
            <Select id="ln-month" value={f.startMonth} onChange={(e) => setF({ ...f, startMonth: Number(e.target.value) })}>{MONTHS.map((n, i) => (<option key={n} value={i + 1}>{n}</option>))}</Select>
            <Select aria-label="Year" value={f.startYear} onChange={(e) => setF({ ...f, startYear: Number(e.target.value) })}>{[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (<option key={y} value={y}>{y}</option>))}</Select>
          </div>
        </Field>
        <Field label="Amount" htmlFor="ln-amt" required>
          <Input id="ln-amt" inputMode="decimal" value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} />
        </Field>
        <Field label="Monthly instalment" htmlFor="ln-inst" required hint={months ? `About ${months} month(s) to recover.` : undefined}>
          <Input id="ln-inst" inputMode="decimal" value={f.instalment} onChange={(e) => setF({ ...f, instalment: e.target.value })} />
        </Field>
        <Field label="Note" htmlFor="ln-note" className="sm:col-span-2">
          <Input id="ln-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} />
        </Field>
      </div>
      <p className={cn('mt-3 text-xs', valid || !f.instalment ? 'text-muted' : 'text-danger')}>{valid || !f.instalment ? 'One active loan or advance per employee.' : 'The instalment must be more than zero and not more than the amount.'}</p>
    </Dialog>
  );
}
