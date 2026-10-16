'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, Pencil, Plus, Unlock, UserPlus, X } from 'lucide-react';
import { ApiError, errorMessage, get, post, put, qs, type Page } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Select, StatusBadge } from '../components/primitives';
import { ConfirmDialog, Dialog, useToast } from '../components/feedback';
import { DataTable, EmptyState, PageHeader, Pagination, SearchInput, Toolbar, useListParams } from '../components/data';
import { RequirePermission } from './app-shell';
import { useAuth } from './auth';

interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  configurable: boolean;
  userCount: number;
  permissions: string[];
}
interface UserRow {
  id: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED' | 'PENDING';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  role: { id: string; code: string; name: string };
  employee?: { id: string; employeeCode: string; fullName: string } | null;
  engineerCode?: string | null;
  phone?: string | null;
  designation?: string | null;
}

export interface ProfileField {
  key: 'engineerCode' | 'phone' | 'designation';
  label: string;
  hint?: string;
}

const PW_HINT = 'Temporary password: at least 10 characters with upper- and lower-case letters and a digit. The user must change it at first sign-in.';
const strong = (p: string) => p.length >= 10 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p);

/** `employeeOptions` enables linking an account to an employee record (employee self-service). */
export function UsersAdmin({ profileFields = [], employeeOptions }: { profileFields?: ProfileField[]; employeeOptions?: { id: string; label: string }[] }) {
  const { user: me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useListParams({ sortBy: 'name', sortDir: 'asc', filters: { status: '' } });
  const q = useQuery({ queryKey: ['users', list.query], queryFn: () => get<Page<UserRow>>(`/users${qs(list.query)}`), placeholderData: (p) => p });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<Role[]>('/roles') });
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [rejecting, setRejecting] = useState<UserRow | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const pending = useQuery({ queryKey: ['users', 'pending-count'], queryFn: () => get<Page<UserRow>>('/users?status=PENDING&pageSize=1') });
  const pendingCount = pending.data?.total ?? 0;

  const decide = async (u: UserRow, action: 'approve' | 'reject', reason?: string) => {
    setDeciding(u.id);
    try {
      await post(`/users/${u.id}/${action}`, reason ? { reason } : {});
      toast.success(action === 'approve' ? `${u.name} can now sign in as ${u.role.name}.` : `${u.name}'s request was rejected.`);
      setRejecting(null);
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDeciding(null);
    }
  };

  const unlock = async (u: UserRow) => {
    try {
      await post(`/users/${u.id}/unlock`);
      toast.success('Account unlocked.');
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <RequirePermission permission="users.manage">
      <PageHeader
        title="Users"
        description="Create accounts, assign roles and disable access. Passwords are never shown or emailed by the system."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Users' }]}
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add user
          </Button>
        }
      />
      {pendingCount > 0 && list.filters.status !== 'PENDING' && (
        <div className="fx-enter mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-secondary/30 bg-mist/60 px-4 py-3 text-sm text-primary">
          <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">
            <strong>{pendingCount}</strong> account request{pendingCount === 1 ? '' : 's'} waiting for approval.
          </span>
          <Button size="sm" variant="secondary" onClick={() => list.setFilter('status', 'PENDING')}>
            Review requests
          </Button>
        </div>
      )}
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search name or email" label="Search users" />
          <Select className="w-40" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Pending approval</option>
            <option value="DISABLED">Disabled</option>
          </Select>
        </Toolbar>
        <DataTable<UserRow>
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error ? errorMessage(q.error) : null}
          rowKey={(u) => u.id}
          sortBy={list.sortBy}
          sortDir={list.sortDir}
          onSort={list.toggleSort}
          columns={[
            { key: 'name', header: 'Name', sortable: true, render: (u) => (<span><span className="font-medium">{u.name}</span>{u.id === me?.id && <Badge className="ml-2" tone="brand">You</Badge>}<span className="block text-xs text-muted">{u.email}</span></span>) },
            { key: 'role', header: 'Role', render: (u) => (<span>{u.role.name}{u.employee && <span className="block text-xs text-muted">Employee {u.employee.employeeCode}</span>}</span>) },
            ...profileFields.filter((f) => f.key === 'engineerCode').map((f) => ({ key: f.key, header: f.label, render: (u: UserRow) => u[f.key] ?? '—' })),
            {
              key: 'status',
              header: 'Status',
              render: (u) => (
                <span className="flex flex-wrap gap-1">
                  {u.status === 'PENDING' ? <Badge tone="warning">Awaiting approval</Badge> : <StatusBadge status={u.status} />}
                  {u.mustChangePassword && <Badge tone="warning">Must change password</Badge>}
                  {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="danger">Locked</Badge>}
                </span>
              ),
            },
            { key: 'lastLoginAt', header: 'Last sign-in', sortable: true, render: (u) => formatDateTime(u.lastLoginAt) },
            {
              key: 'a',
              header: '',
              align: 'right',
              render: (u) => (
                <span className="inline-flex gap-1">
                  {u.status === 'PENDING' && (
                    <>
                      <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} loading={deciding === u.id} onClick={() => decide(u, 'approve')}>
                        Approve
                      </Button>
                      <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5" />} disabled={deciding === u.id} onClick={() => setRejecting(u)}>
                        Reject
                      </Button>
                    </>
                  )}
                  {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                    <Button size="sm" variant="ghost" icon={<Unlock className="h-3.5 w-3.5" />} onClick={() => unlock(u)}>
                      Unlock
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setResetting(u)}>
                    Reset password
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(u)}>
                    Edit
                  </Button>
                </span>
              ),
            },
          ]}
        />
        {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>
      <UserDialog editing={editing} onClose={() => setEditing(null)} roles={roles.data ?? []} profileFields={profileFields} isSelf={editing !== 'new' && editing?.id === me?.id} employeeOptions={employeeOptions} />
      <ResetDialog user={resetting} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => rejecting && decide(rejecting, 'reject', reason)}
        loading={!!rejecting && deciding === rejecting.id}
        title="Reject account request"
        message={rejecting ? `${rejecting.name} (${rejecting.email}) asked for a ${rejecting.role.name} account. Rejecting disables the account; it is kept for the audit trail.` : ''}
        confirmLabel="Reject request"
        tone="danger"
        reason={{ label: 'Reason (recorded in the audit log)', minLength: 3 }}
      />
    </RequirePermission>
  );
}

