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
