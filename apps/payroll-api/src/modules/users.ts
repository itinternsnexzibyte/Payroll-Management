import { z } from 'zod';
import { AppError, diff, hashPassword, idParam, listQuery, notFound, passwordSchema, skipTake, toPage, type ApiRegistry } from '@nexzi/server-core';
import { prisma, Prisma } from '../db';
import { audit } from '../audit';
import { PERMISSIONS, type Permission } from '../permissions';
import { config } from '../config';

const userSelect = {
  id: true,
  email: true,
  name: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, code: true, name: true, enabled: true } },
} satisfies Prisma.UserSelect;

async function assertNotRemovingLastAdmin(userId: string, nextRoleId: string | undefined, nextStatus: string | undefined) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!user || user.role.code !== 'ADMIN' || user.status !== 'ACTIVE') return;
  const leavingAdmin = (nextRoleId && nextRoleId !== user.roleId) || nextStatus === 'DISABLED';
  if (!leavingAdmin) return;
  const otherAdmins = await prisma.user.count({ where: { role: { code: 'ADMIN' }, status: 'ACTIVE', id: { not: userId } } });
  if (otherAdmins === 0) throw new AppError('INVALID_STATE', 'At least one active Administrator must remain.');
}

export function registerUserRoutes(r: ApiRegistry) {
  r.add({
    method: 'get',
    path: '/users',
    tag: 'Users & Roles',
    summary: 'List users',
    permission: 'users.manage',
    query: listQuery(['name', 'email', 'createdAt', 'lastLoginAt'], 'name', { status: z.enum(['ACTIVE', 'DISABLED', 'PENDING']).optional(), roleId: z.string().uuid().optional() }),
    handler: async ({ query }) => {
      const where: Prisma.UserWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.roleId ? { roleId: query.roleId } : {}),
        ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } }] } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.user.findMany({ where, select: userSelect, orderBy: { [query.sortBy]: query.sortDir }, ...skipTake(query.page, query.pageSize) }),
        prisma.user.count({ where }),
      ]);
      return toPage(items, total, query.page, query.pageSize);
    },
  });

  r.add({
    method: 'post',
    path: '/users',
    tag: 'Users & Roles',
    summary: 'Create a user with a temporary password (must be changed at first sign-in)',
    permission: 'users.manage',
    status: 201,
    body: z.object({
      email: z.string().trim().toLowerCase().email().max(200),
      name: z.string().trim().min(2).max(120),
      roleId: z.string().uuid(),
      temporaryPassword: passwordSchema,
    }),
    handler: async ({ body, user, ip }) => {
      const role = await prisma.role.findUnique({ where: { id: body.roleId } });
      if (!role) throw notFound('Role');
      if (role.code === 'VIEWER' && !config.VIEWER_ROLE_ENABLED) throw new AppError('INVALID_STATE', 'The Viewer role is not enabled. It must be confirmed with the client first.');
      const exists = await prisma.user.findFirst({ where: { email: { equals: body.email, mode: 'insensitive' } } });
      if (exists) throw new AppError('CONFLICT', 'A user with this email already exists.', { fields: [{ path: 'email', message: 'Already in use.' }] });
      const created = await prisma.user.create({
        data: { email: body.email, name: body.name, roleId: role.id, passwordHash: await hashPassword(body.temporaryPassword), mustChangePassword: true, createdById: user.id, updatedById: user.id },
        select: userSelect,
      });
      await audit.write({ actorId: user.id, action: 'user.created', entity: 'user', entityId: created.id, after: { email: created.email, name: created.name, role: role.code }, ip });
      return created;
    },
  });

  r.add({
    method: 'put',
    path: '/users/:id',
    tag: 'Users & Roles',
    summary: 'Update a user (name, role, status)',
    permission: 'users.manage',
    params: idParam,
    body: z.object({ name: z.string().trim().min(2).max(120).optional(), roleId: z.string().uuid().optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }),
    handler: async ({ params, body, user, ip }) => {
      const existing = await prisma.user.findUnique({ where: { id: params.id }, include: { role: true } });
      if (!existing) throw notFound('User');
      if (params.id === user.id && (body.status === 'DISABLED' || (body.roleId && body.roleId !== existing.roleId))) {
        throw new AppError('INVALID_STATE', 'You cannot disable your own account or change your own role.');
      }
      if (body.roleId) {
        const role = await prisma.role.findUnique({ where: { id: body.roleId } });
        if (!role) throw notFound('Role');
        if (role.code === 'VIEWER' && !config.VIEWER_ROLE_ENABLED) throw new AppError('INVALID_STATE', 'The Viewer role is not enabled.');
      }
      await assertNotRemovingLastAdmin(params.id, body.roleId, body.status);
      const updated = await prisma.user.update({ where: { id: params.id }, data: { ...body, updatedById: user.id }, select: userSelect });
      if (body.status === 'DISABLED' || (body.roleId && body.roleId !== existing.roleId)) {
        await prisma.session.updateMany({ where: { userId: params.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      const changes = diff({ name: existing.name, roleId: existing.roleId, status: existing.status }, { name: updated.name, roleId: updated.role.id, status: updated.status });
      await audit.write({ actorId: user.id, action: 'user.updated', entity: 'user', entityId: params.id, ...changes, ip });
      return updated;
    },
  });

  r.add({
    method: 'post',
    path: '/users/:id/reset-password',
    tag: 'Users & Roles',
    summary: 'Set a temporary password, unlock the account and revoke sessions',
    permission: 'users.manage',
    params: idParam,
    body: z.object({ temporaryPassword: passwordSchema }),
    handler: async ({ params, body, user, ip }) => {
      const target = await prisma.user.findUnique({ where: { id: params.id } });
      if (!target) throw notFound('User');
      await prisma.user.update({
        where: { id: params.id },
        data: { passwordHash: await hashPassword(body.temporaryPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, updatedById: user.id },
      });
      await prisma.session.updateMany({ where: { userId: params.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit.write({ actorId: user.id, action: 'user.password_reset', entity: 'user', entityId: params.id, ip });
      return undefined;
    },
  });

  r.add({
    method: 'post',
    path: '/users/:id/unlock',
    tag: 'Users & Roles',
    summary: 'Clear a sign-in lockout',
    permission: 'users.manage',
    params: idParam,
    handler: async ({ params, user, ip }) => {
      await prisma.user.update({ where: { id: params.id }, data: { failedLoginCount: 0, lockedUntil: null, updatedById: user.id } });
      await audit.write({ actorId: user.id, action: 'user.unlocked', entity: 'user', entityId: params.id, ip });
      return undefined;
    },
  });

  r.add({
    method: 'get',
    path: '/roles',
    tag: 'Users & Roles',
    summary: 'List roles with permissions',
    permission: 'users.manage',
    handler: async () => {
      const roles = await prisma.role.findMany({ include: { permissions: true, _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
      return roles.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        description: role.description,
        enabled: role.code === 'VIEWER' ? role.enabled && config.VIEWER_ROLE_ENABLED : role.enabled,
        configurable: role.code !== 'VIEWER' || config.VIEWER_ROLE_ENABLED,
        userCount: role._count.users,
        permissions: role.permissions.map((p) => p.permissionCode).sort(),
      }));
    },
  });

  r.add({
    method: 'get',
    path: '/permissions',
    tag: 'Users & Roles',
    summary: 'Permission catalogue',
    permission: 'users.manage',
    handler: async () => Object.entries(PERMISSIONS).map(([code, description]) => ({ code, description })),
  });

  r.add({
    method: 'put',
    path: '/roles/:id/permissions',
    tag: 'Users & Roles',
    summary: "Replace a role's permissions (applies the client's confirmed permission matrix)",
    permission: 'users.manage',
    params: idParam,
    body: z.object({ permissions: z.array(z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]])).max(50) }),
    handler: async ({ params, body, user, ip }) => {
      const role = await prisma.role.findUnique({ where: { id: params.id }, include: { permissions: true } });
      if (!role) throw notFound('Role');
      if (role.code === 'ADMIN' && !body.permissions.includes('users.manage')) {
        throw new AppError('INVALID_STATE', 'The Administrator role must keep the "Manage users and roles" permission.');
      }
      if (role.code === 'VIEWER') {
        const writes = body.permissions.filter((p) => !/\.view(_\w+)?$/.test(p));
        if (writes.length) throw new AppError('INVALID_STATE', 'The Viewer role is read-only; only view permissions may be granted.');
      }
      const before = role.permissions.map((p) => p.permissionCode).sort();
      await prisma.$transaction([
        prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
        prisma.rolePermission.createMany({ data: [...new Set(body.permissions)].map((p) => ({ roleId: role.id, permissionCode: p })) }),
      ]);
      await audit.write({ actorId: user.id, action: 'role.permissions_changed', entity: 'role', entityId: role.id, before: { permissions: before }, after: { permissions: [...new Set(body.permissions)].sort() }, ip });
      return { id: role.id, permissions: [...new Set(body.permissions)].sort() };
    },
  });

  r.add({
    method: 'get',
    path: '/audit-logs',
    tag: 'Audit',
    summary: 'Search the audit log',
    permission: 'audit.view',
    query: listQuery(['occurredAt'], 'occurredAt', {
      entity: z.string().max(50).optional(),
      entityId: z.string().max(64).optional(),
      action: z.string().max(80).optional(),
      actorId: z.string().uuid().optional(),
      from: z.string().date().optional(),
      to: z.string().date().optional(),
    }),
    handler: async ({ query }) => {
      const where: Prisma.AuditLogWhereInput = {
        ...(query.entity ? { entity: query.entity } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.search ? { OR: [{ actorEmail: { contains: query.search, mode: 'insensitive' } }, { action: { contains: query.search, mode: 'insensitive' } }, { entityId: { contains: query.search } }] } : {}),
        ...(query.from || query.to
          ? { occurredAt: { ...(query.from ? { gte: new Date(query.from + 'T00:00:00Z') } : {}), ...(query.to ? { lt: new Date(new Date(query.to + 'T00:00:00Z').getTime() + 86_400_000) } : {}) } }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({ where, orderBy: { occurredAt: query.sortDir === 'asc' ? 'asc' : 'desc' }, ...skipTake(query.page, query.pageSize) }),
        prisma.auditLog.count({ where }),
      ]);
      return toPage(items.map((i) => ({ ...i, id: i.id.toString() })), total, query.page, query.pageSize);
    },
  });
}
