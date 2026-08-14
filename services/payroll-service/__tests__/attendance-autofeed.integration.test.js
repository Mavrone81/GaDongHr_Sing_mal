'use strict';
process.env.INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || 'test-internal-key-2025';
/**
 * TAT-005 regression: payroll /runs/:id/compute consumes the attendance
 * period summary from attendance-service and materializes OT_PAY,
 * ABSENCE_DED, PH_WORK line items.
 *
 * Cases:
 *   A) Period status ≠ APPROVED_FOR_PAYROLL → 200 with attendanceNotApproved warning
 *      (payroll proceeds; attendance auto-feed skipped; audit log written)
 *   B) attendanceOverride: true still accepted (no-op; auto-feed still skipped)
 *   C) Approved + OT hours → OT_PAY line item created at 1.5× hourly rate
 *   D) Approved + absent days → ABSENCE_DED line item created at -dailyRate × days
 *   E) Approved + PH worked days → PH_WORK line item created at +dailyRate × days
 *   F) Manual Wins — existing OT_PAY line item suppresses the auto-feed
 *      for THAT employee/code (other employees + codes still apply)
 *   G) Pay component missing → auto-feed silently skips that code
 *   H) Attendance fetch fails → 200, no auto-feed, fetchFailed flag (no warning written)
 */

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER', EMPLOYEE: 'EMPLOYEE' },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encrypt: v => v, decrypt: v => v,
  encryptNumber: v => String(v), decryptNumber: v => parseFloat(v),
}), { virtual: true });

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

