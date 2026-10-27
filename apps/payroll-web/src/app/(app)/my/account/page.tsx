'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Field, Input, PageHeader, RequirePermission, Select, Spinner, errorMessage, formatDate, get, put, useToast } from '@nexzi/ui';
import { EmployeeDocumentsTab, EmployeeProfilePhoto, EmployeeRatingsTab, EmployeeWorkforceProfileTab } from '@/components/employee-workforce-details';
import { MyBankDetails } from '@/components/my-bank-details';
import { useDepartments, useDesignations } from '@/lib/hooks';

interface Me {
  id: string;
  employeeCode: string;
  fullName: string;
  departmentId: string | null;
  department: string | null;
  designationId: string | null;
  designation: string | null;
  joiningDate: string;
  status: string;
  contactEmail: string | null;
  contactPhone: string | null;
  panNumber: string | null;
  uanNumber: string | null;
  pfNumber: string | null;
}

type Form = Pick<Me, 'fullName' | 'departmentId' | 'designationId' | 'contactEmail' | 'contactPhone' | 'panNumber' | 'uanNumber' | 'pfNumber'>;
const toForm = (m: Me): Form => ({ fullName: m.fullName, departmentId: m.departmentId, designationId: m.designationId, contactEmail: m.contactEmail, contactPhone: m.contactPhone, panNumber: m.panNumber, uanNumber: m.uanNumber, pfNumber: m.pfNumber });

function MyDetailsCard({ me }: { me: Me }) {
  const toast = useToast();
  const qc = useQueryClient();
  const departments = useDepartments();
  const designations = useDesignations();
  const [form, setForm] = useState<Form>(() => toForm(me));
  useEffect(() => setForm(toForm(me)), [me]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const save = useMutation({
    mutationFn: () => put<Me>('/me/employee', { ...form, fullName: form.fullName.trim() }),
    onSuccess: (updated) => {
      qc.setQueryData(['me-employee'], updated);
      toast.success('Your details are saved.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Card title="My details">
      <EmployeeProfilePhoto employeeId={me.id} employeeName={me.fullName} />
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Employee ID" locked="Set by the payroll team"><Input value={me.employeeCode} disabled /></Field>
        <Field label="Joined" locked="Set by the payroll team"><Input value={formatDate(me.joiningDate)} disabled /></Field>
        <Field label="Name" required><Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} maxLength={120} /></Field>
        <Field label="Email"><Input type="email" value={form.contactEmail ?? ''} onChange={(e) => set('contactEmail', e.target.value)} maxLength={200} /></Field>
        <Field label="Department">
          <Select value={form.departmentId ?? ''} onChange={(e) => set('departmentId', e.target.value || null)}>
            <option value="">—</option>
            {departments.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Designation">
          <Select value={form.designationId ?? ''} onChange={(e) => set('designationId', e.target.value || null)}>
            <option value="">—</option>
            {designations.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Phone"><Input type="tel" value={form.contactPhone ?? ''} onChange={(e) => set('contactPhone', e.target.value)} maxLength={20} /></Field>
        <Field label="PAN number"><Input value={form.panNumber ?? ''} onChange={(e) => set('panNumber', e.target.value.toUpperCase())} maxLength={10} placeholder="ABCDE1234F" /></Field>
        <Field label="UAN"><Input inputMode="numeric" value={form.uanNumber ?? ''} onChange={(e) => set('uanNumber', e.target.value)} maxLength={12} /></Field>
        <Field label="PF number"><Input value={form.pfNumber ?? ''} onChange={(e) => set('pfNumber', e.target.value.toUpperCase())} maxLength={30} /></Field>
        <div className="flex justify-end sm:col-span-2">
          <Button type="submit" loading={save.isPending}>Save my details</Button>
        </div>
      </form>
    </Card>
  );
}

export default function MyAccountPage() {
  const me = useQuery({ queryKey: ['me-employee'], queryFn: () => get<Me>('/me/employee'), retry: false });
  return (
    <RequirePermission permission="self.service">
      <PageHeader title="My profile" description="Edit your details, workforce profile, bank details and documents. Your changes are recorded in the audit trail." breadcrumbs={[{ label: 'Employee dashboard', href: '/my' }, { label: 'My profile' }]} />
      {me.isLoading ? (
        <Spinner />
      ) : me.error || !me.data ? (
        <Alert tone="warning" title="Your account is not linked yet">{errorMessage(me.error)}</Alert>
      ) : (
        <div className="space-y-5">
          <MyDetailsCard me={me.data} />
          <EmployeeWorkforceProfileTab employeeId={me.data.id} canManage />
          <MyBankDetails />
          <EmployeeDocumentsTab employeeId={me.data.id} canManage />
          <EmployeeRatingsTab employeeId={me.data.id} canManage={false} />
        </div>
      )}
    </RequirePermission>
  );
}
