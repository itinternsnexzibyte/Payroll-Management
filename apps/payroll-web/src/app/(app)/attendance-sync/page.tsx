'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, RadioTower, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
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
  formatDateTime,
  get,
  post,
  put,
  useAuth,
  useToast,
} from '@nexzi/ui';
import { useInputDefinitions } from '@/lib/hooks';

interface SyncSettings {
  enabled: boolean;
  autoApply: boolean;
  fieldMap: { source: string; inputKey: string }[];
}
interface Key {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
interface Batch {
  id: string;
  externalId: string | null;
  source: string | null;
  period: string;
  status: 'RECEIVED' | 'APPLIED' | 'PARTIAL' | 'FAILED';
  recordCount: number;
  appliedCount: number;
  errors: { employeeCode?: string; field?: string; message: string }[];
  receivedAt: string;
  appliedAt: string | null;
}
interface BatchDetail {
  batch: Batch;
  run: { id: string; status: string } | null;
  preview: { writes: { employee: string; inputKey: string; value: string }[]; problems: { employeeCode?: string; message: string }[]; unmappedFields: string[] };
}
const STATUS: Record<Batch['status'], { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  RECEIVED: { label: 'Waiting to apply', tone: 'neutral' },
  APPLIED: { label: 'Applied', tone: 'success' },
  PARTIAL: { label: 'Applied with problems', tone: 'warning' },
  FAILED: { label: 'Not applied', tone: 'danger' },
};

export default function AttendanceSyncPage() {
  return (
    <RequirePermission permission="integrations.manage">
      <PageHeader
        title="Attendance sync"
        description="Your attendance application sends each month's attendance here over a secure API key. Received figures go into the payroll month's input columns, through the same checks as typing them in."
        breadcrumbs={[{ label: 'Payroll settings', href: '/settings' }, { label: 'Attendance sync' }]}
      />
      <Workspace />
    </RequirePermission>
  );
}

function Workspace() {
  const q = useQuery({ queryKey: ['attendance-sync'], queryFn: () => get<{ settings: SyncSettings; keys: Key[]; batches: Batch[] }>('/attendance-sync') });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  return (
    <div className="space-y-6">
      <SettingsCard initial={q.data.settings} />
      <Keys keys={q.data.keys} />
      <Batches batches={q.data.batches} />
      <ApiHelp />
    </div>
  );
}

function SettingsCard({ initial }: { initial: SyncSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const inputs = useInputDefinitions();
  const [s, setS] = useState(initial);
  useEffect(() => setS(initial), [initial]);
  const save = useMutation({
    mutationFn: () => put('/attendance-sync/settings', { ...s, fieldMap: s.fieldMap.map((f) => ({ source: f.source.trim(), inputKey: f.inputKey })) }),
    onSuccess: () => {
      toast.success('Attendance sync settings saved.');
      qc.invalidateQueries({ queryKey: ['attendance-sync'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setRow = (i: number, patch: Partial<SyncSettings['fieldMap'][number]>) => setS({ ...s, fieldMap: s.fieldMap.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const valid = s.fieldMap.every((f) => f.source.trim() && f.inputKey);
  return (
    <Card title="Connection" actions={<Badge tone={s.enabled ? 'success' : 'neutral'}>{s.enabled ? 'Receiving' : 'Off'}</Badge>}>
      <div className="flex flex-wrap gap-6">
        <Checkbox label="Accept attendance from the attendance application" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        <Checkbox label="Apply received attendance straight away (Draft or Calculated payroll only)" checked={s.autoApply} onChange={(e) => setS({ ...s, autoApply: e.target.checked })} />
      </div>
      <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">Field mapping</h3>
      <p className="mb-3 text-sm text-muted">Use the field names exactly as the attendance application sends them. Fields that are not mapped are kept with the batch but not used.</p>
      <div className="space-y-2">
        {s.fieldMap.map((f, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Field label="Attendance field" htmlFor={`fm-s-${i}`} className="w-60"><Input id={`fm-s-${i}`} value={f.source} placeholder="e.g. present_days" onChange={(e) => setRow(i, { source: e.target.value })} maxLength={60} /></Field>
            <Field label="Payroll input column" htmlFor={`fm-k-${i}`} className="w-64">
              <Select id={`fm-k-${i}`} value={f.inputKey} onChange={(e) => setRow(i, { inputKey: e.target.value })}>
                <option value="">Choose…</option>
                {(inputs.data ?? []).filter((d) => d.active).map((d) => (<option key={d.key} value={d.key}>{d.label} ({d.key})</option>))}
              </Select>
            </Field>
            <Button size="sm" variant="ghost" aria-label="Remove mapping" icon={<Trash2 className="h-4 w-4" />} onClick={() => setS({ ...s, fieldMap: s.fieldMap.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setS({ ...s, fieldMap: [...s.fieldMap, { source: '', inputKey: '' }] })}>Map a field</Button>
      </div>
      <div className="mt-5 flex justify-end">
        <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>Save connection settings</Button>
      </div>
    </Card>
  );
}

function Keys({ keys }: { keys: Key[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('Attendance application');
  const [shown, setShown] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Key | null>(null);
  const create = useMutation({
    mutationFn: () => post<{ key: string }>('/attendance-sync/keys', { name: name.trim() }),
    onSuccess: (d) => {
      setNaming(false);
      setShown(d.key);
      qc.invalidateQueries({ queryKey: ['attendance-sync'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (k: Key) => post(`/attendance-sync/keys/${k.id}/revoke`),
    onSuccess: () => {
      toast.success('Key revoked. The attendance application can no longer send data with it.');
      setRevoking(null);
      qc.invalidateQueries({ queryKey: ['attendance-sync'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card title="API keys" padded={false} actions={<Button size="sm" icon={<KeyRound className="h-4 w-4" />} onClick={() => setNaming(true)}>New API key</Button>}>
      <DataTable<Key>
        rows={keys}
        rowKey={(k) => k.id}
        empty={<EmptyState icon={<KeyRound className="h-6 w-6" />} title="No API keys" hint="Create one and give it to whoever configures the attendance application." />}
        columns={[
          { key: 'n', header: 'Name', render: (k) => k.name },
          { key: 'p', header: 'Key starts with', render: (k) => <span className="font-mono text-xs">{k.prefix}…</span> },
          { key: 'c', header: 'Created', render: (k) => formatDateTime(k.createdAt) },
          { key: 'u', header: 'Last used', render: (k) => (k.lastUsedAt ? formatDateTime(k.lastUsedAt) : 'Never') },
          { key: 's', header: 'Status', render: (k) => (k.revokedAt ? <Badge tone="neutral">Revoked</Badge> : <Badge tone="success">Active</Badge>) },
          { key: 'x', header: <span className="sr-only">Revoke</span>, align: 'right', render: (k) => (!k.revokedAt ? <Button size="sm" variant="ghost" onClick={() => setRevoking(k)}>Revoke</Button> : null) },
        ]}
      />
      {naming && (
        <Dialog open onClose={() => setNaming(false)} title="New API key" footer={<><Button variant="ghost" onClick={() => setNaming(false)}>Cancel</Button><Button loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>Create key</Button></>}>
          <Field label="Name (who or what uses it)" htmlFor="key-name"><Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        </Dialog>
      )}
      {shown && (
        <Dialog open onClose={() => setShown(null)} title="Copy the API key now" footer={<Button onClick={() => setShown(null)}>I have stored it safely</Button>}>
          <Alert tone="warning" className="mb-3">This is the only time the key is shown. Only a fingerprint of it is stored, so it cannot be recovered — if it is lost, revoke it and create another.</Alert>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface p-3">
            <code className="flex-1 break-all text-xs">{shown}</code>
            <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => navigator.clipboard.writeText(shown).then(() => toast.success('Copied.'), () => toast.error('Copy failed — select the key and copy it.'))}>Copy</Button>
          </div>
        </Dialog>
      )}
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking)}
        loading={revoke.isPending}
        title="Revoke API key"
        message={revoking ? `"${revoking.name}" stops working immediately.` : ''}
        confirmLabel="Revoke"
        tone="danger"
      />
    </Card>
  );
}

function Batches({ batches }: { batches: Batch[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card title="Received attendance" padded={false}>
      <DataTable<Batch>
        rows={batches}
        rowKey={(b) => b.id}
        empty={<EmptyState icon={<RadioTower className="h-6 w-6" />} title="Nothing received yet" />}
        columns={[
          { key: 'r', header: 'Received', render: (b) => formatDateTime(b.receivedAt) },
          { key: 'p', header: 'Payroll month', render: (b) => b.period },
          { key: 'f', header: 'From', render: (b) => (<>{b.source ?? '—'}{b.externalId && <span className="block text-xs text-muted">batch {b.externalId}</span>}</>) },
          { key: 'n', header: 'Employees', align: 'right', render: (b) => b.recordCount },
          { key: 'a', header: 'Cells written', align: 'right', render: (b) => b.appliedCount },
          { key: 's', header: 'Status', render: (b) => (<><Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>{b.errors[0] && <span className="block max-w-xs text-xs text-muted">{b.errors[0].employeeCode ? `${b.errors[0].employeeCode}: ` : ''}{b.errors[0].message}{b.errors.length > 1 ? ` (+${b.errors.length - 1} more)` : ''}</span>}</>) },
          { key: 'x', header: <span className="sr-only">Open</span>, align: 'right', render: (b) => <Button size="sm" variant="secondary" onClick={() => setOpen(b.id)}>Review</Button> },
        ]}
      />
      {open && <BatchDialog id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function BatchDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['attendance-batch', id], queryFn: () => get<BatchDetail>(`/attendance-sync/batches/${id}`) });
  const apply = useMutation({
    mutationFn: () => post<{ status: string; saved: number }>(`/attendance-sync/batches/${id}/apply`),
    onSuccess: (d) => {
      toast.success(`${d.saved} cell(s) written to payroll inputs.`);
      qc.invalidateQueries({ queryKey: ['attendance-sync'] });
      qc.invalidateQueries({ queryKey: ['attendance-batch', id] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const d = q.data;
  const canApply = d && d.batch.status !== 'APPLIED' && d.run && ['DRAFT', 'CALCULATED'].includes(d.run.status) && can('payroll.input');
  return (
    <Dialog
      open
      onClose={onClose}
      width="lg"
      title={d ? `Attendance for ${d.batch.period}` : 'Attendance batch'}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={apply.isPending} disabled={!canApply} onClick={() => apply.mutate()}>Apply to payroll</Button></>}
    >
      {q.isLoading || !d ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          {!d.run ? <Alert tone="warning">There is no payroll run for {d.batch.period} yet. Create it, then apply this batch.</Alert> : !['DRAFT', 'CALCULATED'].includes(d.run.status) && <Alert tone="warning">The payroll month is {d.run.status.replace('_', ' ').toLowerCase()}, so attendance cannot be applied.</Alert>}
          {!can('payroll.input') && <Alert tone="info">Applying needs the Enter monthly inputs permission.</Alert>}
          {d.preview.problems.length > 0 && <Alert tone="warning">{d.preview.problems.map((p) => `${p.employeeCode}: ${p.message}`).join(' ')}</Alert>}
          {d.preview.unmappedFields.length > 0 && <p className="text-xs text-muted">Not mapped (ignored): {d.preview.unmappedFields.join(', ')}</p>}
          <p className="text-sm text-muted">What applying writes (a value replaces what is in that cell):</p>
          <DataTable
            dense
            rows={d.preview.writes}
            rowKey={(w) => `${w.employee}-${w.inputKey}`}
            empty={<EmptyState title="Nothing to write" hint="Check the field mapping." />}
            columns={[
              { key: 'e', header: 'Employee', render: (w) => w.employee },
              { key: 'k', header: 'Input column', render: (w) => w.inputKey },
              { key: 'v', header: 'Value', align: 'right', render: (w) => w.value },
            ]}
          />
          {d.batch.errors.length > 0 && d.batch.status !== 'RECEIVED' && (
            <Alert tone="warning" title="Problems when last applied">{d.batch.errors.map((e) => `${e.employeeCode ?? ''}${e.field ? ` ${e.field}` : ''}: ${e.message}`).join(' · ')}</Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}

function ApiHelp() {
  const origin = typeof window !== 'undefined' ? window.location.origin.replace(':3001', ':4001') : '';
  const sample = `POST ${origin}/integrations/attendance
Authorization: Bearer <API key>
Content-Type: application/json

{
  "batchId": "2026-10-run-1",
  "year": 2026,
  "month": 10,
  "records": [
    { "employeeCode": "E-001", "values": { "present_days": 22, "lop_days": 1 } }
  ]
}`;
  return (
    <Card title="For the attendance application's developers">
      <p className="mb-3 text-sm text-muted">
        Send one request per payroll month (up to 5,000 employees). Repeating a <code>batchId</code> is safe: it is accepted once. Responses: 202 received, 401 bad or revoked key, 409 sync switched off, 400 invalid body. Full schema in the API documentation at <code>/docs</code> (Integrations).
      </p>
      <pre className="overflow-x-auto rounded-lg bg-ink p-4 text-xs text-white">{sample}</pre>
    </Card>
  );
}
