'use strict';
/**
 * Integration tests: ESV-001 — Staff Movement & Internal Transfer
 *
 * Initiate
 *   MV-01  POST /movements — HR initiates DEPARTMENT_TRANSFER → 201 with movementNumber
 *   MV-02  POST /movements — 404 when employee missing
 *   MV-03  POST /movements — 400 when reason missing
 *   MV-04  POST /movements — 400 no-op (no fields changed)
 *   MV-05  POST /movements — ROLE_CHANGE with salary revision attaches encrypted salary
 *   MV-06  POST /movements — employee can self-initiate
 *   MV-07  POST /movements — random employee cannot initiate for another
 *
 * List & detail
 *   MV-08  GET  /movements — employee sees only own
 *   MV-09  GET  /movements — HR sees all with summary
 *   MV-10  GET  /movements/:id — HR sees detail
 *   MV-11  GET  /movements/:id — employee blocked from another's
 *
 * Approval / Reject / Cancel
 *   MV-12  PUT  /movements/:id/approve — HR_ADMIN approves
 *   MV-13  PUT  /movements/:id/approve — HR_ADMIN blocked when HR_MANAGER required
 *   MV-14  PUT  /movements/:id/approve — 409 not PENDING
 *   MV-15  PUT  /movements/:id/reject — HR rejects
 *   MV-16  PUT  /movements/:id/reject — 400 missing reason
 *   MV-17  PUT  /movements/:id/cancel — initiator cancels
 *
 * Apply / Sweep
 *   MV-18  POST /movements/:id/apply — applies APPROVED + effectiveToday
 *   MV-19  POST /movements/:id/apply — 409 if effectiveDate in future
 *   MV-20  POST /movements/sweep — applies all due movements
 *
 * Summary / Letter
 *   MV-21  GET  /movements/summary — HR aggregate
 *   MV-22  GET  /movements/:id/letter — auto-generates if missing
 */

