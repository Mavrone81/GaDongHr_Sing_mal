'use strict';
/**
 * Integration tests for PAY-005:
 *   - Run creation with paymentDate (auto-default to period-end + 7 days)
 *   - PATCH /runs/:id with paymentDate
 *   - Finalise stamps publishedAt + fires notifications (fire-and-forget)
 *   - POST /runs/:id/notify-published manual re-fire
 *   - POST /payslips/sla/sweep creates/updates/resolves SLA alerts
 *   - GET /payslips/sla/alerts filtering + summary
 *   - GET /payslips/archive RBAC + year-window filtering
 */

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = global.__user || { sub: 'admin-001', role: 'HR_ADMIN', employeeId: null }; next(); },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', LINE_MANAGER: 'LINE_MANAGER',
    EMPLOYEE: 'EMPLOYEE', FINANCE_ADMIN: 'FINANCE_ADMIN',
  },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encrypt: v => String(v),
  decrypt: v => String(v),
  encryptNumber: v => String(v),
  decryptNumber: v => Number(v),
}), { virtual: true });

jest.mock('dotenv', () => ({ config: () => {} }));

const mockDb = {
  payrollRun:       { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  payslip:          { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }), count: jest.fn().mockResolvedValue(0) },
  payrollLineItem:  { findMany: jest.fn().mockResolvedValue([]) },
  payComponent:     { findUnique: jest.fn().mockResolvedValue(null) },
  payslipSlaAlert:  { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  employeeCostCentre:  { findMany: jest.fn().mockResolvedValue([]) },
  payrollJournal:      { findUnique: jest.fn(), delete: jest.fn(), create: jest.fn() },
  payrollJournalEntry: { createMany: jest.fn() },
  $transaction: jest.fn(async (fn) => {
    if (typeof fn === 'function') return fn({
      payrollJournal:      { findUnique: jest.fn(), delete: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'j1' }) },
      payrollJournalEntry: { createMany: jest.fn() },
    });
    return Promise.all(fn);
  }),
};
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ([]) });

const request = require('supertest');
const app = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  global.__user = { sub: 'admin-001', role: 'HR_ADMIN', employeeId: null };
  global.fetch.mockResolvedValue({ ok: true, json: async () => ([]) });
  // db-constraints init in src/index.js runs once at boot; safe to no-op here.
});

// ── Run creation with paymentDate ──────────────────────────────────────────

describe('POST /payroll/runs — paymentDate', () => {
  test('P1 — defaults paymentDate to period-end + 7 days when not supplied', async () => {
    mockDb.payrollRun.create.mockImplementation(async ({ data }) => ({ ...data, id: 'r1' }));
    const res = await request(app).post('/payroll/runs').send({ legalEntityId: 'ent-1', period: '2026-05', runType: 'MONTHLY' });
    expect(res.status).toBe(201);
    const createArg = mockDb.payrollRun.create.mock.calls[0][0];
    // 2026-05 ends 2026-05-31; +7 = 2026-06-07
    expect(createArg.data.paymentDate.toISOString().slice(0, 10)).toBe('2026-06-07');
  });

  test('P2 — accepts explicit paymentDate from body', async () => {
    mockDb.payrollRun.create.mockImplementation(async ({ data }) => ({ ...data, id: 'r1' }));
    const res = await request(app).post('/payroll/runs').send({
      legalEntityId: 'ent-1', period: '2026-05', runType: 'MONTHLY', paymentDate: '2026-06-15',
    });
    expect(res.status).toBe(201);
    const createArg = mockDb.payrollRun.create.mock.calls[0][0];
    expect(createArg.data.paymentDate.toISOString().slice(0, 10)).toBe('2026-06-15');
  });
});

describe('PATCH /payroll/runs/:id', () => {
  test('P3 — updates paymentDate when run not finalised', async () => {
    mockDb.payrollRun.findUnique.mockResolvedValueOnce({ id: 'r1', status: 'APPROVED' });
    mockDb.payrollRun.update.mockResolvedValueOnce({ id: 'r1', paymentDate: new Date('2026-06-10') });
    const res = await request(app).patch('/payroll/runs/r1').send({ paymentDate: '2026-06-10' });
    expect(res.status).toBe(200);
    expect(mockDb.payrollRun.update).toHaveBeenCalled();
  });

  test('P4 — 409 when run is FINALISED', async () => {
    mockDb.payrollRun.findUnique.mockResolvedValueOnce({ id: 'r1', status: 'FINALISED' });
    const res = await request(app).patch('/payroll/runs/r1').send({ paymentDate: '2026-06-10' });
    expect(res.status).toBe(409);
  });

  test('P5 — 404 when run missing', async () => {
    mockDb.payrollRun.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).patch('/payroll/runs/nope').send({});
    expect(res.status).toBe(404);
  });
});

