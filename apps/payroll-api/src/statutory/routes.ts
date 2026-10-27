import { z } from 'zod';
import { AppError, Dec, dec, diff, money, notFound, type ApiRegistry } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { getSettings } from '../settings';
import { periodLabel } from '../payroll/service';
import { sendReport } from '../output/report-export';
import type { ReportData } from '../output/templates';
import { STATUTORY_REFS, statutoryProblems, statutorySchema, type StatutoryKind, type StatutorySettings } from './rules';

/** Default component created for each statutory deduction (the payroll team may rename it). */
const COMPONENTS: Record<StatutoryKind, { code: string; name: string; sortOrder: number }> = {
  PF: { code: 'PF_EMPLOYEE', name: 'Provident Fund', sortOrder: 900 },
  ESI: { code: 'ESI_EMPLOYEE', name: 'ESI', sortOrder: 910 },
  TDS: { code: 'TDS', name: 'Income Tax (TDS)', sortOrder: 920 },
};

async function statutoryState() {
  const settings = (await getSettings()).statutory;
  const components = await prisma.salaryComponent.findMany({ where: { basis: 'FORMULA', formulaRef: { in: Object.values(STATUTORY_REFS) } }, orderBy: { sortOrder: 'asc' } });
  const componentFor = (k: StatutoryKind) => components.filter((c) => c.formulaRef === STATUTORY_REFS[k]).map((c) => ({ id: c.id, code: c.code, name: c.name, active: c.active, type: c.type }));
  return { settings, problems: statutoryProblems(settings), components: { PF: componentFor('PF'), ESI: componentFor('ESI'), TDS: componentFor('TDS') } };
}

