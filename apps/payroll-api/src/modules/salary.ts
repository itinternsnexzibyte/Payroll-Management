import { z } from 'zod';
import { AppError, DECIMAL_RE, diff, idParam, isoDate, notFound, toIsoDate, type ApiRegistry } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { FORMULA_REGISTRY } from '../payroll/formulas';

const componentBase = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['EARNING', 'DEDUCTION']),
  basis: z.enum(['FIXED', 'PERCENTAGE', 'INPUT', 'FORMULA']),
  percentOfCode: z.string().trim().max(40).nullable().optional(),
  defaultPercentage: z.string().trim().regex(DECIMAL_RE, 'Enter a number.').nullable().optional(),
  inputKey: z.string().trim().max(40).nullable().optional(),
  formulaRef: z.string().trim().max(60).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
  showOnPayslip: z.boolean().default(true),
  description: z.string().trim().max(500).nullable().optional(),
});

async function validateComponent(c: z.infer<typeof componentBase>, code: string) {
  const fields: { path: string; message: string }[] = [];
  if (c.basis === 'PERCENTAGE') {
    if (!c.percentOfCode) fields.push({ path: 'percentOfCode', message: 'Choose the base component.' });
    else if (c.percentOfCode === code) fields.push({ path: 'percentOfCode', message: 'A component cannot be a percentage of itself.' });
    else if (!(await prisma.salaryComponent.findUnique({ where: { code: c.percentOfCode } }))) fields.push({ path: 'percentOfCode', message: 'Unknown component code.' });
  }
  if (c.basis === 'INPUT') {
    if (!c.inputKey) fields.push({ path: 'inputKey', message: 'Choose the monthly input that supplies the amount.' });
    else {
      const def = await prisma.payrollInputDefinition.findUnique({ where: { key: c.inputKey } });
      if (!def) fields.push({ path: 'inputKey', message: 'Unknown monthly input.' });
      else if (def.dataType !== 'NUMBER') fields.push({ path: 'inputKey', message: 'The monthly input must be numeric.' });
    }
  }
  if (c.basis === 'FORMULA' && !c.formulaRef) fields.push({ path: 'formulaRef', message: 'Enter the formula reference.' });
  if (fields.length) throw new AppError('VALIDATION_ERROR', 'Please correct the component configuration.', { fields });
}

function normaliseComponent(c: z.infer<typeof componentBase>) {
  return {
    ...c,
    percentOfCode: c.basis === 'PERCENTAGE' ? c.percentOfCode ?? null : null,
    defaultPercentage: c.basis === 'PERCENTAGE' ? c.defaultPercentage ?? null : null,
    inputKey: c.basis === 'INPUT' ? c.inputKey ?? null : null,
    formulaRef: c.basis === 'FORMULA' ? c.formulaRef ?? null : null,
  };
}

function serializeComponent(c: Prisma.SalaryComponentGetPayload<object>) {
  return {
    ...c,
    defaultPercentage: c.defaultPercentage?.toString() ?? null,
    formulaStatus: c.basis === 'FORMULA' ? (c.formulaRef && FORMULA_REGISTRY[c.formulaRef] ? 'CONFIGURED' : 'AWAITING_CLIENT_WORKBOOK') : null,
  };
}

const versionInclude = { values: { include: { component: true } } } satisfies Prisma.SalaryVersionInclude;
type VersionRow = Prisma.SalaryVersionGetPayload<{ include: typeof versionInclude }>;

function serializeVersion(v: VersionRow) {
  return {
    id: v.id,
    versionNo: v.versionNo,
    effectiveFrom: toIsoDate(v.effectiveFrom),
    effectiveTo: toIsoDate(v.effectiveTo),
    changeReason: v.changeReason,
    createdAt: v.createdAt,
    createdById: v.createdById,
    values: v.values
      .sort((a, b) => a.component.sortOrder - b.component.sortOrder)
      .map((val) => ({ componentId: val.componentId, code: val.component.code, name: val.component.name, type: val.component.type, basis: val.component.basis, value: val.value.toString() })),
  };
}