// ── SLA sweep ──────────────────────────────────────────────────────────────

describe('POST /payroll/payslips/sla/sweep', () => {
  test('P6 — creates UNPUBLISHED_PAST_PAYMENT alert', async () => {
    const overdue = new Date(); overdue.setUTCDate(overdue.getUTCDate() - 2);
    mockDb.payrollRun.findMany.mockResolvedValueOnce([
      {
        id: 'r1', period: '2026-05', status: 'APPROVED', paymentDate: overdue,
        payslips: [{ isPublished: false, publishedAt: null }, { isPublished: false, publishedAt: null }],
      },
    ]);
    mockDb.payslipSlaAlert.findUnique.mockResolvedValue(null);
    mockDb.payslipSlaAlert.create.mockImplementation(async ({ data }) => data);
    mockDb.payslipSlaAlert.findMany.mockResolvedValue([]);
    const res = await request(app).post('/payroll/payslips/sla/sweep').send({});
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.byType.UNPUBLISHED_PAST_PAYMENT).toBe(1);
  });

  test('P7 — updates existing alert (idempotent)', async () => {
    const overdue = new Date(); overdue.setUTCDate(overdue.getUTCDate() - 1);
    mockDb.payrollRun.findMany.mockResolvedValueOnce([
      { id: 'r1', period: '2026-05', status: 'APPROVED', paymentDate: overdue, payslips: [{ isPublished: false }] },
    ]);
    mockDb.payslipSlaAlert.findUnique.mockResolvedValueOnce({ id: 'a-existing', type: 'UNPUBLISHED_PAST_PAYMENT' });
    mockDb.payslipSlaAlert.update.mockResolvedValueOnce({});
    mockDb.payslipSlaAlert.findMany.mockResolvedValueOnce([]);
    const res = await request(app).post('/payroll/payslips/sla/sweep').send({});
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.created).toBe(0);
  });

  test('P8 — resolves alert when violation is gone', async () => {
    // Run is now fine (all published before paymentDate), but a stored alert exists
    mockDb.payrollRun.findMany.mockResolvedValueOnce([
      { id: 'r1', period: '2026-05', status: 'FINALISED', paymentDate: new Date(Date.now() + 86400000),
        payslips: [{ isPublished: true, publishedAt: new Date(Date.now() - 86400000) }] },
    ]);
    mockDb.payslipSlaAlert.findMany.mockResolvedValueOnce([
      { id: 'a-old', type: 'UNPUBLISHED_PAST_PAYMENT' },
    ]);
    mockDb.payslipSlaAlert.update.mockResolvedValue({});
    const res = await request(app).post('/payroll/payslips/sla/sweep').send({});
    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(1);
  });
});

describe('GET /payroll/payslips/sla/alerts', () => {
  test('P9 — lists active alerts with summary', async () => {
    mockDb.payslipSlaAlert.findMany.mockResolvedValueOnce([
      { id: 'a1', type: 'UNPUBLISHED_PAST_PAYMENT', severity: 'CRITICAL', notifiedAt: new Date() },
      { id: 'a2', type: 'LATE_PUBLICATION',         severity: 'HIGH',     notifiedAt: new Date() },
    ]);
    const res = await request(app).get('/payroll/payslips/sla/alerts');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.summary.byType.UNPUBLISHED_PAST_PAYMENT).toBe(1);
    expect(res.body.summary.bySeverity.CRITICAL).toBe(1);
  });

  test('P10 — default excludes resolved alerts', async () => {
    mockDb.payslipSlaAlert.findMany.mockResolvedValueOnce([]);
    await request(app).get('/payroll/payslips/sla/alerts');
    const call = mockDb.payslipSlaAlert.findMany.mock.calls[0][0];
    expect(call.where.resolvedAt).toBeNull();
  });

  test('P11 — includeResolved=true drops the resolvedAt filter', async () => {
    mockDb.payslipSlaAlert.findMany.mockResolvedValueOnce([]);
    await request(app).get('/payroll/payslips/sla/alerts?includeResolved=true');
    const call = mockDb.payslipSlaAlert.findMany.mock.calls[0][0];
    expect(call.where.resolvedAt).toBeUndefined();
  });
});

