'use strict';
/**
 * Integration tests for REC-003 work-pass routes:
 *
 *   GET  /recruitment/work-passes
 *   POST /recruitment/work-passes
 *   PUT  /recruitment/work-passes/:id
 *   POST /recruitment/work-passes/alerts/sweep
 *   GET  /recruitment/work-passes/alerts
 *   GET  /recruitment/work-passes/drc-config
 *   PUT  /recruitment/work-passes/drc-config
 *   GET  /recruitment/work-passes/drc-usage
 *   POST /recruitment/work-passes/:id/renewal/initiate
 *   GET  /recruitment/work-passes/:id/renewal/checklist
 *   PUT  /recruitment/work-passes/:id/renewal/checklist/:itemId
 *   PUT  /recruitment/work-passes/:id/renewal/outcome
 *   GET  /recruitment/work-passes/expiring
 */

// ── Mocks ───────────────────────────────────────────────────────────────────

let mockUser = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN' };
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
    RECRUITER: 'RECRUITER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const mockDb = {
  workPass: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  workPassAlert: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  workPassRenewalChecklist: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  drcQuotaConfig: { findMany: jest.fn(), upsert: jest.fn() },
  jobPosting: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  candidate: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  $transaction: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

jest.mock('multer', () => {
  const m = jest.fn(() => ({ single: () => (_req, _res, next) => next() }));
  m.diskStorage = jest.fn(() => ({}));
  return m;
});

global.fetch = jest.fn();

const request = require('supertest');
const { app } = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN' });
});

// ── List + CRUD ────────────────────────────────────────────────────────────

