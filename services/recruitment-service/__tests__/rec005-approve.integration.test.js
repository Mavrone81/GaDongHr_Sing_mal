'use strict';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockDb = {
  candidate: {
    findUnique: jest.fn(),
    update:     jest.fn(),
    findMany:   jest.fn().mockResolvedValue([]),
    count:      jest.fn().mockResolvedValue(0),
    create:     jest.fn(),
  },
  jobPosting:          { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  candidateStageEvent: { create: jest.fn() },
  onboardingTask:      { createMany: jest.fn(), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  interviewRound:      { create: jest.fn(), update: jest.fn() },
  workPass:            { findMany: jest.fn().mockResolvedValue([]) },
  $transaction:        jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

jest.mock('multer', () => {
  const m = jest.fn(() => ({ single: () => (_req, _res, next) => next() }));
  m.diskStorage = jest.fn(() => ({}));
  return m;
});

// Mock global fetch used by the approve endpoint
global.fetch = jest.fn();

const request = require('supertest');
const { app }  = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CANDIDATE_OFFER = {
  id: 'cand-001', firstName: 'Alice', lastName: 'Tan', email: 'alice@example.com',
  phone: '+65 9123 4567', currentTitle: 'Software Engineer',
  stage: 'OFFER', isHired: false, isOfferMade: true, employeeId: null,
  jobId: 'job-001', expectedSalary: 5000,
  job: { id: 'job-001', title: 'Senior Engineer', department: 'Engineering' },
  createdAt: new Date(), updatedAt: new Date(),
};

const CREATED_EMPLOYEE = {
  id: 'emp-new-001', firstName: 'Alice', lastName: 'Tan',
  email: 'alice@example.com', department: 'Engineering',
  jobTitle: 'Senior Engineer', basicSalary: 5000,
  startDate: '2026-06-01', isActive: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: transaction calls both candidates.update + stageEvent.create
  mockDb.$transaction.mockImplementation(async (ops) => {
    for (const op of ops) await op;
    return [];
  });
});

// ── A) Happy path ──────────────────────────────────────────────────────────────

describe('POST /recruitment/candidates/:id/approve — happy path', () => {
  test('R1 — creates employee, marks candidate HIRED, fires all triggers', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    mockDb.candidate.update.mockResolvedValue({ ...CANDIDATE_OFFER, stage: 'HIRED', isHired: true, employeeId: 'emp-new-001' });
    mockDb.candidateStageEvent.create.mockResolvedValue({});
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});

    // fetch mock: employee service succeeds; leave + notification are best-effort
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => CREATED_EMPLOYEE }) // employee POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })              // leave provision
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });             // email

    const res = await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01', department: 'Engineering', jobTitle: 'Senior Engineer', basicSalary: 5000 });

    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe('emp-new-001');
    expect(res.body.candidateId).toBe('cand-001');
    expect(res.body.triggers.employeeCreated).toBe(true);
  });

  test('R2 — itTaskCreated trigger fires and creates onboarding tasks', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    mockDb.candidate.update.mockResolvedValue({ ...CANDIDATE_OFFER, stage: 'HIRED', isHired: true, employeeId: 'emp-new-001' });
    mockDb.candidateStageEvent.create.mockResolvedValue({});
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});

    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => CREATED_EMPLOYEE })
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    const res = await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01' });

    expect(res.status).toBe(201);
    expect(res.body.triggers.itTaskCreated).toBe(true);
    // IT createMany should have been called once (5 IT tasks)
    expect(mockDb.onboardingTask.createMany).toHaveBeenCalledTimes(1);
    const createManyArg = mockDb.onboardingTask.createMany.mock.calls[0][0];
    expect(createManyArg.data).toHaveLength(5);
    expect(createManyArg.data[0].taskName).toMatch(/Active Directory|account/i);
  });

  test('R3 — payrollSetupQueued and probationStarted triggers fire', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    mockDb.candidate.update.mockResolvedValue({ ...CANDIDATE_OFFER, stage: 'HIRED', isHired: true, employeeId: 'emp-new-001' });
    mockDb.candidateStageEvent.create.mockResolvedValue({});
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => CREATED_EMPLOYEE })
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    const res = await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01', probationMonths: 6 });

    expect(res.status).toBe(201);
    expect(res.body.triggers.payrollSetupQueued).toBe(true);
    expect(res.body.triggers.probationStarted).toBe(true);
    // Verify onboardingTask.create called twice: payroll + probation
    expect(mockDb.onboardingTask.create).toHaveBeenCalledTimes(2);
    const calls = mockDb.onboardingTask.create.mock.calls.map(c => c[0].data.taskName);
    expect(calls.some(t => /payroll/i.test(t))).toBe(true);
    expect(calls.some(t => /probation/i.test(t))).toBe(true);
  });

  test('R4 — probation end date is startDate + probationMonths', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    mockDb.candidate.update.mockResolvedValue({ ...CANDIDATE_OFFER, stage: 'HIRED', isHired: true, employeeId: 'emp-new-001' });
    mockDb.candidateStageEvent.create.mockResolvedValue({});
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => CREATED_EMPLOYEE })
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    const res = await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01', probationMonths: 3 });

    expect(res.status).toBe(201);
    // Probation task dueDate should be 2026-09-01 (3 months after startDate)
    const probationCall = mockDb.onboardingTask.create.mock.calls.find(c =>
      /probation/i.test(c[0].data.taskName)
    );
    expect(probationCall).toBeDefined();
    const dueDate = probationCall[0].data.dueDate;
    expect(dueDate.getFullYear()).toBe(2026);
    expect(dueDate.getMonth()).toBe(8); // month 8 = September (0-indexed)
  });

  test('R5 — employee fetch includes auth header', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    mockDb.candidate.update.mockResolvedValue({ ...CANDIDATE_OFFER, stage: 'HIRED', isHired: true, employeeId: 'emp-new-001' });
    mockDb.candidateStageEvent.create.mockResolvedValue({});
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => CREATED_EMPLOYEE })
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer mytoken')
      .send({ startDate: '2026-06-01' });

    const firstFetchCall = global.fetch.mock.calls[0];
    expect(firstFetchCall[1].headers['Authorization']).toBe('Bearer mytoken');
  });
});

