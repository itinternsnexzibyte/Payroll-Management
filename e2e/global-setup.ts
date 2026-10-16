import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { E2E } from './playwright.config';

/** Migrates and empties the payroll_test database, then seeds roles and E2E users. */
export default async function globalSetup() {
  const root = resolve(__dirname, '..');
  const run = (cwd: string, cmd: string, env: Record<string, string>) => execSync(cmd, { cwd: resolve(root, cwd), env: { ...process.env, ...env }, stdio: 'pipe' });
  for (const [app, db, userVar, userEmail] of [
    ['apps/payroll-api', E2E.payrollDb, 'SEED_PAYROLL_USER', 'payroll.user@e2e.local'],
  ] as const) {
    const env = { DATABASE_URL: db };
    run(app, 'npx prisma migrate deploy', env);
    run(app, 'npx tsx scripts/reset-db.ts', env);
    run(app, 'npx tsx prisma/seed.ts', {
      ...env,
      NODE_ENV: 'development',
      SEED_DEMO_DATA: 'false',
      SEED_ADMIN_EMAIL: 'admin@e2e.local',
      SEED_ADMIN_PASSWORD: E2E.password,
      [`${userVar}_EMAIL`]: userEmail,
      [`${userVar}_PASSWORD`]: E2E.password,
    });
  }
}