describe('Work Pass CRUD', () => {
  test('W1 — GET enriches with daysUntilExpiry + urgency band', async () => {
    const expiry = new Date(); expiry.setUTCDate(expiry.getUTCDate() + 45);
    mockDb.workPass.findMany.mockResolvedValueOnce([
      { id: 'p1', employeeId: 'e1', passType: 'WP', passNumber: 'WP1', expiryDate: expiry, status: 'ACTIVE' },
    ]);
    const res = await request(app).get('/recruitment/work-passes');
    expect(res.status).toBe(200);
    expect(res.body[0].daysUntilExpiry).toBeGreaterThanOrEqual(44);
    expect(res.body[0].urgency).toBe('WARNING');
  });

  test('W2 — POST validates required fields', async () => {
    const res = await request(app).post('/recruitment/work-passes').send({ employeeId: 'e1' });
    expect(res.status).toBe(400);
  });

  test('W3 — POST creates a new pass', async () => {
    mockDb.workPass.create.mockResolvedValueOnce({ id: 'p1', employeeId: 'e1', passType: 'EP', passNumber: 'EP1' });
    const res = await request(app).post('/recruitment/work-passes').send({
      employeeId: 'e1', passType: 'EP', passNumber: 'EP1', expiryDate: '2027-01-01',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('p1');
  });

  test('W4 — POST returns 409 on duplicate employee', async () => {
    mockDb.workPass.create.mockRejectedValueOnce({ code: 'P2002' });
    const res = await request(app).post('/recruitment/work-passes').send({
      employeeId: 'e1', passType: 'EP', passNumber: 'EP1', expiryDate: '2027-01-01',
    });
    expect(res.status).toBe(409);
  });

  test('W5 — PUT updates and returns 404 if missing', async () => {
    mockDb.workPass.update.mockRejectedValueOnce({ code: 'P2025' });
    const res = await request(app).put('/recruitment/work-passes/missing').send({ status: 'CANCELLED' });
    expect(res.status).toBe(404);
  });
});

// ── Alert sweep + list ─────────────────────────────────────────────────────

describe('Work Pass Alerts', () => {
  test('W6 — sweep fires 90+60+30 alerts for a pass expiring in 25 days', async () => {
    const expiry = new Date(); expiry.setUTCDate(expiry.getUTCDate() + 25); expiry.setUTCHours(0,0,0,0);
    mockDb.workPass.findMany.mockResolvedValueOnce([
      { id: 'p1', employeeId: 'e1', passType: 'WP', passNumber: 'WP1', expiryDate: expiry, status: 'ACTIVE' },
    ]);
    // Upsert returns a row with createdAt == notifiedAt to count as "created"
    let upserts = 0;
    mockDb.workPassAlert.upsert.mockImplementation(async () => {
      upserts += 1;
      const t = new Date();
      return { id: `a${upserts}`, createdAt: t, notifiedAt: t };
    });
    const res = await request(app).post('/recruitment/work-passes/alerts/sweep').send({});
    expect(res.status).toBe(200);
    expect(res.body.sweptPasses).toBe(1);
    expect(res.body.created).toBe(3); // 90 + 60 + 30
    expect(res.body.byThreshold[90]).toBe(1);
    expect(res.body.byThreshold[60]).toBe(1);
    expect(res.body.byThreshold[30]).toBe(1);
    expect(res.body.byThreshold[0]).toBe(0);
  });

  test('W7 — sweep is idempotent: re-run counts as updated not created', async () => {
    const expiry = new Date(); expiry.setUTCDate(expiry.getUTCDate() + 60); expiry.setUTCHours(0,0,0,0);
    mockDb.workPass.findMany.mockResolvedValueOnce([
      { id: 'p1', employeeId: 'e1', passType: 'WP', passNumber: 'WP1', expiryDate: expiry, status: 'ACTIVE' },
    ]);
    mockDb.workPassAlert.upsert.mockImplementation(async () => ({
      id: 'a1',
      createdAt: new Date('2026-01-01'),
      notifiedAt: new Date(), // updated, not created
    }));
    const res = await request(app).post('/recruitment/work-passes/alerts/sweep').send({});
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
  });

  test('W8 — sweep auto-flips expired ACTIVE pass to EXPIRED', async () => {
    const expired = new Date(); expired.setUTCDate(expired.getUTCDate() - 3); expired.setUTCHours(0,0,0,0);
    mockDb.workPass.findMany.mockResolvedValueOnce([
      { id: 'p1', employeeId: 'e1', passType: 'WP', passNumber: 'WP1', expiryDate: expired, status: 'ACTIVE' },
    ]);
    mockDb.workPassAlert.upsert.mockImplementation(async () => ({ id: 'a1', createdAt: new Date(), notifiedAt: new Date() }));
    mockDb.workPass.update.mockResolvedValueOnce({});
    const res = await request(app).post('/recruitment/work-passes/alerts/sweep').send({});
    expect(res.status).toBe(200);
    expect(mockDb.workPass.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }));
  });

  test('W9 — GET alerts groups by threshold + passType', async () => {
    mockDb.workPassAlert.findMany.mockResolvedValueOnce([
      { id: 'a1', threshold: 90, passType: 'WP', expiryDate: new Date(), notifiedAt: new Date() },
      { id: 'a2', threshold: 60, passType: 'WP', expiryDate: new Date(), notifiedAt: new Date() },
      { id: 'a3', threshold: 30, passType: 'EP', expiryDate: new Date(), notifiedAt: new Date() },
    ]);
    const res = await request(app).get('/recruitment/work-passes/alerts');
    expect(res.status).toBe(200);
    expect(res.body.summary.byThreshold[90]).toBe(1);
    expect(res.body.summary.byPassType.WP).toBe(2);
  });

  test('W10 — alert filter applies threshold + passType into where clause', async () => {
    mockDb.workPassAlert.findMany.mockResolvedValueOnce([]);
    await request(app).get('/recruitment/work-passes/alerts?threshold=30&passType=WP');
    const call = mockDb.workPassAlert.findMany.mock.calls[0][0];
    expect(call.where.threshold).toBe(30);
    expect(call.where.passType).toBe('WP');
  });
});

// ── DRC config + usage ────────────────────────────────────────────────────

