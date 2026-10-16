import { expect, test } from '@playwright/test';
import { E2E } from '../playwright.config';
import { apiCall, login } from './helpers';

const WEB = E2E.payrollWeb;

test('payroll: employee → salary structure → monthly run → finalise → payslip → immutable after salary change', async ({ page }) => {
  // 1. Administrator logs in
  await login(page, WEB, 'admin@e2e.local');

  // Configuration prerequisites through the UI: a salary component and a monthly input column.
  await page.goto(`${WEB}/settings`);
  await page.getByRole('tab', { name: 'Monthly input columns' }).click();
  await page.getByRole('button', { name: 'Add column' }).click();
  await page.getByLabel('Key').fill('BONUS');
  await page.getByLabel('Label (as in the workbook)').fill('Bonus');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: /Bonus/ }).first()).toBeVisible();

  await page.goto(`${WEB}/salary-components`);
  await page.getByRole('button', { name: 'Add component' }).click();
  await page.getByLabel('Code').fill('BASIC');
  await page.getByLabel('Name (as on payslip)').fill('Basic');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Salary component saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Add component' }).click();
  await page.getByLabel('Code').fill('BONUS_PAY');
  await page.getByLabel('Name (as on payslip)').fill('Bonus pay');
  await page.getByLabel('Calculation basis').selectOption('INPUT');
  await page.getByLabel('Monthly input').selectOption('BONUS');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Salary component saved.')).toBeVisible();

  // 2. Administrator creates an employee
  await page.goto(`${WEB}/employees/new`);
  await page.getByLabel('Employee ID').fill('E2E-001');
  await page.getByLabel('Employee name').fill('Test Person E2E');
  await page.getByLabel('Joining date').fill('2024-01-01');
  await page.getByRole('button', { name: 'Create employee' }).click();
  await expect(page.getByRole('heading', { name: 'Test Person E2E' })).toBeVisible();

  // 3. Administrator configures the salary structure (new version)
  await page.getByRole('button', { name: 'New salary version' }).click();
  await page.getByLabel('Effective from').fill('2024-01-01');
  await page.getByLabel('Reason for change').fill('Initial structure');
  await page.getByLabel('Basic').fill('25000');
  await page.getByRole('button', { name: 'Save version' }).click();
  await expect(page.getByText('Version 1 ·', { exact: false })).toBeVisible();

  // 4. Start a payroll run (current month)
  await page.goto(`${WEB}/payroll`);
  await page.getByRole('button', { name: 'Start payroll run' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Start / }).click();
  await expect(page.getByRole('heading', { name: /payroll$/ })).toBeVisible();
  const runUrl = page.url();
  const runId = runUrl.split('/').pop()!;

  // 5. Monthly inputs are saved in the grid
  const cell = page.getByLabel('Bonus for E2E-001');
  await cell.fill('1500.50');
  await page.getByRole('button', { name: 'Save inputs' }).click();
  await expect(page.getByText(/1 cell\(s\) saved/)).toBeVisible();

  // 6. Server calculation
  await page.getByRole('button', { name: 'Calculate', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText(/Calculated: 1 OK/)).toBeVisible();
  await expect(page.getByText('26,500.50').first()).toBeVisible();

  // 7. Review and approval
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByText('Payroll is now Under review.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Payroll is now Approved.')).toBeVisible();

  // 8. Finalise
  await page.getByRole('button', { name: 'Finalise' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finalise' }).click();
  await expect(page.getByText('Payroll is now Finalised.')).toBeVisible();

  // 9. Payslip generated and downloaded
  await page.getByRole('tab', { name: 'Payslips' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).first().click()]);
  expect(download.suggestedFilename()).toMatch(/^payslip-E2E-001-\d{4}-\d{2}\.pdf$/);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(path).subarray(0, 4).toString()).toBe('%PDF');

  // 10. The finalised run is unchanged after a salary master update
  const emp = await apiCall(page.request, WEB, 'GET', '/employees?search=E2E-001');
  const empId = emp.body.items[0].id;
  const comps = await apiCall(page.request, WEB, 'GET', '/salary-components');
  const basic = comps.body.items.find((c: { code: string }) => c.code === 'BASIC');
  const tomorrowish = new Date(Date.now() - 86_400_000 * 0).toISOString().slice(0, 10);
  const upd = await apiCall(page.request, WEB, 'POST', `/employees/${empId}/salary`, { effectiveFrom: tomorrowish, changeReason: 'Increment after finalisation', values: [{ componentId: basic.id, value: '99999' }] });
  expect(upd.status).toBe(201);
  await page.goto(runUrl);
  await page.getByRole('tab', { name: 'Results' }).click();
  await expect(page.getByText('26,500.50').first()).toBeVisible();
  const run = await apiCall(page.request, WEB, 'GET', `/payroll-runs/${runId}`);
  expect(run.body.status).toBe('FINALISED');
  expect(run.body.totalNet).toBe('26500.5');

  // A Payroll User cannot re-open or approve even with direct API calls
  const ctx = await page.context().browser()!.newContext();
  const userPage = await ctx.newPage();
  await login(userPage, WEB, 'payroll.user@e2e.local');
  const reopen = await apiCall(userPage.request, WEB, 'POST', `/payroll-runs/${runId}/reopen`, { reason: 'Trying to bypass the interface' });
  expect(reopen.status).toBe(403);
  await userPage.goto(`${WEB}/admin/users`);
  await expect(userPage.getByText('Access denied')).toBeVisible();
  await ctx.close();
});
