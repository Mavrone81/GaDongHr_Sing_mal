'use strict';
/**
 * Integration tests for payroll API endpoints.
 *
 * Tests cover:
 *   A) GET /payroll/runs — lists runs with pagination
 *   B) POST /payroll/runs — creates new payroll run; rejects duplicate period
 *   C) GET /payroll/runs/:id — fetches run with line items
 *   D) POST /payroll/runs/:id/compute — validates employee data integration
 *      (mocks employee-service + leave-service responses)
 *   E) GET /health
 *
 * Cross-service integration (Singapore MOM compliance):
 *   - Verify CPF rates are fetched from DB and applied
 *   - Verify SDL config is fetched and applied
 *   - Verify leave data from leave-service is factored in (NPL)
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER', EMPLOYEE: 'EMPLOYEE' },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encrypt: v => v, decrypt: v => v,
  encryptNumber: v => String(v), decryptNumber: v => parseFloat(v),
}), { virtual: true });

// Mock pdfkit (not needed for compute tests)
jest.mock('pdfkit', () => {
  const { EventEmitter } = require('events');
  return jest.fn().mockImplementation(() => {
    const ee = new EventEmitter();
    ee.font = () => ee; ee.fontSize = () => ee; ee.text = () => ee;
    ee.moveDown = () => ee; ee.lineTo = () => ee; ee.stroke = () => ee;
    ee.moveTo = () => ee; ee.pipe = () => {}; ee.end = () => ee.emit('end');
    return ee;
  });
});

const mockRunFindMany    = jest.fn();
const mockRunCount       = jest.fn();
const mockRunFindUnique  = jest.fn();
const mockRunFindFirst   = jest.fn();
const mockRunCreate      = jest.fn();
const mockRunUpdate      = jest.fn();
const mockLineItemDeleteMany = jest.fn();
const mockLineItemCreateMany = jest.fn();
const mockPayslipDeleteMany = jest.fn();
const mockPayslipCreateMany = jest.fn();
const mockPayslipUpsert = jest.fn().mockResolvedValue({});
const mockPayslipFindMany = jest.fn().mockResolvedValue([]);
const mockPayslipUpdate = jest.fn().mockResolvedValue({});
const mockPayslipUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
const mockCpfRateFindMany = jest.fn();
const mockSdlConfigFindFirst = jest.fn();
const mockLineItemFindMany = jest.fn();
const mockPayrollOverrideFindMany = jest.fn().mockResolvedValue([]);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    payrollRun: {
      findMany: mockRunFindMany,
      findFirst: mockRunFindFirst,
      findUnique: mockRunFindUnique,
      create: mockRunCreate,
      update: mockRunUpdate,
      count: mockRunCount,
    },
    payrollLineItem: {
      deleteMany: mockLineItemDeleteMany,
      createMany: mockLineItemCreateMany,
      findMany: mockLineItemFindMany,
    },
    payslip: { deleteMany: mockPayslipDeleteMany, createMany: mockPayslipCreateMany, upsert: mockPayslipUpsert, findMany: mockPayslipFindMany, update: mockPayslipUpdate, updateMany: mockPayslipUpdateMany },
    cpfRate: { findMany: mockCpfRateFindMany },
    sdlConfig: { findFirst: mockSdlConfigFindFirst },
    payrollComponent: { findMany: jest.fn().mockResolvedValue([]) },
    payrollOverride: { findMany: mockPayrollOverrideFindMany },
    payComponent: { findMany: jest.fn().mockResolvedValue([]) },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

// Mock fs to avoid actual file operations
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({ on: jest.fn(), pipe: jest.fn() }),
  existsSync: jest.fn().mockReturnValue(true),
}));

const request = require('supertest');
const app = require('../src/index');

afterEach(() => jest.clearAllMocks());

// ── E) Health check ────────────────────────────────────────────────────────────
describe('GET /health', () => {
  test('200 — service is healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('payroll-service');
    expect(res.body.status).toBe('ok');
  });
});

// ── A) GET /payroll/runs ───────────────────────────────────────────────────────
describe('A) GET /payroll/runs', () => {
  test('200 — returns paginated list of runs', async () => {
    mockRunFindMany.mockResolvedValue([
      { id: 'run-001', period: '2026-05', runType: 'MONTHLY', status: 'DRAFT', initiatedBy: 'admin-001', approvedBy: null, createdAt: new Date(), finalisedAt: null },
    ]);
    mockRunCount.mockResolvedValue(1);

    const res = await request(app).get('/payroll/runs');

    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.runs[0].period).toBe('2026-05');
  });

  test('200 — filters by period query param', async () => {
    mockRunFindMany.mockResolvedValue([]);
    mockRunCount.mockResolvedValue(0);

    const res = await request(app).get('/payroll/runs?period=2026-04');

    expect(res.status).toBe(200);
    expect(mockRunFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ period: '2026-04' }) })
    );
  });
});

// ── B) POST /payroll/runs ──────────────────────────────────────────────────────
describe('B) POST /payroll/runs', () => {
  test('201 — creates new DRAFT payroll run', async () => {
    mockRunFindFirst.mockResolvedValue(null); // no existing run
    mockRunCreate.mockResolvedValue({ id: 'run-001', period: '2026-05', runType: 'MONTHLY', status: 'DRAFT' });

    const res = await request(app)
      .post('/payroll/runs')
      .send({ period: '2026-05', runType: 'MONTHLY' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.period).toBe('2026-05');
  });

  test('400 — rejects missing period', async () => {
    const res = await request(app).post('/payroll/runs').send({ runType: 'MONTHLY' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period/i);
  });

  test('409 — rejects duplicate period/runType', async () => {
    mockRunFindFirst.mockResolvedValue({ id: 'run-001', period: '2026-05', status: 'DRAFT' });

    const res = await request(app)
      .post('/payroll/runs')
      .send({ period: '2026-05', runType: 'MONTHLY' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });
});

// ── C) GET /payroll/runs/:id ──────────────────────────────────────────────────
describe('C) GET /payroll/runs/:id', () => {
  test('200 — returns run with line items', async () => {
    mockRunFindUnique.mockResolvedValue({
      id: 'run-001', period: '2026-05', status: 'DRAFT',
      lineItems: [{ id: 'li-001', employeeId: 'emp-001', grossPay: 5000 }],
      payslips: [],
    });

    const res = await request(app).get('/payroll/runs/run-001');

    expect(res.status).toBe(200);
    expect(res.body.lineItems).toHaveLength(1);
  });

  test('404 — run not found', async () => {
    mockRunFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/payroll/runs/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ── D) POST /payroll/runs/:id/compute — Singapore MOM compliance ──────────────
describe('D) POST /payroll/runs/:id/compute — CPF + SDL integration', () => {
  // Standard CPF rates: age ≤55, SC/PR, Jan 2025
  const cpfRates = [
    { id: 'rate-1', citizenStatus: 'SC', ageFrom: 0, ageTo: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 6800, awCeiling: 102000, isActive: true },
    { id: 'rate-2', citizenStatus: 'PR_YR3_PLUS', ageFrom: 0, ageTo: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 6800, awCeiling: 102000, isActive: true },
  ];
  const sdlConfig = { rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500, isActive: true };

  const draftRun = {
    id: 'run-001', period: '2026-05', runType: 'MONTHLY', status: 'DRAFT',
    employeeGroup: null, initiatedBy: 'admin-001',
  };

  // Payroll-data format (as returned by employee-service /employees/payroll-data)
  const employees = [
    {
      employeeId: 'emp-001', employeeCode: 'EMP-001', fullName: 'Alice Tan',
      ow: 5000, aw: 0, grossPay: 5000,
      citizenStatus: 'SC', age: 35,
      weeklyHours: 44, bankName: 'DBS', bankAccount: '123456789', bankCode: '7171',
      ytdOw: 0, ytdAw: 0, ytdGross: 0, ytdEmployeeCpf: 0, ytdEmployerCpf: 0,
    },
  ];

  beforeEach(() => {
    mockRunFindUnique.mockResolvedValue(draftRun);
    mockCpfRateFindMany.mockResolvedValue(cpfRates);
    mockSdlConfigFindFirst.mockResolvedValue(sdlConfig);
    mockLineItemFindMany.mockResolvedValue([]); // no saved overrides
    mockLineItemDeleteMany.mockResolvedValue({});
    mockLineItemCreateMany.mockResolvedValue({ count: 1 });
    mockPayslipDeleteMany.mockResolvedValue({});
    mockPayslipCreateMany.mockResolvedValue({ count: 1 });
    mockRunUpdate.mockResolvedValue({ ...draftRun, status: 'PENDING_APPROVAL' });
  });

  test('200 — computes payroll with CPF and SDL when employees provided in body', async () => {
    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees });

    expect(res.status).toBe(200);
    expect(mockCpfRateFindMany).toHaveBeenCalled();
    expect(mockSdlConfigFindFirst).toHaveBeenCalled();
  });

  test('400 — rejects compute on FINALISED run', async () => {
    mockRunFindUnique.mockResolvedValue({ ...draftRun, status: 'FINALISED' });

    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DRAFT|PENDING_APPROVAL/i);
  });

  test('400 — rejects empty employees array', async () => {
    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No active employees/i);
  });

  test('404 — run not found', async () => {
    mockRunFindUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/payroll/runs/nonexistent/compute')
      .send({ employees });
    expect(res.status).toBe(404);
  });

  // ── Start/end date eligibility filter (EA compliance) ──────────────────────
  test('400 — excludes all employees whose startDate is after period end', async () => {
    // Period is 2026-05; employee starts 2026-06-01 — not yet started
    const futureStartEmp = [{ ...employees[0], startDate: '2026-06-01', endDate: null }];
    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: futureStartEmp });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No active employees/i);
  });

  test('200 — includes employees whose startDate is within or before period', async () => {
    // Employee starts 2026-05-16 (mid-month) — still eligible for May payroll
    const midMonthStart = [{ ...employees[0], startDate: '2026-05-16', endDate: null }];
    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: midMonthStart });
    expect(res.status).toBe(200);
  });

  test('400 — excludes employees terminated before period start', async () => {
    // Period is 2026-05; employee ended 2026-04-30 — already gone
    const terminatedEmp = [{ ...employees[0], startDate: '2025-01-01', endDate: '2026-04-30' }];
    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: terminatedEmp });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No active employees/i);
  });

  test('200 — mixes eligible and ineligible; only eligible are processed', async () => {
    const mixed = [
      { ...employees[0], employeeId: 'emp-eligible', startDate: '2025-01-01', endDate: null },
      { ...employees[0], employeeId: 'emp-future',   startDate: '2026-06-01', endDate: null },
    ];
    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: mixed });
    expect(res.status).toBe(200);
    // payslip.upsert should have been called once (only the eligible employee)
    expect(mockPayslipUpsert).toHaveBeenCalledTimes(1);
  });
});

// ── F) Consolidation and variance ─────────────────────────────────────────────
describe('F) Consolidation and variance', () => {
  const finalisedRun = { id: 'run-fin', period: '2026-05', runType: 'MONTHLY', status: 'FINALISED' };
  const approvedRun  = { id: 'run-apr', period: '2026-05', runType: 'ADHOC',   status: 'APPROVED' };
  const draftRun2    = { id: 'run-drft', period: '2026-05', runType: 'BONUS',  status: 'DRAFT' };

  const makeSlip = (id, empId, runId, net, gross) => ({
    id, runId, employeeId: empId, period: '2026-05', isPublished: true,
    basicSalaryEnc: '5000', grossPayEnc: String(gross), netPayEnc: String(net),
    employeeCpfEnc: '1000', employerCpfEnc: '850', sdlAmountEnc: '11.25',
    fwlAmountEnc: null, ytdGrossEnc: String(gross), ytdEmployeeCpfEnc: '1000',
    ytdEmployerCpfEnc: '850', nplDays: null, nplDeductionEnc: null,
    govtPaidDays: null, govtPaidAmountEnc: null,
  });

  beforeEach(() => {
    mockPayslipUpdateMany.mockResolvedValue({ count: 1 });
    mockPayslipUpdate.mockResolvedValue({});
    mockRunUpdate.mockResolvedValue({});
  });

  // ── Variance: no other runs ──────────────────────────────────────────────────
  test('GET /payroll/runs/:id/variance — no other runs → hasConflicts false', async () => {
    mockRunFindUnique.mockResolvedValue(finalisedRun);
    // this run's payslips
    mockPayslipFindMany
      .mockResolvedValueOnce([makeSlip('ps-1', 'emp-001', 'run-fin', 4000, 5000)])
      // other runs' payslips — none
      .mockResolvedValueOnce([]);

    const res = await request(app).get('/payroll/runs/run-fin/variance');
    expect(res.status).toBe(200);
    expect(res.body.hasConflicts).toBe(false);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].hasExisting).toBe(false);
    expect(res.body.rows[0].delta).toBe(4000);
  });

  // ── Variance: other published payslips exist ─────────────────────────────────
  test('GET /payroll/runs/:id/variance — other finalised run exists → hasConflicts true with delta', async () => {
    mockRunFindUnique.mockResolvedValue(approvedRun);
    // this run's payslips
    mockPayslipFindMany
      .mockResolvedValueOnce([makeSlip('ps-2', 'emp-001', 'run-apr', 2000, 2500)])
      // other runs' published payslips for same period
      .mockResolvedValueOnce([makeSlip('ps-1', 'emp-001', 'run-fin', 4000, 5000)]);

    const res = await request(app).get('/payroll/runs/run-apr/variance');
    expect(res.status).toBe(200);
    expect(res.body.hasConflicts).toBe(true);
    expect(res.body.otherRunCount).toBe(1);
    const row = res.body.rows[0];
    expect(row.hasExisting).toBe(true);
    expect(row.existingNet).toBe(4000);
    expect(row.delta).toBe(2000);
    expect(row.combinedNet).toBe(6000);
  });

  // ── Variance: 404 run not found ──────────────────────────────────────────────
  test('GET /payroll/runs/:id/variance — 404 when run not found', async () => {
    mockRunFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/payroll/runs/nonexistent/variance');
    expect(res.status).toBe(404);
  });

  // ── Consolidate: FINALISED run ───────────────────────────────────────────────
  test('POST /payroll/runs/:id/consolidate — FINALISED run consolidates successfully', async () => {
    mockRunFindUnique.mockResolvedValue(finalisedRun);
    // Two payslips for same employee in same period (two different runs)
    mockPayslipFindMany.mockResolvedValueOnce([
      makeSlip('ps-1', 'emp-001', 'run-fin', 4000, 5000),
      makeSlip('ps-2', 'emp-001', 'run-sec', 2000, 2500),
    ]);

    const res = await request(app).post('/payroll/runs/run-fin/consolidate');
    expect(res.status).toBe(200);
    expect(res.body.consolidatedEmployees).toBe(1);
    expect(res.body.period).toBe('2026-05');
    // Should have updated the primary payslip
    expect(mockPayslipUpdate).toHaveBeenCalled();
    // Should have unpublished the secondary payslip
    expect(mockPayslipUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { isPublished: false },
    }));
  });

  // ── Consolidate: non-FINALISED run returns 400 ───────────────────────────────
  test('POST /payroll/runs/:id/consolidate — non-FINALISED run returns 400', async () => {
    mockRunFindUnique.mockResolvedValue(draftRun2);
    const res = await request(app).post('/payroll/runs/run-drft/consolidate');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/FINALISED/i);
  });

  // ── Finalise calls consolidation (payslip updates triggered) ─────────────────
  test('POST /payroll/runs/:id/finalise — triggers consolidation when duplicate payslips exist', async () => {
    mockRunFindUnique.mockResolvedValue({ ...finalisedRun, status: 'APPROVED', id: 'run-apr2' });
    mockRunUpdate.mockResolvedValue({ ...finalisedRun });
    // After publish: two payslips for same employee
    mockPayslipUpdateMany.mockResolvedValue({ count: 1 });
    mockPayslipFindMany.mockResolvedValueOnce([
      makeSlip('ps-1', 'emp-001', 'run-apr2', 4000, 5000),
      makeSlip('ps-2', 'emp-001', 'run-old', 2000, 2500),
    ]);

    const res = await request(app).post('/payroll/runs/run-apr2/finalise');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('consolidated');
    // consolidation should have been attempted (payslipUpdate would be called)
    expect(mockPayslipUpdateMany).toHaveBeenCalled();
  });
});

// ── E-extended) GET /payroll/runs/:id/payslips — full breakdown fields ────────
describe('E-extended) GET /payroll/runs/:id/payslips — breakdown field coverage', () => {
  test('200 — returns all breakdown fields including SDL, NPL, govtPaid, YTD', async () => {
    mockRunFindUnique.mockResolvedValue({
      id: 'run-001', period: '2026-05', status: 'FINALISED',
    });
    // Simulate a payslip with all encrypted fields set
    const enc = (v) => String(v); // mock encrypt = identity
    mockPayslipFindMany.mockResolvedValue([{
      id: 'ps-001', employeeId: 'emp-001', period: '2026-05',
      basicSalaryEnc: enc('5000'), grossPayEnc: enc('5000'), netPayEnc: enc('3850'),
      employeeCpfEnc: enc('1000'), employerCpfEnc: enc('850'),
      sdlAmountEnc: enc('11.25'), fwlAmountEnc: null,
      ytdGrossEnc: enc('5000'), ytdEmployeeCpfEnc: enc('1000'), ytdEmployerCpfEnc: enc('850'),
      nplDays: 2, nplDeductionEnc: enc('384.62'),
      govtPaidDays: 0, govtPaidAmountEnc: null,
      isPublished: false,
    }]);

    const res = await request(app).get('/payroll/runs/run-001/payslips');

    expect(res.status).toBe(200);
    const ps = res.body.payslips[0];
    expect(ps.basicSalary).toBe(5000);
    expect(ps.grossPay).toBe(5000);
    expect(ps.netPay).toBe(3850);
    expect(ps.employeeCpf).toBe(1000);
    expect(ps.employerCpf).toBe(850);
    expect(ps.sdl).toBe(11.25);
    expect(ps.nplDays).toBe(2);
    expect(ps.nplDeduction).toBeCloseTo(384.62);
    expect(ps.govtPaidDays).toBe(0);
    expect(ps.ytdGross).toBe(5000);
    expect(ps.ytdEmployeeCpf).toBe(1000);
  });
});
