'use strict';
/**
 * Integration tests for TAT-004 anomaly routes:
 *
 *   GET    /attendance/thresholds
 *   PUT    /attendance/thresholds
 *   POST   /attendance/anomalies/sweep
 *   GET    /attendance/anomalies
 *   PUT    /attendance/anomalies/:id/acknowledge
 *   PUT    /attendance/anomalies/:id/explain
 *   PUT    /attendance/anomalies/:id/dismiss
 *   POST   /attendance/anomalies/manager-summary
 *   GET    /attendance/today/dashboard
 */

let mockUser = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN', employeeId: null };
const setUser = (u) => { mockUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...allowed) => (req, res, next) => {
    const ok = allowed.some(a => a === req.user?.role || (req.user?.permissions || []).includes(a));
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

// Prisma mocks
const mockThresholdFindUnique = jest.fn();
const mockThresholdUpsert     = jest.fn();
const mockAnomalyFindMany     = jest.fn();
const mockAnomalyFindUnique   = jest.fn();
const mockAnomalyUpdate       = jest.fn();
const mockAnomalyUpsert       = jest.fn();
const mockRecordFindMany      = jest.fn();
const mockRosterFindMany      = jest.fn();
const mockRosterFindUnique    = jest.fn();
const mockAuditCreate         = jest.fn().mockResolvedValue({});

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    anomalyThreshold:  { findUnique: mockThresholdFindUnique, upsert: mockThresholdUpsert },
    attendanceAnomaly: { findMany: mockAnomalyFindMany, findUnique: mockAnomalyFindUnique, update: mockAnomalyUpdate, upsert: mockAnomalyUpsert },
    attendanceRecord:  { findMany: mockRecordFindMany, findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    rosterEntry:       { findMany: mockRosterFindMany, findUnique: mockRosterFindUnique },
    attendancePeriod:  { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    auditLog:          { create: mockAuditCreate },
    employeeWorkLocation: { findMany: jest.fn().mockResolvedValue([]) },
    shiftTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    workingShift:  { findMany: jest.fn().mockResolvedValue([]) },
    workLocation:  { findMany: jest.fn().mockResolvedValue([]) },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
jest.mock('/app/shared/payroll-utils', () => ({ countWorkingDays: () => 22 }), { virtual: true });

// global.fetch stub so the manager-summary and dashboard email/leave calls don't blow up
global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ([]) });

const request = require('supertest');
const app = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN', employeeId: null });
  global.fetch.mockResolvedValue({ ok: true, json: async () => ([]) });
});

// ── Thresholds ─────────────────────────────────────────────────────────────

describe('Thresholds', () => {
  test('T1 — GET returns defaults when no row exists', async () => {
    mockThresholdFindUnique.mockResolvedValueOnce(null);
    const res = await request(app).get('/attendance/thresholds');
    expect(res.status).toBe(200);
    expect(res.body.lateThresholdMin).toBe(15);
    expect(res.body.monthlyOtAlertHours).toBe(60);
  });

  test('T2 — PUT upserts the singleton', async () => {
    mockThresholdUpsert.mockResolvedValueOnce({
      id: 1, lateThresholdMin: 30, earlyDepartThresholdMin: 15,
      dailyOtThresholdHours: 4, monthlyOtAlertHours: 60, missingClockOutGraceHours: 2,
    });
    const res = await request(app).put('/attendance/thresholds').send({ lateThresholdMin: 30 });
    expect(res.status).toBe(200);
    expect(res.body.lateThresholdMin).toBe(30);
    expect(mockThresholdUpsert).toHaveBeenCalled();
  });

  test('T3 — PUT rejects negative values with 400', async () => {
    const res = await request(app).put('/attendance/thresholds').send({ dailyOtThresholdHours: -1 });
    expect(res.status).toBe(400);
  });

  test('T4 — PUT 403 for non-admin role', async () => {
    setUser({ sub: 'lm-1', role: 'LINE_MANAGER' });
    const res = await request(app).put('/attendance/thresholds').send({ lateThresholdMin: 30 });
    expect(res.status).toBe(403);
  });
});

// ── Sweep ─────────────────────────────────────────────────────────────────

