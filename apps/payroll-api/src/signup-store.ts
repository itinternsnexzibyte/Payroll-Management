import type { SignupStore } from '@nexzi/server-core';
import { prisma } from './db';

/** Role given to self-registered accounts; the Administrator can change it when approving. */
const DEFAULT_SIGNUP_ROLE = 'PAYROLL_USER';

export const signupStore: SignupStore = {
  async userExists(email) {
    return Boolean(await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }));
  },
  countRecent(email, since) {
    return prisma.emailVerification.count({ where: { email, createdAt: { gte: since } } });
  },
  latest(email) {
    return prisma.emailVerification.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } });
  },
  create(data) {
    return prisma.emailVerification.create({ data, select: { id: true } });
  },
  async incrementAttempts(id) {
    await prisma.emailVerification.update({ where: { id }, data: { attempts: { increment: 1 } } });
  },
  async markVerified(id, tokenHash, tokenExpiresAt) {
    await prisma.emailVerification.update({ where: { id }, data: { verifiedAt: new Date(), tokenHash, tokenExpiresAt } });
  },
  findByToken(tokenHash) {
    return prisma.emailVerification.findUnique({ where: { tokenHash } });
  },
  completeSignup(d) {
    return prisma.$transaction(async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { code: DEFAULT_SIGNUP_ROLE } });
      const consumed = await tx.emailVerification.updateMany({ where: { id: d.verificationId, consumedAt: null }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new Error('Verification already used');
      return tx.user.create({ data: { email: d.email, name: d.name, passwordHash: d.passwordHash, roleId: role.id, status: d.active ? 'ACTIVE' : 'PENDING' }, select: { id: true } });
    });
  },
};