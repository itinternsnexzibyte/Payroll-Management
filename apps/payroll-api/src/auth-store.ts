import type { AuthStore, AuthUserRecord } from '@nexzi/server-core';
import { prisma } from './db';
import { config } from './config';

const userInclude = { role: { include: { permissions: true } } } as const;

type UserWithRole = NonNullable<Awaited<ReturnType<typeof findUser>>>;
const findUser = (where: { id: string } | { email: string }) => prisma.user.findUnique({ where, include: userInclude });

function roleEnabled(code: string, enabled: boolean) {
  if (code === 'VIEWER') return enabled && config.VIEWER_ROLE_ENABLED;
  return enabled;
}

function toRecord(u: UserWithRole): AuthUserRecord {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    passwordHash: u.passwordHash,
    status: u.status,
    failedLoginCount: u.failedLoginCount,
    lockedUntil: u.lockedUntil,
    mustChangePassword: u.mustChangePassword,
    roleCode: u.role.code,
    roleName: u.role.name,
    roleEnabled: roleEnabled(u.role.code, u.role.enabled),
    permissions: u.role.permissions.map((p) => p.permissionCode),
  };
}

export const authStore: AuthStore = {
  async findUserByEmail(email) {
    const u = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, include: userInclude });
    return u ? toRecord(u) : null;
  },
  async findUserById(id) {
    const u = await findUser({ id });
    return u ? toRecord(u) : null;
  },
  async setLoginFailure(userId, failedLoginCount, lockedUntil) {
    await prisma.user.update({ where: { id: userId }, data: { failedLoginCount, lockedUntil } });
  },
  async recordLoginSuccess(userId) {
    await prisma.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  },
  async createSession(data) {
    return prisma.session.create({ data, select: { id: true } });
  },
  async findSessionByTokenHash(tokenHash) {
    return prisma.session.findUnique({ where: { tokenHash } });
  },
  async touchSession(id, at) {
    await prisma.session.update({ where: { id }, data: { lastSeenAt: at } });
  },
  async revokeSession(id) {
    await prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  },
  async revokeUserSessions(userId, exceptSessionId) {
    await prisma.session.updateMany({ where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) }, data: { revokedAt: new Date() } });
  },
  async updatePassword(userId, passwordHash) {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false, updatedById: userId } });
  },
};
