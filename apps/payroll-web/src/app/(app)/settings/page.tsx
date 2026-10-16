'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import {
  Alert,
  ApiError,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  KeyValue,
  PageHeader,
  RequirePermission,
  Select,
  Spinner,
  Tabs,
  Textarea,
  errorMessage,
  get,
  post,
  put,
  useToast,
} from '@nexzi/ui';
import { useInputDefinitions } from '@/lib/hooks';
import type { AnomalyRules, InputDefinition, Settings } from '@/lib/types';

export default function SettingsPage() {
  const [tab, setTab] = useState<'rules' | 'inputs' | 'alerts' | 'modules'>('rules');
  return (
    <RequirePermission permission="settings.manage">
      <PageHeader title="Payroll settings" description="Business rules applied to every payroll calculation. Every change is audit-logged." breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Payroll settings' }]} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'rules', label: 'Calculation & approval' },
          { id: 'inputs', label: 'Monthly input columns' },
          { id: 'alerts', label: 'Payroll alerts' },
          { id: 'modules', label: 'Inputs from modules & email' },
        ]}
      />
      {tab === 'rules' ? <RulesForm /> : tab === 'inputs' ? <InputDefinitions /> : tab === 'alerts' ? <AlertRulesForm /> : <ModulesForm />}
    </RequirePermission>
  );
}

const ALERT_FIELDS: { key: Exclude<keyof AnomalyRules, 'enabled'>; label: string; hint: string; min: number; integer?: boolean }[] = [
  { key: 'netChangePercent', label: 'Net pay change (%)', hint: 'Alert when net pay differs from the last finalised month by at least this much.', min: 1 },
  { key: 'componentChangePercent', label: 'Component change (%)', hint: 'For fixed, percentage and formula components.', min: 1 },
  { key: 'minAbsoluteChange', label: 'Ignore differences below (amount)', hint: 'Avoids alerts on small amounts and rounding.', min: 0 },
  { key: 'outlierMultiplier', label: 'Monthly amount outlier (× largest earlier)', hint: 'For amounts entered each month, such as bonus or deductions.', min: 1 },
  { key: 'historyMonths', label: 'Months of history to compare', hint: 'Earlier finalised months used for monthly amounts.', min: 2, integer: true },
  { key: 'minHistoryMonths', label: 'Minimum history needed', hint: 'The outlier check waits until this many months exist.', min: 2, integer: true },
];

const MAPPINGS: { key: keyof Settings['inputMappings']; label: string; hint: string }[] = [
  { key: 'unpaidLeaveDays', label: 'Unpaid leave days', hint: 'Approved leave of unpaid leave types in the payroll month.' },
  { key: 'advanceRecovery', label: 'Advance / loan recovery', hint: 'The monthly instalment of the employee’s active loan or advance.' },
  { key: 'bonus', label: 'Bonus', hint: 'Approved bonuses for the payroll month.' },
  { key: 'incentive', label: 'Incentive', hint: 'Approved incentives for the payroll month.' },
];
const EMAILS: { key: keyof Settings['emailNotifications']; label: string }[] = [
  { key: 'reviewRequests', label: 'Email approvers when payroll is submitted for review' },
  { key: 'readyToFinalise', label: 'Email finalisers when payroll is approved' },
  { key: 'payslipsAvailable', label: 'Email employees (with a linked account) when their payslip is available' },
  { key: 'leaveDecisions', label: 'Email employees when their leave request is approved or rejected' },
];

function ModulesForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
  const defs = useInputDefinitions();
  const [map, setMap] = useState<Settings['inputMappings'] | null>(null);
  const [mail, setMail] = useState<Settings['emailNotifications'] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) {
      setMap(q.data.inputMappings);
      setMail(q.data.emailNotifications);
    }
  }, [q.data]);
  if (q.isLoading || !map || !mail) return <Spinner />;
  const numeric = (defs.data ?? []).filter((d) => d.dataType === 'NUMBER' && d.active);
  const save = async () => {
    setSaving(true);
    try {
      await put('/settings', { inputMappings: map, emailNotifications: mail });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Saved.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Inputs from leave, advances and bonuses">
        <p className="mb-4 text-sm text-muted">
          On a payroll run, <strong>Fill from leave, advances &amp; bonuses</strong> writes these amounts into the input columns chosen here. The salary components that use those columns decide how they affect pay. Leave a row unmapped to skip it.
        </p>
        <div className="space-y-4">
          {MAPPINGS.map((m) => (
            <Field key={m.key} label={m.label} htmlFor={`map-${m.key}`} hint={m.hint}>
              <Select id={`map-${m.key}`} value={map[m.key] ?? ''} onChange={(e) => setMap({ ...map, [m.key]: e.target.value || null })}>
                <option value="">Not mapped</option>
                {numeric.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label} ({d.key})
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
        {!numeric.length && <Alert tone="info" className="mt-4">Add numeric monthly input columns first (Monthly input columns tab).</Alert>}
      </Card>
      <Card title="Email notifications">
        <p className="mb-4 text-sm text-muted">Emails say what is waiting and link to the application. They never include salary amounts.</p>
        <div className="space-y-3">
          {EMAILS.map((m) => (
            <Checkbox key={m.key} label={m.label} checked={mail[m.key]} onChange={(e) => setMail({ ...mail, [m.key]: e.target.checked })} />
          ))}
        </div>
      </Card>
      <div className="flex justify-end xl:col-span-2">
        <Button loading={saving} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

function AlertRulesForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
  const [r, setR] = useState<Record<string, string> | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) {
      setEnabled(q.data.anomalyRules.enabled);
      setR(Object.fromEntries(ALERT_FIELDS.map((f) => [f.key, String(q.data.anomalyRules[f.key])])));
    }
  }, [q.data]);
  if (q.isLoading || !r) return <Spinner />;

  const save = async () => {
    const fe: Record<string, string> = {};
    for (const f of ALERT_FIELDS) {
      const n = Number(r[f.key]);
      if (r[f.key].trim() === '' || !Number.isFinite(n) || n < f.min || (f.integer && !Number.isInteger(n))) fe[f.key] = `Enter ${f.integer ? 'a whole number' : 'a number'} of at least ${f.min}.`;
    }
    if (!fe.minHistoryMonths && !fe.historyMonths && Number(r.minHistoryMonths) > Number(r.historyMonths)) fe.minHistoryMonths = 'Cannot be more than the months of history.';
    setErrors(fe);
    if (Object.keys(fe).length) return;
    setSaving(true);
    try {
      await put('/settings', { anomalyRules: { enabled, ...Object.fromEntries(ALERT_FIELDS.map((f) => [f.key, Number(r[f.key])])) } });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Alert rules saved. Use “Check again” on a payroll run, or recalculate, to apply them.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Payroll alert rules" className="max-w-4xl">
      <Alert tone="info" className="mb-5">
        Alerts compare each payroll with the employee&apos;s earlier finalised months and explain what looks unusual. They never change payroll results. These thresholds are starting values until agreed with the client.
      </Alert>
      <Checkbox label="Run payroll alerts after every calculation" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {ALERT_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`ar-${f.key}`} hint={f.hint} error={errors[f.key]}>
            <Input id={`ar-${f.key}`} inputMode="decimal" value={r[f.key]} disabled={!enabled} invalid={!!errors[f.key]} onChange={(e) => setR({ ...r, [f.key]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="mt-6 flex justify-end">
        <Button loading={saving} onClick={save}>
          Save alert rules
        </Button>
      </div>
    </Card>
  );
}

function RulesForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
  const [s, setS] = useState<Settings | null>(null);
  const [threshold, setThreshold] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) {
      setS(q.data);
      setThreshold(q.data.unusualChangeThresholdPercent === null ? '' : String(q.data.unusualChangeThresholdPercent));
    }
  }, [q.data]);
  if (q.isLoading || !s) return <Spinner />;

  const save = async () => {
    if (threshold && !(Number(threshold) >= 1)) return toast.error('The warning threshold must be a number of at least 1.');
    setSaving(true);
    try {
      await put('/settings', {
        rounding: { scale: s.rounding.scale, mode: s.rounding.mode, level: s.rounding.level },
        salaryVersionRule: s.salaryVersionRule,
        requireApprovalStep: s.requireApprovalStep,
        separateApprover: s.separateApprover,
        unusualChangeThresholdPercent: threshold ? Number(threshold) : null,
      });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Settings saved. Recalculate open payroll runs for them to take effect.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card title="Calculation rules" className="xl:col-span-2">
        <Alert tone="warning" className="mb-5">
          These defaults are placeholders. The rounding rule (per line or at total, decimals, mode) must be copied exactly from the client&apos;s Excel workbook.
        </Alert>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Decimal places" htmlFor="scale">
            <Select id="scale" value={s.rounding.scale} onChange={(e) => setS({ ...s, rounding: { ...s.rounding, scale: Number(e.target.value) } })}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rounding mode" htmlFor="mode">
            <Select id="mode" value={s.rounding.mode} onChange={(e) => setS({ ...s, rounding: { ...s.rounding, mode: e.target.value } })}>
              <option value="HALF_UP">Half up (0.5 → 1)</option>
              <option value="HALF_EVEN">Half even (banker&apos;s)</option>
              <option value="UP">Always up</option>
              <option value="DOWN">Always down</option>
            </Select>
          </Field>
          <Field label="Round at" htmlFor="level">
            <Select id="level" value={s.rounding.level} onChange={(e) => setS({ ...s, rounding: { ...s.rounding, level: e.target.value as 'LINE' | 'TOTAL' } })}>
              <option value="LINE">Each line</option>
              <option value="TOTAL">Totals only</option>
            </Select>
          </Field>
          <Field label="Salary version used for a month" htmlFor="svr" className="sm:col-span-2" hint="Which version applies when a salary changes mid-month (proration is not assumed).">
            <Select id="svr" value={s.salaryVersionRule} onChange={(e) => setS({ ...s, salaryVersionRule: e.target.value as Settings['salaryVersionRule'] })}>
              <option value="MONTH_END">Version in effect on the last day of the month</option>
              <option value="MONTH_START">Version in effect on the first day of the month</option>
            </Select>
          </Field>
          <Field label="Warn if net pay changes by more than (%)" htmlFor="thr" hint="Leave blank to disable until the threshold is agreed.">
            <Input id="thr" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </Field>
        </div>
        <div className="mt-6 space-y-3 border-t border-line pt-5">
          <h3 className="text-sm font-semibold text-primary">Approval policy</h3>
          <Checkbox label="Require a separate Approve step before finalisation" checked={s.requireApprovalStep} onChange={(e) => setS({ ...s, requireApprovalStep: e.target.checked })} />
          <Checkbox label="Approver must be a different person from the one who calculated / submitted" checked={s.separateApprover} onChange={(e) => setS({ ...s, separateApprover: e.target.checked })} />
        </div>
        <div className="mt-6 flex justify-end">
          <Button loading={saving} onClick={save}>
            Save settings
          </Button>
        </div>
      </Card>
      <Card title="Configuration status">
        <KeyValue
          columns={1}
          items={[
            { label: 'Calculation rules', value: s.rulesApproved ? <Badge tone="success">Client-approved</Badge> : <Badge tone="warning">Provisional</Badge> },
            { label: 'Viewer / Management role', value: s.viewerRoleEnabled ? 'Enabled' : 'Disabled (pending client confirmation)' },
            { label: 'Payslip company name', value: s.payslipCompanyName },
          ]}
        />
        <p className="mt-4 text-xs text-muted">These are set by the server administrator through environment configuration (PAYROLL_RULES_APPROVED, VIEWER_ROLE_ENABLED, PAYSLIP_COMPANY_NAME) and cannot be switched from the browser.</p>
      </Card>
    </div>
  );
}

function InputDefinitions() {
  const q = useInputDefinitions();
  const [editing, setEditing] = useState<InputDefinition | 'new' | null>(null);
  return (
    <Card
      title="Monthly input columns"
      actions={
        <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          Add column
        </Button>
      }
      padded={false}
    >
      <p className="px-5 pt-4 text-sm text-muted">These are the values filled in by hand each month in the Excel today. They become the columns of the payroll input grid. Attendance import can feed the same columns later.</p>
      <DataTable<InputDefinition>
        rows={q.data}
        loading={q.isLoading}
        error={q.error ? errorMessage(q.error) : null}
        rowKey={(d) => d.id}
        empty={<EmptyState title="No input columns" hint="Add the monthly inputs used in the client's workbook." />}
        columns={[
          { key: 'order', header: '#', render: (d) => d.sortOrder },
          { key: 'label', header: 'Column', render: (d) => (<span><span className="font-medium">{d.label}</span><span className="block text-xs text-muted">{d.key}</span></span>) },
          { key: 'type', header: 'Type', render: (d) => (d.dataType === 'NUMBER' ? 'Number' : 'Text') },
          { key: 'req', header: 'Mandatory', render: (d) => (d.mandatory ? <Badge tone="brand">Required</Badge> : 'Optional') },
          { key: 'range', header: 'Allowed range', render: (d) => (d.dataType === 'NUMBER' ? `${d.minValue ?? '—'} to ${d.maxValue ?? '—'}` : '—') },
          { key: 'active', header: 'Status', render: (d) => <Badge tone={d.active ? 'success' : 'neutral'}>{d.active ? 'Active' : 'Inactive'}</Badge> },
          { key: 'e', header: '', align: 'right', render: (d) => <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(d)}>Edit</Button> },
        ]}
      />
      <InputDialog editing={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function InputDialog({ editing, onClose }: { editing: InputDefinition | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ key: '', label: '', dataType: 'NUMBER', mandatory: false, minValue: '', maxValue: '', sortOrder: '10', active: true, description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!editing) return;
    const d = editing === 'new' ? null : editing;
    setErrors({});
    setF({ key: d?.key ?? '', label: d?.label ?? '', dataType: d?.dataType ?? 'NUMBER', mandatory: d?.mandatory ?? false, minValue: d?.minValue ?? '', maxValue: d?.maxValue ?? '', sortOrder: String(d?.sortOrder ?? 10), active: d?.active ?? true, description: d?.description ?? '' });
  }, [editing]);
  if (!editing) return null;
  const isNew = editing === 'new';
  const save = async () => {
    const body = { label: f.label.trim(), dataType: f.dataType, mandatory: f.mandatory, minValue: f.minValue || null, maxValue: f.maxValue || null, sortOrder: Number(f.sortOrder) || 0, active: f.active, description: f.description || null };
    setSaving(true);
    try {
      if (isNew) await post('/payroll-input-definitions', { ...body, key: f.key });
      else await put(`/payroll-input-definitions/${editing.id}`, body);
      await qc.invalidateQueries({ queryKey: ['input-definitions'] });
      toast.success('Input column saved.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldMap());
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={isNew ? 'Add input column' : `Edit ${f.label}`}
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
        <Field label="Key" htmlFor="ikey" required error={errors.key} locked={isNew ? undefined : 'Keys are fixed once created.'}>
          <Input id="ikey" value={f.key} readOnly={!isNew} onChange={(e) => setF({ ...f, key: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="Label (as in the workbook)" htmlFor="ilabel" required error={errors.label}>
          <Input id="ilabel" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </Field>
        <Field label="Type" htmlFor="itype">
          <Select id="itype" value={f.dataType} disabled={!isNew} onChange={(e) => setF({ ...f, dataType: e.target.value })}>
            <option value="NUMBER">Number</option>
            <option value="TEXT">Text</option>
          </Select>
        </Field>
        <Field label="Display order" htmlFor="iorder">
          <Input id="iorder" inputMode="numeric" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} />
        </Field>
        {f.dataType === 'NUMBER' && (
          <>
            <Field label="Minimum" htmlFor="imin" error={errors.minValue}>
              <Input id="imin" inputMode="decimal" value={f.minValue} onChange={(e) => setF({ ...f, minValue: e.target.value })} />
            </Field>
            <Field label="Maximum" htmlFor="imax" error={errors.maxValue}>
              <Input id="imax" inputMode="decimal" value={f.maxValue} onChange={(e) => setF({ ...f, maxValue: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Description" htmlFor="idesc" className="sm:col-span-2">
          <Textarea id="idesc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="flex gap-6 sm:col-span-2">
          <Checkbox label="Mandatory every month" checked={f.mandatory} onChange={(e) => setF({ ...f, mandatory: e.target.checked })} />
          <Checkbox label="Active" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        </div>
      </div>
    </Dialog>
  );
}
