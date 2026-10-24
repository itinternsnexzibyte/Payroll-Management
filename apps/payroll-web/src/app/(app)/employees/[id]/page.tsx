'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Plus, UserMinus, UserCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  KeyValue,
  PageHeader,
  RequirePermission,
  Select,
  Spinner,
  StatusBadge,
  Tabs,
  Textarea,
  errorMessage,
  formatDate,
  formatDateTime,
  formatMoney,
  get,
  post,
  useAuth,
  useToast,
} from '@nexzi/ui';
import { EmployeeForm } from '@/components/employee-form';
import { EmployeeDocumentsTab, EmployeeProfilePhoto, EmployeeRatingsTab, EmployeeWorkforceProfileTab } from '@/components/employee-workforce-details';
import { SalaryVersionDialog } from '@/components/salary-version-dialog';
import type { Employee, SalaryVersion } from '@/lib/types';

type Tab = 'details' | 'workforce' | 'evaluations' | 'documents' | 'salary' | 'payroll';

export default function EmployeePage() {
  return (
    <RequirePermission permission="employees.view">
      <EmployeeProfile />
    </RequirePermission>
  );
}

function EmployeeProfile() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>((sp.get('tab') as Tab) ?? 'details');
  const [deactivating, setDeactivating] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => get<Employee>(`/employees/${id}`) });
  const e = q.data;

  if (q.isLoading) return <Spinner />;
  if (q.error || !e) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;

  return (
    <>
      <PageHeader
        title={e.fullName}
        badge={<StatusBadge status={e.status} />}
        description={`${e.employeeCode} · ${e.department?.name ?? 'No department'} · ${e.designation?.name ?? 'No designation'}`}
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Employees', href: '/employees' }, { label: e.employeeCode }]}
        actions={
          can('employees.manage') &&
          (e.status === 'ACTIVE' ? (
            <Button variant="secondary" icon={<UserMinus className="h-4 w-4" />} onClick={() => setDeactivating(true)}>
              Deactivate / exit
            </Button>
          ) : (
            <Button variant="secondary" icon={<UserCheck className="h-4 w-4" />} onClick={() => setReactivating(true)}>
              Reactivate
            </Button>
          ))
        }
      />
      <EmployeeProfilePhoto employeeId={e.id} employeeName={e.fullName} />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => {
          setTab(t);
          router.replace(`/employees/${id}?tab=${t}`, { scroll: false });
        }}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'workforce', label: 'Workforce profile' },
          { id: 'evaluations', label: 'Evaluations' },
          { id: 'documents', label: 'Documents' },
          { id: 'salary', label: 'Salary', hidden: !can('salary.view') },
          { id: 'payroll', label: 'Payroll history', hidden: !can('payroll.view') },
        ]}
      />
      {tab === 'details' && (
        <Card className="max-w-3xl">
          {can('employees.manage') ? (
            <EmployeeForm employee={e} onSaved={() => q.refetch()} />
          ) : (
            <KeyValue
              items={[
                { label: 'Employee ID', value: e.employeeCode },
                { label: 'Name', value: e.fullName },
                { label: 'Department', value: e.department?.name },
                { label: 'Designation', value: e.designation?.name },
                { label: 'Joining date', value: formatDate(e.joiningDate) },
                { label: 'Exit date', value: formatDate(e.exitDate) },
              ]}
            />
          )}
        </Card>
      )}
      {tab === 'workforce' && <EmployeeWorkforceProfileTab employeeId={e.id} canManage={can('employees.manage')} />}
      {tab === 'evaluations' && <EmployeeRatingsTab employeeId={e.id} canManage={can('workforce.manage')} />}
      {tab === 'documents' && <EmployeeDocumentsTab employeeId={e.id} canManage={can('employees.manage')} />}
      {tab === 'salary' && <SalaryTab employeeId={e.id} />}
      {tab === 'payroll' && <PayrollHistoryTab employeeId={e.id} />}
      <DeactivateDialog open={deactivating} onClose={() => setDeactivating(false)} employee={e} onDone={() => q.refetch()} />
      <ReactivateDialog open={reactivating} onClose={() => setReactivating(false)} employee={e} onDone={() => q.refetch()} />
    </>
  );
}

