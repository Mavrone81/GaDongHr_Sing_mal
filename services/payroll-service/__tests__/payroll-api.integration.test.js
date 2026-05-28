'use strict';
// Required by C-07 fix: payroll service fail-closes if INTERNAL_SERVICE_KEY
// is missing. Set a test value before any module loads.
process.env.INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || 'test-internal-key-2025';
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
const mockPeriodConfigFindUnique = jest.fn().mockResolvedValue(null); // default: no override
const mockPublicHolidayFindMany = jest.fn().mockResolvedValue([]);   // default: no holidays
const mockPeriodConfigUpsert = jest.fn().mockResolvedValue({});
const mockPublicHolidayCreate = jest.fn();
const mockPublicHolidayDelete = jest.fn();
const mockPayComponentFindUnique = jest.fn();
const mockLineItemCreate = jest.fn();
const mockLineItemDelete = jest.fn();

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
      create: mockLineItemCreate,
      delete: mockLineItemDelete,
    },
    payslip: { deleteMany: mockPayslipDeleteMany, createMany: mockPayslipCreateMany, upsert: mockPayslipUpsert, findMany: mockPayslipFindMany, update: mockPayslipUpdate, updateMany: mockPayslipUpdateMany },
    cpfRate: { findMany: mockCpfRateFindMany },
    sdlConfig: { findFirst: mockSdlConfigFindFirst },
    payrollComponent: { findMany: jest.fn().mockResolvedValue([]) },
    payrollOverride: { findMany: mockPayrollOverrideFindMany },
    payComponent: { findMany: jest.fn().mockResolvedValue([]), findUnique: mockPayComponentFindUnique },
    payrollPeriodConfig: { findUnique: mockPeriodConfigFindUnique, upsert: mockPeriodConfigUpsert },
    publicHoliday: { findMany: mockPublicHolidayFindMany, create: mockPublicHolidayCreate, delete: mockPublicHolidayDelete },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

// ── TAT-005 fetch dispatcher ─────────────────────────────────────────────────
// payroll-service /runs/:id/compute now makes TWO external calls:
//   1) GET /attendance/internal/period-summary/:period (must be APPROVED_FOR_PAYROLL)
//   2) GET /leave/applications?... (existing behaviour)
// installFetchMock() returns a single fetch jest.fn() that routes by URL:
//   - attendance URL → APPROVED_FOR_PAYROLL + empty per-employee summary
//   - leave URL      → { applications } from the second arg
// individual tests can override the leave half via mockLeaveService(applications)
// or the attendance half via the optional `attendance` override.
function installFetchMock({ applications = [], attendance } = {}) {
  const defaultAttendance = { periodStatus: 'APPROVED_FOR_PAYROLL', summary: {}, expectedWorkDays: 22 };
  global.fetch = jest.fn().mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('/attendance/internal/period-summary')) {
      return Promise.resolve({ ok: true, json: async () => ({ ...defaultAttendance, ...(attendance || {}) }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ applications }) });
  });
  return global.fetch;
}

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
    mockPeriodConfigFindUnique.mockResolvedValue(null); // no period config override
    mockPublicHolidayFindMany.mockResolvedValue([]);    // no public holidays
    // TAT-005: attendance period defaults to APPROVED_FOR_PAYROLL so compute proceeds.
    installFetchMock();
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

