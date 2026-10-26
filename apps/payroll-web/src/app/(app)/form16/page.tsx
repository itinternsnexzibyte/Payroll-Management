'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileBadge } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, Field, PageHeader, RequirePermission, SearchInput, Select, Spinner, Toolbar, download, errorMessage, formatMoney, get, useToast } from '@nexzi/ui';
import { Form16View, type Form16 } from '@/components/form16-view';

interface Row {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  pan: string | null;
  months: number;
  gross: string;
  tds: string;
}

export default function Form16Page() {
  return (
    <RequirePermission permission="reports.view">
      <PageHeader
        title="Form 16"
        description="Annual certificate of salary paid and tax deducted at source, per employee and financial year, built from finalised payroll."
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Form 16' }]}
      />
      <Form16Admin />
    </RequirePermission>
  );
}

function Form16Admin() {
  const toast = useToast();
  const years = useQuery({ queryKey: ['form16-years'], queryFn: () => get<{ fy: number; label: string }[]>('/form16/years') });
  const [fy, setFy] = useState<number | null>(null);
  const [regime, setRegime] = useState<'NEW' | 'OLD'>('NEW');
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (years.data?.length && fy === null) setFy(years.data[0].fy);
  }, [years.data, fy]);
  const list = useQuery({ queryKey: ['form16-employees', fy], queryFn: () => get<Row[]>(`/form16/employees?fy=${fy}`), enabled: fy !== null });
  const detail = useQuery({ queryKey: ['form16', selected, fy, regime], queryFn: () => get<Form16>(`/form16/employees/${selected}?fy=${fy}&regime=${regime}`), enabled: Boolean(selected && fy !== null) });

  if (years.isLoading) return <Spinner />;
  if (years.error) return <ErrorState message={errorMessage(years.error)} onRetry={() => years.refetch()} />;
  if (!years.data?.length) return <EmptyState icon={<FileBadge className="h-6 w-6" />} title="No finalised payroll yet" hint="Form 16 is built from finalised payroll months." />;
  const rows = (list.data ?? []).filter((r) => !search || `${r.employeeCode} ${r.employeeName}`.toLowerCase().includes(search.toLowerCase()));
  const pdf = async (employeeId: string, code: string) => {
    try {
      await download(`/form16/employees/${employeeId}/pdf?fy=${fy}&regime=${regime}`, `form16-${code}.pdf`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <Card padded={false}>
        <Toolbar>
          <Field label="Financial year" htmlFor="fy" className="w-44">
            <Select id="fy" value={fy ?? ''} onChange={(e) => { setFy(Number(e.target.value)); setSelected(null); }}>
              {years.data.map((y) => (
                <option key={y.fy} value={y.fy}>
                  {y.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tax regime" htmlFor="regime" className="w-52">
            <Select id="regime" value={regime} onChange={(e) => setRegime(e.target.value as 'NEW' | 'OLD')}>
              <option value="NEW">New regime (115BAC)</option>
              <option value="OLD">Old regime</option>
            </Select>
          </Field>
          <SearchInput value={search} onChange={setSearch} placeholder="Search employee…" className="ml-auto w-64" />
        </Toolbar>
        <DataTable<Row>
          caption="Employees paid in the financial year"
          rows={rows}
          loading={list.isLoading}
          error={list.error ? errorMessage(list.error) : null}
          rowKey={(r) => r.employeeId}
          selectedKey={selected}
          empty={<EmptyState title="No employees paid in this year" />}
          columns={[
            { key: 'code', header: 'Employee', render: (r) => <button className="text-left font-medium text-cobalt hover:underline" onClick={() => setSelected(r.employeeId)}>{r.employeeCode} · {r.employeeName}</button> },
            { key: 'pan', header: 'PAN', render: (r) => r.pan ?? <span className="text-warning">Missing</span> },
            { key: 'months', header: 'Months', align: 'right', render: (r) => r.months },
            { key: 'gross', header: 'Gross salary', align: 'right', render: (r) => formatMoney(r.gross) },
            { key: 'tds', header: 'TDS', align: 'right', render: (r) => formatMoney(r.tds) },
            { key: 'pdf', header: '', align: 'right', render: (r) => <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => pdf(r.employeeId, r.employeeCode)}>PDF</Button> },
          ]}
        />
      </Card>
      {selected && (detail.isLoading ? <Spinner /> : detail.error ? <ErrorState message={errorMessage(detail.error)} /> : detail.data && (
        <>
          <div className="flex justify-end">
            <Button icon={<Download className="h-4 w-4" />} onClick={() => pdf(detail.data.employee.id, detail.data.employee.employeeCode)}>
              Download Form 16 (PDF)
            </Button>
          </div>
          <Form16View f={detail.data} />
        </>
      ))}
    </div>
  );
}