let mockUser = { sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE', name: 'Alice Tan' };
const setUser = u => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

// Crypto mock — encryptFields returns plain values prefixed; decrypt strips prefix
jest.mock('/app/shared/crypto', () => ({
  encryptFields: (obj, fields) => {
    const out = { ...obj };
    for (const f of fields) if (out[f] !== undefined) out[f] = `ENC:${out[f]}`;
    return out;
  },
  decrypt: v => v && v.startsWith('ENC:') ? v.slice(4) : v,
}), { virtual: true });

const mockEmpFindUnique = jest.fn();
const mockEmpUpdate     = jest.fn();
const mockMovCreate     = jest.fn();
const mockMovFindUnique = jest.fn();
const mockMovFindMany   = jest.fn();
const mockMovUpdate     = jest.fn();
const mockMovCount      = jest.fn();
const mockSalHistCreate = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    employee: { findUnique: mockEmpFindUnique, update: mockEmpUpdate },
    staffMovement: {
      create: mockMovCreate, findUnique: mockMovFindUnique,
      findMany: mockMovFindMany, update: mockMovUpdate, count: mockMovCount,
    },
    salaryHistory: { create: mockSalHistCreate },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

const request = require('supertest');

// Standalone Express app — mount movement routes only (avoids index.js side effects)
const express = require('express');
const movementRoutes = require('../src/routes/movement.routes');
const app = express();
app.use(express.json());
app.use('/movements', movementRoutes);

function makeEmployee(o = {}) {
  return {
    id: 'emp-001', fullName: 'Alice Tan', employeeCode: 'EMP-0001',
    department: 'Engineering', designation: 'Engineer',
    costCentre: 'CC-ENG', reportingManagerId: 'mgr-1',
    employmentType: 'FULL_TIME',
    basicSalaryEncrypted: 'ENC:5000',
    isActive: true,
    ...o,
  };
}

function makeMovement(o = {}) {
  return {
    id: 'mov-001', movementNumber: 'MOV-2026-00001', employeeId: 'emp-001',
    employeeName: 'Alice Tan', type: 'DEPARTMENT_TRANSFER',
    status: 'PENDING',
    fromDepartment: 'Engineering', toDepartment: 'Product',
    fromDesignation: 'Engineer', toDesignation: 'Engineer',
    fromCostCentre: 'CC-ENG', toCostCentre: 'CC-ENG',
    fromLocation: null, toLocation: null,
    fromReportingManagerId: 'mgr-1', toReportingManagerId: 'mgr-1',
    fromCompany: null, toCompany: null,
    fromEmploymentType: 'FULL_TIME', toEmploymentType: 'FULL_TIME',
    hasSalaryRevision: false, fromSalaryEnc: null, toSalaryEnc: null,
    salaryReasonCode: null,
    reason: 'Better skill fit',
    effectiveDate: new Date(Date.now() + 7 * 86_400_000),
    initiatedBy: 'hr-1', initiatedByName: 'HR User', initiatedByRole: 'HR_ADMIN',
    approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null,
    rejectionReason: null, cancelledAt: null, appliedAt: null,
    letterHtml: null, letterGeneratedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...o,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE', name: 'Alice Tan' });
});

// ──────────────────────────────────────────────────────────────────────────────
// Initiate
// ──────────────────────────────────────────────────────────────────────────────
test('MV-01 HR initiates DEPARTMENT_TRANSFER → 201', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'hr-1' });
  mockMovCount.mockResolvedValueOnce(0);
  mockEmpFindUnique.mockResolvedValueOnce(makeEmployee());
  mockMovCreate.mockResolvedValueOnce(makeMovement());
  const res = await request(app).post('/movements').send({
    employeeId: 'emp-001', type: 'DEPARTMENT_TRANSFER',
    toDepartment: 'Product', reason: 'Better skill fit',
    effectiveDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  expect(res.status).toBe(201);
  expect(mockMovCreate.mock.calls[0][0].data.movementNumber).toBe('MOV-2026-00001');
});

test('MV-02 404 when employee missing', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEmpFindUnique.mockResolvedValueOnce(null);
  const res = await request(app).post('/movements').send({
    employeeId: 'nope', type: 'DEPARTMENT_TRANSFER', toDepartment: 'X',
    reason: 'X', effectiveDate: new Date().toISOString(),
  });
  expect(res.status).toBe(404);
});

test('MV-03 400 when reason missing', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).post('/movements').send({
    employeeId: 'emp-001', type: 'DEPARTMENT_TRANSFER',
    toDepartment: 'X', effectiveDate: new Date().toISOString(),
  });
  expect(res.status).toBe(400);
});

test('MV-04 400 no-op', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEmpFindUnique.mockResolvedValueOnce(makeEmployee({ department: 'Engineering' }));
  const res = await request(app).post('/movements').send({
    employeeId: 'emp-001', type: 'DEPARTMENT_TRANSFER',
    toDepartment: 'Engineering', // same as current
    reason: 'X', effectiveDate: new Date().toISOString(),
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/no-op|change/i);
});

test('MV-05 ROLE_CHANGE with salary revision encrypts salary fields', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'hr-1' });
  mockMovCount.mockResolvedValueOnce(0);
  mockEmpFindUnique.mockResolvedValueOnce(makeEmployee());
  mockMovCreate.mockResolvedValueOnce(makeMovement({ hasSalaryRevision: true, fromSalaryEnc: 'ENC:5000', toSalaryEnc: 'ENC:5500' }));
  const res = await request(app).post('/movements').send({
    employeeId: 'emp-001', type: 'ROLE_CHANGE',
    toDesignation: 'Senior Engineer', reason: 'Promotion',
    effectiveDate: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    hasSalaryRevision: true, toSalary: 5500, salaryReasonCode: 'PROMOTION',
  });
  expect(res.status).toBe(201);
  expect(mockMovCreate.mock.calls[0][0].data.fromSalaryEnc).toMatch(/^ENC:/);
  expect(mockMovCreate.mock.calls[0][0].data.toSalaryEnc).toMatch(/^ENC:/);
});

