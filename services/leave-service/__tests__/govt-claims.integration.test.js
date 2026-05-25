'use strict';
/**
 * Integration tests for LEA-005 govt-paid claim routes:
 *   PUT  /leave/leave-types/:id/msf-config
 *   POST /leave/govt-claims/generate?period=YYYY-MM
 *   GET  /leave/govt-claims
 *   GET  /leave/govt-claims/summary
 *   PUT  /leave/govt-claims/:applicationId/status
 */

let mockUser = { sub: 'admin-001', role: 'HR_ADMIN', employeeId: null };
const setUser = (u) => { mockUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const mockDb = {
  leaveType: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  leaveApplication: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  leaveEntitlement: { findMany: jest.fn().mockResolvedValue([]) },
  publicHoliday: { findMany: jest.fn().mockResolvedValue([]) },
  leaveApprovalStep: { create: jest.fn() },
};
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
jest.mock('axios', () => ({ get: jest.fn().mockResolvedValue({ data: { employees: [] } }) }));
jest.mock('multer', () => {
  const m = () => ({ single: () => (_req, _res, next) => next() });
  m.diskStorage = () => ({});
  return m;
});

global.fetch = jest.fn();

const request = require('supertest');
const app = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', role: 'HR_ADMIN', employeeId: null });
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ dailyRate: 200 }) });
});

// ── PUT /leave-types/:id/msf-config ────────────────────────────────────────

describe('PUT /leave/leave-types/:id/msf-config', () => {
  test('M1 — saves all four MSF fields', async () => {
    mockDb.leaveType.update.mockResolvedValueOnce({ id: 'lt-1', msfDailyCap: 100, msfWeeklyCap: 500, msfPeriodCap: 10000, msfPeriodWeeks: 4 });
    const res = await request(app).put('/leave/leave-types/lt-1/msf-config').send({
      msfDailyCap: 100, msfWeeklyCap: 500, msfPeriodCap: 10000, msfPeriodWeeks: 4,
    });
    expect(res.status).toBe(200);
    expect(res.body.msfDailyCap).toBe(100);
    const call = mockDb.leaveType.update.mock.calls[0][0];
    expect(call.data).toEqual(expect.objectContaining({ msfDailyCap: 100, msfWeeklyCap: 500, msfPeriodCap: 10000, msfPeriodWeeks: 4 }));
  });

  test('M2 — null values explicitly clear the cap', async () => {
    mockDb.leaveType.update.mockResolvedValueOnce({ id: 'lt-1', msfDailyCap: null });
    await request(app).put('/leave/leave-types/lt-1/msf-config').send({ msfDailyCap: null });
    const call = mockDb.leaveType.update.mock.calls[0][0];
    expect(call.data.msfDailyCap).toBeNull();
  });

  test('M3 — 400 on negative cap', async () => {
    const res = await request(app).put('/leave/leave-types/lt-1/msf-config').send({ msfDailyCap: -10 });
    expect(res.status).toBe(400);
  });

  test('M4 — 400 on non-positive period weeks', async () => {
    const res = await request(app).put('/leave/leave-types/lt-1/msf-config').send({ msfPeriodWeeks: 0 });
    expect(res.status).toBe(400);
  });

  test('M5 — 404 when leave type not found', async () => {
    mockDb.leaveType.update.mockRejectedValueOnce({ code: 'P2025' });
    const res = await request(app).put('/leave/leave-types/missing/msf-config').send({ msfDailyCap: 100 });
    expect(res.status).toBe(404);
  });

  test('M6 — 403 for non-admin', async () => {
    setUser({ sub: 'u-1', role: 'EMPLOYEE' });
    const res = await request(app).put('/leave/leave-types/lt-1/msf-config').send({ msfDailyCap: 100 });
    expect(res.status).toBe(403);
  });
});

// ── POST /govt-claims/generate ─────────────────────────────────────────────

