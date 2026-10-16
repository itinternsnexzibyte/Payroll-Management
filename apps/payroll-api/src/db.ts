import { Prisma, PrismaClient } from '../generated/client';
import { config } from './config';

export const prisma = new PrismaClient({
  datasources: { db: { url: config.DATABASE_URL } },
  log: [{ level: 'warn', emit: 'stdout' }],
});

export type Tx = Prisma.TransactionClient;
export { Prisma };
