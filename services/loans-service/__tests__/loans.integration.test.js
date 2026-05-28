'use strict';
/**
 * Integration tests: ESV-002 — Salary Advance & Staff Loans
 *
 * Advances
 *   AD-01  POST /loans/advances — within cap → 201
 *   AD-02  POST /loans/advances — exceeds cap → 400
 *   AD-03  POST /loans/advances — existing pending → 409
 *   AD-04  GET  /loans/advances — employee sees only own
 *   AD-05  GET  /loans/advances — HR sees all
 *   AD-06  PUT  /loans/advances/:id/approve — HR approves with default month
 *   AD-07  PUT  /loans/advances/:id/approve — 409 not PENDING
 *   AD-08  PUT  /loans/advances/:id/reject — 400 missing reason
 *   AD-09  PUT  /loans/advances/:id/cancel — requester cancels PENDING
 *   AD-10  POST /loans/advances/:id/mark-deducted — payroll callback
 *
 * Loans
 *   LN-01  POST /loans/staff-loans — valid loan → 201 with monthlyInstalment
 *   LN-02  POST /loans/staff-loans — affordability fail (>30% sal) → 400
 *   LN-03  POST /loans/staff-loans — tenure > 60 → 400
 *   LN-04  POST /loans/staff-loans — existing ACTIVE blocks new → 409
 *   LN-05  GET  /loans/staff-loans — employee sees only own
 *   LN-06  GET  /loans/staff-loans/:id — returns outstanding + schedule
 *   LN-07  PUT  /loans/staff-loans/:id/approve — generates schedule + agreement
 *   LN-08  PUT  /loans/staff-loans/:id/reject — 400 missing reason
 *   LN-09  PUT  /loans/staff-loans/:id/activate — APPROVED → ACTIVE
 *   LN-10  POST /loans/staff-loans/:id/repayments — records PAID + updates outstanding
 *   LN-11  POST /loans/staff-loans/:id/repayments — final payment marks SETTLED
 *   LN-12  POST /loans/staff-loans/:id/settle — early settlement waives remaining
 *   LN-13  GET  /loans/staff-loans/:id/agreement — auto-generates if missing
 *
 * Dashboard & Termination
 *   DB-01  GET  /loans/dashboard — HR/Finance sees aggregate
 *   TD-01  GET  /loans/termination-deductions/:employeeId — totals active loans + advances
 */

