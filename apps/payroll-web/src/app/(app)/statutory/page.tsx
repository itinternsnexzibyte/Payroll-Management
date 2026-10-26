'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, ErrorState, Field, Input, PageHeader, RequirePermission, Select, Spinner, errorMessage, get, post, put, useToast } from '@nexzi/ui';
import { useComponents, useInputDefinitions } from '@/lib/hooks';

type Num = number | null;
interface Settings {
  confirmedBy: string | null;
  confirmedOn: string | null;
  reference: string | null;
  pf: { enabled: boolean; employeeRatePercent: Num; employerRatePercent: Num; wageComponents: string[]; wageCeiling: Num; capAtCeiling: boolean };
  esi: { enabled: boolean; employeeRatePercent: Num; employerRatePercent: Num; wageComponents: string[]; eligibilityLimit: Num };
  wageBand: { enabled: boolean; threshold: Num };
  tds: { enabled: boolean; taxableComponents: string[]; standardDeduction: Num; slabs: { upTo: Num; ratePercent: number }[]; rebateLimit: Num; cessPercent: Num; overrideInputKey: string | null };
}
type Kind = 'PF' | 'ESI' | 'TDS';
interface State {
  settings: Settings;
  problems: Record<Kind, string[]>;
  components: Record<Kind, { id: string; code: string; name: string; active: boolean }[]>;
}

export default function StatutoryPage() {
  return (
    <RequirePermission permission="settings.manage">
      <PageHeader
        title="Statutory deductions"
        description="Provident Fund, ESI and income tax (TDS). The application contains no statutory rates: enter the current figures from EPFO, ESIC and Income-tax notifications and record who confirmed them."
        breadcrumbs={[{ label: 'Payroll settings', href: '/settings' }, { label: 'Statutory deductions' }]}
      />
      <Editor />
    </RequirePermission>
  );
}

/** Text boxes keep what is typed; numbers are parsed only when saving. */
const txt = (n: Num) => (n === null ? '' : String(n));
const num = (s: string): Num => (s.trim() === '' ? null : Number(s));

