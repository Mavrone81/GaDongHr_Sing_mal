'use strict';
/**
 * A2 — GET /employees/payroll-data must never default a missing citizenship
 * status or date of birth.
 *
 * Before this, employee.routes.js (`/payroll-data`) silently substituted
 * `citizenStatus: emp.citizenshipStatus || 'SC'` and
 * `age = emp.dateOfBirth ? ... : 35` — both perfectly ordinary, common
 * values. That's what defeated the CPF band fail-closed check downstream in
 * statutory-sg-service (statutory.routes.js:72-78): a missing value never
 * looked missing by the time it got there, because 'SC' at age 35 matches a
 * real band every time. Confirmed by FullStack in
 * reviews/section-fullstack.md ("Age/citizenship defaulting — CONFIRMED").
 *
 * This asserts the endpoint reports a missing value as missing (null), not
 * as a plausible default — the fix that actually lets the downstream
 * fail-closed logic do its job.
 */

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'PAYROLL_OFFICER', tenantId: 'ten-1' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER', LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER' },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encryptFields: (obj) => obj,
  decrypt: (val) => val,
}), { virtual: true });

const mockFindMany = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    employee: { findMany: mockFindMany },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

const request = require('supertest');
const app = require('../src/index');

afterEach(() => jest.clearAllMocks());

function makeEmployee(overrides = {}) {
  return {
    id: 'emp-001', employeeCode: 'EMP-001', fullName: 'Alice Tan', department: 'Engineering',
    citizenshipStatus: 'SC', dateOfBirth: new Date('1990-01-01'),
    startDate: new Date('2020-01-01'), endDate: null,
    basicSalaryEncrypted: null, salaryBasis: 'MONTHLY',
    bankName: 'DBS', bankCode: '7171', bankBranchCode: '001', bankAccountEncrypted: null,
    ...overrides,
  };
}

describe('GET /employees/payroll-data — citizenship/DOB fail-closed (A2)', () => {
  test('a complete profile is returned as-is', async () => {
    mockFindMany.mockResolvedValue([makeEmployee()]);

    const res = await request(app).get('/employees/payroll-data');

    expect(res.status).toBe(200);
    expect(res.body[0].citizenStatus).toBe('SC');
    expect(res.body[0].age).not.toBeNull();
  });

  test('missing citizenshipStatus comes back null, never silently "SC"', async () => {
    mockFindMany.mockResolvedValue([makeEmployee({ citizenshipStatus: null })]);

    const res = await request(app).get('/employees/payroll-data');

    expect(res.status).toBe(200);
    // Pre-fix this was exactly 'SC' — a real, common value — which is exactly
    // what let a missing value slip past the downstream CPF band fail-closed
    // check undetected.
    expect(res.body[0].citizenStatus).toBeNull();
  });

  test('missing dateOfBirth comes back a null age, never silently 35', async () => {
    mockFindMany.mockResolvedValue([makeEmployee({ dateOfBirth: null })]);

    const res = await request(app).get('/employees/payroll-data');

    expect(res.status).toBe(200);
    expect(res.body[0].age).toBeNull();
  });
});
