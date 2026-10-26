'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileBadge } from 'lucide-react';
import { Button, EmptyState, ErrorState, Field, PageHeader, RequirePermission, Select, Spinner, download, errorMessage, get, useToast } from '@nexzi/ui';
import { Form16View, type Form16 } from '@/components/form16-view';

export default function MyForm16Page() {
  return (
    <RequirePermission permission="self.service">
      <PageHeader title="My Form 16" description="Your annual certificate of salary and tax deducted, from finalised payroll." breadcrumbs={[{ label: 'My payslips', href: '/my' }, { label: 'My Form 16' }]} />
      <Mine />
    </RequirePermission>
  );
}

function Mine() {
  const toast = useToast();
  const years = useQuery({ queryKey: ['my-form16-years'], queryFn: () => get<{ fy: number; label: string }[]>('/me/form16/years') });
  const [fy, setFy] = useState<number | null>(null);
  const [regime, setRegime] = useState<'NEW' | 'OLD'>('NEW');
  useEffect(() => {
    if (years.data?.length && fy === null) setFy(years.data[0].fy);
  }, [years.data, fy]);
  const f = useQuery({ queryKey: ['my-form16', fy, regime], queryFn: () => get<Form16>(`/me/form16?fy=${fy}&regime=${regime}`), enabled: fy !== null });
  if (years.isLoading) return <Spinner />;
  if (years.error) return <ErrorState message={errorMessage(years.error)} onRetry={() => years.refetch()} />;
  if (!years.data?.length) return <EmptyState icon={<FileBadge className="h-6 w-6" />} title="No Form 16 yet" hint="It appears once a payroll month that includes you is finalised." />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Financial year" htmlFor="fy" className="w-44">
          <Select id="fy" value={fy ?? ''} onChange={(e) => setFy(Number(e.target.value))}>
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
        <Button
          className="ml-auto"
          icon={<Download className="h-4 w-4" />}
          onClick={() => download(`/me/form16/pdf?fy=${fy}&regime=${regime}`, 'form16.pdf').catch((e) => toast.error(errorMessage(e)))}
        >
          Download PDF
        </Button>
      </div>
      {f.isLoading ? <Spinner /> : f.error ? <ErrorState message={errorMessage(f.error)} /> : f.data && <Form16View f={f.data} />}
    </div>
  );
}