// ── Publish notification fan-out ───────────────────────────────────────────

describe('POST /payroll/runs/:id/notify-published', () => {
  test('P12 — fans out one notification per published payslip', async () => {
    mockDb.payrollRun.findUnique.mockResolvedValueOnce({ id: 'r1', status: 'FINALISED', paymentDate: new Date('2026-06-07') });
    mockDb.payslip.findMany.mockResolvedValueOnce([
      { id: 'ps1', employeeId: 'e1', period: '2026-05', isPublished: true },
      { id: 'ps2', employeeId: 'e2', period: '2026-05', isPublished: true },
    ]);
    global.fetch.mockImplementation((url) => {
      if (url.includes('/employees/by-ids')) {
        return Promise.resolve({ ok: true, json: async () => ([
          { id: 'e1', fullName: 'Alice', workEmail: 'alice@test.com' },
          { id: 'e2', fullName: 'Bob',   workEmail: 'bob@test.com' },
        ]) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    mockDb.payslip.update.mockResolvedValue({});
    const res = await request(app).post('/payroll/runs/r1/notify-published').send({});
    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(2);
    // Verify the notification-service was called for each
    const notifCalls = global.fetch.mock.calls.filter(c => String(c[0]).includes('/notifications/send'));
    expect(notifCalls.length).toBe(2);
  });

  test('P13 — 409 when run not FINALISED', async () => {
    mockDb.payrollRun.findUnique.mockResolvedValueOnce({ id: 'r1', status: 'APPROVED' });
    const res = await request(app).post('/payroll/runs/r1/notify-published').send({});
    expect(res.status).toBe(409);
  });

  test('P14 — 404 when run missing', async () => {
    mockDb.payrollRun.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/payroll/runs/missing/notify-published').send({});
    expect(res.status).toBe(404);
  });
});

// ── 5-year archive ─────────────────────────────────────────────────────────

describe('GET /payroll/payslips/archive', () => {
  test('P15 — admin can query anyone, paginated', async () => {
    mockDb.payslip.findMany.mockResolvedValueOnce([
      { id: 'ps1', runId: 'r1', employeeId: 'e1', period: '2026-05', publishedAt: new Date(), notifiedAt: new Date(),
        createdAt: new Date(), netPayEnc: '4330', grossPayEnc: '5700', ytdGrossEnc: '28500',
        run: { runType: 'MONTHLY', paymentDate: new Date(), finalisedAt: new Date() } },
    ]);
    mockDb.payslip.count.mockResolvedValueOnce(1);
    const res = await request(app).get('/payroll/payslips/archive?employeeId=e1&fromYear=2022&toYear=2026');
    expect(res.status).toBe(200);
    expect(res.body.window.retentionYears).toBe(5);
    expect(res.body.window.fromYear).toBe(2022);
    expect(res.body.payslips).toHaveLength(1);
    expect(res.body.payslips[0].netPay).toBe(4330);
  });

  test('P16 — non-admin EMPLOYEE forced to own employeeId', async () => {
    global.__user = { sub: 'u-1', role: 'EMPLOYEE', employeeId: 'e-self' };
    mockDb.payslip.findMany.mockResolvedValueOnce([]);
    mockDb.payslip.count.mockResolvedValueOnce(0);
    await request(app).get('/payroll/payslips/archive?employeeId=e-other');
    // The where.employeeId in the actual query should be e-self regardless of query param
    const call = mockDb.payslip.findMany.mock.calls[0][0];
    expect(call.where.employeeId).toBe('e-self');
  });

  test('P17 — non-admin without linked employeeId → 403', async () => {
    global.__user = { sub: 'u-1', role: 'EMPLOYEE', employeeId: null };
    const res = await request(app).get('/payroll/payslips/archive');
    expect(res.status).toBe(403);
  });
});
