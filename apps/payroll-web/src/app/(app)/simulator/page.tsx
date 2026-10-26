'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FlaskConical, Play, Plus, Save, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, Card, Checkbox, DataTable, Dialog, EmptyState, Field, Input, PageHeader, RequirePermission, Select, StatCard, Textarea, del, errorMessage, formatMoney, get, post, useToast } from '@nexzi/ui';
import { MONTHS } from '@/lib/types';

interface Scenario {
  year?: number;
  month?: number;
  horizonMonths: number;
  incrementPercent: number;
  departmentIncrements: { department: string; percent: number }[];
  newHires: { label: string; department: string | null; count: number; monthlyGross: number }[];
  bonusPercentOfGross: number;
  bonusFlat: number;
  overtimeHours: number;
  overtimeMultiplier: number;
  removeDepartments: string[];
  headcountReductionPercent: number;
}
interface Totals {
  headcount: number;
  gross: string;
  deductions: string;
  net: string;
  employerCost: string;
  costToCompany: string;
  errors: number;
}
interface SimResult {
  period: string;
  horizonMonths: number;
  baseline: Totals;
  scenario: Totals;
  delta: { headcount: number; gross: string; net: string; employerCost: string; costToCompany: string; costToCompanyPercent: number | null; grossPercent: number | null };
  projection: { baseline: { costToCompany: string }; scenario: { costToCompany: string }; difference: string };
  departments: { department: string; baseline: Totals | null; scenario: Totals | null }[];
  employeeChanges: { employeeCode: string; employeeName: string; department: string | null; synthetic: boolean; grossBefore: string | null; grossAfter: string; change: string }[];
  notes: string[];
}
interface Saved {
  id: string;
  name: string;
  description: string | null;
  config: Scenario;
  createdByName: string | null;
  updatedAt: string;
}

