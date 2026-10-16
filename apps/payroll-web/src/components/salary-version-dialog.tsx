'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, Alert, Button, Dialog, Field, Input, Textarea, post, todayIso, useToast } from '@nexzi/ui';
import { useComponents } from '@/lib/hooks';
import type { SalaryVersion } from '@/lib/types';

const DEC = /^\d{1,13}(\.\d{1,6})?$/;

/** Creates a new salary version (never edits an existing one). */
export function SalaryVersionDialog({ open, onClose, employeeId, current }: { open: boolean; onClose: () => void; employeeId: string; current: SalaryVersion | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const comps = useComponents(open);
  const editable = useMemo(() => (comps.data?.items ?? []).filter((c) => c.active && c.basis !== 'INPUT'), [comps.data]);
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEffectiveFrom(todayIso());
    setReason('');
    setErrors({});
    setValues(Object.fromEntries((current?.values ?? []).map((v) => [v.componentId, v.value])));
  }, [open, current]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!effectiveFrom) e.effectiveFrom = 'Choose the effective date.';
    if (reason.trim().length < 3) e.changeReason = 'Describe the reason for this change.';
    const entries = Object.entries(values).filter(([, v]) => v.trim() !== '');
    for (const [id, v] of entries) if (!DEC.test(v.trim())) e[`v:${id}`] = 'Enter a non-negative number.';
    if (!entries.length) e.values = 'Enter at least one component value.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await post(`/employees/${employeeId}/salary`, { effectiveFrom, changeReason: reason.trim(), values: entries.map(([componentId, value]) => ({ componentId, value: value.trim() })) });
      await qc.invalidateQueries({ queryKey: ['salary', employeeId] });
      toast.success('New salary version saved. Earlier versions are kept in history.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) setErrors(Object.fromEntries(err.fields.map((f) => [f.path === 'effectiveFrom' ? 'effectiveFrom' : f.path, f.message])));
      toast.error(err instanceof ApiError ? err.message : 'Could not save the salary version.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New salary version"
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save version
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="info">A new version takes effect from the chosen date. The current version is closed the day before and stays in history; finalised payroll is never changed.</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Effective from" htmlFor="eff" required error={errors.effectiveFrom}>
            <Input id="eff" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} invalid={!!errors.effectiveFrom} />
          </Field>
          <Field label="Reason for change" htmlFor="reason" required error={errors.changeReason}>
            <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.changeReason} />
          </Field>
        </div>
        {errors.values && <p className="text-xs font-medium text-danger">{errors.values}</p>}
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-sm">
            <thead className="bg-mist/35 text-left text-xs uppercase tracking-wide text-primary">
              <tr>
                <th className="px-3 py-2">Component</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Basis</th>
                <th className="px-3 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {editable.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <label htmlFor={`v-${c.id}`} className="font-medium text-ink">
                      {c.name}
                    </label>
                    <span className="block text-xs text-muted">{c.code}</span>
                  </td>
                  <td className="px-3 py-2 text-muted">{c.type === 'EARNING' ? 'Earning' : 'Deduction'}</td>
                  <td className="px-3 py-2 text-muted">{c.basis === 'PERCENTAGE' ? `% of ${c.percentOfCode}` : c.basis === 'FORMULA' ? 'Formula parameter' : 'Monthly amount'}</td>
                  <td className="px-3 py-2">
                    <Input
                      id={`v-${c.id}`}
                      inputMode="decimal"
                      className="ml-auto h-9 w-36 text-right"
                      placeholder={c.basis === 'PERCENTAGE' && c.defaultPercentage ? `default ${c.defaultPercentage}` : 'not applicable'}
                      value={values[c.id] ?? ''}
                      onChange={(e) => setValues({ ...values, [c.id]: e.target.value })}
                      invalid={!!errors[`v:${c.id}`]}
                    />
                    {errors[`v:${c.id}`] && <p className="mt-1 text-right text-xs text-danger">{errors[`v:${c.id}`]}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Leave a component blank if it does not apply to this employee. Components entered monthly are filled in the payroll input grid instead.</p>
      </div>
    </Dialog>
  );
}
