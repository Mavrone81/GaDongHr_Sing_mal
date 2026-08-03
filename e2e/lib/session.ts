/**
 * Test fixtures: spin up a Playwright BrowserContext authenticated as a given
 * role. Forges a JWT (no /login round-trip) so most tests run in milliseconds.
 *
 *   import { test, expect } from '../fixtures/auth';
 *   test('hr can see employees', async ({ asRole }) => {
 *     const page = await asRole('HR_ADMIN');
 *     await page.goto('/employees');
 *     await expect(page.locator('h1')).toContainText('Employees');
 *   });
 */

import { Browser, BrowserContext, Page } from '@playwright/test';
import { signJwt } from './jwt';
import { TEST_USERS } from './testUsers';
import { Role } from './roles';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const BASE_HOST = new URL(BASE_URL).hostname;

/** Build a fresh context with a cookie set for the given role. */
export async function contextAsRole(browser: Browser, role: Role): Promise<BrowserContext> {
  const user = TEST_USERS[role];
  if (user.id === 'PLACEHOLDER') {
    throw new Error(
      `Test user for role ${role} is not seeded. Run \`npm run seed-test-users\` from e2e/.`
    );
  }
  const token = signJwt(user, role);
  const context = await browser.newContext();
  await context.addCookies([{
    name: 'gadonghr_token',
    value: token,
    domain: BASE_HOST,
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  }]);
  return context;
}

/** Convenience: context + a page in one call. */
export async function pageAsRole(browser: Browser, role: Role): Promise<{ context: BrowserContext; page: Page }> {
  const context = await contextAsRole(browser, role);
  const page = await context.newPage();
  return { context, page };
}
