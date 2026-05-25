'use strict';
/**
 * Integration tests for REC-002 FCF routes:
 *
 *   POST  /jobs/:id/fcf-compliance       (existing — verify fcfNotes capture)
 *   GET   /jobs/:id/fcf-status
 *   PUT   /jobs/:id/fcf-exempt
 *   PATCH /candidates/:id/audit
 *   GET   /recruitment/fcf-report
 *   POST  /candidates/:id/approve         (FCF gate enforcement)
 */

let mockUser = { sub: 'admin-001', role: 'HR_ADMIN' };
const setUser = (u) => { mockUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    RECRUITER: 'RECRUITER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const mockDb = {
  jobPosting: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  candidate:  { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  candidateStageEvent: { create: jest.fn() },
  workPass:   { findMany: jest.fn().mockResolvedValue([]) },
  workPassAlert: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  workPassRenewalChecklist: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  drcQuotaConfig: { findMany: jest.fn(), upsert: jest.fn() },
  onboardingTask: { createMany: jest.fn(), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  interviewRound: { create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(async (ops) => {
    if (typeof ops === 'function') return ops({});
    return Promise.all(ops);
  }),
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
  setUser({ sub: 'admin-001', role: 'HR_ADMIN' });
});

const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

// ── FCF status + exempt ────────────────────────────────────────────────────

describe('GET /jobs/:id/fcf-status', () => {
  test('F1 — returns NOT_POSTED when no MCF posting', async () => {
    mockDb.jobPosting.findUnique.mockResolvedValueOnce({ id: 'j1', title: 'Eng' });
    const res = await request(app).get('/recruitment/jobs/j1/fcf-status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NOT_POSTED');
    expect(res.body.blocksHire).toBe(true);
  });

  test('F2 — returns IN_PERIOD with daysRemaining when posted < 14d ago', async () => {
    mockDb.jobPosting.findUnique.mockResolvedValueOnce({ id: 'j1', title: 'Eng', mcfPostedAt: daysAgo(5) });
    const res = await request(app).get('/recruitment/jobs/j1/fcf-status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PERIOD');
    expect(res.body.daysRemaining).toBe(9);
  });

  test('F3 — returns COMPLIANT when posted ≥ 14d ago', async () => {
    mockDb.jobPosting.findUnique.mockResolvedValueOnce({ id: 'j1', title: 'Eng', mcfPostedAt: daysAgo(30) });
    const res = await request(app).get('/recruitment/jobs/j1/fcf-status');
    expect(res.body.status).toBe('COMPLIANT');
    expect(res.body.blocksHire).toBe(false);
  });

  test('F4 — returns EXEMPT when fcfExempt=true', async () => {
    mockDb.jobPosting.findUnique.mockResolvedValueOnce({ id: 'j1', fcfExempt: true, fcfExemptReason: 'HIGH_SALARY' });
    const res = await request(app).get('/recruitment/jobs/j1/fcf-status');
    expect(res.body.status).toBe('EXEMPT');
    expect(res.body.exemptReason).toBe('HIGH_SALARY');
  });

  test('F5 — 404 when job missing', async () => {
    mockDb.jobPosting.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).get('/recruitment/jobs/missing/fcf-status');
    expect(res.status).toBe(404);
  });
});

describe('PUT /jobs/:id/fcf-exempt', () => {
  test('F6 — grants exemption with required reason + note', async () => {
    mockDb.jobPosting.update.mockResolvedValueOnce({ id: 'j1', fcfExempt: true, fcfExemptReason: 'HIGH_SALARY' });
    const res = await request(app).put('/recruitment/jobs/j1/fcf-exempt').send({
      fcfExempt: true, fcfExemptReason: 'HIGH_SALARY', fcfExemptNote: 'Monthly salary > S$30k',
    });
    expect(res.status).toBe(200);
    expect(res.body.fcfExempt).toBe(true);
  });

  test('F7 — 400 when reason not in whitelist', async () => {
    const res = await request(app).put('/recruitment/jobs/j1/fcf-exempt').send({
      fcfExempt: true, fcfExemptReason: 'BECAUSE_I_SAID', fcfExemptNote: 'x',
    });
    expect(res.status).toBe(400);
  });

  test('F8 — 400 when note is empty', async () => {
    const res = await request(app).put('/recruitment/jobs/j1/fcf-exempt').send({
      fcfExempt: true, fcfExemptReason: 'HIGH_SALARY', fcfExemptNote: '  ',
    });
    expect(res.status).toBe(400);
  });

  test('F9 — fcfExempt=false clears the exemption fields', async () => {
    mockDb.jobPosting.update.mockResolvedValueOnce({ id: 'j1', fcfExempt: false });
    const res = await request(app).put('/recruitment/jobs/j1/fcf-exempt').send({ fcfExempt: false });
    expect(res.status).toBe(200);
    const call = mockDb.jobPosting.update.mock.calls[0][0];
    expect(call.data.fcfExemptReason).toBeNull();
    expect(call.data.fcfExemptBy).toBeNull();
  });

  test('F10 — 403 for non-admin', async () => {
    setUser({ sub: 'r-1', role: 'RECRUITER' });
    const res = await request(app).put('/recruitment/jobs/j1/fcf-exempt').send({ fcfExempt: false });
    expect(res.status).toBe(403);
  });
});

// ── Candidate audit ────────────────────────────────────────────────────────

describe('PATCH /candidates/:id/audit', () => {
  test('F11 — updates audit fields', async () => {
    mockDb.candidate.update.mockResolvedValueOnce({ id: 'c1', nationality: 'Indian', hiringRationale: 'Strong technical fit' });
    const res = await request(app).patch('/recruitment/candidates/c1/audit').send({
      nationality: 'Indian', citizenStatus: 'FOREIGNER', hiringRationale: 'Strong technical fit',
    });
    expect(res.status).toBe(200);
    expect(res.body.nationality).toBe('Indian');
  });

  test('F12 — 400 on invalid citizenStatus', async () => {
    const res = await request(app).patch('/recruitment/candidates/c1/audit').send({ citizenStatus: 'ALIEN' });
    expect(res.status).toBe(400);
  });

  test('F13 — 400 when no audit fields supplied', async () => {
    const res = await request(app).patch('/recruitment/candidates/c1/audit').send({});
    expect(res.status).toBe(400);
  });

  test('F14 — 404 when candidate missing', async () => {
    mockDb.candidate.update.mockRejectedValueOnce({ code: 'P2025' });
    const res = await request(app).patch('/recruitment/candidates/missing/audit').send({ nationality: 'SC' });
    expect(res.status).toBe(404);
  });
});

// ── FCF report ─────────────────────────────────────────────────────────────

describe('GET /recruitment/fcf-report', () => {
  test('F15 — assembles per-job rows + summary', async () => {
    mockDb.jobPosting.findMany.mockResolvedValueOnce([
      { id: 'j1', title: 'A', department: 'D', headcount: 1, mcfPostedAt: daysAgo(20) },
      { id: 'j2', title: 'B', department: 'D', headcount: 1 },
      { id: 'j3', title: 'C', department: 'D', headcount: 1, fcfExempt: true, fcfExemptReason: 'HIGH_SALARY' },
    ]);
    mockDb.candidate.findMany.mockResolvedValueOnce([
      { id: 'c1', jobId: 'j1', firstName: 'A', lastName: 'B', nationality: 'SC', stage: 'HIRED', isHired: true, hiringRationale: 'Top performer' },
      { id: 'c2', jobId: 'j1', firstName: 'X', lastName: 'Y', nationality: 'Indian', stage: 'REJECTED', rejectionReason: 'Below bar' },
      { id: 'c3', jobId: 'j2', firstName: 'P', lastName: 'Q', nationality: 'Chinese', stage: 'HIRED', isHired: true },
    ]);
    const res = await request(app).get('/recruitment/fcf-report');
    expect(res.status).toBe(200);
    expect(res.body.summary.totalJobs).toBe(3);
    expect(res.body.summary.totalHired).toBe(2);
    expect(res.body.summary.byStatus.COMPLIANT).toBe(1);
    expect(res.body.summary.byStatus.NOT_POSTED).toBe(1);
    expect(res.body.summary.byStatus.EXEMPT).toBe(1);
    // j2 (NOT_POSTED) has a hire → violation
    expect(res.body.summary.complianceViolations).toBe(1);
    const j1Row = res.body.rows.find(r => r.jobId === 'j1');
    expect(j1Row.hiringDecisions[0].hiringRationale).toBe('Top performer');
    expect(j1Row.rejectionAudit[0].rejectionReason).toBe('Below bar');
    expect(j1Row.nationalityBreakdown.citizens).toBe(1);
    expect(j1Row.nationalityBreakdown.foreigners).toBe(1);
  });

  test('F16 — filters by jobId', async () => {
    mockDb.jobPosting.findMany.mockResolvedValueOnce([]);
    mockDb.candidate.findMany.mockResolvedValueOnce([]);
    await request(app).get('/recruitment/fcf-report?jobId=j-only');
    const call = mockDb.jobPosting.findMany.mock.calls[0][0];
    expect(call.where.id).toBe('j-only');
  });

  test('F17 — 403 for EMPLOYEE role', async () => {
    setUser({ sub: 'e-1', role: 'EMPLOYEE' });
    const res = await request(app).get('/recruitment/fcf-report');
    expect(res.status).toBe(403);
  });
});

// ── FCF gate on hire approval ──────────────────────────────────────────────

describe('POST /candidates/:id/approve — FCF gate', () => {
  test('F18 — blocks hire when job NOT_POSTED', async () => {
    mockDb.candidate.findUnique.mockResolvedValueOnce({
      id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com',
      stage: 'OFFER', isHired: false, jobId: 'j1',
      job: { id: 'j1', title: 'Eng' /* no mcfPostedAt → NOT_POSTED */ },
    });
    const res = await request(app).post('/recruitment/candidates/c1/approve').send({ startDate: '2026-06-01' });
    expect(res.status).toBe(409);
    expect(res.body.fcfStatus).toBe('NOT_POSTED');
    expect(res.body.hint).toMatch(/MyCareersFuture/);
  });

  test('F19 — blocks hire when IN_PERIOD', async () => {
    mockDb.candidate.findUnique.mockResolvedValueOnce({
      id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com',
      stage: 'OFFER', isHired: false, jobId: 'j1',
      job: { id: 'j1', title: 'Eng', mcfPostedAt: daysAgo(5) },
    });
    const res = await request(app).post('/recruitment/candidates/c1/approve').send({ startDate: '2026-06-01' });
    expect(res.status).toBe(409);
    expect(res.body.fcfStatus).toBe('IN_PERIOD');
    expect(res.body.daysRemaining).toBe(9);
  });

  test('F20 — passes when COMPLIANT', async () => {
    mockDb.candidate.findUnique.mockResolvedValueOnce({
      id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com',
      stage: 'OFFER', isHired: false, jobId: 'j1',
      job: { id: 'j1', title: 'Eng', department: 'Eng', mcfPostedAt: daysAgo(20) },
    });
    mockDb.candidate.update.mockResolvedValueOnce({ id: 'c1' });
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'emp-1' }) })  // employee create
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })                // leave provision
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });               // email
    const res = await request(app).post('/recruitment/candidates/c1/approve').send({ startDate: '2026-06-01' });
    expect(res.status).toBe(201);
  });

  test('F21 — passes when EXEMPT', async () => {
    mockDb.candidate.findUnique.mockResolvedValueOnce({
      id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com',
      stage: 'OFFER', isHired: false, jobId: 'j1',
      job: { id: 'j1', title: 'Eng', department: 'Eng', fcfExempt: true, fcfExemptReason: 'HIGH_SALARY' },
    });
    mockDb.candidate.update.mockResolvedValueOnce({ id: 'c1' });
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'emp-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const res = await request(app).post('/recruitment/candidates/c1/approve').send({ startDate: '2026-06-01' });
    expect(res.status).toBe(201);
  });

  test('F22 — SUPER_ADMIN can override the gate with fcfOverride=true', async () => {
    setUser({ sub: 'sa', role: 'SUPER_ADMIN' });
    mockDb.candidate.findUnique.mockResolvedValueOnce({
      id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com',
      stage: 'OFFER', isHired: false, jobId: 'j1',
      job: { id: 'j1', title: 'Eng', department: 'Eng' /* NOT_POSTED */ },
    });
    mockDb.candidate.update.mockResolvedValueOnce({ id: 'c1' });
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'emp-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const res = await request(app).post('/recruitment/candidates/c1/approve').send({ startDate: '2026-06-01', fcfOverride: true });
    expect(res.status).toBe(201);
  });

  test('F23 — HR_ADMIN cannot use fcfOverride (still blocked)', async () => {
    mockDb.candidate.findUnique.mockResolvedValueOnce({
      id: 'c1', firstName: 'A', lastName: 'B', email: 'a@b.com',
      stage: 'OFFER', isHired: false, jobId: 'j1',
      job: { id: 'j1', title: 'Eng' },
    });
    const res = await request(app).post('/recruitment/candidates/c1/approve').send({ startDate: '2026-06-01', fcfOverride: true });
    expect(res.status).toBe(409);
  });
});

// ── fcfNotes captured on /jobs/:id/fcf-compliance ─────────────────────────

describe('POST /jobs/:id/fcf-compliance', () => {
  test('F24 — captures fcfNotes alongside MCF posting', async () => {
    mockDb.jobPosting.update.mockResolvedValueOnce({ id: 'j1' });
    await request(app).post('/recruitment/jobs/j1/fcf-compliance').send({
      mcfJobId: 'MCF-99', mcfPostedAt: '2026-05-01', fcfNotes: 'Posted on Indeed and JobStreet too',
    });
    const call = mockDb.jobPosting.update.mock.calls[0][0];
    expect(call.data.fcfNotes).toBe('Posted on Indeed and JobStreet too');
  });
});
