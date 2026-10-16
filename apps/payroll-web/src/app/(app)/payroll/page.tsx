'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  Alert,
  ApiError,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  RequirePermission,
  Select,
  Spinner,
  StatusBadge,
  Toolbar,
  errorMessage,
  formatDateTime,
  formatMoney,
  get,
  post,
  qs,
  useAuth,
  useListParams,
  useToast,
  type Page,
} from '@nexzi/ui';
import { MONTHS, type RunSummary } from '@/lib/types';

export default function PayrollRunsPage() {
  return (
    <RequirePermission permission="payroll.view">
      <RunsList />
    </RequirePermission>
  );
}

const FILTERS = { status: '', year: '' };

function RunsList() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const list = useListParams({ sortBy: 'period', sortDir: 'desc', filters: FILTERS });
  const q = useQuery({ queryKey: ['runs', list.query], queryFn: () => get<Page<RunSummary>>(`/payroll-runs${qs(list.query)}`), placeholderData: (p) => p });
  const thisYear = new Date().getFullYear();
  return (
    <>
      <PageHeader
        title="Payroll runs"
        description="One run per month: Draft → Calculated → Under review → Approved → Finalised. Finalised runs are locked snapshots."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Payroll runs' }]}
        actions={
          can('payroll.input') && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
              Start payroll run
            </Button>
          )
        }
      />
      <Card padded={false}>
        <Toolbar>
          <Select className="w-48" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {['DRAFT', 'CALCULATED', 'UNDER_REVIEW', 'APPROVED', 'FINALISED'].map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
              </option>
            ))}
          </Select>
          <Select className="w-32" value={list.filters.year} onChange={(e) => list.setFilter('year', e.target.value)} aria-label="Filter by year">
            <option value="">All years</option>
            {Array.from({ length: 6 }, (_, i) => thisYear + 1 - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Toolbar>
        <DataTable<RunSummary>
          caption="Payroll runs"
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => q.refetch()}
          rowKey={(r) => r.id}
          rowHref={(r) => `/payroll/${r.id}`}
          sortBy={list.sortBy}
          sortDir={list.sortDir}
          onSort={list.toggleSort}
          empty={<EmptyState title="No payroll runs found" hint={can('payroll.input') ? 'Start a run for the month you want to process.' : undefined} />}
          columns={[
            { key: 'period', header: 'Month', sortable: true, render: (r) => <Link className="font-medium text-cobalt hover:underline" href={`/payroll/${r.id}`}>{r.period}</Link> },
            { key: 'status', header: 'Status', sortable: true, render: (r) => (<span className="flex items-center gap-1.5"><StatusBadge status={r.status} />{r.reopenCount > 0 && <Badge tone="warning">Re-opened ×{r.reopenCount}</Badge>}</span>) },
            { key: 'employees', header: 'Employees', align: 'right', render: (r) => r.employeeCount },
            { key: 'earnings', header: 'Gross', align: 'right', render: (r) => formatMoney(r.totalEarnings) },
            { key: 'net', header: 'Net pay', align: 'right', render: (r) => <strong>{formatMoney(r.totalNet)}</strong> },
            { key: 'rules', header: 'Rules', render: (r) => (r.status === 'DRAFT' ? '—' : r.rulesApproved ? <Badge tone="success">Approved</Badge> : <Badge tone="warning">Provisional</Badge>) },
            { key: 'createdAt', header: 'Last update', sortable: true, render: (r) => formatDateTime(r.finalisedAt ?? r.calculatedAt ?? r.createdAt) },
          ]}
        />
        {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>
      <StartRunDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

interface Eligible {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  status: string;
  hasSalaryStructure: boolean;
}

function StartRunDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<string | null>(null);
  const elig = useQuery({ queryKey: ['eligible', year, month], queryFn: () => get<Eligible[]>(`/payroll-runs/eligible-employees${qs({ year, month })}`), enabled: open });
  useEffect(() => {
    if (elig.data) setSelected(new Set(elig.data.map((e) => e.id)));
    setExisting(null);
  }, [elig.data]);
  const shown = useMemo(() => (elig.data ?? []).filter((e) => !filter || `${e.employeeCode} ${e.fullName} ${e.department ?? ''}`.toLowerCase().includes(filter.toLowerCase())), [elig.data, filter]);
  const missingStructure = (elig.data ?? []).filter((e) => selected.has(e.id) && !e.hasSalaryStructure).length;

  const create = async () => {
    setBusy(true);
    try {
      const all = elig.data?.length === selected.size;
      const run = await post<RunSummary>('/payroll-runs', { year, month, ...(all ? {} : { employeeIds: [...selected] }) });
      await qc.invalidateQueries({ queryKey: ['runs'] });
      toast.success(`${run.period} payroll started as a draft.`);
      onClose();
      router.push(`/payroll/${run.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFLICT' && typeof e.details.existingRunId === 'string') setExisting(e.details.existingRunId);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Start payroll run"
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={selected.size === 0} onClick={create}>
            Start {MONTHS[month - 1]} {year} ({selected.size})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Month" htmlFor="m">
            <Select id="m" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" htmlFor="y">
            <Select id="y" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[now.getFullYear() + 1, now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {existing && (
          <Alert tone="info">
            A run for this month already exists.{' '}
            <Link className="font-semibold underline" href={`/payroll/${existing}`} onClick={onClose}>
              Open it
            </Link>
          </Alert>
        )}
        {missingStructure > 0 && <Alert tone="warning">{missingStructure} selected employee(s) have no salary structure for this month. They will be flagged as exceptions until a salary version is added.</Alert>}
        <div className="flex items-center justify-between gap-3">
          <Input aria-label="Filter employees" placeholder="Filter employees" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
          <div className="flex gap-2 text-sm">
            <button className="text-cobalt hover:underline" onClick={() => setSelected(new Set(elig.data?.map((e) => e.id)))}>
              Select all
            </button>
            <span className="text-line">|</span>
            <button className="text-cobalt hover:underline" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border border-line">
          {elig.isLoading ? (
            <Spinner />
          ) : shown.length === 0 ? (
            <EmptyState title="No eligible employees for this month" hint="Employees are eligible when they are employed during at least part of the month." />
          ) : (
            <ul className="divide-y divide-line">
              {shown.map((e) => (
                <li key={e.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-mist/25">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={selected.has(e.id)}
                      onChange={(ev) => {
                        const s = new Set(selected);
                        if (ev.target.checked) s.add(e.id);
                        else s.delete(e.id);
                        setSelected(s);
                      }}
                    />
                    <span className="w-24 font-medium text-ink">{e.employeeCode}</span>
                    <span className="flex-1 text-ink">{e.fullName}</span>
                    <span className="text-xs text-muted">{e.department ?? ''}</span>
                    {!e.hasSalaryStructure && <Badge tone="warning">No salary</Badge>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