let mockUser = { sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE', name: 'Alice Tan' };
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

const mockAdvCreate     = jest.fn();
const mockAdvFindUnique = jest.fn();
const mockAdvFindFirst  = jest.fn();
const mockAdvFindMany   = jest.fn();
const mockAdvUpdate     = jest.fn();
const mockAdvCount      = jest.fn();
const mockLoanCreate     = jest.fn();
const mockLoanFindUnique = jest.fn();
const mockLoanFindFirst  = jest.fn();
const mockLoanFindMany   = jest.fn();
const mockLoanUpdate     = jest.fn();
const mockLoanCount      = jest.fn();
const mockRepayCreate     = jest.fn();
const mockRepayCreateMany = jest.fn();
const mockRepayFindMany   = jest.fn();
const mockRepayUpdate     = jest.fn();
const mockRepayUpdateMany = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    salaryAdvance: {
      create: mockAdvCreate, findUnique: mockAdvFindUnique,
      findFirst: mockAdvFindFirst, findMany: mockAdvFindMany,
      update: mockAdvUpdate, count: mockAdvCount,
    },
    staffLoan: {
      create: mockLoanCreate, findUnique: mockLoanFindUnique,
      findFirst: mockLoanFindFirst, findMany: mockLoanFindMany,
      update: mockLoanUpdate, count: mockLoanCount,
    },
    loanRepayment: {
      create: mockRepayCreate, createMany: mockRepayCreateMany,
      findMany: mockRepayFindMany, update: mockRepayUpdate, updateMany: mockRepayUpdateMany,
    },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

// Default salary-lookup mock: every call returns SGD 5000 monthly. Specific
// tests override this if they want to test salary edge cases. This replaces
// the body.monthlySalary path that existed before C-17 — loans-service now
// fetches the canonical salary from employee-service.
process.env.INTERNAL_SERVICE_KEY = 'test-internal-key-2025';
global.fetch = jest.fn().mockImplementation(async (url) => {
  if (typeof url === 'string' && url.includes('/internal/monthly-salary')) {
    return { ok: true, json: async () => ({ monthlySalary: 5000, isActive: true, salaryBasis: 'MONTHLY' }) };
  }
  return { ok: true, json: async () => ({}) };
});

const request = require('supertest');
const app     = require('../src/index');

function makeAdvance(o = {}) {
  return {
    id: 'adv-001', advanceNumber: 'ADV-2026-00001',
    employeeId: 'emp-001', employeeName: 'Alice Tan',
    monthlySalary: 5000, amount: 2000, reason: 'Emergency',
    status: 'PENDING',
    requestedBy: 'emp-001', requestedAt: new Date(),
    approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    deductionMonth: null, deductedAt: null, payrollRunId: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...o,
  };
}

function makeLoan(o = {}) {
  return {
    id: 'ln-001', loanNumber: 'LN-2026-00001',
    employeeId: 'emp-001', employeeName: 'Alice Tan',
    monthlySalary: 5000, principal: 5000, interestRate: 0,
    tenureMonths: 12, monthlyInstalment: 416.67, totalRepayable: 5000,
    outstandingBalance: 5000, totalRepaid: 0,
    reason: 'Home repairs', status: 'PENDING',
    requestedBy: 'emp-001', requestedAt: new Date(),
    approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, rejectionReason: null,
    startDate: null, expectedEndDate: null, actualEndDate: null,
    agreementHtml: null, agreementGeneratedAt: null, esignRequestId: null,
    createdAt: new Date(), updatedAt: new Date(),
    repayments: [],
    ...o,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE', name: 'Alice Tan' });
});

// ──────────────────────────────────────────────────────────────────────────────
// Advances
// ──────────────────────────────────────────────────────────────────────────────
test('AD-01 within cap → 201', async () => {
  mockAdvFindFirst.mockResolvedValueOnce(null);
  mockAdvCount.mockResolvedValueOnce(0);
  mockAdvCreate.mockResolvedValueOnce(makeAdvance());
  const res = await request(app).post('/loans/advances').send({
    amount: 2000, monthlySalary: 5000, reason: 'Emergency',
  });
  expect(res.status).toBe(201);
  expect(res.body.advanceNumber).toBe('ADV-2026-00001');
});

test('AD-02 exceeds cap → 400', async () => {
  const res = await request(app).post('/loans/advances').send({
    amount: 6000, monthlySalary: 5000, reason: 'X',
  });
  expect(res.status).toBe(400);
  expect(res.body.maxAllowed).toBe(5000);
});

test('AD-03 existing pending → 409', async () => {
  mockAdvFindFirst.mockResolvedValueOnce(makeAdvance({ status: 'APPROVED' }));
  const res = await request(app).post('/loans/advances').send({
    amount: 1000, monthlySalary: 5000, reason: 'X',
  });
  expect(res.status).toBe(409);
});

test('AD-04 employee sees only own', async () => {
  mockAdvFindMany.mockResolvedValueOnce([makeAdvance()]);
  const res = await request(app).get('/loans/advances');
  expect(res.status).toBe(200);
  expect(mockAdvFindMany.mock.calls[0][0].where.employeeId).toBe('emp-001');
});

test('AD-05 HR sees all', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockAdvFindMany.mockResolvedValueOnce([makeAdvance(), makeAdvance({ id: 'adv-2', employeeId: 'emp-002' })]);
  const res = await request(app).get('/loans/advances');
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(2);
});

test('AD-06 HR approves with default month', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'hr-1' });
  mockAdvFindUnique.mockResolvedValueOnce(makeAdvance());
  mockAdvUpdate.mockResolvedValueOnce(makeAdvance({ status: 'APPROVED', deductionMonth: '2026-05' }));
  const res = await request(app).put('/loans/advances/adv-001/approve').send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('APPROVED');
  expect(res.body.deductionMonth).toBeDefined();
});

test('AD-07 409 not PENDING', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockAdvFindUnique.mockResolvedValueOnce(makeAdvance({ status: 'APPROVED' }));
  const res = await request(app).put('/loans/advances/adv-001/approve').send({});
  expect(res.status).toBe(409);
});

test('AD-08 400 missing reject reason', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).put('/loans/advances/adv-001/reject').send({});
  expect(res.status).toBe(400);
});

test('AD-09 requester cancels PENDING', async () => {
  mockAdvFindUnique.mockResolvedValueOnce(makeAdvance({ requestedBy: 'emp-001' }));
  mockAdvUpdate.mockResolvedValueOnce(makeAdvance({ status: 'CANCELLED' }));
  const res = await request(app).put('/loans/advances/adv-001/cancel').send({});
  expect(res.status).toBe(200);
});