// ── G) Pro-rating for mid-month starters and leavers (EA s.20, working days) ──
// May 2026: Mon May 4 – Fri May 29 (no public holidays in mock)
//   Week 1: 4 days (Mon 4 – Thu 1 is April; Mon 4–Fri 8 = 5 days)
//   Actually May 2026: May 1=Fri, May 4=Mon … May 29=Fri, May 30=Sat, May 31=Sun
//   Working days (FIVE_DAY, no holidays): May 1(Fri), 4–8, 11–15, 18–22, 25–29 = 1+5+5+5+5 = 21 days
describe('G) Pro-rating — EA s.20 working-day salary (MOM guidelines)', () => {
  // May 2026: 21 working days (Mon–Fri, no holidays)
  const MAY_2026_WORKING_DAYS = 21; // May 1=Fri + 4 full Mon-Fri weeks

  const cpfRates = [
    { id: 'rate-1', citizenStatus: 'SC', ageFrom: 0, ageTo: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 6800, awCeiling: 102000, isActive: true },
  ];
  const sdlConfig = { rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500, isActive: true };
  const adhocRun  = { id: 'run-adhoc', period: '2026-05', runType: 'ADHOC', status: 'DRAFT', employeeGroup: null, initiatedBy: 'admin-001' };

  const baseEmp = {
    employeeId: 'emp-001', employeeCode: 'EMP-001', fullName: 'Test',
    ow: 5000, grossPay: 5000, citizenStatus: 'SC', age: 30,
    startDate: null, endDate: null,
    ytdOw: 0, ytdAw: 0, ytdGross: 0, ytdEmployeeCpf: 0, ytdEmployerCpf: 0,
  };

  beforeEach(() => {
    mockRunFindUnique.mockResolvedValue(adhocRun);
    mockCpfRateFindMany.mockResolvedValue(cpfRates);
    mockSdlConfigFindFirst.mockResolvedValue(sdlConfig);
    mockLineItemFindMany.mockResolvedValue([]);
    mockPayslipFindMany.mockResolvedValue([]); // no prior published payslips (supplemental filter)
    mockRunUpdate.mockResolvedValue({});
    mockPeriodConfigFindUnique.mockResolvedValue(null); // auto-compute from holidays
    mockPublicHolidayFindMany.mockResolvedValue([]);    // no holidays in May 2026
  });

  // Helper: count working days Mon–Fri between two date strings (no holidays)
  function wd(fromStr, toStr) {
    let count = 0;
    const d = new Date(fromStr); d.setHours(0,0,0,0);
    const e = new Date(toStr);   e.setHours(23,59,59,999);
    while (d <= e) { const dow = d.getDay(); if (dow >= 1 && dow <= 5) count++; d.setDate(d.getDate()+1); }
    return count;
  }

  test('G1 — starter Mon May 4 gets (May 4–31 working days)/21 of monthly salary', async () => {
    // May 4 = first Monday: worked = 21-0 = 20 working days (May 1 Fri is skipped; Mon4–Fri29=20)
    // Actually May 1=Fri is a working day. May 4=Mon. workedDays from May 4 to May 31 = 20 days.
    const workedDays = wd('2026-05-04', '2026-05-31'); // 20
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [{ ...baseEmp, startDate: '2026-05-04' }] });

    expect(res.status).toBe(200);
    const upsertData = mockPayslipUpsert.mock.calls[0][0].create;
    const expectedOw = Math.round(5000 * (workedDays / MAY_2026_WORKING_DAYS) * 100) / 100;
    expect(parseFloat(upsertData.basicSalaryEnc)).toBeCloseTo(expectedOw, 2);
    expect(parseFloat(upsertData.grossPayEnc)).toBeCloseTo(expectedOw, 2);
    expect(parseFloat(upsertData.grossPayEnc)).toBeGreaterThan(0);
  });

  test('G2 — starter Mon May 12 (Bam/Samuel scenario) gets (May 12–31 working days)/21', async () => {
    const workedDays = wd('2026-05-12', '2026-05-31'); // 14 working days
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [{ ...baseEmp, startDate: '2026-05-12' }] });

    expect(res.status).toBe(200);
    const upsertData = mockPayslipUpsert.mock.calls[0][0].create;
    const expectedOw = Math.round(5000 * (workedDays / MAY_2026_WORKING_DAYS) * 100) / 100;
    expect(parseFloat(upsertData.basicSalaryEnc)).toBeCloseTo(expectedOw, 2);
    expect(parseFloat(upsertData.grossPayEnc)).toBeCloseTo(expectedOw, 2);
  });

  test('G3 — starter May 1 (Fri, first day) gets full month salary (21/21)', async () => {
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [{ ...baseEmp, startDate: '2026-05-01' }] });

    expect(res.status).toBe(200);
    const upsertData = mockPayslipUpsert.mock.calls[0][0].create;
    expect(parseFloat(upsertData.basicSalaryEnc)).toBe(5000);
    expect(parseFloat(upsertData.grossPayEnc)).toBe(5000);
  });

  test('G4 — employee started before period: full working-day salary', async () => {
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [{ ...baseEmp, startDate: '2025-03-01' }] });

    expect(res.status).toBe(200);
    const upsertData = mockPayslipUpsert.mock.calls[0][0].create;
    expect(parseFloat(upsertData.basicSalaryEnc)).toBe(5000);
  });

  test('G5 — leaver on Fri May 16 gets (May 1–16 working days)/21 of salary', async () => {
    const workedDays = wd('2026-05-01', '2026-05-16'); // Fri1, Mon4-Fri8, Mon11-Fri16 = 1+5+5=11
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [{ ...baseEmp, startDate: '2025-01-01', endDate: '2026-05-16' }] });

    expect(res.status).toBe(200);
    const upsertData = mockPayslipUpsert.mock.calls[0][0].create;
    const expectedOw = Math.round(5000 * (workedDays / MAY_2026_WORKING_DAYS) * 100) / 100;
    expect(parseFloat(upsertData.basicSalaryEnc)).toBeCloseTo(expectedOw, 2);
  });

  test('G6 — same-month joiner AND leaver: uses working days (start May 12, end May 20)', async () => {
    // May 12 Mon – May 20 Wed: Mon12, Tue13, Wed14, Thu15, Fri16, Mon18, Tue19, Wed20 = 8 working days
    const workedDays = wd('2026-05-12', '2026-05-20');
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [{ ...baseEmp, startDate: '2026-05-12', endDate: '2026-05-20' }] });

    expect(res.status).toBe(200);
    const upsertData = mockPayslipUpsert.mock.calls[0][0].create;
    const expectedOw = Math.round(5000 * (workedDays / MAY_2026_WORKING_DAYS) * 100) / 100;
    expect(parseFloat(upsertData.basicSalaryEnc)).toBeCloseTo(expectedOw, 2);
  });

  test('G7 — period config override: admin sets 20 working days; pro-rating uses override', async () => {
    // Override: say admin marks 20 working days (e.g. one extra holiday)
    mockPeriodConfigFindUnique.mockResolvedValue({ workDayType: 'FIVE_DAY', workingDays: 20 });
    const workedDays = wd('2026-05-12', '2026-05-31'); // same as G2 = 14
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [{ ...baseEmp, startDate: '2026-05-12' }] });

    expect(res.status).toBe(200);
    const upsertData = mockPayslipUpsert.mock.calls[0][0].create;
    const expectedOw = Math.round(5000 * (workedDays / 20) * 100) / 100;
    expect(parseFloat(upsertData.basicSalaryEnc)).toBeCloseTo(expectedOw, 2);
  });

  test('G8 — public holiday on May 1 reduces working days to 20; starter on May 4 gets 20/20', async () => {
    // May 1 = Fri, marked as public holiday → working days in month = 20
    mockPublicHolidayFindMany.mockResolvedValue([
      { date: new Date('2026-05-01T00:00:00.000Z') },
    ]);
    // Employee starts May 4 (Mon): worked days = May 4–31 = 20 working days = full month (20/20)
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [{ ...baseEmp, startDate: '2026-05-04' }] });

    expect(res.status).toBe(200);
    const upsertData = mockPayslipUpsert.mock.calls[0][0].create;
    // worked = May 4–31 = 20; total in period = 20 (holiday excluded May 1)
    expect(parseFloat(upsertData.basicSalaryEnc)).toBe(5000); // full salary
  });

  it('G9 — OW line item pro-rated for mid-month starter; basicSalaryEnc = effectiveOw (salary-as-paycode)', async () => {
    // Bam/Samuel scenario: profile salary is $0, salary entered as an OW paycode line item
    const salaryAmt = 3000;
    mockLineItemFindMany.mockResolvedValue([{
      employeeId: 'emp-001',
      amountEncrypted: String(salaryAmt),
      wageType: 'OW',
      isCpfApplicable: true,
    }]);
    // starter May 12 (Mon): 14 worked days out of 21
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [{ ...baseEmp, ow: 0, grossPay: 0, startDate: '2026-05-12' }] });

    expect(res.status).toBe(200);
    const upsertData = mockPayslipUpsert.mock.calls[0][0].create;
    const expectedOw = Math.round(salaryAmt * (14 / 21) * 100) / 100;
    expect(parseFloat(upsertData.basicSalaryEnc)).toBeCloseTo(expectedOw, 2);
    expect(parseFloat(upsertData.grossPayEnc)).toBeCloseTo(expectedOw, 2);
  });

  it('G10 — zero effectiveOw triggers warning in compute response', async () => {
    // Employee with no profile salary and no OW line items
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [{ ...baseEmp, ow: 0, grossPay: 0 }] });

    expect(res.status).toBe(200);
    expect(res.body.warnings).toBeDefined();
    expect(res.body.warnings.zeroOrdinaryWages).toContain('emp-001');
  });

  it('G11 — supplemental ADHOC: employees whose salary matches prior published payslip are auto-removed post-compute', async () => {
    // emp-001 has a prior published payslip with basicSalary=5000, grossPay=5000 (MONTHLY run)
    mockPayslipFindMany.mockResolvedValue([{
      employeeId: 'emp-001',
      basicSalaryEnc: '5000',
      grossPayEnc:    '5000',
      netPayEnc:      '3850',
    }]);
    mockPayslipDeleteMany.mockResolvedValue({ count: 1 });

    // emp-002 is a new joiner with no prior payslip → kept in this run
    const newJoiner = { ...baseEmp, employeeId: 'emp-002', startDate: '2026-05-12' };

    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [baseEmp, newJoiner] });

    expect(res.status).toBe(200);
    // Both employees are upserted (compute all first)…
    const upsertedIds = mockPayslipUpsert.mock.calls.map(c => c[0].create.employeeId);
    expect(upsertedIds).toContain('emp-001');
    expect(upsertedIds).toContain('emp-002');
    // …then emp-001 is deleted because their computed salary matches the prior payslip
    expect(mockPayslipDeleteMany).toHaveBeenCalledWith({
      where: { runId: 'run-adhoc', employeeId: { in: ['emp-001'] } },
    });
    expect(res.body.autoRemovedIds).toContain('emp-001');
    expect(res.body.autoRemovedIds).not.toContain('emp-002');
  });

  it('G12 — MONTHLY run skips auto-removal; all employees computed regardless of prior payslips', async () => {
    mockRunFindUnique.mockResolvedValue({ ...adhocRun, runType: 'MONTHLY' });
    // Even with prior payslips present, MONTHLY compute should not auto-remove anyone
    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    expect(mockPayslipUpsert).toHaveBeenCalledTimes(1);
    expect(res.body.autoRemovedIds).toBeUndefined();
  });
});