test('MV-06 employee can self-initiate', async () => {
  mockMovCount.mockResolvedValueOnce(0);
  mockEmpFindUnique.mockResolvedValueOnce(makeEmployee());
  mockMovCreate.mockResolvedValueOnce(makeMovement({ initiatedBy: 'emp-001' }));
  const res = await request(app).post('/movements').send({
    employeeId: 'emp-001', type: 'DEPARTMENT_TRANSFER',
    toDepartment: 'Product', reason: 'Career move',
    effectiveDate: new Date(Date.now() + 21 * 86_400_000).toISOString(),
  });
  expect(res.status).toBe(201);
});

test('MV-07 random employee cannot initiate for another', async () => {
  mockEmpFindUnique.mockResolvedValueOnce(makeEmployee({ id: 'emp-999' }));
  const res = await request(app).post('/movements').send({
    employeeId: 'emp-999', type: 'DEPARTMENT_TRANSFER',
    toDepartment: 'Product', reason: 'X',
    effectiveDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  expect(res.status).toBe(403);
});

// ──────────────────────────────────────────────────────────────────────────────
// List & detail
// ──────────────────────────────────────────────────────────────────────────────
test('MV-08 employee sees only own', async () => {
  mockMovFindMany.mockResolvedValueOnce([makeMovement()]);
  const res = await request(app).get('/movements');
  expect(res.status).toBe(200);
  expect(mockMovFindMany.mock.calls[0][0].where.employeeId).toBe('emp-001');
});

test('MV-09 HR sees all with summary', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockMovFindMany.mockResolvedValueOnce([makeMovement({ status: 'APPROVED' }), makeMovement({ id: 'm2', status: 'APPLIED' })]);
  const res = await request(app).get('/movements');
  expect(res.status).toBe(200);
  expect(res.body.summary).toBeDefined();
  expect(res.body.summary.total).toBe(2);
});

test('MV-10 HR sees detail', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockMovFindUnique.mockResolvedValueOnce(makeMovement());
  const res = await request(app).get('/movements/mov-001');
  expect(res.status).toBe(200);
  expect(res.body.additionalApproval).toBeDefined();
});

test('MV-11 employee blocked from another\'s', async () => {
  mockMovFindUnique.mockResolvedValueOnce(makeMovement({ employeeId: 'emp-999', initiatedBy: 'someone-else' }));
  const res = await request(app).get('/movements/mov-001');
  expect(res.status).toBe(403);
});

// ──────────────────────────────────────────────────────────────────────────────
// Approval / Reject / Cancel
// ──────────────────────────────────────────────────────────────────────────────
test('MV-12 HR_ADMIN approves', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'hr-1' });
  mockMovFindUnique.mockResolvedValueOnce(makeMovement());
  mockMovUpdate.mockResolvedValueOnce(makeMovement({ status: 'APPROVED' }));
  const res = await request(app).put('/movements/mov-001/approve').send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('APPROVED');
});

test('MV-13 HR_ADMIN blocked when HR_MANAGER required (large salary jump)', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'hr-1' });
  mockMovFindUnique.mockResolvedValueOnce(makeMovement({
    type: 'PROMOTION', hasSalaryRevision: true,
    fromSalaryEnc: 'ENC:5000', toSalaryEnc: 'ENC:8000', // +60%
  }));
  const res = await request(app).put('/movements/mov-001/approve').send({});
  expect(res.status).toBe(403);
  expect(res.body.error).toMatch(/HR_MANAGER/);
});

test('MV-14 409 not PENDING', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockMovFindUnique.mockResolvedValueOnce(makeMovement({ status: 'APPROVED' }));
  const res = await request(app).put('/movements/mov-001/approve').send({});
  expect(res.status).toBe(409);
});