function Editor() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['statutory'], queryFn: () => get<State>('/statutory') });
  const comps = useComponents();
  const inputs = useInputDefinitions();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (q.data && !s) setS(q.data.settings);
  }, [q.data, s]);
  const save = useMutation({
    mutationFn: (body: Settings) => put<State>('/statutory', body),
    onSuccess: (d) => {
      toast.success('Statutory settings saved. Recalculate open payroll months to apply them.');
      qc.setQueryData(['statutory'], d);
      setS(d.settings);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const create = useMutation({
    mutationFn: (kind: Kind) => post<State>('/statutory/components', { kind }),
    onSuccess: (d) => {
      toast.success('Deduction component created.');
      qc.setQueryData(['statutory'], d);
      qc.invalidateQueries({ queryKey: ['salary-components'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const standard = useMutation({
    mutationFn: () => post<State>('/statutory/standard-setup', { threshold: s?.wageBand.threshold ?? 20000 }),
    onSuccess: (d) => {
      toast.success('Standard PF and ESI applied with the wage band. Recalculate open payroll months to apply them.');
      qc.setQueryData(['statutory'], d);
      setS(d.settings);
      qc.invalidateQueries({ queryKey: ['salary-components'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading || !s) return q.error ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : <Spinner />;
  const earnings = (comps.data?.items ?? []).filter((c) => c.type === 'EARNING' && c.active);
  const numericInputs = (inputs.data ?? []).filter((d) => d.dataType === 'NUMBER' && d.active !== false);
  const anyOn = s.pf.enabled || s.esi.enabled || s.tds.enabled;

  const componentRow = (kind: Kind) => {
    const list = q.data!.components[kind];
    return list.length ? (
      <p className="text-xs text-muted">
        Deducted as {list.map((c) => <Badge key={c.id} tone={c.active ? 'brand' : 'neutral'} className="mr-1">{c.code} · {c.name}{c.active ? '' : ' (inactive)'}</Badge>)}
        — rename or reorder it in <Link href="/salary-components" className="underline">Salary components</Link>.
      </p>
    ) : (
      <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} loading={create.isPending && create.variables === kind} onClick={() => create.mutate(kind)}>
        Create the {kind} deduction component
      </Button>
    );
  };
  const picker = (selected: string[], onChange: (v: string[]) => void, id: string) => (
    <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-line p-3" id={id}>
      {earnings.length ? earnings.map((c) => (
        <Checkbox key={c.code} label={`${c.code} · ${c.name}`} checked={selected.includes(c.code)} onChange={(e) => onChange(e.target.checked ? [...selected, c.code] : selected.filter((x) => x !== c.code))} />
      )) : <span className="text-sm text-muted">No active earning components.</span>}
    </div>
  );
  const problems = (k: Kind) => (q.data!.problems[k].length ? <Alert tone="warning" className="mt-3">{q.data!.problems[k].join(' ')}</Alert> : null);

  return (
    <div className="space-y-6">
      <Alert tone="info" title="How it works">
        Each switched-on deduction is added for every employee who has a salary structure in the payroll month. Wages are the sum of the components you tick. Employer PF and ESI shares are not deducted from pay; they appear in the <Link href="/reports" className="underline">Statutory deductions report</Link>. Changing these settings makes calculated payroll months stale until they are recalculated.
      </Alert>

      <Card
        title="PF / ESI wage band"
        actions={<Checkbox label="Use the wage band" checked={s.wageBand.enabled} onChange={(e) => setS({ ...s, wageBand: { ...s.wageBand, enabled: e.target.checked } })} />}
      >
        <div className="grid gap-4 sm:grid-cols-[220px_1fr] sm:items-end">
          <NumField id="band" label="Monthly gross threshold (₹)" value={s.wageBand.threshold} onChange={(v) => setS({ ...s, wageBand: { ...s.wageBand, threshold: v } })} />
          <p className="pb-2 text-sm text-muted">
            Gross (the ESI wage components) <strong>at or below ₹{s.wageBand.threshold ?? '—'}</strong>: ESI is deducted and PF is not. <strong>Above it</strong>: PF is deducted and ESI is not. The threshold replaces the ESI eligibility limit while the band is on.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button variant="secondary" loading={standard.isPending} onClick={() => standard.mutate()}>
            Apply standard PF &amp; ESI with this band
          </Button>
          <span className="text-xs text-muted">Sets PF 12% + 12% of basic (ceiling ₹15,000), ESI 0.75% + 3.25% of gross, records you as confirming them, and creates the PF / ESI deductions (an existing “12% of basic” PF component is switched to the statutory formula).</span>
        </div>
      </Card>

      <Card title="Confirmation">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Confirmed by" htmlFor="st-by" required={anyOn}>
            <Input id="st-by" value={s.confirmedBy ?? ''} onChange={(e) => setS({ ...s, confirmedBy: e.target.value || null })} maxLength={120} />
          </Field>
          <Field label="Confirmed on" htmlFor="st-on" required={anyOn}>
            <Input id="st-on" type="date" value={s.confirmedOn ?? ''} onChange={(e) => setS({ ...s, confirmedOn: e.target.value || null })} />
          </Field>
          <Field label="Source (notification, circular or adviser)" htmlFor="st-ref">
            <Input id="st-ref" value={s.reference ?? ''} onChange={(e) => setS({ ...s, reference: e.target.value || null })} maxLength={500} />
          </Field>
        </div>
      </Card>

      <Card title="Provident Fund (PF)" actions={<Checkbox label="Deduct PF" checked={s.pf.enabled} onChange={(e) => setS({ ...s, pf: { ...s.pf, enabled: e.target.checked } })} />}>
        <div className="grid gap-4 sm:grid-cols-4">
          <NumField id="pf-ee" label="Employee rate %" value={s.pf.employeeRatePercent} onChange={(v) => setS({ ...s, pf: { ...s.pf, employeeRatePercent: v } })} />
          <NumField id="pf-er" label="Employer rate %" value={s.pf.employerRatePercent} onChange={(v) => setS({ ...s, pf: { ...s.pf, employerRatePercent: v } })} />
          <NumField id="pf-cap" label="Wage ceiling (monthly)" value={s.pf.wageCeiling} onChange={(v) => setS({ ...s, pf: { ...s.pf, wageCeiling: v } })} />
          <div className="flex items-end pb-2">
            <Checkbox label="Cap PF wages at the ceiling" checked={s.pf.capAtCeiling} onChange={(e) => setS({ ...s, pf: { ...s.pf, capAtCeiling: e.target.checked } })} />
          </div>
          <Field label="PF wages are the sum of" htmlFor="pf-w" className="sm:col-span-4">{picker(s.pf.wageComponents, (v) => setS({ ...s, pf: { ...s.pf, wageComponents: v } }), 'pf-w')}</Field>
        </div>
        <div className="mt-3">{componentRow('PF')}</div>
        {problems('PF')}
      </Card>

      <Card title="Employees' State Insurance (ESI)" actions={<Checkbox label="Deduct ESI" checked={s.esi.enabled} onChange={(e) => setS({ ...s, esi: { ...s.esi, enabled: e.target.checked } })} />}>
        <div className="grid gap-4 sm:grid-cols-3">
          <NumField id="esi-ee" label="Employee rate %" value={s.esi.employeeRatePercent} onChange={(v) => setS({ ...s, esi: { ...s.esi, employeeRatePercent: v } })} />
          <NumField id="esi-er" label="Employer rate %" value={s.esi.employerRatePercent} onChange={(v) => setS({ ...s, esi: { ...s.esi, employerRatePercent: v } })} />
          <NumField id="esi-lim" label="Eligibility limit (monthly ESI wages)" value={s.esi.eligibilityLimit} onChange={(v) => setS({ ...s, esi: { ...s.esi, eligibilityLimit: v } })} hint="Above this, no ESI is deducted for the month." />
          <Field label="ESI wages are the sum of" htmlFor="esi-w" className="sm:col-span-3">{picker(s.esi.wageComponents, (v) => setS({ ...s, esi: { ...s.esi, wageComponents: v } }), 'esi-w')}</Field>
        </div>
        <div className="mt-3">{componentRow('ESI')}</div>
        {problems('ESI')}
      </Card>

      <Card title="Income tax (TDS)" actions={<Checkbox label="Deduct TDS" checked={s.tds.enabled} onChange={(e) => setS({ ...s, tds: { ...s.tds, enabled: e.target.checked } })} />}>
        <p className="mb-4 text-sm text-muted">
          Monthly TDS = tax on (monthly taxable earnings × 12 − standard deduction) by the slabs below, nil up to the rebate limit, plus cess, divided by 12. This projection does not know about investment declarations, previous employment or arrears: for those, enter the month&apos;s TDS in the override input column and it is used as entered.
        </p>
        <div className="grid gap-4 sm:grid-cols-4">
          <NumField id="tds-sd" label="Standard deduction (yearly)" value={s.tds.standardDeduction} onChange={(v) => setS({ ...s, tds: { ...s.tds, standardDeduction: v } })} />
          <NumField id="tds-reb" label="Rebate limit (yearly taxable income)" value={s.tds.rebateLimit} onChange={(v) => setS({ ...s, tds: { ...s.tds, rebateLimit: v } })} />
          <NumField id="tds-cess" label="Cess %" value={s.tds.cessPercent} onChange={(v) => setS({ ...s, tds: { ...s.tds, cessPercent: v } })} />
          <Field label="Override input column" htmlFor="tds-ov">
            <Select id="tds-ov" value={s.tds.overrideInputKey ?? ''} onChange={(e) => setS({ ...s, tds: { ...s.tds, overrideInputKey: e.target.value || null } })}>
              <option value="">None</option>
              {numericInputs.map((d) => (<option key={d.key} value={d.key}>{d.label}</option>))}
            </Select>
          </Field>
          <Field label="Taxable earnings are the sum of" htmlFor="tds-w" className="sm:col-span-4">{picker(s.tds.taxableComponents, (v) => setS({ ...s, tds: { ...s.tds, taxableComponents: v } }), 'tds-w')}</Field>
        </div>
        <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">Tax slabs (yearly taxable income)</h3>
        <SlabEditor slabs={s.tds.slabs} onChange={(slabs) => setS({ ...s, tds: { ...s.tds, slabs } })} />
        <div className="mt-3">{componentRow('TDS')}</div>
        {problems('TDS')}
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setS(q.data!.settings)}>Discard changes</Button>
        <Button icon={<Landmark className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate(s)}>Save statutory settings</Button>
      </div>
    </div>
  );
}

function NumField({ id, label, value, onChange, hint }: { id: string; label: string; value: Num; onChange: (v: Num) => void; hint?: string }) {
  const [text, setText] = useState(txt(value));
  useEffect(() => setText((t) => (num(t) === value ? t : txt(value))), [value]);
  const bad = text.trim() !== '' && !/^\d+(\.\d{1,4})?$/.test(text.trim());
  return (
    <Field label={label} htmlFor={id} hint={hint} error={bad ? 'Enter a number.' : undefined}>
      <Input id={id} inputMode="decimal" value={text} invalid={bad} onChange={(e) => { setText(e.target.value); if (!/[^\d.\s]/.test(e.target.value)) onChange(num(e.target.value)); }} />
    </Field>
  );
}

function SlabEditor({ slabs, onChange }: { slabs: Settings['tds']['slabs']; onChange: (s: Settings['tds']['slabs']) => void }) {
  const set = (i: number, patch: Partial<Settings['tds']['slabs'][number]>) => onChange(slabs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      {slabs.map((sl, i) => (
        <div key={i} className="flex flex-wrap items-end gap-3">
          <span className="w-24 pb-2 text-sm text-muted">{i === 0 ? 'From 0' : `Above ${slabs[i - 1].upTo ?? '—'}`}</span>
          <Field label="Up to (blank = no limit)" htmlFor={`slab-up-${i}`} className="w-52">
            <Input id={`slab-up-${i}`} inputMode="decimal" value={txt(sl.upTo)} onChange={(e) => set(i, { upTo: num(e.target.value) })} />
          </Field>
          <Field label="Rate %" htmlFor={`slab-rate-${i}`} className="w-28">
            <Input id={`slab-rate-${i}`} inputMode="decimal" value={String(sl.ratePercent)} onChange={(e) => set(i, { ratePercent: Number(e.target.value) || 0 })} />
          </Field>
          <Button size="sm" variant="ghost" aria-label={`Remove slab ${i + 1}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => onChange(slabs.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...slabs, { upTo: null, ratePercent: 0 }])}>Add slab</Button>
      {!slabs.length && <p className="text-xs text-muted">No slabs entered. The last slab must have no upper limit.</p>}
    </div>
  );
}