describe('POST /attendance/anomalies/sweep', () => {
  test('T5 — rejects missing from/to with 400', async () => {
    const res = await request(app).post('/attendance/anomalies/sweep').send({});
    expect(res.status).toBe(400);
  });

  test('T6 — rejects from > to with 400', async () => {
    const res = await request(app).post('/attendance/anomalies/sweep').send({ from: '2026-05-19', to: '2026-05-18' });
    expect(res.status).toBe(400);
  });

  test('T7 — sweep with late + missing-clock-out + AWOL creates anomaly rows', async () => {
    mockThresholdFindUnique.mockResolvedValue(null); // defaults
    mockRecordFindMany.mockImplementation(async ({ where }) => {
      // First call: in-range records for sweep window
      // Second call onward: monthly OT aggregation
      const fromMs = where.date?.gte?.getTime?.();
      const toMs   = where.date?.lte?.getTime?.();
      if (fromMs && toMs && toMs - fromMs < 2 * 24 * 3600 * 1000) {
        return [
          // Late arrival 30 min
          {
            id: 'r1', employeeId: 'e1', date: new Date('2026-05-19T00:00:00Z'),
            clockIn:  new Date('2026-05-19T01:30:00Z'),
            clockOut: new Date('2026-05-19T09:30:00Z'),
            scheduledStart: new Date('2026-05-19T01:00:00Z'),
            scheduledEnd:   new Date('2026-05-19T09:30:00Z'),
            status: 'LATE', otHours: 0,
          },
        ];
      }
      // Monthly aggregation — return same record (60h OT to trigger breach)
      return [{ employeeId: 'e1', date: new Date('2026-05-19T00:00:00Z'), otHours: 65 }];
    });
    mockRosterFindMany.mockResolvedValue([
      // e2 is scheduled but has no record → AWOL
      {
        employeeId: 'e2', date: new Date('2026-05-19T00:00:00Z'),
        shiftTemplate: { startTime: '09:00', endTime: '17:30', breakMinutes: 60, hoursPerDay: 8, graceMinutesEarly: 15, graceMinutesLate: 15 },
        workingShift: null, shiftPattern: null,
      },
    ]);
    mockRosterFindUnique.mockResolvedValue({
      shiftTemplate: { startTime: '09:00', endTime: '17:30', breakMinutes: 60, hoursPerDay: 8, graceMinutesEarly: 15, graceMinutesLate: 15 },
      workingShift: null, shiftPattern: null,
    });
    mockAnomalyUpsert.mockImplementation(async ({ create }) => ({ ...create, detectedAt: new Date('2026-05-20T00:30:00Z'), updatedAt: new Date('2026-05-20T00:30:00Z') }));

    const res = await request(app).post('/attendance/anomalies/sweep').send({ from: '2026-05-19', to: '2026-05-19' });
    expect(res.status).toBe(200);
    expect(res.body.swept).toBe(1);
    expect(res.body.byType.LATE_ARRIVAL).toBeGreaterThanOrEqual(1);
    expect(res.body.byType.AWOL).toBeGreaterThanOrEqual(1);
    expect(res.body.byType.MONTHLY_OT_BREACH).toBeGreaterThanOrEqual(1);
  });

  test('T8 — re-sweep is idempotent (upsert on unique key)', async () => {
    mockThresholdFindUnique.mockResolvedValue(null);
    mockRecordFindMany.mockResolvedValue([
      {
        id: 'r1', employeeId: 'e1', date: new Date('2026-05-19T00:00:00Z'),
        clockIn:  new Date('2026-05-19T01:30:00Z'),
        clockOut: new Date('2026-05-19T09:30:00Z'),
        scheduledStart: new Date('2026-05-19T01:00:00Z'),
        scheduledEnd:   new Date('2026-05-19T09:30:00Z'),
        status: 'LATE', otHours: 0,
      },
    ]);
    mockRosterFindMany.mockResolvedValue([]);
    // Simulate row already exists: detectedAt < updatedAt
    mockAnomalyUpsert.mockResolvedValue({
      id: 'a1', detectedAt: new Date('2026-05-18T00:00:00Z'), updatedAt: new Date('2026-05-20T00:30:00Z'),
    });

    const res = await request(app).post('/attendance/anomalies/sweep').send({ from: '2026-05-19', to: '2026-05-19' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);
    expect(res.body.created).toBe(0);
    expect(mockAnomalyUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        employeeId_date_type: expect.objectContaining({ type: 'LATE_ARRIVAL' }),
      }),
    }));
  });

  test('T9 — 403 for LINE_MANAGER (not admin)', async () => {
    setUser({ sub: 'lm-1', role: 'LINE_MANAGER' });
    const res = await request(app).post('/attendance/anomalies/sweep').send({ from: '2026-05-19', to: '2026-05-19' });
    expect(res.status).toBe(403);
  });
});

// ── List + filters ─────────────────────────────────────────────────────────

