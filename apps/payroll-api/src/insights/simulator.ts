/**
 * Payroll digital twin: simulate increments, new hires, bonuses, overtime and restructuring on a
 * copy of the live workforce and compare the cost with the baseline. Simulations run entirely in
 * memory through the real calculation engine; live payroll records are never changed.
 */
import { z } from 'zod';
import { AppError, Dec, dec, idParam, money, notFound, roundTo, type ApiRegistry } from '@nexzi/server-core';
import { prisma, type Prisma } from '../db';
import { audit } from '../audit';
import { getSettings } from '../settings';
import { periodLabel } from '../payroll/service';
import { applyTemplate } from '../modules/salary-template';
import { defaultPeriod, livePopulation, simulate, totalsOf, type Population, type SimEmployee, type SimResult } from './calc';

const pct = z.number().min(-90).max(500);
export const scenarioSchema = z.object({
  /** Month whose salary structures and inputs are used as the starting point */
  year: z.number().int().min(2000).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  /** Months the monthly cost is projected over (e.g. 12 for a yearly budget) */
  horizonMonths: z.number().int().min(1).max(36).default(12),
  incrementPercent: pct.default(0),
  departmentIncrements: z.array(z.object({ department: z.string().max(120), percent: pct })).max(50).default([]),
  newHires: z.array(z.object({ label: z.string().max(80).default('New hire'), department: z.string().max(120).nullable().default(null), count: z.number().int().min(1).max(1000), monthlyGross: z.number().positive().max(10_000_000) })).max(30).default([]),
  /** One-off bonus as % of each employee's gross, plus a flat amount per employee */
  bonusPercentOfGross: z.number().min(0).max(500).default(0),
  bonusFlat: z.number().min(0).max(10_000_000).default(0),
  /** Overtime hours per employee per month, paid at hourly rate × multiplier (hourly = gross ÷ (26 × 8)) */
  overtimeHours: z.number().min(0).max(300).default(0),
  overtimeMultiplier: z.number().min(0).max(5).default(2),
  /** Restructuring: remove whole departments and/or a share of the remaining headcount (latest joiners first) */
  removeDepartments: z.array(z.string().max(120)).max(50).default([]),
  headcountReductionPercent: z.number().min(0).max(100).default(0),
});
export type Scenario = z.infer<typeof scenarioSchema>;

const SIM_BONUS = 'SIM_BONUS';
const SIM_OVERTIME = 'SIM_OVERTIME';
const simComponent = (code: string, name: string, sortOrder: number) => ({ id: code, code, name, type: 'EARNING' as const, basis: 'FIXED' as const, percentOfCode: null, defaultPercentage: null, inputKey: null, formulaRef: null, sortOrder, showOnPayslip: true });

/** Sum of FIXED earnings, used as the "gross" for bonus and overtime when no template gross exists. */
function fixedGross(e: SimEmployee, pop: Population) {
  const fixed = new Set(pop.components.filter((c) => c.type === 'EARNING' && c.basis === 'FIXED').map((c) => c.code));
  return Object.entries(e.salaryValues ?? {}).reduce((acc, [code, v]) => (fixed.has(code) ? acc.add(dec(v)) : acc), new Dec(0));
}