function SalaryTab({ employeeId }: { employeeId: string }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const cur = useQuery({ queryKey: ['salary', employeeId, 'current'], queryFn: () => get<{ current: SalaryVersion | null; upcoming: SalaryVersion[] }>(`/employees/${employeeId}/salary`) });
  const hist = useQuery({ queryKey: ['salary', employeeId, 'history'], queryFn: () => get<SalaryVersion[]>(`/employees/${employeeId}/salary-history`) });
  const latest = hist.data?.[0] ?? null;
  return (
    <div className="space-y-6">
      <Card
        title={cur.data?.current ? `Current structure · version ${cur.data.current.versionNo}` : 'Current structure'}
        actions={
          can('salary.manage') && (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
              New salary version
            </Button>
          )
        }
        padded={false}
      >
        {cur.isLoading ? (
          <Spinner />
        ) : cur.error ? (
          <ErrorState message={errorMessage(cur.error)} onRetry={() => cur.refetch()} />
        ) : !cur.data?.current ? (
          <EmptyState title="No salary structure in effect today" hint={cur.data?.upcoming.length ? 'A future-dated version exists (see history).' : 'Create the first salary version to include this employee in payroll.'} />
        ) : (
          <>
            <p className="px-5 pt-4 text-sm text-muted">
              Effective from {formatDate(cur.data.current.effectiveFrom)}
              {cur.data.current.effectiveTo ? ` to ${formatDate(cur.data.current.effectiveTo)}` : ''} · {cur.data.current.changeReason}
            </p>
            <DataTable
              dense
              rows={cur.data.current.values}
              rowKey={(v) => v.componentId}
              columns={[
                { key: 'name', header: 'Component', render: (v) => <span className="font-medium">{v.name}</span> },
                { key: 'type', header: 'Type', render: (v) => <Badge tone={v.type === 'EARNING' ? 'brand' : 'neutral'}>{v.type === 'EARNING' ? 'Earning' : 'Deduction'}</Badge> },
                { key: 'basis', header: 'Basis', render: (v) => v.basis.toLowerCase() },
                { key: 'value', header: 'Value', align: 'right', render: (v) => (v.basis === 'PERCENTAGE' ? `${v.value}%` : formatMoney(v.value)) },
              ]}
            />
          </>
        )}
      </Card>
      <Card title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-haze" />Salary history</span>} padded={false}>
        {hist.isLoading ? (
          <Spinner />
        ) : !hist.data?.length ? (
          <EmptyState title="No salary versions yet" />
        ) : (
          <ol className="divide-y divide-line">
            {hist.data.map((v) => (
              <li key={v.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">
                    Version {v.versionNo} · {formatDate(v.effectiveFrom)} – {v.effectiveTo ? formatDate(v.effectiveTo) : 'open'}
                  </p>
                  <span className="text-xs text-muted">Recorded {formatDateTime(v.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted">{v.changeReason}</p>
                {v.changes && v.changes.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {v.changes.map((c) => (
                      <li key={c.code} className="rounded border border-line bg-canvas px-2 py-1 text-xs text-ink">
                        {c.name}: {c.from ?? '—'} → <strong>{c.to ?? 'removed'}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      <SalaryVersionDialog open={open} onClose={() => setOpen(false)} employeeId={employeeId} current={latest} />
    </div>
  );
}

function PayrollHistoryTab({ employeeId }: { employeeId: string }) {
  const q = useQuery({
    queryKey: ['employee-payroll', employeeId],
    queryFn: () => get<{ runId: string; period: string; runStatus: string; resultStatus: string; gross: string | null; deductions: string | null; net: string | null }[]>(`/employees/${employeeId}/payroll-history`),
  });
  return (
    <Card padded={false}>
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        error={q.error ? errorMessage(q.error) : null}
        rowKey={(r) => r.runId}
        rowHref={(r) => `/payroll/${r.runId}`}
        empty={<EmptyState title="Not included in any payroll run yet" />}
        columns={[
          { key: 'period', header: 'Month', render: (r) => <Link href={`/payroll/${r.runId}`} className="font-medium text-cobalt hover:underline">{r.period}</Link> },
          { key: 'runStatus', header: 'Payroll status', render: (r) => <StatusBadge status={r.runStatus} /> },
          { key: 'resultStatus', header: 'Result', render: (r) => <StatusBadge status={r.resultStatus} /> },
          { key: 'gross', header: 'Gross', align: 'right', render: (r) => formatMoney(r.gross) },
          { key: 'deductions', header: 'Deductions', align: 'right', render: (r) => formatMoney(r.deductions) },
          { key: 'net', header: 'Net pay', align: 'right', render: (r) => <strong>{formatMoney(r.net)}</strong> },
        ]}
      />
    </Card>
  );
}

function DeactivateDialog({ open, onClose, employee, onDone }: { open: boolean; onClose: () => void; employee: Employee; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'INACTIVE' | 'EXITED'>('EXITED');
  const [exitDate, setExitDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => post(`/employees/${employee.id}/deactivate`, { status, exitDate: exitDate || null, reason }),
    onSuccess: () => {
      toast.success('Employee status updated. Their records and payroll history are kept.');
      qc.invalidateQueries({ queryKey: ['employees'] });
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Deactivate employee"
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={m.isPending} onClick={() => (reason.trim().length < 3 ? setError('Enter a reason.') : status === 'EXITED' && !exitDate ? setError('Enter the exit date.') : m.mutate())}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">The employee will no longer be eligible for new payroll runs after the exit date. Nothing is deleted.</p>
        <Field label="New status" htmlFor="st">
          <Select id="st" value={status} onChange={(e) => setStatus(e.target.value as 'INACTIVE' | 'EXITED')}>
            <option value="EXITED">Exited</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </Field>
        <Field label="Exit date" htmlFor="ex" required={status === 'EXITED'}>
          <Input id="ex" type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="rs" required error={error ?? undefined}>
          <Textarea id="rs" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function ReactivateDialog({ open, onClose, employee, onDone }: { open: boolean; onClose: () => void; employee: Employee; onDone: () => void }) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: (reason: string) => post(`/employees/${employee.id}/reactivate`, { reason }),
    onSuccess: () => {
      toast.success('Employee reactivated.');
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={(r) => m.mutate(r)}
      loading={m.isPending}
      title="Reactivate employee"
      message={`${employee.fullName} will become active again and eligible for payroll.`}
      confirmLabel="Reactivate"
      reason={{ label: 'Reason', minLength: 3 }}
    />
  );
}
