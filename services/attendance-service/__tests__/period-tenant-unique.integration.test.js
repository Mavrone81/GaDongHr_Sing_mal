'use strict';

/**
 * A5b — regression test for the compound-unique bug family on AttendancePeriod.
 *
 * Schema: `@@unique([tenantId, period])` (prisma/schema.prisma:333). Three routes in
 * ../src/index.js build their `where` from `period` alone — not a valid Prisma unique
 * selector once the index is `[tenantId, period]` — and so throw
 * `PrismaClientValidationError` on every call, before any SQL runs:
 *   - POST /attendance/periods/:period/lock               (upsert, ~:898)
 *   - POST /attendance/periods/:period/unlock              (update, ~:924)
 *   - POST /attendance/periods/:period/approve-for-payroll (update, ~:943)
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked) — this is what
 * proves the fix against Prisma's actual WhereUniqueInput validation, which a mocked
 * PrismaClient (see period-routes.integration.test.js) cannot catch.
 *
 * Mutation proof (run once a DB is available):
 *   1. `git stash` just the three `where: { tenantId_period: ... }` edits in
 *      ../src/index.js (or check out baseline/gadong-main-9113e8c for this file).
 *   2. Run this file — expect all three routes to return 500 with a Prisma
 *      validation message (not a 200/201/409/etc.) — that is "fails for the right
 *      reason."
 *   3. Restore the fix. Run again — expect the statuses asserted below.
 *   4. Paste both runs into the PR/handoff.
 */

let mockUser = { sub: 'admin-001', role: 'SUPER_ADMIN', tenantId: null };
const setUser = (u) => { mockUser = { ...mockUser, ...u }; };

const tenantCtx = require('/app/shared/tenant-context');

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
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/index');

const raw = new PrismaClient();
const TENANT_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const PERIOD = '2031-01'; // far-future period, won't collide with other tests/seed data

afterEach(() => { jest.clearAllMocks(); setUser({ sub: 'admin-001', role: 'SUPER_ADMIN', tenantId: TENANT_A }); });

beforeAll(async () => {
  await raw.attendancePeriod.deleteMany({ where: { period: PERIOD } });
});

afterAll(async () => {
  await raw.attendancePeriod.deleteMany({ where: { period: PERIOD } });
  await raw.$disconnect();
});

describe('AttendancePeriod tenant-scoped upsert/update (A5b #1-3)', () => {
  test('lock creates the period row scoped to the caller tenant (upsert, was: where:{period})', async () => {
    setUser({ tenantId: TENANT_A });
    const res = await request(app).post(`/attendance/periods/${PERIOD}/lock`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('LOCKED');

    const row = await raw.attendancePeriod.findUnique({ where: { tenantId_period: { tenantId: TENANT_A, period: PERIOD } } });
    expect(row).not.toBeNull();
    expect(row.tenantId).toBe(TENANT_A);
  });

  test('unlock updates the same tenant-scoped row (update, was: where:{period})', async () => {
    setUser({ tenantId: TENANT_A });
    const res = await request(app).post(`/attendance/periods/${PERIOD}/unlock`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OPEN');
  });

  test('lock then approve-for-payroll reaches APPROVED_FOR_PAYROLL (update, was: where:{period})', async () => {
    setUser({ tenantId: TENANT_A });
    await request(app).post(`/attendance/periods/${PERIOD}/lock`).send({});
    const res = await request(app).post(`/attendance/periods/${PERIOD}/approve-for-payroll`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED_FOR_PAYROLL');
  });
});
