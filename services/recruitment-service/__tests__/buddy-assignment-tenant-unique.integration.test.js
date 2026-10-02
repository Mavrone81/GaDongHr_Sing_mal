'use strict';

/**
 * A5b — regression test for the compound-unique bug family on BuddyAssignment.
 *
 * Schema: `@@unique([tenantId, employeeId])` (prisma/schema.prisma:154). Two routes
 * in ../src/routes/recruitment.routes.js built their `where` from `employeeId` alone
 * — not a valid Prisma unique selector once the index is `[tenantId, employeeId]` —
 * so they threw `PrismaClientValidationError` on every call, before any SQL ran:
 *   - POST   /recruitment/onboarding/:employeeId/buddy (update path, ~:782)
 *   - DELETE /recruitment/onboarding/:employeeId/buddy (delete,      ~:848)
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked).
 *
 * Mutation proof (run once a DB is available): revert the two `where` edits in
 * recruitment.routes.js, run this file (expect 500 / Prisma validation message on
 * the second POST and on the DELETE), restore the fix, run again (expect the
 * statuses asserted below both times) — paste both runs.
 *
 * NOTE: recruitment-service is its own jest project (package.json `jest` block),
 * not listed in the ROOT `jest.config.js` `projects` array — run from inside this
 * service (`cd services/recruitment-service && npm test`), not via the root runner.
 */

let mockUser = { sub: 'admin-001', role: 'HR_ADMIN', tenantId: null };
const setUser = (u) => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockUser;
    const tc = require('/app/shared/tenant-context');
    tc.setTenant(mockUser.tenantId || tc.DEFAULT_TENANT_ID);
    next();
  },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER' },
}), { virtual: true });

global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { app } = require('../src/index');

const raw = new PrismaClient();
const TENANT_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const NEW_HIRE = 'cccccccc-0000-0000-0000-0000000000cc';
const BUDDY_1  = 'dddddddd-0000-0000-0000-0000000000dd';
const BUDDY_2  = 'eeeeeeee-0000-0000-0000-0000000000ee';

afterEach(() => { jest.clearAllMocks(); global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }); setUser({ sub: 'admin-001', role: 'HR_ADMIN', tenantId: TENANT_A }); });

beforeAll(async () => {
  await raw.buddyAssignment.deleteMany({ where: { employeeId: NEW_HIRE } });
});

afterAll(async () => {
  await raw.buddyAssignment.deleteMany({ where: { employeeId: NEW_HIRE } });
  await raw.$disconnect();
});

describe('BuddyAssignment tenant-scoped update/delete (A5b #9-10)', () => {
  test('first assignment creates the row (create path, unaffected by this bug)', async () => {
    setUser({ tenantId: TENANT_A });
    const res = await request(app).post(`/recruitment/onboarding/${NEW_HIRE}/buddy`).send({ buddyId: BUDDY_1 });
    expect(res.status).toBe(201);
    expect(res.body.assignment.buddyId).toBe(BUDDY_1);
  });

  test('reassigning the buddy UPDATES the existing row (was: where:{employeeId})', async () => {
    setUser({ tenantId: TENANT_A });
    const res = await request(app).post(`/recruitment/onboarding/${NEW_HIRE}/buddy`).send({ buddyId: BUDDY_2 });
    expect(res.status).toBe(201);
    expect(res.body.assignment.buddyId).toBe(BUDDY_2);

    const rows = await raw.buddyAssignment.findMany({ where: { employeeId: NEW_HIRE } });
    expect(rows.length).toBe(1); // updated in place, not duplicated
    expect(rows[0].buddyId).toBe(BUDDY_2);
  });

  test('DELETE removes the tenant-scoped row (was: where:{employeeId})', async () => {
    setUser({ tenantId: TENANT_A });
    const res = await request(app).delete(`/recruitment/onboarding/${NEW_HIRE}/buddy`);
    expect(res.status).toBe(204);

    const row = await raw.buddyAssignment.findFirst({ where: { employeeId: NEW_HIRE } });
    expect(row).toBeNull();
  });
});