function UserDialog({ editing, onClose, roles, profileFields, isSelf, employeeOptions }: { editing: UserRow | 'new' | null; onClose: () => void; roles: Role[]; profileFields: ProfileField[]; isSelf: boolean; employeeOptions?: { id: string; label: string }[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ email: '', name: '', roleId: '', status: 'ACTIVE', temporaryPassword: '', engineerCode: '', phone: '', designation: '', employeeId: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!editing) return;
    const u = editing === 'new' ? null : editing;
    setErrors({});
    setF({ email: u?.email ?? '', name: u?.name ?? '', roleId: u?.role.id ?? roles.find((r) => r.code !== 'ADMIN' && r.enabled)?.id ?? '', status: u?.status ?? 'ACTIVE', temporaryPassword: '', engineerCode: u?.engineerCode ?? '', phone: u?.phone ?? '', designation: u?.designation ?? '', employeeId: u?.employee?.id ?? '' });
  }, [editing, roles]);
  if (!editing) return null;
  const isNew = editing === 'new';
  const save = async () => {
    const e: Record<string, string> = {};
    if (isNew && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Enter a valid email.';
    if (f.name.trim().length < 2) e.name = 'Enter the name.';
    if (!f.roleId) e.roleId = 'Choose a role.';
    if (isNew && !strong(f.temporaryPassword)) e.temporaryPassword = PW_HINT;
    setErrors(e);
    if (Object.keys(e).length) return;
    const profile = Object.fromEntries(profileFields.map((p) => [p.key, f[p.key].trim() || null]));
    setSaving(true);
    try {
      const link = employeeOptions ? { employeeId: f.employeeId || null } : {};
      if (isNew) {
        const created = await post<{ id: string }>('/users', { email: f.email.trim(), name: f.name.trim(), roleId: f.roleId, temporaryPassword: f.temporaryPassword, ...profile });
        if (employeeOptions && f.employeeId) await put(`/users/${created.id}`, link);
      } else await put(`/users/${editing.id}`, { name: f.name.trim(), ...(isSelf ? {} : { roleId: f.roleId, status: f.status }), ...profile, ...link });
      await qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(isNew ? 'User created. Share the temporary password through a secure channel.' : 'User updated.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldMap());
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Add user' : `Edit ${f.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="u-email" required error={errors.email} className="sm:col-span-2">
          <Input id="u-email" type="email" value={f.email} readOnly={!isNew} onChange={(e) => setF({ ...f, email: e.target.value })} invalid={!!errors.email} />
        </Field>
        <Field label="Full name" htmlFor="u-name" required error={errors.name}>
          <Input id="u-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!errors.name} />
        </Field>
        <Field label="Role" htmlFor="u-role" required error={errors.roleId} locked={isSelf ? 'You cannot change your own role.' : undefined}>
          <Select id="u-role" value={f.roleId} disabled={isSelf} onChange={(e) => setF({ ...f, roleId: e.target.value })}>
            {roles.map((r) => (
              <option key={r.id} value={r.id} disabled={!r.enabled}>
                {r.name}
                {!r.enabled ? ' (not enabled)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        {employeeOptions && (
          <Field label="Linked employee" htmlFor="u-emp" error={errors.employeeId} hint="For employee self-service: the person sees only this employee's payslips and leave.">
            <Select id="u-emp" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
              <option value="">Not linked</option>
              {employeeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {profileFields.map((p) => (
          <Field key={p.key} label={p.label} htmlFor={`u-${p.key}`} hint={p.hint} error={errors[p.key]}>
            <Input id={`u-${p.key}`} value={f[p.key]} onChange={(e) => setF({ ...f, [p.key]: e.target.value })} />
          </Field>
        ))}
        {!isNew && !isSelf && (
          <Field label="Status" htmlFor="u-status">
            <Select id="u-status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled (signs out immediately)</option>
            </Select>
          </Field>
        )}
        {isNew && (
          <Field label="Temporary password" htmlFor="u-pw" required error={errors.temporaryPassword} hint={PW_HINT} className="sm:col-span-2">
            <Input id="u-pw" type="password" autoComplete="new-password" value={f.temporaryPassword} onChange={(e) => setF({ ...f, temporaryPassword: e.target.value })} invalid={!!errors.temporaryPassword} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPw('');
    setErr(undefined);
  }, [user]);
  if (!user) return null;
  const save = async () => {
    if (!strong(pw)) return setErr(PW_HINT);
    setBusy(true);
    try {
      await post(`/users/${user.id}/reset-password`, { temporaryPassword: pw });
      toast.success('Temporary password set. The user is signed out and must change it at next sign-in.');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Reset password — ${user.name}`}
      width="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={save}>
            Set temporary password
          </Button>
        </>
      }
    >
      <Field label="Temporary password" htmlFor="rp" required error={err}>
        <Input id="rp" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} invalid={!!err} />
      </Field>
    </Dialog>
  );
}

export function RolesAdmin() {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<Role[]>('/roles') });
  const catalogue = useQuery({ queryKey: ['permissions'], queryFn: () => get<{ code: string; description: string }[]>('/permissions') });
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [saving, setSaving] = useState<Role | null>(null);
  useEffect(() => {
    if (roles.data) setDraft(Object.fromEntries(roles.data.map((r) => [r.id, new Set(r.permissions)])));
  }, [roles.data]);
  const changed = (r: Role) => {
    const d = draft[r.id];
    return d && (d.size !== r.permissions.length || r.permissions.some((p) => !d.has(p)));
  };
  const save = async (r: Role) => {
    try {
      await put(`/roles/${r.id}/permissions`, { permissions: [...draft[r.id]] });
      toast.success(`${r.name} permissions updated. Changes apply to the next request of each user.`);
      qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  };
  return (
    <RequirePermission permission="users.manage">
      <PageHeader title="Roles & permissions" description="Apply the client's confirmed permission matrix. Permissions are enforced by the server on every request." breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Roles & permissions' }]} />
      {roles.isLoading || catalogue.isLoading ? null : (
        <div className="grid gap-6 xl:grid-cols-3">
          {roles.data?.map((r) => (
            <Card
              key={r.id}
              title={
                <span className="flex items-center gap-2">
                  {r.name} {!r.enabled && <Badge tone="warning">Not enabled</Badge>}
                </span>
              }
              actions={
                r.configurable && (
                  <Button size="sm" disabled={!changed(r)} onClick={() => setSaving(r)}>
                    Save
                  </Button>
                )
              }
            >
              <p className="mb-3 text-xs text-muted">
                {r.description} · {r.userCount} user(s)
              </p>
              {!r.configurable && <Alert tone="info" className="mb-3">This optional role is disabled until the client confirms it (server setting VIEWER_ROLE_ENABLED).</Alert>}
              <ul className="space-y-2">
                {catalogue.data?.map((p) => (
                  <li key={p.code}>
                    <Checkbox
                      label={
                        <span>
                          {p.description}
                          <span className="block text-[11px] text-muted">{p.code}</span>
                        </span>
                      }
                      disabled={!r.configurable || (r.code === 'ADMIN' && p.code === 'users.manage') || (r.code === 'VIEWER' && !/\.view(_\w+)?$/.test(p.code))}
                      checked={draft[r.id]?.has(p.code) ?? false}
                      onChange={(e) => {
                        const s = new Set(draft[r.id]);
                        if (e.target.checked) s.add(p.code);
                        else s.delete(p.code);
                        setDraft({ ...draft, [r.id]: s });
                      }}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      {saving && (
        <ConfirmDialog
          open
          onClose={() => setSaving(null)}
          onConfirm={() => save(saving)}
          title={`Update ${saving.name}`}
          message="This changes what every user with this role can see and do. The change is recorded in the audit log."
          confirmLabel="Update permissions"
        />
      )}
    </RequirePermission>
  );
}

interface AuditRow {
  id: string;
  occurredAt: string;
  actorEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  ip: string | null;
}

export function AuditLog() {
  const list = useListParams({ sortBy: 'occurredAt', sortDir: 'desc', pageSize: 50, filters: { entity: '', from: '', to: '' } });
  const q = useQuery({ queryKey: ['audit', list.query], queryFn: () => get<Page<AuditRow>>(`/audit-logs${qs(list.query)}`), placeholderData: (p) => p });
  const [open, setOpen] = useState<AuditRow | null>(null);
  return (
    <RequirePermission permission="audit.view">
      <PageHeader title="Audit log" description="Append-only record of sign-ins and sensitive changes. Entries cannot be edited or deleted." breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Audit log' }]} />
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={list.search} onChange={list.setSearch} placeholder="Search action, user or record ID" label="Search audit log" />
          <Input className="w-40" aria-label="Entity" placeholder="Entity (e.g. employee)" value={list.filters.entity} onChange={(e) => list.setFilter('entity', e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-muted">
            From <Input type="date" className="w-40" value={list.filters.from} onChange={(e) => list.setFilter('from', e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            To <Input type="date" className="w-40" value={list.filters.to} onChange={(e) => list.setFilter('to', e.target.value)} />
          </label>
        </Toolbar>
        <DataTable<AuditRow>
          dense
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error ? errorMessage(q.error) : null}
          rowKey={(r) => r.id}
          sortBy={list.sortBy}
          sortDir={list.sortDir}
          onSort={list.toggleSort}
          empty={<EmptyState title="No audit entries match" />}
          columns={[
            { key: 'occurredAt', header: 'When', sortable: true, render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.occurredAt)}</span> },
            { key: 'actor', header: 'User', render: (r) => r.actorEmail ?? <span className="text-muted">anonymous</span> },
            { key: 'action', header: 'Action', render: (r) => <code className="rounded bg-canvas px-1.5 py-0.5 text-xs text-cobalt">{r.action}</code> },
            { key: 'entity', header: 'Record', render: (r) => (<span className="text-xs">{r.entity}<span className="block truncate text-muted">{r.entityId ?? ''}</span></span>) },
            { key: 'd', header: '', align: 'right', render: (r) => (r.before || r.after || r.metadata ? <Button size="sm" variant="ghost" onClick={() => setOpen(r)}>Details</Button> : null) },
          ]}
        />
        {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} />}
      </Card>
      {open && (
        <Dialog open onClose={() => setOpen(null)} title={open.action} width="lg">
          <div className="space-y-3 text-xs">
            {(['before', 'after', 'metadata'] as const).map((k) =>
              open[k] ? (
                <div key={k}>
                  <p className="mb-1 font-semibold uppercase tracking-wide text-muted">{k}</p>
                  <pre className="max-h-64 overflow-auto rounded border border-line bg-canvas p-3 text-ink">{JSON.stringify(open[k], null, 2)}</pre>
                </div>
              ) : null,
            )}
            <p className="text-muted">IP: {open.ip ?? '—'}</p>
          </div>
        </Dialog>
      )}
    </RequirePermission>
  );
}
