'use strict';
/**
 * Integration tests for TAT-005 attendance period & approval routes.
 *
 *   GET    /attendance/periods
 *   GET    /attendance/periods/:period
 *   POST   /attendance/periods/:period/lock
 *   POST   /attendance/periods/:period/unlock
 *   POST   /attendance/periods/:period/approve-for-payroll
 *   GET    /attendance/pending-approvals
 *   POST   /attendance/records/:id/approve-early
 *   POST   /attendance/records/:id/approve-late
 *   POST   /attendance/records/:id/deny-early
 *   POST   /attendance/records/:id/deny-late
 *   GET    /attendance/internal/period-summary/:period   (INTERNAL key)
 *
 * Regression:
 *   - reconciliation engine runs again after a manual APPROVE/DENY so the
 *     billableHours patch is persisted alongside the status change.
 */

let mockUser = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN', employeeId: null };
const setUser = (u) => { mockUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  // Honour the role list so 403s are exercised correctly.
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

const mockPeriodFindMany   = jest.fn();
const mockPeriodFindUnique = jest.fn();
const mockPeriodUpsert     = jest.fn();
const mockPeriodUpdate     = jest.fn();

const mockRecordFindMany   = jest.fn();
const mockRecordFindUnique = jest.fn();
const mockRecordUpdate     = jest.fn();

const mockRosterFindUnique = jest.fn();
const mockAuditCreate      = jest.fn().mockResolvedValue({});

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    attendancePeriod: { findMany: mockPeriodFindMany, findUnique: mockPeriodFindUnique, findFirst: mockPeriodFindUnique, upsert: mockPeriodUpsert, update: mockPeriodUpdate },
    attendanceRecord: { findMany: mockRecordFindMany, findUnique: mockRecordFindUnique, update: mockRecordUpdate, upsert: jest.fn(), findFirst: jest.fn() },
    rosterEntry:      { findUnique: mockRosterFindUnique, findMany: jest.fn().mockResolvedValue([]) },
    auditLog:         { create: mockAuditCreate },
    employeeWorkLocation: { findMany: jest.fn().mockResolvedValue([]) },
    shiftTemplate: { findMany: jest.fn().mockResolvedValue([]) },
    workingShift:  { findMany: jest.fn().mockResolvedValue([]) },
    workLocation:  { findMany: jest.fn().mockResolvedValue([]) },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

// payroll-utils is mounted in the container but not in test — stub it so the
// internal-summary route's countWorkingDays import resolves.
jest.mock('/app/shared/payroll-utils', () => ({
  countWorkingDays: () => 22,
}), { virtual: true });

const request = require('supertest');
const app = require('../src/index');

afterEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN', employeeId: null });
});

// ── /attendance/periods/* lock state machine ────────────────────────────────

