'use client';
import { Fragment, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Beaker, ChevronDown, ChevronRight, Play } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, PageHeader, RequirePermission, Select, Spinner, StatCard, errorMessage, formatMoney, get, post, useToast } from '@nexzi/ui';
import { MONTHS, type SalaryTemplate } from '@/lib/types';

type Num = number | null;
interface Statutory {
  pf: { enabled: boolean; employeeRatePercent: Num; employerRatePercent: Num; wageComponents: string[]; wageCeiling: Num; capAtCeiling: boolean };
  esi: { enabled: boolean; employeeRatePercent: Num; employerRatePercent: Num; wageComponents: string[]; eligibilityLimit: Num };
  wageBand: { enabled: boolean; threshold: Num };
  [k: string]: unknown;
}
interface Context {
  settings: { statutory: Statutory; proration: { enabled: boolean }; gratuity: { enabled: boolean; ratePercent: number; baseComponents: string[] }; salaryTemplate: SalaryTemplate };
  runs: { id: string; period: string; status: string; year: number; month: number }[];
  components: { code: string; name: string; type: string; basis: string; defaultPercentage: string | null }[];
  numericInputs: { key: string; label: string }[];
}
interface Row {
  employeeCode: string;
  employeeName: string;
  department: string | null;
  grossBefore: string;
  grossAfter: string;
  netBefore: string;
  netAfter: string;
  netChange: string;
  netChangePercent: number;
  employerBefore: string;
  employerAfter: string;
  errors: string[];
  lineDiffs: { code: string; name: string; before: string; after: string }[];
  flags: string[];
}
interface LabResult {
  source: string;
  notes: string[];
  summary: { employees: number; changed: number; increased: number; decreased: number; flagged: number; newErrors: number; netBefore: string; netAfter: string; costBefore: string; costAfter: string; costChange: string; largestIncrease: string; largestDecrease: string };
  distribution: { label: string; count: number }[];
  rows: Row[];
}

const num = (v: string): Num => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));
const signed = (v: string | number) => (Number(v) > 0 ? `+${formatMoney(v)}` : formatMoney(v));

export default function PolicyLabPage() {
  return (
    <RequirePermission permission={['settings.manage', 'payroll.view_amounts']}>
      <PageHeader
        title="Payroll policy testing lab"
        description="Test a proposed salary structure, PF / ESI rule, proration, gratuity or overtime policy against a past month or synthetic employees before switching it on. Nothing is saved."
        breadcrumbs={[{ label: 'Payroll settings', href: '/settings' }, { label: 'Policy lab' }]}
      />
      <Lab />
    </RequirePermission>
  );
}

