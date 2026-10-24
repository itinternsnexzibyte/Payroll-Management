import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { E2E } from '../playwright.config';
import { login } from './helpers';

const MAILBOX = resolve(__dirname, '../../.data/e2e-storage/dev-mailbox');

/** Reads the newest verification email for an address from the API's dev mailbox (no SMTP in tests). */
async function codeFor(email: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    if (existsSync(MAILBOX)) {
      const files = readdirSync(MAILBOX).filter((f) => f.includes(email.replace(/[^a-z0-9@._-]/gi, '_'))).sort();
      for (const f of files.reverse()) {
        const m = JSON.parse(readFileSync(resolve(MAILBOX, f), 'utf8')) as { subject: string };
        const c = /verification code is (\d{6})/.exec(m.subject);
        if (c) return c[1];
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No verification email found for ${email}`);
}

for (const [name, base] of [
  ['Payroll', E2E.payrollWeb],
] as const) {
  test(`${name}: sign up with an emailed verification code, then sign in`, async ({ page }) => {
    const email = `signup.${Date.now()}@example.test`;
    const password = 'Browser-Signup-Pass-9';

    await page.goto(`${base}/login`);
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

    // Step 1: email
    await page.waitForLoadState('networkidle');
    await page.locator('#su-email').fill(email);
    await page.getByRole('button', { name: 'Send verification code' }).click();
    await expect(page.getByText('Check your email')).toBeVisible();

    // Step 2: wrong code is refused, the emailed code is accepted
    const code = await codeFor(email);
    await page.locator('#su-code').fill(code === '000000' ? '111111' : '000000');
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page.getByText(/The code is incorrect\. 4 attempt/)).toBeVisible();
    await page.locator('#su-code').fill(code);
    await page.getByRole('button', { name: 'Verify code' }).click();
    await expect(page.getByText(`${email} verified`)).toBeVisible();

    // Step 3: name + password (with validation), then sign up
    await page.locator('#su-name').fill('Browser Signup');
    await page.locator('#su-pw').fill('short');
    await page.locator('#su-confirm').fill('short');
    await page.getByRole('button', { name: 'Create User account' }).click();
    await expect(page.getByText(/Use at least 10 characters/)).toBeVisible();
    await page.locator('#su-pw').fill(password);
    await page.locator('#su-confirm').fill(password);
    await page.getByRole('button', { name: 'Create User account' }).click();
    await expect(page.getByRole('heading', { name: 'Account created' })).toBeVisible();

    // Sign in with the new account
    await page.getByRole('button', { name: 'Go to sign in' }).click();
    await login(page, base, email, password);
    await expect(page.getByText('Browser Signup').first()).toBeVisible();
  });
}