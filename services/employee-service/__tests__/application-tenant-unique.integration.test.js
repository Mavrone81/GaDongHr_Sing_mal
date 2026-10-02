'use strict';

/**
 * A5b — regression test for the compound-unique bug family on EmployeeApplication.
 * Covers BOTH sites DevLead confirmed on this model (schema:
 * `@@unique([tenantId, userId])`, prisma/schema.prisma:270):
 *
 *   #12 — POST /employees/apply (~:1151, re-submit path). This route has NO
 *   `authenticate` middleware — it is public, gated only by a signed invite token
 *   (see the route's own header comment) — so there is no request-scoped tenantId
 *   to build a `tenantId_userId` selector from. Fixed by keying the update on
 *   `existing.id` (the row's own primary key, fetched by the `findFirst`
 *   immediately above it) instead — always a valid, unambiguous selector
 *   regardless of tenant context.
 *
 *   #13 — POST /applications/prefill (~:380, HR fill-on-behalf). Found by DevLead
 *   sweeping the whole bug class after #12 landed: same model, same bare-`{userId}`
 *   mistake, but THIS route DOES have `authenticate` (+ authorize), so the proper
 *   compound fix applies: `{ tenantId_userId: { tenantId: getTenantId(), userId } }`.
 *
 * Both built their `where` from `userId` alone, which is not a valid Prisma unique
 * selector once the index is `[tenantId, userId]` — both threw
 * `PrismaClientValidationError` on every re-submission/re-prefill, before any SQL ran.
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked).
 *
 * Mutation proof (run once a DB is available): revert the relevant `where` edit in
 * employee.routes.js, run this file (expect the second call in that describe block
 * to return 500 / Prisma validation message), restore the fix, run again (expect
 * 201/200 both times, one row) — paste both runs, per site.
 */

let mockUser = { sub: 'hr-admin-001', role: 'HR_ADMIN', tenantId: null };
const setUser = (u) => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  // #12's route (/employees/apply) never calls `authenticate`, so this mock has
  // no effect there — it only matters for #13's /applications/prefill.
  authenticate: (req, _res, next) => {
    req.user = mockUser;
    const tc = require('/app/shared/tenant-context');
    tc.setTenant(mockUser.tenantId || tc.DEFAULT_TENANT_ID);
    next();
  },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role || (req.user?.permissions || []).includes(a));
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  authorizeSelfOrRole: () => (req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN' },
}), { virtual: true });

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/index');

const raw = new PrismaClient();
const USER_ID = 'aaaaaaaa-1111-0000-0000-0000000000aa';
const EMAIL = 'a5b-apply-test@example.local';
const INVITE_TOKEN = 'a5b-test-invite-token';

global.fetch = jest.fn(async (url, opts) => {
  const u = String(url);
  if (u.includes('/users/invite/derive-key')) {
    return { ok: true, json: async () => ({ rawToken: 'unused-in-this-test' }) };
  }
  if (u.includes(`/users/invite/${INVITE_TOKEN}`)) {
    return { ok: true, json: async () => ({ id: USER_ID, email: EMAIL }) };
  }
  if (u.includes('/users/consume-invite')) {
    return { ok: true, json: async () => ({ ok: true }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
});

const USER_ID_PREFILL = 'bbbbbbbb-2222-0000-0000-0000000000bb';
const TENANT_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';

afterEach(() => { global.fetch.mockClear(); setUser({ sub: 'hr-admin-001', role: 'HR_ADMIN', tenantId: TENANT_A }); });

beforeAll(async () => {
  await raw.employeeApplication.deleteMany({ where: { userId: { in: [USER_ID, USER_ID_PREFILL] } } });
});

afterAll(async () => {
  await raw.employeeApplication.deleteMany({ where: { userId: { in: [USER_ID, USER_ID_PREFILL] } } });
  await raw.$disconnect();
});

describe('EmployeeApplication update-by-id on a public, unauthenticated route (A5b #12)', () => {
  test('first submission creates the application (create path, unaffected by this bug)', async () => {
    const res = await request(app).post('/employees/apply').send({
      inviteToken: INVITE_TOKEN,
      fullName: 'A5B Test Applicant',
      department: 'Eng',
    });
    expect(res.status).toBe(201);
    expect(res.body.applicationId).toBeTruthy();

    const row = await raw.employeeApplication.findFirst({ where: { userId: USER_ID } });
    expect(row).not.toBeNull();
    expect(row.fullName).toBe('A5B Test Applicant');
  });

  test('re-submission UPDATES the existing row by id (was: where:{userId})', async () => {
    const res = await request(app).post('/employees/apply').send({
      inviteToken: INVITE_TOKEN,
      fullName: 'A5B Test Applicant (amended)',
      department: 'Eng',
      bankName: 'Test Bank',
    });
    expect(res.status).toBe(201);

    const rows = await raw.employeeApplication.findMany({ where: { userId: USER_ID } });
    expect(rows.length).toBe(1); // updated in place, not duplicated
    expect(rows[0].fullName).toBe('A5B Test Applicant (amended)');
    expect(rows[0].bankName).toBe('Test Bank');
  });
});

describe('EmployeeApplication tenant-scoped update on an authenticated route (A5b #13)', () => {
  test('HR prefill creates the application (create path, unaffected by this bug)', async () => {
    setUser({ tenantId: TENANT_A });
    const res = await request(app).post('/employees/applications/prefill').send({
      userId: USER_ID_PREFILL, email: 'prefill-test@example.local', fullName: 'Prefilled Applicant',
    });
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(USER_ID_PREFILL);

    const row = await raw.employeeApplication.findUnique({ where: { tenantId_userId: { tenantId: TENANT_A, userId: USER_ID_PREFILL } } });
    expect(row).not.toBeNull();
  });

  test('re-prefill UPDATES the tenant-scoped row (was: where:{userId})', async () => {
    setUser({ tenantId: TENANT_A });
    const res = await request(app).post('/employees/applications/prefill').send({
      userId: USER_ID_PREFILL, email: 'prefill-test@example.local', fullName: 'Prefilled Applicant',
      department: 'Finance',
    });
    expect(res.status).toBe(200);
    expect(res.body.department).toBe('Finance');

    const rows = await raw.employeeApplication.findMany({ where: { userId: USER_ID_PREFILL } });
    expect(rows.length).toBe(1); // updated in place, not duplicated
    expect(rows[0].department).toBe('Finance');
  });
});
