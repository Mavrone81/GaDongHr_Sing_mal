'use strict';
/**
 * Integration tests for CLM-004:
 *   - Vendor GST registry CRUD + validate
 *   - Auto-validation on POST /claims
 *   - Re-validate endpoint
 *   - Budget upsert + list
 *   - Dashboard: gst-summary, top-claimants, category-budget
 */

let mockUser = { sub: 'admin-001', email: 'admin@test.com', role: 'FINANCE_ADMIN', employeeId: 'e-admin' };
const setUser = (u) => { mockUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role || (req.user?.permissions || []).includes(a));
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
  claim: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  claimCategory: { findMany: jest.fn(), findUnique: jest.fn() },
  vendorGstRegistration: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  categoryBudget: { findMany: jest.fn(), upsert: jest.fn() },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

const request = require('supertest');
const app = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', email: 'admin@test.com', role: 'FINANCE_ADMIN', employeeId: 'e-admin' });
});

// ── Vendor GST registry ────────────────────────────────────────────────────

describe('Vendor GST registry', () => {
  test('V1 — GET list with search filter on gstNumber + vendorName', async () => {
    mockDb.vendorGstRegistration.findMany.mockResolvedValueOnce([
      { id: 'v1', gstNumber: 'M12345678X', vendorName: 'Acme', isActive: true },
    ]);
    const res = await request(app).get('/claims/vendor-gst?search=Acme');
    expect(res.status).toBe(200);
    const call = mockDb.vendorGstRegistration.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
  });

  test('V2 — POST creates a vendor, normalising the number', async () => {
    mockDb.vendorGstRegistration.create.mockResolvedValueOnce({ id: 'v1', gstNumber: 'M12345678X', vendorName: 'Acme' });
    const res = await request(app).post('/claims/vendor-gst').send({
      gstNumber: ' m1234-5678x ', vendorName: 'Acme',
    });
    expect(res.status).toBe(201);
    expect(mockDb.vendorGstRegistration.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ gstNumber: 'M12345678X' }),
    }));
  });

  test('V3 — POST rejects invalid format with 400', async () => {
    const res = await request(app).post('/claims/vendor-gst').send({ gstNumber: 'NOPE', vendorName: 'X' });
    expect(res.status).toBe(400);
  });

  test('V4 — POST returns 409 on duplicate gstNumber', async () => {
    mockDb.vendorGstRegistration.create.mockRejectedValueOnce({ code: 'P2002' });
    const res = await request(app).post('/claims/vendor-gst').send({ gstNumber: 'M12345678X', vendorName: 'Acme' });
    expect(res.status).toBe(409);
  });

  test('V5 — PUT updates vendor', async () => {
    mockDb.vendorGstRegistration.update.mockResolvedValueOnce({ id: 'v1', vendorName: 'Acme Holdings' });
    const res = await request(app).put('/claims/vendor-gst/v1').send({ vendorName: 'Acme Holdings' });
    expect(res.status).toBe(200);
    expect(res.body.vendorName).toBe('Acme Holdings');
  });

  test('V6 — DELETE soft-deletes via isActive=false', async () => {
    mockDb.vendorGstRegistration.update.mockResolvedValueOnce({});
    const res = await request(app).delete('/claims/vendor-gst/v1');
    expect(res.status).toBe(200);
    expect(mockDb.vendorGstRegistration.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { isActive: false },
    }));
  });

  test('V7 — POST /vendor-gst/validate returns match result', async () => {
    mockDb.vendorGstRegistration.findMany.mockResolvedValueOnce([
      { gstNumber: 'M12345678X', vendorName: 'Acme', isActive: true, effectiveFrom: new Date('2020-01-01') },
    ]);
    const res = await request(app).post('/claims/vendor-gst/validate').send({ gstNumber: 'M12345678X' });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.vendor.vendorName).toBe('Acme');
  });

  test('V8 — POST /vendor-gst/validate returns not_in_registry when missing', async () => {
    mockDb.vendorGstRegistration.findMany.mockResolvedValueOnce([]);
    const res = await request(app).post('/claims/vendor-gst/validate').send({ gstNumber: 'M99999999Z' });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe('not_in_registry');
  });

  test('V9 — non-admin role cannot POST vendor', async () => {
    setUser({ sub: 'emp-1', role: 'EMPLOYEE' });
    const res = await request(app).post('/claims/vendor-gst').send({ gstNumber: 'M12345678X', vendorName: 'Acme' });
    expect(res.status).toBe(403);
  });

  test('V10 — revalidate sweeps SUBMITTED+APPROVED claims, updates flag', async () => {
    mockDb.vendorGstRegistration.findMany.mockResolvedValueOnce([
      { gstNumber: 'M12345678X', vendorName: 'Acme', isActive: true, effectiveFrom: new Date('2020-01-01') },
    ]);
    mockDb.claim.findMany.mockResolvedValueOnce([
      { id: 'c1', vendorGstNumber: 'M12345678X', claimDate: new Date('2026-05-01'), gstValidated: false },
      { id: 'c2', vendorGstNumber: 'M99999999Z', claimDate: new Date('2026-05-01'), gstValidated: true  },
    ]);
    mockDb.claim.update.mockResolvedValue({});
    const res = await request(app).post('/claims/vendor-gst/revalidate').send({});
    expect(res.status).toBe(200);
    expect(res.body.scanned).toBe(2);
    expect(res.body.updated).toBe(2); // c1 flips → valid, c2 flips → invalid
    expect(res.body.nowValid).toBe(1);
    expect(res.body.nowInvalid).toBe(1);
  });
});