const mockRunFindUnique = jest.fn();
const mockRunUpdate     = jest.fn().mockResolvedValue({});
const mockCpfRateFindMany = jest.fn();
const mockSdlConfigFindFirst = jest.fn();
const mockLineItemFindMany = jest.fn();
const mockLineItemCreate   = jest.fn();
const mockPayCompFindMany  = jest.fn();
const mockPayslipUpsert    = jest.fn().mockResolvedValue({});
const mockPayslipFindMany  = jest.fn().mockResolvedValue([]);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    payrollRun:           { findUnique: mockRunFindUnique, update: mockRunUpdate, findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    payrollLineItem:      { findMany: mockLineItemFindMany, create: mockLineItemCreate, delete: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    // ENT-006 dual-write target.
    payslipStatutoryLine: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    payslip:              { upsert: mockPayslipUpsert, findMany: mockPayslipFindMany, deleteMany: jest.fn(), createMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    cpfRate:              { findMany: mockCpfRateFindMany },
    sdlConfig:            { findFirst: mockSdlConfigFindFirst },
    payComponent:         { findMany: mockPayCompFindMany, findUnique: jest.fn() },
    payrollComponent:     { findMany: jest.fn().mockResolvedValue([]) },
    payrollOverride:      { findMany: jest.fn().mockResolvedValue([]) },
    payrollPeriodConfig:  { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    publicHoliday:        { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), delete: jest.fn() },
    auditLog:             { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

const request = require('supertest');
const app = require('../src/index');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DRAFT_RUN = { id: 'run-001', period: '2026-05', legalEntityId: 'ent-1', runType: 'MONTHLY', status: 'DRAFT' };
const CPF_RATES = [{ id: 'r1', citizenStatus: 'SC', ageFrom: 0, ageTo: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 6800, awCeiling: 102000, isActive: true }];
const SDL_CONFIG = { rate: 0.0025, minAmount: 2.0, maxAmount: 11.25, salaryCap: 4500, isActive: true };
const EMP_A = { employeeId: 'emp-A', fullName: 'Alice', ow: 5000, grossPay: 5000, citizenStatus: 'SC', age: 35, ytdOw: 0, ytdAw: 0, ytdGross: 0, ytdEmployeeCpf: 0, ytdEmployerCpf: 0 };
const EMP_B = { employeeId: 'emp-B', fullName: 'Bob',   ow: 5000, grossPay: 5000, citizenStatus: 'SC', age: 35, ytdOw: 0, ytdAw: 0, ytdGross: 0, ytdEmployeeCpf: 0, ytdEmployerCpf: 0 };

const PAY_COMPONENTS = [
  { id: 'pc-ot',  code: 'OT_PAY',      isActive: true },
  { id: 'pc-abs', code: 'ABSENCE_DED', isActive: true },
  { id: 'pc-ph',  code: 'PH_WORK',     isActive: true },
];

// May 2026 has 21 working days (Mon-Fri), no PHs configured.
const MAY_WORKING_DAYS = 21;
const DAILY_RATE = 5000 / MAY_WORKING_DAYS; // ≈ 238.10
const HOURLY_RATE = DAILY_RATE / 8;          // ≈ 29.76

function installAttendanceFetch(periodStatus, summary, attendanceError = false) {
  global.fetch = jest.fn().mockImplementation((url, init) => {
    if (typeof url === 'string' && url.includes('/attendance/internal/period-summary')) {
      if (attendanceError) return Promise.reject(new Error('attendance unreachable'));
      return Promise.resolve({
        ok: true,
        json: async () => ({ periodStatus, summary, expectedWorkDays: MAY_WORKING_DAYS }),
      });
    }
    // Entity resolution + statutory computation moved out of process in P1.
    // Handled here so the auto-feed assertions below are unaffected by it.
    if (typeof url === 'string' && url.includes('/tenants/internal/entities/')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        id: 'ent-1', tenantId: 'ten-1', country: 'SG', currency: 'SGD',
        timezone: 'Asia/Singapore', state: null, statutoryIds: {},
      }) });
    }
    if (typeof url === 'string' && url.includes('/statutory/compute-batch')) {
      const body = JSON.parse((init && init.body) || '{}');
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        rateVersion: 'SG-TEST',
        results: (body.employees || []).map(e => ({
          employeeId: e.employeeId,
          employeeDeductions: [], employerContributions: [], employerLevies: [],
        })),
      }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ applications: [] }) });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRunFindUnique.mockResolvedValue(DRAFT_RUN);
  mockCpfRateFindMany.mockResolvedValue(CPF_RATES);
  mockSdlConfigFindFirst.mockResolvedValue(SDL_CONFIG);
  mockLineItemFindMany.mockResolvedValue([]); // no pre-existing line items
  mockPayCompFindMany.mockResolvedValue(PAY_COMPONENTS);
  mockRunUpdate.mockResolvedValue({});
  mockLineItemCreate.mockImplementation(({ data }) => Promise.resolve({ ...data }));
});

// ── A) Unapproved attendance → 200 with warning (payroll proceeds) ───────────

describe('A) Attendance approval gate — auto-proceed with warning', () => {
  test('OPEN → 200, attendanceNotApproved warning included, auto-feed skipped', async () => {
    installAttendanceFetch('OPEN', {});
    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [EMP_A] });
    expect(res.status).toBe(200);
    expect(res.body.warnings?.attendanceNotApproved).toBeDefined();
    expect(res.body.warnings.attendanceNotApproved.periodStatus).toBe('OPEN');
    expect(res.body.attendance.applied).toBe(false);
    // Payslip is still computed.
    expect(mockPayslipUpsert).toHaveBeenCalled();
  });

  test('LOCKED → 200, warning references locked status, auto-feed skipped', async () => {
    installAttendanceFetch('LOCKED', {});
    const res = await request(app).post('/payroll/runs/run-001/compute').send({ employees: [EMP_A] });
    expect(res.status).toBe(200);
    expect(res.body.warnings?.attendanceNotApproved.periodStatus).toBe('LOCKED');
    expect(res.body.attendance.applied).toBe(false);
  });

  test('attendanceOverride:true still accepted; no auto-feed applied', async () => {
    installAttendanceFetch('LOCKED', { 'emp-A': { otHours: 5, absentDays: 0, phWorkedDays: 0 } });
    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [EMP_A], attendanceOverride: true });
    expect(res.status).toBe(200);
    expect(mockLineItemCreate).not.toHaveBeenCalled();
    expect(res.body.attendance.applied).toBe(false);
  });
});

