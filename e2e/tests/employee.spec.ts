/**
 * T1 Employee happy path: HR_ADMIN lists employees, opens one, sees its detail.
 * Sensitive fields visibility is enforced by the RBAC matrix (rbac-matrix.spec).
 */

import { test, expect } from '@playwright/test';
import { contextAsRole } from '../lib/session';

test('employee: HR_ADMIN can browse employees list and open a profile', async ({ browser }) => {
  const ctx = await contextAsRole(browser, 'HR_ADMIN');
  const page = await ctx.newPage();

  await page.goto('/employees', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Expect either a heading or at least one employee row
  const rows = await page.locator('a[href*="/employees/"]').count();
  expect(rows, 'employees list should have at least one row linking to a profile').toBeGreaterThan(0);

  // Click the first profile link
  await page.locator('a[href*="/employees/"]').first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Expect EMP code somewhere and a tab structure
  const bodyText = await page.locator('body').textContent();
  expect(bodyText ?? '').toMatch(/EMP[-\s]?\d+/i);

  await ctx.close();
});

test('employee: Staff Directory cards are clickable links to profile', async ({ browser }) => {
  const ctx = await contextAsRole(browser, 'EMPLOYEE');
  const page = await ctx.newPage();

  await page.goto('/staff', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const cardLinks = await page.locator('a[href*="/employees/"]').count();
  expect(cardLinks, 'staff directory cards should link to /employees/[id]').toBeGreaterThan(0);

  await ctx.close();
});
