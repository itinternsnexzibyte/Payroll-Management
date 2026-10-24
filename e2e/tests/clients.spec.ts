import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { E2E } from '../playwright.config';
import { login } from './helpers';

test('clients: manage profile, encrypted documents, and cleanup', async ({ page }) => {
  await login(page, E2E.payrollWeb, 'admin@e2e.local');
  await page.goto(`${E2E.payrollWeb}/clients`);
  await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible();
  await page.getByRole('button', { name: 'Add client' }).click();
  await page.getByLabel('Client name').fill('E2E Secure Client');
  await page.getByLabel('Country', { exact: true }).fill('United States');
  await page.getByLabel('City', { exact: true }).fill('Boston');
  await page.getByLabel('Availability').selectOption('AVAILABLE');
  await page.getByLabel('Available from').fill('09:00');
  await page.getByLabel('Available to').fill('17:00');
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page.getByText('E2E Secure Client')).toBeVisible();

  await page.getByRole('button', { name: 'Documents' }).click();
  await page.getByLabel('Document type').selectOption('AADHAAR');
  await page.getByLabel('PDF or image (maximum 5 MB)').setInputFiles({
    name: 'identity.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nsynthetic identity test data\n%%EOF'),
  });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByText('identity.pdf')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download identity.pdf' }).click(),
  ]);
  expect(readFileSync(await download.path()).toString()).toContain('synthetic identity test data');

  await page.getByRole('button', { name: 'Delete identity.pdf' }).click();
  await page.getByRole('button', { name: 'Delete document' }).click();
  await expect(page.getByText('No documents uploaded')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Delete E2E Secure Client' }).click();
  await page.getByRole('button', { name: 'Delete client' }).click();
  await expect(page.getByText('No clients added')).toBeVisible();
});
