'use strict';

const request = require('supertest');

// ── Mocks must be declared before require('../src/index') ─────────────────────
jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = { sub: 'admin-001', role: 'SUPER_ADMIN', email: 'admin@test.com' };
    req.headers['x-employee-id'] = 'emp-admin';
    next();
  },
  authorize: (..._roles) => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN',
    MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

// Build a single shared mock instance that tests can inspect/override
const mockDb = {
  reviewCycle: {
    create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    update: jest.fn(), delete: jest.fn(), count: jest.fn(),
  },
  appraisal: {
    create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    update: jest.fn(), deleteMany: jest.fn(), count: jest.fn(),
  },
  goal: {
    create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    update: jest.fn(), delete: jest.fn(),
  },
  pipRecord: {
    create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    update: jest.fn(), count: jest.fn().mockResolvedValue(0),
  },
  incrementProposal: {
    upsert: jest.fn(), findMany: jest.fn(), update: jest.fn(),
  },
  bellCurveConfig: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(), update: jest.fn(),
  },
  $disconnect: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

const { app } = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const CYCLE = {
  id: 'cycle-001', name: 'Annual Review 2026', type: 'ANNUAL',
  startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'),
  currentPhase: 'GOAL_SETTING', status: 'DRAFT', createdBy: 'admin-001',
  createdAt: new Date(), updatedAt: new Date(), _count: { appraisals: 0 }, appraisals: [],
};

const APPRAISAL = {
  id: 'apr-001', cycleId: 'cycle-001', employeeId: 'emp-admin', managerId: 'emp-admin',
  selfScore: null, managerScore: null, overallScore: null,
  selfComments: null, managerComments: null, strengths: null, improvements: null,
  status: 'PENDING', selfSubmittedAt: null, managerSubmittedAt: null, finalisedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};

const GOAL = {
  id: 'goal-001', employeeId: 'emp-admin', title: 'Improve code quality',
  description: 'Reduce bug rate by 20%', targetDate: new Date('2026-06-30'),
  progress: 0, status: 'ACTIVE', category: 'PERFORMANCE',
  createdAt: new Date(), updatedAt: new Date(),
};