async function applyScenario(base: Population, s: Scenario): Promise<{ pop: Population; notes: string[] }> {
  const notes: string[] = [];
  const settings = await getSettings();
  const componentRows = await prisma.salaryComponent.findMany();
  const earningFixed = new Set(base.components.filter((c) => c.type === 'EARNING' && c.basis === 'FIXED').map((c) => c.code));
  const deptPct = new Map(s.departmentIncrements.map((d) => [d.department.toLowerCase(), d.percent]));
  const removed = new Set(s.removeDepartments.map((d) => d.toLowerCase()));

  let employees = base.employees.filter((e) => !removed.has((e.department ?? '').toLowerCase()));
  if (s.removeDepartments.length) notes.push(`${base.employees.length - employees.length} employee(s) removed with departments ${s.removeDepartments.join(', ')}.`);
  if (s.headcountReductionPercent > 0) {
    const cut = Math.round((employees.length * s.headcountReductionPercent) / 100);
    const latest = [...employees].sort((a, b) => b.joiningDate.getTime() - a.joiningDate.getTime()).slice(0, cut).map((e) => e.employeeId);
    employees = employees.filter((e) => !latest.includes(e.employeeId));
    notes.push(`${cut} employee(s) removed by the ${s.headcountReductionPercent}% headcount reduction (latest joiners first).`);
  }

  // Increments scale FIXED earnings; percentage components follow their base automatically.
  employees = employees.map((e) => {
    const p = s.incrementPercent + (deptPct.get((e.department ?? '').toLowerCase()) ?? 0);
    if (!p || !e.salaryValues) return e;
    const factor = dec(1).add(dec(String(p)).div(100));
    const salaryValues = Object.fromEntries(Object.entries(e.salaryValues).map(([code, v]) => [code, earningFixed.has(code) ? roundTo(dec(v).mul(factor), 2, 'HALF_UP').toString() : v]));
    return { ...e, salaryValues, monthlyGross: e.monthlyGross ? money(dec(e.monthlyGross).mul(factor)) : null };
  });

  // New hires are generated through the salary structure template, like real employees.
  let n = 0;
  for (const h of s.newHires) {
    const t = applyTemplate(settings.salaryTemplate, componentRows, dec(String(h.monthlyGross)));
    if (t.problems.length) throw new AppError('CONFIGURATION_MISSING', `New hires need a working salary structure template: ${t.problems[0]}`);
    for (let i = 0; i < h.count; i++) {
      n++;
      employees.push({
        employeeId: `sim-hire-${n}`,
        employeeCode: `NEW-${String(n).padStart(3, '0')}`,
        employeeName: `${h.label} ${i + 1}`,
        department: h.department,
        joiningDate: new Date(Date.UTC(base.year, base.month - 1, 1)),
        monthlyGross: t.monthlyGross,
        salaryValues: Object.fromEntries(t.lines.map((l) => [l.code, l.value])),
        monthlyInputs: {},
        previousNet: null,
        synthetic: true,
      });
    }
  }

  const components = [...base.components];
  const bonus = s.bonusPercentOfGross > 0 || s.bonusFlat > 0;
  const overtime = s.overtimeHours > 0 && s.overtimeMultiplier > 0;
  if (bonus) components.push(simComponent(SIM_BONUS, 'Bonus (simulated)', 9000));
  if (overtime) components.push(simComponent(SIM_OVERTIME, 'Overtime (simulated)', 9001));
  if (bonus || overtime) {
    employees = employees.map((e) => {
      if (!e.salaryValues) return e;
      const g = e.monthlyGross ? dec(e.monthlyGross) : fixedGross(e, base);
      const extra: Record<string, string> = {};
      if (bonus) extra[SIM_BONUS] = money(g.mul(s.bonusPercentOfGross).div(100).add(s.bonusFlat));
      if (overtime) extra[SIM_OVERTIME] = money(g.div(26 * 8).mul(s.overtimeHours).mul(s.overtimeMultiplier));
      return { ...e, salaryValues: { ...e.salaryValues, ...extra } };
    });
    notes.push('Simulated bonus and overtime are added as earnings; statutory wages include them only if those components are listed in Statutory settings (they are not).');
  }
  return { pop: { ...base, employees, components }, notes };
}

