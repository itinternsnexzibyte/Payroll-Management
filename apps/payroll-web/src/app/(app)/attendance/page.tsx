'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  RequirePermission,
  Select,
  Spinner,
  errorMessage,
  del,
  formatDate,
  get,
  post,
  put,
  useAuth,
  useToast,
} from '@nexzi/ui';

interface EmployeeOption {
  id: string;
  employeeCode: string;
  fullName: string;
}

interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  attendanceDate: string;
  loginTime: string | null;
  logoutTime: string | null;
  status: 'PRESENT' | 'ABSENT' | 'LEAVE';
  workingMinutes: number | null;
}

interface AttendanceForm {
  employeeId: string;
  attendanceDate: string;
  loginTime: string;
  logoutTime: string;
  status: AttendanceRecord['status'];
  workingMinutes: string;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const blankForm = (): AttendanceForm => ({ employeeId: '', attendanceDate: today(), loginTime: '', logoutTime: '', status: 'PRESENT', workingMinutes: '' });
const formatMinutes = (value: number | null) => (value === null ? '—' : `${Math.floor(value / 60)}h ${value % 60}m`);
const STATUS: Record<AttendanceRecord['status'], { label: string; tone: 'success' | 'danger' | 'warning' }> = {
  PRESENT: { label: 'Present', tone: 'success' },
  ABSENT: { label: 'Absent', tone: 'danger' },
  LEAVE: { label: 'Leave', tone: 'warning' },
};

export default function AttendanceRecordsPage() {
  return (
    <RequirePermission permission="attendance.view">
      <PageHeader
        title="Daily attendance"
        description="Review and maintain daily employee attendance. These records are separate from attendance sync and do not change payroll inputs automatically."
        breadcrumbs={[{ label: 'Attendance sync', href: '/attendance-sync' }, { label: 'Daily attendance' }]}
      />
      <AttendanceRegister />
    </RequirePermission>
  );
}

function AttendanceRegister() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState(today);
  const [employeeId, setEmployeeId] = useState('');
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<AttendanceForm>(blankForm);
  const [deleting, setDeleting] = useState<AttendanceRecord | null>(null);
  const records = useQuery({
    queryKey: ['attendance-records', date, employeeId],
    queryFn: () => get<AttendanceRecord[]>(`/attendance-records?${new URLSearchParams({ date, ...(employeeId ? { employeeId } : {}) })}`),
  });
  const employees = useQuery({
    queryKey: ['attendance-record-employees'],
    queryFn: () => get<{ items: EmployeeOption[] }>('/employees?page=1&pageSize=200&sortBy=employeeCode&sortDir=asc'),
    enabled: can('attendance.manage'),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        employeeId: form.employeeId,
        attendanceDate: form.attendanceDate,
        loginTime: form.loginTime || null,
        logoutTime: form.logoutTime || null,
        status: form.status,
        workingMinutes: form.workingMinutes === '' ? null : Number(form.workingMinutes),
      };
      return editing ? put<AttendanceRecord>(`/attendance-records/${editing.id}`, body) : post<AttendanceRecord>('/attendance-records', body);
    },
    onSuccess: () => {
      toast.success(editing ? 'Attendance updated.' : 'Attendance saved.');
      setCreating(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['attendance-records'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (row: AttendanceRecord) => del(`/attendance-records/${row.id}`),
    onSuccess: () => {
      toast.success('Attendance record deleted.');
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['attendance-records'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  useEffect(() => {
    if (editing) {
      setForm({
        employeeId: editing.employeeId,
        attendanceDate: editing.attendanceDate,
        loginTime: editing.loginTime ?? '',
        logoutTime: editing.logoutTime ?? '',
        status: editing.status,
        workingMinutes: editing.workingMinutes === null ? '' : String(editing.workingMinutes),
      });
    } else if (creating) {
      setForm({ ...blankForm(), attendanceDate: date, employeeId });
    }
  }, [creating, date, editing, employeeId]);

  const closeDialog = () => {
    setCreating(false);
    setEditing(null);
  };
  const options = employees.data?.items ?? [];
  const employeeName = (id: string) => options.find((e) => e.id === id)?.fullName ?? 'Unknown employee';
  const submit = () => save.mutate();
  const valid = Boolean(form.employeeId && form.attendanceDate && (!form.loginTime || !form.logoutTime || form.logoutTime >= form.loginTime));

  if (records.isLoading || (can('attendance.manage') && employees.isLoading)) return <Spinner />;
  if (records.error || (can('attendance.manage') && employees.error)) {
    return <ErrorState message={errorMessage(records.error ?? employees.error)} onRetry={() => { records.refetch(); employees.refetch(); }} />;
  }

  return (
    <div className="space-y-4">
      <Card
        padded={false}
        actions={can('attendance.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add attendance</Button>}
      >
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Attendance date" htmlFor="attendance-date" className="w-48">
            <Input id="attendance-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {can('attendance.manage') && (
            <Field label="Employee" htmlFor="attendance-employee" className="w-64">
              <Select id="attendance-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">All employees</option>
                {options.map((e) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.fullName}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <DataTable<AttendanceRecord>
          rows={records.data}
          rowKey={(row) => row.id}
          loading={records.isFetching}
          empty={<EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No attendance records" hint="Choose another date or add a daily attendance record." />}
          columns={[
            { key: 'date', header: 'Date', render: (row) => formatDate(row.attendanceDate) },
            { key: 'employee', header: 'Employee', render: (row) => <>{row.employeeCode}<span className="block text-xs text-muted">{row.employeeName}</span></> },
            { key: 'login', header: 'Check-in', render: (row) => row.loginTime ?? '—' },
            { key: 'logout', header: 'Check-out', render: (row) => row.logoutTime ?? '—' },
            { key: 'status', header: 'Status', render: (row) => <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge> },
            { key: 'working', header: 'Working time', align: 'right', render: (row) => formatMinutes(row.workingMinutes) },
            ...(can('attendance.manage') ? [{
              key: 'actions',
              header: '',
              align: 'right' as const,
              render: (row: AttendanceRecord) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${row.employeeName}`} icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(row)} />
                  <Button size="sm" variant="ghost" aria-label={`Delete ${row.employeeName}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(row)} />
                </div>
              ),
            }] : []),
          ]}
        />
      </Card>

      {(creating || editing) && (
        <Dialog
          open
          onClose={closeDialog}
          title={editing ? `Edit attendance — ${editing.employeeCode}` : 'Add attendance'}
          footer={<><Button variant="ghost" onClick={closeDialog}>Cancel</Button><Button loading={save.isPending} disabled={!valid} onClick={submit}>Save</Button></>}
        >
          <div className="space-y-3">
            <Field label="Employee" htmlFor="record-employee">
              <Select id="record-employee" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} disabled={Boolean(editing)}>
                <option value="">Choose an employee…</option>
                {options.map((e) => <option key={e.id} value={e.id}>{e.employeeCode} · {e.fullName}</option>)}
              </Select>
            </Field>
            <Field label="Date" htmlFor="record-date"><Input id="record-date" type="date" value={form.attendanceDate} onChange={(e) => setForm({ ...form, attendanceDate: e.target.value })} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Check-in" htmlFor="record-login"><Input id="record-login" type="time" value={form.loginTime} onChange={(e) => setForm({ ...form, loginTime: e.target.value })} /></Field>
              <Field label="Check-out" htmlFor="record-logout"><Input id="record-logout" type="time" value={form.logoutTime} onChange={(e) => setForm({ ...form, logoutTime: e.target.value })} /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status" htmlFor="record-status">
                <Select id="record-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AttendanceRecord['status'] })}>
                  <option value="PRESENT">Present</option><option value="ABSENT">Absent</option><option value="LEAVE">Leave</option>
                </Select>
              </Field>
              <Field label="Working minutes (optional)" htmlFor="record-working">
                <Input id="record-working" type="number" min="0" max="1440" step="1" value={form.workingMinutes} onChange={(e) => setForm({ ...form, workingMinutes: e.target.value })} />
              </Field>
            </div>
            {form.employeeId && <p className="text-xs text-muted">Record for {employeeName(form.employeeId)}. Attendance data is not sent to payroll unless separately imported or mapped.</p>}
          </div>
        </Dialog>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        loading={remove.isPending}
        title="Delete attendance record"
        message={deleting ? `Delete the ${formatDate(deleting.attendanceDate)} record for ${deleting.employeeName}?` : ''}
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  );
}