export function registerSalaryRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/salary-components',
    tag: 'Salary',
    summary: 'List salary components',
    permission: ['salary.view', 'payroll.view', 'settings.manage'],
    handler: async () => {
      const items = await prisma.salaryComponent.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
      return { items: items.map(serializeComponent), availableFormulas: Object.entries(FORMULA_REGISTRY).map(([key, f]) => ({ key, label: f.label, workbookReference: f.workbookReference })) };
    },
  });

  r.add({
    method: 'post',
    path: '/salary-components',
    tag: 'Salary',
    summary: 'Create a salary component',
    permission: 'salary.manage',
    status: 201,
    body: componentBase.extend({ code: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use upper-case letters, digits and underscores (e.g. BASIC).') }),
    handler: async ({ body, user, ip }) => {
      if (await prisma.salaryComponent.findUnique({ where: { code: body.code } })) throw new AppError('CONFLICT', `Component code ${body.code} already exists.`, { fields: [{ path: 'code', message: 'Already used.' }] });
      await validateComponent(body, body.code);
      const created = await prisma.salaryComponent.create({ data: { ...normaliseComponent(body), code: body.code, createdById: user.id, updatedById: user.id } });
      await audit.write({ actorId: user.id, action: 'salary_component.created', entity: 'salary_component', entityId: created.id, after: created, ip });
      return serializeComponent(created);
    },
  });

  r.add({
    method: 'put',
    path: '/salary-components/:id',
    tag: 'Salary',
    summary: 'Update a salary component (the code cannot change)',
    permission: 'salary.manage',
    params: idParam,
    body: componentBase,
    handler: async ({ params, body, user, ip }) => {
      const existing = await prisma.salaryComponent.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('Salary component');
      await validateComponent(body, existing.code);
      const updated = await prisma.salaryComponent.update({ where: { id: params.id }, data: { ...normaliseComponent(body), updatedById: user.id } });
      await audit.write({ actorId: user.id, action: 'salary_component.updated', entity: 'salary_component', entityId: params.id, ...diff(existing, updated), ip });
      return serializeComponent(updated);
    },
  });

  r.add({
    method: 'get',
    path: '/employees/:id/salary',
    tag: 'Salary',
    summary: "Employee's current (and any future-dated) salary version",
    permission: 'salary.view',
    params: idParam,
    handler: async ({ params }) => {
      const emp = await prisma.employee.findUnique({ where: { id: params.id } });
      if (!emp) throw notFound('Employee');
      const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      const versions = await prisma.salaryVersion.findMany({ where: { employeeId: params.id }, include: versionInclude, orderBy: { effectiveFrom: 'desc' } });
      const current = versions.find((v) => v.effectiveFrom <= today && (!v.effectiveTo || v.effectiveTo >= today)) ?? null;
      const upcoming = versions.filter((v) => v.effectiveFrom > today);
      return { current: current && serializeVersion(current), upcoming: upcoming.map(serializeVersion), versionCount: versions.length };
    },
  });

  r.add({
    method: 'get',
    path: '/employees/:id/salary-history',
    tag: 'Salary',
    summary: 'All salary versions with change summaries',
    permission: 'salary.view',
    params: idParam,
    handler: async ({ params }) => {
      const versions = await prisma.salaryVersion.findMany({ where: { employeeId: params.id }, include: versionInclude, orderBy: { versionNo: 'asc' } });
      const serialized = versions.map(serializeVersion);
      return serialized
        .map((v, i) => {
          const prev = serialized[i - 1];
          const prevMap = new Map(prev?.values.map((x) => [x.code, x.value]) ?? []);
          const curMap = new Map(v.values.map((x) => [x.code, x.value]));
          const changes = [...new Set([...prevMap.keys(), ...curMap.keys()])]
            .filter((code) => prevMap.get(code) !== curMap.get(code))
            .map((code) => ({ code, name: v.values.find((x) => x.code === code)?.name ?? prev?.values.find((x) => x.code === code)?.name ?? code, from: prevMap.get(code) ?? null, to: curMap.get(code) ?? null }));
          return { ...v, changes };
        })
        .reverse();
    },
  });

  r.add({
    method: 'post',
    path: '/employees/:id/salary',
    tag: 'Salary',
    summary: 'Create a new salary version effective from a date (earlier versions are kept, never overwritten)',
    permission: 'salary.manage',
    status: 201,
    params: idParam,
    body: z.object({
      effectiveFrom: isoDate,
      changeReason: z.string().trim().min(3, 'Describe the reason for this change.').max(500),
      values: z
        .array(z.object({ componentId: z.string().uuid(), value: z.string().trim().regex(DECIMAL_RE, 'Enter a number (up to 6 decimals).') }))
        .min(1, 'Enter at least one component value.')
        .max(100),
    }),
    handler: async ({ params, body, user, ip }) => {
      const emp = await prisma.employee.findUnique({ where: { id: params.id } });
      if (!emp) throw notFound('Employee');
      if (body.effectiveFrom < emp.joiningDate) throw new AppError('VALIDATION_ERROR', 'The effective date cannot be before the joining date.', { fields: [{ path: 'effectiveFrom', message: 'Before joining date.' }] });
      const ids = body.values.map((v) => v.componentId);
      if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION_ERROR', 'Each component can appear only once.');
      const components = await prisma.salaryComponent.findMany({ where: { id: { in: ids } } });
      const fields: { path: string; message: string }[] = [];
      body.values.forEach((v, i) => {
        const c = components.find((x) => x.id === v.componentId);
        if (!c) fields.push({ path: `values.${i}.componentId`, message: 'Unknown component.' });
        else if (!c.active) fields.push({ path: `values.${i}.componentId`, message: `${c.name} is inactive.` });
        else if (c.basis === 'INPUT') fields.push({ path: `values.${i}.componentId`, message: `${c.name} is entered monthly, not in the salary structure.` });
        if (v.value.startsWith('-')) fields.push({ path: `values.${i}.value`, message: 'Values cannot be negative.' });
      });
      if (fields.length) throw new AppError('VALIDATION_ERROR', 'Please correct the salary values.', { fields });

      const created = await prisma.$transaction(async (tx) => {
        // Serialise concurrent edits for the same employee.
        await tx.$queryRaw`SELECT id FROM employees WHERE id = ${emp.id}::uuid FOR UPDATE`;
        const latest = await tx.salaryVersion.findFirst({ where: { employeeId: emp.id }, orderBy: { effectiveFrom: 'desc' } });
        if (latest && body.effectiveFrom <= latest.effectiveFrom) {
          throw new AppError('VALIDATION_ERROR', `The effective date must be after the latest version's effective date (${toIsoDate(latest.effectiveFrom)}).`, {
            fields: [{ path: 'effectiveFrom', message: `Must be after ${toIsoDate(latest.effectiveFrom)}.` }],
          });
        }
        if (latest) {
          await tx.salaryVersion.update({ where: { id: latest.id }, data: { effectiveTo: new Date(body.effectiveFrom.getTime() - 86_400_000) } });
        }
        return tx.salaryVersion.create({
          data: {
            employeeId: emp.id,
            versionNo: (latest?.versionNo ?? 0) + 1,
            effectiveFrom: body.effectiveFrom,
            changeReason: body.changeReason,
            createdById: user.id,
            values: { create: body.values.map((v) => ({ componentId: v.componentId, value: new Prisma.Decimal(v.value) })) },
          },
          include: versionInclude,
        });
      });
      const out = serializeVersion(created);
      await audit.write({
        actorId: user.id,
        action: 'salary.version_created',
        entity: 'employee',
        entityId: emp.id,
        after: { versionNo: out.versionNo, effectiveFrom: out.effectiveFrom, values: out.values.map((v) => ({ code: v.code, value: v.value })) },
        metadata: { reason: body.changeReason },
        ip,
      });
      return out;
    },
  });
}