describe('POST /leave/govt-claims/generate', () => {
  test('M7 — generates NOT_SUBMITTED claim rows with capped amounts', async () => {
    mockDb.leaveApplication.findMany.mockResolvedValueOnce([
      {
        id: 'app-1', employeeId: 'e1', totalDays: 5, startDate: new Date('2026-05-10T00:00:00Z'),
        claimStatus: 'NOT_APPLICABLE',
        leaveType: { code: 'CCL', isGovtPaid: true, msfDailyCap: 100 },
      },
    ]);
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ dailyRate: 150 }) });
    mockDb.leaveApplication.update.mockResolvedValue({});
    const res = await request(app).post('/leave/govt-claims/generate?period=2026-05').send({});
    expect(res.status).toBe(200);
    expect(res.body.generated).toBe(1);
    const call = mockDb.leaveApplication.update.mock.calls[0][0];
    expect(call.data.claimStatus).toBe('NOT_SUBMITTED');
    expect(call.data.claimAmount).toBe(500); // 5 × min(150, 100) = 500
    expect(call.data.claimCapApplied).toBe('DAILY');
  });

  test('M8 — leaves SUBMITTED / REIMBURSED rows untouched', async () => {
    mockDb.leaveApplication.findMany.mockResolvedValueOnce([
      { id: 'app-1', employeeId: 'e1', totalDays: 5, startDate: new Date('2026-05-10'), claimStatus: 'SUBMITTED', leaveType: { code: 'CCL', isGovtPaid: true, msfDailyCap: 100 } },
      { id: 'app-2', employeeId: 'e2', totalDays: 5, startDate: new Date('2026-05-10'), claimStatus: 'REIMBURSED', leaveType: { code: 'CCL', isGovtPaid: true, msfDailyCap: 100 } },
    ]);
    const res = await request(app).post('/leave/govt-claims/generate?period=2026-05').send({});
    expect(res.status).toBe(200);
    expect(res.body.untouched).toBe(2);
    expect(res.body.generated).toBe(0);
    expect(mockDb.leaveApplication.update).not.toHaveBeenCalled();
  });

  test('M9 — skips rows when no daily rate available + no override', async () => {
    mockDb.leaveApplication.findMany.mockResolvedValueOnce([
      { id: 'app-1', employeeId: 'e1', totalDays: 5, startDate: new Date('2026-05-10'), claimStatus: 'NOT_APPLICABLE', leaveType: { code: 'CCL', isGovtPaid: true, msfDailyCap: 100 } },
    ]);
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const res = await request(app).post('/leave/govt-claims/generate?period=2026-05').send({});
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(1);
    expect(res.body.details[0].skipped).toMatch(/no daily rate/);
  });

  test('M10 — honours dailyRateOverrides body', async () => {
    mockDb.leaveApplication.findMany.mockResolvedValueOnce([
      { id: 'app-1', employeeId: 'e1', totalDays: 5, startDate: new Date('2026-05-10'), claimStatus: 'NOT_APPLICABLE', leaveType: { code: 'CCL', isGovtPaid: true, msfDailyCap: 100 } },
    ]);
    mockDb.leaveApplication.update.mockResolvedValue({});
    const res = await request(app).post('/leave/govt-claims/generate?period=2026-05').send({ dailyRateOverrides: { e1: 200 } });
    expect(res.status).toBe(200);
    expect(res.body.generated).toBe(1);
    // No fetch needed when override is provided
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('M11 — 400 when period missing or malformed', async () => {
    const r1 = await request(app).post('/leave/govt-claims/generate').send({});
    expect(r1.status).toBe(400);
    const r2 = await request(app).post('/leave/govt-claims/generate?period=2026-13').send({});
    expect(r2.status).toBe(400);
  });

  test('M12 — 403 for non-admin', async () => {
    setUser({ sub: 'u-1', role: 'EMPLOYEE' });
    const res = await request(app).post('/leave/govt-claims/generate?period=2026-05').send({});
    expect(res.status).toBe(403);
  });
});

