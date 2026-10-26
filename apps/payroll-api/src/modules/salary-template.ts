/**
 * Automatic salary structures. The salary structure template (Payroll settings) turns one monthly
 * gross figure into every component value of a salary version, so salaries are generated instead
 * of being typed component by component. Payroll runs then calculate from those versions.
 */
import { z } from 'zod';
import { AppError, Dec, dec, idParam, isoDate, money, roundTo, toIsoDate, type ApiRegistry } from '@nexzi/server-core';
import { prisma, type Prisma } from '../db';
import { audit } from '../audit';
import { getSettings, type SalaryTemplate } from '../settings';
import { createSalaryVersion } from './salary';

type ComponentRow = Prisma.SalaryComponentGetPayload<object>;

export interface TemplateLine {
  componentId: string;
  code: string;
  name: string;
  type: 'EARNING' | 'DEDUCTION';
  basis: string;
  method: SalaryTemplate['lines'][number]['method'];
  /** What is stored in the salary version (an amount, or a rate for PERCENTAGE components) */
  value: string;
  /** Monthly amount this line produces before proration */
  amount: string;
}

export interface TemplateResult {
  monthlyGross: string;
  lines: TemplateLine[];
  earnings: string;
  deductions: string;
  net: string;
  problems: string[];
}

/** Problems with the template itself (unknown codes, methods that do not fit the component). */
export function templateProblems(t: SalaryTemplate, components: ComponentRow[]): string[] {
  const out: string[] = [];
  if (!t.enabled) out.push('The salary structure template is switched off in Payroll settings.');
  if (!t.lines.length) out.push('The salary structure template has no lines.');
  const byCode = new Map(components.map((c) => [c.code, c]));
  const seen = new Set<string>();
  let balances = 0;
  for (const l of t.lines) {
    const c = byCode.get(l.code);
    if (seen.has(l.code)) out.push(`${l.code} appears more than once in the template.`);
    seen.add(l.code);
    if (!c) {
      out.push(`Template component ${l.code} does not exist.`);
      continue;
    }
    if (!c.active) out.push(`${c.name} (${c.code}) is inactive.`);
    if (l.method === 'RATE' && c.basis !== 'PERCENTAGE') out.push(`${c.name}: "rate" needs a percentage-based component.`);
    if (l.method !== 'RATE' && c.basis !== 'FIXED') out.push(`${c.name}: only fixed components can take an amount or a share of gross.`);
    if (l.method === 'RATE' && c.percentOfCode && !t.lines.some((x) => x.code === c.percentOfCode)) out.push(`${c.name} is a percentage of ${c.percentOfCode}, which is not in the template.`);
    if (l.method === 'BALANCE') {
      balances++;
      if (c.type !== 'EARNING') out.push(`${c.name}: the balancing component must be an earning.`);
    }
    if ((l.method === 'PERCENT_OF_GROSS' || l.method === 'AMOUNT') && l.value === null) out.push(`${c.name}: enter a value.`);
  }
  if (balances > 1) out.push('Only one component can take the balance of the gross.');
  return out;
}

/** Splits a monthly gross into component values. Pure; amounts are rounded to 2 decimals and the
 * balancing component absorbs rounding so earnings add up to the gross exactly. */