// ── Auto-validate on claim submit ──────────────────────────────────────────

describe('POST /claims — auto-validate vendor GST', () => {
  test('V11 — flags gstValidated=true when number is in registry', async () => {
    setUser({ sub: 'u-1', role: 'EMPLOYEE', employeeId: 'e-1' });
    mockDb.claimCategory.findUnique.mockResolvedValueOnce({ id: 'cat-1', isGstClaimable: true, maxAmount: null });
    mockDb.vendorGstRegistration.findMany.mockResolvedValueOnce([
      { gstNumber: 'M12345678X', vendorName: 'Acme', isActive: true, effectiveFrom: new Date('2020-01-01') },
    ]);
    mockDb.claim.create.mockImplementation(async ({ data }) => ({ ...data, category: { code: 'TRAVEL' }, items: [] }));
    const res = await request(app).post('/claims').send({
      categoryId: 'cat-1', title: 'Hotel', claimDate: '2026-05-10',
      totalAmount: 1090, gstAmount: 90, vendorGstNumber: 'M12345678X', vendorName: 'Acme',
    });
    expect(res.status).toBe(201);
    expect(res.body.gstValidated).toBe(true);
    expect(res.body.vendorGstNumber).toBe('M12345678X');
  });

  test('V12 — flags gstValidated=false when number not registered', async () => {
    setUser({ sub: 'u-1', role: 'EMPLOYEE', employeeId: 'e-1' });
    mockDb.claimCategory.findUnique.mockResolvedValueOnce({ id: 'cat-1', isGstClaimable: true });
    mockDb.vendorGstRegistration.findMany.mockResolvedValueOnce([]);
    mockDb.claim.create.mockImplementation(async ({ data }) => ({ ...data, category: { code: 'TRAVEL' }, items: [] }));
    const res = await request(app).post('/claims').send({
      categoryId: 'cat-1', title: 'Hotel', claimDate: '2026-05-10',
      totalAmount: 1090, gstAmount: 90, vendorGstNumber: 'M99999999Z',
    });
    expect(res.status).toBe(201);
    expect(res.body.gstValidated).toBe(false);
    expect(res.body.gstValidationNote).toMatch(/not_in_registry/);
  });

  test('V13 — notes when GST claimed but no vendor number supplied', async () => {
    setUser({ sub: 'u-1', role: 'EMPLOYEE', employeeId: 'e-1' });
    mockDb.claimCategory.findUnique.mockResolvedValueOnce({ id: 'cat-1', isGstClaimable: true });
    mockDb.claim.create.mockImplementation(async ({ data }) => ({ ...data, category: {}, items: [] }));
    const res = await request(app).post('/claims').send({
      categoryId: 'cat-1', title: 'Meal', claimDate: '2026-05-10', totalAmount: 109, gstAmount: 9,
    });
    expect(res.status).toBe(201);
    expect(res.body.gstValidationNote).toMatch(/no vendor GST number/i);
  });
});

// ── Budgets ────────────────────────────────────────────────────────────────