// ── GET /govt-claims ────────────────────────────────────────────────────────

describe('GET /leave/govt-claims', () => {
  test('M13 — returns rows + summary with totals', async () => {
    mockDb.leaveApplication.findMany.mockResolvedValueOnce([
      { id: 'a', claimStatus: 'NOT_SUBMITTED', claimAmount: 500,  claimReimbursedAmount: null, leaveType: { code: 'CCL', name: 'Childcare', msfDailyCap: 100 } },
      { id: 'b', claimStatus: 'REIMBURSED',    claimAmount: 2500, claimReimbursedAmount: 2500, leaveType: { code: 'GPPL', name: 'Paternity', msfWeeklyCap: 2500 } },
      { id: 'c', claimStatus: 'SUBMITTED',     claimAmount: 1000, claimReimbursedAmount: null, leaveType: { code: 'CCL', name: 'Childcare', msfDailyCap: 100 } },
    ]);
    const res = await request(app).get('/leave/govt-claims');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.summary.byStatus.NOT_SUBMITTED).toBe(1);
    expect(res.body.summary.byLeaveType.CCL).toBe(2);
    expect(res.body.summary.totalClaimable).toBe(4000);
    expect(res.body.summary.totalReimbursed).toBe(2500);
  });

  test('M14 — applies status + period + leaveTypeCode filters', async () => {
    mockDb.leaveApplication.findMany.mockResolvedValueOnce([]);
    await request(app).get('/leave/govt-claims?period=2026-05&status=SUBMITTED&leaveTypeCode=ccl');
    const call = mockDb.leaveApplication.findMany.mock.calls[0][0];
    expect(call.where.claimStatus).toBe('SUBMITTED');
    expect(call.where.leaveType.code).toBe('CCL');
    expect(call.where.startDate.gte).toBeInstanceOf(Date);
  });
});

// ── GET /govt-claims/summary ────────────────────────────────────────────────

describe('GET /leave/govt-claims/summary', () => {
  test('M15 — aggregates totals per leave type', async () => {
    mockDb.leaveApplication.findMany.mockResolvedValueOnce([
      { totalDays: 5, claimStatus: 'REIMBURSED', claimAmount: 500,  claimReimbursedAmount: 500,  leaveType: { code: 'CCL', name: 'Childcare' } },
      { totalDays: 3, claimStatus: 'SUBMITTED',  claimAmount: 1500, claimReimbursedAmount: null, leaveType: { code: 'GPPL', name: 'Paternity' } },
    ]);
    const res = await request(app).get('/leave/govt-claims/summary?period=2026-05');
    expect(res.status).toBe(200);
    expect(res.body.totals.totalClaimable).toBe(2000);
    expect(res.body.totals.totalReimbursed).toBe(500);
    expect(res.body.byLeaveType).toHaveLength(2);
    const ccl = res.body.byLeaveType.find(r => r.code === 'CCL');
    expect(ccl.totalDays).toBe(5);
    expect(ccl.byStatus.REIMBURSED).toBe(1);
  });
});

// ── PUT /govt-claims/:applicationId/status ─────────────────────────────────

