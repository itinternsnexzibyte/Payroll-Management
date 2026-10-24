import { passwordSchema } from '@nexzi/server-core';
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
      const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
      if (!email) return;
      if ((await prisma.user.count({ where: { role: { code: 'ADMIN' }, status: 'ACTIVE' } })) > 0) return;
      const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';
      if (!passwordSchema.safeParse(password).success) {
        logger.error('BOOTSTRAP_ADMIN_PASSWORD is missing or too weak — first Administrator not created');
        return;
      }
      await createUser(email, process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Administrator', 'ADMIN', password, true);
      logger.info({ email }, 'First Administrator created (password must be changed at first sign-in)');
    })();
  }
  return preparation;
}
