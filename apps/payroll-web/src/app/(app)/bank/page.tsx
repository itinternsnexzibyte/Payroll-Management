'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Banknote, Download, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  RequirePermission,
  SearchInput,
  Select,
  Spinner,
  Tabs,
  Toolbar,
  del,
  download,
  errorMessage,
  formatDateTime,
  formatMoney,
  get,
  put,
  qs,
  useAuth,
  useToast,
  type Page,
} from '@nexzi/ui';
import type { RunSummary } from '@/lib/types';

interface Bank {
  accountHolder: string;
  accountNumberMasked: string;
  ifsc: string;
  bankName: string | null;
  branch: string | null;
  updatedAt: string;
  enteredByEmployee?: boolean;
}
interface AccountRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  status: string;
  bank: Bank | null;
}
type Field_ = 'EMPLOYEE_CODE' | 'EMPLOYEE_NAME' | 'ACCOUNT_HOLDER' | 'ACCOUNT_NUMBER' | 'IFSC' | 'BANK_NAME' | 'NET_PAY' | 'PAYMENT_DATE' | 'PERIOD' | 'FIXED';
interface Layout {
  format: 'CSV' | 'XLSX';
  includeHeader: boolean;
  dateFormat: 'DD/MM/YYYY' | 'DD-MM-YYYY' | 'YYYY-MM-DD' | 'DDMMYYYY';
  columns: { header: string; field: Field_; value: string | null }[];
}
const FIELD_LABELS: Record<Field_, string> = {
  EMPLOYEE_CODE: 'Employee ID',
  EMPLOYEE_NAME: 'Employee name',
  ACCOUNT_HOLDER: 'Account holder name',
  ACCOUNT_NUMBER: 'Account number',
  IFSC: 'IFSC',
  BANK_NAME: 'Bank name',
  NET_PAY: 'Net pay (amount)',
  PAYMENT_DATE: 'Payment date',
  PERIOD: 'Narration: “Salary <month year>”',
  FIXED: 'Fixed text',
};

export default function BankPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'accounts' | 'file' | 'layout'>(can('bank.view') || can('bank.manage') ? 'accounts' : 'file');
  return (
    <RequirePermission permission={['bank.view', 'bank.manage', 'bank.export']}>
      <PageHeader
        title="Bank salary payments"
        description="Employee salary accounts and the bank file for finalised payroll. Account numbers are stored encrypted and shown with only their last four digits."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Bank salary payments' }]}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'accounts', label: 'Employee bank details', hidden: !(can('bank.view') || can('bank.manage')) },
          { id: 'file', label: 'Bank salary file', hidden: !can('bank.export') },
          { id: 'layout', label: 'File layout', hidden: !can('settings.manage') },
        ]}
      />
      {tab === 'accounts' ? <Accounts /> : tab === 'file' ? <SalaryFile /> : <LayoutEditor />}
    </RequirePermission>
  );
}

