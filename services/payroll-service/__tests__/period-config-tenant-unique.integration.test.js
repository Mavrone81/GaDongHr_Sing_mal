'use strict';

/**
 * A5c — regression test for the compound-unique bug family on
 * PayrollPeriodConfig.
 *
 * Schema: `@@unique([tenantId, period])` (prisma/schema.prisma:352). The
 * route builds its upsert `where` from `period` alone — not a valid Prisma
 * unique selector once the index is `[tenantId, period]` — and throws
 * `PrismaClientValidationError` on every call:
 *   - PUT /payroll/period-config/:period (payroll.routes.js:1793)
 *
 * Unlike the PayrollJournal sites (A5c #1/#2), this one is NOT wrapped in its
 * own try/catch — the route's generic `catch (err) { next(err); }` surfaces
 * it as a real 500. No $transaction involved either.
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked) — the
 * mocked-Prisma unit suite answers any `where` shape and cannot catch this
 * (Architect, A5a).
 *
 * Mutation proof (run once a DB is available):
 *   1. Revert the `tenantId_period` edit in payroll.routes.js (or check out
 *      baseline/gadong-main-9113e8c for this file).
 *   2. Run this file — expect 500 with a Prisma validation message
 *      ("needs at least one of ... tenantId_period") — that is "fails for
 *      the right reason."
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
const TENANT_A = 'aaaaaaaa-0000-0000-0000-00000000005c';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-00000000005c';
const PERIOD = '2099-06'; // far-future, won't collide with other tests/seed data

beforeAll(async () => {
  await raw.payrollPeriodConfig.deleteMany({ where: { period: PERIOD } });
});

afterEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', role: 'SUPER_ADMIN', tenantId: TENANT_A });
});

afterAll(async () => {
  await raw.payrollPeriodConfig.deleteMany({ where: { period: PERIOD } });
  await raw.$disconnect();
});

describe('PayrollPeriodConfig tenant-scoped upsert (A5c #3 — payroll.routes.js:1793)', () => {
  test('creates a config row scoped to the caller tenant (upsert create, was: where:{period})', async () => {
    setUser({ tenantId: TENANT_A });
    const res = await request(app)
      .put(`/payroll/period-config/${PERIOD}`)
      .send({ workDayType: 'FIVE_DAY', workingDays: 21, notes: 'A5c fixture' });

    expect(res.status).toBe(200);
    expect(res.body.period).toBe(PERIOD);
    expect(res.body.workingDays).toBe(21);

    const row = await raw.payrollPeriodConfig.findUnique({
      where: { tenantId_period: { tenantId: TENANT_A, period: PERIOD } },
    });
    expect(row).not.toBeNull();
    expect(row.tenantId).toBe(TENANT_A);
  });

  test('a second PUT updates the SAME tenant-scoped row rather than colliding or creating a duplicate (upsert update, was: where:{period})', async () => {
    setUser({ tenantId: TENANT_A });
    await request(app).put(`/payroll/period-config/${PERIOD}`).send({ workDayType: 'FIVE_DAY', workingDays: 21 });
    const res = await request(app).put(`/payroll/period-config/${PERIOD}`).send({ workDayType: 'SIX_DAY', workingDays: 25 });

    expect(res.status).toBe(200);
    expect(res.body.workDayType).toBe('SIX_DAY');
    expect(res.body.workingDays).toBe(25);

    const rows = await raw.payrollPeriodConfig.findMany({ where: { period: PERIOD, tenantId: TENANT_A } });
    expect(rows).toHaveLength(1);
  });

  test('a second tenant on the SAME period gets its own row, not a cross-tenant collision', async () => {
    setUser({ tenantId: TENANT_A });
    await request(app).put(`/payroll/period-config/${PERIOD}`).send({ workDayType: 'FIVE_DAY', workingDays: 21 });

    setUser({ tenantId: TENANT_B });
    const res = await request(app).put(`/payroll/period-config/${PERIOD}`).send({ workDayType: 'SIX_DAY', workingDays: 26 });
    expect(res.status).toBe(200);

    const rowA = await raw.payrollPeriodConfig.findUnique({ where: { tenantId_period: { tenantId: TENANT_A, period: PERIOD } } });
    const rowB = await raw.payrollPeriodConfig.findUnique({ where: { tenantId_period: { tenantId: TENANT_B, period: PERIOD } } });
    expect(rowA.workingDays).toBe(21);
    expect(rowB.workingDays).toBe(26);

    await raw.payrollPeriodConfig.deleteMany({ where: { period: PERIOD, tenantId: TENANT_B } });
  });
});