export function applyTemplate(t: SalaryTemplate, components: ComponentRow[], monthlyGross: Dec): TemplateResult {
  const problems = templateProblems(t, components);
  const byCode = new Map(components.map((c) => [c.code, c]));
  const amounts = new Map<string, Dec>();
  const lines: TemplateLine[] = [];
  const r2 = (d: Dec) => roundTo(d, 2, 'HALF_UP');
  const push = (l: SalaryTemplate['lines'][number], c: ComponentRow, value: Dec, amount: Dec) => {
    amounts.set(c.code, amount);
    lines.push({ componentId: c.id, code: c.code, name: c.name, type: c.type, basis: c.basis, method: l.method, value: value.toString(), amount: money(amount) });
  };
  if (!problems.length) {
    for (const l of t.lines.filter((x) => x.method === 'PERCENT_OF_GROSS' || x.method === 'AMOUNT')) {
      const c = byCode.get(l.code)!;
      const amount = r2(l.method === 'AMOUNT' ? dec(String(l.value)) : monthlyGross.mul(dec(String(l.value))).div(100));
      push(l, c, amount, amount);
    }
    for (const l of t.lines.filter((x) => x.method === 'RATE')) {
      const c = byCode.get(l.code)!;
      const rate = l.value !== null ? dec(String(l.value)) : c.defaultPercentage ? dec(c.defaultPercentage.toString()) : null;
      const base = c.percentOfCode ? amounts.get(c.percentOfCode) : undefined;
      if (rate === null) problems.push(`${c.name}: enter a rate (the component has no default).`);
      else if (base === undefined) problems.push(`${c.name}: its base ${c.percentOfCode} must be an amount or share-of-gross line.`);
      else push(l, c, rate, r2(base.mul(rate).div(100)));
    }
    const earned = lines.filter((l) => l.type === 'EARNING').reduce((acc, l) => acc.add(dec(l.amount)), new Dec(0));
    const balance = t.lines.find((x) => x.method === 'BALANCE');
    if (balance) {
      const rest = monthlyGross.sub(earned);
      if (rest.isNegative()) problems.push(`The other earnings (${money(earned)}) exceed the gross of ${money(monthlyGross)}; lower their shares.`);
      else push(balance, byCode.get(balance.code)!, rest, rest);
    } else if (!earned.eq(monthlyGross)) {
      problems.push(`The template's earnings add up to ${money(earned)}, not the gross of ${money(monthlyGross)}. Add a balancing component.`);
    }
  }
  const order = new Map(components.map((c) => [c.code, c.sortOrder]));
  lines.sort((a, b) => (order.get(a.code) ?? 0) - (order.get(b.code) ?? 0));
  const sum = (type: string) => lines.filter((l) => l.type === type).reduce((acc, l) => acc.add(dec(l.amount)), new Dec(0));
  return { monthlyGross: money(monthlyGross), lines, earnings: money(sum('EARNING')), deductions: money(sum('DEDUCTION')), net: money(sum('EARNING').sub(sum('DEDUCTION'))), problems };
}

const grossInput = z
  .object({
    monthlyGross: z.number().positive().max(100_000_000).optional(),
    annualCtc: z.number().positive().max(1_200_000_000).optional(),
  })
  .refine((v) => v.monthlyGross !== undefined || v.annualCtc !== undefined, { message: 'Enter the monthly gross or the annual CTC.', path: ['monthlyGross'] });

const toMonthly = (v: { monthlyGross?: number; annualCtc?: number }) => roundTo(v.monthlyGross !== undefined ? dec(String(v.monthlyGross)) : dec(String(v.annualCtc)).div(12), 2, 'HALF_UP');

async function generate(monthly: Dec) {
  const [settings, components] = await Promise.all([getSettings(), prisma.salaryComponent.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] })]);
  return applyTemplate(settings.salaryTemplate, components, monthly);
}

function assertUsable(result: TemplateResult) {
  if (result.problems.length) throw new AppError('CONFIGURATION_MISSING', result.problems.join(' '), { problems: result.problems });
}

