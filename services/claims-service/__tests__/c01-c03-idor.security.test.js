'use strict';
/**
 * Security regression tests for C-01 and C-03 (claims-service).
 *
 * C-01 — GET /claims org-wide IDOR fix:
 *   Previously `if (req.user.role === 'employee')` never matched (JWT has
 *   uppercase 'EMPLOYEE'), so every authenticated employee saw every claim.
 *   The fix is default-deny: only privileged roles get unfiltered access.
 *
 * C-03 — POST /claims body.employeeId mass-assignment fix:
 *   Previously any authenticated user could submit a claim against another
 *   employee's record by passing `employeeId` in the body. The fix only
 *   honours body.employeeId when the caller is in FINANCE_ADMIN_ROLES.
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

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', role: 'FINANCE_ADMIN', employeeId: 'e-admin' });
});

// ── C-01 GET /claims org-wide IDOR ────────────────────────────────────────────

test('C01-01 EMPLOYEE only sees own claims (where clause forced to req.user.employeeId)', async () => {
  setUser({ sub: 'emp-victim', role: 'EMPLOYEE', employeeId: 'e-victim' });
  mockDb.claim.findMany.mockResolvedValue([]);
  mockDb.claim.count.mockResolvedValue(0);

  const res = await request(app).get('/claims');
  expect(res.status).toBe(200);
  expect(mockDb.claim.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { employeeId: 'e-victim' },
  }));
});

test('C01-02 EMPLOYEE cannot use ?employeeId= to scope to another employee', async () => {
  setUser({ sub: 'emp-attacker', role: 'EMPLOYEE', employeeId: 'e-attacker' });
  mockDb.claim.findMany.mockResolvedValue([]);

  await request(app).get('/claims?employeeId=e-victim');
  const args = mockDb.claim.findMany.mock.calls[0][0];
  expect(args.where.employeeId).toBe('e-attacker'); // forced, not e-victim
});

test('C01-03 LINE_MANAGER (non-privileged) is still scoped to own employeeId', async () => {
  setUser({ sub: 'mgr-001', role: 'LINE_MANAGER', employeeId: 'e-mgr' });
  mockDb.claim.findMany.mockResolvedValue([]);

  await request(app).get('/claims');
  const args = mockDb.claim.findMany.mock.calls[0][0];
  expect(args.where.employeeId).toBe('e-mgr');
});

test('C01-04 FINANCE_ADMIN gets unfiltered list (no employeeId in where)', async () => {
  setUser({ sub: 'finance-001', role: 'FINANCE_ADMIN', employeeId: 'e-finance' });
  mockDb.claim.findMany.mockResolvedValue([]);

  await request(app).get('/claims');
  const args = mockDb.claim.findMany.mock.calls[0][0];
  expect(args.where.employeeId).toBeUndefined();
});

test('C01-05 FINANCE_ADMIN can filter by ?employeeId= to view a specific employee', async () => {
  setUser({ sub: 'finance-001', role: 'FINANCE_ADMIN', employeeId: 'e-finance' });
  mockDb.claim.findMany.mockResolvedValue([]);

  await request(app).get('/claims?employeeId=e-target');
  const args = mockDb.claim.findMany.mock.calls[0][0];
  expect(args.where.employeeId).toBe('e-target');
});

test('C01-06 HR_ADMIN and SUPER_ADMIN and PAYROLL_OFFICER are all privileged', async () => {
  for (const role of ['HR_ADMIN', 'SUPER_ADMIN', 'PAYROLL_OFFICER']) {
    jest.clearAllMocks();
    setUser({ sub: 'u', role, employeeId: 'e-' + role });
    mockDb.claim.findMany.mockResolvedValue([]);
    await request(app).get('/claims');
    const args = mockDb.claim.findMany.mock.calls[0][0];
    expect(args.where.employeeId).toBeUndefined();
  }
});

// ── C-03 POST /claims body.employeeId mass-assignment ─────────────────────────

const CATEGORY = { id: 'cat-001', code: 'TRAVEL', name: 'Travel', maxAmount: null, isGstClaimable: false };

test('C03-01 EMPLOYEE cannot pass body.employeeId — forced to req.user.employeeId', async () => {
  setUser({ sub: 'emp-attacker', role: 'EMPLOYEE', employeeId: 'e-attacker' });
  mockDb.claimCategory.findUnique.mockResolvedValue(CATEGORY);
  mockDb.claim.create.mockImplementation(async ({ data }) => ({ id: 'c-1', ...data }));

  const res = await request(app).post('/claims').send({
    categoryId: 'cat-001', title: 'Hack', claimDate: '2026-05-01',
    totalAmount: 100, employeeId: 'e-victim',
  });
  expect(res.status).toBe(201);
  expect(mockDb.claim.create).toHaveBeenCalled();
  const dataArg = mockDb.claim.create.mock.calls[0][0].data;
  expect(dataArg.employeeId).toBe('e-attacker'); // attacker's own, not victim's
  expect(dataArg.employeeId).not.toBe('e-victim');
});

test('C03-02 LINE_MANAGER cannot pass body.employeeId either', async () => {
  setUser({ sub: 'mgr-001', role: 'LINE_MANAGER', employeeId: 'e-mgr' });
  mockDb.claimCategory.findUnique.mockResolvedValue(CATEGORY);
  mockDb.claim.create.mockImplementation(async ({ data }) => ({ id: 'c-2', ...data }));

  await request(app).post('/claims').send({
    categoryId: 'cat-001', title: 'On behalf', claimDate: '2026-05-01',
    totalAmount: 100, employeeId: 'e-victim',
  });
  const dataArg = mockDb.claim.create.mock.calls[0][0].data;
  expect(dataArg.employeeId).toBe('e-mgr');
});

test('C03-03 FINANCE_ADMIN can submit on behalf via body.employeeId', async () => {
  setUser({ sub: 'finance-001', role: 'FINANCE_ADMIN', employeeId: 'e-finance' });
  mockDb.claimCategory.findUnique.mockResolvedValue(CATEGORY);
  mockDb.claim.create.mockImplementation(async ({ data }) => ({ id: 'c-3', ...data }));

  const res = await request(app).post('/claims').send({
    categoryId: 'cat-001', title: 'On-behalf', claimDate: '2026-05-01',
    totalAmount: 100, employeeId: 'e-target',
  });
  expect(res.status).toBe(201);
  const dataArg = mockDb.claim.create.mock.calls[0][0].data;
  expect(dataArg.employeeId).toBe('e-target');
});

test('C03-04 HR_ADMIN and SUPER_ADMIN can also submit on behalf', async () => {
  for (const role of ['HR_ADMIN', 'SUPER_ADMIN']) {
    jest.clearAllMocks();
    setUser({ sub: 'u', role, employeeId: 'e-' + role });
    mockDb.claimCategory.findUnique.mockResolvedValue(CATEGORY);
    mockDb.claim.create.mockImplementation(async ({ data }) => ({ id: 'c', ...data }));

    await request(app).post('/claims').send({
      categoryId: 'cat-001', title: 'X', claimDate: '2026-05-01',
      totalAmount: 50, employeeId: 'e-other',
    });
    const dataArg = mockDb.claim.create.mock.calls[0][0].data;
    expect(dataArg.employeeId).toBe('e-other');
  }
});

test('C03-05 EMPLOYEE submitting without body.employeeId uses own employeeId (regression)', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE', employeeId: 'e-self' });
  mockDb.claimCategory.findUnique.mockResolvedValue(CATEGORY);
  mockDb.claim.create.mockImplementation(async ({ data }) => ({ id: 'c-5', ...data }));

  const res = await request(app).post('/claims').send({
    categoryId: 'cat-001', title: 'Self', claimDate: '2026-05-01', totalAmount: 50,
  });
  expect(res.status).toBe(201);
  expect(mockDb.claim.create.mock.calls[0][0].data.employeeId).toBe('e-self');
});