test('MV-15 HR rejects', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockMovFindUnique.mockResolvedValueOnce(makeMovement());
  mockMovUpdate.mockResolvedValueOnce(makeMovement({ status: 'REJECTED' }));
  const res = await request(app).put('/movements/mov-001/reject').send({ rejectionReason: 'Headcount frozen' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('REJECTED');
});

test('MV-16 400 missing reject reason', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).put('/movements/mov-001/reject').send({});
  expect(res.status).toBe(400);
});

test('MV-17 initiator cancels', async () => {
  setUser({ sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE' });
  mockMovFindUnique.mockResolvedValueOnce(makeMovement({ initiatedBy: 'emp-001' }));
  mockMovUpdate.mockResolvedValueOnce(makeMovement({ status: 'CANCELLED' }));
  const res = await request(app).put('/movements/mov-001/cancel').send({});
  expect(res.status).toBe(200);
});

// ──────────────────────────────────────────────────────────────────────────────
// Apply / Sweep
// ──────────────────────────────────────────────────────────────────────────────
test('MV-18 applies APPROVED + effectiveToday', async () => {
  setUser({ role: 'HR_ADMIN' });
  const past = new Date(Date.now() - 86_400_000);
  mockMovFindUnique.mockResolvedValueOnce(makeMovement({ status: 'APPROVED', effectiveDate: past }));
  mockEmpUpdate.mockResolvedValueOnce({});
  mockMovUpdate.mockResolvedValueOnce(makeMovement({ status: 'APPLIED', appliedAt: new Date() }));
  // Second findUnique after apply
  mockMovFindUnique.mockResolvedValueOnce(makeMovement({ status: 'APPLIED', appliedAt: new Date() }));
  const res = await request(app).post('/movements/mov-001/apply').send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('APPLIED');
});

test('MV-19 409 if effectiveDate in future', async () => {
  setUser({ role: 'HR_ADMIN' });
  const future = new Date(Date.now() + 30 * 86_400_000);
  mockMovFindUnique.mockResolvedValueOnce(makeMovement({ status: 'APPROVED', effectiveDate: future }));
  const res = await request(app).post('/movements/mov-001/apply').send({});
  expect(res.status).toBe(409);
});

test('MV-20 sweep applies all due movements', async () => {
  setUser({ role: 'HR_ADMIN' });
  const past = new Date(Date.now() - 86_400_000);
  mockMovFindMany.mockResolvedValueOnce([
    makeMovement({ id: 'm1', effectiveDate: past }),
    makeMovement({ id: 'm2', effectiveDate: past }),
  ]);
  mockEmpUpdate.mockResolvedValue({});
  mockMovUpdate.mockResolvedValue({});
  const res = await request(app).post('/movements/sweep').send({});
  expect(res.status).toBe(200);
  expect(res.body.applied).toBe(2);
});

// ──────────────────────────────────────────────────────────────────────────────
// Summary / Letter
// ──────────────────────────────────────────────────────────────────────────────
test('MV-21 HR summary aggregate', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockMovFindMany.mockResolvedValueOnce([
    makeMovement({ status: 'PENDING' }),
    makeMovement({ id: 'm2', status: 'APPROVED' }),
  ]);
  const res = await request(app).get('/movements/summary');
  expect(res.status).toBe(200);
  expect(res.body.summary.pending).toBe(1);
  expect(res.body.summary.approved).toBe(1);
});

test('MV-22 letter auto-generates if missing', async () => {
  mockMovFindUnique.mockResolvedValueOnce(makeMovement({ letterHtml: null }));
  mockMovUpdate.mockResolvedValueOnce({});
  const res = await request(app).get('/movements/mov-001/letter');
  expect(res.status).toBe(200);
  expect(res.body.html).toContain('Alice Tan');
});
