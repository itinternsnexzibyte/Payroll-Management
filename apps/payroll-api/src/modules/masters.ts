import { z } from 'zod';
import { AppError, DECIMAL_RE, diff, idParam, notFound, type ApiRegistry } from '@nexzi/server-core';
import { prisma } from '../db';
import { audit } from '../audit';
import { config } from '../config';
import { getSettings, settingsSchema } from '../settings';

const nameBody = z.object({ name: z.string().trim().min(1).max(100), active: z.boolean().default(true) });
const decimalString = z.string().trim().regex(DECIMAL_RE, 'Enter a number.');

export function registerMasterRoutes(r: ApiRegistry) {
  for (const kind of ['departments', 'designations'] as const) {
    const label = kind === 'departments' ? 'Department' : 'Designation';
    const model = () => (kind === 'departments' ? prisma.department : prisma.designation) as typeof prisma.department;
    r.add({
      method: 'get',
      path: `/${kind}`,
      tag: 'Masters',
      summary: `List ${kind}`,
      permission: ['employees.view', 'settings.manage', 'self.service'],
      handler: async () => model().findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { employees: true } } } }),
    });
    r.add({
      method: 'post',
      path: `/${kind}`,
      tag: 'Masters',
      summary: `Create a ${label.toLowerCase()}`,
      permission: ['settings.manage', 'employees.manage'],
      status: 201,
      body: nameBody,
      handler: async ({ body, user, ip }) => {
        const exists = await model().findFirst({ where: { name: { equals: body.name, mode: 'insensitive' } } });
        if (exists) throw new AppError('CONFLICT', `${label} "${body.name}" already exists.`);
        const created = await model().create({ data: { ...body, createdById: user.id, updatedById: user.id } });
        await audit.write({ actorId: user.id, action: `${kind.slice(0, -1)}.created`, entity: kind.slice(0, -1), entityId: created.id, after: body, ip });
        return created;
      },
    });
    r.add({
      method: 'put',
      path: `/${kind}/:id`,
      tag: 'Masters',
      summary: `Rename or (de)activate a ${label.toLowerCase()}`,
      permission: ['settings.manage', 'employees.manage'],
      params: idParam,
      body: nameBody.partial(),
      handler: async ({ params, body, user, ip }) => {
        const existing = await model().findUnique({ where: { id: params.id } });
        if (!existing) throw notFound(label);
        const updated = await model().update({ where: { id: params.id }, data: { ...body, updatedById: user.id } });
        await audit.write({ actorId: user.id, action: `${kind.slice(0, -1)}.updated`, entity: kind.slice(0, -1), entityId: params.id, ...diff(existing, updated), ip });
        return updated;
      },
    });
  }

  // ---- Monthly input definitions (input grid columns) ----
  const inputDefBody = z.object({
    key: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'Use upper-case letters, digits and underscores (e.g. ARREARS).'),
    label: z.string().trim().min(1).max(80),
    dataType: z.enum(['NUMBER', 'TEXT']).default('NUMBER'),
    mandatory: z.boolean().default(false),
    minValue: decimalString.nullable().optional(),
    maxValue: decimalString.nullable().optional(),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    active: z.boolean().default(true),
    description: z.string().trim().max(500).nullable().optional(),
  });

  r.add({
    method: 'get',
    path: '/payroll-input-definitions',
    tag: 'Masters',
    summary: 'List monthly input definitions (columns of the payroll input grid)',
    permission: ['payroll.view', 'settings.manage', 'salary.view'],
    handler: async () => prisma.payrollInputDefinition.findMany({ orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] }),
  });
  r.add({
    method: 'post',
    path: '/payroll-input-definitions',
    tag: 'Masters',
    summary: 'Create a monthly input definition',
    permission: 'settings.manage',
    status: 201,
    body: inputDefBody,
    handler: async ({ body, user, ip }) => {
      const created = await prisma.payrollInputDefinition.create({ data: { ...body, createdById: user.id, updatedById: user.id } });
      await audit.write({ actorId: user.id, action: 'input_definition.created', entity: 'payroll_input_definition', entityId: created.id, after: created, ip });
      return created;
    },
  });
  r.add({
    method: 'put',
    path: '/payroll-input-definitions/:id',
    tag: 'Masters',
    summary: 'Update a monthly input definition (the key cannot change)',
    permission: 'settings.manage',
    params: idParam,
    body: inputDefBody.omit({ key: true }).partial(),
    handler: async ({ params, body, user, ip }) => {
      const existing = await prisma.payrollInputDefinition.findUnique({ where: { id: params.id } });
      if (!existing) throw notFound('Input definition');
      const updated = await prisma.payrollInputDefinition.update({ where: { id: params.id }, data: { ...body, updatedById: user.id } });
      await audit.write({ actorId: user.id, action: 'input_definition.updated', entity: 'payroll_input_definition', entityId: params.id, ...diff(existing, updated), ip });
      return updated;
    },
  });

  // ---- Settings ----
  r.add({
    method: 'get',
    path: '/settings',
    tag: 'Settings',
    summary: 'Payroll business settings and configuration status',
    permission: ['payroll.view', 'settings.manage'],
    handler: async () => ({
      ...(await getSettings()),
      rulesApproved: config.PAYROLL_RULES_APPROVED,
      viewerRoleEnabled: config.VIEWER_ROLE_ENABLED,
      payslipCompanyName: config.PAYSLIP_COMPANY_NAME,
    }),
  });
  r.add({
    method: 'put',
    path: '/settings',
    tag: 'Settings',
    summary: 'Update payroll business settings (rounding, approval policy, version selection, warnings)',
    permission: 'settings.manage',
    body: settingsSchema.omit({ statutory: true }).partial(),
    handler: async ({ body, user, ip }) => {
      const before = await getSettings();
      await prisma.$transaction(
        Object.entries(body).map(([key, value]) =>
          prisma.payrollSetting.upsert({ where: { key }, create: { key, value: value as object, updatedById: user.id }, update: { value: value as object, updatedById: user.id } }),
        ),
      );
      const after = await getSettings();
      await audit.write({ actorId: user.id, action: 'settings.updated', entity: 'payroll_settings', entityId: null, ...diff(before, after), ip });
      return { ...after, rulesApproved: config.PAYROLL_RULES_APPROVED, viewerRoleEnabled: config.VIEWER_ROLE_ENABLED, payslipCompanyName: config.PAYSLIP_COMPANY_NAME };
    },
  });
}