describe('PUT /leave/govt-claims/:applicationId/status', () => {
  test('M16 — NOT_SUBMITTED → SUBMITTED requires submissionRef', async () => {
    mockDb.leaveApplication.findUnique.mockResolvedValueOnce({ id: 'a', claimStatus: 'NOT_SUBMITTED', leaveType: { isGovtPaid: true } });
    const res = await request(app).put('/leave/govt-claims/a/status').send({ status: 'SUBMITTED' });
    expect(res.status).toBe(400);
  });

  test('M17 — happy SUBMITTED transition stamps submittedAt + ref', async () => {
    mockDb.leaveApplication.findUnique.mockResolvedValueOnce({ id: 'a', claimStatus: 'NOT_SUBMITTED', leaveType: { isGovtPaid: true } });
    mockDb.leaveApplication.update.mockResolvedValueOnce({ id: 'a', claimStatus: 'SUBMITTED' });
    const res = await request(app).put('/leave/govt-claims/a/status').send({ status: 'SUBMITTED', submissionRef: 'MSF-2026-001' });
    expect(res.status).toBe(200);
    const call = mockDb.leaveApplication.update.mock.calls[0][0];
    expect(call.data.claimSubmissionRef).toBe('MSF-2026-001');
    expect(call.data.claimSubmittedAt).toBeInstanceOf(Date);
  });

  test('M18 — REIMBURSED requires numeric reimbursedAmount', async () => {
    mockDb.leaveApplication.findUnique.mockResolvedValueOnce({ id: 'a', claimStatus: 'SUBMITTED', leaveType: { isGovtPaid: true } });
    const res = await request(app).put('/leave/govt-claims/a/status').send({ status: 'REIMBURSED' });
    expect(res.status).toBe(400);
  });

  test('M19 — REJECTED requires rejectedReason', async () => {
    mockDb.leaveApplication.findUnique.mockResolvedValueOnce({ id: 'a', claimStatus: 'SUBMITTED', leaveType: { isGovtPaid: true } });
    const res = await request(app).put('/leave/govt-claims/a/status').send({ status: 'REJECTED' });
    expect(res.status).toBe(400);
  });

  test('M20 — REIMBURSED stamps timestamp + amount', async () => {
    mockDb.leaveApplication.findUnique.mockResolvedValueOnce({ id: 'a', claimStatus: 'SUBMITTED', leaveType: { isGovtPaid: true } });
    mockDb.leaveApplication.update.mockResolvedValueOnce({ id: 'a', claimStatus: 'REIMBURSED' });
    const res = await request(app).put('/leave/govt-claims/a/status').send({ status: 'REIMBURSED', reimbursedAmount: 450 });
    expect(res.status).toBe(200);
    const call = mockDb.leaveApplication.update.mock.calls[0][0];
    expect(call.data.claimReimbursedAmount).toBe(450);
    expect(call.data.claimReimbursedAt).toBeInstanceOf(Date);
  });

  test('M21 — REJECTED → NOT_SUBMITTED (resubmission) clears rejection', async () => {
    mockDb.leaveApplication.findUnique.mockResolvedValueOnce({ id: 'a', claimStatus: 'REJECTED', leaveType: { isGovtPaid: true } });
    mockDb.leaveApplication.update.mockResolvedValueOnce({ id: 'a', claimStatus: 'NOT_SUBMITTED' });
    const res = await request(app).put('/leave/govt-claims/a/status').send({ status: 'NOT_SUBMITTED' });
    expect(res.status).toBe(200);
    const call = mockDb.leaveApplication.update.mock.calls[0][0];
    expect(call.data.claimRejectedReason).toBeNull();
  });

  test('M22 — illegal transition (NOT_SUBMITTED → REIMBURSED) → 409', async () => {
    mockDb.leaveApplication.findUnique.mockResolvedValueOnce({ id: 'a', claimStatus: 'NOT_SUBMITTED', leaveType: { isGovtPaid: true } });
    const res = await request(app).put('/leave/govt-claims/a/status').send({ status: 'REIMBURSED', reimbursedAmount: 100 });
    expect(res.status).toBe(409);
  });

  test('M23 — 404 when application missing', async () => {
    mockDb.leaveApplication.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).put('/leave/govt-claims/missing/status').send({ status: 'SUBMITTED', submissionRef: 'X' });
    expect(res.status).toBe(404);
  });

  test('M24 — 400 when leave type is not govt-paid', async () => {
    mockDb.leaveApplication.findUnique.mockResolvedValueOnce({ id: 'a', claimStatus: 'NOT_APPLICABLE', leaveType: { isGovtPaid: false } });
    const res = await request(app).put('/leave/govt-claims/a/status').send({ status: 'SUBMITTED', submissionRef: 'X' });
    expect(res.status).toBe(400);
  });
});
