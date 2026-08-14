'use strict';

let mockUser = { sub: 'admin-001', role: 'HR_ADMIN' };
const setUser = (u) => { mockUser = { ...mockUser, ...u }; };

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

global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

const mockDb = {
  jobPosting:   { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  candidate:    { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  candidateStageEvent: { create: jest.fn() },
  workPass:     { findMany: jest.fn().mockResolvedValue([]) },
  workPassAlert: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  workPassRenewalChecklist: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  drcQuotaConfig: { findMany: jest.fn(), upsert: jest.fn() },
  onboardingTask: { createMany: jest.fn(), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  interviewRound: { create: jest.fn(), update: jest.fn() },
  policyDocument: { findMany: jest.fn().mockResolvedValue([]) },
  policyAcknowledgement: { createMany: jest.fn() },
  buddyAssignment: { upsert: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
  offerLetter: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(async (ops) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    return ops(mockDb);
  }),
  $disconnect: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

const request = require('supertest');
const { app } = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const JOB = {
  id: 'job-001', title: 'Software Engineer', department: 'Engineering',
  status: 'OPEN', mcfPostedAt: new Date(Date.now() - 20 * 864e5),
  fcfExempt: false, salaryMin: 4000, salaryMax: 8000,
};
const CANDIDATE_OFFER = {
  id: 'cand-001', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com',
  stage: 'OFFER', isOfferMade: true, isHired: false, jobId: 'job-001', job: JOB,
};
const OFFER_LETTER = {
  id: 'ol-001', candidateId: 'cand-001',
  jobTitle: 'Software Engineer', department: 'Engineering',
  startDate: new Date('2026-07-01'), offeredSalary: 6000,
  probationMonths: 3, reportingManager: null, additionalTerms: null,
  status: 'DRAFT', esignRequestId: null,
  signedAt: null, declinedAt: null, declinedReason: null,
  expiresAt: new Date(Date.now() + 7 * 864e5),
  generatedBy: 'admin-001', createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
  setUser({ sub: 'admin-001', role: 'HR_ADMIN' });
});

// ── OL-01 POST — creates offer letter for OFFER-stage candidate ───────────────
test('OL-01 POST /candidates/:id/offer-letter creates offer letter', async () => {
  mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
  mockDb.offerLetter.findFirst.mockResolvedValue(null);
  mockDb.offerLetter.create.mockResolvedValue(OFFER_LETTER);

  const res = await request(app).post('/recruitment/candidates/cand-001/offer-letter').send({
    startDate: '2026-07-01', offeredSalary: 6000, sendForEsign: false,
  });
  expect(res.status).toBe(201);
  expect(res.body.offerLetter.jobTitle).toBe('Software Engineer');
  expect(res.body.offerLetter.status).toBe('DRAFT');
});

// ── OL-02 POST — 404 for unknown candidate ────────────────────────────────────
test('OL-02 POST offer-letter returns 404 for unknown candidate', async () => {
  mockDb.candidate.findUnique.mockResolvedValue(null);
  const res = await request(app).post('/recruitment/candidates/unknown/offer-letter').send({});
  expect(res.status).toBe(404);
});

// ── OL-03 POST — 400 if candidate not at OFFER/HIRED stage ───────────────────
test('OL-03 POST offer-letter returns 400 when candidate not at OFFER stage', async () => {
  mockDb.candidate.findUnique.mockResolvedValue({ ...CANDIDATE_OFFER, stage: 'SCREENING' });
  const res = await request(app).post('/recruitment/candidates/cand-001/offer-letter').send({});
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/OFFER/);
});

// ── OL-04 POST — updates existing letter (upsert) ────────────────────────────
test('OL-04 POST offer-letter upserts existing letter', async () => {
  mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
  mockDb.offerLetter.findFirst.mockResolvedValue(OFFER_LETTER);
  const updated = { ...OFFER_LETTER, offeredSalary: 7000 };
  mockDb.offerLetter.update.mockResolvedValue(updated);

  const res = await request(app).post('/recruitment/candidates/cand-001/offer-letter').send({
    offeredSalary: 7000, sendForEsign: false,
  });
  expect(res.status).toBe(201);
  expect(mockDb.offerLetter.update).toHaveBeenCalled();
});

// ── OL-05 POST — dispatches e-sign when sendForEsign=true ────────────────────
test('OL-05 POST offer-letter dispatches e-sign request when sendForEsign=true', async () => {
  mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
  mockDb.offerLetter.findFirst.mockResolvedValue(null);
  mockDb.offerLetter.create.mockResolvedValue(OFFER_LETTER);
  mockDb.offerLetter.update.mockResolvedValue({ ...OFFER_LETTER, esignRequestId: 'esign-001', status: 'SENT' });

  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'esign-001' }),
  });

  const res = await request(app).post('/recruitment/candidates/cand-001/offer-letter').send({
    startDate: '2026-07-01', sendForEsign: true,
  });
  expect(res.status).toBe(201);
  expect(res.body.esignDispatched).toBe(true);
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/esign/requests'),
    expect.objectContaining({ method: 'POST' })
  );
});