// ── H) Deductible leave pro-ration (MOM working-day rate, cross-month) ────────
// May 2026: 21 working days (Fri May 1 + Mon-Fri weeks 2–5 = 1+5+5+5+5 = 21)
// Cross-month cases:
//   Apr 28 (Tue) → May 3 (Sun): May portion = May 1(Fri) only = 1 working day
//   May 28 (Thu) → Jun 5 (Fri): May portion = May 28(Thu) + May 29(Fri)   = 2 working days
describe('H) Deductible leave — working-day rate + cross-month pro-ration', () => {
  const MAY_WORKING_DAYS = 21;
  // findCpfRate maps 'SC' → 'SC_PR'; fields are ageMin/ageMax (not ageFrom/ageTo)
  const cpfRates = [
    { id: 'rate-1', citizenStatus: 'SC_PR', ageMin: 0, ageMax: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 6800, awCeiling: 102000, isActive: true },
  ];
  const sdlConfig = { rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500, isActive: true };
  const draftRun = { id: 'run-001', period: '2026-05', runType: 'MONTHLY', status: 'DRAFT', employeeGroup: null, initiatedBy: 'admin-001' };
  const baseEmp = {
    employeeId: 'emp-001', employeeCode: 'EMP-001', fullName: 'Alice',
    ow: 5000, grossPay: 5000, citizenStatus: 'SC', age: 35,
    startDate: null, endDate: null,
    ytdOw: 0, ytdAw: 0, ytdGross: 0, ytdEmployeeCpf: 0, ytdEmployerCpf: 0,
  };

  let savedFetch;
  beforeAll(() => { savedFetch = global.fetch; });
  afterAll(()  => { global.fetch = savedFetch; });

  beforeEach(() => {
    mockRunFindUnique.mockResolvedValue(draftRun);
    mockCpfRateFindMany.mockResolvedValue(cpfRates);
    mockSdlConfigFindFirst.mockResolvedValue(sdlConfig);
    mockLineItemFindMany.mockResolvedValue([]);
    mockPayslipFindMany.mockResolvedValue([]);
    mockRunUpdate.mockResolvedValue({});
    mockPeriodConfigFindUnique.mockResolvedValue(null);
    mockPublicHolidayFindMany.mockResolvedValue([]);
  });

  afterEach(() => { global.fetch = savedFetch; });

  function mockLeaveService(applications) {
    // TAT-005: route both attendance + leave through the URL dispatcher so
    // the attendance gate stays APPROVED_FOR_PAYROLL while we vary leaves.
    installFetchMock({ applications });
  }

  function makeLeave(overrides = {}) {
    return {
      id: 'leave-001', employeeId: 'emp-001',
      startDate: '2026-05-05T00:00:00.000Z', endDate: '2026-05-06T00:00:00.000Z',
      totalDays: 2, isHalfDay: false,
      leaveType: { code: 'NPL', name: 'No Pay Leave', isPaid: false, isGovtPaid: false },
      ...overrides,
    };
  }

  test('H1 — NPL within period: deducted at working-day daily rate', async () => {
    // May 5 (Mon) – May 6 (Tue) = 2 working days
    mockLeaveService([makeLeave()]);

    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    const data = mockPayslipUpsert.mock.calls[0][0].create;
    const expectedDeduction = Math.round(5000 / MAY_WORKING_DAYS * 2 * 100) / 100;
    expect(parseFloat(data.nplDeductionEnc)).toBeCloseTo(expectedDeduction, 2);
    expect(data.nplDays).toBe(2);
    // Net = gross − CPF(20%) − deduction
    const expectedNet = Math.round((5000 - 1000 - expectedDeduction) * 100) / 100;
    expect(parseFloat(data.netPayEnc)).toBeCloseTo(expectedNet, 2);
  });

  test('H2 — cross-month NPL (Apr 28 → May 3): only May 1 (Fri) counted in May run', async () => {
    mockLeaveService([makeLeave({
      startDate: '2026-04-28T00:00:00.000Z', endDate: '2026-05-03T00:00:00.000Z', totalDays: 6,
    })]);

    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    const data = mockPayslipUpsert.mock.calls[0][0].create;
    // Only May 1 (Fri) falls in May and is a working day
    const expectedDeduction = Math.round(5000 / MAY_WORKING_DAYS * 1 * 100) / 100;
    expect(parseFloat(data.nplDeductionEnc)).toBeCloseTo(expectedDeduction, 2);
    expect(data.nplDays).toBe(1);
  });

  test('H3 — cross-month NPL (May 28 → Jun 5): only May 28–29 (Thu–Fri) in May run', async () => {
    mockLeaveService([makeLeave({
      startDate: '2026-05-28T00:00:00.000Z', endDate: '2026-06-05T00:00:00.000Z', totalDays: 9,
    })]);

    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    const data = mockPayslipUpsert.mock.calls[0][0].create;
    const expectedDeduction = Math.round(5000 / MAY_WORKING_DAYS * 2 * 100) / 100;
    expect(parseFloat(data.nplDeductionEnc)).toBeCloseTo(expectedDeduction, 2);
    expect(data.nplDays).toBe(2);
  });

  test('H4 — govt-paid leave (NS): no employee deduction; govtPaidDays tracked', async () => {
    // May 12 (Mon) – May 14 (Wed) = 3 working days
    mockLeaveService([makeLeave({
      startDate: '2026-05-12T00:00:00.000Z', endDate: '2026-05-14T00:00:00.000Z', totalDays: 3,
      leaveType: { code: 'NS', name: 'NS Leave', isPaid: true, isGovtPaid: true },
    })]);

    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    const data = mockPayslipUpsert.mock.calls[0][0].create;
    // Employee receives full salary — no NPL deduction
    expect(data.nplDays).toBeFalsy();
    expect(data.nplDeductionEnc).toBeFalsy();
    // GovtPaid amount: daily rate × 3
    expect(data.govtPaidDays).toBe(3);
    const expectedGovtAmt = Math.round(5000 / MAY_WORKING_DAYS * 3 * 100) / 100;
    expect(parseFloat(data.govtPaidAmountEnc)).toBeCloseTo(expectedGovtAmt, 2);
    // Net = gross − CPF only (no NPL deduction)
    expect(parseFloat(data.netPayEnc)).toBeCloseTo(5000 - 1000, 2);
  });

  test('H5 — paid annual leave (isPaid=true, isGovtPaid=false): no deduction, no tracking', async () => {
    mockLeaveService([makeLeave({
      leaveType: { code: 'AL', name: 'Annual Leave', isPaid: true, isGovtPaid: false },
    })]);

    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    const data = mockPayslipUpsert.mock.calls[0][0].create;
    expect(data.nplDays).toBeFalsy();
    expect(data.nplDeductionEnc).toBeFalsy();
    expect(data.govtPaidDays).toBeFalsy();
    expect(parseFloat(data.netPayEnc)).toBeCloseTo(5000 - 1000, 2); // full net pay
  });

  test('H6 — half-day NPL on working day: deducts 0.5 working-day rate', async () => {
    // May 12 (Mon) half-day
    mockLeaveService([makeLeave({
      startDate: '2026-05-12T00:00:00.000Z', endDate: '2026-05-12T00:00:00.000Z',
      totalDays: 0.5, isHalfDay: true,
    })]);

    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    const data = mockPayslipUpsert.mock.calls[0][0].create;
    const expectedDeduction = Math.round(5000 / MAY_WORKING_DAYS * 0.5 * 100) / 100;
    expect(parseFloat(data.nplDeductionEnc)).toBeCloseTo(expectedDeduction, 2);
    expect(data.nplDays).toBe(0.5);
  });

  test('H7 — leave entirely outside period (Jan): zero deduction in May run', async () => {
    mockLeaveService([makeLeave({
      startDate: '2026-01-05T00:00:00.000Z', endDate: '2026-01-10T00:00:00.000Z', totalDays: 4,
    })]);

    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    const data = mockPayslipUpsert.mock.calls[0][0].create;
    expect(data.nplDays).toBeFalsy();
    expect(data.nplDeductionEnc).toBeFalsy();
  });

  test('H8 — leave service unreachable: payroll completes with zero deductions', async () => {
    // TAT-005: keep the attendance side happy; only the leave call fails.
    global.fetch = jest.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/attendance/internal/period-summary')) {
        return Promise.resolve({ ok: true, json: async () => ({ periodStatus: 'APPROVED_FOR_PAYROLL', summary: {}, expectedWorkDays: 22 }) });
      }
      return Promise.reject(new Error('fetch failed'));
    });

    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200); // graceful degradation
    const data = mockPayslipUpsert.mock.calls[0][0].create;
    expect(data.nplDays).toBeFalsy();
    expect(parseFloat(data.netPayEnc)).toBeCloseTo(5000 - 1000, 2);
  });
});