test('AD-10 payroll callback marks deducted', async () => {
  setUser({ role: 'PAYROLL_OFFICER' });
  mockAdvFindUnique.mockResolvedValueOnce(makeAdvance({ status: 'APPROVED' }));
  mockAdvUpdate.mockResolvedValueOnce(makeAdvance({ status: 'DEDUCTED', deductedAt: new Date() }));
  const res = await request(app).post('/loans/advances/adv-001/mark-deducted').send({ payrollRunId: 'run-1' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('DEDUCTED');
});

// ──────────────────────────────────────────────────────────────────────────────
// Loans
// ──────────────────────────────────────────────────────────────────────────────
test('LN-01 valid loan → 201 with monthlyInstalment', async () => {
  mockLoanFindFirst.mockResolvedValueOnce(null);
  mockLoanCount.mockResolvedValueOnce(0);
  mockLoanCreate.mockResolvedValueOnce(makeLoan());
  const res = await request(app).post('/loans/staff-loans').send({
    principal: 5000, interestRate: 0, tenureMonths: 12,
    monthlySalary: 5000, reason: 'Home repairs',
  });
  expect(res.status).toBe(201);
  expect(mockLoanCreate.mock.calls[0][0].data.monthlyInstalment).toBe(416.67);
});

test('LN-02 affordability fail → 400', async () => {
  const res = await request(app).post('/loans/staff-loans').send({
    principal: 50000, interestRate: 0, tenureMonths: 12,
    monthlySalary: 5000, reason: 'X',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/30%/);
});

test('LN-03 tenure > 60 → 400', async () => {
  const res = await request(app).post('/loans/staff-loans').send({
    principal: 5000, interestRate: 0, tenureMonths: 72,
    monthlySalary: 5000, reason: 'X',
  });
  expect(res.status).toBe(400);
});

test('LN-04 existing ACTIVE blocks new → 409', async () => {
  mockLoanFindFirst.mockResolvedValueOnce(makeLoan({ status: 'ACTIVE' }));
  const res = await request(app).post('/loans/staff-loans').send({
    principal: 5000, tenureMonths: 12, monthlySalary: 5000, reason: 'X',
  });
  expect(res.status).toBe(409);
});

test('LN-05 employee sees only own', async () => {
  mockLoanFindMany.mockResolvedValueOnce([makeLoan()]);
  const res = await request(app).get('/loans/staff-loans');
  expect(res.status).toBe(200);
  expect(mockLoanFindMany.mock.calls[0][0].where.employeeId).toBe('emp-001');
});

test('LN-06 returns outstanding + schedule', async () => {
  mockLoanFindUnique.mockResolvedValueOnce(makeLoan({
    repayments: [{ status: 'PAID', paidAmount: 1000 }],
  }));
  const res = await request(app).get('/loans/staff-loans/ln-001');
  expect(res.status).toBe(200);
  expect(res.body.outstanding).toBe(4000);
  expect(res.body.earlySettlement).toBeDefined();
});

test('LN-07 approve generates schedule + agreement', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'hr-1' });
  mockLoanFindUnique.mockResolvedValueOnce(makeLoan());
  mockLoanUpdate.mockResolvedValueOnce(makeLoan({ status: 'APPROVED', agreementHtml: '<html>...' }));
  mockRepayCreateMany.mockResolvedValueOnce({ count: 12 });
  const res = await request(app).put('/loans/staff-loans/ln-001/approve').send({ startDate: '2026-07-01' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('APPROVED');
  expect(mockRepayCreateMany).toHaveBeenCalled();
});

test('LN-08 400 missing reject reason', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).put('/loans/staff-loans/ln-001/reject').send({});
  expect(res.status).toBe(400);
});

test('LN-09 activate APPROVED → ACTIVE', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockLoanFindUnique.mockResolvedValueOnce(makeLoan({ status: 'APPROVED' }));
  mockLoanUpdate.mockResolvedValueOnce(makeLoan({ status: 'ACTIVE' }));
  const res = await request(app).put('/loans/staff-loans/ln-001/activate').send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ACTIVE');
});

test('LN-10 records repayment + updates outstanding', async () => {
  setUser({ role: 'HR_ADMIN' });
  const repayments = [
    { id: 'r1', paymentNumber: 1, scheduledAmount: 416.67, status: 'PENDING', scheduledDate: new Date() },
    { id: 'r2', paymentNumber: 2, scheduledAmount: 416.67, status: 'PENDING', scheduledDate: new Date() },
  ];
  mockLoanFindUnique.mockResolvedValueOnce(makeLoan({ status: 'ACTIVE', repayments }));
  mockRepayUpdate.mockResolvedValueOnce({ ...repayments[0], status: 'PAID', paidAmount: 416.67 });
  mockRepayFindMany.mockResolvedValueOnce([
    { status: 'PAID', paidAmount: 416.67 },
    { status: 'PENDING', scheduledAmount: 416.67 },
  ]);
  mockLoanUpdate.mockResolvedValueOnce({});
  const res = await request(app).post('/loans/staff-loans/ln-001/repayments').send({ paymentNumber: 1 });
  expect(res.status).toBe(201);
  expect(res.body.outstanding).toBe(4583.33);
});

