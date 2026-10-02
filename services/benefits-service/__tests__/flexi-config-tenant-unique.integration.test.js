'use strict';

/**
 * A5b — regression test for the compound-unique bug family on FlexiWalletConfig.
 *
 * Schema: `@@unique([tenantId, grade])` (prisma/schema.prisma:218). PUT
 * /benefits/flexi-config (../src/index.js ~:811) built its `where` from `grade`
 * alone — not a valid Prisma unique selector once the index is `[tenantId, grade]`
 * — so it threw `PrismaClientValidationError` on every call, before any SQL ran.
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked).
 *
 * Mutation proof (run once a DB is available): revert the one-line `where` edit in
 * ../src/index.js, run this file (expect 500 / Prisma validation message), restore
 * the fix, run again (expect 200 both times below) — paste both runs.
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
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', FINANCE_ADMIN: 'FINANCE_ADMIN',
  },
}), { virtual: true });

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/index');

const raw = new PrismaClient();
const TENANT_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const GRADE = 'ZZTEST'; // won't collide with real grade codes

afterEach(() => { jest.clearAllMocks(); setUser({ sub: 'admin-001', role: 'HR_ADMIN', tenantId: TENANT_A }); });

beforeAll(async () => {
  await raw.flexiWalletConfig.deleteMany({ where: { grade: GRADE } });
});

afterAll(async () => {
  await raw.flexiWalletConfig.deleteMany({ where: { grade: GRADE } });
  await raw.$disconnect();
});

describe('FlexiWalletConfig tenant-scoped upsert (A5b #8, was: where:{grade})', () => {
  test('creates a per-tenant config on first call', async () => {
    setUser({ tenantId: TENANT_A });
    const res = await request(app).put('/benefits/flexi-config').send({ grade: GRADE, annualAmount: 500 });
    expect(res.status).toBe(200);
    expect(res.body.grade).toBe(GRADE);

    const row = await raw.flexiWalletConfig.findUnique({ where: { tenantId_grade: { tenantId: TENANT_A, grade: GRADE } } });
    expect(row).not.toBeNull();
    expect(row.annualAmount).toBe(500);
  });

  test('a second tenant can hold its own config for the same grade without colliding', async () => {
    setUser({ tenantId: TENANT_B });
    const res = await request(app).put('/benefits/flexi-config').send({ grade: GRADE, annualAmount: 777 });
    expect(res.status).toBe(200);

    const rowA = await raw.flexiWalletConfig.findUnique({ where: { tenantId_grade: { tenantId: TENANT_A, grade: GRADE } } });
    const rowB = await raw.flexiWalletConfig.findUnique({ where: { tenantId_grade: { tenantId: TENANT_B, grade: GRADE } } });
    expect(rowA.annualAmount).toBe(500);
    expect(rowB.annualAmount).toBe(777);
  });

  test('updating tenant A again updates (not duplicates) tenant A\'s row', async () => {
    setUser({ tenantId: TENANT_A });
    const res = await request(app).put('/benefits/flexi-config').send({ grade: GRADE, annualAmount: 999 });
    expect(res.status).toBe(200);
    const rows = await raw.flexiWalletConfig.findMany({ where: { grade: GRADE } });
    expect(rows.length).toBe(2); // still exactly one per tenant, not three
    expect(rows.find(r => r.tenantId === TENANT_A).annualAmount).toBe(999);
  });
});
