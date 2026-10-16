// Applies migrations to the test database once per test run.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export default function setup() {
  const root = resolve(__dirname, '..');
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set for tests.');
  execSync('npx prisma migrate deploy', { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
