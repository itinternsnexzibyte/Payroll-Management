/**
 * Payroll policy testing lab: run a proposed salary structure, statutory rule, proration,
 * gratuity or overtime policy against a historical payroll month or synthetic employees, and see
 * exactly who changes and by how much — before the policy is switched on. Read-only: proposals are
 * applied to an in-memory copy of the settings and never saved.
 */
import { z } from 'zod';
import { AppError, Dec, dec, money, notFound, type ApiRegistry } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { getSettings, salaryTemplateSchema, type PayrollSettings } from '../settings';
import { statutorySchema } from '../statutory/rules';
import { buildCalculationInput, periodLabel } from '../payroll/service';
import { applyTemplate } from '../modules/salary-template';
import { simulate, toComponentDef, type Population, type SimEmployee, type SimResult } from './calc';

const policySchema = z.object({
  statutory: statutorySchema.optional(),
  proration: z.object({ enabled: z.boolean() }).optional(),
  gratuity: z.object({ enabled: z.boolean(), ratePercent: z.number().min(0).max(100), baseComponents: z.array(z.string().max(40)).max(50) }).optional(),
  salaryTemplate: salaryTemplateSchema.optional(),
  /** Re-split each employee's gross with the (proposed) template, for structure changes */
  regenerateStructures: z.boolean().default(false),
  /** Change the rate of a percentage component for everyone (e.g. HRA 40% → 50% of basic) */
  componentRates: z.array(z.object({ code: z.string().max(40), ratePercent: z.number().min(0).max(1000) })).max(30).default([]),
  /** Overtime policy: hours entered in this input are paid at hourly rate × multiplier */
  overtime: z.object({ inputKey: z.string().max(40), multiplier: z.number().min(0).max(5), hoursPerMonth: z.number().min(1).max(400).default(208) }).nullable().default(null),
  rounding: z.object({ scale: z.number().int().min(0).max(4), mode: z.enum(['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'CEIL', 'FLOOR']), level: z.enum(['LINE', 'TOTAL']) }).optional(),
});

const sourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RUN'), runId: z.string().uuid() }),
  z.object({ type: z.literal('SYNTHETIC'), count: z.number().int().min(1).max(500), minGross: z.number().positive().max(10_000_000), maxGross: z.number().positive().max(10_000_000), year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) }),
]);

const OVERTIME = 'LAB_OVERTIME';

async function sourcePopulation(source: z.infer<typeof sourceSchema>, settings: PayrollSettings, template: PayrollSettings['salaryTemplate']): Promise<{ pop: Population; label: string }> {
  if (source.type === 'RUN') {
    const run = await prisma.payrollRun.findUnique({ where: { id: source.runId } });
    if (!run) throw notFound('Payroll run');
    const { input, meta } = await prisma.$transaction(async (tx) => {
      const input = await buildCalculationInput(tx, run.id, settings);
      const meta = await tx.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, include: { salaryVersion: { select: { monthlyGross: true } }, employee: { select: { joiningDate: true } } } });
      return { input, meta };
    });
    const byId = new Map(meta.map((m) => [m.employeeId, m]));
    const employees: SimEmployee[] = input.employees.map((e) => {
      const m = byId.get(e.employeeId)!;
      return { ...e, employeeName: m.employeeName, department: m.departmentName, joiningDate: m.employee.joiningDate, monthlyGross: m.salaryVersion?.monthlyGross?.toString() ?? null };
    });
    return { pop: { year: run.year, month: run.month, employees, components: input.components, inputDefs: input.inputDefs.map((d) => ({ ...d, mandatory: false })) }, label: `${periodLabel(run.year, run.month)} (${run.status.toLowerCase()})` };
  }
  if (source.maxGross < source.minGross) throw new AppError('VALIDATION_ERROR', 'The highest gross must not be below the lowest.');
  const comps = await prisma.salaryComponent.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  const employees: SimEmployee[] = [];
  for (let i = 0; i < source.count; i++) {
    const g = source.count === 1 ? source.minGross : source.minGross + ((source.maxGross - source.minGross) * i) / (source.count - 1);
    const t = applyTemplate(template, comps, dec(g.toFixed(2)));
    if (t.problems.length) throw new AppError('CONFIGURATION_MISSING', `Synthetic employees are built with the salary structure template: ${t.problems[0]}`);
    employees.push({
      employeeId: `synthetic-${i + 1}`,
      employeeCode: `SYN-${String(i + 1).padStart(3, '0')}`,
      employeeName: `Synthetic ₹${money(dec(t.monthlyGross))}`,
      department: null,
      joiningDate: new Date(Date.UTC(source.year, source.month - 1, 1)),
      monthlyGross: t.monthlyGross,
      salaryValues: Object.fromEntries(t.lines.map((l) => [l.code, l.value])),
      monthlyInputs: {},
      previousNet: null,
      synthetic: true,
    });
  }
  const inputDefs = (await prisma.payrollInputDefinition.findMany({ where: { active: true } })).map((d) => ({ key: d.key, label: d.label, dataType: d.dataType, mandatory: false, minValue: d.minValue?.toString() ?? null, maxValue: d.maxValue?.toString() ?? null }));
  return { pop: { year: source.year, month: source.month, employees, components: comps.map(toComponentDef), inputDefs }, label: `${source.count} synthetic employees, gross ₹${money(dec(String(source.minGross)))}–₹${money(dec(String(source.maxGross)))}` };
}