export function registerStatutoryRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/statutory',
    tag: 'Statutory',
    summary: 'Statutory settings (PF, ESI, TDS), completeness problems and the components that use them',
    permission: ['settings.manage', 'payroll.view'],
    handler: () => statutoryState(),
  });

  r.add({
    method: 'put',
    path: '/statutory',
    tag: 'Statutory',
    summary: 'Save the statutory settings; a section can be switched on only when complete and confirmed',
    permission: 'settings.manage',
    body: statutorySchema,
    handler: async ({ body, user, ip }) => {
      const problems = statutoryProblems(body);
      const fields = (Object.keys(problems) as StatutoryKind[]).flatMap((k) => problems[k].map((message) => ({ path: k.toLowerCase(), message: `${k}: ${message}` })));
      if (fields.length) throw new AppError('VALIDATION_ERROR', fields.map((f) => f.message).join(' '), { fields });
      const before = (await getSettings()).statutory;
      await prisma.payrollSetting.upsert({ where: { key: 'statutory' }, create: { key: 'statutory', value: body, updatedById: user.id }, update: { value: body, updatedById: user.id } });
      await audit.write({ actorId: user.id, action: 'statutory.updated', entity: 'payroll_settings', entityId: null, ...diff(before as never, body as never), ip });
      return statutoryState();
    },
  });

  r.add({
    method: 'post',
    path: '/statutory/standard-setup',
    tag: 'Statutory',
    summary: 'Apply standard PF / ESI figures with the wage band (ESI at or below the threshold, PF above) and create or convert the PF and ESI components',
    permission: 'settings.manage',
    body: z.object({ threshold: z.number().positive().max(10_000_000).default(20000) }),
    handler: async ({ body, user, ip }) => {
      const before = (await getSettings()).statutory;
      const earnings = await prisma.salaryComponent.findMany({ where: { type: 'EARNING', active: true }, orderBy: { sortOrder: 'asc' } });
      const basic = earnings.find((c) => c.code === 'BASIC') ?? earnings.find((c) => /basic/i.test(c.name)) ?? earnings[0];
      if (!basic) throw new AppError('CONFIGURATION_MISSING', 'Create the earning components (for example BASIC) before setting up PF and ESI.');
      const next: StatutorySettings = {
        ...before,
        confirmedBy: user.name,
        confirmedOn: new Date().toISOString().slice(0, 10),
        reference: 'Standard setup: EPF 12% + 12% on basic (ceiling 15,000); ESI 0.75% + 3.25% of gross; ESI at or below the wage band, PF above.',
        pf: { enabled: true, employeeRatePercent: 12, employerRatePercent: 12, wageComponents: [basic.code], wageCeiling: 15000, capAtCeiling: true },
        esi: { enabled: true, employeeRatePercent: 0.75, employerRatePercent: 3.25, wageComponents: earnings.map((c) => c.code), eligibilityLimit: 21000 },
        wageBand: { enabled: true, threshold: body.threshold },
      };
      await prisma.$transaction(async (tx) => {
        await tx.payrollSetting.upsert({ where: { key: 'statutory' }, create: { key: 'statutory', value: next, updatedById: user.id }, update: { value: next, updatedById: user.id } });
        for (const kind of ['PF', 'ESI'] as const) {
          const ref = STATUTORY_REFS[kind];
          if (await tx.salaryComponent.findFirst({ where: { formulaRef: ref } })) continue;
          // A plain "12% of basic" PF deduction cannot follow the wage band: switch it to the statutory formula.
          const legacy = kind === 'PF' ? await tx.salaryComponent.findFirst({ where: { type: 'DEDUCTION', basis: 'PERCENTAGE', OR: [{ code: 'PF' }, { name: { contains: 'provident', mode: 'insensitive' } }] } }) : null;
          if (legacy) {
            const updated = await tx.salaryComponent.update({ where: { id: legacy.id }, data: { basis: 'FORMULA', formulaRef: ref, percentOfCode: null, defaultPercentage: null, updatedById: user.id } });
            await audit.tx(tx, { actorId: user.id, action: 'salary_component.updated', entity: 'salary_component', entityId: legacy.id, before: { basis: legacy.basis, formulaRef: legacy.formulaRef }, after: { basis: updated.basis, formulaRef: ref }, ip });
            continue;
          }
          const def = COMPONENTS[kind];
          const code = (await tx.salaryComponent.findUnique({ where: { code: def.code } })) ? `${def.code}_STAT` : def.code;
          const created = await tx.salaryComponent.create({
            data: { code, name: def.name, type: 'DEDUCTION', basis: 'FORMULA', formulaRef: ref, sortOrder: def.sortOrder, description: `Statutory ${kind} — calculated from Statutory settings.`, createdById: user.id, updatedById: user.id },
          });
          await audit.tx(tx, { actorId: user.id, action: 'salary_component.created', entity: 'salary_component', entityId: created.id, after: created, ip });
        }
      });
      await audit.write({ actorId: user.id, action: 'statutory.updated', entity: 'payroll_settings', entityId: null, ...diff(before as never, next as never), metadata: { standardSetup: true }, ip });
      return statutoryState();
    },
  });

  r.add({
    method: 'post',
    path: '/statutory/components',
    tag: 'Statutory',
    summary: 'Create the deduction component for PF, ESI or TDS (if it does not exist yet)',
    permission: 'settings.manage',
    body: z.object({ kind: z.enum(['PF', 'ESI', 'TDS']) }),
    handler: async ({ body, user, ip }) => {
      const ref = STATUTORY_REFS[body.kind];
      if (await prisma.salaryComponent.findFirst({ where: { formulaRef: ref } })) throw new AppError('CONFLICT', `A component for ${body.kind} already exists.`);
      const def = COMPONENTS[body.kind];
      if (await prisma.salaryComponent.findUnique({ where: { code: def.code } })) throw new AppError('CONFLICT', `Component code ${def.code} is already used by another component.`);
      const created = await prisma.salaryComponent.create({
        data: { code: def.code, name: def.name, type: 'DEDUCTION', basis: 'FORMULA', formulaRef: ref, sortOrder: def.sortOrder, description: `Statutory ${body.kind} — calculated from Statutory settings.`, createdById: user.id, updatedById: user.id },
      });
      await audit.write({ actorId: user.id, action: 'salary_component.created', entity: 'salary_component', entityId: created.id, after: created, ip });
      return statutoryState();
    },
  });

  r.add({
    method: 'get',
    path: '/reports/statutory',
    tag: 'Reports',
    summary: 'PF, ESI and TDS for a payroll month: wages, employee and employer contributions',
    permission: ['reports.view'],
    produces: 'xlsx',
    query: z.object({ runId: z.string().uuid(), format: z.enum(['json', 'pdf', 'xlsx']).default('json') }),
    handler: async ({ query, res, user, ip }) => {
      if (!user.permissions.has('payroll.view_amounts')) throw new AppError('FORBIDDEN', 'You do not have permission to view payroll amounts.');
      const run = await prisma.payrollRun.findUnique({ where: { id: query.runId } });
      if (!run) throw notFound('Payroll run');
      if (run.status === 'DRAFT') throw new AppError('INVALID_STATE', 'This payroll has not been calculated yet.');
      const members = await prisma.payrollRunEmployee.findMany({ where: { payrollRunId: run.id }, orderBy: { employeeCode: 'asc' } });
      const lines = await prisma.payrollLine.findMany({ where: { payrollRunId: run.id, basis: 'FORMULA' } });
      const refs = new Set<string>(Object.values(STATUTORY_REFS));
      const byEmp = new Map<string, Record<string, string>>();
      for (const l of lines) {
        const d = (l.calcDetail ?? {}) as Record<string, string | null>;
        if (!d.formulaRef || !refs.has(d.formulaRef)) continue;
        const row = byEmp.get(l.employeeId) ?? {};
        const amt = l.amount.toString();
        if (d.formulaRef === STATUTORY_REFS.PF) Object.assign(row, { pfWages: d.pfWages ?? '', pfEmployee: amt, pfEmployer: d.employerContribution ?? '' });
        if (d.formulaRef === STATUTORY_REFS.ESI) Object.assign(row, { esiWages: d.esiWages ?? '', esiEmployee: amt, esiEmployer: d.employerContribution ?? '' });
        if (d.formulaRef === STATUTORY_REFS.TDS) Object.assign(row, { tds: amt, tdsMethod: d.method ?? '' });
        byEmp.set(l.employeeId, row);
      }
      const keys = ['pfWages', 'pfEmployee', 'pfEmployer', 'esiWages', 'esiEmployee', 'esiEmployer', 'tds'] as const;
      const totals = Object.fromEntries(keys.map((k) => [k, new Dec(0)])) as Record<(typeof keys)[number], Dec>;
      const rows = members.map((m) => {
        const v = byEmp.get(m.employeeId) ?? {};
        for (const k of keys) if (v[k]) totals[k] = totals[k].add(dec(v[k]));
        return { code: m.employeeCode, name: m.employeeName, ...Object.fromEntries(keys.map((k) => [k, v[k] ?? ''])), tdsMethod: v.tdsMethod ?? '' };
      });
      const settings = (await getSettings()).statutory;
      const report: ReportData = {
        title: `Statutory Deductions — ${periodLabel(run.year, run.month)}`,
        subtitle: `${members.length} employees · ${settings.confirmedBy ? `figures confirmed by ${settings.confirmedBy} on ${settings.confirmedOn}` : 'statutory figures not confirmed'}`,
        banners: [
          ...(run.status !== 'FINALISED' ? [`Payroll status: ${run.status.replace('_', ' ')} — figures are not final.`] : []),
        ],
        columns: [
          { header: 'Employee ID', key: 'code' },
          { header: 'Employee Name', key: 'name' },
          { header: 'PF Wages', key: 'pfWages', numeric: true },
          { header: 'PF Employee', key: 'pfEmployee', numeric: true },
          { header: 'PF Employer', key: 'pfEmployer', numeric: true },
          { header: 'ESI Wages', key: 'esiWages', numeric: true },
          { header: 'ESI Employee', key: 'esiEmployee', numeric: true },
          { header: 'ESI Employer', key: 'esiEmployer', numeric: true },
          { header: 'TDS', key: 'tds', numeric: true },
          { header: 'TDS Basis', key: 'tdsMethod' },
        ],
        rows,
        totals: { code: 'Total', name: '', ...Object.fromEntries(keys.map((k) => [k, money(totals[k])])), tdsMethod: '' },
      };
      if (query.format !== 'json') await audit.write({ actorId: user.id, action: 'report.exported', entity: 'payroll_run', entityId: run.id, metadata: { report: 'statutory', format: query.format }, ip });
      return sendReport(res, query.format, report, `statutory-${run.year}-${String(run.month).padStart(2, '0')}`);
    },
  });
}
