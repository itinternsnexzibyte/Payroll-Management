'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye, FileText, UserRound } from 'lucide-react';
import { Alert, Button, Card, DataTable, EmptyState, ErrorState, PageHeader, RequirePermission, Spinner, download, errorMessage, formatDateTime, get, openPdf, useToast } from '@nexzi/ui';

interface Me {
  id: string;
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
      <PageHeader title="My payslips" description="Your issued payslips. They appear here once a payroll month is finalised." breadcrumbs={[{ label: 'My payslips' }]} actions={<div className="flex gap-4"><Link href="/my/form16" className="inline-flex items-center gap-2 text-sm font-medium text-cobalt hover:underline"><FileText className="h-4 w-4" /> My Form 16</Link><Link href="/my/account" className="inline-flex items-center gap-2 text-sm font-medium text-cobalt hover:underline"><UserRound className="h-4 w-4" /> My account</Link></div>} />
      {me.isLoading ? (
        <Spinner />
      ) : me.error ? (
        <Alert tone="warning" title="Your account is not linked yet">{errorMessage(me.error)}</Alert>
      ) : (
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
      )}
    </RequirePermission>
  );
}
