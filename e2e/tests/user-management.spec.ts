/**
 * Regression: User Management list must render for SUPER_ADMIN.
 *
 * Guards against the C-12 fallout where the page read the access token via
 * `document.cookie` and sent `Authorization: Bearer <token>` by hand. After
 * C-12 the `gadonghr_token` cookie is HttpOnly, so `document.cookie` returns
 * undefined, every /users request went out as `Bearer undefined` with no
 * credentials, the gateway rejected it 401, and the table showed
 * "No users found" even though the page itself rendered (SUPER_ADMIN passes
 * the client-side permission gate unconditionally).
 *
 * IMPORTANT: this spec sets the auth cookie with `httpOnly: true` to mirror
 * production. The shared `contextAsRole` fixture sets `httpOnly: false`, which
 * masked this bug — `document.cookie` could still read the token in tests even
 * though it cannot in a real browser. The fix routes the page through the
 * shared `apiFetch` helper (credentials:'include'), so the browser attaches the
 * HttpOnly cookie and the gateway translates it to a Bearer header downstream.
 */

import { test, expect } from '@playwright/test';
import { signJwt } from '../lib/jwt';
import { TEST_USERS } from '../lib/testUsers';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const BASE_HOST = new URL(BASE_URL).hostname;

test('SUPER_ADMIN sees the user list with an HttpOnly auth cookie (C-12 regression)', async ({ browser }) => {
  const user = TEST_USERS.SUPER_ADMIN;
  test.skip(user.id === 'PLACEHOLDER', 'SUPER_ADMIN test user not seeded; run `npm run seed-test-users`.');

  const token = signJwt(user, 'SUPER_ADMIN');
  const context = await browser.newContext();
  // Mirror production: the real /auth/login sets this cookie HttpOnly.
  await context.addCookies([{
    name: 'gadonghr_token',
    value: token,
    domain: BASE_HOST,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }]);

  const page = await context.newPage();

  // Local-dev shim: when the frontend bundle targets a different origin than
  // :3000 (cross-origin gateway), auth-service's bare `cors()` emits
  // `Access-Control-Allow-Origin: *`, which browsers reject under
  // credentials:'include'. Production serves the app and /api from the SAME
  // origin (app.bevorasg.com), so CORS never applies there. Normalising the
  // header here makes the credentialed flow behave exactly as it does in prod.
  // No-op when the response origin is already a concrete value.
  await page.route('**/api/**', async route => {
    let resp;
    try { resp = await route.fetch(); } catch { return route.continue(); }
    await route.fulfill({
      response: resp,
      headers: {
        ...resp.headers(),
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
      },
    });
  });

  await page.goto('/settings/users', { waitUntil: 'domcontentloaded' });

  // Header advertises a non-zero identity count ("N identities registered").
  const header = page.locator('text=/identities registered/');
  await expect(header).toBeVisible({ timeout: 15_000 });
  const headerText = (await header.textContent()) ?? '';
  const count = Number(headerText.match(/(\d+)\s+identities/)?.[1] ?? '0');
  expect(count, 'identity count should be > 0').toBeGreaterThan(0);

  // The empty-state row must NOT be present, and at least one data row must be.
  await expect(page.locator('text=No users found')).toHaveCount(0);
  await expect(page.locator('text=Adjust Clearances').first()).toBeVisible();

  await context.close();
});
