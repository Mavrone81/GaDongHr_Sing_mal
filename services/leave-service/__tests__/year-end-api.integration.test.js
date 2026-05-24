'use strict';
/**
 * Integration tests for LEA-007 carry-forward + expiry API.
 *
 * Endpoints:
 *   POST /leave/year-end/preview
 *   POST /leave/year-end/process
 *   POST /leave/year-end/expire
 *   GET  /leave/year-end/expiring
 *
 * Regression:
 *   - expiry sweep zeros carryForward and accumulates expiredDays in transaction
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Auth middleware is auto-stubbed via package.json moduleNameMapper →
// __mocks__/auth-middleware.js (default user: HR_ADMIN). No extra jest.mock
// needed unless we want a different role per test.

const mockLeaveTypeFindMany    = jest.fn();
const mockEntitlementFindMany  = jest.fn();
const mockEntitlementUpsert    = jest.fn();
const mockEntitlementUpdate    = jest.fn();
const mockTransaction          = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    leaveType: { findMany: mockLeaveTypeFindMany, findUnique: jest.fn() },
    leaveEntitlement: {
      findMany: mockEntitlementFindMany,
      upsert: mockEntitlementUpsert,
      update: mockEntitlementUpdate,
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    leaveApplication: { findUnique: jest.fn(), update: jest.fn() },
    leaveApprovalStep: { create: jest.fn() },
    publicHoliday: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: mockTransaction,
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
jest.mock('multer', () => {
  const multer = () => ({
    single: () => (_req, _res, next) => next(),
    array: () => (_req, _res, next) => next(),
  });
  multer.diskStorage = () => ({});
  return multer;
});
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({ on: jest.fn(), pipe: jest.fn() }),
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn().mockReturnValue(''),
}));

const request = require('supertest');
const app = require('../src/index');

afterEach(() => jest.clearAllMocks());

// ── POST /leave/year-end/preview ──────────────────────────────────────────────

describe('POST /leave/year-end/preview', () => {
  test('400 when year missing', async () => {
    const res = await request(app).post('/leave/year-end/preview').send({});
    expect(res.status).toBe(400);
  });

  test('200 — computes carry-forward without committing', async () => {
    mockLeaveTypeFindMany.mockResolvedValueOnce([
      { id: 'lt-al', code: 'AL', name: 'Annual Leave', maxCarryForward: 7, annualEntitlement: 14 },
    ]);
    mockEntitlementFindMany.mockResolvedValueOnce([
      { employeeId: 'emp-1', leaveTypeId: 'lt-al', year: 2026,
        entitledDays: 14, carryForward: 0, usedDays: 5, pendingDays: 0 },
      { employeeId: 'emp-2', leaveTypeId: 'lt-al', year: 2026,
        entitledDays: 14, carryForward: 0, usedDays: 14, pendingDays: 0 },
    ]);

    const res = await request(app).post('/leave/year-end/preview').send({ year: 2026 });
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(2);
    expect(res.body.committed).toBe(false);
    expect(res.body.targetYear).toBe(2027);
    expect(mockEntitlementUpsert).not.toHaveBeenCalled();

    const e1 = res.body.items.find(i => i.employeeId === 'emp-1');
    expect(e1.unusedBalance).toBe(9);
    expect(e1.carriedForward).toBe(7);
    expect(e1.forfeited).toBe(2);
    expect(new Date(e1.expiryDate).toISOString()).toBe('2027-12-31T15:59:59.000Z');

    const e2 = res.body.items.find(i => i.employeeId === 'emp-2');
    expect(e2.carriedForward).toBe(0);
    expect(e2.forfeited).toBe(0);
  });

  test('respects custom expiryDate', async () => {
    mockLeaveTypeFindMany.mockResolvedValueOnce([
      { id: 'lt-al', code: 'AL', name: 'Annual Leave', maxCarryForward: 7, annualEntitlement: 14 },
    ]);
    mockEntitlementFindMany.mockResolvedValueOnce([
      { employeeId: 'emp-1', leaveTypeId: 'lt-al', year: 2026,
        entitledDays: 14, carryForward: 0, usedDays: 5, pendingDays: 0 },
    ]);
    const res = await request(app).post('/leave/year-end/preview').send({
      year: 2026, expiryDate: '2027-03-31T16:00:00Z',
    });
    expect(res.status).toBe(200);
    expect(new Date(res.body.items[0].expiryDate).toISOString()).toBe('2027-03-31T16:00:00.000Z');
  });

  test('filters by leaveTypeCodes when provided', async () => {
    mockLeaveTypeFindMany.mockResolvedValueOnce([
      { id: 'lt-al', code: 'AL', maxCarryForward: 7, annualEntitlement: 14 },
    ]);
    mockEntitlementFindMany.mockResolvedValueOnce([]);

    await request(app).post('/leave/year-end/preview').send({ year: 2026, leaveTypeCodes: ['AL'] });
    expect(mockLeaveTypeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, code: { in: ['AL'] } },
    }));
  });
});

// ── POST /leave/year-end/process ──────────────────────────────────────────────

describe('POST /leave/year-end/process', () => {
  test('200 — commits upserts via transaction', async () => {
    mockLeaveTypeFindMany.mockResolvedValueOnce([
      { id: 'lt-al', code: 'AL', name: 'Annual Leave', maxCarryForward: 7, annualEntitlement: 14 },
    ]);
    mockEntitlementFindMany.mockResolvedValueOnce([
      { employeeId: 'emp-1', leaveTypeId: 'lt-al', year: 2026,
        entitledDays: 14, carryForward: 0, usedDays: 5, pendingDays: 0 },
    ]);
    mockTransaction.mockResolvedValueOnce([]);
    mockEntitlementUpsert.mockReturnValue({}); // call returns thenable in real prisma; here we just need it shaped right

    const res = await request(app).post('/leave/year-end/process').send({ year: 2026 });
    expect(res.status).toBe(200);
    expect(res.body.committed).toBe(true);
    expect(res.body.processed).toBe(1);
    expect(mockTransaction).toHaveBeenCalled();
  });
});

// ── POST /leave/year-end/expire ──────────────────────────────────────────────

describe('POST /leave/year-end/expire (sweep)', () => {
  test('200 — past-expiry entitlements moved to expiredDays and zeroed', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockEntitlementFindMany.mockResolvedValueOnce([
      { id: 'ent-1', employeeId: 'emp-1', leaveTypeId: 'lt-al', year: 2026,
        carryForward: 3, expiredDays: 0, carryForwardExpiry: past },
      { id: 'ent-2', employeeId: 'emp-2', leaveTypeId: 'lt-al', year: 2026,
        carryForward: 2, expiredDays: 1, carryForwardExpiry: past },
    ]);
    mockTransaction.mockResolvedValueOnce([]);

    const res = await request(app).post('/leave/year-end/expire');
    expect(res.status).toBe(200);
    expect(res.body.swept).toBe(2);
    expect(res.body.totalExpired).toBe(5);
    expect(mockTransaction).toHaveBeenCalled();
  });

  test('no-op when nothing past expiry', async () => {
    mockEntitlementFindMany.mockResolvedValueOnce([]);

    const res = await request(app).post('/leave/year-end/expire');
    expect(res.status).toBe(200);
    expect(res.body.swept).toBe(0);
    expect(res.body.totalExpired).toBe(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ── GET /leave/year-end/expiring ──────────────────────────────────────────────

describe('GET /leave/year-end/expiring', () => {
  test('200 — returns entitlements with carry-forward expiring within window', async () => {
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mockEntitlementFindMany.mockResolvedValueOnce([
      {
        id: 'ent-1', employeeId: 'emp-1', year: 2027,
        carryForward: 5, carryForwardExpiry: soon,
        leaveType: { code: 'AL', name: 'Annual Leave' },
      },
    ]);

    const res = await request(app).get('/leave/year-end/expiring?withinDays=14');
    expect(res.status).toBe(200);
    expect(res.body.withinDays).toBe(14);
    expect(res.body.count).toBe(1);
    expect(res.body.entitlements[0].leaveTypeCode).toBe('AL');
    expect(res.body.entitlements[0].daysUntilExpiry).toBeGreaterThanOrEqual(6);
    expect(res.body.entitlements[0].daysUntilExpiry).toBeLessThanOrEqual(8);
  });

  test('clamps withinDays to [1, 365]', async () => {
    mockEntitlementFindMany.mockResolvedValueOnce([]);
    const res = await request(app).get('/leave/year-end/expiring?withinDays=9999');
    expect(res.body.withinDays).toBe(365);
  });
});
