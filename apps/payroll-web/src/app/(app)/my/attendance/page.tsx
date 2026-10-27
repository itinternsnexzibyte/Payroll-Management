'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Play, Square, Timer } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, DataTable, EmptyState, Field, Input, PageHeader, RequirePermission, Spinner, errorMessage, formatDate, formatDateTime, get, post, put, useToast } from '@nexzi/ui';

interface WorkBreak {
  id: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
}

interface WorkSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  forcedCheckout: boolean;
  locationConsent: boolean;
  breaks: WorkBreak[];
}

interface Day {
  id: string;
  attendanceDate: string;
  status: string;
  loginTime: string | null;
  logoutTime: string | null;
  workingMinutes: number | null;
  breakMinutes: number;
  checkInCount: number;
  checkOutCount: number;
  sessions: WorkSession[];
}

interface AttendanceState {
  attendanceEnabled: boolean;
  pendingRequest: { id: string; reason: string; createdAt: string } | null;
  day: Day | null;
}

interface LocationPoint {
  id: string;
  capturedAt: string;
  latitude: string | number;
  longitude: string | number;
  accuracyMeters: string | number | null;
  distanceFromStartMeters: string | number;
  distanceFromPreviousMeters: string | number;
}

const minutesLabel = (minutes: number | null) => minutes === null ? '—' : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export default function MyAttendancePage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [locationConsent, setLocationConsent] = useState(false);
  const [reason, setReason] = useState('');
  const [locationError, setLocationError] = useState('');
  const [heartbeatError, setHeartbeatError] = useState('');
  const [locationDate, setLocationDate] = useState<string | null>(null);
  const state = useQuery({
    queryKey: ['my-attendance'],
    queryFn: () => get<AttendanceState>('/attendance-sessions/me'),
    refetchInterval: 15_000,
  });
  const history = useQuery({
    queryKey: ['my-attendance-history'],
    queryFn: () => get<Day[]>('/attendance-sessions/me/history'),
  });
  const active = state.data?.day?.sessions.find((session) => !session.endedAt) ?? null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['my-attendance'] });
    void qc.invalidateQueries({ queryKey: ['my-attendance-history'] });
  };
  const action = useMutation({
    mutationFn: async ({ path, method, body }: { path: string; method: 'POST' | 'PUT'; body?: unknown }) =>
      method === 'PUT' ? put(path, body ?? {}) : post(path, body),
    onSuccess: (_data, variables) => {
      setHeartbeatError('');
      refresh();
      if (variables.path.endsWith('check-in')) toast.success('You are checked in.');
      else if (variables.path.endsWith('check-out')) toast.success('You are checked out.');
      else if (variables.path.endsWith('break-start')) toast.success('Break started.');
      else if (variables.path.endsWith('break-end')) toast.success('Break ended.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const access = useMutation({
    mutationFn: () => post('/attendance-sessions/access-request', { reason }),
    onSuccess: () => {
      setReason('');
      toast.success('Your reactivation request was sent for administrator review.');
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      void post<{ active: boolean }>('/attendance-sessions/heartbeat')
        .then((result) => {
          setHeartbeatError('');
          if (!result.active) refresh();
        })
        .catch((error: unknown) => setHeartbeatError(errorMessage(error)));
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [active?.id, qc]);

  useEffect(() => {
    if (!active?.locationConsent) return;
    let stopped = false;
    const sendLocation = () => {
      if (!navigator.geolocation) {
        setLocationError('This browser does not support location capture.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (stopped) return;
          setLocationError('');
          void post('/attendance-sessions/location', {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          }).catch((error: unknown) => setLocationError(errorMessage(error)));
        },
        (error) => {
          if (!stopped) setLocationError(`Location was not recorded: ${error.message}`);
        },
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 },
      );
    };
    sendLocation();
    const timer = window.setInterval(sendLocation, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [active?.id, active?.locationConsent]);

  const locations = useQuery({
    queryKey: ['my-attendance-locations', locationDate],
    queryFn: () => get<LocationPoint[]>(`/attendance-sessions/me/locations?date=${encodeURIComponent(locationDate ?? '')}`),
    enabled: Boolean(locationDate),
  });
  const day = state.data?.day;
  const onBreak = Boolean(active?.breaks.some((item) => !item.endedAt));

  return (
    <RequirePermission permission="self.service">
      <PageHeader title="My attendance" description="Check in and out, manage breaks, and review your recorded work sessions." breadcrumbs={[{ label: 'Employee dashboard', href: '/my' }, { label: 'My attendance' }]} />
      {state.isLoading ? <Spinner /> : state.error ? <Alert tone="danger">{errorMessage(state.error)}</Alert> : (
        <div className="space-y-5">
          {heartbeatError && <Alert tone="warning" title="Connection issue">{heartbeatError} Keep this page open and connected. If the session is automatically checked out, you can request reactivation below.</Alert>}
          {state.data!.attendanceEnabled ? (
            <Card title="Today’s session" actions={<Badge tone={active ? onBreak ? 'warning' : 'success' : 'neutral'}>{active ? onBreak ? 'On break' : 'Checked in' : 'Not checked in'}</Badge>}>
              <div className="flex flex-wrap items-center gap-3">
                {!active ? (
                  <>
                    <Checkbox label="Share my location during this session (optional)" checked={locationConsent} onChange={(event) => setLocationConsent(event.target.checked)} />
                    <Button icon={<Play className="h-4 w-4" />} disabled={action.isPending} onClick={() => action.mutate({ path: '/attendance-sessions/check-in', method: 'POST', body: { locationConsent } })}>Check in</Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" icon={<Timer className="h-4 w-4" />} disabled={action.isPending} onClick={() => action.mutate({ path: `/attendance-sessions/break-${onBreak ? 'end' : 'start'}`, method: 'POST' })}>{onBreak ? 'End break' : 'Start break'}</Button>
                    <Button variant="danger" icon={<Square className="h-4 w-4" />} disabled={action.isPending} onClick={() => action.mutate({ path: '/attendance-sessions/check-out', method: 'POST' })}>Check out</Button>
                    <Checkbox label="Share my location during this session" checked={active.locationConsent} onChange={(event) => action.mutate({ path: '/attendance-sessions/location-consent', method: 'PUT', body: { enabled: event.target.checked } })} />
                  </>
                )}
              </div>
              <p className="mt-3 text-xs text-muted">Location is optional. When enabled, this page records a location point every 30 seconds while open. You can switch it off at any time; authorized attendance administrators can view the recorded history. Location is never used to calculate payroll.</p>
              {locationError && <Alert tone="warning" className="mt-3">{locationError}</Alert>}
              {day && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div><p className="text-xs text-muted">First check-in</p><p className="font-medium">{day.loginTime ?? '—'}</p></div>
                  <div><p className="text-xs text-muted">Last check-out</p><p className="font-medium">{day.logoutTime ?? (active ? 'In progress' : '—')}</p></div>
                  <div><p className="text-xs text-muted">Working time</p><p className="font-medium">{minutesLabel(day.workingMinutes)}</p></div>
                  <div><p className="text-xs text-muted">Break time</p><p className="font-medium">{minutesLabel(day.breakMinutes)}</p></div>
                </div>
              )}
            </Card>
          ) : (
            <Card title="Attendance access is paused">
              <Alert tone="warning" className="mb-3">
                {state.data!.pendingRequest ? 'Your reason is waiting for administrator review.' : 'An administrator must approve a reason before attendance check-in is re-enabled.'}
              </Alert>
              {state.data!.pendingRequest ? (
                <p className="text-sm text-muted">Request submitted {formatDateTime(state.data!.pendingRequest.createdAt)}. You will receive an in-app notification when it is reviewed.</p>
              ) : (
                <div className="space-y-3">
                  <Field label="Why do you need attendance access restored?" htmlFor="attendance-access-reason">
                    <Input id="attendance-access-reason" value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} placeholder="Explain what caused the session to disconnect" />
                  </Field>
                  <Button loading={access.isPending} disabled={reason.trim().length < 10} onClick={() => access.mutate()}>Request reactivation</Button>
                </div>
              )}
            </Card>
          )}

          <Card title="Recent attendance">
            {history.isLoading ? <Spinner /> : history.error ? <Alert tone="danger">{errorMessage(history.error)}</Alert> : (
              <DataTable<Day>
                rows={history.data ?? []}
                rowKey={(row) => row.id}
                empty={<EmptyState icon={<Timer className="h-5 w-5" />} title="No attendance history yet" />}
                columns={[
                  { key: 'date', header: 'Date', render: (row) => formatDate(row.attendanceDate) },
                  { key: 'status', header: 'Status', render: (row) => row.sessions.some((session) => session.forcedCheckout) ? <Badge tone="warning">Forced checkout</Badge> : <Badge tone="neutral">{row.status.replaceAll('_', ' ')}</Badge> },
                  { key: 'checkins', header: 'Sessions', align: 'right', render: (row) => row.checkInCount },
                  { key: 'work', header: 'Working time', align: 'right', render: (row) => minutesLabel(row.workingMinutes) },
                  { key: 'break', header: 'Break time', align: 'right', render: (row) => minutesLabel(row.breakMinutes) },
                  { key: 'location', header: '', align: 'right', render: (row) => row.sessions.some((session) => session.locationConsent) ? <Button size="sm" variant="ghost" icon={<MapPin className="h-4 w-4" />} onClick={() => setLocationDate(row.attendanceDate)}>My location history</Button> : null },
                ]}
              />
            )}
          </Card>
          {locationDate && <LocationHistory date={locationDate} points={locations.data ?? []} loading={locations.isLoading} error={locations.error ? errorMessage(locations.error) : null} onClose={() => setLocationDate(null)} />}
        </div>
      )}
    </RequirePermission>
  );
}

function LocationHistory({ date, points, loading, error, onClose }: { date: string; points: LocationPoint[]; loading: boolean; error: string | null; onClose: () => void }) {
  return (
    <Card title={`My consented location history — ${formatDate(date)}`} actions={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>}>
      <p className="mb-3 text-xs text-muted">This history is visible to you and authorized attendance administrators. Location points stop when consent is switched off or the session ends.</p>
      {loading ? <Spinner /> : error ? <Alert tone="danger">{error}</Alert> : (
        <DataTable<LocationPoint>
          rows={points}
          rowKey={(point) => point.id}
          empty={<EmptyState title="No location points recorded" />}
          columns={[
            { key: 'time', header: 'Recorded', render: (point) => formatDateTime(point.capturedAt) },
            { key: 'coords', header: 'Coordinates', render: (point) => `${Number(point.latitude).toFixed(6)}, ${Number(point.longitude).toFixed(6)}` },
            { key: 'accuracy', header: 'Accuracy', align: 'right', render: (point) => point.accuracyMeters === null ? '—' : `${Math.round(Number(point.accuracyMeters))} m` },
            { key: 'map', header: '', align: 'right', render: (point) => <a className="text-sm font-medium text-cobalt underline" href={`https://maps.google.com/?q=${point.latitude},${point.longitude}`} target="_blank" rel="noreferrer">Open map</a> },
          ]}
        />
      )}
    </Card>
  );
}
