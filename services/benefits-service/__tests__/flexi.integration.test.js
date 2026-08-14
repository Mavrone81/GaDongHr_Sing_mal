'use strict';
/**
 * Integration tests: BEN-002 — Flexi-Benefits Wallet
 *
 * Categories
 *   FW-01  POST /flexi-categories/seed — creates 6 defaults
 *   FW-02  POST /flexi-categories/seed — idempotent (skips existing)
 *   FW-03  GET  /flexi-categories — lists active categories
 *   FW-04  POST /flexi-categories — HR creates custom category → 201
 *   FW-05  POST /flexi-categories — 403 for EMPLOYEE
 *   FW-06  PUT  /flexi-categories/:id — HR updates → 200
 *
 * Config
 *   FW-07  PUT  /benefits/flexi-config — HR upserts grade config → 200
 *   FW-08  PUT  /benefits/flexi-config — 400 negative annualAmount
 *   FW-09  GET  /benefits/flexi-config — returns defaults for unconfigured grades
 *
 * Wallets
 *   FW-10  POST /flexi-wallets — HR credits wallet → 201
 *   FW-11  POST /flexi-wallets — 400 missing employeeId
 *   FW-12  GET  /flexi-wallets/me — employee sees own wallet with balance
 *   FW-13  GET  /flexi-wallets/me — wallet not found returns null
 *   FW-14  GET  /flexi-wallets — employee sees only own (guard)
 *   FW-15  GET  /flexi-wallets/year-end-preview — HR sees summary
 *   FW-16  POST /flexi-wallets/year-end — forfeits unused (encash=false)
 *   FW-17  POST /flexi-wallets/year-end — encashes unused (encash=true)
 *   FW-18  POST /flexi-wallets/year-end — 400 missing year
 *
 * Claims
 *   FW-19  POST /flexi-claims — employee submits → 201 PENDING
 *   FW-20  POST /flexi-claims — auto-approves when amount ≤ threshold
 *   FW-21  POST /flexi-claims — 409 insufficient balance
 *   FW-22  POST /flexi-claims — 400 missing description
 *   FW-23  POST /flexi-claims — 409 expired wallet
 *   FW-24  GET  /flexi-claims — employee sees only own
 *   FW-25  PUT  /flexi-claims/:id/approve — Finance approves PENDING → 200
 *   FW-26  PUT  /flexi-claims/:id/approve — 409 not PENDING
 *   FW-27  PUT  /flexi-claims/:id/reject — rejects PENDING → 200
 *   FW-28  PUT  /flexi-claims/:id/reject — reverses wallet for APPROVED claim
 *   FW-29  PUT  /flexi-claims/:id/reject — 400 missing reason
 *   FW-30  PUT  /flexi-claims/:id/cancel — employee cancels own PENDING → 200
 *   FW-31  PUT  /flexi-claims/:id/cancel — 409 not PENDING
 *   FW-32  PUT  /flexi-claims/:id/cancel — 403 wrong employee
 *
 * Dashboard
 *   FW-33  GET  /flexi-dashboard — HR sees aggregate stats
 *   FW-34  GET  /flexi-dashboard — 403 for EMPLOYEE
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
let mockUser = { sub: 'hr-001', employeeId: 'hr-001', role: 'HR_ADMIN', name: 'HR Admin' };
const setUser = u => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', FINANCE_ADMIN: 'FINANCE_ADMIN',
  },
}), { virtual: true });

// ── Flexi model mocks ─────────────────────────────────────────────────────────
const mockCatCreate     = jest.fn();
const mockCatFindUnique = jest.fn();
const mockCatFindMany   = jest.fn();
const mockCatUpdate     = jest.fn();

const mockCfgFindMany   = jest.fn();
const mockCfgFindUnique = jest.fn();
const mockCfgUpsert     = jest.fn();

const mockWalletFindUnique = jest.fn();
const mockWalletFindMany   = jest.fn();
const mockWalletUpsert     = jest.fn();
const mockWalletUpdate     = jest.fn();

const mockClaimCreate     = jest.fn();
const mockClaimFindUnique = jest.fn();
const mockClaimFindMany   = jest.fn();
const mockClaimUpdate     = jest.fn();
const mockClaimCount      = jest.fn().mockResolvedValue(0);

const mockTransaction = jest.fn(async (ops) => Promise.all(ops));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    // BEN-001 stubs (prevent crashes when app module loads)
    insurancePlan:        { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    employeeEnrollment:   { create: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    dependent:            { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    insuranceClaim:       { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    openEnrollmentPeriod: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    // BEN-002 mocks
    flexiCategory: {
      create: mockCatCreate, findUnique: mockCatFindUnique, findFirst: mockCatFindUnique,
      findMany: mockCatFindMany, update: mockCatUpdate,
    },
    flexiWalletConfig: {
      findMany: mockCfgFindMany, findUnique: mockCfgFindUnique, findFirst: mockCfgFindUnique, upsert: mockCfgUpsert,
    },
    flexiWallet: {
      findUnique: mockWalletFindUnique, findMany: mockWalletFindMany,
      upsert: mockWalletUpsert, update: mockWalletUpdate,
    },
    flexiClaim: {
      create: mockClaimCreate, findUnique: mockClaimFindUnique,
      findMany: mockClaimFindMany, update: mockClaimUpdate, count: mockClaimCount,
    },
    $transaction: mockTransaction,
    // M-05: atomic conditional UPDATE on flexi_wallets. Tests mock a
    // successful single-row update by default; specific tests can override
    // to simulate the race-loss path.
    $executeRaw: jest.fn().mockResolvedValue(1),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $queryRawUnsafe: jest.fn(async (sql) => {
      if (sql && sql.includes('nextval')) return [{ n: 1 }];
      return [];
    }),
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ employees: [] }) });

const request = require('supertest');
const app     = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeCat(o = {}) {
  return {
    id: 'cat-gym', code: 'GYM', name: 'Gym & Fitness',
    description: 'Gym memberships', requiresReceipt: true, isActive: true,
    createdBy: 'hr-001', createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

function makeWallet(o = {}) {
  return {
    id: 'wallet-001', employeeId: 'emp-001', employeeName: 'Alice Tan',
    employeeGrade: 'STAFF', year: 2026, creditedAmount: 1000, usedAmount: 200,
    forfeitedAmount: 0, encashedAmount: 0, status: 'ACTIVE',
    expiresAt: new Date('2026-12-31T15:59:59Z'),
    createdBy: 'hr-001', createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

function makeClaim(o = {}) {
  return {
    id: 'claim-001', claimNumber: 'FLX-2026-00001', walletId: 'wallet-001',
    employeeId: 'emp-001', employeeName: 'Alice Tan',
    categoryId: 'cat-gym', categoryCode: 'GYM', categoryName: 'Gym & Fitness',
    receiptDate: new Date('2026-05-01'), vendor: 'FitHub', description: 'Monthly gym fee',
    claimAmount: 80, approvedAmount: null, receipts: [], status: 'PENDING',
    autoApproved: false, reviewedBy: null, reviewedAt: null, rejectedReason: null,
    submittedAt: new Date(), createdAt: new Date(), updatedAt: new Date(), ...o,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'hr-001', employeeId: 'hr-001', role: 'HR_ADMIN', name: 'HR Admin' });
  mockClaimCount.mockResolvedValue(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────
test('FW-01 POST /flexi-categories/seed — creates 6 defaults', async () => {
  mockCatFindUnique.mockResolvedValue(null); // none exist
  mockCatCreate.mockImplementation(({ data }) => Promise.resolve({ ...data, createdAt: new Date(), updatedAt: new Date() }));

  const res = await request(app).post('/benefits/flexi-categories/seed');
  expect(res.status).toBe(201);
  expect(res.body.created).toBe(6);
  expect(res.body.skipped).toBe(0);
});

test('FW-02 POST /flexi-categories/seed — idempotent (skips existing)', async () => {
  mockCatFindUnique.mockResolvedValue(makeCat()); // all exist
  const res = await request(app).post('/benefits/flexi-categories/seed');
  expect(res.status).toBe(201);
  expect(res.body.created).toBe(0);
  expect(res.body.skipped).toBe(6);
  expect(mockCatCreate).not.toHaveBeenCalled();
});

test('FW-03 GET /flexi-categories — lists active categories', async () => {
  const cats = [makeCat(), makeCat({ id: 'cat-dental', code: 'DENTAL', name: 'Dental' })];
  mockCatFindMany.mockResolvedValueOnce(cats);

  const res = await request(app).get('/benefits/flexi-categories');
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(2);
  expect(res.body.categories[0].code).toBe('GYM');
});

test('FW-04 POST /flexi-categories — HR creates custom category → 201', async () => {
  const cat = makeCat({ code: 'CUSTOM', name: 'Custom Wellness' });
  mockCatCreate.mockResolvedValueOnce(cat);

  const res = await request(app).post('/benefits/flexi-categories').send({
    code: 'CUSTOM', name: 'Custom Wellness', requiresReceipt: false,
  });
  expect(res.status).toBe(201);
  expect(res.body.code).toBe('CUSTOM');
});

test('FW-05 POST /flexi-categories — 403 for EMPLOYEE', async () => {
  setUser({ role: 'EMPLOYEE' });
  const res = await request(app).post('/benefits/flexi-categories').send({ code: 'X', name: 'X' });
  expect(res.status).toBe(403);
});

test('FW-06 PUT /flexi-categories/:id — HR updates → 200', async () => {
  mockCatUpdate.mockResolvedValueOnce(makeCat({ name: 'Updated Gym' }));
  const res = await request(app).put('/benefits/flexi-categories/cat-gym').send({ name: 'Updated Gym' });
  expect(res.status).toBe(200);
  expect(res.body.name).toBe('Updated Gym');
});

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
test('FW-07 PUT /benefits/flexi-config — HR upserts grade config → 200', async () => {
  const config = { id: 'cfg-1', grade: 'STAFF', annualAmount: 600, autoApproveThreshold: 60, isActive: true };
  mockCfgUpsert.mockResolvedValueOnce(config);

  const res = await request(app).put('/benefits/flexi-config').send({
    grade: 'staff', annualAmount: 600, autoApproveThreshold: 60,
  });
  expect(res.status).toBe(200);
  expect(res.body.grade).toBe('STAFF');
  expect(res.body.annualAmount).toBe(600);
});

test('FW-08 PUT /benefits/flexi-config — 400 negative annualAmount', async () => {
  const res = await request(app).put('/benefits/flexi-config').send({ grade: 'STAFF', annualAmount: -100 });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/non-negative/i);
});

test('FW-09 GET /benefits/flexi-config — returns defaults for unconfigured grades', async () => {
  // Only STAFF configured; other grades should appear as defaults
  mockCfgFindMany.mockResolvedValueOnce([{ id: 'cfg-1', grade: 'STAFF', annualAmount: 500, autoApproveThreshold: 50, isActive: true }]);

  const res = await request(app).get('/benefits/flexi-config');
  expect(res.status).toBe(200);
  const staffEntry = res.body.configs.find(c => c.grade === 'STAFF');
  const mgrEntry   = res.body.configs.find(c => c.grade === 'MGR');
  expect(staffEntry.isDefault).toBe(false);
  expect(mgrEntry.isDefault).toBe(true);
  expect(mgrEntry.id).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// Wallets
// ─────────────────────────────────────────────────────────────────────────────
test('FW-10 POST /flexi-wallets — HR credits wallet → 201', async () => {
  const wallet = makeWallet();
  mockWalletUpsert.mockResolvedValueOnce(wallet);

  const res = await request(app).post('/benefits/flexi-wallets').send({
    employeeId: 'emp-001', employeeName: 'Alice Tan', employeeGrade: 'STAFF',
    year: 2026, creditedAmount: 1000,
  });
  expect(res.status).toBe(201);
  expect(res.body.creditedAmount).toBe(1000);
  expect(res.body.employeeId).toBe('emp-001');
});

test('FW-11 POST /flexi-wallets — 400 missing employeeId', async () => {
  const res = await request(app).post('/benefits/flexi-wallets').send({
    employeeName: 'Alice Tan', year: 2026, creditedAmount: 1000,
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/employeeId/i);
});

test('FW-12 GET /flexi-wallets/me — employee sees own wallet with balance', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-001' });
  mockWalletFindUnique.mockResolvedValueOnce(makeWallet());
  mockClaimFindMany.mockResolvedValueOnce([{ claimAmount: 50 }]); // 1 pending claim

  const res = await request(app).get('/benefits/flexi-wallets/me?year=2026');
  expect(res.status).toBe(200);
  expect(res.body.wallet.creditedAmount).toBe(1000);
  expect(res.body.balance.used).toBe(200);
  expect(res.body.balance.pending).toBe(50);
  expect(res.body.balance.remaining).toBe(750);
  expect(res.body.expired).toBe(false);
});

test('FW-13 GET /flexi-wallets/me — wallet not found returns null', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-002' });
  mockWalletFindUnique.mockResolvedValueOnce(null);

  const res = await request(app).get('/benefits/flexi-wallets/me');
  expect(res.status).toBe(200);
  expect(res.body.wallet).toBeNull();
});

test('FW-14 GET /flexi-wallets — employee can only see own wallets', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-001' });
  mockWalletFindMany.mockResolvedValueOnce([makeWallet()]);

  const res = await request(app).get('/benefits/flexi-wallets');
  expect(res.status).toBe(200);
  // Verify the where clause enforced employeeId (mock was called with it)
  const call = mockWalletFindMany.mock.calls[0][0];
  expect(call.where.employeeId).toBe('emp-001');
});

test('FW-15 GET /flexi-wallets/year-end-preview — HR sees summary', async () => {
  mockWalletFindMany.mockResolvedValueOnce([
    makeWallet({ creditedAmount: 1000, usedAmount: 300 }),
    makeWallet({ id: 'wallet-002', employeeId: 'emp-002', creditedAmount: 500, usedAmount: 0 }),
  ]);

  const res = await request(app).get('/benefits/flexi-wallets/year-end-preview?year=2026');
  expect(res.status).toBe(200);
  expect(res.body.summary.totalCredited).toBe(1500);
  expect(res.body.summary.totalUsed).toBe(300);
  expect(res.body.summary.totalRemaining).toBe(1200);
  expect(res.body.rows).toHaveLength(2);
});

test('FW-16 POST /flexi-wallets/year-end — forfeits unused (encash=false)', async () => {
  mockWalletFindMany.mockResolvedValueOnce([
    makeWallet({ creditedAmount: 1000, usedAmount: 300 }),
  ]);
  mockWalletUpdate.mockResolvedValue({});

  const res = await request(app).post('/benefits/flexi-wallets/year-end').send({ year: 2026, encash: false });
  expect(res.status).toBe(200);
  expect(res.body.processed).toBe(1);
  expect(res.body.totalForfeited).toBe(700);
  expect(res.body.totalEncashed).toBe(0);

  const updateCall = mockWalletUpdate.mock.calls[0][0];
  expect(updateCall.data.status).toBe('EXPIRED');
  expect(updateCall.data.forfeitedAmount).toBe(700);
});

test('FW-17 POST /flexi-wallets/year-end — encashes unused (encash=true)', async () => {
  mockWalletFindMany.mockResolvedValueOnce([
    makeWallet({ creditedAmount: 1000, usedAmount: 400 }),
  ]);
  mockWalletUpdate.mockResolvedValue({});

  const res = await request(app).post('/benefits/flexi-wallets/year-end').send({ year: 2026, encash: true });
  expect(res.status).toBe(200);
  expect(res.body.totalEncashed).toBe(600);
  expect(res.body.totalForfeited).toBe(0);

  const updateCall = mockWalletUpdate.mock.calls[0][0];
  expect(updateCall.data.encashedAmount).toBe(600);
});

test('FW-18 POST /flexi-wallets/year-end — 400 missing year', async () => {
  const res = await request(app).post('/benefits/flexi-wallets/year-end').send({ encash: false });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/year/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// Claims
// ─────────────────────────────────────────────────────────────────────────────
test('FW-19 POST /flexi-claims — employee submits → 201 PENDING', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-001' });
  mockWalletFindUnique.mockResolvedValueOnce(makeWallet({ usedAmount: 200 }));
  mockClaimFindMany.mockResolvedValueOnce([]);                        // no pending claims
  mockCatFindUnique.mockResolvedValueOnce(makeCat());
  mockCfgFindUnique.mockResolvedValueOnce(null);                     // no config → no auto-approve
  mockClaimCreate.mockResolvedValueOnce(makeClaim());

  const res = await request(app).post('/benefits/flexi-claims').send({
    walletId: 'wallet-001', categoryId: 'cat-gym',
    receiptDate: '2026-05-01', description: 'Monthly gym fee',
    claimAmount: 80,
  });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('PENDING');
  expect(res.body.autoApproved).toBe(false);
  expect(mockClaimCreate).toHaveBeenCalledTimes(1);
  // Wallet should NOT be updated for PENDING claim
  expect(mockWalletUpdate).not.toHaveBeenCalled();
});

test('FW-20 POST /flexi-claims — auto-approves when amount ≤ threshold', async () => {
  // M-05: the auto-approve path now uses an atomic conditional UPDATE via
  // $executeRaw on the wallet AND a separate flexiClaim.create. The test
  // mock of $executeRaw returns 1 (one row updated) by default, which is
  // the success case.
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-001' });
  mockWalletFindUnique.mockResolvedValueOnce(makeWallet({ usedAmount: 0 }));
  mockClaimFindMany.mockResolvedValueOnce([]);
  mockCatFindUnique.mockResolvedValueOnce(makeCat());
  mockCfgFindUnique.mockResolvedValueOnce({ autoApproveThreshold: 50, grade: 'STAFF' }); // threshold = 50
  const approvedClaim = makeClaim({ claimAmount: 40, status: 'APPROVED', autoApproved: true, approvedAmount: 40 });
  mockClaimCreate.mockResolvedValueOnce(approvedClaim);

  const res = await request(app).post('/benefits/flexi-claims').send({
    walletId: 'wallet-001', categoryId: 'cat-gym',
    receiptDate: '2026-05-01', description: 'Gym class', claimAmount: 40,
  });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('APPROVED');
  expect(res.body.autoApproved).toBe(true);
  expect(mockClaimCreate).toHaveBeenCalledTimes(1);
});

test('FW-21 POST /flexi-claims — 409 insufficient balance', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-001' });
  // usedAmount=900, creditedAmount=1000 → only 100 left
  mockWalletFindUnique.mockResolvedValueOnce(makeWallet({ usedAmount: 900 }));
  mockClaimFindMany.mockResolvedValueOnce([{ claimAmount: 50 }]); // 50 pending → available = 50
  mockCatFindUnique.mockResolvedValueOnce(makeCat());
  mockCfgFindUnique.mockResolvedValueOnce(null);

  const res = await request(app).post('/benefits/flexi-claims').send({
    walletId: 'wallet-001', categoryId: 'cat-gym',
    receiptDate: '2026-05-01', description: 'Test', claimAmount: 200,
  });
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/insufficient/i);
  expect(res.body.available).toBe(50);
});

test('FW-22 POST /flexi-claims — 400 missing description', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-001' });
  const res = await request(app).post('/benefits/flexi-claims').send({
    walletId: 'wallet-001', categoryId: 'cat-gym', receiptDate: '2026-05-01', claimAmount: 50,
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/description/i);
});

test('FW-23 POST /flexi-claims — 409 expired wallet', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-001' });
  mockWalletFindUnique.mockResolvedValueOnce(makeWallet({ status: 'EXPIRED' }));

  const res = await request(app).post('/benefits/flexi-claims').send({
    walletId: 'wallet-001', categoryId: 'cat-gym',
    receiptDate: '2026-05-01', description: 'Gym fee', claimAmount: 50,
  });
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/expired/i);
});

test('FW-24 GET /flexi-claims — employee sees only own', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-001' });
  mockClaimFindMany.mockResolvedValueOnce([makeClaim()]);

  const res = await request(app).get('/benefits/flexi-claims');
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
  // Verify employee filter applied
  const callWhere = mockClaimFindMany.mock.calls[0][0].where;
  expect(callWhere.employeeId).toBe('emp-001');
});

test('FW-25 PUT /flexi-claims/:id/approve — Finance approves PENDING → 200', async () => {
  setUser({ role: 'FINANCE_ADMIN' });
  const pendingClaim = makeClaim({ status: 'PENDING', claimAmount: 80 });
  mockClaimFindUnique.mockResolvedValueOnce(pendingClaim);
  mockWalletFindUnique.mockResolvedValueOnce(makeWallet({ usedAmount: 200 }));
  const approvedClaim = { ...pendingClaim, status: 'APPROVED', approvedAmount: 80 };
  mockTransaction.mockResolvedValueOnce([approvedClaim, makeWallet()]);

  const res = await request(app).put('/benefits/flexi-claims/claim-001/approve');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('APPROVED');
  expect(mockTransaction).toHaveBeenCalledTimes(1);
});

test('FW-26 PUT /flexi-claims/:id/approve — 409 not PENDING', async () => {
  setUser({ role: 'FINANCE_ADMIN' });
  mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: 'APPROVED' }));

  const res = await request(app).put('/benefits/flexi-claims/claim-001/approve');
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/APPROVED/);
});

test('FW-27 PUT /flexi-claims/:id/reject — rejects PENDING → 200', async () => {
  setUser({ role: 'HR_ADMIN' });
  const pendingClaim = makeClaim({ status: 'PENDING' });
  mockClaimFindUnique.mockResolvedValueOnce(pendingClaim);
  const rejectedClaim = { ...pendingClaim, status: 'REJECTED', rejectedReason: 'Not eligible' };
  mockTransaction.mockResolvedValueOnce([rejectedClaim]);

  const res = await request(app).put('/benefits/flexi-claims/claim-001/reject')
    .send({ rejectedReason: 'Not eligible' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('REJECTED');
});

test('FW-28 PUT /flexi-claims/:id/reject — reverses wallet for APPROVED claim', async () => {
  setUser({ role: 'HR_ADMIN' });
  const approvedClaim = makeClaim({ status: 'APPROVED', approvedAmount: 80 });
  mockClaimFindUnique.mockResolvedValueOnce(approvedClaim);
  mockWalletFindUnique.mockResolvedValueOnce(makeWallet({ usedAmount: 280 })); // 200 base + 80 for this claim
  const rejectedClaim = { ...approvedClaim, status: 'REJECTED' };
  mockTransaction.mockResolvedValueOnce([rejectedClaim, makeWallet({ usedAmount: 200 })]);

  const res = await request(app).put('/benefits/flexi-claims/claim-001/reject')
    .send({ rejectedReason: 'Receipt invalid' });
  expect(res.status).toBe(200);
  // Verify two ops in transaction (claim update + wallet reversal)
  const txOps = mockTransaction.mock.calls[0][0];
  expect(txOps).toHaveLength(2);
});

test('FW-29 PUT /flexi-claims/:id/reject — 400 missing reason', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).put('/benefits/flexi-claims/claim-001/reject').send({});
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/rejectedReason/i);
});

test('FW-30 PUT /flexi-claims/:id/cancel — employee cancels own PENDING → 200', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-001' });
  mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: 'PENDING', employeeId: 'emp-001' }));
  mockClaimUpdate.mockResolvedValueOnce(makeClaim({ status: 'CANCELLED' }));

  const res = await request(app).put('/benefits/flexi-claims/claim-001/cancel');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('CANCELLED');
  expect(mockWalletUpdate).not.toHaveBeenCalled(); // PENDING cancel doesn't touch wallet
});

test('FW-31 PUT /flexi-claims/:id/cancel — 409 not PENDING', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-001' });
  mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: 'APPROVED', employeeId: 'emp-001' }));

  const res = await request(app).put('/benefits/flexi-claims/claim-001/cancel');
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/APPROVED/);
});

test('FW-32 PUT /flexi-claims/:id/cancel — 403 wrong employee', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'emp-999' });
  mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: 'PENDING', employeeId: 'emp-001' }));

  const res = await request(app).put('/benefits/flexi-claims/claim-001/cancel');
  expect(res.status).toBe(403);
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────
test('FW-33 GET /flexi-dashboard — HR sees aggregate stats', async () => {
  mockWalletFindMany.mockResolvedValueOnce([
    makeWallet({ creditedAmount: 1000, usedAmount: 300 }),
    makeWallet({ id: 'w2', employeeId: 'emp-002', creditedAmount: 500, usedAmount: 100 }),
  ]);
  mockClaimFindMany.mockResolvedValueOnce([
    makeClaim({ status: 'APPROVED', claimAmount: 100, approvedAmount: 100 }),
    makeClaim({ id: 'c2', status: 'PENDING', claimAmount: 50 }),
  ]);

  const res = await request(app).get('/benefits/flexi-dashboard?year=2026');
  expect(res.status).toBe(200);
  expect(res.body.totalCredited).toBe(1500);
  expect(res.body.totalUsed).toBe(400);
  expect(res.body.totalRemaining).toBe(1100);
  expect(res.body.pendingClaims).toBe(1);
  expect(res.body.byCategory.GYM).toBeDefined();
});

test('FW-34 GET /flexi-dashboard — 403 for EMPLOYEE', async () => {
  setUser({ role: 'EMPLOYEE' });
  const res = await request(app).get('/benefits/flexi-dashboard');
  expect(res.status).toBe(403);
});