// ── B) Validation errors ──────────────────────────────────────────────────────

describe('POST /recruitment/candidates/:id/approve — validation', () => {
  test('R6 — 404 when candidate not found', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/recruitment/candidates/nope/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01' });
    expect(res.status).toBe(404);
  });

  test('R7 — 409 when candidate already hired', async () => {
    mockDb.candidate.findUnique.mockResolvedValue({ ...CANDIDATE_OFFER, isHired: true, employeeId: 'emp-existing' });
    const res = await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01' });
    expect(res.status).toBe(409);
    expect(res.body.employeeId).toBe('emp-existing');
  });

  test('R8 — 400 when startDate missing', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    const res = await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ department: 'Engineering' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/startDate/i);
  });

  test('R9 — 502 when employee service is unreachable', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    global.fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/unreachable/i);
  });

  test('R10 — 502 when employee service returns non-OK', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    global.fetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Email already in use' }),
    });

    const res = await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01' });
    expect(res.status).toBe(502);
    expect(res.body.details.error).toMatch(/Email/i);
  });
});

// ── C) Resilience: downstream failures don't block approval ──────────────────

describe('POST /recruitment/candidates/:id/approve — downstream resilience', () => {
  test('R11 — approval succeeds even when leave service is down', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    mockDb.candidate.update.mockResolvedValue({ ...CANDIDATE_OFFER, stage: 'HIRED', isHired: true, employeeId: 'emp-new-001' });
    mockDb.candidateStageEvent.create.mockResolvedValue({});
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});

    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => CREATED_EMPLOYEE })   // employee — ok
      .mockRejectedValueOnce(new Error('leave service down'))                      // leave — fails
      .mockResolvedValue({ ok: true, json: async () => ({}) });                    // email — ok

    const res = await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01' });

    expect(res.status).toBe(201);
    expect(res.body.triggers.employeeCreated).toBe(true);
    // leaveProvisioned will be false since it failed but that's ok
    expect(res.body.triggers.leaveProvisioned).toBe(false);
  });

  test('R12 — approval succeeds even when notification service is down', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    mockDb.candidate.update.mockResolvedValue({ ...CANDIDATE_OFFER, stage: 'HIRED', isHired: true, employeeId: 'emp-new-001' });
    mockDb.candidateStageEvent.create.mockResolvedValue({});
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});

    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => CREATED_EMPLOYEE })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })                 // leave ok
      .mockRejectedValue(new Error('notification service down'));                   // email fails

    const res = await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01' });

    expect(res.status).toBe(201);
    expect(res.body.triggers.employeeCreated).toBe(true);
    expect(res.body.triggers.emailSent).toBe(false);
  });

  test('R13 — stageEvent and candidate update called in transaction', async () => {
    mockDb.candidate.findUnique.mockResolvedValue(CANDIDATE_OFFER);
    mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
    mockDb.onboardingTask.create.mockResolvedValue({});
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => CREATED_EMPLOYEE })
      .mockResolvedValue({ ok: true, json: async () => ({}) });

    await request(app)
      .post('/recruitment/candidates/cand-001/approve')
      .set('authorization', 'Bearer test')
      .send({ startDate: '2026-06-01' });

    // $transaction should have been called with 2 operations (update + stageEvent)
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    const ops = mockDb.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(2);
  });
});
