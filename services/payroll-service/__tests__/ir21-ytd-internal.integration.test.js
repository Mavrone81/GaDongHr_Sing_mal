'use strict';
/**
 * Integration tests for GET /payroll/internal/ir21-ytd/:employeeId/:year
 * (added for OFF-004 — IR21 auto-population support)
 *
 * Cases:
 *   P1 — returns 403 with wrong internal key
 *   P2 — returns 403 with missing header
 *   P3 — returns correct YTD aggregation (payslip + AW + BIK + ESOP)
 *   P4 — returns zeroes when no payslip exists for employee
 *   P5 — picks the payslip with highest ytdGross (max-YTD dedup)
 *   P6 — returns 400 for invalid year
 */

// ── Shared mocks ──────────────────────────────────────────────────────────────

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { sub: 'admin-001', role: 'HR_ADMIN' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER', EMPLOYEE: 'EMPLOYEE' },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encrypt: v => v,
  decrypt: v => v,
  encryptNumber: v => String(v),
  decryptNumber: v => parseFloat(v),
}), { virtual: true });

jest.mock('pdfkit', () => {
  const { EventEmitter } = require('events');
  return jest.fn(() => {
    const ee = new EventEmitter();
    ee.font = () => ee; ee.fontSize = () => ee; ee.text = () => ee;
    ee.moveDown = () => ee; ee.lineTo = () => ee; ee.stroke = () => ee;
    ee.moveTo = () => ee; ee.pipe = () => {}; ee.end = () => ee.emit('end');
    return ee;
  });
});

// ── Prisma model mocks ────────────────────────────────────────────────────────
const mockPayslipFindMany  = jest.fn();
const mockLineItemFindMany = jest.fn();
const mockBikFindMany      = jest.fn();
const mockExerciseFindMany = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    // ENT-006 dual-write target. Payroll writes one row per statutory
    // figure alongside the legacy SG-named columns.
    payslipStatutoryLine: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    payslip: {
      findMany: mockPayslipFindMany,
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    payrollRun: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    payrollLineItem: { findMany: mockLineItemFindMany, create: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    bikItem: { findMany: mockBikFindMany, findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    stockOptionGrant: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    stockOptionExercise: { findMany: mockExerciseFindMany, create: jest.fn() },
    cpfRateTable: { findFirst: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    payrollComponent: { findMany: jest.fn() },
    costCentre: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    employeeCostCentreAllocation: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    payrollJournalEntry: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $disconnect: jest.fn(),
  })),
}));

// global.fetch needed by payroll-service for attendance service calls
global.fetch = jest.fn();

process.env.INTERNAL_SERVICE_KEY = 'test-internal-key-123';

const request = require('supertest');
const app = require('../src/index');

const IKEY = 'test-internal-key-123';

beforeEach(() => {
  jest.clearAllMocks();
  mockPayslipFindMany.mockResolvedValue([]);
  mockLineItemFindMany.mockResolvedValue([]);
  mockBikFindMany.mockResolvedValue([]);
  mockExerciseFindMany.mockResolvedValue([]);
});

// ── P1: wrong internal key → 403 ─────────────────────────────────────────────
test('P1 — wrong internal key returns 403', async () => {
  const res = await request(app)
    .get('/payroll/internal/ir21-ytd/emp-001/2026')
    .set('x-internal-service-key', 'wrong-key');
  expect(res.status).toBe(403);
});

// ── P2: missing header → 403 ──────────────────────────────────────────────────
test('P2 — missing internal key header returns 403', async () => {
  const res = await request(app)
    .get('/payroll/internal/ir21-ytd/emp-001/2026');
  expect(res.status).toBe(403);
});

// ── P3: full aggregation ──────────────────────────────────────────────────────
test('P3 — returns correct YTD aggregation including BIK and ESOP', async () => {
  mockPayslipFindMany.mockResolvedValue([{
    employeeId: 'emp-001',
    period: '2026-10',
    isPublished: true,
    ytdGrossEnc: '80000',
    ytdEmployeeCpfEnc: '9600',
    ytdEmployerCpfEnc: '11200',
  }]);
  mockLineItemFindMany.mockResolvedValue([
    { employeeId: 'emp-001', wageType: 'AW', isIrasTaxable: true, amountEnc: '5000' },
    { employeeId: 'emp-001', wageType: 'AW', isIrasTaxable: true, amountEnc: '3000' },
  ]);
  mockBikFindMany.mockResolvedValue([
    { employeeId: 'emp-001', year: 2026, annualValueEnc: '2400' },
  ]);
  mockExerciseFindMany.mockResolvedValue([
    { taxableGainEnc: '10000', grant: { employeeId: 'emp-001' } },
  ]);

  const res = await request(app)
    .get('/payroll/internal/ir21-ytd/emp-001/2026')
    .set('x-internal-service-key', IKEY);

  expect(res.status).toBe(200);
  expect(res.body.employeeId).toBe('emp-001');
  expect(res.body.year).toBe('2026');
  expect(res.body.employmentIncome).toBe(80000);
  expect(res.body.awIncome).toBe(8000);        // 5000 + 3000
  expect(res.body.benefitsInKind).toBe(2400);
  expect(res.body.stockOptionGain).toBe(10000);
  expect(res.body.employeeCpf).toBe(9600);
  expect(res.body.employerCpf).toBe(11200);
  expect(res.body.totalTaxableIncome).toBe(100400); // 80000+8000+2400+10000
});

// ── P4: no payslip → zeroes ───────────────────────────────────────────────────
test('P4 — returns zeroes when no payslip exists for employee', async () => {
  const res = await request(app)
    .get('/payroll/internal/ir21-ytd/emp-999/2026')
    .set('x-internal-service-key', IKEY);

  expect(res.status).toBe(200);
  expect(res.body.employmentIncome).toBe(0);
  expect(res.body.awIncome).toBe(0);
  expect(res.body.totalTaxableIncome).toBe(0);
});

// ── P5: picks payslip with max YTD gross ──────────────────────────────────────
test('P5 — picks payslip with highest ytdGross across multiple published payslips', async () => {
  mockPayslipFindMany.mockResolvedValue([
    { employeeId: 'emp-001', period: '2026-03', isPublished: true, ytdGrossEnc: '20000', ytdEmployeeCpfEnc: '2400', ytdEmployerCpfEnc: '2800' },
    { employeeId: 'emp-001', period: '2026-10', isPublished: true, ytdGrossEnc: '80000', ytdEmployeeCpfEnc: '9600', ytdEmployerCpfEnc: '11200' },
    { employeeId: 'emp-001', period: '2026-07', isPublished: true, ytdGrossEnc: '50000', ytdEmployeeCpfEnc: '6000', ytdEmployerCpfEnc: '7000' },
  ]);

  const res = await request(app)
    .get('/payroll/internal/ir21-ytd/emp-001/2026')
    .set('x-internal-service-key', IKEY);

  expect(res.status).toBe(200);
  expect(res.body.employmentIncome).toBe(80000); // picks the max
  expect(res.body.employeeCpf).toBe(9600);
});

// ── P6: invalid year → 400 ────────────────────────────────────────────────────
test('P6 — invalid year parameter returns 400', async () => {
  const res = await request(app)
    .get('/payroll/internal/ir21-ytd/emp-001/not-a-year')
    .set('x-internal-service-key', IKEY);
  expect(res.status).toBe(400);
});
