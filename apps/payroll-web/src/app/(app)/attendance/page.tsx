'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
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
  formatDateTime,
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
  status: 'PRESENT' | 'ABSENT' | 'LEAVE' | 'ONLINE' | 'ON_BREAK';
  workingMinutes: number | null;
  checkInCount: number;
  checkOutCount: number;
  breakMinutes: number;
  isOnline: boolean;
  onBreak: boolean;
  sessions: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    forcedCheckout: boolean;
    locationConsent: boolean;
    breaks: { id: string; startedAt: string; endedAt: string | null; durationMinutes: number }[];
  }[];
}

interface AttendanceForm {
  employeeId: string;
  attendanceDate: string;
  loginTime: string;
  logoutTime: string;
  status: 'PRESENT' | 'ABSENT' | 'LEAVE';
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
  ONLINE: { label: 'Checked in', tone: 'success' },
  ON_BREAK: { label: 'On break', tone: 'warning' },
};

export default function AttendanceRecordsPage() {
  const { can } = useAuth();
  return (
    <RequirePermission permission="attendance.view">
      <PageHeader
        title="Daily attendance"
        description="Review and maintain daily employee attendance. These records are separate from attendance sync and do not change payroll inputs automatically."
        breadcrumbs={[{ label: 'Attendance sync', href: '/attendance-sync' }, { label: 'Daily attendance' }]}
      />
      <AttendanceRegister />
      {can('attendance.manage') && <AttendanceAccessRequests />}
    </RequirePermission>
  );
}

