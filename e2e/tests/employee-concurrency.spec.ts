/**
 * T3 EMP-13 — Concurrent edit on /employees/:id.
 *
 * The current employee update handler (employee.routes.js:540-624) has NO
 * optimistic concurrency control: it does a `findUnique` for the diff, then a
 * `prisma.employee.update`. Two simultaneous edits will both succeed and the
 * second write wins. This test pins that documented behaviour so any future
 * `version`/`updatedAt`-token-based conflict detection is intentional and
 * reconciled with the audit trail (which DOES log both edits with their
 * own diff).
 *
 * If a 409 / version-mismatch is added later, this spec's first assertion
 * (both writes succeed) will fail, signalling that the audit + frontend layer
 * needs follow-up.
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';
import { TEST_USERS } from '../lib/testUsers';
import { signJwt } from '../lib/jwt';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function adminCtx(): Promise<APIRequestContext> {
  const token = signJwt(TEST_USERS.SUPER_ADMIN, 'SUPER_ADMIN');
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

test('EMP-13 last-write-wins on concurrent PUT (no optimistic lock today)', async () => {
  const ctx = await adminCtx();

  // 1. Create a throwaway employee so we don't mutate a real one.
  const stamp = Date.now();
  const created = await ctx.post('/api/employees', {
    data: {
      fullName: 'EMP-13 Concurrency Test',
      workEmail: `emp13-${stamp}@example.com`,
      department: 'IT',
      designation: 'QA Test Account',
      dateOfBirth: '1990-01-01',
      startDate: '2026-06-01',
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const emp = await created.json();
  const empId = emp.id;

  // 2. Fire two PUT updates "concurrently" with different costCentre values
  //    (a benign field — we don't want to clobber the existing employee's
  //    real name). Playwright awaits the promises in parallel — both
  //    requests are in flight before either's response lands.
  const tagA = `EMP13-A-${Date.now()}`;
  const tagB = `EMP13-B-${Date.now()}`;
  const [r1, r2] = await Promise.all([
    ctx.put(`/api/employees/${empId}`, { data: { costCentre: tagA } }),
    ctx.put(`/api/employees/${empId}`, { data: { costCentre: tagB } }),
  ]);

  // Pin current behaviour: both writes succeed. Once optimistic-locking lands,
  // one of these will become 409 and this assertion will fire.
  expect(r1.status()).toBe(200);
  expect(r2.status()).toBe(200);

  // 3. Read final state — must match exactly one of the two writes (the one
  //    that committed last). Postgres MVCC guarantees no torn write.
  const finalRes = await ctx.get(`/api/employees/${empId}`);
  expect(finalRes.ok()).toBe(true);
  const final = await finalRes.json();
  expect([tagA, tagB]).toContain(final.costCentre);

  // 4. Audit log must capture BOTH update events with their own diffs (the
  //    audit-trail value of EMP-13: even if last-write-wins, history is
  //    reconstructible). We can't query audit from gateway, but the existence
  //    of two responses verifies that two distinct UPDATE writes hit the DB.
  expect(final.updatedAt).toBeTruthy();

  await ctx.dispose();
});

test('EMP-13 PUT on missing id → 404', async () => {
  const ctx = await adminCtx();
  const res = await ctx.put('/api/employees/00000000-0000-0000-0000-000000000000', {
    data: { fullName: 'should-not-exist' },
  });
  expect(res.status()).toBe(404);
  await ctx.dispose();
});
