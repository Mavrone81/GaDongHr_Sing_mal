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

const mockDb = {
  reviewCycle: { findUnique: jest.fn(), update: jest.fn() },
  appraisal:   { findMany: jest.fn() },
  bellCurveConfig: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  incrementProposal: { upsert: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  goal:        { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
  pipRecord:   { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  $disconnect: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

const { app } = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const CYCLE_BASE = {
  id: 'cycle-bc-001', name: 'Annual 2026', type: 'ANNUAL',
  startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'),
  currentPhase: 'CALIBRATION', status: 'ACTIVE', createdBy: 'admin-001',
  calibrationLockedAt: null, incrementBudgetPct: null, feedbackWeight: 0,
  bellCurveConfig: null,
};

const VALID_BANDS = [
  { label: 'Outstanding',       minScore: 4.5, maxScore: 5.0, targetPct: 10, deviationTolerance: 5 },
  { label: 'Exceeds',           minScore: 3.5, maxScore: 4.49, targetPct: 25, deviationTolerance: 7 },
  { label: 'Meets',             minScore: 2.5, maxScore: 3.49, targetPct: 50, deviationTolerance: 10 },
  { label: 'Needs Improvement', minScore: 1.5, maxScore: 2.49, targetPct: 10, deviationTolerance: 5 },
  { label: 'Unsatisfactory',    minScore: 0,   maxScore: 1.49, targetPct: 5,  deviationTolerance: 5 },
];

const STORED_CONFIG = {
  id: 'bcc-001', cycleId: 'cycle-bc-001', bands: VALID_BANDS,
  createdBy: 'admin-001', updatedBy: null, createdAt: new Date(), updatedAt: new Date(),
};

function makeAppraisal(i, calibrated, overall) {
  return {
    id: `apr-bc-${i}`, cycleId: 'cycle-bc-001', employeeId: `emp-${i}`,
    calibratedScore: calibrated ?? null, overallScore: overall ?? null,
    status: 'FINALISED', incrementProposal: null,
  };
}

beforeEach(() => jest.clearAllMocks());

// ── BC-01 GET /bell-curve-config — returns stored config ──────────────────────
test('BC-01 GET bell-curve-config returns stored config', async () => {
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  mockDb.bellCurveConfig.findUnique.mockResolvedValue(STORED_CONFIG);

  const res = await request(app).get('/performance/cycles/cycle-bc-001/bell-curve-config');
  expect(res.status).toBe(200);
  expect(res.body.bands).toHaveLength(5);
  expect(res.body.isDefault).toBeUndefined();
});

// ── BC-02 GET /bell-curve-config — returns defaults when none saved ───────────
test('BC-02 GET bell-curve-config returns defaults when not configured', async () => {
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  mockDb.bellCurveConfig.findUnique.mockResolvedValue(null);

  const res = await request(app).get('/performance/cycles/cycle-bc-001/bell-curve-config');
  expect(res.status).toBe(200);
  expect(res.body.isDefault).toBe(true);
  expect(res.body.bands).toHaveLength(5);
});

// ── BC-03 GET /bell-curve-config — 404 on missing cycle ──────────────────────
test('BC-03 GET bell-curve-config 404 on missing cycle', async () => {
  mockDb.reviewCycle.findUnique.mockResolvedValue(null);

  const res = await request(app).get('/performance/cycles/no-such/bell-curve-config');
  expect(res.status).toBe(404);
});

// ── BC-04 PUT /bell-curve-config — creates new config ────────────────────────
test('BC-04 PUT bell-curve-config creates config', async () => {
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  mockDb.bellCurveConfig.findUnique.mockResolvedValue(null);
  mockDb.bellCurveConfig.create.mockResolvedValue(STORED_CONFIG);

  const res = await request(app)
    .put('/performance/cycles/cycle-bc-001/bell-curve-config')
    .send({ bands: VALID_BANDS });
  expect(res.status).toBe(200);
  expect(mockDb.bellCurveConfig.create).toHaveBeenCalledTimes(1);
  const created = mockDb.bellCurveConfig.create.mock.calls[0][0].data;
  expect(created.cycleId).toBe('cycle-bc-001');
  expect(created.createdBy).toBe('admin-001');
});

// ── BC-05 PUT /bell-curve-config — updates existing config ───────────────────
test('BC-05 PUT bell-curve-config updates existing config', async () => {
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  mockDb.bellCurveConfig.findUnique.mockResolvedValue(STORED_CONFIG);
  mockDb.bellCurveConfig.update.mockResolvedValue({ ...STORED_CONFIG, updatedBy: 'admin-001' });

  const res = await request(app)
    .put('/performance/cycles/cycle-bc-001/bell-curve-config')
    .send({ bands: VALID_BANDS });
  expect(res.status).toBe(200);
  expect(mockDb.bellCurveConfig.update).toHaveBeenCalledTimes(1);
});

// ── BC-06 PUT /bell-curve-config — 400 on missing bands ──────────────────────
test('BC-06 PUT bell-curve-config 400 on missing bands', async () => {
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);

  const res = await request(app)
    .put('/performance/cycles/cycle-bc-001/bell-curve-config')
    .send({ bands: [] });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/non-empty/);
});

// ── BC-07 PUT /bell-curve-config — 400 when pcts don't sum to 100 ────────────
test('BC-07 PUT bell-curve-config 400 when targetPct sum != 100', async () => {
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  const bad = VALID_BANDS.map((b, i) => i === 0 ? { ...b, targetPct: 50 } : b);

  const res = await request(app)
    .put('/performance/cycles/cycle-bc-001/bell-curve-config')
    .send({ bands: bad });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/sum to 100/);
});

// ── BC-08 PUT /bell-curve-config — 404 on missing cycle ──────────────────────
test('BC-08 PUT bell-curve-config 404 on missing cycle', async () => {
  mockDb.reviewCycle.findUnique.mockResolvedValue(null);

  const res = await request(app)
    .put('/performance/cycles/no-such/bell-curve-config')
    .send({ bands: VALID_BANDS });
  expect(res.status).toBe(404);
});

// ── BC-09 GET /calibration — includes bellCurve analysis with default bands ──
test('BC-09 GET calibration includes bell curve analysis', async () => {
  const appraisals = [
    makeAppraisal(1, 5.0, null),
    makeAppraisal(2, 4.0, null),
    makeAppraisal(3, 3.0, null),
    makeAppraisal(4, 2.0, null),
    makeAppraisal(5, 1.0, null),
  ];
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  mockDb.appraisal.findMany.mockResolvedValue(appraisals);

  const res = await request(app).get('/performance/cycles/cycle-bc-001/calibration');
  expect(res.status).toBe(200);
  expect(res.body.bellCurve).toBeDefined();
  expect(res.body.bellCurve.distribution).toHaveLength(5);
  expect(res.body.bellCurve.totalRated).toBe(5);
  expect(typeof res.body.bellCurve.hasDeviation).toBe('boolean');
  expect(res.body.bellCurve.config.isDefault).toBe(true);
});

// ── BC-10 GET /calibration — uses stored config bands when configured ─────────
test('BC-10 GET calibration uses stored bell curve config', async () => {
  const appraisals = [makeAppraisal(1, 4.8, null), makeAppraisal(2, 3.0, null)];
  mockDb.reviewCycle.findUnique.mockResolvedValue({
    ...CYCLE_BASE,
    bellCurveConfig: STORED_CONFIG,
  });
  mockDb.appraisal.findMany.mockResolvedValue(appraisals);

  const res = await request(app).get('/performance/cycles/cycle-bc-001/calibration');
  expect(res.status).toBe(200);
  expect(res.body.bellCurve.config.isDefault).toBeUndefined();
  expect(res.body.bellCurve.distribution).toHaveLength(VALID_BANDS.length);
});

// ── BC-11 GET /calibration — byDepartment null when groupBy not requested ────
test('BC-11 calibration byDepartment is null without groupBy param', async () => {
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  mockDb.appraisal.findMany.mockResolvedValue([]);

  const res = await request(app).get('/performance/cycles/cycle-bc-001/calibration');
  expect(res.status).toBe(200);
  expect(res.body.byDepartment).toBeNull();
});

// ── BC-12 GET /calibration?groupBy=department — returns dept grouping ─────────
test('BC-12 calibration groupBy=department returns byDepartment', async () => {
  const appraisals = [
    makeAppraisal(1, 4.5, null),
    makeAppraisal(2, 3.2, null),
  ];
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  mockDb.appraisal.findMany.mockResolvedValue(appraisals);

  // Mock the employee-service fetch
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      employees: [
        { id: 'emp-1', fullName: 'Alice', department: 'Engineering' },
        { id: 'emp-2', fullName: 'Bob',   department: 'Finance' },
      ],
    }),
  });

  const res = await request(app).get('/performance/cycles/cycle-bc-001/calibration?groupBy=department');
  expect(res.status).toBe(200);
  expect(res.body.byDepartment).not.toBeNull();
  expect(Object.keys(res.body.byDepartment)).toEqual(expect.arrayContaining(['Engineering', 'Finance']));
});