// ── I) Reimbursement paycodes — claims integration ────────────────────────────
describe('I) Reimbursement paycodes (claims integration)', () => {
  const draftRun     = { id: 'run-001', period: '2026-05', runType: 'MONTHLY', status: 'DRAFT', employeeGroup: null, initiatedBy: 'admin-001' };
  const finalisedRun = { ...draftRun, status: 'FINALISED' };
  const reimbComponent = { id: 'comp-reimb', name: 'Claims Reimbursement', wageType: 'REIMBURSEMENT', isCpfApplicable: false, isIrasTaxable: false };

  // ── POST /payroll/runs/:id/paycodes ────────────────────────────────────────
  describe('POST /payroll/runs/:id/paycodes', () => {
    test('I1 — 201: adds REIMBURSEMENT paycode and returns decrypted amount', async () => {
      mockRunFindUnique.mockResolvedValue(draftRun);
      mockPayComponentFindUnique.mockResolvedValue(reimbComponent);
      mockLineItemCreate.mockResolvedValue({
        id: 'item-001', runId: 'run-001', employeeId: 'emp-001',
        componentId: 'comp-reimb', description: 'Claims Reimbursement',
        wageType: 'REIMBURSEMENT', isCpfApplicable: false, isIrasTaxable: false,
        amountEncrypted: '500',
      });

      const res = await request(app)
        .post('/payroll/runs/run-001/paycodes')
        .send({ employeeId: 'emp-001', componentId: 'comp-reimb', amount: 500 });

      expect(res.status).toBe(201);
      expect(res.body.wageType).toBe('REIMBURSEMENT');
      expect(res.body.amount).toBe(500);
    });

    test('I2 — 404: run not found', async () => {
      mockRunFindUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/payroll/runs/run-missing/paycodes')
        .send({ employeeId: 'emp-001', componentId: 'comp-reimb', amount: 500 });

      expect(res.status).toBe(404);
    });

    test('I3 — 400: run is FINALISED — cannot add paycodes', async () => {
      mockRunFindUnique.mockResolvedValue(finalisedRun);

      const res = await request(app)
        .post('/payroll/runs/run-001/paycodes')
        .send({ employeeId: 'emp-001', componentId: 'comp-reimb', amount: 500 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/finalised/i);
    });

    test('I4 — 400: missing required fields (componentId and amount absent)', async () => {
      mockRunFindUnique.mockResolvedValue(draftRun);

      const res = await request(app)
        .post('/payroll/runs/run-001/paycodes')
        .send({ employeeId: 'emp-001' });

      expect(res.status).toBe(400);
    });

    test('I5 — 404: pay component not found', async () => {
      mockRunFindUnique.mockResolvedValue(draftRun);
      mockPayComponentFindUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/payroll/runs/run-001/paycodes')
        .send({ employeeId: 'emp-001', componentId: 'comp-missing', amount: 500 });

      expect(res.status).toBe(404);
    });
  });

  // ── GET /payroll/runs/:id/paycodes ─────────────────────────────────────────
  describe('GET /payroll/runs/:id/paycodes', () => {
    test('I6 — 200: returns paycodes with decrypted amounts', async () => {
      mockLineItemFindMany.mockResolvedValue([{
        id: 'item-001', runId: 'run-001', employeeId: 'emp-001',
        wageType: 'REIMBURSEMENT', amountEncrypted: '500', createdAt: new Date(),
      }]);

      const res = await request(app).get('/payroll/runs/run-001/paycodes');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].amount).toBe(500);
      expect(res.body[0].wageType).toBe('REIMBURSEMENT');
    });
  });

  // ── DELETE /payroll/runs/:id/paycodes/:itemId ──────────────────────────────
  describe('DELETE /payroll/runs/:id/paycodes/:itemId', () => {
    test('I7 — 200: removes paycode successfully', async () => {
      mockRunFindUnique.mockResolvedValue(draftRun);
      mockLineItemDelete.mockResolvedValue({});

      const res = await request(app).delete('/payroll/runs/run-001/paycodes/item-001');

      expect(res.status).toBe(200);
      expect(mockLineItemDelete).toHaveBeenCalledWith({ where: { id: 'item-001' } });
    });

    test('I8 — 400: run is FINALISED — cannot remove paycodes', async () => {
      mockRunFindUnique.mockResolvedValue(finalisedRun);

      const res = await request(app).delete('/payroll/runs/run-001/paycodes/item-001');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/finalised/i);
    });
  });

  // ── Compute: reimbursement correctly raises net pay ────────────────────────
  describe('compute with REIMBURSEMENT paycode', () => {
    const cpfRates  = [{ id: 'rate-1', citizenStatus: 'SC_PR', ageMin: 0, ageMax: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 6800, awCeiling: 102000, isActive: true }];
    const sdlConfig = { rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500, isActive: true };
    const baseEmp   = { employeeId: 'emp-001', employeeCode: 'EMP-001', fullName: 'Alice', ow: 5000, grossPay: 5000, citizenStatus: 'SC', age: 35, startDate: null, endDate: null, ytdOw: 0, ytdAw: 0, ytdGross: 0, ytdEmployeeCpf: 0, ytdEmployerCpf: 0 };

    let savedFetch;
    beforeAll(() => { savedFetch = global.fetch; });
    afterAll(()  => { global.fetch = savedFetch; });

    beforeEach(() => {
      mockRunFindUnique.mockResolvedValue(draftRun);
      mockCpfRateFindMany.mockResolvedValue(cpfRates);
      mockSdlConfigFindFirst.mockResolvedValue(sdlConfig);
      mockPayslipFindMany.mockResolvedValue([]);
      mockRunUpdate.mockResolvedValue({});
      mockPeriodConfigFindUnique.mockResolvedValue(null);
      mockPublicHolidayFindMany.mockResolvedValue([]);
      // TAT-005: URL-aware mock — attendance APPROVED_FOR_PAYROLL, leave [].
      installFetchMock({ applications: [] });
    });

    afterEach(() => { global.fetch = savedFetch; });

    test('I9 — REIMBURSEMENT paycode raises net pay; gross and CPF are unaffected', async () => {
      // $300 travel claims reimbursement — not CPF-liable, not part of gross
      mockLineItemFindMany.mockResolvedValue([{
        employeeId: 'emp-001',
        amountEncrypted: '300',
        wageType: 'REIMBURSEMENT',
        isCpfApplicable: false,
      }]);

      const res = await request(app)
        .post('/payroll/runs/run-001/compute')
        .send({ employees: [baseEmp] });

      expect(res.status).toBe(200);
      const data = mockPayslipUpsert.mock.calls[0][0].create;

      expect(parseFloat(data.grossPayEnc)).toBe(5000);        // gross unchanged
      expect(parseFloat(data.employeeCpfEnc)).toBe(1000);     // CPF on $5000 @ 20% = $1000
      expect(parseFloat(data.netPayEnc)).toBe(4300);          // 5000 - 1000 + 300
    });

    test('I10 — multiple REIMBURSEMENT paycodes accumulate into net pay', async () => {
      mockLineItemFindMany.mockResolvedValue([
        { employeeId: 'emp-001', amountEncrypted: '200', wageType: 'REIMBURSEMENT', isCpfApplicable: false },
        { employeeId: 'emp-001', amountEncrypted: '150', wageType: 'REIMBURSEMENT', isCpfApplicable: false },
      ]);

      const res = await request(app)
        .post('/payroll/runs/run-001/compute')
        .send({ employees: [baseEmp] });

      expect(res.status).toBe(200);
      const data = mockPayslipUpsert.mock.calls[0][0].create;

      expect(parseFloat(data.grossPayEnc)).toBe(5000);        // gross unchanged
      expect(parseFloat(data.netPayEnc)).toBe(4350);          // 5000 - 1000 + 200 + 150
    });
  });
});