describe('GET /attendance/anomalies', () => {
  test('T10 — returns rows + summary by status/type/severity', async () => {
    mockAnomalyFindMany.mockResolvedValueOnce([
      { id: 'a1', employeeId: 'e1', date: new Date('2026-05-19'), type: 'LATE_ARRIVAL',  severity: 'LOW',  status: 'PENDING' },
      { id: 'a2', employeeId: 'e1', date: new Date('2026-05-19'), type: 'AWOL',          severity: 'HIGH', status: 'PENDING' },
      { id: 'a3', employeeId: 'e2', date: new Date('2026-05-19'), type: 'EXCESSIVE_OT',  severity: 'MEDIUM', status: 'ACKNOWLEDGED' },
    ]);
    const res = await request(app).get('/attendance/anomalies');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.summary.byStatus.PENDING).toBe(2);
    expect(res.body.summary.byType.AWOL).toBe(1);
    expect(res.body.summary.bySeverity.HIGH).toBe(1);
  });

  test('T11 — applies status + type filters into the where clause', async () => {
    mockAnomalyFindMany.mockResolvedValueOnce([]);
    await request(app).get('/attendance/anomalies?status=PENDING&type=AWOL&from=2026-05-01&to=2026-05-31');
    const call = mockAnomalyFindMany.mock.calls[0][0];
    expect(call.where.status).toBe('PENDING');
    expect(call.where.type).toBe('AWOL');
    expect(call.where.date.gte).toBeInstanceOf(Date);
    expect(call.where.date.lte).toBeInstanceOf(Date);
  });
});

// ── Ack workflow ───────────────────────────────────────────────────────────