function departmentBreakdown(results: SimResult[]) {
  const map = new Map<string, SimResult[]>();
  for (const r of results) {
    const k = r.employee.department ?? 'No department';
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return new Map([...map.entries()].map(([k, v]) => [k, totalsOf(v)]));
}

export async function runScenario(s: Scenario) {
  const period = s.year && s.month ? { year: s.year, month: s.month } : await defaultPeriod();
  const settings = await getSettings();
  const base = await livePopulation(period.year, period.month, settings);
  if (!base.employees.length) throw new AppError('INVALID_STATE', `No employees are eligible for ${periodLabel(period.year, period.month)}.`);
  const { pop, notes } = await applyScenario(base, s);
  const before = simulate(base, settings);
  const after = simulate(pop, settings);
  const tb = totalsOf(before);
  const ta = totalsOf(after);
  const delta = (k: keyof typeof tb) => money(dec(String(ta[k])).sub(dec(String(tb[k]))));
  const deltaPct = (k: 'costToCompany' | 'gross' | 'net') => (dec(tb[k]).isZero() ? null : Number(dec(ta[k]).sub(dec(tb[k])).div(dec(tb[k])).mul(100).toFixed(2)));
  const project = (t: typeof tb) => ({ gross: money(dec(t.gross).mul(s.horizonMonths)), costToCompany: money(dec(t.costToCompany).mul(s.horizonMonths)), net: money(dec(t.net).mul(s.horizonMonths)) });
  const db = departmentBreakdown(before);
  const da = departmentBreakdown(after);
  const beforeById = new Map(before.map((r) => [r.employee.employeeId, r]));
  const employeeChanges = after
    .map((r) => {
      const b = beforeById.get(r.employee.employeeId);
      const gross = dec(r.result.gross);
      const bg = b ? dec(b.result.gross) : new Dec(0);
      return { employeeCode: r.employee.employeeCode, employeeName: r.employee.employeeName, department: r.employee.department, synthetic: Boolean(r.employee.synthetic), grossBefore: b ? money(bg) : null, grossAfter: money(gross), netBefore: b?.result.net ?? null, netAfter: r.result.net, change: money(gross.sub(bg)) };
    })
    .concat(before.filter((b) => !after.some((a) => a.employee.employeeId === b.employee.employeeId)).map((b) => ({ employeeCode: b.employee.employeeCode, employeeName: b.employee.employeeName, department: b.employee.department, synthetic: false, grossBefore: b.result.gross, grossAfter: '0.00', netBefore: b.result.net, netAfter: '0.00', change: money(dec(b.result.gross).neg()) })))
    .sort((a, b) => dec(b.change).abs().cmp(dec(a.change).abs()));
  return {
    period: periodLabel(period.year, period.month),
    horizonMonths: s.horizonMonths,
    baseline: tb,
    scenario: ta,
    delta: { headcount: ta.headcount - tb.headcount, gross: delta('gross'), net: delta('net'), employerCost: delta('employerCost'), costToCompany: delta('costToCompany'), costToCompanyPercent: deltaPct('costToCompany'), grossPercent: deltaPct('gross') },
    projection: { baseline: project(tb), scenario: project(ta), difference: money(dec(ta.costToCompany).sub(dec(tb.costToCompany)).mul(s.horizonMonths)) },
    departments: [...new Set([...db.keys(), ...da.keys()])].sort().map((d) => ({ department: d, baseline: db.get(d) ?? null, scenario: da.get(d) ?? null })),
    employeeChanges: employeeChanges.slice(0, 200),
    notes,
  };
}

const serializeScenario = (s: Prisma.PayrollScenarioGetPayload<object>) => ({ id: s.id, name: s.name, description: s.description, config: s.config, createdByName: s.createdByName, createdAt: s.createdAt, updatedAt: s.updatedAt });

export function registerSimulatorRoutes(r: ApiRegistry) {
  r.add({
    method: 'post',
    path: '/simulator/run',
    tag: 'Digital twin',
    summary: 'Simulate a scenario against the live workforce (in memory; nothing is saved to payroll)',
    permission: 'payroll.view_amounts',
    body: scenarioSchema,
    handler: ({ body }) => runScenario(body),
  });

  r.add({
    method: 'get',
    path: '/simulator/options',
    tag: 'Digital twin',
    summary: 'Departments and the default starting month for scenarios',
    permission: 'payroll.view_amounts',
    handler: async () => ({ period: await defaultPeriod(), departments: (await prisma.department.findMany({ where: { active: true }, orderBy: { name: 'asc' } })).map((d) => d.name) }),
  });

  r.add({
    method: 'get',
    path: '/simulator/scenarios',
    tag: 'Digital twin',
    summary: 'Saved scenarios',
    permission: 'payroll.view_amounts',
    handler: async () => (await prisma.payrollScenario.findMany({ orderBy: { updatedAt: 'desc' } })).map(serializeScenario),
  });

  const saveBody = z.object({ name: z.string().trim().min(2).max(120), description: z.string().trim().max(1000).nullable().default(null), config: scenarioSchema });

  r.add({
    method: 'post',
    path: '/simulator/scenarios',
    tag: 'Digital twin',
    summary: 'Save a scenario',
    permission: 'payroll.view_amounts',
    status: 201,
    body: saveBody,
    handler: async ({ body, user, ip }) => {
      const created = await prisma.payrollScenario.create({ data: { name: body.name, description: body.description, config: body.config, createdById: user.id, createdByName: user.name } });
      await audit.write({ actorId: user.id, action: 'scenario.saved', entity: 'payroll_scenario', entityId: created.id, after: { name: body.name }, ip });
      return serializeScenario(created);
    },
  });

  r.add({
    method: 'put',
    path: '/simulator/scenarios/:id',
    tag: 'Digital twin',
    summary: 'Update a saved scenario',
    permission: 'payroll.view_amounts',
    params: idParam,
    body: saveBody,
    handler: async ({ params, body, user, ip }) => {
      if (!(await prisma.payrollScenario.findUnique({ where: { id: params.id } }))) throw notFound('Scenario');
      const updated = await prisma.payrollScenario.update({ where: { id: params.id }, data: { name: body.name, description: body.description, config: body.config } });
      await audit.write({ actorId: user.id, action: 'scenario.updated', entity: 'payroll_scenario', entityId: params.id, after: { name: body.name }, ip });
      return serializeScenario(updated);
    },
  });

  r.add({
    method: 'delete',
    path: '/simulator/scenarios/:id',
    tag: 'Digital twin',
    summary: 'Delete a saved scenario',
    permission: 'payroll.view_amounts',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const existing = await prisma.payrollScenario.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('Scenario');
      await prisma.payrollScenario.delete({ where: { id: params.id } });
      await audit.write({ actorId: user.id, action: 'scenario.deleted', entity: 'payroll_scenario', entityId: params.id, before: { name: existing.name }, ip });
      return { deleted: true };
    },
  });
}