async function applyPolicy(pop: Population, settings: PayrollSettings, policy: z.infer<typeof policySchema>) {
  const proposed: PayrollSettings = {
    ...settings,
    ...(policy.statutory ? { statutory: policy.statutory } : {}),
    ...(policy.proration ? { proration: policy.proration } : {}),
    ...(policy.gratuity ? { gratuity: policy.gratuity } : {}),
    ...(policy.salaryTemplate ? { salaryTemplate: policy.salaryTemplate } : {}),
    ...(policy.rounding ? { rounding: policy.rounding } : {}),
  };
  let employees = pop.employees;
  let components = pop.components;
  const notes: string[] = [];
  if (policy.regenerateStructures) {
    const comps = await prisma.salaryComponent.findMany();
    let skipped = 0;
    employees = employees.map((e) => {
      const gross = e.monthlyGross ? dec(e.monthlyGross) : null;
      if (!gross) {
        skipped++;
        return e;
      }
      const t = applyTemplate(proposed.salaryTemplate, comps, gross);
      if (t.problems.length) throw new AppError('CONFIGURATION_MISSING', `Proposed template: ${t.problems[0]}`);
      return { ...e, salaryValues: Object.fromEntries(t.lines.map((l) => [l.code, l.value])) };
    });
    if (skipped) notes.push(`${skipped} employee(s) kept their structure: it was entered by hand, so there is no gross to re-split.`);
  }
  if (policy.componentRates.length) {
    const rates = new Map(policy.componentRates.map((c) => [c.code, String(c.ratePercent)]));
    components = components.map((c) => (rates.has(c.code) ? { ...c, defaultPercentage: rates.get(c.code)! } : c));
    employees = employees.map((e) => (e.salaryValues ? { ...e, salaryValues: Object.fromEntries(Object.entries(e.salaryValues).map(([k, v]) => [k, rates.get(k) ?? v])) } : e));
  }
  if (policy.overtime) {
    const ot = policy.overtime;
    const fixed = new Set(components.filter((c) => c.type === 'EARNING' && c.basis === 'FIXED').map((c) => c.code));
    components = [...components, { id: OVERTIME, code: OVERTIME, name: 'Overtime (policy under test)', type: 'EARNING', basis: 'FIXED', percentOfCode: null, defaultPercentage: null, inputKey: null, formulaRef: null, sortOrder: 9100, showOnPayslip: true }];
    employees = employees.map((e) => {
      const hours = dec(e.monthlyInputs[ot.inputKey] ?? '0');
      if (!e.salaryValues || hours.isZero()) return e;
      const base = Object.entries(e.salaryValues).reduce((acc, [k, v]) => (fixed.has(k) ? acc.add(dec(v)) : acc), new Dec(0));
      return { ...e, salaryValues: { ...e.salaryValues, [OVERTIME]: money(base.div(ot.hoursPerMonth).mul(hours).mul(ot.multiplier)) } };
    });
    notes.push(`Overtime is paid from input ${ot.inputKey} at (fixed earnings ÷ ${ot.hoursPerMonth} h) × ${ot.multiplier}.`);
  }
  return { pop: { ...pop, employees, components }, proposed, notes };
}

