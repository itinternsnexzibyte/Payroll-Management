'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Pencil, Plus, Trash2 } from 'lucide-react';
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
  Textarea,
  del,
  errorMessage,
  formatDate,
  get,
  post,
  put,
  useAuth,
  useToast,
} from '@nexzi/ui';
import { useEmployeeOptions } from '@/lib/hooks';

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  eventDate: string;
  eventTime: string | null;
  color: string;
  employee: { id: string; employeeCode: string; fullName: string } | null;
}
interface EventForm {
  title: string;
  description: string;
  eventDate: string;
  eventTime: string;
  color: string;
  employeeId: string;
}

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const monthRange = (dateValue: string | null) => {
  const match = dateValue && /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  let now = new Date();
  if (match) {
    const requested = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    if (requested.getFullYear() === Number(match[1]) && requested.getMonth() + 1 === Number(match[2]) && requested.getDate() === Number(match[3])) now = requested;
  }
  return {
    start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
    end: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`,
  };
};

export default function CalendarPage() {
  return (
    <RequirePermission permission="calendar.view">
      <PageHeader
        title="Calendar"
        description="View shared events and events assigned to your linked employee profile. Creating, editing, or cancelling an event sends in-app notifications."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Calendar' }]}
      />
      <CalendarWorkspace />
    </RequirePermission>
  );
}

function CalendarWorkspace() {
  const { can } = useAuth();
  const searchParams = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const range = monthRange(searchParams.get('date'));
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null);
  const events = useQuery({
    queryKey: ['calendar-events', range.start, range.end],
    queryFn: () => get<CalendarEvent[]>(`/calendar/events?${new URLSearchParams(range)}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['calendar-events'] });
  const remove = useMutation({
    mutationFn: (event: CalendarEvent) => del(`/calendar/events/${event.id}`),
    onSuccess: () => { toast.success('Event cancelled and affected employees notified.'); setDeleting(null); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (events.isLoading) return <Spinner />;
  if (events.error) return <ErrorState message={errorMessage(events.error)} onRetry={() => events.refetch()} />;
  return (
    <>
      <Card padded={false} title={`Events · ${range.start.slice(0, 7)}`} actions={can('calendar.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add event</Button>}>
        <DataTable<CalendarEvent>
          rows={events.data}
          rowKey={(event) => event.id}
          empty={<EmptyState icon={<CalendarRange className="h-6 w-6" />} title="No events this month" hint="Shared and employee-specific events will appear here." />}
          columns={[
            { key: 'date', header: 'Date', render: (event) => formatDate(event.eventDate) },
            { key: 'time', header: 'Time', render: (event) => event.eventTime ?? 'All day' },
            {
              key: 'event',
              header: 'Event',
              render: (event) => <><span className="block font-medium">{event.title}</span>{event.description && <span className="whitespace-pre-wrap text-xs text-muted">{event.description}</span>}</>,
            },
            {
              key: 'audience',
              header: 'For',
              render: (event) => event.employee ? <><span className="block">{event.employee.employeeCode}</span><span className="text-xs text-muted">{event.employee.fullName}</span></> : <Badge tone="info">Everyone</Badge>,
            },
            { key: 'color', header: 'Color', render: (event) => <span className="inline-block h-4 w-4 rounded-full border border-line" style={{ backgroundColor: event.color }} aria-label={event.color} /> },
            ...(can('calendar.manage') ? [{
              key: 'actions',
              header: '',
              align: 'right' as const,
              render: (event: CalendarEvent) => <span className="flex justify-end gap-1"><Button size="sm" variant="ghost" aria-label={`Edit ${event.title}`} icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(event)} /><Button size="sm" variant="ghost" aria-label={`Cancel ${event.title}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(event)} /></span>,
            }] : []),
          ]}
        />
      </Card>
      {(creating || editing) && <EventDialog event={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={() => { setCreating(false); setEditing(null); refresh(); }} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        loading={remove.isPending}
        title="Cancel calendar event"
        message={deleting ? `Cancel “${deleting.title}” on ${formatDate(deleting.eventDate)}? Affected employees will be notified.` : ''}
        confirmLabel="Cancel event"
        tone="danger"
      />
    </>
  );
}

function EventDialog({ event, onClose, onSaved }: { event: CalendarEvent | null; onClose: () => void; onSaved: () => void }) {
  const employees = useEmployeeOptions();
  const toast = useToast();
  const [form, setForm] = useState<EventForm>(() => ({
    title: event?.title ?? '',
    description: event?.description ?? '',
    eventDate: event?.eventDate ?? today(),
    eventTime: event?.eventTime ?? '',
    color: event?.color ?? '#f3c440',
    employeeId: event?.employee?.id ?? '',
  }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, title: form.title.trim(), description: form.description.trim() || null, eventTime: form.eventTime || null, employeeId: form.employeeId || null };
      return event ? put(`/calendar/events/${event.id}`, body) : post('/calendar/events', body);
    },
    onSuccess: onSaved,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open onClose={onClose} title={event ? 'Edit calendar event' : 'Add calendar event'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={form.title.trim().length < 2 || !form.eventDate} onClick={() => save.mutate()}>{event ? 'Save changes' : 'Create event'}</Button></>}>
      <div className="space-y-3">
        <Field label="Title" htmlFor="event-title" required><Input id="event-title" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Description"><Textarea rows={3} maxLength={10000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" htmlFor="event-date" required><Input id="event-date" type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} /></Field>
          <Field label="Time (optional)" htmlFor="event-time"><Input id="event-time" type="time" value={form.eventTime} onChange={(e) => setForm({ ...form, eventTime: e.target.value })} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Audience" htmlFor="event-employee"><Select id="event-employee" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}><option value="">Everyone</option>{employees.data?.items.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} · {employee.fullName}</option>)}</Select></Field>
          <Field label="Event color" htmlFor="event-color"><Input id="event-color" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-muted">Employees who can view this event receive an in-app notification when it is created, changed, or cancelled.</p>
      </div>
    </Dialog>
  );
}
