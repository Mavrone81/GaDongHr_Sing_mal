'use strict';

const request = require('supertest');

// ── Auth + DB mocks ───────────────────────────────────────────────────────────
let mockRole = 'SUPER_ADMIN';
let mockEmpId = 'emp-admin';

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    // H-17: routes now read req.user.employeeId, not the spoofable header.
    req.user = { sub: 'admin-001', role: mockRole, email: 'admin@test.com', employeeId: mockEmpId };
    next();
  },
  authorize: (..._roles) => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

const mockDb = {
  reviewCycle: {
    create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    update: jest.fn(), delete: jest.fn(), count: jest.fn(),
  },
  appraisal: {
    create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    update: jest.fn(), deleteMany: jest.fn(), count: jest.fn().mockResolvedValue(0),
  },
  goal: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  pipRecord: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  incrementProposal: { upsert: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  feedbackQuestion: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
  feedbackRequest:  { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  feedbackResponse: { create: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

const { app } = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const CYCLE = {
  id: 'cycle-001', name: 'Annual 2026', type: 'ANNUAL', feedbackWeight: 0.3,
  startDate: new Date(), endDate: new Date(), currentPhase: 'SELF_ASSESSMENT',
  status: 'ACTIVE', createdBy: 'admin-001', createdAt: new Date(), updatedAt: new Date(),
};

const Q_RATING = {
  id: 'q-001', cycleId: 'cycle-001', questionText: 'Rate leadership', questionType: 'RATING',
  category: 'Leadership', weight: 1.0, displayOrder: 0, createdAt: new Date(), updatedAt: new Date(),
};

const Q_TEXT = {
  id: 'q-002', cycleId: 'cycle-001', questionText: 'Key strengths', questionType: 'TEXT',
  category: null, weight: 1.0, displayOrder: 1, createdAt: new Date(), updatedAt: new Date(),
};

const NOMINATION = {
  id: 'nom-001', cycleId: 'cycle-001', subjectEmployeeId: 'emp-admin',
  reviewerEmployeeId: 'emp-peer-1', reviewerType: 'PEER',
  status: 'PENDING_APPROVAL', nominatedBy: 'emp-admin',
  nominatedAt: new Date(), approvedBy: null, approvedAt: null,
  submittedAt: null, declinedReason: null, createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'SUPER_ADMIN';
  mockEmpId = 'emp-admin';
});

// ─── Questions ────────────────────────────────────────────────────────────────

describe('POST /performance/cycles/:id/360/questions', () => {
  test('F1 — creates a RATING question', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.feedbackQuestion.create.mockResolvedValue(Q_RATING);

    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/questions')
      .send({ questionText: 'Rate leadership', questionType: 'RATING', category: 'Leadership', weight: 1.0 });

    expect(res.status).toBe(201);
    expect(res.body.questionType).toBe('RATING');
    expect(mockDb.feedbackQuestion.create).toHaveBeenCalledTimes(1);
  });

  test('F2 — creates a TEXT question', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.feedbackQuestion.create.mockResolvedValue(Q_TEXT);

    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/questions')
      .send({ questionText: 'Key strengths', questionType: 'TEXT' });

    expect(res.status).toBe(201);
    expect(res.body.questionType).toBe('TEXT');
  });

  test('F3 — 400 when questionText missing', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/questions')
      .send({ questionType: 'RATING' });
    expect(res.status).toBe(400);
  });

  test('F4 — 400 when questionType invalid', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/questions')
      .send({ questionText: 'Q', questionType: 'BOGUS' });
    expect(res.status).toBe(400);
  });

  test('F5 — 404 when cycle not found', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/performance/cycles/nope/360/questions')
      .send({ questionText: 'Q', questionType: 'RATING' });
    expect(res.status).toBe(404);
  });
});

