'use client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, KeyValue, PageHeader, RequirePermission, Spinner, errorMessage, formatDate, get } from '@nexzi/ui';
import { EmployeeDocumentsTab, EmployeeProfilePhoto, EmployeeRatingsTab, EmployeeWorkforceProfileTab } from '@/components/employee-workforce-details';
import { MyBankDetails } from '@/components/my-bank-details';

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

export default function MyAccountPage() {
  const me = useQuery({ queryKey: ['me-employee'], queryFn: () => get<Me>('/me/employee'), retry: false });
  return (
    <RequirePermission permission="self.service">
      <PageHeader title="My account" description="Your employee details, workforce profile, bank details, documents and evaluation history." breadcrumbs={[{ label: 'My account' }]} />
      {me.isLoading ? (
        <Spinner />
      ) : me.error || !me.data ? (
        <Alert tone="warning" title="Your account is not linked yet">{errorMessage(me.error)}</Alert>
      ) : (
        <div className="space-y-5">
          <Card title="My details">
            <EmployeeProfilePhoto employeeId={me.data.id} employeeName={me.data.fullName} />
            <KeyValue
              columns={2}
              items={[
                { label: 'Employee ID', value: me.data.employeeCode },
                { label: 'Name', value: me.data.fullName },
                { label: 'Department', value: me.data.department ?? '—' },
                { label: 'Designation', value: me.data.designation ?? '—' },
                { label: 'Joined', value: formatDate(me.data.joiningDate) },
                { label: 'Email', value: me.data.contactEmail ?? '—' },
                { label: 'Phone', value: me.data.contactPhone ?? '—' },
              ]}
            />
            <p className="mt-4 text-xs text-muted">Something wrong? Ask the payroll team to correct it.</p>
          </Card>
          <EmployeeWorkforceProfileTab employeeId={me.data.id} canManage={false} />
          <MyBankDetails />
          <EmployeeDocumentsTab employeeId={me.data.id} canManage={false} />
          <EmployeeRatingsTab employeeId={me.data.id} canManage={false} />
        </div>
      )}
    </RequirePermission>
  );
}