const pctChange = (a: Dec, b: Dec) => (a.isZero() ? (b.isZero() ? 0 : 100) : Number(b.sub(a).div(a.abs()).mul(100).toFixed(2)));
const statutoryLine = (r: SimResult, ref: string) => r.result.lines.find((l) => l.detail.formulaRef === ref && !dec(l.amount).isZero());

export function registerPolicyLabRoutes(r: ApiRegistry) {
  r.add({
    method: 'post',
    path: '/policy-lab/test',
    tag: 'Policy lab',
    summary: 'Test a proposed payroll policy against a historical month or synthetic employees (nothing is saved)',
    permission: ['settings.manage', 'payroll.view_amounts'],
    body: z.object({ source: sourceSchema, policy: policySchema, flagPercent: z.number().min(0.1).max(100).default(5) }),
    handler: async ({ body, user, ip }) => {
      const settings = await getSettings();
      const { pop, label } = await sourcePopulation(body.source, settings, body.policy.salaryTemplate ?? settings.salaryTemplate);
      if (!pop.employees.length) throw new AppError('INVALID_STATE', 'There are no employees to test against.');
      const baseline = simulate(pop, settings);
      const { pop: proposedPop, proposed, notes } = await applyPolicy(pop, settings, body.policy);
      const tested = simulate(proposedPop, proposed);
      const before = new Map(baseline.map((x) => [x.employee.employeeId, x]));

      const rows = tested.map((t) => {
        const b = before.get(t.employee.employeeId)!;
        const netB = dec(b.result.net);
        const netA = dec(t.result.net);
        const flags: string[] = [];
        const change = pctChange(netB, netA);
        if (Math.abs(change) >= body.flagPercent) flags.push(`Net pay ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}%`);
        if (b.result.status !== 'ERROR' && t.result.status === 'ERROR') flags.push('New calculation error');
        if (netA.isNegative()) flags.push('Negative net pay');
        const pfB = Boolean(statutoryLine(b, 'STATUTORY_PF'));
        const pfA = Boolean(statutoryLine(t, 'STATUTORY_PF'));
        const esiB = Boolean(statutoryLine(b, 'STATUTORY_ESI'));
        const esiA = Boolean(statutoryLine(t, 'STATUTORY_ESI'));
        if (pfB !== pfA || esiB !== esiA) flags.push(`Statutory cover changes: ${[pfB && 'PF', esiB && 'ESI'].filter(Boolean).join(' + ') || 'none'} → ${[pfA && 'PF', esiA && 'ESI'].filter(Boolean).join(' + ') || 'none'}`);
        const lineDiffs = [...new Set([...b.result.lines.map((l) => l.componentCode), ...t.result.lines.map((l) => l.componentCode)])]
          .map((code) => {
            const x = b.result.lines.find((l) => l.componentCode === code);
            const y = t.result.lines.find((l) => l.componentCode === code);
            return { code, name: y?.componentName ?? x?.componentName ?? code, before: x?.amount ?? '0.00', after: y?.amount ?? '0.00' };
          })
          .filter((d) => !dec(d.before).eq(dec(d.after)));
        return {
          employeeCode: t.employee.employeeCode,
          employeeName: t.employee.employeeName,
          department: t.employee.department,
          grossBefore: b.result.gross,
          grossAfter: t.result.gross,
          netBefore: b.result.net,
          netAfter: t.result.net,
          netChange: money(netA.sub(netB)),
          netChangePercent: change,
          employerBefore: money(b.employerCost),
          employerAfter: money(t.employerCost),
          statusBefore: b.result.status,
          statusAfter: t.result.status,
          errors: t.result.exceptions.filter((e) => e.severity === 'ERROR').map((e) => e.message),
          lineDiffs,
          flags,
        };
      });
      const s = (f: (x: SimResult) => Dec, list: SimResult[]) => list.reduce((acc, x) => acc.add(f(x)), new Dec(0));
      const costB = s((x) => dec(x.result.gross).add(x.employerCost), baseline);
      const costA = s((x) => dec(x.result.gross).add(x.employerCost), tested);
      const buckets = [
        { label: '≤ −10%', test: (p: number) => p <= -10 },
        { label: '−10% to −2%', test: (p: number) => p > -10 && p <= -2 },
        { label: '−2% to 0', test: (p: number) => p > -2 && p < 0 },
        { label: 'No change', test: (p: number) => p === 0 },
        { label: '0 to +2%', test: (p: number) => p > 0 && p < 2 },
        { label: '+2% to +10%', test: (p: number) => p >= 2 && p < 10 },
        { label: '≥ +10%', test: (p: number) => p >= 10 },
      ];
      await audit.write({ actorId: user.id, action: 'policy_lab.tested', entity: 'payroll_settings', entityId: null, metadata: { source: body.source.type, employees: rows.length, flagged: rows.filter((x) => x.flags.length).length }, ip });
      return {
        source: label,
        notes,
        summary: {
          employees: rows.length,
          changed: rows.filter((x) => x.netChangePercent !== 0 || x.lineDiffs.length).length,
          increased: rows.filter((x) => dec(x.netChange).gt(0)).length,
          decreased: rows.filter((x) => dec(x.netChange).lt(0)).length,
          flagged: rows.filter((x) => x.flags.length).length,
          newErrors: rows.filter((x) => x.statusBefore !== 'ERROR' && x.statusAfter === 'ERROR').length,
          netBefore: money(s((x) => dec(x.result.net), baseline)),
          netAfter: money(s((x) => dec(x.result.net), tested)),
          costBefore: money(costB),
          costAfter: money(costA),
          costChange: money(costA.sub(costB)),
          largestIncrease: rows.reduce<(typeof rows)[number] | null>((m, x) => (!m || dec(x.netChange).gt(dec(m.netChange)) ? x : m), null)?.netChange ?? '0.00',
          largestDecrease: rows.reduce<(typeof rows)[number] | null>((m, x) => (!m || dec(x.netChange).lt(dec(m.netChange)) ? x : m), null)?.netChange ?? '0.00',
        },
        distribution: buckets.map((b) => ({ label: b.label, count: rows.filter((x) => b.test(x.netChangePercent)).length })),
        rows: rows.sort((a, b) => b.flags.length - a.flags.length || Math.abs(b.netChangePercent) - Math.abs(a.netChangePercent)).slice(0, 500),
      };
    },
  });

  r.add({
    method: 'get',
    path: '/policy-lab/context',
    tag: 'Policy lab',
    summary: 'Current settings, components and runs to start a policy test from',
    permission: ['settings.manage', 'payroll.view_amounts'],
    handler: async () => {
      const [settings, runs, components, inputs] = await Promise.all([
        getSettings(),
        prisma.payrollRun.findMany({ where: { status: { not: 'DRAFT' } }, orderBy: [{ year: 'desc' }, { month: 'desc' }], take: 24 }),
        prisma.salaryComponent.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
        prisma.payrollInputDefinition.findMany({ where: { active: true, dataType: 'NUMBER' }, orderBy: { sortOrder: 'asc' } }),
      ]);
      return {
        settings: { statutory: settings.statutory, proration: settings.proration, gratuity: settings.gratuity, salaryTemplate: settings.salaryTemplate, rounding: settings.rounding },
        runs: runs.map((x) => ({ id: x.id, period: periodLabel(x.year, x.month), status: x.status, year: x.year, month: x.month })),
        components: components.map((c) => ({ code: c.code, name: c.name, type: c.type, basis: c.basis, defaultPercentage: c.defaultPercentage?.toString() ?? null })),
        numericInputs: inputs.map((i) => ({ key: i.key, label: i.label })),
      };
    },
  });
}
