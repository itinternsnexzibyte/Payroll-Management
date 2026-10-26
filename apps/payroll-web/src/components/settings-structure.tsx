'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Upload } from 'lucide-react';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Spinner, Textarea, errorMessage, get, put, useToast } from '@nexzi/ui';
import { useComponents } from '@/lib/hooks';
import type { Branding, SalaryTemplate, Settings, TemplateMethod } from '@/lib/types';

const METHODS: { id: TemplateMethod; label: string; unit: string }[] = [
  { id: 'PERCENT_OF_GROSS', label: '% of monthly gross', unit: '%' },
  { id: 'AMOUNT', label: 'Fixed amount', unit: '₹' },
  { id: 'RATE', label: 'Rate of its base (percentage component)', unit: '%' },
  { id: 'BALANCE', label: 'Balance of the gross', unit: '' },
];

/** Salary structure template, proration and gratuity. */
export function StructureForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
  const tq = useQuery({ queryKey: ['salary-template'], queryFn: () => get<{ problems: string[] }>('/salary-template') });
  const comps = useComponents();
  const [t, setT] = useState<SalaryTemplate | null>(null);
  const [proration, setProration] = useState(true);
  const [gratuity, setGratuity] = useState<Settings['gratuity'] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) {
      setT(q.data.salaryTemplate);
      setProration(q.data.proration.enabled);
      setGratuity(q.data.gratuity);
    }
  }, [q.data]);
  if (q.isLoading || !t || !gratuity) return <Spinner />;
  const active = (comps.data?.items ?? []).filter((c) => c.active && c.basis !== 'INPUT' && c.basis !== 'FORMULA');
  const earnings = (comps.data?.items ?? []).filter((c) => c.active && c.type === 'EARNING');
  const setLine = (i: number, patch: Partial<SalaryTemplate['lines'][number]>) => setT({ ...t, lines: t.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const save = async () => {
    setSaving(true);
    try {
      await put('/settings', { salaryTemplate: t, proration: { enabled: proration }, gratuity });
      await Promise.all([qc.invalidateQueries({ queryKey: ['settings'] }), qc.invalidateQueries({ queryKey: ['salary-template'] })]);
      toast.success('Saved. New salary versions use this template; recalculate open payroll runs to apply proration or gratuity changes.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card title="Salary structure template">
        <p className="mb-4 text-sm text-muted">
          Salaries are not typed component by component. When a salary version is created, the monthly gross (or annual CTC ÷ 12) is split by these lines, and payroll is then calculated from that structure automatically.
        </p>
        <Checkbox label="Generate salary structures from this template" checked={t.enabled} onChange={(e) => setT({ ...t, enabled: e.target.checked })} />
        <div className="mt-4 overflow-hidden rounded-md border border-line">
          <table className="w-full text-sm">
            <thead className="bg-mist/35 text-left text-xs uppercase tracking-wide text-primary">
              <tr>
                <th className="px-3 py-2">Component</th>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Value</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {t.lines.map((l, i) => {
                const unit = METHODS.find((m) => m.id === l.method)?.unit;
                return (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-2">
                      <Select aria-label="Component" value={l.code} onChange={(e) => setLine(i, { code: e.target.value })}>
                        {!active.some((c) => c.code === l.code) && <option value={l.code}>{l.code} (not found)</option>}
                        {active.map((c) => (
                          <option key={c.id} value={c.code}>
                            {c.name} ({c.code})
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Select aria-label="Rule" value={l.method} onChange={(e) => setLine(i, { method: e.target.value as TemplateMethod, value: e.target.value === 'BALANCE' ? null : l.value })}>
                        {METHODS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      {l.method === 'BALANCE' ? (
                        <span className="text-muted">Whatever is left</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Input aria-label="Value" inputMode="decimal" className="w-28 text-right" value={l.value ?? ''} placeholder={l.method === 'RATE' ? 'default' : ''} onChange={(e) => setLine(i, { value: e.target.value === '' ? null : Number(e.target.value) })} />
                          <span className="text-muted">{unit}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Button variant="ghost" size="sm" aria-label="Remove line" icon={<Trash2 className="h-4 w-4" />} onClick={() => setT({ ...t, lines: t.lines.filter((_, j) => j !== i) })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} disabled={!active.length} onClick={() => setT({ ...t, lines: [...t.lines, { code: active[0]?.code ?? '', method: 'AMOUNT', value: 0 }] })}>
            Add line
          </Button>
          <span className="text-xs text-muted">Example: Basic 50% of gross · HRA 40% of Basic · Professional tax ₹200 · Special allowance = balance.</span>
        </div>
        {tq.data && tq.data.problems.length > 0 && (
          <Alert tone="warning" className="mt-4" title="Saved template has problems">
            <ul className="ml-4 list-disc">
              {tq.data.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Pay days and loss of pay">
          <Checkbox label="Pro-rate fixed earnings by days payable" checked={proration} onChange={(e) => setProration(e.target.checked)} />
          <p className="mt-3 text-sm text-muted">
            Days payable = days employed in the month (joining and exit dates) − loss-of-pay days. Loss-of-pay days come from the input column mapped to <strong>Unpaid leave days</strong> on the “Inputs from modules” tab, filled from approved unpaid leave or the attendance register.
          </p>
        </Card>
        <Card title="Gratuity">
          <Checkbox label="Show gratuity accrual on payslips" checked={gratuity.enabled} onChange={(e) => setGratuity({ ...gratuity, enabled: e.target.checked })} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Monthly accrual (% of base)" htmlFor="grat-rate" hint="15 days' wages per year on a 26-day month ≈ 4.81%.">
              <Input id="grat-rate" inputMode="decimal" value={String(gratuity.ratePercent)} onChange={(e) => setGratuity({ ...gratuity, ratePercent: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Base components" htmlFor="grat-base" hint="Usually Basic (plus DA, if paid).">
              <Select id="grat-base" multiple className="h-24" value={gratuity.baseComponents} onChange={(e) => setGratuity({ ...gratuity, baseComponents: [...e.target.selectedOptions].map((o) => o.value) })}>
                {earnings.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="mt-3 text-xs text-muted">Gratuity is an employer cost shown under “Employer contributions”; it is never deducted from net pay.</p>
        </Card>
      </div>
      <div className="flex justify-end">
        <Button loading={saving} onClick={save}>
          Save salary structure settings
        </Button>
      </div>
    </div>
  );
}

const MAX_LOGO_BYTES = 500 * 1024;

/** Company details, logo and colours for payslips and Form 16. */
export function BrandingForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings') });
  const [b, setB] = useState<Branding | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data) setB(q.data.branding);
  }, [q.data]);
  if (q.isLoading || !b) return <Spinner />;
  const text = (k: keyof Branding) => (e: { target: { value: string } }) => setB({ ...b, [k]: e.target.value || null });

  const onLogo = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) return toast.error('Upload a PNG, JPEG or SVG image.');
    if (file.size > MAX_LOGO_BYTES) return toast.error('Keep the logo under 500 KB — it is embedded in every PDF.');
    const reader = new FileReader();
    reader.onload = () => setB({ ...b, logoDataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };
  const save = async () => {
    setSaving(true);
    try {
      await put('/settings', { branding: b });
      await qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Branding saved. It applies to payslips generated from now on; issued payslips are not changed.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card title="Company on payslips and Form 16">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" htmlFor="b-name" hint={`Blank = ${q.data?.payslipCompanyName}`}>
            <Input id="b-name" value={b.companyName ?? ''} onChange={text('companyName')} />
          </Field>
          <Field label="Logo" htmlFor="b-logo" hint="PNG, JPEG or SVG, under 500 KB. Blank = the built-in logo.">
            <div className="flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-2 text-sm hover:bg-mist/40">
                <Upload className="h-4 w-4" aria-hidden /> Choose file
                <input id="b-logo" type="file" accept="image/png,image/jpeg,image/svg+xml" className="sr-only" onChange={(e) => onLogo(e.target.files?.[0])} />
              </label>
              {b.logoDataUrl && (
                <Button variant="ghost" size="sm" onClick={() => setB({ ...b, logoDataUrl: null })}>
                  Use built-in logo
                </Button>
              )}
            </div>
          </Field>
          <Field label="Registered address" htmlFor="b-addr" className="sm:col-span-2">
            <Textarea id="b-addr" rows={3} value={b.address ?? ''} onChange={text('address')} placeholder={'# 801A, The Platina, Gachibowli\nHyderabad, Telangana 500032'} />
          </Field>
          <Field label="Primary colour" htmlFor="b-p">
            <div className="flex items-center gap-2">
              <input id="b-p" type="color" className="h-9 w-12 rounded border border-line" value={b.primaryColor} onChange={(e) => setB({ ...b, primaryColor: e.target.value })} />
              <Input aria-label="Primary colour hex" className="w-32" value={b.primaryColor} onChange={(e) => setB({ ...b, primaryColor: e.target.value })} />
            </div>
          </Field>
          <Field label="Accent colour" htmlFor="b-a">
            <div className="flex items-center gap-2">
              <input id="b-a" type="color" className="h-9 w-12 rounded border border-line" value={b.accentColor} onChange={(e) => setB({ ...b, accentColor: e.target.value })} />
              <Input aria-label="Accent colour hex" className="w-32" value={b.accentColor} onChange={(e) => setB({ ...b, accentColor: e.target.value })} />
            </div>
          </Field>
          <Field label="Employer PAN" htmlFor="b-pan" hint="Printed on Form 16.">
            <Input id="b-pan" value={b.employerPan ?? ''} onChange={text('employerPan')} maxLength={10} />
          </Field>
          <Field label="Employer TAN" htmlFor="b-tan" hint="Printed on Form 16.">
            <Input id="b-tan" value={b.employerTan ?? ''} onChange={text('employerTan')} maxLength={10} />
          </Field>
        </div>
        <div className="mt-6 flex justify-end">
          <Button loading={saving} onClick={save}>
            Save branding
          </Button>
        </div>
      </Card>
      <Card title="Preview">
        <div className="overflow-hidden rounded-md border border-line bg-white p-4 text-[11px] text-ink">
          <div className="mb-3 h-1.5 rounded" style={{ background: `linear-gradient(90deg, ${b.primaryColor}, ${b.accentColor})` }} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-extrabold" style={{ color: b.primaryColor }}>
                PAYSLIP <span className="font-normal text-muted">OCT 2026</span>
              </div>
              <div className="mt-2 font-semibold uppercase">{b.companyName || q.data?.payslipCompanyName}</div>
              {b.address && <div className="whitespace-pre-line uppercase text-muted">{b.address}</div>}
            </div>
            <img src={b.logoDataUrl ?? '/brand/nexzibyte-logo.png'} alt="Company logo" className="max-h-10 max-w-[120px] object-contain" />
          </div>
          <div className="mt-4 border-b-2 pb-1 font-bold uppercase" style={{ borderColor: b.primaryColor }}>
            Employee name
          </div>
          <div className="mt-3 rounded border-l-4 px-3 py-2" style={{ borderColor: b.accentColor, background: '#f4f3fb' }}>
            <div className="flex justify-between">
              <span>Net Salary Payable ( A - B - C )</span>
              <b style={{ color: b.primaryColor }}>1,10,000.00</b>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