function Accounts() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [removing, setRemoving] = useState<AccountRow | null>(null);
  const q = useQuery({ queryKey: ['bank-accounts'], queryFn: () => get<{ keyConfigured: boolean; items: AccountRow[] }>('/bank/accounts') });
  const remove = useMutation({
    mutationFn: (r: AccountRow) => del(`/employees/${r.employeeId}/bank`),
    onSuccess: () => {
      toast.success('Bank details removed.');
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (q.data?.items ?? []).filter((r) => !t || r.employeeCode.toLowerCase().includes(t) || r.fullName.toLowerCase().includes(t));
  }, [q.data, search]);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const missing = q.data.items.filter((r) => r.status === 'ACTIVE' && !r.bank).length;
  return (
    <>
      {missing > 0 && <Alert tone="info" className="mb-4">{missing} active employee(s) have no bank details yet.</Alert>}
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Employee ID or name…" className="sm:w-64" />
        </Toolbar>
        <DataTable<AccountRow>
          rows={rows}
          rowKey={(r) => r.employeeId}
          empty={<EmptyState icon={<Banknote className="h-6 w-6" />} title="No employees" />}
          columns={[
            { key: 'e', header: 'Employee', render: (r) => (<><span className="block font-medium text-ink">{r.employeeCode}</span><span className="text-xs text-muted">{r.fullName}{r.status !== 'ACTIVE' ? ' · inactive' : ''}</span></>) },
            { key: 'h', header: 'Account holder', render: (r) => (r.bank ? (<><span className="block">{r.bank.accountHolder}</span>{r.bank.enteredByEmployee && <Badge tone="info">Added by employee</Badge>}</>) : <Badge tone="warning">Not added</Badge>) },
            { key: 'n', header: 'Account', render: (r) => (r.bank ? <span className="inline-flex items-center gap-1 font-mono"><Lock className="h-3 w-3 text-muted" />{r.bank.accountNumberMasked}</span> : '—') },
            { key: 'i', header: 'IFSC', render: (r) => r.bank?.ifsc ?? '—' },
            { key: 'b', header: 'Bank', render: (r) => (r.bank ? [r.bank.bankName, r.bank.branch].filter(Boolean).join(', ') || '—' : '—') },
            {
              key: 'x',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (r) =>
                can('bank.manage') && q.data!.keyConfigured ? (
                  <span className="inline-flex gap-1">
                    <Button size="sm" variant="secondary" icon={r.bank ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />} onClick={() => setEditing(r)}>{r.bank ? 'Replace' : 'Add'}</Button>
                    {r.bank && <Button size="sm" variant="ghost" aria-label={`Remove bank details of ${r.fullName}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => setRemoving(r)} />}
                  </span>
                ) : null,
            },
          ]}
        />
      </Card>
      {editing && <BankDialog row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['bank-accounts'] }); }} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing)}
        loading={remove.isPending}
        title="Remove bank details"
        message={removing ? `${removing.fullName} will be left out of bank files until new details are added.` : ''}
        confirmLabel="Remove"
        tone="danger"
      />
    </>
  );
}

function BankDialog({ row, onClose, onSaved }: { row: AccountRow; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ accountHolder: row.bank?.accountHolder ?? row.fullName, accountNumber: '', confirm: '', ifsc: row.bank?.ifsc ?? '', bankName: row.bank?.bankName ?? '', branch: row.bank?.branch ?? '' });
  const clean = (v: string) => v.replace(/[\s-]/g, '');
  const m = useMutation({
    mutationFn: () => put(`/employees/${row.employeeId}/bank`, { accountHolder: f.accountHolder.trim(), accountNumber: clean(f.accountNumber), ifsc: f.ifsc.trim(), bankName: f.bankName.trim() || null, branch: f.branch.trim() || null }),
    onSuccess: () => {
      toast.success('Bank details saved.');
      onSaved();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const acctOk = /^[A-Za-z0-9]{6,34}$/.test(clean(f.accountNumber));
  const match = clean(f.accountNumber) === clean(f.confirm);
  const ifscOk = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc.trim().toUpperCase());
  const valid = f.accountHolder.trim() && acctOk && match && ifscOk;
  return (
    <Dialog open onClose={onClose} title={`Bank details — ${row.employeeCode} · ${row.fullName}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!valid} onClick={() => m.mutate()}>Save</Button></>}>
      {row.bank && <Alert tone="info" className="mb-4">The current account ({row.bank.accountNumberMasked}) is replaced. For security, the full number is never shown — enter it again.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account holder name" htmlFor="bk-holder" required className="sm:col-span-2">
          <Input id="bk-holder" value={f.accountHolder} onChange={(e) => setF({ ...f, accountHolder: e.target.value })} maxLength={100} />
        </Field>
        <Field label="Account number" htmlFor="bk-acct" required error={f.accountNumber && !acctOk ? '6–34 letters or digits.' : undefined}>
          <Input id="bk-acct" autoComplete="off" inputMode="numeric" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} />
        </Field>
        <Field label="Confirm account number" htmlFor="bk-acct2" required error={f.confirm && !match ? 'The numbers do not match.' : undefined}>
          <Input id="bk-acct2" autoComplete="off" inputMode="numeric" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} onPaste={(e) => e.preventDefault()} />
        </Field>
        <Field label="IFSC" htmlFor="bk-ifsc" required error={f.ifsc && !ifscOk ? '11 characters, e.g. ABCD0123456.' : undefined}>
          <Input id="bk-ifsc" value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} maxLength={11} />
        </Field>
        <Field label="Bank name" htmlFor="bk-name">
          <Input id="bk-name" value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} maxLength={100} />
        </Field>
        <Field label="Branch" htmlFor="bk-branch" className="sm:col-span-2">
          <Input id="bk-branch" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} maxLength={100} />
        </Field>
      </div>
    </Dialog>
  );
}

