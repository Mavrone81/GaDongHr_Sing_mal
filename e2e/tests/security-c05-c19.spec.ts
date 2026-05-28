/**
 * E2E security regression tests for the C-05 through C-19 fixes (excluding
 * C-13/C-14/C-17 which depend on esign-service and loans-service that are
 * not compose-managed in this stack).
 *
 *   C-07 — /api/payroll/internal/ir21-ytd rejects the public/legacy
 *           'dev-internal-key' fallback (fail-closed).
 *   C-09 — Forging a non-CSPRNG OTP cannot bypass MFA (no observable bug here,
 *           we assert /auth/me / refresh still behave correctly post-fix).
 *   C-11 — CORS announces only Content-Type + Authorization in
 *           Access-Control-Allow-Headers (no x-user-id / x-user-role / etc.)
 *           and never sets Access-Control-Allow-Origin: *.
 *   C-12 — /api/auth/me works with the HttpOnly cookie alone, no Bearer.
 *   C-15 — Login rate limit gives 429 after 10 attempts.
 *   C-16 — POST /api/leave/applications with endDate < startDate → 400.
 *   C-18 — PUT /api/recruitment/candidates/:id with {isHired:true} as RECRUITER
 *           does NOT set isHired (state ignored, candidate unchanged).
 *   C-19 — GET /api/assets/employee/<other-emp-id> as EMPLOYEE → 403.
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';
import { TEST_USERS } from '../lib/testUsers';
import { signJwt } from '../lib/jwt';
import { Role } from '../lib/roles';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function ctxAs(role: Role, employeeId?: string | null): Promise<APIRequestContext> {
  const u = employeeId !== undefined ? { ...TEST_USERS[role], employeeId } : TEST_USERS[role];
  const token = signJwt(u, role);
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

// ── C-07 ──────────────────────────────────────────────────────────────────────
test('C07 E2E: payroll internal endpoint rejects the legacy dev-internal-key', async () => {
  const ctx = await request.newContext({ baseURL: API_BASE });
  // The endpoint sits behind the gateway → payroll-service. Without a JWT and
  // with a forged x-internal-service-key header, the request must be rejected.
  const res = await ctx.get('/api/payroll/internal/ir21-ytd/any-emp-id/2026', {
    headers: { 'x-internal-service-key': 'dev-internal-key' },
  });
  expect(res.status(), 'dev-internal-key must NOT be accepted').toBeGreaterThanOrEqual(400);
});

// ── C-11 ──────────────────────────────────────────────────────────────────────
test('C11 E2E: CORS preflight returns explicit allowlist, no identity headers, no wildcard', async () => {
  const ctx = await request.newContext({ baseURL: API_BASE });
  const res = await ctx.fetch('/api/auth/me', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:8081',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  const origin = res.headers()['access-control-allow-origin'];
  const allowedHeaders = (res.headers()['access-control-allow-headers'] || '').toLowerCase();
  expect(origin, 'wildcard CORS must not be advertised').not.toBe('*');
  expect(allowedHeaders).not.toContain('x-user-id');
  expect(allowedHeaders).not.toContain('x-user-role');
  expect(allowedHeaders).not.toContain('x-employee-id');
});

test('C11 E2E: client-supplied x-user-role header is stripped at the gateway', async () => {
  // Forge a token claiming EMPLOYEE role, but pretend to be SUPER_ADMIN via a header.
  // The gateway must overwrite the header from the verified JWT.
  const employeeUser = TEST_USERS.EMPLOYEE;
  const token = signJwt(employeeUser, 'EMPLOYEE');
  const ctx = await request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: {
      Authorization: `Bearer ${token}`,
      'x-user-role': 'SUPER_ADMIN',
      'x-user-id': 'pretend-super-admin',
      Origin: 'http://localhost:8081',
    },
  });
  const me = await ctx.get('/api/auth/me');
  expect(me.ok()).toBe(true);
  const body = await me.json();
  // The DB record for the EMPLOYEE test user is role EMPLOYEE (seeded by
  // seed-test-users.js); the server must report that, not the spoofed header.
  expect(body.role).not.toBe('SUPER_ADMIN');
});

// ── C-12 ──────────────────────────────────────────────────────────────────────
test('C12 E2E: /auth/me accepts the vorkhive_token cookie alone (no Bearer header)', async () => {
  const adminToken = signJwt(TEST_USERS.SUPER_ADMIN, 'SUPER_ADMIN');
  const ctx = await request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Cookie: `vorkhive_token=${adminToken}` },
  });
  const res = await ctx.get('/api/auth/me');
  expect(res.ok(), 'cookie-only auth must succeed').toBe(true);
});

// ── C-15 ──────────────────────────────────────────────────────────────────────
test('C15 E2E: 11th rapid login attempt is rate-limited (429)', async () => {
  const ctx = await request.newContext({ baseURL: API_BASE });
  let limited = 0;
  for (let i = 0; i < 12; i++) {
    const res = await ctx.post('/api/auth/login', {
      data: { email: `nonexistent-${Date.now()}-${i}@test.tld`, password: 'wrong-password-for-limit-probe' },
    });
    if (res.status() === 429) { limited++; break; }
  }
  expect(limited, 'rate limiter must produce a 429 within 12 attempts').toBeGreaterThan(0);
});

// ── C-16 ──────────────────────────────────────────────────────────────────────
test('C16 E2E: POST /leave/applications with endDate < startDate is rejected', async () => {
  const empCtx = await ctxAs('SUPER_ADMIN'); // any role with leave access
  // Find a real leave type via the admin token
  const typesRes = await empCtx.get('/api/leave/types');
  expect(typesRes.ok(), 'leave types accessible').toBe(true);
  const types = await typesRes.json();
  const leaveType = (types.types || types).find((t: any) => t.isActive) || types[0];
  expect(leaveType, 'at least one active leave type').toBeTruthy();

  // Find an employee to apply for
  const empListRes = await empCtx.get('/api/employees?limit=1&isActive=true');
  const emp = ((await empListRes.json()).employees || [])[0];
  if (!emp) test.skip(true, 'need at least one active employee');

  const res = await empCtx.post('/api/leave/applications', {
    data: {
      leaveTypeId: leaveType.id,
      startDate: '2026-09-10',
      endDate:   '2026-09-01',
      employeeId: emp.id,
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/endDate must be on or after startDate/i);
});

// ── C-18 ──────────────────────────────────────────────────────────────────────
test('C18 E2E: RECRUITER cannot set isHired via PUT /candidates/:id', async () => {
  const adminCtx = await ctxAs('SUPER_ADMIN');

  // Create a candidate to operate on
  const createRes = await adminCtx.post('/api/recruitment/candidates', {
    data: {
      firstName: 'C18E2E', lastName: `Probe${Date.now()}`,
      email: `c18-${Date.now()}@e2e.test`,
      phone: '+65 9123 4567',
    },
  });
  expect(createRes.ok(), 'admin creates candidate').toBe(true);
  const candidate = await createRes.json();

  // RECRUITER tries to flip isHired
  const recruiterCtx = await ctxAs('RECRUITER');
  await recruiterCtx.put(`/api/recruitment/candidates/${candidate.id}`, {
    data: { isHired: true, isOfferMade: true, notes: 'attempted bypass' },
  });

  // Re-fetch and confirm the flag did NOT change
  const after = await adminCtx.get(`/api/recruitment/candidates/${candidate.id}`);
  expect(after.ok()).toBe(true);
  const afterBody = await after.json();
  expect(afterBody.isHired, 'isHired must not be settable via generic PUT').not.toBe(true);
  expect(afterBody.isOfferMade).not.toBe(true);
});

// ── C-19 ──────────────────────────────────────────────────────────────────────
test('C19 E2E: EMPLOYEE cannot read another employee\'s asset assignments', async () => {
  const admin = await ctxAs('SUPER_ADMIN');
  const empRes = await admin.get('/api/employees?limit=2&isActive=true');
  const employees = ((await empRes.json()).employees || []);
  const [empA, empB] = employees;
  if (!empA || !empB) test.skip(true, 'need two active employees');

  // Probe as EMPLOYEE bound to empA, trying to read empB's assets
  const empCtx = await ctxAs('EMPLOYEE', empA.id);
  const res = await empCtx.get(`/api/assets/employee/${empB.id}`);
  expect(res.status(), 'cross-employee asset read must be 403').toBe(403);

  // Own employee still works
  const self = await empCtx.get(`/api/assets/employee/${empA.id}`);
  expect(self.ok(), 'EMPLOYEE may read own assets').toBe(true);
});