const PIP = {
  id: 'pip-001', employeeId: 'emp-002', managerId: 'emp-admin',
  startDate: new Date('2026-03-01'), endDate: new Date('2026-06-01'),
  objectives: 'Improve attendance and deliverable quality',
  progressNotes: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => { jest.clearAllMocks(); });

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /health', () => {
  test('200', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.service).toBe('performance-service');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A) GET /performance/summary', () => {
  test('200 — returns aggregated KPIs', async () => {
    mockDb.reviewCycle.count.mockResolvedValue(2);
    mockDb.appraisal.count.mockResolvedValueOnce(10).mockResolvedValueOnce(7);
    mockDb.appraisal.findMany.mockResolvedValue([{ overallScore: 4.0 }, { overallScore: 3.5 }]);
    mockDb.pipRecord.count.mockResolvedValue(1);
    const r = await request(app).get('/performance/summary').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('activeCycles');
    expect(r.body).toHaveProperty('completionRate');
    expect(r.body.activePips).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B) Review Cycles', () => {
  test('POST /performance/cycles — 201 creates cycle', async () => {
    mockDb.reviewCycle.create.mockResolvedValue(CYCLE);
    const r = await request(app).post('/performance/cycles').set('Authorization', 'Bearer test')
      .send({ name: 'Annual Review 2026', type: 'ANNUAL', startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(r.status).toBe(201);
    expect(r.body.name).toBe('Annual Review 2026');
  });

  test('POST /performance/cycles — 400 missing required fields', async () => {
    const r = await request(app).post('/performance/cycles').set('Authorization', 'Bearer test')
      .send({ name: 'Test' });
    expect(r.status).toBe(400);
  });

  test('POST /performance/cycles — 400 invalid type', async () => {
    const r = await request(app).post('/performance/cycles').set('Authorization', 'Bearer test')
      .send({ name: 'Test', type: 'INVALID', startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(r.status).toBe(400);
  });

  test('GET /performance/cycles — 200 returns list', async () => {
    mockDb.reviewCycle.findMany.mockResolvedValue([CYCLE]);
    const r = await request(app).get('/performance/cycles').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  test('GET /performance/cycles/:id — 200', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    const r = await request(app).get('/performance/cycles/cycle-001').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
  });

  test('GET /performance/cycles/:id — 404', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(null);
    const r = await request(app).get('/performance/cycles/bad').set('Authorization', 'Bearer test');
    expect(r.status).toBe(404);
  });

  test('POST /performance/cycles/:id/activate — 200', async () => {
    mockDb.reviewCycle.update.mockResolvedValue({ ...CYCLE, status: 'ACTIVE' });
    const r = await request(app).post('/performance/cycles/cycle-001/activate').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ACTIVE');
  });

  test('POST /performance/cycles/:id/advance-phase — 200 advances from GOAL_SETTING', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.reviewCycle.update.mockResolvedValue({ ...CYCLE, currentPhase: 'SELF_ASSESSMENT' });
    const r = await request(app).post('/performance/cycles/cycle-001/advance-phase').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body.currentPhase).toBe('SELF_ASSESSMENT');
  });

  test('POST /performance/cycles/:id/advance-phase — 400 already COMPLETED', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue({ ...CYCLE, currentPhase: 'COMPLETED' });
    const r = await request(app).post('/performance/cycles/cycle-001/advance-phase').set('Authorization', 'Bearer test');
    expect(r.status).toBe(400);
  });

  test('POST /performance/cycles/:id/advance-phase — 404 not found', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(null);
    const r = await request(app).post('/performance/cycles/bad/advance-phase').set('Authorization', 'Bearer test');
    expect(r.status).toBe(404);
  });

  test('POST /performance/cycles/:id/enroll — 200 enrolls employees', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.appraisal.findUnique.mockResolvedValue(null);
    mockDb.appraisal.create.mockResolvedValue(APPRAISAL);
    const r = await request(app).post('/performance/cycles/cycle-001/enroll').set('Authorization', 'Bearer test')
      .send({ employeeIds: ['emp-001', 'emp-002'] });
    expect(r.status).toBe(200);
    expect(r.body.enrolled).toBe(2);
    expect(r.body.skipped).toBe(0);
  });

  test('POST /performance/cycles/:id/enroll — skips already enrolled', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.appraisal.findUnique.mockResolvedValue(APPRAISAL); // already enrolled
    const r = await request(app).post('/performance/cycles/cycle-001/enroll').set('Authorization', 'Bearer test')
      .send({ employeeIds: ['emp-admin'] });
    expect(r.status).toBe(200);
    expect(r.body.enrolled).toBe(0);
    expect(r.body.skipped).toBe(1);
  });

  test('POST /performance/cycles/:id/enroll — 400 empty array', async () => {
    const r = await request(app).post('/performance/cycles/cycle-001/enroll').set('Authorization', 'Bearer test')
      .send({ employeeIds: [] });
    expect(r.status).toBe(400);
  });

  test('DELETE /performance/cycles/:id — 200', async () => {
    mockDb.appraisal.deleteMany.mockResolvedValue({});
    mockDb.reviewCycle.delete.mockResolvedValue(CYCLE);
    const r = await request(app).delete('/performance/cycles/cycle-001').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C) Appraisals', () => {
  test('GET /performance/appraisals/me — 200', async () => {
    mockDb.appraisal.findMany.mockResolvedValue([{ ...APPRAISAL, cycle: CYCLE }]);
    const r = await request(app).get('/performance/appraisals/me').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  test('GET /performance/appraisals/team — 200', async () => {
    mockDb.appraisal.findMany.mockResolvedValue([{ ...APPRAISAL, cycle: CYCLE }]);
    const r = await request(app).get('/performance/appraisals/team').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
  });

  test('GET /performance/appraisals/:id — 200', async () => {
    mockDb.appraisal.findUnique.mockResolvedValue({ ...APPRAISAL, cycle: CYCLE });
    const r = await request(app).get('/performance/appraisals/apr-001').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
  });

  test('GET /performance/appraisals/:id — 404', async () => {
    mockDb.appraisal.findUnique.mockResolvedValue(null);
    const r = await request(app).get('/performance/appraisals/bad').set('Authorization', 'Bearer test');
    expect(r.status).toBe(404);
  });

  test('POST /performance/appraisals/:id/self-submit — 200 valid score', async () => {
    mockDb.appraisal.findUnique.mockResolvedValue({ ...APPRAISAL, employeeId: 'emp-admin' });
    mockDb.appraisal.update.mockResolvedValue({ ...APPRAISAL, selfScore: 4, status: 'SELF_SUBMITTED' });
    const r = await request(app).post('/performance/appraisals/apr-001/self-submit').set('Authorization', 'Bearer test')
      .send({ selfScore: 4, selfComments: 'Good year', strengths: 'Teamwork', improvements: 'Time management' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('SELF_SUBMITTED');
  });

  test('POST /performance/appraisals/:id/self-submit — 400 missing score', async () => {
    const r = await request(app).post('/performance/appraisals/apr-001/self-submit').set('Authorization', 'Bearer test')
      .send({ selfComments: 'No score' });
    expect(r.status).toBe(400);
  });

  test('POST /performance/appraisals/:id/self-submit — 400 score out of range', async () => {
    const r = await request(app).post('/performance/appraisals/apr-001/self-submit').set('Authorization', 'Bearer test')
      .send({ selfScore: 6 });
    expect(r.status).toBe(400);
  });

  test('POST /performance/appraisals/:id/self-submit — 400 invalid status', async () => {
    mockDb.appraisal.findUnique.mockResolvedValue({ ...APPRAISAL, employeeId: 'emp-admin', status: 'FINALISED' });
    const r = await request(app).post('/performance/appraisals/apr-001/self-submit').set('Authorization', 'Bearer test')
      .send({ selfScore: 4 });
    expect(r.status).toBe(400);
  });

  test('POST /performance/appraisals/:id/manager-submit — 200', async () => {
    mockDb.appraisal.findUnique.mockResolvedValue({ ...APPRAISAL, selfScore: 4, status: 'SELF_SUBMITTED', managerId: 'emp-admin' });
    mockDb.appraisal.update.mockResolvedValue({ ...APPRAISAL, managerScore: 4, overallScore: 4, status: 'MANAGER_SUBMITTED' });
    const r = await request(app).post('/performance/appraisals/apr-001/manager-submit').set('Authorization', 'Bearer test')
      .send({ managerScore: 4, managerComments: 'Strong performer' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('MANAGER_SUBMITTED');
  });

  test('POST /performance/appraisals/:id/manager-submit — 400 self-assessment not done', async () => {
    mockDb.appraisal.findUnique.mockResolvedValue({ ...APPRAISAL, status: 'PENDING', managerId: 'emp-admin' });
    const r = await request(app).post('/performance/appraisals/apr-001/manager-submit').set('Authorization', 'Bearer test')
      .send({ managerScore: 4 });
    expect(r.status).toBe(400);
  });

  test('POST /performance/appraisals/:id/manager-submit — 400 missing score', async () => {
    const r = await request(app).post('/performance/appraisals/apr-001/manager-submit').set('Authorization', 'Bearer test')
      .send({ managerComments: 'Good' });
    expect(r.status).toBe(400);
  });

  test('POST /performance/appraisals/:id/finalise — 200', async () => {
    mockDb.appraisal.findUnique.mockResolvedValue({ ...APPRAISAL, status: 'MANAGER_SUBMITTED' });
    mockDb.appraisal.update.mockResolvedValue({ ...APPRAISAL, status: 'FINALISED', finalisedAt: new Date() });
    const r = await request(app).post('/performance/appraisals/apr-001/finalise').set('Authorization', 'Bearer test')
      .send({ overallScore: 4.2 });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('FINALISED');
  });

  test('POST /performance/appraisals/:id/finalise — 404', async () => {
    mockDb.appraisal.findUnique.mockResolvedValue(null);
    const r = await request(app).post('/performance/appraisals/bad/finalise').set('Authorization', 'Bearer test')
      .send({});
    expect(r.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D) Goals', () => {
  test('GET /performance/goals — 200', async () => {
    mockDb.goal.findMany.mockResolvedValue([GOAL]);
    const r = await request(app).get('/performance/goals').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  test('POST /performance/goals — 201 creates goal', async () => {
    mockDb.goal.create.mockResolvedValue(GOAL);
    const r = await request(app).post('/performance/goals').set('Authorization', 'Bearer test')
      .send({ title: 'Improve code quality', category: 'PERFORMANCE', targetDate: '2026-06-30' });
    expect(r.status).toBe(201);
    expect(r.body.title).toBe('Improve code quality');
  });

  test('POST /performance/goals — 400 missing title', async () => {
    const r = await request(app).post('/performance/goals').set('Authorization', 'Bearer test')
      .send({ category: 'PERFORMANCE' });
    expect(r.status).toBe(400);
  });

  test('PUT /performance/goals/:id — 200 updates progress', async () => {
    mockDb.goal.findUnique.mockResolvedValue(GOAL);
    mockDb.goal.update.mockResolvedValue({ ...GOAL, progress: 50 });
    const r = await request(app).put('/performance/goals/goal-001').set('Authorization', 'Bearer test')
      .send({ progress: 50 });
    expect(r.status).toBe(200);
    expect(r.body.progress).toBe(50);
  });

  test('PUT /performance/goals/:id — 404 not found', async () => {
    mockDb.goal.findUnique.mockResolvedValue(null);
    const r = await request(app).put('/performance/goals/bad').set('Authorization', 'Bearer test')
      .send({ progress: 50 });
    expect(r.status).toBe(404);
  });

  test('DELETE /performance/goals/:id — 200', async () => {
    mockDb.goal.findUnique.mockResolvedValue(GOAL);
    mockDb.goal.delete.mockResolvedValue(GOAL);
    const r = await request(app).delete('/performance/goals/goal-001').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
  });

  test('DELETE /performance/goals/:id — 404', async () => {
    mockDb.goal.findUnique.mockResolvedValue(null);
    const r = await request(app).delete('/performance/goals/bad').set('Authorization', 'Bearer test');
    expect(r.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E) PIPs', () => {
  test('GET /performance/pips — 200', async () => {
    mockDb.pipRecord.findMany.mockResolvedValue([PIP]);
    const r = await request(app).get('/performance/pips').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  test('POST /performance/pips — 201 creates PIP', async () => {
    mockDb.pipRecord.create.mockResolvedValue(PIP);
    const r = await request(app).post('/performance/pips').set('Authorization', 'Bearer test')
      .send({ employeeId: 'emp-002', startDate: '2026-03-01', endDate: '2026-06-01', objectives: 'Improve performance' });
    expect(r.status).toBe(201);
    expect(r.body.employeeId).toBe('emp-002');
  });

  test('POST /performance/pips — 400 missing fields', async () => {
    const r = await request(app).post('/performance/pips').set('Authorization', 'Bearer test')
      .send({ employeeId: 'emp-002' });
    expect(r.status).toBe(400);
  });

  test('GET /performance/pips/:id — 200', async () => {
    mockDb.pipRecord.findUnique.mockResolvedValue(PIP);
    const r = await request(app).get('/performance/pips/pip-001').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
  });

  test('GET /performance/pips/:id — 404', async () => {
    mockDb.pipRecord.findUnique.mockResolvedValue(null);
    const r = await request(app).get('/performance/pips/bad').set('Authorization', 'Bearer test');
    expect(r.status).toBe(404);
  });

  test('PUT /performance/pips/:id — 200 updates status to COMPLETED', async () => {
    mockDb.pipRecord.update.mockResolvedValue({ ...PIP, status: 'COMPLETED' });
    const r = await request(app).put('/performance/pips/pip-001').set('Authorization', 'Bearer test')
      .send({ status: 'COMPLETED' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('COMPLETED');
  });

  test('PUT /performance/pips/:id — 200 saves progress notes', async () => {
    mockDb.pipRecord.update.mockResolvedValue({ ...PIP, progressNotes: 'Week 1: attendance improved' });
    const r = await request(app).put('/performance/pips/pip-001').set('Authorization', 'Bearer test')
      .send({ progressNotes: 'Week 1: attendance improved' });
    expect(r.status).toBe(200);
    expect(r.body.progressNotes).toBe('Week 1: attendance improved');
  });

  test('PUT /performance/pips/:id — 404 not found', async () => {
    const err = Object.assign(new Error('Not found'), { code: 'P2025' });
    mockDb.pipRecord.update.mockRejectedValue(err);
    const r = await request(app).put('/performance/pips/bad').set('Authorization', 'Bearer test')
      .send({ status: 'COMPLETED' });
    expect(r.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F) Calibration — review/edit calibrated scores, lock calibration
// ─────────────────────────────────────────────────────────────────────────────
describe('F) Calibration', () => {
  const FINALISED = { ...APPRAISAL, status: 'FINALISED', overallScore: 4.2, finalisedAt: new Date() };

  test('GET /performance/cycles/:id/calibration — 200 returns appraisals + locked flag', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.appraisal.findMany.mockResolvedValue([{ ...FINALISED, incrementProposal: null }]);
    const r = await request(app).get('/performance/cycles/cycle-001/calibration').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body.cycle.id).toBe('cycle-001');
    expect(r.body.locked).toBe(false);
    expect(Array.isArray(r.body.appraisals)).toBe(true);
    // Must only fetch FINALISED appraisals, sorted by overallScore desc
    expect(mockDb.appraisal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { cycleId: 'cycle-001', status: 'FINALISED' },
      orderBy: { overallScore: 'desc' },
      include: { incrementProposal: true },
    }));
  });

  test('GET /performance/cycles/:id/calibration — locked=true when calibrationLockedAt set', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue({ ...CYCLE, calibrationLockedAt: new Date() });
    mockDb.appraisal.findMany.mockResolvedValue([]);
    const r = await request(app).get('/performance/cycles/cycle-001/calibration').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body.locked).toBe(true);
  });

  test('GET /performance/cycles/:id/calibration — 404 cycle not found', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(null);
    const r = await request(app).get('/performance/cycles/bad/calibration').set('Authorization', 'Bearer test');
    expect(r.status).toBe(404);
  });

  test('PUT calibrate — 200 sets calibratedScore + audit fields', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.appraisal.update.mockResolvedValue({ ...FINALISED, calibratedScore: 4.5, calibratedBy: 'admin-001', calibratedAt: new Date() });
    const r = await request(app).put('/performance/cycles/cycle-001/appraisals/apr-001/calibrate').set('Authorization', 'Bearer test')
      .send({ calibratedScore: 4.5 });
    expect(r.status).toBe(200);
    expect(r.body.calibratedScore).toBe(4.5);
    expect(mockDb.appraisal.update).toHaveBeenCalledWith({
      where: { id: 'apr-001' },
      data: expect.objectContaining({ calibratedScore: 4.5, calibratedBy: 'admin-001' }),
    });
  });

  test('PUT calibrate — 400 cycle is locked', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue({ ...CYCLE, calibrationLockedAt: new Date() });
    const r = await request(app).put('/performance/cycles/cycle-001/appraisals/apr-001/calibrate').set('Authorization', 'Bearer test')
      .send({ calibratedScore: 4.5 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/locked/i);
    expect(mockDb.appraisal.update).not.toHaveBeenCalled();
  });

  test('PUT calibrate — 400 missing calibratedScore', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    const r = await request(app).put('/performance/cycles/cycle-001/appraisals/apr-001/calibrate').set('Authorization', 'Bearer test')
      .send({});
    expect(r.status).toBe(400);
  });

  test('PUT calibrate — 404 cycle not found', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(null);
    const r = await request(app).put('/performance/cycles/bad/appraisals/apr-001/calibrate').set('Authorization', 'Bearer test')
      .send({ calibratedScore: 4.5 });
    expect(r.status).toBe(404);
  });

  test('PUT calibrate — 404 appraisal not found (P2025)', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.appraisal.update.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
    const r = await request(app).put('/performance/cycles/cycle-001/appraisals/bad/calibrate').set('Authorization', 'Bearer test')
      .send({ calibratedScore: 4.5 });
    expect(r.status).toBe(404);
  });

  test('POST lock-calibration — 200 sets calibrationLockedAt', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.reviewCycle.update.mockResolvedValue({ ...CYCLE, calibrationLockedAt: new Date() });
    const r = await request(app).post('/performance/cycles/cycle-001/lock-calibration').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body.calibrationLockedAt).toBeTruthy();
  });

  test('POST lock-calibration — 409 already locked', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue({ ...CYCLE, calibrationLockedAt: new Date() });
    const r = await request(app).post('/performance/cycles/cycle-001/lock-calibration').set('Authorization', 'Bearer test');
    expect(r.status).toBe(409);
    expect(mockDb.reviewCycle.update).not.toHaveBeenCalled();
  });

  test('POST lock-calibration — 404 cycle not found', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(null);
    const r = await request(app).post('/performance/cycles/bad/lock-calibration').set('Authorization', 'Bearer test');
    expect(r.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G) Increment Proposals — generate from matrix, list, approve/reject
// ─────────────────────────────────────────────────────────────────────────────
describe('G) Increment Proposals', () => {
  const CALIBRATED_HIGH = { ...APPRAISAL, id: 'apr-high', status: 'FINALISED', overallScore: 4.0, calibratedScore: 4.5, employeeId: 'emp-high' };
  const CALIBRATED_MID  = { ...APPRAISAL, id: 'apr-mid',  status: 'FINALISED', overallScore: 3.0, calibratedScore: 3.2, employeeId: 'emp-mid' };
  const MATRIX = [
    { minScore: 0,   maxScore: 2.9, pct: 0 },
    { minScore: 3.0, maxScore: 3.9, pct: 3 },
    { minScore: 4.0, maxScore: 5.0, pct: 7 },
  ];

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ basicSalary: 5000 }) });
  });
  afterEach(() => { delete global.fetch; });

  test('POST increment-proposals — 201 creates proposals using calibrated score & tier', async () => {
    mockDb.appraisal.findMany.mockResolvedValue([CALIBRATED_HIGH, CALIBRATED_MID]);
    mockDb.incrementProposal.upsert
      .mockResolvedValueOnce({ id: 'p1', cycleId: 'cycle-001', appraisalId: 'apr-high', employeeId: 'emp-high', proposedPct: 7,   proposedAmount: 5350,  status: 'DRAFT' })
      .mockResolvedValueOnce({ id: 'p2', cycleId: 'cycle-001', appraisalId: 'apr-mid',  employeeId: 'emp-mid',  proposedPct: 3,   proposedAmount: 5150,  status: 'DRAFT' });

    const r = await request(app).post('/performance/cycles/cycle-001/increment-proposals').set('Authorization', 'Bearer test')
      .send({ incrementMatrix: MATRIX });

    expect(r.status).toBe(201);
    expect(r.body.created).toBe(2);
    expect(mockDb.incrementProposal.upsert).toHaveBeenCalledTimes(2);

    // High-scorer must land in the 4.0–5.0 tier with pct=7
    const highCall = mockDb.incrementProposal.upsert.mock.calls.find(c => c[0].create.appraisalId === 'apr-high');
    expect(highCall[0].create.proposedPct).toBe(7);
    expect(highCall[0].create.proposedAmount).toBe(5350); // 5000 * 1.07
    // Mid-scorer must land in 3.0–3.9 tier with pct=3
    const midCall = mockDb.incrementProposal.upsert.mock.calls.find(c => c[0].create.appraisalId === 'apr-mid');
    expect(midCall[0].create.proposedPct).toBe(3);
    expect(midCall[0].create.proposedAmount).toBe(5150);
  });

  test('POST increment-proposals — tier=0 when score falls outside all bands', async () => {
    mockDb.appraisal.findMany.mockResolvedValue([{ ...CALIBRATED_HIGH, calibratedScore: 5.5 }]); // above all tiers
    mockDb.incrementProposal.upsert.mockResolvedValue({});
    const r = await request(app).post('/performance/cycles/cycle-001/increment-proposals').set('Authorization', 'Bearer test')
      .send({ incrementMatrix: MATRIX });
    expect(r.status).toBe(201);
    expect(mockDb.incrementProposal.upsert.mock.calls[0][0].create.proposedPct).toBe(0);
  });

  test('POST increment-proposals — re-run upserts existing proposal back to DRAFT', async () => {
    mockDb.appraisal.findMany.mockResolvedValue([CALIBRATED_HIGH]);
    mockDb.incrementProposal.upsert.mockResolvedValue({});
    await request(app).post('/performance/cycles/cycle-001/increment-proposals').set('Authorization', 'Bearer test')
      .send({ incrementMatrix: MATRIX });
    const call = mockDb.incrementProposal.upsert.mock.calls[0][0];
    expect(call.update).toMatchObject({ status: 'DRAFT', approvedBy: null, approvedAt: null });
  });

  test('POST increment-proposals — proposedAmount null when employee lookup fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    mockDb.appraisal.findMany.mockResolvedValue([CALIBRATED_HIGH]);
    mockDb.incrementProposal.upsert.mockResolvedValue({});
    const r = await request(app).post('/performance/cycles/cycle-001/increment-proposals').set('Authorization', 'Bearer test')
      .send({ incrementMatrix: MATRIX });
    expect(r.status).toBe(201);
    expect(mockDb.incrementProposal.upsert.mock.calls[0][0].create.proposedAmount).toBeNull();
  });

  test('POST increment-proposals — 400 missing/empty matrix', async () => {
    const r1 = await request(app).post('/performance/cycles/cycle-001/increment-proposals').set('Authorization', 'Bearer test').send({});
    expect(r1.status).toBe(400);
    const r2 = await request(app).post('/performance/cycles/cycle-001/increment-proposals').set('Authorization', 'Bearer test').send({ incrementMatrix: [] });
    expect(r2.status).toBe(400);
  });

  test('POST increment-proposals — 400 no calibrated appraisals', async () => {
    mockDb.appraisal.findMany.mockResolvedValue([]);
    const r = await request(app).post('/performance/cycles/cycle-001/increment-proposals').set('Authorization', 'Bearer test')
      .send({ incrementMatrix: MATRIX });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/no finalised appraisals/i);
  });

  test('GET increment-proposals — 200 lists proposals', async () => {
    mockDb.incrementProposal.findMany.mockResolvedValue([{ id: 'p1', cycleId: 'cycle-001' }]);
    const r = await request(app).get('/performance/cycles/cycle-001/increment-proposals').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(1);
  });

  test('PUT proposal — 200 APPROVED sets approvedBy + approvedAt', async () => {
    mockDb.incrementProposal.update.mockResolvedValue({ id: 'p1', status: 'APPROVED', approvedBy: 'admin-001' });
    const r = await request(app).put('/performance/cycles/cycle-001/increment-proposals/p1').set('Authorization', 'Bearer test')
      .send({ status: 'APPROVED', notes: 'lgtm' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('APPROVED');
    const data = mockDb.incrementProposal.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'APPROVED', notes: 'lgtm', approvedBy: 'admin-001' });
    expect(data.approvedAt).toBeInstanceOf(Date);
  });

  test('PUT proposal — 200 REJECTED does not set approval fields', async () => {
    mockDb.incrementProposal.update.mockResolvedValue({ id: 'p1', status: 'REJECTED' });
    const r = await request(app).put('/performance/cycles/cycle-001/increment-proposals/p1').set('Authorization', 'Bearer test')
      .send({ status: 'REJECTED' });
    expect(r.status).toBe(200);
    const data = mockDb.incrementProposal.update.mock.calls[0][0].data;
    expect(data.status).toBe('REJECTED');
    expect(data.approvedBy).toBeUndefined();
    expect(data.approvedAt).toBeUndefined();
  });

  test('PUT proposal — 400 invalid status', async () => {
    const r = await request(app).put('/performance/cycles/cycle-001/increment-proposals/p1').set('Authorization', 'Bearer test')
      .send({ status: 'PENDING' });
    expect(r.status).toBe(400);
    expect(mockDb.incrementProposal.update).not.toHaveBeenCalled();
  });

  test('PUT proposal — 404 not found (P2025)', async () => {
    mockDb.incrementProposal.update.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
    const r = await request(app).put('/performance/cycles/cycle-001/increment-proposals/bad').set('Authorization', 'Bearer test')
      .send({ status: 'APPROVED' });
    expect(r.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H) Apply Increments — push approved proposals to employee-service
// ─────────────────────────────────────────────────────────────────────────────
describe('H) Apply Increments', () => {
  const APPROVED_A = { id: 'p1', cycleId: 'cycle-001', appraisalId: 'apr-a', employeeId: 'emp-a', proposedPct: 7, proposedAmount: 5350, status: 'APPROVED' };
  const APPROVED_B = { id: 'p2', cycleId: 'cycle-001', appraisalId: 'apr-b', employeeId: 'emp-b', proposedPct: 3, proposedAmount: 5150, status: 'APPROVED' };

  afterEach(() => { delete global.fetch; });

  test('POST apply-increments — 200 patches each approved employee and reports counts', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.incrementProposal.findMany.mockResolvedValue([APPROVED_A, APPROVED_B]);
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    const r = await request(app).post('/performance/cycles/cycle-001/apply-increments').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ applied: 2, skipped: 0, total: 2 });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Verify PATCH body includes new salary & reason referencing cycle name
    const firstCallInit = global.fetch.mock.calls[0][1];
    expect(firstCallInit.method).toBe('PATCH');
    const body = JSON.parse(firstCallInit.body);
    expect(body.basicSalary).toBe(5350);
    expect(body.salaryChangeReason).toMatch(new RegExp(CYCLE.name));
  });

  test('POST apply-increments — skipped when employee PATCH fails', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.incrementProposal.findMany.mockResolvedValue([APPROVED_A, APPROVED_B]);
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false });

    const r = await request(app).post('/performance/cycles/cycle-001/apply-increments').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ applied: 1, skipped: 1, total: 2 });
  });

  test('POST apply-increments — proposals without proposedAmount are skipped without HTTP call', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.incrementProposal.findMany.mockResolvedValue([{ ...APPROVED_A, proposedAmount: null }]);
    global.fetch = jest.fn();

    const r = await request(app).post('/performance/cycles/cycle-001/apply-increments').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ applied: 0, skipped: 1, total: 1 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('POST apply-increments — 400 no approved proposals', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE);
    mockDb.incrementProposal.findMany.mockResolvedValue([]);
    const r = await request(app).post('/performance/cycles/cycle-001/apply-increments').set('Authorization', 'Bearer test');
    expect(r.status).toBe(400);
  });

  test('POST apply-increments — 404 cycle not found', async () => {
    mockDb.reviewCycle.findUnique.mockResolvedValue(null);
    const r = await request(app).post('/performance/cycles/bad/apply-increments').set('Authorization', 'Bearer test');
    expect(r.status).toBe(404);
  });
});
