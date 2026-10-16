import { closePdfBrowser, passwordSchema } from '@nexzi/server-core';
import { createApp, logger } from './app';
import { createUser, ensureRoles } from './bootstrap';
import { ensureDefaultChecklist } from './knowledge/routes';
import { config } from './config';
import { prisma } from './db';

/**
 * Roles must exist before anyone can sign up (new accounts get the Payroll User role), so create
 * any missing ones at start-up. Optionally create the first Administrator from BOOTSTRAP_ADMIN_*
 * when none exists — useful on hosts without shell access.
 */
async function prepareDatabase() {
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
}

prepareDatabase().catch((err: Error) => logger.error({ err: err.message }, 'Start-up database preparation failed'));

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, rulesApproved: config.PAYROLL_RULES_APPROVED }, `Payroll API listening on http://localhost:${config.PORT} (docs: /docs)`);
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await closePdfBrowser();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
