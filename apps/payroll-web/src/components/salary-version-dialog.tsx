'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, Alert, Button, Dialog, Field, Input, Select, Textarea, errorMessage, formatMoney, post, todayIso, useToast } from '@nexzi/ui';
import type { SalaryVersion, TemplatePreview } from '@/lib/types';

/**
 * Creates a new salary version (never edits an existing one). Salaries are not typed component by
 * component: the monthly gross (or annual CTC) is split by the salary structure template.
 */
export function SalaryVersionDialog({ open, onClose, employeeId, current }: { open: boolean; onClose: () => void; employeeId: string; current: SalaryVersion | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [basis, setBasis] = useState<'monthly' | 'annual'>('monthly');
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEffectiveFrom(todayIso());
    setReason('');
    setErrors({});
    setBasis('monthly');
    setAmount(current?.monthlyGross ? String(Number(current.monthlyGross)) : '');
  }, [open, current]);

  const value = Number(amount);
  const body = basis === 'monthly' ? { monthlyGross: value } : { annualCtc: value };
  useEffect(() => {
    if (!open || !(value > 0)) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const t = setTimeout(() => {
      post<TemplatePreview>('/salary-template/preview', basis === 'monthly' ? { monthlyGross: value } : { annualCtc: value })
        .then((p) => {
          setPreview(p);
          setPreviewError(null);
        })
        .catch((e) => setPreviewError(errorMessage(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [open, value, basis]);

  const save = async () => {
    const e: Record<string, string> = {};
    if (!effectiveFrom) e.effectiveFrom = 'Choose the effective date.';
    if (reason.trim().length < 3) e.changeReason = 'Describe the reason for this change.';
    if (!(value > 0)) e.amount = 'Enter the salary.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await post(`/employees/${employeeId}/salary/auto`, { effectiveFrom, changeReason: reason.trim(), ...body });
      await qc.invalidateQueries({ queryKey: ['salary', employeeId] });
      toast.success('New salary version generated. Earlier versions are kept in history.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields.length) setErrors(Object.fromEntries(err.fields.map((f) => [f.path, f.message])));
      toast.error(err instanceof ApiError ? err.message : 'Could not save the salary version.');
    } finally {
      setSaving(false);
    }
  };

  const problems = preview?.problems ?? [];
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
          <Button onClick={save} loading={saving} disabled={problems.length > 0}>
            Generate version
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="info">
          Enter the salary once: every component is calculated from the{' '}
          <Link href="/settings" className="font-medium underline">
            salary structure template
          </Link>
          . The version takes effect from the chosen date; the current one is closed the day before and stays in history.
        </Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Salary entered as" htmlFor="basis">
            <Select id="basis" value={basis} onChange={(e) => setBasis(e.target.value as 'monthly' | 'annual')}>
              <option value="monthly">Monthly gross</option>
              <option value="annual">Annual CTC (÷ 12)</option>
            </Select>
          </Field>
          <Field label={basis === 'monthly' ? 'Monthly gross (₹)' : 'Annual CTC (₹)'} htmlFor="amount" required error={errors.amount ?? errors.monthlyGross}>
            <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} invalid={!!(errors.amount ?? errors.monthlyGross)} placeholder={basis === 'monthly' ? 'e.g. 125000' : 'e.g. 1500000'} />
          </Field>
          <Field label="Effective from" htmlFor="eff" required error={errors.effectiveFrom}>
            <Input id="eff" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} invalid={!!errors.effectiveFrom} />
          </Field>
          <Field label="Reason for change" htmlFor="reason" required error={errors.changeReason}>
            <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!errors.changeReason} />
          </Field>
        </div>
        {previewError && <Alert tone="danger">{previewError}</Alert>}
        {problems.length > 0 && (
          <Alert tone="warning" title="The salary structure template needs attention">
            <ul className="ml-4 list-disc">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        )}
        {preview && !problems.length && (
          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-sm">
              <thead className="bg-mist/35 text-left text-xs uppercase tracking-wide text-primary">
                <tr>
                  <th className="px-3 py-2">Component</th>
                  <th className="px-3 py-2">Rule</th>
                  <th className="px-3 py-2 text-right">Monthly amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.code} className="border-t border-line">
                    <td className="px-3 py-2">
                      <span className="font-medium text-ink">{l.name}</span>
                      <span className="block text-xs text-muted">
                        {l.code} · {l.type === 'EARNING' ? 'Earning' : 'Deduction'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted">{RULE[l.method](l.value)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t border-line bg-surface font-semibold">
                  <td className="px-3 py-2" colSpan={2}>
                    Gross {formatMoney(preview.earnings)} − fixed deductions {formatMoney(preview.deductions)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(preview.net)}</td>
                </tr>
              </tbody>
            </table>
            <p className="border-t border-line px-3 py-2 text-xs text-muted">PF / ESI, TDS, loss of pay and monthly inputs are applied when payroll is calculated.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

const RULE: Record<TemplatePreview['lines'][number]['method'], (v: string) => string> = {
  PERCENT_OF_GROSS: () => 'Share of gross',
  AMOUNT: () => 'Fixed amount',
  RATE: (v) => `${Number(v)}% of its base`,
  BALANCE: () => 'Balance of gross',
};