describe('Acknowledge / Explain / Dismiss', () => {
  test('T12 — acknowledge PENDING → ACKNOWLEDGED', async () => {
    mockAnomalyFindUnique.mockResolvedValueOnce({ id: 'a1', status: 'PENDING', employeeId: 'e1' });
    mockAnomalyUpdate.mockResolvedValueOnce({ id: 'a1', status: 'ACKNOWLEDGED', acknowledgedBy: 'admin-001' });
    const res = await request(app).put('/attendance/anomalies/a1/acknowledge').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACKNOWLEDGED');
  });

  test('T13 — acknowledge DISMISSED → 409', async () => {
    mockAnomalyFindUnique.mockResolvedValueOnce({ id: 'a1', status: 'DISMISSED', employeeId: 'e1' });
    const res = await request(app).put('/attendance/anomalies/a1/acknowledge').send({});
    expect(res.status).toBe(409);
  });

  test('T14 — acknowledge missing id → 404', async () => {
    mockAnomalyFindUnique.mockResolvedValueOnce(null);
    const res = await request(app).put('/attendance/anomalies/nope/acknowledge').send({});
    expect(res.status).toBe(404);
  });

  test('T15 — explain requires text body', async () => {
    mockAnomalyFindUnique.mockResolvedValueOnce({ id: 'a1', status: 'PENDING', employeeId: 'admin-001' });
    const res = await request(app).put('/attendance/anomalies/a1/explain').send({ explanation: '   ' });
    expect(res.status).toBe(400);
  });

  test('T16 — employee can only explain own anomaly', async () => {
    setUser({ sub: 'u-1', role: 'EMPLOYEE', employeeId: 'e-self' });
    mockAnomalyFindUnique.mockResolvedValueOnce({ id: 'a1', status: 'PENDING', employeeId: 'e-other' });
    const res = await request(app).put('/attendance/anomalies/a1/explain').send({ explanation: 'I was stuck in traffic' });
    expect(res.status).toBe(403);
  });

  test('T17 — manager can explain anyone, status → EXPLAINED', async () => {
    setUser({ sub: 'lm-1', role: 'LINE_MANAGER' });
    mockAnomalyFindUnique.mockResolvedValueOnce({ id: 'a1', status: 'PENDING', employeeId: 'e-other' });
    mockAnomalyUpdate.mockResolvedValueOnce({ id: 'a1', status: 'EXPLAINED', explanation: 'Approved late entry' });
    const res = await request(app).put('/attendance/anomalies/a1/explain').send({ explanation: 'Approved late entry' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EXPLAINED');
  });

  test('T18 — dismiss flips status + captures reason', async () => {
    mockAnomalyFindUnique.mockResolvedValueOnce({ id: 'a1', status: 'PENDING', employeeId: 'e1' });
    mockAnomalyUpdate.mockResolvedValueOnce({ id: 'a1', status: 'DISMISSED', dismissReason: 'false positive' });
    const res = await request(app).put('/attendance/anomalies/a1/dismiss').send({ reason: 'false positive' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISMISSED');
    expect(res.body.dismissReason).toBe('false positive');
  });

  test('T19 — double-dismiss → 409', async () => {
    mockAnomalyFindUnique.mockResolvedValueOnce({ id: 'a1', status: 'DISMISSED', employeeId: 'e1' });
    const res = await request(app).put('/attendance/anomalies/a1/dismiss').send({});
    expect(res.status).toBe(409);
  });
});

// ── Manager summary ────────────────────────────────────────────────────────

describe('POST /attendance/anomalies/manager-summary', () => {
  test('T20 — internal-key call sends manager emails for grouped reports', async () => {
    process.env.INTERNAL_SERVICE_KEY = 'test-key';
    mockAnomalyFindMany.mockResolvedValueOnce([
      { id: 'a1', employeeId: 'e1', type: 'LATE_ARRIVAL', severity: 'LOW', message: 'late 30m', status: 'PENDING' },
      { id: 'a2', employeeId: 'e2', type: 'AWOL',         severity: 'HIGH', message: 'no show', status: 'PENDING' },
    ]);
    global.fetch.mockImplementation((url) => {
      if (url.includes('/employees/by-ids')) {
        return Promise.resolve({ ok: true, json: async () => ([
          { id: 'e1', fullName: 'Alice', reportingManagerId: 'mgr-1' },
          { id: 'e2', fullName: 'Bob',   reportingManagerId: 'mgr-1' },
          { id: 'mgr-1', fullName: 'Manager One', workEmail: 'mgr@test.com' },
        ]) });
      }
      if (url.includes('/notifications/email')) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    const res = await request(app)
      .post('/attendance/anomalies/manager-summary')
      .set('x-internal-service-key', 'test-key')
      .send({ date: '2026-05-19' });
    expect(res.status).toBe(200);
    expect(res.body.anomalies).toBe(2);
    expect(res.body.managersNotified).toBe(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/notifications/email'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test('T21 — non-admin JWT call returns 403', async () => {
    setUser({ sub: 'lm-1', role: 'LINE_MANAGER' });
    const res = await request(app).post('/attendance/anomalies/manager-summary').send({});
    expect(res.status).toBe(403);
  });

  test('T22 — no pending anomalies → managersNotified=0', async () => {
    process.env.INTERNAL_SERVICE_KEY = 'test-key';
    mockAnomalyFindMany.mockResolvedValueOnce([]);
    const res = await request(app)
      .post('/attendance/anomalies/manager-summary')
      .set('x-internal-service-key', 'test-key')
      .send({ date: '2026-05-19' });
    expect(res.status).toBe(200);
    expect(res.body.managersNotified).toBe(0);
  });
});

// ── Today dashboard ────────────────────────────────────────────────────────

describe('GET /attendance/today/dashboard', () => {
  test('T23 — buckets in/out/wfh/on_leave/not_clocked_in correctly', async () => {
    mockRecordFindMany.mockResolvedValueOnce([
      // e1: IN (clocked in, not out)
      { id: 'r1', employeeId: 'e1', date: new Date(), clockIn: new Date(), clockOut: null, status: 'PRESENT' },
      // e2: OUT (clocked in and out)
      { id: 'r2', employeeId: 'e2', date: new Date(), clockIn: new Date(), clockOut: new Date(), status: 'PRESENT', hoursWorked: 8 },
      // e3: LATE — also counted in IN bucket but flagged
      { id: 'r3', employeeId: 'e3', date: new Date(), clockIn: new Date(), clockOut: null, status: 'LATE' },
    ]);
    mockRosterFindMany.mockResolvedValueOnce([
      // e4 is rostered but has no record → NOT_CLOCKED_IN
      { id: 'ros4', employeeId: 'e4', date: new Date(), note: null },
      // e5 is rostered with WFH note — but no record yet → NOT_CLOCKED_IN
      { id: 'ros5', employeeId: 'e5', date: new Date(), note: 'WFH today' },
    ]);
    global.fetch.mockResolvedValue({ ok: true, json: async () => ([]) });

    const res = await request(app).get('/attendance/today/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.summary.IN).toBe(2); // e1 + e3
    expect(res.body.summary.OUT).toBe(1); // e2
    expect(res.body.summary.LATE).toBe(1); // e3
    expect(res.body.summary.NOT_CLOCKED_IN).toBe(2); // e4 + e5
  });

  test('T24 — leave-service feed routes employees to ON_LEAVE bucket', async () => {
    mockRecordFindMany.mockResolvedValueOnce([]);
    mockRosterFindMany.mockResolvedValueOnce([
      { id: 'ros1', employeeId: 'e1', date: new Date(), note: null },
    ]);
    global.fetch.mockResolvedValue({ ok: true, json: async () => ([{ employeeId: 'e1', leaveTypeCode: 'AL' }]) });

    const res = await request(app).get('/attendance/today/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.summary.ON_LEAVE).toBe(1);
    expect(res.body.summary.NOT_CLOCKED_IN).toBe(0);
  });

  test('T25 — leave fetch failure still returns dashboard (fail-soft)', async () => {
    mockRecordFindMany.mockResolvedValueOnce([
      { id: 'r1', employeeId: 'e1', date: new Date(), clockIn: new Date(), clockOut: null, status: 'PRESENT' },
    ]);
    mockRosterFindMany.mockResolvedValueOnce([]);
    global.fetch.mockRejectedValueOnce(new Error('leave-service down'));

    const res = await request(app).get('/attendance/today/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.summary.IN).toBe(1);
  });
});
