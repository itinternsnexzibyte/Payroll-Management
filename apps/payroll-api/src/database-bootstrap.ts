import { hashPassword, passwordSchema } from '@nexzi/server-core';
import type { Logger } from 'pino';
import { createUser, ensureRoles } from './bootstrap';
import { ensureDefaultChecklist } from './knowledge/routes';
import { prisma } from './db';

let preparation: Promise<void> | undefined;

export function prepareDatabase(logger: Logger): Promise<void> {
  if (!preparation) {
    preparation = (async () => {
      await ensureRoles();
      await ensureDefaultChecklist();
      // Clear any temporary lockouts on startup so service restarts restore access immediately
      await prisma.user.updateMany({
        where: { lockedUntil: { not: null } },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
      if (!email) return;
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
      if (!passwordSchema.safeParse(password).success) {
        logger.error('BOOTSTRAP_ADMIN_PASSWORD is missing or too weak — first Administrator not created');
        return;
      }
      const existing = await prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        include: { role: true },
      });
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash: await hashPassword(password),
            failedLoginCount: 0,
            lockedUntil: null,
            mustChangePassword: false,
          },
        });
        logger.info({ email }, 'Administrator unlocked and password synchronized from BOOTSTRAP_ADMIN_PASSWORD');
        return;
      }
      await createUser(email, process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator', 'ADMIN', password, false);
      logger.info({ email }, 'First Administrator created');
    })();
  }
  return preparation;
}