function Lab() {
  const toast = useToast();
  const ctx = useQuery({ queryKey: ['policy-lab-context'], queryFn: () => get<Context>('/policy-lab/context') });
  const [sourceType, setSourceType] = useState<'RUN' | 'SYNTHETIC'>('RUN');
  const [runId, setRunId] = useState('');
  const [syn, setSyn] = useState({ count: 25, minGross: 12000, maxGross: 150000 });
  const [st, setSt] = useState<Statutory | null>(null);
  const [proration, setProration] = useState(true);
  const [gratuityRate, setGratuityRate] = useState('4.81');
  const [gratuityOn, setGratuityOn] = useState(true);
  const [template, setTemplate] = useState<SalaryTemplate | null>(null);
  const [regenerate, setRegenerate] = useState(false);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [overtime, setOvertime] = useState<{ inputKey: string; multiplier: string } | null>(null);
  const [flagPercent, setFlagPercent] = useState('5');
  const [result, setResult] = useState<LabResult | null>(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const c = ctx.data;
    if (!c || st) return;
    setSt(c.settings.statutory);
    setProration(c.settings.proration.enabled);
    setGratuityOn(c.settings.gratuity.enabled);
    setGratuityRate(String(c.settings.gratuity.ratePercent));
    setTemplate(c.settings.salaryTemplate);
    setRunId(c.runs[0]?.id ?? '');
    if (!c.runs.length) setSourceType('SYNTHETIC');
  }, [ctx.data, st]);

  if (ctx.isLoading || (!st && !ctx.error)) return <Spinner />;
  if (ctx.error) return <ErrorState message={errorMessage(ctx.error)} onRetry={() => ctx.refetch()} />;
  const c = ctx.data!;
  const s = st!;
  const pctComponents = c.components.filter((x) => x.basis === 'PERCENTAGE');
  const latest = c.runs[0];

  const test = async () => {
    setRunning(true);
    try {
      const now = new Date();
      const source = sourceType === 'RUN' ? { type: 'RUN', runId } : { type: 'SYNTHETIC', ...syn, year: latest?.year ?? now.getFullYear(), month: latest?.month ?? now.getMonth() + 1 };
      const componentRates = Object.entries(rates)
        .filter(([, v]) => v.trim() !== '')
        .map(([code, v]) => ({ code, ratePercent: Number(v) }));
      const policy = {
        statutory: s,
        proration: { enabled: proration },
        gratuity: { ...c.settings.gratuity, enabled: gratuityOn, ratePercent: Number(gratuityRate) || 0 },
        salaryTemplate: template,
        regenerateStructures: regenerate,
        componentRates,
        overtime: overtime && overtime.inputKey ? { inputKey: overtime.inputKey, multiplier: Number(overtime.multiplier) || 0 } : null,
      };
      setResult(await post<LabResult>('/policy-lab/test', { source, policy, flagPercent: Number(flagPercent) || 5 }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };
  const setPf = (patch: Partial<Statutory['pf']>) => setSt({ ...s, pf: { ...s.pf, ...patch } });
  const setEsi = (patch: Partial<Statutory['esi']>) => setSt({ ...s, esi: { ...s.esi, ...patch } });

  return (
    <div className="grid gap-6 2xl:grid-cols-[460px_1fr]">
      <div className="space-y-6">
        <Card title="Test against">
          <div className="space-y-3">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="src" checked={sourceType === 'RUN'} disabled={!c.runs.length} onChange={() => setSourceType('RUN')} /> A past payroll month
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="src" checked={sourceType === 'SYNTHETIC'} onChange={() => setSourceType('SYNTHETIC')} /> Synthetic employees
              </label>
            </div>
            {sourceType === 'RUN' ? (
              <Select aria-label="Payroll month" value={runId} onChange={(e) => setRunId(e.target.value)}>
                {c.runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.period} · {r.status.toLowerCase().replace('_', ' ')}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Field label="Employees" htmlFor="sy-n">
                  <Input id="sy-n" type="number" min={1} max={500} value={syn.count} onChange={(e) => setSyn({ ...syn, count: Number(e.target.value) || 1 })} />
                </Field>
                <Field label="Lowest gross" htmlFor="sy-min">
                  <Input id="sy-min" inputMode="decimal" value={syn.minGross} onChange={(e) => setSyn({ ...syn, minGross: Number(e.target.value) || 0 })} />
                </Field>
                <Field label="Highest gross" htmlFor="sy-max">
                  <Input id="sy-max" inputMode="decimal" value={syn.maxGross} onChange={(e) => setSyn({ ...syn, maxGross: Number(e.target.value) || 0 })} />
                </Field>
                <p className="col-span-3 text-xs text-muted">Employees are spread evenly across the range and built with the {regenerate ? 'proposed' : 'current'} salary structure template{latest ? `, for ${MONTHS[latest.month - 1]} ${latest.year}` : ''}.</p>
              </div>
            )}
          </div>
        </Card>

        <Card title="Proposed policy">
          <div className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-ink">PF / ESI</legend>
              <div className="flex flex-wrap gap-4">
                <Checkbox label="PF on" checked={s.pf.enabled} onChange={(e) => setPf({ enabled: e.target.checked })} />
                <Checkbox label="ESI on" checked={s.esi.enabled} onChange={(e) => setEsi({ enabled: e.target.checked })} />
                <Checkbox label="Wage band (ESI at or below, PF above)" checked={s.wageBand.enabled} onChange={(e) => setSt({ ...s, wageBand: { ...s.wageBand, enabled: e.target.checked } })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Band threshold (₹)" htmlFor="pl-band">
                  <Input id="pl-band" inputMode="decimal" value={s.wageBand.threshold ?? ''} onChange={(e) => setSt({ ...s, wageBand: { ...s.wageBand, threshold: num(e.target.value) } })} />
                </Field>
                <Field label="PF wage ceiling (₹)" htmlFor="pl-ceil">
                  <Input id="pl-ceil" inputMode="decimal" value={s.pf.wageCeiling ?? ''} onChange={(e) => setPf({ wageCeiling: num(e.target.value) })} />
                </Field>
                <Field label="PF employee / employer %" htmlFor="pl-pf">
                  <div className="flex gap-2">
                    <Input id="pl-pf" inputMode="decimal" value={s.pf.employeeRatePercent ?? ''} onChange={(e) => setPf({ employeeRatePercent: num(e.target.value) })} />
                    <Input aria-label="PF employer %" inputMode="decimal" value={s.pf.employerRatePercent ?? ''} onChange={(e) => setPf({ employerRatePercent: num(e.target.value) })} />
                  </div>
                </Field>
                <Field label="ESI employee / employer %" htmlFor="pl-esi">
                  <div className="flex gap-2">
                    <Input id="pl-esi" inputMode="decimal" value={s.esi.employeeRatePercent ?? ''} onChange={(e) => setEsi({ employeeRatePercent: num(e.target.value) })} />
                    <Input aria-label="ESI employer %" inputMode="decimal" value={s.esi.employerRatePercent ?? ''} onChange={(e) => setEsi({ employerRatePercent: num(e.target.value) })} />
                  </div>
                </Field>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-ink">Salary structure</legend>
              {template?.lines.filter((l) => l.method === 'PERCENT_OF_GROSS').map((l) => (
                <Field key={l.code} label={`${l.code} — % of gross`} htmlFor={`pl-t-${l.code}`}>
                  <Input id={`pl-t-${l.code}`} inputMode="decimal" value={l.value ?? ''} onChange={(e) => setTemplate({ ...template, lines: template.lines.map((x) => (x.code === l.code ? { ...x, value: num(e.target.value) } : x)) })} />
                </Field>
              ))}
              <Checkbox label="Re-split each employee's gross with this structure" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} />
              {pctComponents.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                  {pctComponents.map((p) => (
                    <Field key={p.code} label={`${p.name} rate %`} htmlFor={`pl-r-${p.code}`} hint={`Now: ${p.defaultPercentage ?? 'per employee'}`}>
                      <Input id={`pl-r-${p.code}`} inputMode="decimal" placeholder="unchanged" value={rates[p.code] ?? ''} onChange={(e) => setRates({ ...rates, [p.code]: e.target.value })} />
                    </Field>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-ink">Pay days, gratuity and overtime</legend>
              <Checkbox label="Pro-rate fixed earnings by days payable" checked={proration} onChange={(e) => setProration(e.target.checked)} />
              <div className="flex items-end gap-3">
                <Checkbox label="Gratuity accrual" checked={gratuityOn} onChange={(e) => setGratuityOn(e.target.checked)} />
                <Field label="Rate %" htmlFor="pl-g" className="w-28">
                  <Input id="pl-g" inputMode="decimal" value={gratuityRate} onChange={(e) => setGratuityRate(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Overtime hours come from" htmlFor="pl-ot">
                  <Select id="pl-ot" value={overtime?.inputKey ?? ''} onChange={(e) => setOvertime(e.target.value ? { inputKey: e.target.value, multiplier: overtime?.multiplier ?? '2' } : null)}>
                    <option value="">No overtime policy</option>
                    {c.numericInputs.map((i) => (
                      <option key={i.key} value={i.key}>
                        {i.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Overtime multiplier" htmlFor="pl-otm">
                  <Input id="pl-otm" inputMode="decimal" disabled={!overtime} value={overtime?.multiplier ?? ''} onChange={(e) => overtime && setOvertime({ ...overtime, multiplier: e.target.value })} />
                </Field>
              </div>
            </fieldset>

            <div className="flex items-end justify-between gap-3 border-t border-line pt-4">
              <Field label="Flag net changes of at least (%)" htmlFor="pl-flag" className="w-48">
                <Input id="pl-flag" inputMode="decimal" value={flagPercent} onChange={(e) => setFlagPercent(e.target.value)} />
              </Field>
              <Button icon={<Play className="h-4 w-4" />} loading={running} disabled={sourceType === 'RUN' && !runId} onClick={test}>
                Run test
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        {!result ? (
          <Card>
            <EmptyState icon={<Beaker className="h-6 w-6" />} title="Nothing tested yet" hint="Change the policy on the left and run a test. Each employee is calculated with today's rules and with the proposal, side by side." />
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted">Tested on {result.source}.</p>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Employees whose pay changes" value={`${result.summary.changed} / ${result.summary.employees}`} hint={`${result.summary.increased} up · ${result.summary.decreased} down`} />
              <StatCard label="Flagged for review" value={result.summary.flagged} tone={result.summary.flagged ? 'attention' : 'default'} hint={result.summary.newErrors ? `${result.summary.newErrors} new calculation error(s)` : undefined} />
              <StatCard label="Monthly cost to company" value={signed(result.summary.costChange)} hint={`${formatMoney(result.summary.costBefore)} → ${formatMoney(result.summary.costAfter)}`} />
              <StatCard label="Largest net change" value={`${signed(result.summary.largestIncrease)}`} hint={`Largest drop ${formatMoney(result.summary.largestDecrease)}`} />
            </div>
            {result.notes.length > 0 && (
              <Alert tone="info">
                <ul className="ml-4 list-disc">
                  {result.notes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </Alert>
            )}
            <Card title="Change in net pay — how many employees">
              <div className="h-52 w-full">
                <ResponsiveContainer>
                  <BarChart data={result.distribution} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e3e7ef" />
                    <XAxis dataKey="label" tickLine={false} tick={{ fill: '#6c7293', fontSize: 11 }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fill: '#6c7293', fontSize: 12 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#e3e7ef', fontSize: 12 }} />
                    <Bar dataKey="count" name="Employees" fill="#2557c4" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Per employee (flagged first)" padded={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-mist/35 text-left text-xs uppercase tracking-wide text-primary">
                    <tr>
                      <th className="px-3 py-2">Employee</th>
                      <th className="px-3 py-2 text-right">Net now</th>
                      <th className="px-3 py-2 text-right">Net proposed</th>
                      <th className="px-3 py-2 text-right">Change</th>
                      <th className="px-3 py-2">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <Fragment key={r.employeeCode}>
                        <tr className="cursor-pointer border-t border-line hover:bg-mist/30" onClick={() => setOpen(open === r.employeeCode ? null : r.employeeCode)}>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1">
                              {open === r.employeeCode ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              {r.employeeCode} · {r.employeeName}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.netBefore)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.netAfter)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${Number(r.netChange) < 0 ? 'text-danger' : ''}`}>
                            {signed(r.netChange)} <span className="text-xs text-muted">({r.netChangePercent}%)</span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {r.flags.map((f) => (
                                <Badge key={f} tone={f.startsWith('New calculation') || f.startsWith('Negative') ? 'danger' : 'warning'}>
                                  {f}
                                </Badge>
                              ))}
                            </div>
                          </td>
                        </tr>
                        {open === r.employeeCode && (
                          <tr className="bg-surface">
                            <td colSpan={5} className="px-6 py-3">
                              {r.errors.map((e) => (
                                <p key={e} className="text-sm text-danger">
                                  {e}
                                </p>
                              ))}
                              {r.lineDiffs.length ? (
                                <table className="text-sm">
                                  <tbody>
                                    {r.lineDiffs.map((l) => (
                                      <tr key={l.code}>
                                        <td className="pr-6">{l.name}</td>
                                        <td className="pr-3 text-right tabular-nums text-muted">{formatMoney(l.before)}</td>
                                        <td className="pr-3">→</td>
                                        <td className="text-right tabular-nums font-medium">{formatMoney(l.after)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <p className="text-sm text-muted">No component changes.</p>
                              )}
                              <p className="mt-2 text-xs text-muted">
                                Employer PF / ESI / gratuity: {formatMoney(r.employerBefore)} → {formatMoney(r.employerAfter)}
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
