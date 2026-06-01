/**
 * T3 X-04 — Gateway global rate limit (200 req/min per IP).
 *
 * Isolated to its own spec file because triggering the limit consumes the
 * minute-window's budget for the test runner's source IP, which can 429 any
 * sibling test that issues HTTP calls inside the same window.
 *
 * Contract under test: api-gateway/src/index.js:82-86 — globalLimiter with
 * windowMs=60s, max=200.
 */

import { test, expect, request } from '@playwright/test';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

test('X-04 gateway returns 429 once the per-minute budget is exhausted', async () => {
  test.setTimeout(180_000);
  // The gateway honours GATEWAY_RATELIMIT_MAX (default 200). In CI we
  // typically run with a relaxed cap (e.g. 5000) so the rest of the T3 suite
  // can complete inside a single minute window. When the cap is set so high
  // that we'd need to burst > 6000 requests to trigger the limit, the
  // assertion stops being meaningful — skip and mark the test as informational.
  const configuredMax = Number.parseInt(process.env.GATEWAY_RATELIMIT_MAX_TEST_OVERRIDE || '200', 10);
  if (configuredMax > 1000) {
    test.skip(true, `GATEWAY_RATELIMIT_MAX_TEST_OVERRIDE=${configuredMax} — skipping X-04 to avoid bursting > 1000 requests.`);
  }
  const ramp = configuredMax + 50;

  const ctx = await request.newContext({ baseURL: API_BASE });
  let sawLimit = false;
  let firstLimitedAt = -1;
  for (let i = 0; i < ramp; i++) {
    const r = await ctx.get('/health');
    if (r.status() === 429) {
      sawLimit = true;
      firstLimitedAt = i;
      break;
    }
  }
  await ctx.dispose();

  expect(sawLimit, `should have observed a 429 within ${ramp} sustained requests`).toBe(true);
  expect(firstLimitedAt).toBeGreaterThan(0);
  expect(firstLimitedAt).toBeLessThan(ramp);
});