describe('DRC quota', () => {
  test('W11 — GET drc-config returns active configs', async () => {
    mockDb.drcQuotaConfig.findMany.mockResolvedValueOnce([
      { id: 'd1', sector: 'SERVICES', workerTier: 'BASIC', ratioLimit: 0.35 },
    ]);
    const res = await request(app).get('/recruitment/work-passes/drc-config');
    expect(res.status).toBe(200);
    expect(res.body[0].sector).toBe('SERVICES');
  });

  test('W12 — PUT drc-config rejects ratioLimit outside 0..1', async () => {
    const res = await request(app).put('/recruitment/work-passes/drc-config').send({ sector: 'SERVICES', ratioLimit: 1.5 });
    expect(res.status).toBe(400);
  });

  test('W13 — PUT drc-config upserts a config', async () => {
    mockDb.drcQuotaConfig.upsert.mockResolvedValueOnce({ id: 'd1', sector: 'SERVICES', workerTier: 'BASIC', ratioLimit: 0.35 });
    const res = await request(app).put('/recruitment/work-passes/drc-config').send({ sector: 'SERVICES', ratioLimit: 0.35 });
    expect(res.status).toBe(200);
    expect(res.body.sector).toBe('SERVICES');
  });

  test('W14 — GET drc-usage requires totalHeadcount', async () => {
    const res = await request(app).get('/recruitment/work-passes/drc-usage');
    expect(res.status).toBe(400);
  });

  test('W15 — GET drc-usage computes per-sector breakdown', async () => {
    mockDb.workPass.findMany.mockResolvedValueOnce([
      { id: 'p1', passType: 'WP', sector: 'SERVICES', workerTier: 'BASIC', status: 'ACTIVE' },
      { id: 'p2', passType: 'WP', sector: 'SERVICES', workerTier: 'BASIC', status: 'ACTIVE' },
    ]);
    mockDb.drcQuotaConfig.findMany.mockResolvedValueOnce([
      { sector: 'SERVICES', workerTier: 'BASIC', ratioLimit: 0.35, alertThreshold: 0.85 },
    ]);
    const res = await request(app).get('/recruitment/work-passes/drc-usage?totalHeadcount=10');
    expect(res.status).toBe(200);
    expect(res.body.usage[0].foreignCount).toBe(2);
    expect(res.body.usage[0].currentRatio).toBe(0.2);
    expect(res.body.summary.breachCount).toBe(0);
  });

  test('W16 — non-admin can VIEW but cannot PUT config', async () => {
    setUser({ sub: 'r-1', role: 'RECRUITER' });
    mockDb.drcQuotaConfig.findMany.mockResolvedValueOnce([]);
    const get = await request(app).get('/recruitment/work-passes/drc-config');
    expect(get.status).toBe(200);
    const put = await request(app).put('/recruitment/work-passes/drc-config').send({ sector: 'SERVICES', ratioLimit: 0.35 });
    expect(put.status).toBe(403);
  });
});

// ── Renewal workflow ──────────────────────────────────────────────────────

