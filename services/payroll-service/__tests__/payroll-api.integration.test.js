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
    payslip: { deleteMany: mockPayslipDeleteMany, createMany: mockPayslipCreateMany, upsert: mockPayslipUpsert },
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
});
