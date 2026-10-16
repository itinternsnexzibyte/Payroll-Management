/**
 * Empties every table of the configured database. Refuses to run unless the database name ends
 * in "_test" so it can never wipe a development or production database. Used by E2E tests.
 */
import { prisma } from '../src/db';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const db = new URL(url).pathname.slice(1);
  if (!db.endsWith('_test')) throw new Error(`Refusing to reset database "${db}" (name must end with _test).`);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  console.log(`Reset ${tables.length} tables in ${db}.`);
}

main()
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
