'use strict';
/**
 * Security regression for H-14, H-15, H-16 (claims-service).
 *
 *   H-14 PATCH /claims/:id re-validates the category cap even when
 *        `categoryId` is omitted from the patch body.
 *   H-15 POST and PATCH reject zero / negative totalAmount and negative gstAmount.
 *   H-16 PUT /claims/:id/approve refuses to approve own claim (maker-checker).
 */

let mockUser = { sub: 'admin-001', role: 'FINANCE_ADMIN', employeeId: 'e-admin' };
const setUser = (u) => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', FINANCE_ADMIN: 'FINANCE_ADMIN',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const mockDb = {
  claim:                 { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  claimCategory:         { findMany: jest.fn(), findUnique: jest.fn() },
  vendorGstRegistration: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  categoryBudget:        { findMany: jest.fn(), upsert: jest.fn() },
  approverDelegation:    { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

const request = require('supertest');
const app = require('../src/index');

const CAT_CAPPED = { id: 'cat-200', code: 'MEAL', name: 'Meal', maxAmount: 200, isGstClaimable: false };

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', role: 'FINANCE_ADMIN', employeeId: 'e-admin' });
});

// ── H-15 ──────────────────────────────────────────────────────────────────────
describe('H-15 negative / zero totalAmount rejected', () => {
  test('POST /claims rejects totalAmount=0', async () => {
    mockDb.claimCategory.findUnique.mockResolvedValue(CAT_CAPPED);
    const res = await request(app).post('/claims').send({
      categoryId: 'cat-200', title: 'x', claimDate: '2026-05-01', totalAmount: 0,
    });
    expect(res.status).toBe(400);
  });
  test('POST /claims rejects negative totalAmount', async () => {
    mockDb.claimCategory.findUnique.mockResolvedValue(CAT_CAPPED);
    const res = await request(app).post('/claims').send({
      categoryId: 'cat-200', title: 'x', claimDate: '2026-05-01', totalAmount: -100,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive/);
  });
  test('POST /claims rejects negative gstAmount', async () => {
    mockDb.claimCategory.findUnique.mockResolvedValue(CAT_CAPPED);
    const res = await request(app).post('/claims').send({
      categoryId: 'cat-200', title: 'x', claimDate: '2026-05-01', totalAmount: 50, gstAmount: -1,
    });
    expect(res.status).toBe(400);
  });
});

// ── H-14 ──────────────────────────────────────────────────────────────────────
describe('H-14 PATCH re-validates cap even without categoryId in body', () => {
  test('PATCH that omits categoryId still hits the cap from the existing claim', async () => {
    mockDb.claim.findUnique.mockResolvedValue({
      id: 'c-1', categoryId: 'cat-200', employeeId: 'e-someone-else', status: 'SUBMITTED', totalAmount: 50,
    });
    mockDb.claimCategory.findUnique.mockResolvedValue(CAT_CAPPED);

    const res = await request(app).patch('/claims/c-1').send({ totalAmount: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds category limit/i);
  });
  test('PATCH with negative totalAmount rejected', async () => {
    mockDb.claim.findUnique.mockResolvedValue({
      id: 'c-1', categoryId: 'cat-200', employeeId: 'e-someone-else', status: 'SUBMITTED', totalAmount: 50,
    });
    const res = await request(app).patch('/claims/c-1').send({ totalAmount: -1 });
    expect(res.status).toBe(400);
  });
});

// ── H-16 ──────────────────────────────────────────────────────────────────────
describe('H-16 maker-checker on approve', () => {
  test('FINANCE_ADMIN cannot approve own claim', async () => {
    setUser({ sub: 'finance-1', role: 'FINANCE_ADMIN', employeeId: 'e-finance' });
    mockDb.claim.findUnique.mockResolvedValue({
      id: 'c-1', categoryId: 'cat-200', employeeId: 'e-finance', status: 'SUBMITTED', totalAmount: 50,
    });
    const res = await request(app).put('/claims/c-1/approve').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/maker-checker/i);
  });
  test('FINANCE_ADMIN CAN approve someone else\'s claim', async () => {
    setUser({ sub: 'finance-1', role: 'FINANCE_ADMIN', employeeId: 'e-finance' });
    mockDb.claim.findUnique.mockResolvedValue({
      id: 'c-2', categoryId: 'cat-200', employeeId: 'e-other', status: 'SUBMITTED', totalAmount: 50,
    });
    mockDb.claim.update.mockResolvedValue({ id: 'c-2', status: 'APPROVED' });
    const res = await request(app).put('/claims/c-2/approve').send({});
    expect(res.status).toBe(200);
  });
});
