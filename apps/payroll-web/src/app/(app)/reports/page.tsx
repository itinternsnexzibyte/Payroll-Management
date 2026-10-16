'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  RequirePermission,
  Select,
  Spinner,
  Tabs,
  download,
  errorMessage,
  formatMoney,
  get,
  qs,
  useAuth,
  useToast,
  type Page,
} from '@nexzi/ui';
import type { Employee, RunSummary } from '@/lib/types';

interface Report {
  title: string;
  subtitle: string;
  banners: string[];
  columns: { header: string; key: string; numeric?: boolean }[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
}

export default function ReportsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'run' | 'employee'>('run');
  return (
    <RequirePermission permission="reports.view">
      <PageHeader title="Reports" description="Monthly summary, register, earnings, deductions, net payable, statutory deductions and employee salary statements — on screen, as PDF or as XLSX." breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Reports' }]} />
      {!can('payroll.view_amounts') ? (
        <Alert tone="warning">Your role does not include permission to view payroll amounts, so reports are not available.</Alert>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'run', label: 'Monthly reports' },
              { id: 'employee', label: 'Employee salary statement' },
            ]}
          />
          {tab === 'run' ? <RunReports /> : <EmployeeStatement />}
        </>
      )}
    </RequirePermission>
  );
}

function ReportView({ path, filename }: { path: string; filename: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['report', path], queryFn: () => get<Report>(path) });
  const exp = async (format: 'pdf' | 'xlsx') => {
    setBusy(format);
    try {
      await download(`${path}&format=${format}`, `${filename}.${format}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const r = q.data;
  const cell = (c: Report['columns'][number], row: Record<string, string | number | null>) => (c.numeric ? formatMoney(row[c.key] as string) : (row[c.key] ?? '—'));
  return (
    <Card
      title={r.title}
      padded={false}
      actions={
        <>
          <Button size="sm" variant="secondary" icon={<FileDown className="h-4 w-4" />} loading={busy === 'pdf'} onClick={() => exp('pdf')}>
            PDF
          </Button>
          <Button size="sm" variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} loading={busy === 'xlsx'} onClick={() => exp('xlsx')}>
            XLSX
          </Button>
        </>
      }
    >
      <p className="px-5 pt-3 text-xs text-muted">{r.subtitle}</p>
      {r.banners.map((b) => (
        <Alert key={b} tone="warning" className="mx-5 mt-3">
          {b}
        </Alert>
      ))}
      <div className="mt-3">
        <DataTable
          dense
          rows={r.rows}
          rowKey={(row) => JSON.stringify(row)}
          empty={<EmptyState title="No data for this report" />}
          columns={r.columns.map((c) => ({ key: c.key, header: c.header, align: c.numeric ? 'right' : 'left', render: (row: Record<string, string | number | null>) => cell(c, row) }))}
        />
        {r.totals && (
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-t-2 border-primary/20 bg-mist/35 font-semibold">
                {r.columns.map((c) => (
                  <td key={c.key} className={`px-4 py-2 ${c.numeric ? 'text-right tabular-nums' : ''}`}>
                    {c.numeric ? formatMoney(r.totals![c.key] as string) : r.totals![c.key]}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

const REPORTS = [
  { id: 'register', label: 'Monthly payroll register (all components)', path: (id: string) => `/reports/payroll-register${qs({ runId: id })}`, file: 'payroll-register' },
  { id: 'summary', label: 'Monthly payroll summary', path: (id: string) => `/reports/monthly-summary${qs({ runId: id })}`, file: 'payroll-summary' },
  { id: 'earnings', label: 'Earnings report', path: (id: string) => `/reports/components${qs({ runId: id, type: 'EARNING' })}`, file: 'earnings' },
  { id: 'deductions', label: 'Deductions report', path: (id: string) => `/reports/components${qs({ runId: id, type: 'DEDUCTION' })}`, file: 'deductions' },
  { id: 'net', label: 'Net payable report', path: (id: string) => `/reports/net-payable${qs({ runId: id })}`, file: 'net-payable' },
  { id: 'statutory', label: 'Statutory deductions (PF, ESI, TDS)', path: (id: string) => `/reports/statutory${qs({ runId: id })}`, file: 'statutory' },
];

function RunReports() {
  const runs = useQuery({ queryKey: ['runs', 'reportable'], queryFn: () => get<Page<RunSummary>>(`/payroll-runs${qs({ pageSize: 60, sortBy: 'period', sortDir: 'desc' })}`) });
  const usable = (runs.data?.items ?? []).filter((r) => r.status !== 'DRAFT');
  const [runId, setRunId] = useState('');
  const [report, setReport] = useState('summary');
  useEffect(() => {
    if (!runId && usable.length) setRunId((usable.find((r) => r.status === 'FINALISED') ?? usable[0]).id);
  }, [usable, runId]);
  const def = REPORTS.find((r) => r.id === report)!;
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payroll month" htmlFor="run">
            <Select id="run" value={runId} onChange={(e) => setRunId(e.target.value)}>
              {!usable.length && <option value="">No calculated payroll yet</option>}
              {usable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.period} — {r.status.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Report" htmlFor="rep">
            <Select id="rep" value={report} onChange={(e) => setReport(e.target.value)}>
              {REPORTS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      {runId ? <ReportView path={def.path(runId)} filename={def.file} /> : <Card><EmptyState title="Calculate a payroll run to see reports" /></Card>}
    </div>
  );
}

function EmployeeStatement() {
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [year, setYear] = useState('');
  const emps = useQuery({ queryKey: ['employees', 'picker', search], queryFn: () => get<Page<Employee>>(`/employees${qs({ search, pageSize: 50 })}`) });
  const thisYear = new Date().getFullYear();
  return (
    <div className="space-y-6">
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Find employee" htmlFor="es">
            <Input id="es" placeholder="ID or name" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label="Employee" htmlFor="ep">
            <Select id="ep" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Choose…</option>
              {emps.data?.items.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employeeCode} — {e.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" htmlFor="ey">
            <Select id="ey" value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">All periods</option>
              {Array.from({ length: 5 }, (_, i) => thisYear - i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      {employeeId ? <ReportView path={`/reports/employee-statement${qs({ employeeId, year })}`} filename="salary-statement" /> : <Card><EmptyState title="Choose an employee to see the month-by-month statement" /></Card>}
    </div>
  );
}
