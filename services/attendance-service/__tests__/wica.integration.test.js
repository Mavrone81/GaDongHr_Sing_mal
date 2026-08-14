'use strict';
/**
 * Integration tests: FWA-003 — WICA Work Injury Compensation
 *
 * WI-01  POST /wica/incidents — employee reports incident → 201 with momReportDeadline
 * WI-02  POST /wica/incidents — 400 when category is invalid
 * WI-03  POST /wica/incidents — 400 when description is missing
 * WI-04  POST /wica/incidents — MEDICAL_LEAVE_ONLY has null momReportDeadline
 * WI-05  GET  /wica/incidents — employee sees only own incidents
 * WI-06  GET  /wica/incidents — manager sees all incidents with status filter
 * WI-07  GET  /wica/incidents/:id — employee fetches own → 200 with enrichment
 * WI-08  GET  /wica/incidents/:id — 403 when fetching another's incident
 * WI-09  GET  /wica/incidents/:id — 404 for unknown id
 * WI-10  PUT  /wica/incidents/:id — HR marks MOM_REPORTED with ireportRef → 200
 * WI-11  PUT  /wica/incidents/:id — 400 for invalid status
 * WI-12  POST /wica/incidents/:id/claims — HR creates claim → 201
 * WI-13  GET  /wica/incidents/:id/claims — employee fetches claims → 200
 * WI-14  PUT  /wica/incidents/:id/claims/:claimId — HR updates claim status → 200
 * WI-15  POST /wica/incidents/:id/rtw — HR records RTW → 201
 * WI-16  POST /wica/incidents/:id/rtw — 400 when rtwType invalid
 * WI-17  GET  /wica/dashboard — HR gets summary dashboard → 200
 * WI-18  GET  /wica/incidents/overdue — HR sees overdue incidents
 * WI-19  POST /wica/sweep — identifies overdue + sends notifications → 200
 * WI-20  POST /wica/sweep — EMPLOYEE gets 403
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
let mockUser = { sub: 'emp-001', role: 'EMPLOYEE' };
const setUser = u => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockIncidentCreate     = jest.fn();
const mockIncidentFindMany   = jest.fn();
const mockIncidentFindUnique = jest.fn();
const mockIncidentUpdate     = jest.fn();
const mockClaimCreate        = jest.fn();
const mockClaimFindMany      = jest.fn();
const mockClaimFindUnique    = jest.fn();
const mockClaimUpdate        = jest.fn();
const mockRtwCreate          = jest.fn();
const mockRtwFindMany        = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    wicaIncident:   { create: mockIncidentCreate, findMany: mockIncidentFindMany, findUnique: mockIncidentFindUnique, update: mockIncidentUpdate },
    wicaClaim:      { create: mockClaimCreate, findMany: mockClaimFindMany, findUnique: mockClaimFindUnique, update: mockClaimUpdate },
    wicaRtwRecord:  { create: mockRtwCreate, findMany: mockRtwFindMany },
    otAuthorization:  { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
    otBudget:         { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn(), update: jest.fn() },
    fwaRequest:         { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
    attendanceRecord:   { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    attendanceAnomaly:  { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    anomalyThreshold:   { findUnique: jest.fn().mockResolvedValue(null) },
    rosterEntry:        { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    attendancePeriod:   { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn(), update: jest.fn() },
    auditLog:           { create: jest.fn().mockResolvedValue({}) },
    employeeWorkLocation: { findMany: jest.fn().mockResolvedValue([]) },
    shiftTemplate:      { findMany: jest.fn().mockResolvedValue([]) },
    workingShift:       { findMany: jest.fn().mockResolvedValue([]) },
    workLocation:       { findMany: jest.fn().mockResolvedValue([]) },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
jest.mock('/app/shared/payroll-utils', () => ({ countWorkingDays: () => 22 }), { virtual: true });
global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

const request = require('supertest');
const app     = require('../src/index');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeIncident(overrides = {}) {
  const momDeadline = new Date(Date.now() + 5 * 86_400_000);
  return {
    id:               'inc-001',
    employeeId:       'emp-001',
    reportedById:     'emp-001',
    incidentDate:     new Date('2026-06-01T00:00:00'),
    incidentTime:     '14:30',
    incidentLocation: 'Warehouse B',
    description:      'Slipped on wet floor',
    category:         'HOSPITALISATION',
    injuryType:       'Fracture',
    bodyPart:         'Left wrist',
    status:           'REPORTED',
    momReportDeadline: momDeadline,
    momReportedAt:    null,
    ireportRef:       null,
    closedAt:         null,
    claims:           [],
    rtw:              [],
    createdAt:        new Date(),
    updatedAt:        new Date(),
    ...overrides,
  };
}

function makeClaim(overrides = {}) {
  return {
    id:                 'clm-001',
    incidentId:         'inc-001',
    employeeId:         'emp-001',
    medicalExpenses:    1500,
    medicalLeaveDays:   10,
    hospitalLeaveDays:  3,
    compensationAmount: null,
    status:             'PENDING',
    createdAt:          new Date(),
    updatedAt:          new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

// ── WI-01 ─────────────────────────────────────────────────────────────────────
test('WI-01 POST /wica/incidents — HOSPITALISATION → 201 with momReportDeadline', async () => {
  mockIncidentCreate.mockResolvedValue(makeIncident());

  const res = await request(app)
    .post('/attendance/wica/incidents')
    .send({ incidentDate: '2026-06-01', incidentLocation: 'Warehouse B', description: 'Slipped on wet floor', category: 'HOSPITALISATION' });

  expect(res.status).toBe(201);
  expect(res.body.category).toBe('HOSPITALISATION');
  expect(res.body.momReportDeadline).toBeTruthy();
  expect(res.body.deadlineUrgency).toBeDefined();
});

// ── WI-02 ─────────────────────────────────────────────────────────────────────
test('WI-02 POST /wica/incidents — 400 when category is invalid', async () => {
  const res = await request(app)
    .post('/attendance/wica/incidents')
    .send({ incidentDate: '2026-06-01', incidentLocation: 'Warehouse', description: 'Incident', category: 'UNKNOWN' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/category/i);
});

// ── WI-03 ─────────────────────────────────────────────────────────────────────
test('WI-03 POST /wica/incidents — 400 when description is missing', async () => {
  const res = await request(app)
    .post('/attendance/wica/incidents')
    .send({ incidentDate: '2026-06-01', incidentLocation: 'Warehouse', category: 'HOSPITALISATION' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/description/i);
});

// ── WI-04 ─────────────────────────────────────────────────────────────────────
test('WI-04 POST /wica/incidents — MEDICAL_LEAVE_ONLY has null momReportDeadline', async () => {
  mockIncidentCreate.mockResolvedValue(makeIncident({ category: 'MEDICAL_LEAVE_ONLY', momReportDeadline: null }));

  const res = await request(app)
    .post('/attendance/wica/incidents')
    .send({ incidentDate: '2026-06-01', incidentLocation: 'Office', description: 'Minor cut', category: 'MEDICAL_LEAVE_ONLY' });

  expect(res.status).toBe(201);
  expect(res.body.momReportDeadline).toBeNull();
  expect(res.body.deadlineUrgency).toBe('NOT_REQUIRED');
});

// ── WI-05 ─────────────────────────────────────────────────────────────────────
test('WI-05 GET /wica/incidents — employee sees only own', async () => {
  mockIncidentFindMany.mockResolvedValue([makeIncident()]);

  const res = await request(app).get('/attendance/wica/incidents');

  expect(res.status).toBe(200);
  const where = mockIncidentFindMany.mock.calls[0][0].where;
  expect(where.employeeId).toBe('emp-001');
});

// ── WI-06 ─────────────────────────────────────────────────────────────────────
test('WI-06 GET /wica/incidents — manager sees all, status filter applied', async () => {
  setUser({ sub: 'mgr-001', role: 'HR_ADMIN' });
  mockIncidentFindMany.mockResolvedValue([makeIncident(), makeIncident({ id: 'inc-002', employeeId: 'emp-002' })]);

  const res = await request(app).get('/attendance/wica/incidents?status=REPORTED');

  expect(res.status).toBe(200);
  const where = mockIncidentFindMany.mock.calls[0][0].where;
  expect(where.employeeId).toBeUndefined();
  expect(where.status).toBe('REPORTED');
  expect(res.body.total).toBe(2);
});

// ── WI-07 ─────────────────────────────────────────────────────────────────────
test('WI-07 GET /wica/incidents/:id — employee fetches own with deadline enrichment', async () => {
  mockIncidentFindUnique.mockResolvedValue(makeIncident());

  const res = await request(app).get('/attendance/wica/incidents/inc-001');

  expect(res.status).toBe(200);
  expect(res.body.id).toBe('inc-001');
  expect(res.body.deadlineUrgency).toBeDefined();
  expect(res.body.categoryLabel).toBeDefined();
});

// ── WI-08 ─────────────────────────────────────────────────────────────────────
test('WI-08 GET /wica/incidents/:id — 403 when fetching another employee\'s incident', async () => {
  setUser({ sub: 'emp-999', role: 'EMPLOYEE' });
  mockIncidentFindUnique.mockResolvedValue(makeIncident({ employeeId: 'emp-001' }));

  const res = await request(app).get('/attendance/wica/incidents/inc-001');
  expect(res.status).toBe(403);
});

// ── WI-09 ─────────────────────────────────────────────────────────────────────
test('WI-09 GET /wica/incidents/:id — 404 for unknown id', async () => {
  mockIncidentFindUnique.mockResolvedValue(null);

  const res = await request(app).get('/attendance/wica/incidents/does-not-exist');
  expect(res.status).toBe(404);
});

// ── WI-10 ─────────────────────────────────────────────────────────────────────
test('WI-10 PUT /wica/incidents/:id — HR marks MOM_REPORTED with ireportRef → 200', async () => {
  setUser({ sub: 'mgr-001', role: 'HR_ADMIN' });
  const reported = makeIncident({ status: 'MOM_REPORTED', ireportRef: 'iRPT-2026-00123', momReportedAt: new Date() });
  mockIncidentFindUnique.mockResolvedValue(makeIncident());
  mockIncidentUpdate.mockResolvedValue(reported);

  const res = await request(app)
    .put('/attendance/wica/incidents/inc-001')
    .send({ status: 'MOM_REPORTED', ireportRef: 'iRPT-2026-00123' });

  expect(res.status).toBe(200);
  expect(res.body.status).toBe('MOM_REPORTED');
  expect(res.body.ireportRef).toBe('iRPT-2026-00123');
});

// ── WI-11 ─────────────────────────────────────────────────────────────────────
test('WI-11 PUT /wica/incidents/:id — 400 for invalid status', async () => {
  setUser({ sub: 'mgr-001', role: 'HR_ADMIN' });
  mockIncidentFindUnique.mockResolvedValue(makeIncident());

  const res = await request(app)
    .put('/attendance/wica/incidents/inc-001')
    .send({ status: 'BOGUS_STATUS' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/status/i);
});

// ── WI-12 ─────────────────────────────────────────────────────────────────────
test('WI-12 POST /wica/incidents/:id/claims — HR creates claim → 201', async () => {
  setUser({ sub: 'mgr-001', role: 'HR_ADMIN' });
  mockIncidentFindUnique.mockResolvedValue(makeIncident());
  mockClaimCreate.mockResolvedValue(makeClaim());
  mockIncidentUpdate.mockResolvedValue(makeIncident({ status: 'CLAIM_SUBMITTED' }));

  const res = await request(app)
    .post('/attendance/wica/incidents/inc-001/claims')
    .send({ medicalExpenses: 1500, medicalLeaveDays: 10, insurerName: 'AIA Singapore' });

  expect(res.status).toBe(201);
  expect(res.body.status).toBe('PENDING');
  expect(mockClaimCreate).toHaveBeenCalledTimes(1);
});

// ── WI-13 ─────────────────────────────────────────────────────────────────────
test('WI-13 GET /wica/incidents/:id/claims — employee fetches claims → 200', async () => {
  mockIncidentFindUnique.mockResolvedValue(makeIncident());
  mockClaimFindMany.mockResolvedValue([makeClaim()]);

  const res = await request(app).get('/attendance/wica/incidents/inc-001/claims');

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
  expect(res.body.claims[0].id).toBe('clm-001');
});

// ── WI-14 ─────────────────────────────────────────────────────────────────────
test('WI-14 PUT /wica/incidents/:id/claims/:claimId — HR updates to APPROVED', async () => {
  setUser({ sub: 'mgr-001', role: 'HR_ADMIN' });
  const claim = makeClaim({ incidentId: 'inc-001' });
  mockClaimFindUnique.mockResolvedValue(claim);
  mockClaimUpdate.mockResolvedValue({ ...claim, status: 'APPROVED', approvedBy: 'mgr-001' });

  const res = await request(app)
    .put('/attendance/wica/incidents/inc-001/claims/clm-001')
    .send({ status: 'APPROVED', compensationAmount: 3000 });

  expect(res.status).toBe(200);
  expect(res.body.status).toBe('APPROVED');
});

// ── WI-15 ─────────────────────────────────────────────────────────────────────
test('WI-15 POST /wica/incidents/:id/rtw — HR records RTW → 201', async () => {
  setUser({ sub: 'mgr-001', role: 'HR_ADMIN' });
  mockIncidentFindUnique.mockResolvedValue(makeIncident());
  mockRtwCreate.mockResolvedValue({
    id: 'rtw-001', incidentId: 'inc-001', employeeId: 'emp-001',
    rtwDate: new Date('2026-06-20'), rtwType: 'LIGHT_DUTIES',
    restrictions: 'No lifting > 5kg', reviewDate: new Date('2026-07-01'), createdAt: new Date(),
  });

  const res = await request(app)
    .post('/attendance/wica/incidents/inc-001/rtw')
    .send({ rtwDate: '2026-06-20', rtwType: 'LIGHT_DUTIES', restrictions: 'No lifting > 5kg', reviewDate: '2026-07-01' });

  expect(res.status).toBe(201);
  expect(res.body.rtwType).toBe('LIGHT_DUTIES');
});

// ── WI-16 ─────────────────────────────────────────────────────────────────────
test('WI-16 POST /wica/incidents/:id/rtw — 400 when rtwType invalid', async () => {
  setUser({ sub: 'mgr-001', role: 'HR_ADMIN' });
  mockIncidentFindUnique.mockResolvedValue(makeIncident());

  const res = await request(app)
    .post('/attendance/wica/incidents/inc-001/rtw')
    .send({ rtwDate: '2026-06-20', rtwType: 'INVALID_TYPE' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/rtwType/i);
});

// ── WI-17 ─────────────────────────────────────────────────────────────────────
test('WI-17 GET /wica/dashboard — HR gets summary dashboard', async () => {
  setUser({ sub: 'mgr-001', role: 'HR_ADMIN' });
  mockIncidentFindMany.mockResolvedValue([
    makeIncident(),
    makeIncident({ id: 'inc-002', category: 'MEDICAL_LEAVE_ONLY', momReportDeadline: null, status: 'CLOSED' }),
  ]);
  mockClaimFindMany.mockResolvedValue([makeClaim(), makeClaim({ id: 'clm-002', status: 'PAID' })]);

  const res = await request(app).get('/attendance/wica/dashboard');

  expect(res.status).toBe(200);
  expect(res.body.summary).toBeDefined();
  expect(res.body.summary.totalIncidents).toBe(2);
  expect(res.body.overdue).toBeInstanceOf(Array);
  expect(res.body.due).toBeInstanceOf(Array);
  expect(res.body.asOf).toBeDefined();
});

// ── WI-18 ─────────────────────────────────────────────────────────────────────
test('WI-18 GET /wica/incidents/overdue — HR sees overdue incidents', async () => {
  setUser({ sub: 'mgr-001', role: 'HR_ADMIN' });
  const overdueInc = makeIncident({ momReportDeadline: new Date(Date.now() - 86_400_000) });
  mockIncidentFindMany.mockResolvedValue([overdueInc]);

  const res = await request(app).get('/attendance/wica/incidents/overdue');

  expect(res.status).toBe(200);
  expect(res.body.count).toBe(1);
  expect(res.body.overdue[0].deadlineUrgency).toBe('OVERDUE');
});

// ── WI-19 ─────────────────────────────────────────────────────────────────────
test('WI-19 POST /wica/sweep — identifies overdue + fires notifications', async () => {
  setUser({ sub: 'mgr-001', role: 'HR_ADMIN' });
  const overdueInc  = makeIncident({ momReportDeadline: new Date(Date.now() - 2 * 86_400_000) });
  const upcomingInc = makeIncident({ id: 'inc-002', momReportDeadline: new Date(Date.now() + 5 * 86_400_000) });
  mockIncidentFindMany.mockResolvedValue([overdueInc, upcomingInc]);

  const res = await request(app).post('/attendance/wica/sweep');

  expect(res.status).toBe(200);
  expect(res.body.checked).toBe(2);
  expect(res.body.overdue).toBe(1);
  expect(global.fetch).toHaveBeenCalledTimes(1); // notification fired for overdue
});

// ── WI-20 ─────────────────────────────────────────────────────────────────────
test('WI-20 POST /wica/sweep — EMPLOYEE gets 403', async () => {
  const res = await request(app).post('/attendance/wica/sweep');
  expect(res.status).toBe(403);
});
