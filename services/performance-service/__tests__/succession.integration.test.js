'use strict';

const request = require('supertest');

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = { sub: 'admin-001', role: 'SUPER_ADMIN', email: 'admin@test.com' };
    next();
  },
  authorize: (..._roles) => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN',
    HR_MANAGER: 'HR_MANAGER', MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

// ── DB mock ───────────────────────────────────────────────────────────────────
const mockDb = {
  reviewCycle:        { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  appraisal:          { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
  pipRecord:          { count: jest.fn().mockResolvedValue(0) },
  bellCurveConfig:    { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  incrementProposal:  { upsert: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  goal:               { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  keyPosition:        { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  successorNominee:   { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
  successionDevPlan:  { create: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() },
  $disconnect:        jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

// mock fetch (employee-service calls)
global.fetch = jest.fn().mockResolvedValue({ ok: false });

const { app } = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const POS = {
  id: 'pos-001', jobTitle: 'Chief Executive Officer',
  department: 'Executive', description: null,
  currentHolderId: null, isActive: true, riskLevel: 'HIGH',
  createdBy: 'admin-001', updatedBy: null,
  createdAt: new Date(), updatedAt: new Date(),
  nominees: [],
};

const NOMINEE = {
  id: 'nom-001', positionId: 'pos-001', employeeId: 'emp-100',
  readiness: 'ONE_YEAR', potentialBand: 2, notes: null,
  nominatedBy: 'admin-001', nominatedAt: new Date(), updatedBy: null, updatedAt: new Date(),
  devPlans: [],
};

const DEV_PLAN = {
  id: 'dp-001', nomineeId: 'nom-001',
  competencyGap: 'Strategic planning', action: 'Leadership program',
  trainingProgramId: null, targetDate: null, status: 'PENDING',
  completedAt: null, notes: null, createdBy: 'admin-001',
  createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: false });
});

// ── SP-01 POST /key-positions — creates position ──────────────────────────────
test('SP-01 POST /key-positions creates a key position', async () => {
  mockDb.keyPosition.create.mockResolvedValue({ ...POS, nominees: [] });

  const res = await request(app).post('/performance/key-positions').send({
    jobTitle: 'Chief Executive Officer', department: 'Executive',
  });
  expect(res.status).toBe(201);
  expect(res.body.jobTitle).toBe('Chief Executive Officer');
  expect(res.body.riskLevel).toBe('HIGH');
});

// ── SP-02 POST /key-positions — 400 if jobTitle missing ───────────────────────
test('SP-02 POST /key-positions returns 400 when jobTitle missing', async () => {
  const res = await request(app).post('/performance/key-positions').send({ department: 'HR' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/jobTitle/);
});

// ── SP-03 GET /key-positions — lists active positions ─────────────────────────
test('SP-03 GET /key-positions returns active positions', async () => {
  mockDb.keyPosition.findMany.mockResolvedValue([{ ...POS, nominees: [] }]);

  const res = await request(app).get('/performance/key-positions');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
  expect(res.body[0].riskLevel).toBe('HIGH');
});

// ── SP-04 GET /key-positions/:id — single position with nominees ──────────────
test('SP-04 GET /key-positions/:id returns position with nominees', async () => {
  mockDb.keyPosition.findUnique.mockResolvedValue({ ...POS, nominees: [{ ...NOMINEE, devPlans: [] }] });

  const res = await request(app).get('/performance/key-positions/pos-001');
  expect(res.status).toBe(200);
  expect(res.body.nominees).toHaveLength(1);
});

// ── SP-05 GET /key-positions/:id — 404 on unknown ────────────────────────────
test('SP-05 GET /key-positions/:id returns 404 for unknown position', async () => {
  mockDb.keyPosition.findUnique.mockResolvedValue(null);
  const res = await request(app).get('/performance/key-positions/unknown');
  expect(res.status).toBe(404);
});

// ── SP-06 PUT /key-positions/:id — updates fields ─────────────────────────────
test('SP-06 PUT /key-positions/:id updates position', async () => {
  const updated = { ...POS, description: 'Top leadership role', nominees: [] };
  mockDb.keyPosition.update.mockResolvedValue(updated);

  const res = await request(app).put('/performance/key-positions/pos-001').send({ description: 'Top leadership role' });
  expect(res.status).toBe(200);
  expect(res.body.description).toBe('Top leadership role');
});

// ── SP-07 DELETE /key-positions/:id — 409 if nominees exist ──────────────────
test('SP-07 DELETE /key-positions/:id returns 409 when nominees exist', async () => {
  mockDb.successorNominee.count.mockResolvedValue(1);
  const res = await request(app).delete('/performance/key-positions/pos-001');
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/deactivate/);
});

// ── SP-08 DELETE /key-positions/:id — 204 when no nominees ───────────────────
test('SP-08 DELETE /key-positions/:id succeeds when no nominees', async () => {
  mockDb.successorNominee.count.mockResolvedValue(0);
  mockDb.keyPosition.delete.mockResolvedValue({});

  const res = await request(app).delete('/performance/key-positions/pos-001');
  expect(res.status).toBe(204);
});

// ── SP-09 POST /key-positions/:id/nominees — nominates employee ───────────────
test('SP-09 POST /key-positions/:id/nominees creates nominee', async () => {
  mockDb.keyPosition.findUnique.mockResolvedValue(POS);
  mockDb.successorNominee.create.mockResolvedValue({ ...NOMINEE, devPlans: [] });
  mockDb.successorNominee.findMany.mockResolvedValue([NOMINEE]);
  mockDb.keyPosition.update.mockResolvedValue({ ...POS, riskLevel: 'MEDIUM' });

  const res = await request(app).post('/performance/key-positions/pos-001/nominees').send({
    employeeId: 'emp-100', readiness: 'ONE_YEAR', potentialBand: 2,
  });
  expect(res.status).toBe(201);
  expect(res.body.readiness).toBe('ONE_YEAR');
});

// ── SP-10 POST /key-positions/:id/nominees — 400 invalid readiness ────────────
test('SP-10 POST /key-positions/:id/nominees 400 on invalid readiness', async () => {
  mockDb.keyPosition.findUnique.mockResolvedValue(POS);
  const res = await request(app).post('/performance/key-positions/pos-001/nominees').send({
    employeeId: 'emp-100', readiness: 'NEXT_MONTH', potentialBand: 2,
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/readiness/);
});

// ── SP-11 POST /key-positions/:id/nominees — 400 invalid potentialBand ────────
test('SP-11 POST nominees 400 on potentialBand out of range', async () => {
  mockDb.keyPosition.findUnique.mockResolvedValue(POS);
  const res = await request(app).post('/performance/key-positions/pos-001/nominees').send({
    employeeId: 'emp-100', readiness: 'ONE_YEAR', potentialBand: 5,
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/potentialBand/);
});

// ── SP-12 POST /key-positions/:id/nominees — 409 duplicate ───────────────────
test('SP-12 POST nominees 409 on duplicate', async () => {
  mockDb.keyPosition.findUnique.mockResolvedValue(POS);
  mockDb.successorNominee.create.mockRejectedValue({ code: 'P2002' });

  const res = await request(app).post('/performance/key-positions/pos-001/nominees').send({
    employeeId: 'emp-100', readiness: 'ONE_YEAR', potentialBand: 2,
  });
  expect(res.status).toBe(409);
});

// ── SP-13 PUT /nominees/:id — updates readiness ───────────────────────────────
test('SP-13 PUT /nominees/:id updates readiness to READY_NOW', async () => {
  const updatedNominee = { ...NOMINEE, readiness: 'READY_NOW' };
  mockDb.successorNominee.update.mockResolvedValue(updatedNominee);
  mockDb.successorNominee.findMany.mockResolvedValue([updatedNominee]);
  mockDb.keyPosition.update.mockResolvedValue({ ...POS, riskLevel: 'LOW' });

  const res = await request(app).put('/performance/nominees/nom-001').send({ readiness: 'READY_NOW' });
  expect(res.status).toBe(200);
  expect(res.body.readiness).toBe('READY_NOW');
});

// ── SP-14 DELETE /nominees/:id — cascades dev plans ──────────────────────────
test('SP-14 DELETE /nominees/:id removes nominee and dev plans', async () => {
  mockDb.successorNominee.findUnique.mockResolvedValue(NOMINEE);
  mockDb.successionDevPlan.deleteMany.mockResolvedValue({});
  mockDb.successorNominee.delete.mockResolvedValue({});
  mockDb.successorNominee.findMany.mockResolvedValue([]);
  mockDb.keyPosition.update.mockResolvedValue({ ...POS, riskLevel: 'HIGH' });

  const res = await request(app).delete('/performance/nominees/nom-001');
  expect(res.status).toBe(204);
  expect(mockDb.successionDevPlan.deleteMany).toHaveBeenCalledWith({ where: { nomineeId: 'nom-001' } });
});

// ── SP-15 POST /nominees/:id/dev-plans — creates dev plan ────────────────────
test('SP-15 POST /nominees/:id/dev-plans creates a development plan', async () => {
  mockDb.successorNominee.findUnique.mockResolvedValue(NOMINEE);
  mockDb.successionDevPlan.create.mockResolvedValue(DEV_PLAN);

  const res = await request(app).post('/performance/nominees/nom-001/dev-plans').send({
    competencyGap: 'Strategic planning', action: 'Leadership program',
  });
  expect(res.status).toBe(201);
  expect(res.body.competencyGap).toBe('Strategic planning');
  expect(res.body.status).toBe('PENDING');
});

// ── SP-16 POST /nominees/:id/dev-plans — 400 missing required fields ──────────
test('SP-16 POST dev-plans 400 when competencyGap or action missing', async () => {
  mockDb.successorNominee.findUnique.mockResolvedValue(NOMINEE);
  const res = await request(app).post('/performance/nominees/nom-001/dev-plans').send({
    competencyGap: 'Gap only',
  });
  expect(res.status).toBe(400);
});

// ── SP-17 PUT /dev-plans/:id — updates status to IN_PROGRESS ─────────────────
test('SP-17 PUT /dev-plans/:id updates status', async () => {
  const updated = { ...DEV_PLAN, status: 'IN_PROGRESS' };
  mockDb.successionDevPlan.update.mockResolvedValue(updated);

  const res = await request(app).put('/performance/dev-plans/dp-001').send({ status: 'IN_PROGRESS' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('IN_PROGRESS');
});

// ── SP-18 PUT /dev-plans/:id — 400 on invalid status ─────────────────────────
test('SP-18 PUT /dev-plans/:id 400 on invalid status', async () => {
  const res = await request(app).put('/performance/dev-plans/dp-001').send({ status: 'DONE' });
  expect(res.status).toBe(400);
});

// ── SP-19 DELETE /dev-plans/:id — deletes plan ───────────────────────────────
test('SP-19 DELETE /dev-plans/:id removes plan', async () => {
  mockDb.successionDevPlan.delete.mockResolvedValue({});
  const res = await request(app).delete('/performance/dev-plans/dp-001');
  expect(res.status).toBe(204);
});

// ── SP-20 GET /nine-box — no nominees returns empty ───────────────────────────
test('SP-20 GET /nine-box returns empty grid when no nominees', async () => {
  mockDb.successorNominee.findMany.mockResolvedValue([]);

  const res = await request(app).get('/performance/nine-box');
  expect(res.status).toBe(200);
  expect(res.body.grid).toEqual([]);
  expect(res.body.unplaced).toEqual([]);
});

// ── SP-21 GET /nine-box — places nominees with appraisals ────────────────────
test('SP-21 GET /nine-box places nominees on grid when appraisal exists', async () => {
  mockDb.successorNominee.findMany.mockResolvedValue([
    { ...NOMINEE, potentialBand: 3 },
  ]);
  mockDb.appraisal.findMany.mockResolvedValue([{
    employeeId: 'emp-100', calibratedScore: 4.0, overallScore: 3.5,
    status: 'FINALISED', finalisedAt: new Date(),
  }]);

  const res = await request(app).get('/performance/nine-box');
  expect(res.status).toBe(200);
  expect(res.body.grid).toHaveLength(1);
  expect(res.body.grid[0].box).toBe(3); // High Pot + High Perf = Star
  expect(res.body.grid[0].label).toBe('Star');
});

// ── SP-22 GET /nine-box — unplaced when no appraisal ─────────────────────────
test('SP-22 GET /nine-box moves nominee to unplaced when no appraisal', async () => {
  mockDb.successorNominee.findMany.mockResolvedValue([NOMINEE]);
  mockDb.appraisal.findMany.mockResolvedValue([]);

  const res = await request(app).get('/performance/nine-box');
  expect(res.status).toBe(200);
  expect(res.body.grid).toHaveLength(0);
  expect(res.body.unplaced).toHaveLength(1);
  expect(res.body.unplaced[0].reason).toMatch(/appraisal/i);
});

// ── SP-23 GET /succession/risk-report — summary aggregation ──────────────────
test('SP-23 GET /succession/risk-report returns summary with correct counts', async () => {
  mockDb.keyPosition.findMany.mockResolvedValue([
    { ...POS, id: 'p1', nominees: [] },
    { ...POS, id: 'p2', nominees: [{ readiness: 'READY_NOW' }] },
    { ...POS, id: 'p3', nominees: [{ readiness: 'ONE_YEAR' }] },
  ]);

  const res = await request(app).get('/performance/succession/risk-report');
  expect(res.status).toBe(200);
  expect(res.body.summary.high).toBe(1);
  expect(res.body.summary.medium).toBe(1);
  expect(res.body.summary.low).toBe(1);
  expect(res.body.rows).toHaveLength(3);
});

// ── SP-24 GET /succession/dashboard — KPI summary ────────────────────────────
test('SP-24 GET /succession/dashboard returns KPIs', async () => {
  mockDb.keyPosition.findMany.mockResolvedValue([
    { id: 'p1' }, { id: 'p2' },
  ]);
  mockDb.successorNominee.findMany.mockResolvedValue([
    { positionId: 'p1', readiness: 'READY_NOW' },
    { positionId: 'p2', readiness: 'ONE_YEAR' },
  ]);

  const res = await request(app).get('/performance/succession/dashboard');
  expect(res.status).toBe(200);
  expect(res.body.totalPositions).toBe(2);
  expect(res.body.totalNominees).toBe(2);
  expect(res.body.byReadiness.readyNow).toBe(1);
  expect(res.body.coverageRate).toBe(50);
  expect(res.body.highRiskPositions).toBeDefined();
});

// ── SP-25 GET /succession/my-team — fail-soft on employee-service down ────────
test('SP-25 GET /succession/my-team fails soft when employee-service unreachable', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network error'));

  const res = await request(app).get('/performance/succession/my-team');
  expect(res.status).toBe(200);
  expect(res.body.teamMembers).toEqual([]);
});