// ── OL-06 POST — e-sign failure is non-blocking ───────────────────────────────
test('OL-06 POST offer-letter succeeds even when e-sign service is down', async () => {
  mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
  mockDb.offerLetter.findFirst.mockResolvedValue(null);
  mockDb.offerLetter.create.mockResolvedValue(OFFER_LETTER);
  global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

  const res = await request(app).post('/recruitment/candidates/cand-001/offer-letter').send({
    sendForEsign: true,
  });
  expect(res.status).toBe(201);
  expect(res.body.esignDispatched).toBe(false);
  expect(res.body.esignError).toBeTruthy();
});

// ── OL-07 GET /candidates/:id/offer-letter — returns letter ──────────────────
test('OL-07 GET /candidates/:id/offer-letter returns existing letter', async () => {
  mockDb.offerLetter.findFirst.mockResolvedValue(OFFER_LETTER);
  const res = await request(app).get('/recruitment/candidates/cand-001/offer-letter');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('DRAFT');
});

// ── OL-08 GET — 404 when no letter exists ────────────────────────────────────
test('OL-08 GET /candidates/:id/offer-letter returns 404 when not found', async () => {
  mockDb.offerLetter.findFirst.mockResolvedValue(null);
  const res = await request(app).get('/recruitment/candidates/cand-001/offer-letter');
  expect(res.status).toBe(404);
});

// ── OL-09 PUT — update status to SIGNED ──────────────────────────────────────
test('OL-09 PUT /candidates/:id/offer-letter marks SIGNED', async () => {
  mockDb.offerLetter.findFirst.mockResolvedValue(OFFER_LETTER);
  mockDb.offerLetter.update.mockResolvedValue({ ...OFFER_LETTER, status: 'SIGNED', signedAt: new Date() });

  const res = await request(app).put('/recruitment/candidates/cand-001/offer-letter').send({ status: 'SIGNED' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('SIGNED');
});

// ── OL-10 PUT — update status to DECLINED with reason ────────────────────────
test('OL-10 PUT /candidates/:id/offer-letter marks DECLINED with reason', async () => {
  mockDb.offerLetter.findFirst.mockResolvedValue(OFFER_LETTER);
  mockDb.offerLetter.update.mockResolvedValue({ ...OFFER_LETTER, status: 'DECLINED', declinedReason: 'Counter offer accepted' });

  const res = await request(app).put('/recruitment/candidates/cand-001/offer-letter').send({
    status: 'DECLINED', declinedReason: 'Counter offer accepted',
  });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('DECLINED');
});

// ── OL-11 PUT — 400 on invalid status ────────────────────────────────────────
test('OL-11 PUT /candidates/:id/offer-letter 400 on invalid status', async () => {
  const res = await request(app).put('/recruitment/candidates/cand-001/offer-letter').send({ status: 'ACCEPTED' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/status/);
});

// ── OL-12 PUT — 404 when no letter exists ────────────────────────────────────
test('OL-12 PUT /candidates/:id/offer-letter returns 404 when no letter', async () => {
  mockDb.offerLetter.findFirst.mockResolvedValue(null);
  const res = await request(app).put('/recruitment/candidates/cand-001/offer-letter').send({ status: 'SIGNED' });
  expect(res.status).toBe(404);
});

// ── OL-13 GET PDF — streams PDF bytes ────────────────────────────────────────
test('OL-13 GET /candidates/:id/offer-letter/pdf streams PDF content', async () => {
  mockDb.offerLetter.findFirst.mockResolvedValue(OFFER_LETTER);
  mockDb.candidate.findUnique.mockResolvedValue({ ...CANDIDATE_OFFER, job: JOB });

  const res = await request(app).get('/recruitment/candidates/cand-001/offer-letter/pdf');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/pdf/);
  expect(res.body.length).toBeGreaterThan(100);
}, 10000);

// ── OL-14 GET PDF — 404 when no letter ───────────────────────────────────────
test('OL-14 GET /candidates/:id/offer-letter/pdf returns 404 when no letter', async () => {
  mockDb.offerLetter.findFirst.mockResolvedValue(null);
  const res = await request(app).get('/recruitment/candidates/cand-001/offer-letter/pdf');
  expect(res.status).toBe(404);
});

// ── OL-15 role guard — EMPLOYEE blocked ──────────────────────────────────────
test('OL-15 offer letter endpoints return 403 for EMPLOYEE role', async () => {
  setUser({ role: 'EMPLOYEE' });
  const res = await request(app).post('/recruitment/candidates/cand-001/offer-letter').send({});
  expect(res.status).toBe(403);
});
