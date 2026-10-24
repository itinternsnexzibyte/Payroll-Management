import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E } from '../playwright.config';

export async function login(page: Page, base: string, email: string, password = E2E.password) {
  const portal = email.startsWith('admin@') ? '?as=admin' : '';
  await page.goto(`${base}/login${portal}`);
  // Dev servers compile on first request; wait until the page is hydrated before interacting.
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const response = page.waitForResponse((res) => res.url().endsWith('/api/auth/login'));
  await page.getByRole('button', { name: /^Sign in as/ }).click({ noWaitAfter: true });
  const result = await response;
  expect(result.ok(), `Sign-in failed with HTTP ${result.status()}`).toBeTruthy();
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible({ timeout: 90_000 });
}

/** Calls the API through the web app's proxy with the page's session cookie (same as the browser). */
export async function apiCall(request: APIRequestContext, base: string, method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown) {
  const res = await request.fetch(`${base}/api${path}`, { method, data, headers: { Origin: base, 'Content-Type': 'application/json' } });
  return { status: res.status(), body: res.headers()['content-type']?.includes('json') ? await res.json() : null };
}

export const today = () => new Date().toISOString().slice(0, 10);
