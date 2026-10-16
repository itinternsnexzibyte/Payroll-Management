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
import type { InputDefinition, Settings } from '@/lib/types';

export default function SettingsPage() {
  const [tab, setTab] = useState<'rules' | 'inputs'>('rules');
  return (
    <RequirePermission permission="settings.manage">
      <PageHeader title="Payroll settings" description="Business rules applied to every payroll calculation. Every change is audit-logged." breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Payroll settings' }]} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'rules', label: 'Calculation & approval' },
          { id: 'inputs', label: 'Monthly input columns' },
        ]}
      />
      {tab === 'rules' ? <RulesForm /> : <InputDefinitions />}
    </RequirePermission>
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
