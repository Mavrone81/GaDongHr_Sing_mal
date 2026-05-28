'use strict';
/**
 * Security regression test for C-17:
 *   POST /loans/advances and /loans/staff-loans must ignore body.monthlySalary
 *   and fetch the authoritative salary from employee-service. This closes the
 *   "I claim a SGD 50 000 salary so I can take a SGD 50 000 advance" attack.
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
const mockAdvFindFirst  = jest.fn().mockResolvedValue(null);
const mockAdvCount      = jest.fn().mockResolvedValue(0);
const mockLoanCreate    = jest.fn();
const mockLoanFindFirst = jest.fn().mockResolvedValue(null);
const mockLoanCount     = jest.fn().mockResolvedValue(0);

// H-21: loans-service now uses DB SEQUENCE via $queryRawUnsafe.
let _seqCounter = 0;
const mockQueryRawUnsafe = jest.fn(async (sql) => {
  if (sql && sql.includes("nextval")) return [{ n: ++_seqCounter }];
  return [];
});
const mockExecuteRawUnsafe = jest.fn().mockResolvedValue(0);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    salaryAdvance: { create: mockAdvCreate, findUnique: jest.fn(), findFirst: mockAdvFindFirst, findMany: jest.fn(), update: jest.fn(), count: mockAdvCount },
    staffLoan: { create: mockLoanCreate, findUnique: jest.fn(), findFirst: mockLoanFindFirst, findMany: jest.fn(), update: jest.fn(), count: mockLoanCount },
    loanRepayment: { create: jest.fn(), createMany: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    $queryRawUnsafe: mockQueryRawUnsafe,
    $executeRawUnsafe: mockExecuteRawUnsafe,
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

process.env.INTERNAL_SERVICE_KEY = 'test-key';

// Per-test overridable fetch mock that records the URL hit.
const fetchCalls = [];
global.fetch = jest.fn().mockImplementation(async (url) => {
  fetchCalls.push(url);
  if (typeof url === 'string' && url.includes('/internal/monthly-salary')) {
    // canonical salary: SGD 3000/mo
    return { ok: true, json: async () => ({ monthlySalary: 3000, isActive: true, salaryBasis: 'MONTHLY' }) };
  }
  return { ok: true, json: async () => ({}) };
});

const request = require('supertest');
const app = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  fetchCalls.length = 0;
  setUser({ sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE', name: 'Alice Tan' });
});

// ── advances ──────────────────────────────────────────────────────────────────

test('C17-adv-01 body.monthlySalary is IGNORED — server-side salary is used', async () => {
  mockAdvCreate.mockResolvedValueOnce({ id: 'a-1', monthlySalary: 3000 });

  const res = await request(app).post('/loans/advances').send({
    amount: 2500,
    monthlySalary: 100000,   // attacker-inflated value — should be ignored
    reason: 'attempt',
  });
  // 2500 ≤ 1× canonical 3000 → OK
  expect(res.status).toBe(201);
  // Salary lookup was hit
  expect(fetchCalls.some(u => typeof u === 'string' && u.includes('/internal/monthly-salary'))).toBe(true);
  // Persisted monthlySalary is the canonical 3000, not the inflated body value
  expect(mockAdvCreate.mock.calls[0][0].data.monthlySalary).toBe(3000);
});

test('C17-adv-02 cannot exceed canonical 1× salary even if body claims more', async () => {
  const res = await request(app).post('/loans/advances').send({
    amount: 9000,                       // 3× canonical salary
    monthlySalary: 100000,              // claim inflated salary in body
    reason: 'attempted overshoot',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/Amount exceeds 1× monthly salary/);
  expect(mockAdvCreate).not.toHaveBeenCalled();
});

test('C17-adv-03 502 if employee-service is unreachable', async () => {
  global.fetch = jest.fn().mockImplementation(async () => { throw new Error('ECONNREFUSED'); });

  const res = await request(app).post('/loans/advances').send({
    amount: 100,
    reason: 'x',
  });
  expect(res.status).toBe(502);
});

// ── loans ─────────────────────────────────────────────────────────────────────

test('C17-loan-01 body.monthlySalary is IGNORED on staff-loans', async () => {
  // restore the standard mock (the previous test overrode it)
  global.fetch = jest.fn().mockImplementation(async (url) => {
    if (typeof url === 'string' && url.includes('/internal/monthly-salary')) {
      return { ok: true, json: async () => ({ monthlySalary: 3000, isActive: true, salaryBasis: 'MONTHLY' }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  mockLoanCreate.mockResolvedValueOnce({ id: 'l-1', monthlySalary: 3000 });

  const res = await request(app).post('/loans/staff-loans').send({
    principal: 5000,           // small enough that 30% of 3000 caps it
    interestRate: 0,
    tenureMonths: 36,          // 5000/36 ≈ 138.89/mo, well under 30% of 3000 = 900
    monthlySalary: 100000,     // attacker-inflated value — should be ignored
    reason: 'home repair',
  });
  expect(res.status).toBe(201);
  expect(mockLoanCreate.mock.calls[0][0].data.monthlySalary).toBe(3000);
});

test('C17-loan-02 affordability cap (30%) applied against canonical salary', async () => {
  global.fetch = jest.fn().mockImplementation(async () => ({
    ok: true, json: async () => ({ monthlySalary: 3000, isActive: true, salaryBasis: 'MONTHLY' }),
  }));
  const res = await request(app).post('/loans/staff-loans').send({
    principal: 50000,
    interestRate: 0,
    tenureMonths: 12,                  // 50000/12 ≈ 4167 > 30% of 3000 = 900
    monthlySalary: 100000,             // body claims more, should be ignored
    reason: 'overshoot',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/exceeds 30%/i);
});
