'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Download, Eye, FileText } from 'lucide-react';
import { Alert, Button, Card, DataTable, EmptyState, ErrorState, KeyValue, PageHeader, RequirePermission, Spinner, download, errorMessage, formatDate, formatDateTime, get, openPdf, useToast } from '@nexzi/ui';
import { EmployeeDocumentsTab, EmployeeProfilePhoto, EmployeeRatingsTab, EmployeeWorkforceProfileTab } from '@/components/employee-workforce-details';

interface Me {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  designation: string | null;
  joiningDate: string;
  status: string;
  contactEmail: string | null;
  contactPhone: string | null;
}
interface Slip {
  id: string;
  period: string;
  generatedAt: string;
}

export default function MyPage() {
  const toast = useToast();
  const me = useQuery({ queryKey: ['me-employee'], queryFn: () => get<Me>('/me/employee'), retry: false });
  const slips = useQuery({ queryKey: ['me-payslips'], queryFn: () => get<Slip[]>('/me/payslips'), retry: false, enabled: me.isSuccess });
  return (
    <RequirePermission permission="self.service">
      <PageHeader title="My payslips" description="Your issued payslips and your employee details. Payslips appear here once a payroll month is finalised." breadcrumbs={[{ label: 'My payslips' }]} actions={<Link href="/my/leave" className="inline-flex items-center gap-2 text-sm font-medium text-cobalt hover:underline"><CalendarDays className="h-4 w-4" /> My leave</Link>} />
      {me.isLoading ? (
        <Spinner />
      ) : me.error ? (
        <Alert tone="warning" title="Your account is not linked yet">{errorMessage(me.error)}</Alert>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card title="Payslips" padded={false}>
              {slips.error ? (
                <ErrorState message={errorMessage(slips.error)} onRetry={() => slips.refetch()} />
              ) : (
                <DataTable<Slip>
                  rows={slips.data}
                  loading={slips.isLoading}
                  rowKey={(s) => s.id}
                  empty={<EmptyState icon={<FileText className="h-6 w-6" />} title="No payslips yet" hint="You will receive an email when a payslip is available." />}
                  columns={[
                    { key: 'p', header: 'Month', render: (s) => <span className="font-medium text-ink">{s.period}</span> },
                    { key: 'g', header: 'Issued', render: (s) => formatDateTime(s.generatedAt) },
                    {
                      key: 'a',
                      header: <span className="sr-only">Actions</span>,
                      align: 'right',
                      render: (s) => (
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" icon={<Eye className="h-4 w-4" />} onClick={() => openPdf(`/me/payslips/${s.id}?disposition=inline`).catch((e) => toast.error(errorMessage(e)))}>View</Button>
                          <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download(`/me/payslips/${s.id}`, `payslip-${s.period}.pdf`).catch((e) => toast.error(errorMessage(e)))}>Download</Button>
                        </span>
                      ),
                    },
                  ]}
                />
              )}
            </Card>
            <Card title="My details">
              <KeyValue
                columns={1}
                items={[
                  { label: 'Employee ID', value: me.data!.employeeCode },
                  { label: 'Name', value: me.data!.fullName },
                  { label: 'Department', value: me.data!.department ?? '—' },
                  { label: 'Designation', value: me.data!.designation ?? '—' },
                  { label: 'Joined', value: formatDate(me.data!.joiningDate) },
                  { label: 'Email', value: me.data!.contactEmail ?? '—' },
                  { label: 'Phone', value: me.data!.contactPhone ?? '—' },
                ]}
              />
              <p className="mt-4 text-xs text-muted">Something wrong? Ask the payroll team to correct it.</p>
            </Card>
          </div>
          <EmployeeWorkforceProfileTab employeeId={me.data!.id} canManage={false} />
          <EmployeeRatingsTab employeeId={me.data!.id} canManage={false} />
          <EmployeeProfilePhoto employeeId={me.data!.id} employeeName={me.data!.fullName} />
          <EmployeeDocumentsTab employeeId={me.data!.id} canManage={false} canUploadProfilePhoto />
        </div>
      )}
    </RequirePermission>
  );
}