describe('GET /performance/cycles/:id/360/questions', () => {
  test('F6 — lists questions ordered by displayOrder', async () => {
    mockDb.feedbackQuestion.findMany.mockResolvedValue([Q_RATING, Q_TEXT]);
    const res = await request(app).get('/performance/cycles/cycle-001/360/questions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ─── Feedback weight ──────────────────────────────────────────────────────────

describe('PUT /performance/cycles/:id/feedback-weight', () => {
  test('F7 — sets feedbackWeight to 0.3', async () => {
    mockDb.reviewCycle.update.mockResolvedValue({ ...CYCLE, feedbackWeight: 0.3 });
    const res = await request(app)
      .put('/performance/cycles/cycle-001/feedback-weight')
      .send({ feedbackWeight: 0.3 });
    expect(res.status).toBe(200);
    expect(res.body.feedbackWeight).toBe(0.3);
  });

  test('F8 — 400 when feedbackWeight missing', async () => {
    const res = await request(app).put('/performance/cycles/cycle-001/feedback-weight').send({});
    expect(res.status).toBe(400);
  });

  test('F9 — 400 when feedbackWeight > 1', async () => {
    const res = await request(app)
      .put('/performance/cycles/cycle-001/feedback-weight')
      .send({ feedbackWeight: 1.5 });
    expect(res.status).toBe(400);
  });
});

// ─── Nominations ─────────────────────────────────────────────────────────────

describe('POST /performance/cycles/:id/360/nominations', () => {
  test('F10 — employee nominates a peer', async () => {
    mockEmpId = 'emp-subject';
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.feedbackRequest.findUnique.mockResolvedValue(null);
    mockDb.feedbackRequest.create.mockResolvedValue({ ...NOMINATION, subjectEmployeeId: 'emp-subject' });

    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/nominations')
      .send({ nominations: [{ reviewerEmployeeId: 'emp-peer-1', reviewerType: 'PEER' }] });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    expect(res.body.skipped).toBe(0);
  });

  test('F11 — self-nomination skipped', async () => {
    mockEmpId = 'emp-subject';
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);

    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/nominations')
      .send({ nominations: [{ reviewerEmployeeId: 'emp-subject', reviewerType: 'PEER' }] });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.skippedDetails[0].reason).toMatch(/yourself/i);
  });

  test('F12 — invalid reviewerType skipped', async () => {
    mockEmpId = 'emp-subject';
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);

    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/nominations')
      .send({ nominations: [{ reviewerEmployeeId: 'emp-peer-1', reviewerType: 'INVALID' }] });

    expect(res.status).toBe(201);
    expect(res.body.skipped).toBe(1);
  });

  test('F13 — duplicate nomination skipped', async () => {
    mockEmpId = 'emp-subject';
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.feedbackRequest.findUnique.mockResolvedValue(NOMINATION);

    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/nominations')
      .send({ nominations: [{ reviewerEmployeeId: 'emp-peer-1', reviewerType: 'PEER' }] });

    expect(res.status).toBe(201);
    expect(res.body.skipped).toBe(1);
    expect(res.body.skippedDetails[0].reason).toMatch(/already nominated/i);
  });

  test('F14 — 400 when nominations array missing', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/nominations')
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─── Nomination approval / decline ───────────────────────────────────────────

describe('PUT /performance/cycles/:id/360/nominations/:nomId/approve', () => {
  test('F15 — approves a PENDING_APPROVAL nomination', async () => {
    mockDb.feedbackRequest.findFirst.mockResolvedValue(NOMINATION);
    mockDb.feedbackRequest.update.mockResolvedValue({ ...NOMINATION, status: 'APPROVED', approvedBy: 'admin-001', approvedAt: new Date() });

    const res = await request(app)
      .put('/performance/cycles/cycle-001/360/nominations/nom-001/approve');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
  });

  test('F16 — 409 when approving already-submitted nomination', async () => {
    mockDb.feedbackRequest.findFirst.mockResolvedValue({ ...NOMINATION, status: 'SUBMITTED' });
    const res = await request(app)
      .put('/performance/cycles/cycle-001/360/nominations/nom-001/approve');
    expect(res.status).toBe(409);
  });

  test('F17 — 404 when nomination not found', async () => {
    mockDb.feedbackRequest.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .put('/performance/cycles/cycle-001/360/nominations/nope/approve');
    expect(res.status).toBe(404);
  });
});

describe('PUT /performance/cycles/:id/360/nominations/:nomId/decline', () => {
  test('F18 — declines an APPROVED nomination with reason', async () => {
    mockDb.feedbackRequest.findFirst.mockResolvedValue({ ...NOMINATION, status: 'APPROVED' });
    mockDb.feedbackRequest.update.mockResolvedValue({ ...NOMINATION, status: 'DECLINED', declinedReason: 'Conflict of interest' });

    const res = await request(app)
      .put('/performance/cycles/cycle-001/360/nominations/nom-001/decline')
      .send({ reason: 'Conflict of interest' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DECLINED');
    expect(res.body.declinedReason).toBe('Conflict of interest');
  });

  test('F19 — 409 when declining already-submitted nomination', async () => {
    mockDb.feedbackRequest.findFirst.mockResolvedValue({ ...NOMINATION, status: 'SUBMITTED' });
    const res = await request(app)
      .put('/performance/cycles/cycle-001/360/nominations/nom-001/decline');
    expect(res.status).toBe(409);
  });
});

// ─── My reviews (reviewer perspective) ───────────────────────────────────────

describe('GET /performance/cycles/:id/360/my-reviews', () => {
  test('F20 — reviewer sees their approved requests and cycle questions', async () => {
    mockEmpId = 'emp-peer-1';
    mockDb.feedbackRequest.findMany.mockResolvedValue([{ ...NOMINATION, status: 'APPROVED', reviewerEmployeeId: 'emp-peer-1' }]);
    mockDb.feedbackQuestion.findMany.mockResolvedValue([Q_RATING, Q_TEXT]);

    const res = await request(app)
      .get('/performance/cycles/cycle-001/360/my-reviews');

    expect(res.status).toBe(200);
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.questions).toHaveLength(2);
  });

  test('F21 — 400 when no employee profile', async () => {
    mockEmpId = undefined;
    const res = await request(app).get('/performance/cycles/cycle-001/360/my-reviews');
    expect(res.status).toBe(400);
  });
});

// ─── Submit feedback ─────────────────────────────────────────────────────────

describe('POST /performance/360/submit/:requestId', () => {
  const approvedRequest = {
    ...NOMINATION,
    status: 'APPROVED',
    reviewerEmployeeId: 'emp-peer-1',
    cycleId: 'cycle-001',
    responses: [],
  };

  test('F22 — reviewer submits valid responses', async () => {
    mockEmpId = 'emp-peer-1';
    mockDb.feedbackRequest.findUnique.mockResolvedValue(approvedRequest);
    mockDb.feedbackQuestion.findMany.mockResolvedValue([
      { id: 'q-001', questionType: 'RATING' },
      { id: 'q-002', questionType: 'TEXT' },
    ]);
    mockDb.$transaction.mockResolvedValue([{}, {}]);

    const res = await request(app)
      .post('/performance/360/submit/nom-001')
      .send({
        responses: [
          { questionId: 'q-001', ratingValue: 4 },
          { questionId: 'q-002', textValue: 'Very collaborative' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.submitted).toBe(true);
    expect(res.body.responsesRecorded).toBe(2);
  });

  test('F23 — 403 when reviewer is not the assigned reviewer', async () => {
    mockEmpId = 'emp-other';
    mockDb.feedbackRequest.findUnique.mockResolvedValue(approvedRequest);

    const res = await request(app)
      .post('/performance/360/submit/nom-001')
      .send({ responses: [{ questionId: 'q-001', ratingValue: 4 }] });

    expect(res.status).toBe(403);
  });

  test('F24 — 409 when already submitted', async () => {
    mockEmpId = 'emp-peer-1';
    mockDb.feedbackRequest.findUnique.mockResolvedValue({ ...approvedRequest, status: 'SUBMITTED' });

    const res = await request(app)
      .post('/performance/360/submit/nom-001')
      .send({ responses: [{ questionId: 'q-001', ratingValue: 4 }] });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already submitted/i);
  });

  test('F25 — 409 when request is not yet approved', async () => {
    mockEmpId = 'emp-peer-1';
    mockDb.feedbackRequest.findUnique.mockResolvedValue({ ...approvedRequest, status: 'PENDING_APPROVAL' });

    const res = await request(app)
      .post('/performance/360/submit/nom-001')
      .send({ responses: [{ questionId: 'q-001', ratingValue: 4 }] });

    expect(res.status).toBe(409);
  });

  test('F26 — 400 when ratingValue out of 1-5 range', async () => {
    mockEmpId = 'emp-peer-1';
    mockDb.feedbackRequest.findUnique.mockResolvedValue(approvedRequest);
    mockDb.feedbackQuestion.findMany.mockResolvedValue([{ id: 'q-001', questionType: 'RATING' }]);

    const res = await request(app)
      .post('/performance/360/submit/nom-001')
      .send({ responses: [{ questionId: 'q-001', ratingValue: 7 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1–5/);
  });

  test('F27 — unknown questionIds silently ignored', async () => {
    mockEmpId = 'emp-peer-1';
    mockDb.feedbackRequest.findUnique.mockResolvedValue(approvedRequest);
    mockDb.feedbackQuestion.findMany.mockResolvedValue([{ id: 'q-001', questionType: 'RATING' }]);
    mockDb.$transaction.mockResolvedValue([{}]);

    const res = await request(app)
      .post('/performance/360/submit/nom-001')
      .send({ responses: [{ questionId: 'q-999', ratingValue: 3 }] });

    expect(res.status).toBe(200);
    expect(res.body.responsesRecorded).toBe(0);
  });
});

// ─── Aggregate report ─────────────────────────────────────────────────────────

describe('GET /performance/cycles/:id/360/report/:employeeId', () => {
  test('F28 — HR Admin can view report for any employee', async () => {
    mockRole = 'HR_ADMIN';
    mockDb.feedbackQuestion.findMany.mockResolvedValue([Q_RATING]);
    mockDb.feedbackRequest.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'SUBMITTED', reviewerType: 'PEER',
        responses: [{ questionId: 'q-001', ratingValue: 4 }],
      },
      {
        id: 'r2', status: 'SUBMITTED', reviewerType: 'PEER',
        responses: [{ questionId: 'q-001', ratingValue: 3 }],
      },
      {
        id: 'r3', status: 'SUBMITTED', reviewerType: 'SUPERVISOR',
        responses: [{ questionId: 'q-001', ratingValue: 5 }],
      },
    ]);

    const res = await request(app)
      .get('/performance/cycles/cycle-001/360/report/emp-subject');

    expect(res.status).toBe(200);
    expect(res.body.respondentCount).toBe(3);
    expect(res.body.overallScore).toBe(4);
    expect(res.body.respondentsByType).toEqual({ PEER: 2, SUPERVISOR: 1 });
  });

  test('F29 — employee can view their own report', async () => {
    mockRole = 'EMPLOYEE';
    mockEmpId = 'emp-subject';
    mockDb.feedbackQuestion.findMany.mockResolvedValue([Q_RATING]);
    mockDb.feedbackRequest.findMany.mockResolvedValue([]);

    const res = await request(app)
      .get('/performance/cycles/cycle-001/360/report/emp-subject');

    expect(res.status).toBe(200);
  });

  test('F30 — employee cannot view another employee\'s report', async () => {
    mockRole = 'EMPLOYEE';
    mockEmpId = 'emp-other';

    const res = await request(app)
      .get('/performance/cycles/cycle-001/360/report/emp-subject');

    expect(res.status).toBe(403);
  });

  test('F31 — text comments hidden when fewer than 3 respondents', async () => {
    mockRole = 'HR_ADMIN';
    mockDb.feedbackQuestion.findMany.mockResolvedValue([Q_TEXT]);
    mockDb.feedbackRequest.findMany.mockResolvedValue([
      { id: 'r1', status: 'SUBMITTED', reviewerType: 'PEER', responses: [{ questionId: 'q-002', textValue: 'good' }] },
      { id: 'r2', status: 'SUBMITTED', reviewerType: 'PEER', responses: [{ questionId: 'q-002', textValue: 'ok' }] },
    ]);

    const res = await request(app)
      .get('/performance/cycles/cycle-001/360/report/emp-subject');

    expect(res.status).toBe(200);
    expect(res.body.revealComments).toBe(false);
    expect(res.body.questionStats[0].textComments).toEqual([]);
  });
});

// ─── Apply 360 scores ─────────────────────────────────────────────────────────

describe('POST /performance/cycles/:id/360/apply', () => {
  test('F32 — applies score360 and blends overallScore', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue({ id: 'cycle-001', feedbackWeight: 0.3 });
    mockDb.appraisal.findMany.mockResolvedValue([
      { id: 'apr-001', employeeId: 'emp-001', calibratedScore: 4.0, overallScore: 4.0 },
    ]);
    mockDb.feedbackQuestion.findMany.mockResolvedValue([Q_RATING]);
    mockDb.feedbackRequest.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'SUBMITTED', reviewerType: 'PEER',
        responses: [{ questionId: 'q-001', ratingValue: 3 }],
      },
      {
        id: 'r2', status: 'SUBMITTED', reviewerType: 'PEER',
        responses: [{ questionId: 'q-001', ratingValue: 3 }],
      },
      {
        id: 'r3', status: 'SUBMITTED', reviewerType: 'PEER',
        responses: [{ questionId: 'q-001', ratingValue: 3 }],
      },
    ]);
    mockDb.appraisal.update.mockResolvedValue({});

    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/apply');

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1);
    expect(res.body.results[0].score360).toBe(3);
    // 0.7×4 + 0.3×3 = 3.7
    expect(res.body.results[0].blendedOverallScore).toBe(3.7);
  });

  test('F33 — skips appraisal when no submitted feedback', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue({ id: 'cycle-001', feedbackWeight: 0.3 });
    mockDb.appraisal.findMany.mockResolvedValue([
      { id: 'apr-001', employeeId: 'emp-001', calibratedScore: 4.0, overallScore: 4.0 },
    ]);
    mockDb.feedbackQuestion.findMany.mockResolvedValue([Q_RATING]);
    mockDb.feedbackRequest.findMany.mockResolvedValue([]);

    const res = await request(app)
      .post('/performance/cycles/cycle-001/360/apply');

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
    expect(res.body.skipped).toBe(1);
  });

  test('F34 — 404 when cycle not found', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/performance/cycles/nope/360/apply');
    expect(res.status).toBe(404);
  });
});
