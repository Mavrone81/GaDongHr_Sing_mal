'use strict';

/**
 * A5c — regression test for the compound-unique bug family on DrcQuota.
 *
 * Schema: `@@unique([tenantId, sector, passType])` (prisma/schema.prisma:313
 * — "Was [sector, passType] — same missing-tenant defect as PayrollRun had").
 * 🔴 Different shape from the other three A5c sites: this isn't a single
 * field becoming a two-field compound key, it's a STALE PRE-MIGRATION
 * COMPOUND-KEY NAME. component.routes.js:240 still references the old
 * `sector_passType` selector, which no longer exists at all — the only valid
 * compound selector is now `tenantId_sector_passType`. Same
 * PrismaClientValidationError outcome, different root cause; do not
 * pattern-match the fix to the other three (DevLead, 2026-10-02).
 *
 * Route: POST /components/drc-quotas/seed. No $transaction; the route's
 * generic `catch (err) { next(err); }` surfaces a real 500 on the first of
 * the 10 MOM_DEFAULTS upserts.
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked) — the
 * mocked-Prisma unit suite answers any `where` shape and cannot catch this.
 *
 * Mutation proof (run once a DB is available):
 *   1. Revert the `tenantId_sector_passType` edit in component.routes.js (or
 *      check out baseline/gadong-main-9113e8c for this file).
 *   2. Run this file — expect 500 with a Prisma validation message naming
 *      `tenantId_sector_passType` as the only valid option — "fails for the
 *      right reason."
 *   3. Restore the fix. Run again — expect the statuses/bodies below.
 *   4. Paste both runs into the PR/handoff.
 */

let mockUser = { sub: 'admin-001', role: 'SUPER_ADMIN', tenantId: null };
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
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({ on: jest.fn(), pipe: jest.fn() }),
  existsSync: jest.fn().mockReturnValue(true),
}));
jest.mock('pdfkit', () => {
  const { EventEmitter } = require('events');
  return jest.fn().mockImplementation(() => {
    const ee = new EventEmitter();
    ee.font = () => ee; ee.fontSize = () => ee; ee.text = () => ee;
    ee.moveDown = () => ee; ee.lineTo = () => ee; ee.stroke = () => ee;
    ee.moveTo = () => ee; ee.pipe = () => {}; ee.end = () => ee.emit('end');
    return ee;
  });
});

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/index');

const raw = new PrismaClient();
// A fresh, never-seeded tenant — the route short-circuits ("already seeded")
// once count({isActive:true}) > 0 for the CALLING tenant, so this must start
// at zero to actually reach the buggy upsert.
const TENANT_C = 'cccccccc-0000-0000-0000-00000000005c';

beforeAll(async () => {
  await raw.drcQuota.deleteMany({ where: { tenantId: TENANT_C } });
});

// Authoring bug found while verifying this file (same class Architect hit in
// A5b): the module-level `mockUser` starts with tenantId: null, and only
// afterEach reset it to TENANT_C — so the FIRST test in the file ran under
// tc.DEFAULT_TENANT_ID instead, seeding 10 rows under the wrong tenant and
// then short-circuiting ("already seeded") on every subsequent run. beforeEach
// (not just afterEach) is required so every test starts correctly scoped.
beforeEach(() => {
  setUser({ sub: 'admin-001', role: 'SUPER_ADMIN', tenantId: TENANT_C });
});

afterEach(async () => {
  jest.clearAllMocks();
  await raw.drcQuota.deleteMany({ where: { tenantId: TENANT_C } });
});

afterAll(async () => {
  await raw.drcQuota.deleteMany({ where: { tenantId: TENANT_C } });
  await raw.$disconnect();
});

describe('DrcQuota tenant-scoped upsert (A5c #4 — component.routes.js:240)', () => {
  test('seeds all 10 MOM defaults scoped to the caller tenant (was: where:{sector_passType}, a stale pre-migration key name)', async () => {
    const res = await request(app).post('/components/drc-quotas/seed').send({});

    expect(res.status).toBe(201);
    expect(res.body.seeded).toBe(10);

    const row = await raw.drcQuota.findUnique({
      where: { tenantId_sector_passType: { tenantId: TENANT_C, sector: 'CONSTRUCTION', passType: 'WP' } },
    });
    expect(row).not.toBeNull();
    expect(row.tenantId).toBe(TENANT_C);
    expect(row.maxRatioPct).toBe(83.0);
  });

  test('force=true re-seed updates the existing tenant-scoped rows (upsert update path, same key)', async () => {
    // Seeded directly via the raw client, deliberately NOT through the HTTP
    // route — this test is about the force=true UPDATE path specifically, and
    // must stay red/green on its own merits, not on whether test 1's
    // create-from-scratch path happens to work yet.
    const { MOM_DEFAULTS } = require('../src/engines/drc.engine');
    await raw.drcQuota.createMany({
      data: MOM_DEFAULTS.map(d => ({ id: require('crypto').randomUUID(), tenantId: TENANT_C, ...d, isActive: true })),
    });
    await raw.drcQuota.update({
      where: { tenantId_sector_passType: { tenantId: TENANT_C, sector: 'SERVICES', passType: 'WP' } },
      data: { maxRatioPct: 1.0 },
    });

    const res = await request(app).post('/components/drc-quotas/seed?force=true').send({});
    expect(res.status).toBe(201);
    expect(res.body.seeded).toBe(10);

    const row = await raw.drcQuota.findUnique({
      where: { tenantId_sector_passType: { tenantId: TENANT_C, sector: 'SERVICES', passType: 'WP' } },
    });
    expect(row.maxRatioPct).toBe(15.0); // restored to the MOM default, not left at 1.0

    const count = await raw.drcQuota.count({ where: { tenantId: TENANT_C } });
    expect(count).toBe(10); // still 10 rows — update, not duplicate creation
  });
});