function AttendanceRegister() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [employeeId, setEmployeeId] = useState('');
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<AttendanceForm>(blankForm);
  const [deleting, setDeleting] = useState<AttendanceRecord | null>(null);
  const records = useQuery({
    queryKey: ['attendance-records', date, employeeId],
    queryFn: () => get<AttendanceRecord[]>(`/attendance-sessions?${new URLSearchParams({ date, ...(employeeId ? { employeeId } : {}) })}`),
  });
  const [monthYear, monthNumber] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(monthYear, monthNumber, 0).getDate()).padStart(2, '0')}`;
  const monthRecords = useQuery({
    queryKey: ['attendance-month', monthStart, monthEnd, employeeId],
    queryFn: () => get<AttendanceRecord[]>(`/attendance-sessions?${new URLSearchParams({ start: monthStart, end: monthEnd, ...(employeeId ? { employeeId } : {}) })}`),
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
        status: editing.status === 'ABSENT' || editing.status === 'LEAVE' ? editing.status : 'PRESENT',
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
  const monthlyRows = monthRecords.data ?? [];
  const daysInMonth = new Date(monthYear, monthNumber, 0).getDate();
  const firstWeekdayOffset = (new Date(monthYear, monthNumber - 1, 1).getDay() + 6) % 7;
  const monthDays = Array.from({ length: daysInMonth }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    const attendanceDate = `${month}-${day}`;
    return { attendanceDate, rows: monthlyRows.filter((row) => row.attendanceDate === attendanceDate) };
  });
  const monthWorkedMinutes = monthlyRows.reduce((total, row) => total + (row.workingMinutes ?? 0), 0);
  const monthEmployeeCount = new Set(monthlyRows.map((row) => row.employeeId)).size;
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
            { key: 'sessions', header: 'Sessions', align: 'right', render: (row) => <>{row.checkInCount} in / {row.checkOutCount} out{row.sessions.some((s) => s.forcedCheckout) && <span className="block text-xs text-warning">Forced checkout</span>}</> },
            { key: 'breaks', header: 'Breaks', align: 'right', render: (row) => `${row.breakMinutes} min` },
            { key: 'status', header: 'Status', render: (row) => <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge> },
            { key: 'working', header: 'Working time', align: 'right', render: (row) => formatMinutes(row.workingMinutes) },
            { key: 'details', header: '', align: 'right', render: (row) => row.sessions.length ? <SessionDetails row={row} /> : null },
            ...(can('attendance.manage') ? [{
              key: 'actions',
              header: '',
              align: 'right' as const,
              render: (row: AttendanceRecord) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Edit ${row.employeeName}`} icon={<Pencil className="h-4 w-4" />} disabled={row.sessions.length > 0} onClick={() => setEditing(row)} />
                  <Button size="sm" variant="ghost" aria-label={`Delete ${row.employeeName}`} icon={<Trash2 className="h-4 w-4" />} disabled={row.isOnline} onClick={() => setDeleting(row)} />
                </div>
              ),
            }] : []),
          ]}
        />
      </Card>

      <Card title="Monthly attendance calendar" padded={false}>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Month" htmlFor="attendance-month" className="w-48">
            <Input id="attendance-month" type="month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} />
          </Field>
          <p className="pb-2 text-sm text-muted">Select a date to open its daily register.</p>
        </div>
        {monthRecords.error ? <ErrorState message={errorMessage(monthRecords.error)} onRetry={() => monthRecords.refetch()} /> : (
          <>
            <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-3">
              <div className="rounded-lg border border-line bg-canvas p-3"><p className="text-xs text-muted">Employees with attendance</p><p className="mt-1 text-lg font-semibold">{monthEmployeeCount}</p></div>
              <div className="rounded-lg border border-line bg-canvas p-3"><p className="text-xs text-muted">Attendance records</p><p className="mt-1 text-lg font-semibold">{monthlyRows.length}</p></div>
              <div className="rounded-lg border border-line bg-canvas p-3"><p className="text-xs text-muted">Recorded work time</p><p className="mt-1 text-lg font-semibold">{formatMinutes(monthWorkedMinutes)}</p></div>
            </div>
            <div className="grid grid-cols-7 gap-1 px-4 pb-4 text-center text-xs font-medium text-muted sm:gap-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => <div key={weekday} className="py-2">{weekday}</div>)}
              {Array.from({ length: firstWeekdayOffset }, (_, index) => <div key={`blank-${index}`} aria-hidden />)}
              {monthDays.map(({ attendanceDate, rows }) => {
                const isSelected = attendanceDate === date;
                return (
                  <button
                    key={attendanceDate}
                    type="button"
                    aria-label={`${formatDate(attendanceDate)}: ${rows.length} attendance records`}
                    aria-pressed={isSelected}
                    onClick={() => setDate(attendanceDate)}
                    className={`min-h-16 rounded-lg border p-1 text-left transition-colors sm:min-h-20 sm:p-2 ${isSelected ? 'border-cobalt bg-cobalt/5' : 'border-line bg-white hover:bg-canvas'} ${monthRecords.isFetching ? 'opacity-60' : ''}`}
                  >
                    <span className="block text-xs font-semibold text-ink">{Number(attendanceDate.slice(-2))}</span>
                    {rows.length > 0 && <span className="mt-1 block text-[10px] leading-4 text-muted">{rows.length} {rows.length === 1 ? 'record' : 'records'}</span>}
                    {rows.length > 0 && <span className="block text-[10px] leading-4 text-muted">{formatMinutes(rows.reduce((total, row) => total + (row.workingMinutes ?? 0), 0))}</span>}
                  </button>
                );
              })}
            </div>
            {monthlyRows.length > 0 && (
              <DataTable<AttendanceRecord>
                rows={monthlyRows}
                rowKey={(row) => row.id}
                loading={monthRecords.isFetching}
                columns={[
                  { key: 'date', header: 'Date', render: (row) => formatDate(row.attendanceDate) },
                  { key: 'employee', header: 'Employee', render: (row) => <>{row.employeeCode}<span className="block text-xs text-muted">{row.employeeName}</span></> },
                  { key: 'sessions', header: 'Sessions', align: 'right', render: (row) => `${row.checkInCount} in / ${row.checkOutCount} out` },
                  { key: 'breaks', header: 'Breaks', align: 'right', render: (row) => `${row.breakMinutes} min` },
                  { key: 'status', header: 'Status', render: (row) => <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge> },
                  { key: 'working', header: 'Working time', align: 'right', render: (row) => formatMinutes(row.workingMinutes) },
                ]}
              />
            )}
          </>
        )}
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
                <Select id="record-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as AttendanceForm['status'] })}>
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

function SessionDetails({ row }: { row: AttendanceRecord }) {
  return <DialogDetails row={row} />;
}