describe('Renewal workflow', () => {
  test('W17 — initiate flips status to RENEWING + creates checklist items', async () => {
    mockDb.workPass.findUnique.mockResolvedValueOnce({ id: 'p1', passType: 'WP', status: 'ACTIVE', renewalInitiatedAt: null });
    mockDb.$transaction.mockImplementation(async (fn) => {
      const tx = {
        workPass: { update: jest.fn().mockResolvedValue({ id: 'p1', status: 'RENEWING' }) },
        workPassRenewalChecklist: { create: jest.fn().mockResolvedValue({}) },
      };
      const out = await fn(tx);
      // expose checklist call count on the mock so the test can verify
      mockDb._lastChecklistCreates = tx.workPassRenewalChecklist.create.mock.calls.length;
      return out;
    });
    const res = await request(app).post('/recruitment/work-passes/p1/renewal/initiate').send({});
    expect(res.status).toBe(201);
    expect(res.body.workPass.status).toBe('RENEWING');
    expect(res.body.checklistItems).toBeGreaterThanOrEqual(8);
    expect(mockDb._lastChecklistCreates).toBeGreaterThanOrEqual(8);
  });

  test('W18 — initiate 409 if already renewing', async () => {
    mockDb.workPass.findUnique.mockResolvedValueOnce({ id: 'p1', passType: 'WP', status: 'RENEWING', renewalInitiatedAt: new Date() });
    const res = await request(app).post('/recruitment/work-passes/p1/renewal/initiate').send({});
    expect(res.status).toBe(409);
  });

  test('W19 — initiate 409 on CANCELLED pass', async () => {
    mockDb.workPass.findUnique.mockResolvedValueOnce({ id: 'p1', passType: 'WP', status: 'CANCELLED', renewalInitiatedAt: null });
    const res = await request(app).post('/recruitment/work-passes/p1/renewal/initiate').send({});
    expect(res.status).toBe(409);
  });

  test('W20 — initiate 404 when pass missing', async () => {
    mockDb.workPass.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/recruitment/work-passes/missing/renewal/initiate').send({});
    expect(res.status).toBe(404);
  });

  test('W21 — GET checklist returns items', async () => {
    mockDb.workPassRenewalChecklist.findMany.mockResolvedValueOnce([
      { id: 'c1', workPassId: 'p1', itemName: 'Submit renewal', isComplete: false },
    ]);
    const res = await request(app).get('/recruitment/work-passes/p1/renewal/checklist');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('W22 — PUT checklist item stamps completion', async () => {
    mockDb.workPassRenewalChecklist.update.mockResolvedValueOnce({ id: 'c1', isComplete: true, completedAt: new Date(), completedBy: 'admin-001' });
    const res = await request(app).put('/recruitment/work-passes/p1/renewal/checklist/c1').send({ isComplete: true });
    expect(res.status).toBe(200);
    expect(res.body.isComplete).toBe(true);
    const call = mockDb.workPassRenewalChecklist.update.mock.calls[0][0];
    expect(call.data.completedAt).toBeInstanceOf(Date);
    expect(call.data.completedBy).toBe('admin-001');
  });

  test('W23 — APPROVED outcome flips status to ACTIVE + clears alerts + bumps expiry', async () => {
    mockDb.workPass.findUnique.mockResolvedValueOnce({ id: 'p1', status: 'RENEWING' });
    mockDb.workPassAlert.deleteMany.mockResolvedValueOnce({ count: 3 });
    mockDb.workPass.update.mockResolvedValueOnce({ id: 'p1', status: 'ACTIVE', expiryDate: new Date('2027-12-31') });
    const res = await request(app).put('/recruitment/work-passes/p1/renewal/outcome').send({
      outcome: 'APPROVED', renewalReference: 'MOM-12345', newExpiryDate: '2027-12-31',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACTIVE');
    expect(mockDb.workPassAlert.deleteMany).toHaveBeenCalledWith({ where: { workPassId: 'p1' } });
  });

  test('W24 — REJECTED outcome flips to EXPIRED', async () => {
    mockDb.workPass.findUnique.mockResolvedValueOnce({ id: 'p1', status: 'RENEWING' });
    mockDb.workPass.update.mockResolvedValueOnce({ id: 'p1', status: 'EXPIRED', renewalOutcome: 'REJECTED' });
    const res = await request(app).put('/recruitment/work-passes/p1/renewal/outcome').send({ outcome: 'REJECTED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EXPIRED');
  });

  test('W25 — outcome 409 when pass not in RENEWING state', async () => {
    mockDb.workPass.findUnique.mockResolvedValueOnce({ id: 'p1', status: 'ACTIVE' });
    const res = await request(app).put('/recruitment/work-passes/p1/renewal/outcome').send({ outcome: 'APPROVED' });
    expect(res.status).toBe(409);
  });

  test('W26 — outcome rejects invalid outcome value', async () => {
    const res = await request(app).put('/recruitment/work-passes/p1/renewal/outcome').send({ outcome: 'WHATEVER' });
    expect(res.status).toBe(400);
  });
});

// ── Expiring dashboard ────────────────────────────────────────────────────

describe('GET /work-passes/expiring', () => {
  test('W27 — filters to within window + groups by urgency', async () => {
    const in10  = new Date(); in10.setUTCDate(in10.getUTCDate() + 10);
    const in50  = new Date(); in50.setUTCDate(in50.getUTCDate() + 50);
    const in120 = new Date(); in120.setUTCDate(in120.getUTCDate() + 120);
    mockDb.workPass.findMany.mockResolvedValueOnce([
      { id: 'p1', passType: 'WP', expiryDate: in10,  status: 'ACTIVE' },
      { id: 'p2', passType: 'EP', expiryDate: in50,  status: 'ACTIVE' },
      { id: 'p3', passType: 'WP', expiryDate: in120, status: 'ACTIVE' },
    ]);
    const res = await request(app).get('/recruitment/work-passes/expiring?withinDays=90');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.summary.CRITICAL).toBe(1);
    expect(res.body.summary.WARNING).toBe(1);
  });

  test('W28 — defaults to 90-day window when no query param', async () => {
    mockDb.workPass.findMany.mockResolvedValueOnce([]);
    const res = await request(app).get('/recruitment/work-passes/expiring');
    expect(res.status).toBe(200);
    expect(res.body.withinDays).toBe(90);
  });
});