export function registerSalaryTemplateRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/salary-template',
    tag: 'Salary',
    summary: 'The salary structure template and any configuration problems',
    permission: ['salary.view', 'settings.manage'],
    handler: async () => {
      const [settings, components] = await Promise.all([getSettings(), prisma.salaryComponent.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] })]);
      return { template: settings.salaryTemplate, problems: templateProblems(settings.salaryTemplate, components) };
    },
  });

  r.add({
    method: 'post',
    path: '/salary-template/preview',
    tag: 'Salary',
    summary: 'Preview the component split for a monthly gross or annual CTC (nothing is saved)',
    permission: ['salary.view', 'settings.manage'],
    body: grossInput,
    handler: async ({ body }) => generate(toMonthly(body)),
  });

  r.add({
    method: 'post',
    path: '/employees/:id/salary/auto',
    tag: 'Salary',
    summary: 'Create a salary version generated by the template from a monthly gross or annual CTC',
    permission: 'salary.manage',
    status: 201,
    params: idParam,
    body: z.intersection(grossInput, z.object({ effectiveFrom: isoDate, changeReason: z.string().trim().min(3, 'Describe the reason for this change.').max(500) })),
    handler: async ({ params, body, user, ip }) => {
      const result = await generate(toMonthly(body));
      assertUsable(result);
      return createSalaryVersion(params.id, { effectiveFrom: body.effectiveFrom, changeReason: body.changeReason, monthlyGross: result.monthlyGross, values: result.lines.map((l) => ({ componentId: l.componentId, value: l.value })) }, user.id, ip);
    },
  });

  r.add({
    method: 'get',
    path: '/salary-template/employees',
    tag: 'Salary',
    summary: "Active employees with their current monthly gross, for regenerating structures in bulk",
    permission: 'salary.manage',
    handler: async () => {
      const employees = await prisma.employee.findMany({
        where: { status: 'ACTIVE' },
        include: { salaryVersions: { include: { values: { include: { component: true } } }, orderBy: { effectiveFrom: 'desc' }, take: 1 } },
        orderBy: { employeeCode: 'asc' },
      });
      return employees.map((e) => {
        const v = e.salaryVersions[0];
        // Older, hand-entered versions: approximate the gross from their FIXED earning amounts.
        const fixed = v?.values.filter((x) => x.component.type === 'EARNING' && x.component.basis === 'FIXED').reduce((acc, x) => acc.add(dec(x.value.toString())), new Dec(0));
        return {
          employeeId: e.id,
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          latestEffectiveFrom: v ? toIsoDate(v.effectiveFrom) : null,
          monthlyGross: v?.monthlyGross?.toString() ?? null,
          fixedEarnings: fixed ? money(fixed) : null,
          generated: Boolean(v?.monthlyGross),
        };
      });
    },
  });

  r.add({
    method: 'post',
    path: '/salary-template/apply',
    tag: 'Salary',
    summary: 'Generate new salary versions for several employees from their monthly gross',
    permission: 'salary.manage',
    body: z.object({
      effectiveFrom: isoDate,
      changeReason: z.string().trim().min(3).max(500),
      items: z.array(z.object({ employeeId: z.string().uuid(), monthlyGross: z.number().positive().max(100_000_000) })).min(1).max(1000),
    }),
    handler: async ({ body, user, ip }) => {
      const created: string[] = [];
      const failed: { employeeId: string; message: string }[] = [];
      for (const item of body.items) {
        try {
          const result = await generate(roundTo(dec(String(item.monthlyGross)), 2, 'HALF_UP'));
          assertUsable(result);
          await createSalaryVersion(item.employeeId, { effectiveFrom: body.effectiveFrom, changeReason: body.changeReason, monthlyGross: result.monthlyGross, values: result.lines.map((l) => ({ componentId: l.componentId, value: l.value })) }, user.id, ip);
          created.push(item.employeeId);
        } catch (e) {
          failed.push({ employeeId: item.employeeId, message: e instanceof AppError ? e.message : 'Could not create the salary version.' });
        }
      }
      await audit.write({ actorId: user.id, action: 'salary.template_applied', entity: 'salary_template', entityId: null, metadata: { created: created.length, failed: failed.length, effectiveFrom: toIsoDate(body.effectiveFrom) }, ip });
      if (!created.length) throw new AppError('VALIDATION_ERROR', `No salary versions were created: ${failed[0].message}`, { failed });
      return { created: created.length, failed };
    },
  });
}