describe('Period state machine', () => {
  test('GET /attendance/periods/:period returns a synthetic OPEN row when no row exists', async () => {
    mockPeriodFindUnique.mockResolvedValueOnce(null);
    const res = await request(app).get('/attendance/periods/2026-05');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ period: '2026-05', status: 'OPEN' });
  });

  test('rejects period strings not in YYYY-MM form', async () => {
    const res = await request(app).get('/attendance/periods/2026-13');
    expect(res.status).toBe(400);
  });

  test('OPEN → LOCKED via POST /lock', async () => {
    mockPeriodFindUnique.mockResolvedValueOnce(null);
    mockPeriodUpsert.mockResolvedValueOnce({ id: 'p1', period: '2026-05', status: 'LOCKED', lockedBy: 'admin-001' });

    const res = await request(app).post('/attendance/periods/2026-05/lock').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('LOCKED');
    expect(mockPeriodUpsert).toHaveBeenCalled();
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'LOCK' }),
    }));
  });

  test('lock from APPROVED_FOR_PAYROLL → 409', async () => {
    mockPeriodFindUnique.mockResolvedValueOnce({ id: 'p1', period: '2026-05', status: 'APPROVED_FOR_PAYROLL' });
    const res = await request(app).post('/attendance/periods/2026-05/lock').send({});
    expect(res.status).toBe(409);
    expect(mockPeriodUpsert).not.toHaveBeenCalled();
  });

  test('LOCKED → APPROVED_FOR_PAYROLL via /approve-for-payroll', async () => {
    mockPeriodFindUnique.mockResolvedValueOnce({ id: 'p1', period: '2026-05', status: 'LOCKED' });
    mockPeriodUpdate.mockResolvedValueOnce({ id: 'p1', period: '2026-05', status: 'APPROVED_FOR_PAYROLL', approvedBy: 'admin-001' });

    const res = await request(app).post('/attendance/periods/2026-05/approve-for-payroll').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED_FOR_PAYROLL');
  });

  test('approve-for-payroll from OPEN → 409', async () => {
    mockPeriodFindUnique.mockResolvedValueOnce({ id: 'p1', period: '2026-05', status: 'OPEN' });
    const res = await request(app).post('/attendance/periods/2026-05/approve-for-payroll').send({});
    expect(res.status).toBe(409);
  });

  test('LINE_MANAGER cannot lock (403)', async () => {
    setUser({ sub: 'lm-1', role: 'LINE_MANAGER' });
    const res = await request(app).post('/attendance/periods/2026-05/lock').send({});
    expect(res.status).toBe(403);
  });

  test('HR_MANAGER cannot unlock (403)', async () => {
    setUser({ sub: 'hm-1', role: 'HR_MANAGER' });
    const res = await request(app).post('/attendance/periods/2026-05/unlock').send({});
    expect(res.status).toBe(403);
  });

  test('HR_ADMIN unlock from LOCKED → OPEN', async () => {
    mockPeriodFindUnique.mockResolvedValueOnce({ id: 'p1', period: '2026-05', status: 'LOCKED' });
    mockPeriodUpdate.mockResolvedValueOnce({ id: 'p1', period: '2026-05', status: 'OPEN' });
    const res = await request(app).post('/attendance/periods/2026-05/unlock').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OPEN');
  });
});

// ── Pending approvals + decisions ─────────────────────────────────────────

