import { closePdfBrowser } from '@nexzi/server-core';
import { createApp, logger } from './app';
import { config } from './config';
import { prisma } from './db';

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