// ── B) OT_PAY materialization ───────────────────────────────────────────────

describe('B) OT_PAY auto-feed', () => {
  test('approved + 5h OT → one OT_PAY line item at 1.5× hourly rate', async () => {
    installAttendanceFetch('APPROVED_FOR_PAYROLL', {
      'emp-A': { otHours: 5, absentDays: 0, phWorkedDays: 0 },
    });
    const res = await request(app).post('/payroll/runs/run-001/compute').send({ employees: [EMP_A] });
    expect(res.status).toBe(200);

    const otCalls = mockLineItemCreate.mock.calls.filter(c => c[0].data.componentId === 'pc-ot');
    expect(otCalls).toHaveLength(1);
    const amount = parseFloat(otCalls[0][0].data.amountEncrypted);
    expect(amount).toBeCloseTo(HOURLY_RATE * 1.5 * 5, 2);
    expect(otCalls[0][0].data.wageType).toBe('OW');
    expect(otCalls[0][0].data.isCpfApplicable).toBe(true);

    expect(res.body.attendance.applied).toBe(true);
    expect(res.body.attendance.autoFeedItemsByEmployee['emp-A']).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'OT_PAY' })])
    );
  });

  test('zero OT hours → no OT_PAY line item', async () => {
    installAttendanceFetch('APPROVED_FOR_PAYROLL', {
      'emp-A': { otHours: 0, absentDays: 0, phWorkedDays: 0 },
    });
    const res = await request(app).post('/payroll/runs/run-001/compute').send({ employees: [EMP_A] });
    expect(res.status).toBe(200);
    const otCalls = mockLineItemCreate.mock.calls.filter(c => c[0].data.componentId === 'pc-ot');
    expect(otCalls).toHaveLength(0);
  });
});

// ── C) ABSENCE_DED materialization ──────────────────────────────────────────

describe('C) ABSENCE_DED auto-feed', () => {
  test('2 absent days → one ABSENCE_DED line item at -dailyRate × 2', async () => {
    installAttendanceFetch('APPROVED_FOR_PAYROLL', {
      'emp-A': { otHours: 0, absentDays: 2, phWorkedDays: 0 },
    });
    const res = await request(app).post('/payroll/runs/run-001/compute').send({ employees: [EMP_A] });
    expect(res.status).toBe(200);
    const absCalls = mockLineItemCreate.mock.calls.filter(c => c[0].data.componentId === 'pc-abs');
    expect(absCalls).toHaveLength(1);
    const amount = parseFloat(absCalls[0][0].data.amountEncrypted);
    expect(amount).toBeCloseTo(-DAILY_RATE * 2, 2);
    expect(absCalls[0][0].data.wageType).toBe('DEDUCTION');
    expect(absCalls[0][0].data.isCpfApplicable).toBe(false);
  });
});

// ── D) PH_WORK materialization ──────────────────────────────────────────────

describe('D) PH_WORK auto-feed', () => {
  test('1 PH worked day → one PH_WORK line item at +dailyRate', async () => {
    installAttendanceFetch('APPROVED_FOR_PAYROLL', {
      'emp-A': { otHours: 0, absentDays: 0, phWorkedDays: 1 },
    });
    const res = await request(app).post('/payroll/runs/run-001/compute').send({ employees: [EMP_A] });
    expect(res.status).toBe(200);
    const phCalls = mockLineItemCreate.mock.calls.filter(c => c[0].data.componentId === 'pc-ph');
    expect(phCalls).toHaveLength(1);
    const amount = parseFloat(phCalls[0][0].data.amountEncrypted);
    expect(amount).toBeCloseTo(DAILY_RATE, 2);
  });
});