describe('Category budgets', () => {
  test('V14 — PUT upserts budget, validates non-negative', async () => {
    mockDb.categoryBudget.upsert.mockResolvedValueOnce({ id: 'b1', categoryId: 'cat-1', period: '2026-05', budgetAmount: 1000 });
    const res = await request(app).put('/claims/budgets').send({ categoryId: 'cat-1', period: '2026-05', budgetAmount: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.budgetAmount).toBe(1000);
  });

  test('V15 — PUT rejects negative budget', async () => {
    const res = await request(app).put('/claims/budgets').send({ categoryId: 'cat-1', period: '2026-05', budgetAmount: -1 });
    expect(res.status).toBe(400);
  });

  test('V16 — GET budgets filters by period', async () => {
    mockDb.categoryBudget.findMany.mockResolvedValueOnce([]);
    await request(app).get('/claims/budgets?period=2026-05');
    const call = mockDb.categoryBudget.findMany.mock.calls[0][0];
    expect(call.where.period).toBe('2026-05');
  });
});

// ── Dashboard ──────────────────────────────────────────────────────────────

describe('Dashboard endpoints', () => {
  test('V17 — gst-summary aggregates by period/category/cost-centre, splits validated vs not', async () => {
    mockDb.claim.findMany.mockResolvedValueOnce([
      { id: 'c1', payrollPeriod: '2026-05', categoryId: 'cat-1', costCentre: 'CC-A', totalAmount: 1090, gstAmount: 90, gstValidated: true,  category: { id: 'cat-1', code: 'TRAVEL', isGstClaimable: true } },
      { id: 'c2', payrollPeriod: '2026-05', categoryId: 'cat-1', costCentre: 'CC-A', totalAmount: 218,  gstAmount: 18, gstValidated: false, category: { id: 'cat-1', code: 'TRAVEL', isGstClaimable: true } },
      { id: 'c3', payrollPeriod: '2026-05', categoryId: 'cat-2', costCentre: 'CC-B', totalAmount: 200,  gstAmount: 0,  gstValidated: false, category: { id: 'cat-2', code: 'MISC',   isGstClaimable: false } },
    ]);
    const res = await request(app).get('/claims/dashboard/gst-summary?from=2026-05-01&to=2026-05-31');
    expect(res.status).toBe(200);
    // Only the 2 isGstClaimable claims contribute to GST totals
    expect(res.body.totals.gstClaimableClaims).toBe(2);
    expect(res.body.totals.totalGst).toBe(108);
    expect(res.body.totals.validatedGst).toBe(90);
    expect(res.body.totals.unvalidatedGst).toBe(18);
    expect(res.body.totals.unvalidatedClaimCount).toBe(1);
    expect(res.body.byPeriod).toEqual(expect.arrayContaining([expect.objectContaining({ period: '2026-05' })]));
    expect(res.body.byCostCentre[0].costCentre).toBe('CC-A');
  });

  test('V18 — gst-summary only includes APPROVED+PAID claims', async () => {
    mockDb.claim.findMany.mockResolvedValueOnce([]);
    await request(app).get('/claims/dashboard/gst-summary');
    const call = mockDb.claim.findMany.mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ['APPROVED', 'PAID'] });
  });

  test('V19 — top-claimants ranks by total reimbursement', async () => {
    mockDb.claim.findMany.mockResolvedValueOnce([
      { employeeId: 'e1', totalAmount: 1000, gstAmount: 90 },
      { employeeId: 'e2', totalAmount: 500,  gstAmount: 45 },
      { employeeId: 'e1', totalAmount: 200,  gstAmount: 18 },
    ]);
    const res = await request(app).get('/claims/dashboard/top-claimants?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.top[0].employeeId).toBe('e1');
    expect(res.body.top[0].totalAmount).toBe(1200);
  });

  test('V20 — category-budget returns 400 without period', async () => {
    const res = await request(app).get('/claims/dashboard/category-budget');
    expect(res.status).toBe(400);
  });

  test('V21 — category-budget surfaces BREACH + UNBUDGETED summary', async () => {
    mockDb.claim.findMany.mockResolvedValueOnce([
      { categoryId: 'cat-1', payrollPeriod: '2026-05', totalAmount: 1200 },  // breach budget 1000
      { categoryId: 'cat-9', payrollPeriod: '2026-05', totalAmount: 50 },    // unbudgeted
    ]);
    mockDb.categoryBudget.findMany.mockResolvedValueOnce([
      { categoryId: 'cat-1', period: '2026-05', budgetAmount: 1000 },
    ]);
    mockDb.claimCategory.findMany.mockResolvedValueOnce([
      { id: 'cat-1', code: 'TRAVEL', name: 'Travel', isActive: true },
    ]);
    const res = await request(app).get('/claims/dashboard/category-budget?period=2026-05');
    expect(res.status).toBe(200);
    expect(res.body.summary.breach).toBe(1);
    expect(res.body.summary.unbudgetedWithSpend).toBe(1);
    expect(res.body.summary.totalSpend).toBe(1250);
    const cat1 = res.body.rows.find(r => r.categoryId === 'cat-1');
    expect(cat1.status).toBe('BREACH');
    expect(cat1.categoryCode).toBe('TRAVEL');
  });

  test('V22 — non-finance role cannot read dashboards', async () => {
    setUser({ sub: 'emp-1', role: 'EMPLOYEE' });
    const res = await request(app).get('/claims/dashboard/gst-summary');
    expect(res.status).toBe(403);
  });
});