describe('Pending approvals', () => {
  test('GET /attendance/pending-approvals lists PENDING records', async () => {
    mockRecordFindMany.mockResolvedValueOnce([
      { id: 'r1', employeeId: 'e1', date: new Date('2026-05-04'), earlyStatus: 'PENDING', lateStatus: 'NOT_APPLICABLE' },
      { id: 'r2', employeeId: 'e2', date: new Date('2026-05-05'), earlyStatus: 'NOT_APPLICABLE', lateStatus: 'PENDING' },
    ]);
    const res = await request(app).get('/attendance/pending-approvals');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    // confirm the where clause used the OR predicate
    expect(mockRecordFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ earlyStatus: 'PENDING' }, { lateStatus: 'PENDING' }],
      }),
    }));
  });

  test('approve-early flips status, runs reconciler, persists billable', async () => {
    const baseRecord = {
      id: 'r1', employeeId: 'e1', date: new Date('2026-05-04'),
      clockIn:  new Date('2026-05-04T00:15:00Z'),   // 08:15 SGT
      clockOut: new Date('2026-05-04T09:30:00Z'),   // 17:30 SGT
      scheduledStart: new Date('2026-05-04T01:00:00Z'), // 09:00 SGT
      scheduledEnd:   new Date('2026-05-04T09:30:00Z'), // 17:30 SGT
      earlyStatus: 'PENDING', lateStatus: 'NOT_APPLICABLE',
    };
    mockRecordFindUnique.mockResolvedValueOnce(baseRecord);
    mockRosterFindUnique.mockResolvedValueOnce({
      shiftTemplate: { startTime: '09:00', endTime: '17:30', breakMinutes: 60, hoursPerDay: 8, graceMinutesEarly: 15, graceMinutesLate: 15 },
      workingShift: null, shiftPattern: null,
    });
    mockRecordUpdate.mockResolvedValueOnce({ ...baseRecord, earlyStatus: 'APPROVED', billableHours: 8.25, billableOtHours: 0.25 });

    const res = await request(app).post('/attendance/records/r1/approve-early').send({});
    expect(res.status).toBe(200);
    expect(res.body.earlyStatus).toBe('APPROVED');
    // The reconciler patch + the status patch should both have been passed.
    const updateArg = mockRecordUpdate.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: 'r1' });
    expect(updateArg.data.earlyStatus).toBe('APPROVED');
    expect(updateArg.data.earlyApprovedBy).toBe('admin-001');
    expect(typeof updateArg.data.billableHours).toBe('number');
  });

  test('deny-late records the reason and clips billable to scheduled end', async () => {
    const baseRecord = {
      id: 'r2', employeeId: 'e2', date: new Date('2026-05-04'),
      clockIn:  new Date('2026-05-04T01:00:00Z'),    // 09:00 SGT
      clockOut: new Date('2026-05-04T11:00:00Z'),    // 19:00 SGT
      scheduledStart: new Date('2026-05-04T01:00:00Z'),
      scheduledEnd:   new Date('2026-05-04T09:30:00Z'), // 17:30 SGT
      earlyStatus: 'NOT_APPLICABLE', lateStatus: 'PENDING',
    };
    mockRecordFindUnique.mockResolvedValueOnce(baseRecord);
    mockRosterFindUnique.mockResolvedValueOnce({
      shiftTemplate: { startTime: '09:00', endTime: '17:30', breakMinutes: 60, hoursPerDay: 8, graceMinutesEarly: 15, graceMinutesLate: 15 },
      workingShift: null, shiftPattern: null,
    });
    mockRecordUpdate.mockImplementationOnce(({ data }) => Promise.resolve({ ...baseRecord, ...data }));

    const res = await request(app).post('/attendance/records/r2/deny-late').send({ reason: 'no project budget' });
    expect(res.status).toBe(200);
    expect(res.body.lateStatus).toBe('DENIED');
    expect(res.body.lateDenyReason).toBe('no project budget');
    // 9:00 → 17:30 (clipped) = 8h30m − 60m = 7h30m
    expect(res.body.billableHours).toBe(7.5);
    expect(res.body.billableOtHours).toBe(0);
  });

  test('approve on a record not in PENDING/AUTO_APPROVED → 409', async () => {
    mockRecordFindUnique.mockResolvedValueOnce({
      id: 'r3', employeeId: 'e1', date: new Date('2026-05-04'),
      earlyStatus: 'APPROVED', lateStatus: 'NOT_APPLICABLE',
    });
    const res = await request(app).post('/attendance/records/r3/approve-early').send({});
    expect(res.status).toBe(409);
  });
});

// ── Internal period-summary endpoint ───────────────────────────────────────

describe('GET /attendance/internal/period-summary/:period', () => {
  beforeAll(() => { process.env.INTERNAL_SERVICE_KEY = 'test-internal-key'; });

  test('rejects missing/incorrect internal key with 403', async () => {
    const res = await request(app).get('/attendance/internal/period-summary/2026-05');
    expect(res.status).toBe(403);
  });

  test('returns periodStatus + per-employee summary', async () => {
    mockPeriodFindUnique.mockResolvedValueOnce({ period: '2026-05', status: 'APPROVED_FOR_PAYROLL' });
    mockRecordFindMany.mockResolvedValueOnce([
      { employeeId: 'e1', date: new Date('2026-05-04'), status: 'PRESENT', billableHours: 8, billableOtHours: 0 },
      { employeeId: 'e1', date: new Date('2026-05-05'), status: 'ABSENT',  billableHours: 0, billableOtHours: 0 },
      { employeeId: 'e2', date: new Date('2026-05-04'), status: 'PRESENT', billableHours: 9, billableOtHours: 1 },
    ]);

    const res = await request(app)
      .get('/attendance/internal/period-summary/2026-05')
      .set('x-internal-service-key', 'test-internal-key');

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('2026-05');
    expect(res.body.periodStatus).toBe('APPROVED_FOR_PAYROLL');
    expect(res.body.expectedWorkDays).toBe(22);
    expect(res.body.summary.e1.absentDays).toBe(1);
    expect(res.body.summary.e2.otHours).toBe(1);
  });
});