function DialogDetails({ row }: { row: AttendanceRecord }) {
  const [open, setOpen] = useState(false);
  const { can } = useAuth();
  const hasConsentedLocations = row.sessions.some((session) => session.locationConsent);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Details</Button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} width="lg" title={`Attendance sessions — ${row.employeeCode}`}>
          <div className="space-y-3">
            {row.sessions.map((session, index) => (
              <Card key={session.id} title={`Session ${index + 1}`} actions={session.forcedCheckout ? <Badge tone="warning">Forced checkout</Badge> : undefined}>
                <p className="text-sm">Check-in {formatDateTime(session.startedAt)} · Check-out {session.endedAt ? formatDateTime(session.endedAt) : 'Active'}</p>
                {session.breaks.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-sm text-muted">
                    {session.breaks.map((br) => <li key={br.id}>{formatDateTime(br.startedAt)} – {br.endedAt ? formatDateTime(br.endedAt) : 'Active'} · {br.durationMinutes} min</li>)}
                  </ul>
                )}
                {can('attendance.location.view') && session.locationConsent && (
                  <LocationHistoryButton sessionId={session.id} icon={<MapPin className="h-4 w-4" />} />
                )}
                {session.forcedCheckout && <p className="mt-2 text-xs text-warning">Session was closed after its heartbeat stopped. Employee reactivation requests appear below.</p>}
              </Card>
            ))}
            {hasConsentedLocations && !can('attendance.location.view') && <p className="text-xs text-muted">Location history was recorded with employee consent. You do not have permission to view it.</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}

function LocationHistoryButton({ sessionId, icon }: { sessionId: string; icon: ReactNode }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['attendance-location-history', sessionId], queryFn: () => get<{ id: string; capturedAt: string; latitude: string; longitude: string; accuracyMeters: string | null }[]>(`/attendance-sessions/${sessionId}/locations`), enabled: open });
  return (
    <>
      <Button className="mt-3" size="sm" variant="ghost" icon={icon} onClick={() => setOpen(true)}>View consented locations</Button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} title="Consented location history" width="lg">
          {q.isLoading ? <Spinner /> : q.error ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.data?.length ? (
            <DataTable
              rows={q.data}
              rowKey={(point) => point.id}
              columns={[
                { key: 'at', header: 'Recorded', render: (point) => formatDateTime(point.capturedAt) },
                { key: 'coordinates', header: 'Coordinates', render: (point) => `${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}` },
                { key: 'accuracy', header: 'Accuracy', align: 'right', render: (point) => point.accuracyMeters ? `${Math.round(Number(point.accuracyMeters))} m` : '—' },
                { key: 'map', header: '', render: (point) => <a href={`https://maps.google.com/?q=${point.latitude},${point.longitude}`} target="_blank" rel="noreferrer" className="text-cobalt underline">Map</a> },
              ]}
            />
          ) : <EmptyState title="No location points recorded" />}
        </Dialog>
      )}
    </>
  );
}

interface AccessRequest {
  id: string;
  employeeId: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  employee: { employeeCode: string; fullName: string };
}

function AttendanceAccessRequests() {
  const qc = useQueryClient();
  const toast = useToast();
  const requests = useQuery({ queryKey: ['attendance-access-requests'], queryFn: () => get<AccessRequest[]>('/attendance-access-requests') });
  const review = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) => post(`/attendance-access-requests/${id}/review`, { decision }),
    onSuccess: (_data, variables) => {
      toast.success(variables.decision === 'APPROVED' ? 'Attendance access restored.' : 'Attendance request declined.');
      void qc.invalidateQueries({ queryKey: ['attendance-access-requests'] });
      void qc.invalidateQueries({ queryKey: ['attendance-records'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Card title="Attendance access requests" padded={false}>
      {requests.isLoading ? <Spinner /> : requests.error ? <ErrorState message={errorMessage(requests.error)} onRetry={() => requests.refetch()} /> : (
        <DataTable<AccessRequest>
          rows={requests.data ?? []}
          rowKey={(request) => request.id}
          empty={<EmptyState title="No pending requests" />}
          columns={[
            { key: 'employee', header: 'Employee', render: (request) => <>{request.employee.employeeCode}<span className="block text-xs text-muted">{request.employee.fullName}</span></> },
            { key: 'reason', header: 'Reason', render: (request) => request.reason },
            { key: 'submitted', header: 'Submitted', render: (request) => formatDateTime(request.createdAt) },
            { key: 'actions', header: '', align: 'right', render: (request) => (
              <div className="flex justify-end gap-2">
                <Button size="sm" loading={review.isPending && review.variables?.id === request.id} disabled={review.isPending} onClick={() => review.mutate({ id: request.id, decision: 'APPROVED' })}>Approve</Button>
                <Button size="sm" variant="danger" disabled={review.isPending} onClick={() => review.mutate({ id: request.id, decision: 'REJECTED' })}>Reject</Button>
              </div>
            ) },
          ]}
        />
      )}
    </Card>
  );
}