// ── BC-13 calibration groupBy=department — fail-soft when employee-service down
test('BC-13 calibration groupBy=department degrades gracefully on employee-service failure', async () => {
  const appraisals = [makeAppraisal(1, 4.5, null)];
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  mockDb.appraisal.findMany.mockResolvedValue(appraisals);

  global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

  const res = await request(app).get('/performance/cycles/cycle-bc-001/calibration?groupBy=department');
  expect(res.status).toBe(200);
  // Grouped but employee lookup failed → Unassigned
  expect(res.body.byDepartment['Unassigned']).toBeDefined();
  expect(res.body.byDepartment['Unassigned'].count).toBe(1);
});

// ── BC-14 GET /calibration — hasDeviation is true when band is OVER ───────────
test('BC-14 hasDeviation true when Outstanding is over-represented', async () => {
  // 10 appraisals all in Outstanding → 100% vs 10% target → OVER
  const appraisals = Array.from({ length: 10 }, (_, i) => makeAppraisal(i, 5.0, null));
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  mockDb.appraisal.findMany.mockResolvedValue(appraisals);

  const res = await request(app).get('/performance/cycles/cycle-bc-001/calibration');
  expect(res.status).toBe(200);
  expect(res.body.bellCurve.hasDeviation).toBe(true);
  const outstanding = res.body.bellCurve.distribution.find(b => b.label === 'Outstanding');
  expect(outstanding.status).toBe('OVER');
});

// ── BC-15 GET /calibration — totalRated excludes appraisals with null scores ──
test('BC-15 totalRated excludes null-score appraisals', async () => {
  const appraisals = [
    makeAppraisal(1, 4.0, null),
    makeAppraisal(2, null, null), // no score
  ];
  mockDb.reviewCycle.findUnique.mockResolvedValue(CYCLE_BASE);
  mockDb.appraisal.findMany.mockResolvedValue(appraisals);

  const res = await request(app).get('/performance/cycles/cycle-bc-001/calibration');
  expect(res.status).toBe(200);
  expect(res.body.bellCurve.totalRated).toBe(1);
});
