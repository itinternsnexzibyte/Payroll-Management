import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * Starts dedicated API + web instances on separate ports against the *_test databases, so E2E
 * runs never touch development data. Uses an installed Chrome/Edge (E2E_BROWSER_CHANNEL,
 * default "msedge"); set it to "chromium" after `npx playwright install chromium` on CI.
 */
const root = resolve(__dirname, '..');
const DB = process.env.E2E_DB_BASE ?? 'postgresql://nexzi_dev:nexzi_dev_only@localhost:5433';
export const E2E = {
  payrollWeb: 'http://localhost:3101',
  payrollApi: 'http://localhost:4101',
  payrollDb: `${DB}/payroll_test?schema=public`,
  password: 'E2e-Strong-Pass-2026',
};

const apiEnv = (port: number, web: string, db: string) => ({
  NODE_ENV: 'test',
  PORT: String(port),
  DATABASE_URL: db,
  ALLOWED_ORIGINS: `${web},http://localhost:${port}`,
  STORAGE_DIR: resolve(root, '.data/e2e-storage'),
  LOG_LEVEL: 'warn',
});

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  // Generous: the web servers run in dev mode and compile each page on first visit.
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  globalSetup: './global-setup.ts',
  use: {
    channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  webServer: [
    { command: 'npx tsx src/server.ts', cwd: resolve(root, 'apps/payroll-api'), url: `${E2E.payrollApi}/health`, env: apiEnv(4101, E2E.payrollWeb, E2E.payrollDb), reuseExistingServer: false, timeout: 120_000 },
    { command: 'npx next dev -p 3101', cwd: resolve(root, 'apps/payroll-web'), url: `${E2E.payrollWeb}/login`, env: { API_INTERNAL_URL: E2E.payrollApi, NEXT_DIST_DIR: '.next-e2e' }, reuseExistingServer: false, timeout: 240_000 },
  ],
});
