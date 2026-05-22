/**
 * T0 Smoke: for each role, dashboard renders without page errors and the
 * sidebar carries at least one nav item matching the role's RBAC scope.
 */

import { test, expect } from '@playwright/test';
import { ALL_ROLES } from '../lib/roles';
import { contextAsRole } from '../lib/session';

// Sentinel nav items proving the right nav matrix is loaded for each role.
const ROLE_SENTINEL: Record<string, RegExp> = {
  SUPER_ADMIN:      /Tenancy & Config|User Management/,
  ADMIN:            /Employees|Leave|Claims/,
  IT_ADMIN:         /User Management|Role & Permissions/,
  HR_ADMIN:         /Recruitment|Performance|Payroll/,
  HR_MANAGER:       /Recruitment|Performance|Leave/,
  PAYROLL_OFFICER:  /Payroll/,
  FINANCE_ADMIN:    /Claims|Payroll/,
  LINE_MANAGER:     /Team Leave|Team Claims|Shift Scheduler/,
  RECRUITER:        /Recruitment/,
  TRAINING_MANAGER: /Training/,
  EMPLOYEE:         /My Leave|My Claims|My Attendance/,
};

for (const role of ALL_ROLES) {
  test(`smoke: ${role} can load dashboard`, async ({ browser }) => {
    const ctx = await contextAsRole(browser, role);
    const page = await ctx.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    const resp = await page.goto('/', { waitUntil: 'networkidle' });
    expect(resp?.status(), `dashboard HTTP status for ${role}`).toBe(200);
    await page.waitForTimeout(800);

    const sidebar = await page.locator('aside').first().textContent();
    expect(sidebar ?? '', `${role} sidebar should contain expected nav items`).toMatch(ROLE_SENTINEL[role]);
    expect(pageErrors, `${role} should have no page errors`).toEqual([]);

    await ctx.close();
  });
}