// ── PAY-001) Bi-monthly run validation ────────────────────────────────────────
describe('PAY-001) Bi-monthly run validation on POST /payroll/runs', () => {
  test('K1 — POST 400 when BIMONTHLY missing periodHalf', async () => {
    const res = await request(app)
      .post('/payroll/runs')
      .send({ period: '2026-05', runType: 'BIMONTHLY' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/periodHalf/);
  });

  test('K2 — POST 400 when BIMONTHLY has bad periodHalf', async () => {
    const res = await request(app)
      .post('/payroll/runs')
      .send({ period: '2026-05', runType: 'BIMONTHLY', periodHalf: 'MIDDLE' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/periodHalf/);
  });

  test('K3 — POST 400 when non-BIMONTHLY supplies periodHalf', async () => {
    const res = await request(app)
      .post('/payroll/runs')
      .send({ period: '2026-05', runType: 'MONTHLY', periodHalf: 'FIRST' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only valid for BIMONTHLY/);
  });

  test('K4 — POST 201 creates BIMONTHLY FIRST run', async () => {
    mockRunFindFirst.mockResolvedValue(null);
    mockRunCreate.mockResolvedValue({
      id: 'run-bm-1', period: '2026-05', runType: 'BIMONTHLY',
      periodHalf: 'FIRST', status: 'DRAFT',
    });
    const res = await request(app)
      .post('/payroll/runs')
      .send({ period: '2026-05', runType: 'BIMONTHLY', periodHalf: 'FIRST' });
    expect(res.status).toBe(201);
    expect(res.body.periodHalf).toBe('FIRST');
  });

  test('K5 — POST 409 rejects duplicate BIMONTHLY+SECOND for same period', async () => {
    mockRunFindFirst.mockResolvedValue({
      id: 'run-existing', period: '2026-05', runType: 'BIMONTHLY',
      periodHalf: 'SECOND', status: 'DRAFT',
    });
    const res = await request(app)
      .post('/payroll/runs')
      .send({ period: '2026-05', runType: 'BIMONTHLY', periodHalf: 'SECOND' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/SECOND half/);
  });

  test('K6 — FIRST and SECOND halves are independent (FIRST exists → SECOND allowed)', async () => {
    // findFirst is called scoped to the requested half — return null for SECOND
    mockRunFindFirst.mockResolvedValue(null);
    mockRunCreate.mockResolvedValue({
      id: 'run-bm-2', period: '2026-05', runType: 'BIMONTHLY',
      periodHalf: 'SECOND', status: 'DRAFT',
    });
    const res = await request(app)
      .post('/payroll/runs')
      .send({ period: '2026-05', runType: 'BIMONTHLY', periodHalf: 'SECOND' });
    expect(res.status).toBe(201);
    expect(mockRunFindFirst).toHaveBeenCalledWith({
      where: { period: '2026-05', runType: 'BIMONTHLY', periodHalf: 'SECOND' },
    });
  });
});

// ── PAY-001) Supplemental run auto-trim on compute ────────────────────────────
describe('PAY-001) Supplemental run auto-trim on compute', () => {
  const cpfRates = [
    { id: 'rate-1', citizenStatus: 'SC', ageFrom: 0, ageTo: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 7400, awCeiling: 102000, isActive: true },
  ];
  const sdlConfig = { rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500, isActive: true };

  let savedFetch;
  beforeAll(() => { savedFetch = global.fetch; });

  beforeEach(() => {
    mockCpfRateFindMany.mockResolvedValue(cpfRates);
    mockSdlConfigFindFirst.mockResolvedValue(sdlConfig);
    mockLineItemFindMany.mockResolvedValue([]);
    mockPeriodConfigFindUnique.mockResolvedValue(null);
    mockPublicHolidayFindMany.mockResolvedValue([]);
    mockRunUpdate.mockResolvedValue({});
    installFetchMock({ applications: [] });
  });
  afterEach(() => { global.fetch = savedFetch; });

  const baseEmp = {
    employeeId: 'emp-001', employeeCode: 'EMP-001', fullName: 'Alice Tan',
    ow: 5000, aw: 0, grossPay: 5000,
    citizenStatus: 'SC', age: 35,
    ytdOw: 5000, ytdAw: 0, ytdGross: 5000, ytdEmployeeCpf: 1000, ytdEmployerCpf: 850,
  };

  test('K7 — BONUS run with prior payslip: OW is trimmed to 0; only paycode delta contributes', async () => {
    mockRunFindUnique.mockResolvedValue({
      id: 'run-bonus', period: '2026-05', runType: 'BONUS', status: 'DRAFT',
      initiatedBy: 'admin-001', periodHalf: null,
    });
    // Prior MONTHLY payslip exists for this employee in this period
    mockPayslipFindMany.mockResolvedValue([{
      employeeId: 'emp-001',
      basicSalaryEnc: '5000', grossPayEnc: '5000', netPayEnc: '4000',
      ytdGrossEnc: '5000', ytdEmployeeCpfEnc: '1000', ytdEmployerCpfEnc: '850',
    }]);
    // A $500 bonus paycode (AW)
    mockLineItemFindMany.mockResolvedValue([{
      employeeId: 'emp-001', amountEncrypted: '500',
      wageType: 'AW', isCpfApplicable: true,
    }]);

    const res = await request(app)
      .post('/payroll/runs/run-bonus/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    expect(res.body.autoTrimmedIds).toEqual(['emp-001']);
    const data = mockPayslipUpsert.mock.calls[0][0].create;
    // Basic salary is 0 because emp.ow was trimmed — consolidatePeriod's MAX
    // will preserve the prior payslip's $5000.
    expect(parseFloat(data.basicSalaryEnc)).toBe(0);
    // Gross = trimmed OW (0) + AW (500) = 500 — only the bonus delta, no double-count
    expect(parseFloat(data.grossPayEnc)).toBe(500);
  });

  test('K8 — ADHOC run, employee with prior + no paycodes: payslip is auto-removed', async () => {
    mockRunFindUnique.mockResolvedValue({
      id: 'run-adhoc', period: '2026-05', runType: 'ADHOC', status: 'DRAFT',
      initiatedBy: 'admin-001', periodHalf: null,
    });
    mockPayslipFindMany.mockResolvedValue([{
      employeeId: 'emp-001',
      basicSalaryEnc: '5000', grossPayEnc: '5000', netPayEnc: '4000',
      ytdGrossEnc: '5000', ytdEmployeeCpfEnc: '1000', ytdEmployerCpfEnc: '850',
    }]);
    mockLineItemFindMany.mockResolvedValue([]); // no paycodes

    const res = await request(app)
      .post('/payroll/runs/run-adhoc/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    expect(res.body.autoRemovedIds).toEqual(['emp-001']);
    expect(mockPayslipDeleteMany).toHaveBeenCalledWith({
      where: { runId: 'run-adhoc', employeeId: { in: ['emp-001'] } },
    });
  });

  test('K9 — MONTHLY run does not trigger trim (no priorPayslip fetch on primary)', async () => {
    mockRunFindUnique.mockResolvedValue({
      id: 'run-m', period: '2026-05', runType: 'MONTHLY', status: 'DRAFT',
      initiatedBy: 'admin-001', periodHalf: null,
    });
    mockLineItemFindMany.mockResolvedValue([]);

    const res = await request(app)
      .post('/payroll/runs/run-m/compute')
      .send({ employees: [baseEmp] });

    expect(res.status).toBe(200);
    expect(res.body.autoTrimmedIds).toBeUndefined();
    // MONTHLY runs don't query prior payslips — payslipFindMany should not be
    // called with the supplemental's "exclude this run" filter.
    const calls = mockPayslipFindMany.mock.calls.filter(c =>
      c[0]?.where?.runId?.not === 'run-m'
    );
    expect(calls.length).toBe(0);
  });

  test('K10 — BIMONTHLY FIRST run uses days 1-15 boundary (mid-month leaver still gets full half pay)', async () => {
    mockRunFindUnique.mockResolvedValue({
      id: 'run-bm', period: '2026-05', runType: 'BIMONTHLY', status: 'DRAFT',
      initiatedBy: 'admin-001', periodHalf: 'FIRST',
    });
    mockLineItemFindMany.mockResolvedValue([]);
    const emp = { ...baseEmp, startDate: '2020-01-01', endDate: null };

    const res = await request(app)
      .post('/payroll/runs/run-bm/compute')
      .send({ employees: [emp] });

    expect(res.status).toBe(200);
    // No proration warnings expected — employee covers the full 1-15 half
    const data = mockPayslipUpsert.mock.calls[0][0].create;
    expect(parseFloat(data.basicSalaryEnc)).toBe(5000);
  });
});

// ── PAY-001) Maker-checker DB violation surfaces as 403 ──────────────────────
describe('PAY-001) Maker-checker DB constraint violation → 403', () => {
  test('K11 — approve where DB raises payroll_runs_maker_checker_diff returns 403', async () => {
    // Run is PENDING_APPROVAL; app-level check would normally catch but is bypassed
    // here by env (DISABLE_MAKER_CHECKER=true) — we still want the DB CHECK to
    // surface cleanly as 403. Simulate by raising the matching DB error.
    process.env.DISABLE_MAKER_CHECKER = 'true';
    mockRunFindUnique.mockResolvedValue({
      id: 'run-pending', period: '2026-05', status: 'PENDING_APPROVAL',
      initiatedBy: 'admin-001',
    });
    mockRunUpdate.mockRejectedValue(new Error(
      'new row for relation "payroll_runs" violates check constraint "payroll_runs_maker_checker_diff"'
    ));

    const res = await request(app).post('/payroll/runs/run-pending/approve');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/database level/);

    delete process.env.DISABLE_MAKER_CHECKER;
  });

  test('K12 — approve still 403 at app level when DISABLE_MAKER_CHECKER not set and initiator==approver', async () => {
    mockRunFindUnique.mockResolvedValue({
      id: 'run-pending', period: '2026-05', status: 'PENDING_APPROVAL',
      initiatedBy: 'admin-001', // matches the mocked req.user.sub
    });
    const res = await request(app).post('/payroll/runs/run-pending/approve');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Maker-checker/);
  });
});