const EMPTY: Scenario = { horizonMonths: 12, incrementPercent: 0, departmentIncrements: [], newHires: [], bonusPercentOfGross: 0, bonusFlat: 0, overtimeHours: 0, overtimeMultiplier: 2, removeDepartments: [], headcountReductionPercent: 0 };
const n = (v: string) => (v.trim() === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const signed = (v: string | number) => (Number(v) > 0 ? `+${formatMoney(v)}` : formatMoney(v));

export default function SimulatorPage() {
  return (
    <RequirePermission permission="payroll.view_amounts">
      <PageHeader
        title="Payroll digital twin"
        description="Simulate increments, new hires, bonuses, overtime and restructuring on a copy of the live workforce. Nothing here changes payroll records."
        breadcrumbs={[{ label: 'Analytics', href: '/analytics' }, { label: 'Digital twin' }]}
      />
      <Simulator />
    </RequirePermission>
  );
}

function Simulator() {
  const toast = useToast();
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['sim-options'], queryFn: () => get<{ period: { year: number; month: number }; departments: string[] }>('/simulator/options') });
  const saved = useQuery({ queryKey: ['sim-scenarios'], queryFn: () => get<Saved[]>('/simulator/scenarios') });
  const [s, setS] = useState<Scenario>(EMPTY);
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<{ name: string; r: SimResult }[] | null>(null);
  useEffect(() => {
    if (opts.data && s.year === undefined) setS((x) => ({ ...x, ...opts.data.period }));
  }, [opts.data, s.year]);
  const depts = opts.data?.departments ?? [];

  const run = async (config = s) => {
    setRunning(true);
    try {
      setResult(await post<SimResult>('/simulator/run', config));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };
  const compare = async () => {
    setRunning(true);
    try {
      const picks = (saved.data ?? []).filter((x) => compareIds.includes(x.id));
      setComparison(await Promise.all(picks.map(async (p) => ({ name: p.name, r: await post<SimResult>('/simulator/run', p.config) }))));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await del(`/simulator/scenarios/${id}`);
      await qc.invalidateQueries({ queryKey: ['sim-scenarios'] });
      setCompareIds((c) => c.filter((x) => x !== id));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-6 2xl:grid-cols-[440px_1fr]">
      <div className="space-y-6">
        <Card title="Scenario">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Start month" htmlFor="sm" className="col-span-2">
                <div className="flex gap-2">
                  <Select id="sm" value={s.month ?? ''} onChange={(e) => setS({ ...s, month: Number(e.target.value) })}>
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </Select>
                  <Input aria-label="Year" type="number" className="w-24" value={s.year ?? ''} onChange={(e) => setS({ ...s, year: Number(e.target.value) })} />
                </div>
              </Field>
              <Field label="Project over (months)" htmlFor="hz">
                <Input id="hz" type="number" min={1} max={36} value={s.horizonMonths} onChange={(e) => setS({ ...s, horizonMonths: Math.max(1, n(e.target.value)) })} />
              </Field>
            </div>
            <Field label="Increment for everyone (%)" htmlFor="inc" hint="Scales fixed earnings; percentage components follow their base.">
              <Input id="inc" inputMode="decimal" value={String(s.incrementPercent)} onChange={(e) => setS({ ...s, incrementPercent: n(e.target.value) })} />
            </Field>
            <ListEditor
              title="Extra increment by department"
              rows={s.departmentIncrements}
              onAdd={() => setS({ ...s, departmentIncrements: [...s.departmentIncrements, { department: depts[0] ?? '', percent: 5 }] })}
              onRemove={(i) => setS({ ...s, departmentIncrements: s.departmentIncrements.filter((_, j) => j !== i) })}
              render={(row, i) => (
                <>
                  <Select aria-label="Department" value={row.department} onChange={(e) => setS({ ...s, departmentIncrements: s.departmentIncrements.map((x, j) => (j === i ? { ...x, department: e.target.value } : x)) })}>
                    {depts.map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </Select>
                  <Input aria-label="Percent" className="w-24" inputMode="decimal" value={String(row.percent)} onChange={(e) => setS({ ...s, departmentIncrements: s.departmentIncrements.map((x, j) => (j === i ? { ...x, percent: n(e.target.value) } : x)) })} />
                  <span className="text-sm text-muted">%</span>
                </>
              )}
            />
            <ListEditor
              title="New hires (salary split by the structure template)"
              rows={s.newHires}
              onAdd={() => setS({ ...s, newHires: [...s.newHires, { label: 'New hire', department: depts[0] ?? null, count: 1, monthlyGross: 30000 }] })}
              onRemove={(i) => setS({ ...s, newHires: s.newHires.filter((_, j) => j !== i) })}
              render={(row, i) => {
                const set = (patch: Partial<Scenario['newHires'][number]>) => setS({ ...s, newHires: s.newHires.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <>
                    <Input aria-label="Count" className="w-16" type="number" min={1} value={row.count} onChange={(e) => set({ count: Math.max(1, n(e.target.value)) })} />
                    <span className="text-sm text-muted">×</span>
                    <Input aria-label="Monthly gross" className="w-28" inputMode="decimal" value={String(row.monthlyGross)} onChange={(e) => set({ monthlyGross: n(e.target.value) })} />
                    <Select aria-label="Department" value={row.department ?? ''} onChange={(e) => set({ department: e.target.value || null })}>
                      <option value="">No department</option>
                      {depts.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </Select>
                  </>
                );
              }}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bonus (% of gross)" htmlFor="bp">
                <Input id="bp" inputMode="decimal" value={String(s.bonusPercentOfGross)} onChange={(e) => setS({ ...s, bonusPercentOfGross: n(e.target.value) })} />
              </Field>
              <Field label="Bonus (flat ₹ each)" htmlFor="bf">
                <Input id="bf" inputMode="decimal" value={String(s.bonusFlat)} onChange={(e) => setS({ ...s, bonusFlat: n(e.target.value) })} />
              </Field>
              <Field label="Overtime hours / employee" htmlFor="oh">
                <Input id="oh" inputMode="decimal" value={String(s.overtimeHours)} onChange={(e) => setS({ ...s, overtimeHours: n(e.target.value) })} />
              </Field>
              <Field label="Overtime multiplier" htmlFor="om" hint="× hourly (gross ÷ 208 h)">
                <Input id="om" inputMode="decimal" value={String(s.overtimeMultiplier)} onChange={(e) => setS({ ...s, overtimeMultiplier: n(e.target.value) })} />
              </Field>
            </div>
            <fieldset className="space-y-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink">Restructuring</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {depts.map((d) => (
                  <Checkbox key={d} label={`Close ${d}`} checked={s.removeDepartments.includes(d)} onChange={(e) => setS({ ...s, removeDepartments: e.target.checked ? [...s.removeDepartments, d] : s.removeDepartments.filter((x) => x !== d) })} />
                ))}
              </div>
              <Field label="Reduce remaining headcount by (%)" htmlFor="hr" hint="Latest joiners first.">
                <Input id="hr" inputMode="decimal" value={String(s.headcountReductionPercent)} onChange={(e) => setS({ ...s, headcountReductionPercent: Math.min(100, n(e.target.value)) })} />
              </Field>
            </fieldset>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setS({ ...EMPTY, year: s.year, month: s.month })}>
                Reset
              </Button>
              <Button variant="secondary" icon={<Save className="h-4 w-4" />} onClick={() => setSaveOpen(true)}>
                Save
              </Button>
              <Button icon={<Play className="h-4 w-4" />} loading={running} onClick={() => run()}>
                Simulate
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Saved scenarios">
          {!saved.data?.length ? (
            <p className="text-sm text-muted">Save scenarios to compare budgets side by side.</p>
          ) : (
            <ul className="space-y-2">
              {saved.data.map((x) => (
                <li key={x.id} className="flex items-center gap-2 rounded-md border border-line p-2">
                  <Checkbox label="" aria-label={`Compare ${x.name}`} checked={compareIds.includes(x.id)} onChange={(e) => setCompareIds(e.target.checked ? [...compareIds, x.id].slice(-4) : compareIds.filter((id) => id !== x.id))} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => { setS({ ...EMPTY, ...x.config }); run({ ...EMPTY, ...x.config }); }}>
                    <span className="block truncate font-medium text-ink">{x.name}</span>
                    {x.description && <span className="block truncate text-xs text-muted">{x.description}</span>}
                  </button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${x.name}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => remove(x.id)} />
                </li>
              ))}
            </ul>
          )}
          {compareIds.length >= 2 && (
            <Button className="mt-3 w-full" variant="secondary" loading={running} onClick={compare}>
              Compare {compareIds.length} scenarios
            </Button>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        {comparison && <Comparison items={comparison} onClose={() => setComparison(null)} />}
        {!result ? (
          <Card>
            <EmptyState icon={<FlaskConical className="h-6 w-6" />} title="Run a simulation" hint="Adjust the scenario and press Simulate. The baseline is the live workforce and salary structures for the start month." />
          </Card>
        ) : (
          <Results r={result} />
        )}
      </div>
      <SaveDialog open={saveOpen} onClose={() => setSaveOpen(false)} config={s} />
    </div>
  );
}

function ListEditor<T>({ title, rows, onAdd, onRemove, render }: { title: string; rows: T[]; onAdd: () => void; onRemove: (i: number) => void; render: (row: T, i: number) => ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{title}</span>
        <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={onAdd}>
          Add
        </Button>
      </div>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            {render(row, i)}
            <Button size="sm" variant="ghost" aria-label="Remove" icon={<Trash2 className="h-4 w-4" />} onClick={() => onRemove(i)} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Results({ r }: { r: SimResult }) {
  const up = Number(r.delta.costToCompany) > 0;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`Monthly cost to company · ${r.period}`} value={formatMoney(r.scenario.costToCompany)} hint={`Baseline ${formatMoney(r.baseline.costToCompany)}`} />
        <StatCard label="Change per month" value={signed(r.delta.costToCompany)} hint={r.delta.costToCompanyPercent === null ? undefined : `${r.delta.costToCompanyPercent > 0 ? '+' : ''}${r.delta.costToCompanyPercent}%`} tone={up ? 'attention' : 'default'} />
        <StatCard label={`Change over ${r.horizonMonths} months`} value={signed(r.projection.difference)} hint={`${formatMoney(r.projection.scenario.costToCompany)} total`} tone={up ? 'attention' : 'default'} />
        <StatCard label="Headcount" value={r.scenario.headcount} hint={`${r.delta.headcount >= 0 ? '+' : ''}${r.delta.headcount} vs ${r.baseline.headcount}`} />
      </div>
      {r.notes.length > 0 && (
        <Alert tone="info">
          <ul className="ml-4 list-disc">
            {r.notes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Alert>
      )}
      {(r.baseline.errors > 0 || r.scenario.errors > 0) && <Alert tone="warning">{r.scenario.errors} employee(s) could not be calculated (for example, no salary structure) and are left out of the totals.</Alert>}
      <Card title="Baseline vs scenario (monthly)" padded={false}>
        <table className="w-full text-sm">
          <thead className="bg-mist/35 text-left text-xs uppercase tracking-wide text-primary">
            <tr>
              <th className="px-3 py-2" />
              <th className="px-3 py-2 text-right">Baseline</th>
              <th className="px-3 py-2 text-right">Scenario</th>
              <th className="px-3 py-2 text-right">Difference</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Gross pay', 'gross'],
                ['Employee deductions', 'deductions'],
                ['Net pay', 'net'],
                ['Employer PF / ESI / gratuity', 'employerCost'],
                ['Cost to company', 'costToCompany'],
              ] as const
            ).map(([label, k]) => (
              <tr key={k} className={`border-t border-line ${k === 'costToCompany' ? 'bg-surface font-semibold' : ''}`}>
                <td className="px-3 py-2">{label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.baseline[k])}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.scenario[k])}</td>
                <td className="px-3 py-2 text-right tabular-nums">{signed(Number(r.scenario[k]) - Number(r.baseline[k]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Cost to company by department">
        <div className="h-64 w-full">
          <ResponsiveContainer>
            <BarChart data={r.departments.map((d) => ({ name: d.department, Baseline: Number(d.baseline?.costToCompany ?? 0), Scenario: Number(d.scenario?.costToCompany ?? 0) }))} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e3e7ef" />
              <XAxis dataKey="name" tickLine={false} tick={{ fill: '#6c7293', fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: '#6c7293', fontSize: 12 }} width={72} tickFormatter={(v: number) => formatMoney(v, 0)} />
              <Tooltip formatter={(v) => formatMoney(Number(v))} contentStyle={{ borderRadius: 8, borderColor: '#e3e7ef', fontSize: 12 }} />
              <Legend />
              <Bar dataKey="Baseline" fill="#9dbbe6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Scenario" fill="#1e40af" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Biggest changes by employee" padded={false}>
        <DataTable
          caption="Employee changes"
          dense
          rows={r.employeeChanges.slice(0, 50)}
          rowKey={(x) => x.employeeCode}
          columns={[
            { key: 'e', header: 'Employee', render: (x) => <span>{x.employeeCode} · {x.employeeName} {x.synthetic && <Badge tone="info">new hire</Badge>}</span> },
            { key: 'd', header: 'Department', render: (x) => x.department ?? '—' },
            { key: 'b', header: 'Gross before', align: 'right', render: (x) => (x.grossBefore === null ? '—' : formatMoney(x.grossBefore)) },
            { key: 'a', header: 'Gross after', align: 'right', render: (x) => formatMoney(x.grossAfter) },
            { key: 'c', header: 'Change', align: 'right', render: (x) => <strong className={Number(x.change) < 0 ? 'text-danger' : ''}>{signed(x.change)}</strong> },
          ]}
        />
      </Card>
    </>
  );
}

function Comparison({ items, onClose }: { items: { name: string; r: SimResult }[]; onClose: () => void }) {
  const base = items[0]?.r.baseline;
  return (
    <Card title="Scenario comparison (monthly cost to company)" actions={<Button size="sm" variant="ghost" onClick={onClose}>Close</Button>} padded={false}>
      <table className="w-full text-sm">
        <thead className="bg-mist/35 text-left text-xs uppercase tracking-wide text-primary">
          <tr>
            <th className="px-3 py-2">Scenario</th>
            <th className="px-3 py-2 text-right">Headcount</th>
            <th className="px-3 py-2 text-right">Gross</th>
            <th className="px-3 py-2 text-right">Cost to company</th>
            <th className="px-3 py-2 text-right">vs baseline</th>
            <th className="px-3 py-2 text-right">Over horizon</th>
          </tr>
        </thead>
        <tbody>
          {base && (
            <tr className="border-t border-line text-muted">
              <td className="px-3 py-2">Baseline (live)</td>
              <td className="px-3 py-2 text-right">{base.headcount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(base.gross)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(base.costToCompany)}</td>
              <td className="px-3 py-2 text-right">—</td>
              <td className="px-3 py-2 text-right">—</td>
            </tr>
          )}
          {items.map(({ name, r }) => (
            <tr key={name} className="border-t border-line">
              <td className="px-3 py-2 font-medium">{name}</td>
              <td className="px-3 py-2 text-right">{r.scenario.headcount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.scenario.gross)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.scenario.costToCompany)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {signed(r.delta.costToCompany)} {r.delta.costToCompanyPercent !== null && <span className="text-muted">({r.delta.costToCompanyPercent}%)</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{signed(r.projection.difference)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function SaveDialog({ open, onClose, config }: { open: boolean; onClose: () => void; config: Scenario }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (name.trim().length < 2) return toast.error('Give the scenario a name.');
    setSaving(true);
    try {
      await post('/simulator/scenarios', { name: name.trim(), description: description.trim() || null, config });
      await qc.invalidateQueries({ queryKey: ['sim-scenarios'] });
      toast.success('Scenario saved.');
      setName('');
      setDescription('');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title="Save scenario" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" htmlFor="sc-name" required>
          <Input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="FY27 budget — 8% increment + 10 hires" />
        </Field>
        <Field label="Notes" htmlFor="sc-desc">
          <Textarea id="sc-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