interface Preview {
  runStatus: string;
  ready: boolean;
  keyConfigured: boolean;
  employees: number;
  total: string | null;
  missing: { employeeId: string; employeeCode: string; employeeName: string }[];
  notPayable: { employeeId: string; employeeCode: string; employeeName: string }[];
  history: { id: string; format: string; fileName: string; employeeCount: number; skippedCount: number; createdByName: string; createdAt: string }[];
}

function SalaryFile() {
  const toast = useToast();
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ['runs', 'finalised'], queryFn: () => get<Page<RunSummary>>(`/payroll-runs${qs({ pageSize: 60, sortBy: 'period', sortDir: 'desc', status: 'FINALISED' })}`) });
  const finalised = (runs.data?.items ?? []).filter((r) => r.status === 'FINALISED');
  const [runId, setRunId] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [skip, setSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!runId && finalised.length) setRunId(finalised[0].id);
  }, [finalised, runId]);
  const p = useQuery({ queryKey: ['bank-preview', runId], queryFn: () => get<Preview>(`/payroll-runs/${runId}/bank-export/preview`), enabled: !!runId });
  const generate = async () => {
    setBusy(true);
    try {
      await download(`/payroll-runs/${runId}/bank-export${qs({ paymentDate, skipMissing: skip ? 'true' : 'false' })}`, 'bank-salary-file');
      toast.success('Bank file downloaded. Check it before uploading it to the bank.');
      qc.invalidateQueries({ queryKey: ['bank-preview', runId] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (runs.isLoading) return <Spinner />;
  if (!finalised.length) return <EmptyState icon={<Banknote className="h-6 w-6" />} title="No finalised payroll yet" hint="The bank salary file is generated from finalised payroll only." />;
  const d = p.data;
  const blocked = !d?.ready || (d.missing.length > 0 && !skip) || d.employees === 0;
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Finalised payroll month" htmlFor="bf-run">
            <Select id="bf-run" value={runId} onChange={(e) => setRunId(e.target.value)}>
              {finalised.map((r) => (<option key={r.id} value={r.id}>{r.period}</option>))}
            </Select>
          </Field>
          <Field label="Payment date" htmlFor="bf-date">
            <Input id="bf-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button className="w-full" icon={<Download className="h-4 w-4" />} loading={busy} disabled={blocked || !paymentDate} onClick={generate}>Download bank file</Button>
          </div>
        </div>
      </Card>
      {p.isLoading ? (
        <Spinner />
      ) : p.error || !d ? (
        <ErrorState message={errorMessage(p.error)} onRetry={() => p.refetch()} />
      ) : (
        <>
          {!d.keyConfigured && <Alert tone="warning">The server has no BANK_DATA_KEY, so the bank file cannot be generated.</Alert>}
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Employees in the file" value={String(d.employees)} />
            <Stat label="Total amount" value={d.total === null ? 'Hidden' : formatMoney(d.total)} />
            <Stat label="Missing bank details" value={String(d.missing.length)} tone={d.missing.length ? 'warning' : undefined} />
          </div>
          {d.missing.length > 0 && (
            <Alert tone="warning" title="Some employees have no bank details">
              {d.missing.map((m) => `${m.employeeCode} · ${m.employeeName}`).join(', ')}. Add their details in the first tab, or leave them out of this file and pay them separately.
              <div className="mt-2"><Checkbox label="Leave them out of this file" checked={skip} onChange={(e) => setSkip(e.target.checked)} /></div>
            </Alert>
          )}
          {d.notPayable.length > 0 && <Alert tone="info">Not included because net pay is zero or negative: {d.notPayable.map((m) => m.employeeCode).join(', ')}.</Alert>}
          <Card title="Files generated for this month" padded={false}>
            <DataTable
              rows={d.history}
              rowKey={(h) => h.id}
              empty={<EmptyState title="No bank file generated yet" />}
              columns={[
                { key: 'w', header: 'Generated', render: (h) => formatDateTime(h.createdAt) },
                { key: 'b', header: 'By', render: (h) => h.createdByName },
                { key: 'f', header: 'File', render: (h) => h.fileName },
                { key: 'n', header: 'Employees', align: 'right', render: (h) => h.employeeCount },
                { key: 's', header: 'Left out', align: 'right', render: (h) => h.skippedCount },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  return (
    <div className="fx-card rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-card)]">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === 'warning' ? 'text-warning' : 'text-primary'}`}>{value}</p>
    </div>
  );
}

function LayoutEditor() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bank-layout'], queryFn: () => get<Layout>('/bank/layout') });
  const [l, setL] = useState<Layout | null>(null);
  useEffect(() => {
    if (q.data && !l) setL(q.data);
  }, [q.data, l]);
  const save = useMutation({
    mutationFn: (body: Layout) => put<Layout>('/bank/layout', body),
    onSuccess: (d) => {
      toast.success('File layout saved.');
      qc.setQueryData(['bank-layout'], d);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading || !l) return q.error ? <ErrorState message={errorMessage(q.error)} /> : <Spinner />;
  const setCol = (i: number, patch: Partial<Layout['columns'][number]>) => setL({ ...l, columns: l.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const move = (i: number, by: number) => {
    const cols = [...l.columns];
    [cols[i], cols[i + by]] = [cols[i + by], cols[i]];
    setL({ ...l, columns: cols });
  };
  return (
    <div className="space-y-6">
      <Alert tone="warning" title="Match your bank's format">
        The starting layout is a generic one. Banks publish their own bulk-payment file formats (column order, headers, date format, transaction codes). Set the columns below exactly as your bank specifies and test a file with the bank before the first live upload.
      </Alert>
      <Card title="File">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Format" htmlFor="ly-fmt">
            <Select id="ly-fmt" value={l.format} onChange={(e) => setL({ ...l, format: e.target.value as Layout['format'] })}>
              <option value="CSV">CSV (comma separated)</option>
              <option value="XLSX">Excel (XLSX)</option>
            </Select>
          </Field>
          <Field label="Date format" htmlFor="ly-date">
            <Select id="ly-date" value={l.dateFormat} onChange={(e) => setL({ ...l, dateFormat: e.target.value as Layout['dateFormat'] })}>
              {['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DDMMYYYY'].map((x) => (<option key={x} value={x}>{x}</option>))}
            </Select>
          </Field>
          <div className="flex items-end pb-2"><Checkbox label="First row has column headings" checked={l.includeHeader} onChange={(e) => setL({ ...l, includeHeader: e.target.checked })} /></div>
        </div>
      </Card>
      <Card title="Columns (in file order)">
        <div className="space-y-2">
          {l.columns.map((c, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-2">
              <span className="w-6 pb-2 text-center text-sm text-muted">{i + 1}</span>
              <Field label="Heading" htmlFor={`col-h-${i}`} className="w-48"><Input id={`col-h-${i}`} value={c.header} onChange={(e) => setCol(i, { header: e.target.value })} maxLength={60} /></Field>
              <Field label="Contents" htmlFor={`col-f-${i}`} className="w-64">
                <Select id={`col-f-${i}`} value={c.field} onChange={(e) => setCol(i, { field: e.target.value as Field_, value: e.target.value === 'FIXED' ? c.value ?? '' : null })}>
                  {(Object.keys(FIELD_LABELS) as Field_[]).map((k) => (<option key={k} value={k}>{FIELD_LABELS[k]}</option>))}
                </Select>
              </Field>
              {c.field === 'FIXED' && <Field label="Text" htmlFor={`col-v-${i}`} className="w-40"><Input id={`col-v-${i}`} value={c.value ?? ''} onChange={(e) => setCol(i, { value: e.target.value })} maxLength={60} /></Field>}
              <span className="ml-auto inline-flex gap-1 pb-1">
                <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} icon={<ArrowUp className="h-4 w-4" />} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === l.columns.length - 1} icon={<ArrowDown className="h-4 w-4" />} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" aria-label="Remove column" disabled={l.columns.length === 1} icon={<Trash2 className="h-4 w-4" />} onClick={() => setL({ ...l, columns: l.columns.filter((_, j) => j !== i) })} />
              </span>
            </div>
          ))}
          <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={l.columns.length >= 30} onClick={() => setL({ ...l, columns: [...l.columns, { header: 'Column', field: 'FIXED', value: '' }] })}>Add column</Button>
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setL(q.data!)}>Discard changes</Button>
        <Button loading={save.isPending} disabled={l.columns.some((c) => !c.header.trim())} onClick={() => save.mutate(l)}>Save layout</Button>
      </div>
    </div>
  );
}
