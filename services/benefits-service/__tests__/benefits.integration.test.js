'use strict';
/**
 * Integration tests: BEN-001 — Group Insurance & Medical Benefits
 *
 * Plans
 *   PL-01  POST /benefits/plans — HR creates → 201
 *   PL-02  POST /benefits/plans — 400 when code missing
 *   PL-03  POST /benefits/plans — 400 when type invalid
 *   PL-04  POST /benefits/plans — 409 duplicate code
 *   PL-05  GET  /benefits/plans — employee sees only active
 *   PL-06  PUT  /benefits/plans/:id — HR updates → 200
 *   PL-07  DELETE /benefits/plans/:id — 409 when active enrollments exist
 *   PL-08  DELETE /benefits/plans/:id — soft-deletes (isActive=false) when no active enrollments
 *
 * Enrollments
 *   EN-01  POST /benefits/enrollments — HR enrolls employee → 201 with snapshot premium
 *   EN-02  POST /benefits/enrollments — 404 when plan missing
 *   EN-03  POST /benefits/enrollments — 409 duplicate active enrollment
 *   EN-04  POST /benefits/enrollments — employee can self-enroll during open window
 *   EN-05  POST /benefits/enrollments — employee blocked outside open window
 *   EN-06  GET  /benefits/enrollments — employee sees only own
 *   EN-07  GET  /benefits/enrollments — HR sees all with summary
 *   EN-08  PUT  /benefits/enrollments/:id/cancel — own enrollment can be cancelled
 *   EN-09  PUT  /benefits/enrollments/:id/cancel — 400 missing reason
 *   EN-10  PUT  /benefits/enrollments/:id/cancel — 409 already cancelled
 *
 * Dependents
 *   DP-01  POST /benefits/dependents — employee creates own → 201
 *   DP-02  POST /benefits/dependents — 400 invalid relationship
 *   DP-03  GET  /benefits/dependents — employee sees only own
 *
 * Claims
 *   CL-01  POST /benefits/claims — employee submits → 201 with claim number
 *   CL-02  POST /benefits/claims — 409 exceeds coverage
 *   CL-03  POST /benefits/claims — 400 missing claimAmount
 *   CL-04  PUT  /benefits/claims/:id/approve — HR approves → 200
 *   CL-05  PUT  /benefits/claims/:id/approve — 409 already approved
 *   CL-06  PUT  /benefits/claims/:id/reject — 400 missing reason
 *   CL-07  PUT  /benefits/claims/:id/reimburse — Finance reimburses APPROVED claim
 *   CL-08  PUT  /benefits/claims/:id/reimburse — 409 if not APPROVED
 *
 * Open Enrollment
 *   OE-01  POST /benefits/open-enrollment — HR creates → 201
 *   OE-02  GET  /benefits/open-enrollment/current — returns active window
 *   OE-03  PUT  /benefits/open-enrollment/:id/close — HR closes → 200
 *
 * Dashboard / Reconciliation
 *   DB-01  GET  /benefits/dashboard — HR sees aggregate stats
 *   RC-01  GET  /benefits/reconciliation — variance vs insurer billing
 *   RC-02  GET  /benefits/reconciliation — 400 missing planId
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
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

const mockPlanCreate     = jest.fn();
const mockPlanFindUnique = jest.fn();
const mockPlanFindMany   = jest.fn();
const mockPlanUpdate     = jest.fn();
const mockEnrollCreate     = jest.fn();
const mockEnrollFindUnique = jest.fn();
const mockEnrollFindFirst  = jest.fn();
const mockEnrollFindMany   = jest.fn();
const mockEnrollUpdate     = jest.fn();
const mockEnrollCount      = jest.fn();
const mockDepCreate        = jest.fn();
const mockDepFindUnique    = jest.fn();
const mockDepFindMany      = jest.fn();
const mockDepUpdate        = jest.fn();
const mockClaimCreate      = jest.fn();
const mockClaimFindUnique  = jest.fn();
const mockClaimFindMany    = jest.fn();
const mockClaimUpdate      = jest.fn();
const mockClaimCount       = jest.fn();
const mockPeriodCreate     = jest.fn();
const mockPeriodFindFirst  = jest.fn();
const mockPeriodFindMany   = jest.fn();
const mockPeriodUpdate     = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    insurancePlan: {
      create: mockPlanCreate, findUnique: mockPlanFindUnique,
      findMany: mockPlanFindMany, update: mockPlanUpdate,
    },
    employeeEnrollment: {
      create: mockEnrollCreate, findUnique: mockEnrollFindUnique,
      findFirst: mockEnrollFindFirst, findMany: mockEnrollFindMany,
      update: mockEnrollUpdate, count: mockEnrollCount,
    },
    dependent: {
      create: mockDepCreate, findUnique: mockDepFindUnique,
      findMany: mockDepFindMany, update: mockDepUpdate,
    },
    insuranceClaim: {
      create: mockClaimCreate, findUnique: mockClaimFindUnique,
      findMany: mockClaimFindMany, update: mockClaimUpdate, count: mockClaimCount,
    },
    openEnrollmentPeriod: {
      create: mockPeriodCreate, findFirst: mockPeriodFindFirst,
      findMany: mockPeriodFindMany, update: mockPeriodUpdate,
    },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

const request = require('supertest');
const app     = require('../src/index');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makePlan(o = {}) {
  return {
    id: 'plan-001', code: 'GHS-STD', name: 'GHS Standard', type: 'GHS',
    insurerName: 'AIA', insurerContact: null, policyNumber: 'POL-001',
    coverageAmount: 50000, premiumEmployer: 500, premiumEmployee: 0,
    premiumDependent: 100, bikTaxable: false, eligibilityGrades: [],
    minTenureMonths: 0, coversDependents: true, effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null, isActive: true, description: 'Standard hospital plan',
    createdBy: 'hr-1', updatedBy: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...o,
  };
}

function makeEnrollment(o = {}) {
  return {
    id: 'enr-001', employeeId: 'emp-001', employeeName: 'Alice Tan',
    employeeGrade: 'MGR', planId: 'plan-001', status: 'ACTIVE',
    enrollmentSource: 'MANUAL', policyMemberNumber: null,
    effectiveFrom: new Date('2026-01-01'), effectiveTo: null,
    cancelledAt: null, cancelReason: null, enrolledDependentIds: [],
    annualPremiumEmployer: 500, annualPremiumEmployee: 0,
    createdBy: 'hr-1', createdAt: new Date(), updatedAt: new Date(),
    plan: makePlan(), ...o,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE', name: 'Alice Tan' });
});

// ──────────────────────────────────────────────────────────────────────────────
// Plans
// ──────────────────────────────────────────────────────────────────────────────
test('PL-01 HR creates plan → 201', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockPlanCreate.mockResolvedValueOnce(makePlan());
  const res = await request(app).post('/benefits/plans').send({
    code: 'ghs-std', name: 'GHS Standard', type: 'GHS', insurerName: 'AIA',
    coverageAmount: 50000, premiumEmployer: 500, effectiveFrom: '2026-01-01',
  });
  expect(res.status).toBe(201);
  expect(res.body.code).toBe('GHS-STD'); // uppercase normalised
});

test('PL-02 400 when code missing', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).post('/benefits/plans').send({
    name: 'Test', type: 'GHS', insurerName: 'AIA',
    coverageAmount: 50000, premiumEmployer: 500, effectiveFrom: '2026-01-01',
  });
  expect(res.status).toBe(400);
});

test('PL-03 400 when type invalid', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).post('/benefits/plans').send({
    code: 'X', name: 'X', type: 'INVALID', insurerName: 'AIA',
    coverageAmount: 1, premiumEmployer: 1, effectiveFrom: '2026-01-01',
  });
  expect(res.status).toBe(400);
});

test('PL-04 409 duplicate code', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockPlanCreate.mockRejectedValueOnce({ code: 'P2002' });
  const res = await request(app).post('/benefits/plans').send({
    code: 'GHS-STD', name: 'GHS Standard', type: 'GHS', insurerName: 'AIA',
    coverageAmount: 50000, premiumEmployer: 500, effectiveFrom: '2026-01-01',
  });
  expect(res.status).toBe(409);
});

test('PL-05 employee sees only active plans', async () => {
  mockPlanFindMany.mockResolvedValueOnce([makePlan()]);
  const res = await request(app).get('/benefits/plans');
  expect(res.status).toBe(200);
  expect(mockPlanFindMany.mock.calls[0][0].where.isActive).toBe(true);
});

test('PL-06 HR updates plan → 200', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockPlanUpdate.mockResolvedValueOnce(makePlan({ premiumEmployer: 600 }));
  const res = await request(app).put('/benefits/plans/plan-001').send({ premiumEmployer: 600 });
  expect(res.status).toBe(200);
  expect(res.body.premiumEmployer).toBe(600);
});

test('PL-07 409 when active enrollments exist on delete', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEnrollCount.mockResolvedValueOnce(3);
  const res = await request(app).delete('/benefits/plans/plan-001');
  expect(res.status).toBe(409);
});

test('PL-08 soft-deletes when no active enrollments', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEnrollCount.mockResolvedValueOnce(0);
  mockPlanUpdate.mockResolvedValueOnce(makePlan({ isActive: false }));
  const res = await request(app).delete('/benefits/plans/plan-001');
  expect(res.status).toBe(200);
  expect(res.body.isActive).toBe(false);
});

// ──────────────────────────────────────────────────────────────────────────────
// Enrollments
// ──────────────────────────────────────────────────────────────────────────────
test('EN-01 HR enrolls employee → 201 with snapshot premium', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'hr-1' });
  mockPlanFindUnique.mockResolvedValueOnce(makePlan());
  mockEnrollFindFirst.mockResolvedValueOnce(null);
  mockEnrollCreate.mockResolvedValueOnce(makeEnrollment({ annualPremiumEmployer: 700 }));
  const res = await request(app).post('/benefits/enrollments').send({
    employeeId: 'emp-002', employeeName: 'Bob', planId: 'plan-001',
    effectiveFrom: '2026-02-01', dependentIds: ['dep-1', 'dep-2'],
  });
  expect(res.status).toBe(201);
  // 500 + 2 * 100
  expect(mockEnrollCreate.mock.calls[0][0].data.annualPremiumEmployer).toBe(700);
});

test('EN-02 404 when plan missing', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockPlanFindUnique.mockResolvedValueOnce(null);
  const res = await request(app).post('/benefits/enrollments').send({
    planId: 'missing', effectiveFrom: '2026-01-01', employeeId: 'emp-002',
  });
  expect(res.status).toBe(404);
});

test('EN-03 409 duplicate active enrollment', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockPlanFindUnique.mockResolvedValueOnce(makePlan());
  mockEnrollFindFirst.mockResolvedValueOnce(makeEnrollment());
  const res = await request(app).post('/benefits/enrollments').send({
    planId: 'plan-001', effectiveFrom: '2026-01-01', employeeId: 'emp-001',
  });
  expect(res.status).toBe(409);
});

test('EN-04 employee self-enrolls during open window', async () => {
  // open enrollment lookup first
  mockPeriodFindFirst.mockResolvedValueOnce({
    id: 'oep-1', status: 'ACTIVE',
    startDate: new Date(Date.now() - 86400000),
    endDate:   new Date(Date.now() + 86400000),
    planIds: ['plan-001'],
  });
  mockPlanFindUnique.mockResolvedValueOnce(makePlan());
  mockEnrollFindFirst.mockResolvedValueOnce(null);
  mockEnrollCreate.mockResolvedValueOnce(makeEnrollment());
  const res = await request(app).post('/benefits/enrollments').send({
    planId: 'plan-001', effectiveFrom: '2026-02-01',
  });
  expect(res.status).toBe(201);
});

test('EN-05 employee blocked outside open window', async () => {
  mockPeriodFindFirst.mockResolvedValueOnce(null);
  const res = await request(app).post('/benefits/enrollments').send({
    planId: 'plan-001', effectiveFrom: '2026-02-01',
  });
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/open enrollment/i);
});

test('EN-06 employee sees only own enrollments', async () => {
  mockEnrollFindMany.mockResolvedValueOnce([makeEnrollment()]);
  const res = await request(app).get('/benefits/enrollments');
  expect(res.status).toBe(200);
  expect(mockEnrollFindMany.mock.calls[0][0].where.employeeId).toBe('emp-001');
});

test('EN-07 HR sees all enrollments with summary', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEnrollFindMany.mockResolvedValueOnce([
    makeEnrollment({ id: 'e1', status: 'ACTIVE'    }),
    makeEnrollment({ id: 'e2', status: 'CANCELLED' }),
  ]);
  const res = await request(app).get('/benefits/enrollments');
  expect(res.status).toBe(200);
  expect(res.body.summary.total).toBe(2);
  expect(res.body.summary.active).toBe(1);
  expect(res.body.summary.cancelled).toBe(1);
});

test('EN-08 employee cancels own enrollment', async () => {
  mockEnrollFindUnique.mockResolvedValueOnce(makeEnrollment());
  mockEnrollUpdate.mockResolvedValueOnce(makeEnrollment({ status: 'CANCELLED' }));
  const res = await request(app).put('/benefits/enrollments/enr-001/cancel').send({
    cancelReason: 'No longer needed',
  });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('CANCELLED');
});

test('EN-09 400 missing cancel reason', async () => {
  mockEnrollFindUnique.mockResolvedValueOnce(makeEnrollment());
  const res = await request(app).put('/benefits/enrollments/enr-001/cancel').send({});
  expect(res.status).toBe(400);
});

test('EN-10 409 already cancelled', async () => {
  mockEnrollFindUnique.mockResolvedValueOnce(makeEnrollment({ status: 'CANCELLED' }));
  const res = await request(app).put('/benefits/enrollments/enr-001/cancel').send({
    cancelReason: 'X',
  });
  expect(res.status).toBe(409);
});

// ──────────────────────────────────────────────────────────────────────────────
// Dependents
// ──────────────────────────────────────────────────────────────────────────────
test('DP-01 employee creates own dependent → 201', async () => {
  mockDepCreate.mockResolvedValueOnce({
    id: 'dep-1', employeeId: 'emp-001', fullName: 'Baby Tan',
    relationship: 'CHILD', dateOfBirth: new Date('2020-01-01'),
  });
  const res = await request(app).post('/benefits/dependents').send({
    fullName: 'Baby Tan', relationship: 'CHILD', dateOfBirth: '2020-01-01',
  });
  expect(res.status).toBe(201);
});

test('DP-02 400 invalid relationship', async () => {
  const res = await request(app).post('/benefits/dependents').send({
    fullName: 'X', relationship: 'PET', dateOfBirth: '2020-01-01',
  });
  expect(res.status).toBe(400);
});

test('DP-03 employee sees only own dependents', async () => {
  mockDepFindMany.mockResolvedValueOnce([
    { id: 'dep-1', employeeId: 'emp-001', fullName: 'Baby Tan', relationship: 'CHILD' },
  ]);
  const res = await request(app).get('/benefits/dependents');
  expect(res.status).toBe(200);
  expect(mockDepFindMany.mock.calls[0][0].where.employeeId).toBe('emp-001');
});

// ──────────────────────────────────────────────────────────────────────────────
// Claims
// ──────────────────────────────────────────────────────────────────────────────
test('CL-01 employee submits claim → 201 with claim number', async () => {
  mockEnrollFindUnique.mockResolvedValueOnce(makeEnrollment());
  mockClaimCount.mockResolvedValueOnce(0);
  mockClaimCreate.mockResolvedValueOnce({
    id: 'clm-1', claimNumber: 'CLM-2026-00001', enrollmentId: 'enr-001',
    employeeId: 'emp-001', employeeName: 'Alice Tan', planId: 'plan-001',
    treatmentDate: new Date('2026-05-01'), treatmentType: 'outpatient',
    patientName: 'Alice Tan', claimAmount: 250, status: 'SUBMITTED',
  });
  const res = await request(app).post('/benefits/claims').send({
    enrollmentId: 'enr-001', treatmentDate: '2026-05-01',
    treatmentType: 'outpatient', claimAmount: 250,
  });
  expect(res.status).toBe(201);
  expect(res.body.claimNumber).toMatch(/^CLM-\d{4}-\d{5}$/);
});

test('CL-02 409 exceeds coverage', async () => {
  mockEnrollFindUnique.mockResolvedValueOnce(makeEnrollment());
  const res = await request(app).post('/benefits/claims').send({
    enrollmentId: 'enr-001', treatmentDate: '2026-05-01',
    treatmentType: 'hospitalisation', claimAmount: 999999,
  });
  expect(res.status).toBe(409);
});

test('CL-03 400 missing claimAmount', async () => {
  const res = await request(app).post('/benefits/claims').send({
    enrollmentId: 'enr-001', treatmentDate: '2026-05-01',
    treatmentType: 'outpatient',
  });
  expect(res.status).toBe(400);
});

test('CL-04 HR approves → 200', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'hr-1' });
  mockClaimFindUnique.mockResolvedValueOnce({
    id: 'clm-1', status: 'SUBMITTED', claimAmount: 250, employeeId: 'emp-001',
  });
  mockClaimUpdate.mockResolvedValueOnce({
    id: 'clm-1', status: 'APPROVED', approvedAmount: 200, claimNumber: 'CLM-2026-00001',
    employeeId: 'emp-001', treatmentType: 'outpatient',
  });
  const res = await request(app).put('/benefits/claims/clm-1/approve').send({ approvedAmount: 200 });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('APPROVED');
});

test('CL-05 409 already approved', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockClaimFindUnique.mockResolvedValueOnce({ id: 'clm-1', status: 'APPROVED', claimAmount: 250 });
  const res = await request(app).put('/benefits/claims/clm-1/approve').send({});
  expect(res.status).toBe(409);
});

test('CL-06 400 missing reject reason', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).put('/benefits/claims/clm-1/reject').send({});
  expect(res.status).toBe(400);
});

test('CL-07 Finance reimburses APPROVED claim', async () => {
  setUser({ role: 'FINANCE_ADMIN' });
  mockClaimFindUnique.mockResolvedValueOnce({ id: 'clm-1', status: 'APPROVED', approvedAmount: 200 });
  mockClaimUpdate.mockResolvedValueOnce({ id: 'clm-1', status: 'REIMBURSED', approvedAmount: 200 });
  const res = await request(app).put('/benefits/claims/clm-1/reimburse').send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('REIMBURSED');
});

test('CL-08 409 if not APPROVED', async () => {
  setUser({ role: 'FINANCE_ADMIN' });
  mockClaimFindUnique.mockResolvedValueOnce({ id: 'clm-1', status: 'SUBMITTED' });
  const res = await request(app).put('/benefits/claims/clm-1/reimburse').send({});
  expect(res.status).toBe(409);
});

// ──────────────────────────────────────────────────────────────────────────────
// Open Enrollment
// ──────────────────────────────────────────────────────────────────────────────
test('OE-01 HR creates → 201', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockPeriodCreate.mockResolvedValueOnce({
    id: 'oep-1', name: '2026 Open Enrollment', year: 2026, status: 'SCHEDULED',
    startDate: new Date('2026-06-01'), endDate: new Date('2026-06-30'),
    planIds: [], defaultPlanIds: [],
  });
  const res = await request(app).post('/benefits/open-enrollment').send({
    name: '2026 Open Enrollment', year: 2026,
    startDate: '2026-06-01', endDate: '2026-06-30',
  });
  expect(res.status).toBe(201);
});

test('OE-02 GET /current returns active window', async () => {
  mockPeriodFindFirst.mockResolvedValueOnce({
    id: 'oep-1', status: 'ACTIVE',
    startDate: new Date(Date.now() - 86400000),
    endDate:   new Date(Date.now() + 86400000),
  });
  const res = await request(app).get('/benefits/open-enrollment/current');
  expect(res.status).toBe(200);
  expect(res.body.active).toBe(true);
});

test('OE-03 HR closes period → 200', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockPeriodUpdate.mockResolvedValueOnce({ id: 'oep-1', status: 'CLOSED', closedAt: new Date() });
  const res = await request(app).put('/benefits/open-enrollment/oep-1/close').send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('CLOSED');
});

// ──────────────────────────────────────────────────────────────────────────────
// Dashboard / Reconciliation
// ──────────────────────────────────────────────────────────────────────────────
test('DB-01 HR sees aggregate stats', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEnrollFindMany.mockResolvedValueOnce([
    makeEnrollment({ status: 'ACTIVE',    annualPremiumEmployer: 500 }),
    makeEnrollment({ status: 'CANCELLED', annualPremiumEmployer: 500 }),
  ]);
  mockClaimFindMany.mockResolvedValueOnce([
    { status: 'SUBMITTED',  claimAmount: 100 },
    { status: 'REIMBURSED', claimAmount: 200, approvedAmount: 180 },
  ]);
  mockPlanFindMany.mockResolvedValueOnce([makePlan()]);
  mockPeriodFindFirst.mockResolvedValueOnce(null);
  const res = await request(app).get('/benefits/dashboard');
  expect(res.status).toBe(200);
  expect(res.body.enrollmentSummary.active).toBe(1);
  expect(res.body.claimsSummary.totalReimbursed).toBe(180);
  expect(res.body.plansActive).toBe(1);
});

test('RC-01 reconciliation variance vs insurer billing', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEnrollFindMany.mockResolvedValueOnce([
    { status: 'ACTIVE', annualPremiumEmployer: 500 },
    { status: 'ACTIVE', annualPremiumEmployer: 500 },
  ]);
  const res = await request(app).get('/benefits/reconciliation?planId=plan-001&insurerBilled=1100');
  expect(res.status).toBe(200);
  expect(res.body.expected).toBe(1000);
  expect(res.body.variance).toBe(100);
});

test('RC-02 400 missing planId', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).get('/benefits/reconciliation');
  expect(res.status).toBe(400);
});
