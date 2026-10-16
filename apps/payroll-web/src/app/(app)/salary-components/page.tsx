'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
  PageHeader,
  RequirePermission,
  Select,
  Textarea,
  errorMessage,
  post,
  put,
  useAuth,
  useToast,
} from '@nexzi/ui';
import { useComponents, useInputDefinitions } from '@/lib/hooks';
import type { SalaryComponent } from '@/lib/types';

export default function SalaryComponentsPage() {
  return (
    <RequirePermission permission={['salary.view', 'settings.manage']}>
      <ComponentsList />
    </RequirePermission>
  );
}

const BASIS_LABEL = { FIXED: 'Fixed monthly amount', PERCENTAGE: 'Percentage of another component', INPUT: 'Entered monthly', FORMULA: 'Approved formula' } as const;

function ComponentsList() {
  const { can } = useAuth();
  const q = useComponents();
  const [editing, setEditing] = useState<SalaryComponent | 'new' | null>(null);
  return (
    <>
      <PageHeader
        title="Salary components"
        description="Earnings and deductions that make up salary structures. The initial configuration must be taken from the client's approved payroll workbook."
        breadcrumbs={[{ label: 'Dashboard', href: '/' }, { label: 'Salary components' }]}
        actions={
          can('salary.manage') && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add component
            </Button>
          )
        }
      />
      {q.data?.items.some((c) => c.basis === 'FORMULA') && (
        <Alert tone="warning" className="mb-4" title="Formulas awaiting the client workbook">
          No client formula has been implemented yet. Components using the &quot;Approved formula&quot; basis stay blocked (they raise an exception on calculation) until the formula is coded from the workbook and tested against sample months.
        </Alert>
      )}
      <Card padded={false}>
        <DataTable<SalaryComponent>
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => q.refetch()}
          rowKey={(c) => c.id}
          empty={<EmptyState title="No salary components configured" hint="Add the components listed in the client's payroll workbook." />}
          columns={[
            { key: 'order', header: '#', render: (c) => c.sortOrder },
            { key: 'name', header: 'Component', render: (c) => (<span><span className="font-medium">{c.name}</span><span className="block text-xs text-muted">{c.code}</span></span>) },
            { key: 'type', header: 'Type', render: (c) => <Badge tone={c.type === 'EARNING' ? 'brand' : 'neutral'}>{c.type === 'EARNING' ? 'Earning' : 'Deduction'}</Badge> },
            {
              key: 'basis',
              header: 'Calculation basis',
              render: (c) => (
                <span>
                  {BASIS_LABEL[c.basis]}
                  <span className="block text-xs text-muted">
                    {c.basis === 'PERCENTAGE' && `of ${c.percentOfCode}${c.defaultPercentage ? ` (default ${c.defaultPercentage}%)` : ''}`}
                    {c.basis === 'INPUT' && `from input ${c.inputKey}`}
                    {c.basis === 'FORMULA' && `${c.formulaRef} — ${c.formulaStatus === 'CONFIGURED' ? 'configured' : 'awaiting client workbook'}`}
                  </span>
                </span>
              ),
            },
            { key: 'payslip', header: 'On payslip', render: (c) => (c.showOnPayslip ? 'Yes' : 'No') },
            { key: 'active', header: 'Status', render: (c) => <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge> },
            {
              key: 'edit',
              header: '',
              align: 'right',
              render: (c) =>
                can('salary.manage') ? (
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                    Edit
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>
      <ComponentDialog editing={editing} onClose={() => setEditing(null)} all={q.data?.items ?? []} />
    </>
  );
}

interface FormState {
  code: string;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  basis: SalaryComponent['basis'];
  percentOfCode: string;
  defaultPercentage: string;
  inputKey: string;
  formulaRef: string;
  sortOrder: string;
  active: boolean;
  showOnPayslip: boolean;
  description: string;
}

function ComponentDialog({ editing, onClose, all }: { editing: SalaryComponent | 'new' | null; onClose: () => void; all: SalaryComponent[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const inputs = useInputDefinitions(editing !== null);
  const [f, setF] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const isNew = editing === 'new';

  useEffect(() => {
    if (!editing) return setF(null);
    const c = editing === 'new' ? null : editing;
    setErrors({});
    setF({
      code: c?.code ?? '',
      name: c?.name ?? '',
      type: c?.type ?? 'EARNING',
      basis: c?.basis ?? 'FIXED',
      percentOfCode: c?.percentOfCode ?? '',
      defaultPercentage: c?.defaultPercentage ?? '',
      inputKey: c?.inputKey ?? '',
      formulaRef: c?.formulaRef ?? '',
      sortOrder: String(c?.sortOrder ?? (all.length + 1) * 10),
      active: c?.active ?? true,
      showOnPayslip: c?.showOnPayslip ?? true,
      description: c?.description ?? '',
    });
  }, [editing, all.length]);

  if (!f) return null;
  const set = (patch: Partial<FormState>) => setF({ ...f, ...patch });

  const save = async () => {
    const e: Record<string, string> = {};
    if (isNew && !/^[A-Z][A-Z0-9_]{1,39}$/.test(f.code)) e.code = 'Upper-case letters, digits and _ (e.g. BASIC).';
    if (!f.name.trim()) e.name = 'Enter a name.';
    if (!/^\d+$/.test(f.sortOrder)) e.sortOrder = 'Enter a whole number.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = {
      name: f.name.trim(),
      type: f.type,
      basis: f.basis,
      percentOfCode: f.percentOfCode || null,
      defaultPercentage: f.defaultPercentage || null,
      inputKey: f.inputKey || null,
      formulaRef: f.formulaRef || null,
      sortOrder: Number(f.sortOrder),
      active: f.active,
      showOnPayslip: f.showOnPayslip,
      description: f.description || null,
    };
    setSaving(true);
    try {
      if (isNew) await post('/salary-components', { ...body, code: f.code });
      else await put(`/salary-components/${(editing as SalaryComponent).id}`, body);
      await qc.invalidateQueries({ queryKey: ['salary-components'] });
      toast.success('Salary component saved.');
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
      title={isNew ? 'Add salary component' : `Edit ${f.name}`}
      width="lg"
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
        <Field label="Code" htmlFor="code" required error={errors.code} locked={isNew ? undefined : 'Codes cannot change; payroll history refers to them.'}>
          <Input id="code" value={f.code} readOnly={!isNew} onChange={(e) => set({ code: e.target.value.toUpperCase() })} invalid={!!errors.code} />
        </Field>
        <Field label="Name (as on payslip)" htmlFor="name" required error={errors.name}>
          <Input id="name" value={f.name} onChange={(e) => set({ name: e.target.value })} invalid={!!errors.name} />
        </Field>
        <Field label="Type" htmlFor="type" required>
          <Select id="type" value={f.type} onChange={(e) => set({ type: e.target.value as FormState['type'] })}>
            <option value="EARNING">Earning</option>
            <option value="DEDUCTION">Deduction</option>
          </Select>
        </Field>
        <Field label="Calculation basis" htmlFor="basis" required>
          <Select id="basis" value={f.basis} onChange={(e) => set({ basis: e.target.value as FormState['basis'] })}>
            {Object.entries(BASIS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        {f.basis === 'PERCENTAGE' && (
          <>
            <Field label="Percentage of" htmlFor="pct" required error={errors.percentOfCode}>
              <Select id="pct" value={f.percentOfCode} onChange={(e) => set({ percentOfCode: e.target.value })} invalid={!!errors.percentOfCode}>
                <option value="">Choose component…</option>
                {all.filter((c) => c.code !== f.code).map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default rate (%)" htmlFor="defp" hint="Used when the employee's structure has no specific rate." error={errors.defaultPercentage}>
              <Input id="defp" inputMode="decimal" value={f.defaultPercentage} onChange={(e) => set({ defaultPercentage: e.target.value })} />
            </Field>
          </>
        )}
        {f.basis === 'INPUT' && (
          <Field label="Monthly input" htmlFor="inp" required error={errors.inputKey} hint="Numeric column of the monthly input grid.">
            <Select id="inp" value={f.inputKey} onChange={(e) => set({ inputKey: e.target.value })} invalid={!!errors.inputKey}>
              <option value="">Choose input…</option>
              {inputs.data?.filter((i) => i.dataType === 'NUMBER').map((i) => (
                <option key={i.id} value={i.key}>
                  {i.label} ({i.key})
                </option>
              ))}
            </Select>
          </Field>
        )}
        {f.basis === 'FORMULA' && (
          <Field label="Formula reference" htmlFor="fr" required error={errors.formulaRef} hint="Key of the formula implemented from the client workbook. Unimplemented formulas block calculation.">
            <Input id="fr" value={f.formulaRef} onChange={(e) => set({ formulaRef: e.target.value.toUpperCase() })} invalid={!!errors.formulaRef} />
          </Field>
        )}
        <Field label="Display order" htmlFor="so" required error={errors.sortOrder}>
          <Input id="so" inputMode="numeric" value={f.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
        </Field>
        <Field label="Description / workbook reference" htmlFor="desc" className="sm:col-span-2">
          <Textarea id="desc" rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="flex gap-6 sm:col-span-2">
          <Checkbox label="Active" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
          <Checkbox label="Show on payslip" checked={f.showOnPayslip} onChange={(e) => set({ showOnPayslip: e.target.checked })} />
        </div>
      </div>
    </Dialog>
  );
}
