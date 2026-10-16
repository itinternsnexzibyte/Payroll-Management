import { hashPassword } from '@nexzi/server-core';
import { prisma } from './db';
import { ROLE_DEFAULTS } from './permissions';

/** Creates roles and their default permissions if missing. Existing role permissions are left untouched. */
export async function ensureRoles() {
  for (const [code, def] of Object.entries(ROLE_DEFAULTS)) {
    const existing = await prisma.role.findUnique({ where: { code } });
    if (existing) continue;
    await prisma.role.create({
      data: { code, name: def.name, description: def.description, enabled: def.enabledByDefault, permissions: { create: def.permissions.map((p) => ({ permissionCode: p })) } },
    });
  }
  // New permission codes added in later releases are granted to ADMIN automatically.
  const admin = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' }, include: { permissions: true } });
  const have = new Set(admin.permissions.map((p) => p.permissionCode));
  const missing = ROLE_DEFAULTS.ADMIN.permissions.filter((p) => !have.has(p));
  if (missing.length) await prisma.rolePermission.createMany({ data: missing.map((p) => ({ roleId: admin.id, permissionCode: p })) });
}

/** Creates a user. `syncPassword` (development seed only) resets an existing account to the given password. */
export async function createUser(email: string, name: string, roleCode: string, password: string, mustChangePassword: boolean, syncPassword = false) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: syncPassword ? { passwordHash, failedLoginCount: 0, lockedUntil: null } : {},
    create: { email: email.toLowerCase(), name, roleId: role.id, passwordHash, mustChangePassword },
  });
}