test('LN-11 final payment marks SETTLED', async () => {
  setUser({ role: 'HR_ADMIN' });
  const repayments = [
    { id: 'r1', paymentNumber: 1, scheduledAmount: 5000, status: 'PENDING', scheduledDate: new Date() },
  ];
  mockLoanFindUnique.mockResolvedValueOnce(makeLoan({ status: 'ACTIVE', repayments }));
  mockRepayUpdate.mockResolvedValueOnce({ ...repayments[0], status: 'PAID', paidAmount: 5000 });
  mockRepayFindMany.mockResolvedValueOnce([{ status: 'PAID', paidAmount: 5000 }]);
  mockLoanUpdate.mockResolvedValueOnce({});
  const res = await request(app).post('/loans/staff-loans/ln-001/repayments').send({ paymentNumber: 1, paidAmount: 5000 });
  expect(res.status).toBe(201);
  expect(res.body.settled).toBe(true);
});

test('LN-12 early settlement waives remaining', async () => {
  const repayments = [
    { id: 'r1', paymentNumber: 1, scheduledAmount: 1000, status: 'PAID', paidAmount: 1000, scheduledDate: new Date() },
    { id: 'r2', paymentNumber: 2, scheduledAmount: 1000, status: 'PENDING', scheduledDate: new Date() },
    { id: 'r3', paymentNumber: 3, scheduledAmount: 1000, status: 'PENDING', scheduledDate: new Date() },
  ];
  mockLoanFindUnique.mockResolvedValueOnce(makeLoan({ status: 'ACTIVE', totalRepayable: 3000, repayments }));
  mockRepayCreate.mockResolvedValueOnce({ id: 'rs', paymentNumber: 4, status: 'PAID' });
  mockRepayUpdateMany.mockResolvedValueOnce({ count: 2 });
  mockLoanUpdate.mockResolvedValueOnce(makeLoan({ status: 'SETTLED', outstandingBalance: 0 }));
  const res = await request(app).post('/loans/staff-loans/ln-001/settle').send({});
  expect(res.status).toBe(200);
  expect(res.body.loan.status).toBe('SETTLED');
});

test('LN-13 agreement auto-generates if missing', async () => {
  mockLoanFindUnique.mockResolvedValueOnce(makeLoan({ agreementHtml: null }));
  mockLoanUpdate.mockResolvedValueOnce({});
  const res = await request(app).get('/loans/staff-loans/ln-001/agreement').send();
  expect(res.status).toBe(200);
  expect(res.body.html).toContain('Alice Tan');
});

// ──────────────────────────────────────────────────────────────────────────────
// Dashboard & Termination
// ──────────────────────────────────────────────────────────────────────────────
test('DB-01 HR/Finance sees aggregate', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockLoanFindMany.mockResolvedValueOnce([
    makeLoan({ status: 'ACTIVE', principal: 5000, outstandingBalance: 4000 }),
    makeLoan({ id: 'ln-2', status: 'SETTLED', outstandingBalance: 0 }),
  ]);
  mockAdvFindMany.mockResolvedValueOnce([makeAdvance({ status: 'APPROVED', amount: 1000 })]);
  const res = await request(app).get('/loans/dashboard');
  expect(res.status).toBe(200);
  expect(res.body.loans.totalOutstanding).toBe(4000);
  expect(res.body.advances.approved).toBe(1);
});

test('TD-01 termination-deductions totals active loans + advances', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockLoanFindMany.mockResolvedValueOnce([
    makeLoan({ status: 'ACTIVE', outstandingBalance: 3000, loanNumber: 'LN-2026-00001' }),
  ]);
  mockAdvFindMany.mockResolvedValueOnce([
    makeAdvance({ status: 'APPROVED', amount: 1500, advanceNumber: 'ADV-2026-00005' }),
  ]);
  const res = await request(app).get('/loans/termination-deductions/emp-001');
  expect(res.status).toBe(200);
  expect(res.body.totalOutstanding).toBe(4500);
  expect(res.body.mustDeductFromFinalPay).toBe(true);
});
