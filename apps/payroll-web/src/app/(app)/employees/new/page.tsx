'use client';
import { useRouter } from 'next/navigation';
import { Card, PageHeader, RequirePermission } from '@nexzi/ui';
import { EmployeeForm } from '@/components/employee-form';

export default function NewEmployeePage() {
  const router = useRouter();
  return (
    <RequirePermission permission="employees.manage">
      <PageHeader title="Add employee" breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Employees', href: '/employees' }, { label: 'Add employee' }]} />
      <Card className="max-w-3xl">
        <EmployeeForm onSaved={(e) => router.push(`/employees/${e.id}?tab=salary`)} onCancel={() => router.push('/employees')} />
      </Card>
    </RequirePermission>
  );
}