// ── E) Manual Wins ──────────────────────────────────────────────────────────

describe('E) Manual Wins: existing line item suppresses auto-feed for that employee/code', () => {
  test('manual OT_PAY on emp-A → auto-feed skips OT_PAY for emp-A, applies for emp-B', async () => {
    // Pre-existing manual OT_PAY entry for emp-A only.
    mockLineItemFindMany.mockResolvedValue([
      { id: 'manual-ot-A', runId: 'run-001', employeeId: 'emp-A', componentId: 'pc-ot', wageType: 'OW', isCpfApplicable: true, amountEncrypted: '200' },
    ]);
    installAttendanceFetch('APPROVED_FOR_PAYROLL', {
      'emp-A': { otHours: 5, absentDays: 0, phWorkedDays: 0 },
      'emp-B': { otHours: 5, absentDays: 0, phWorkedDays: 0 },
    });

    const res = await request(app).post('/payroll/runs/run-001/compute').send({ employees: [EMP_A, EMP_B] });
    expect(res.status).toBe(200);

    const otCalls = mockLineItemCreate.mock.calls.filter(c => c[0].data.componentId === 'pc-ot');
    // Auto-feed creates OT_PAY for emp-B only — emp-A's manual entry preempts.
    expect(otCalls).toHaveLength(1);
    expect(otCalls[0][0].data.employeeId).toBe('emp-B');

    // Skip was logged.
    expect(res.body.attendance.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ employeeId: 'emp-A', code: 'OT_PAY', reason: 'manual line item present' }),
      ])
    );
  });
});

// ── F) Pay component missing → silent skip ──────────────────────────────────

describe('F) Pay component not configured', () => {
  test('OT_PAY component disabled → auto-feed logs skip but does not error', async () => {
    mockPayCompFindMany.mockResolvedValue(PAY_COMPONENTS.filter(c => c.code !== 'OT_PAY'));
    installAttendanceFetch('APPROVED_FOR_PAYROLL', {
      'emp-A': { otHours: 5, absentDays: 0, phWorkedDays: 0 },
    });
    const res = await request(app).post('/payroll/runs/run-001/compute').send({ employees: [EMP_A] });
    expect(res.status).toBe(200);
    expect(mockLineItemCreate.mock.calls.filter(c => c[0].data.componentId === 'pc-ot')).toHaveLength(0);
    expect(res.body.attendance.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ employeeId: 'emp-A', code: 'OT_PAY', reason: 'pay component not configured' }),
      ])
    );
  });
});

// ── G) Attendance service unreachable → 200, no auto-feed, fetchFailed flag ──

describe('G) Attendance service unreachable', () => {
  test('fetch rejects → 200, no auto-feed, fetchFailed flag set, no attendance warning written', async () => {
    installAttendanceFetch('OPEN', {}, /* attendanceError= */ true);
    const res = await request(app).post('/payroll/runs/run-001/compute').send({ employees: [EMP_A] });
    expect(res.status).toBe(200);
    expect(res.body.attendance.applied).toBe(false);
    expect(res.body.attendance.fetchFailed).toBe(true);
    // No warning when we couldn't even reach attendance — we don't know the status.
    expect(res.body.warnings?.attendanceNotApproved).toBeUndefined();
  });

  test('fetch rejects + attendanceOverride:true → 200, no auto-feed, fetchFailed flag set', async () => {
    installAttendanceFetch('OPEN', {}, true);
    const res = await request(app)
      .post('/payroll/runs/run-001/compute')
      .send({ employees: [EMP_A], attendanceOverride: true });
    expect(res.status).toBe(200);
    expect(res.body.attendance.applied).toBe(false);
    expect(res.body.attendance.fetchFailed).toBe(true);
    expect(mockLineItemCreate).not.toHaveBeenCalled();
  });
});
