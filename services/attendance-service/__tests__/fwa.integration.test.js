'use strict';
/**
 * Integration tests: FWA-001 — Flexi-Work Arrangements
 *
 * FWA-01  POST /fwa/requests — employee submits FLEXI_PLACE request → 201
 * FWA-02  POST /fwa/requests — 400 when type is invalid
 * FWA-03  POST /fwa/requests — 400 when reason is empty
 * FWA-04  POST /fwa/requests — 400 when FLEXI_LOAD details have hoursPerWeek > 44
 * FWA-05  POST /fwa/requests — reviewDeadline is exactly 2 months from today
 * FWA-06  GET /fwa/requests — employee sees only own requests
 * FWA-07  GET /fwa/requests — HR_ADMIN sees all requests with summary
 * FWA-08  GET /fwa/requests — HR can filter by status
 * FWA-09  GET /fwa/requests/:id — employee can fetch own request
 * FWA-10  GET /fwa/requests/:id — employee gets 403 for other's request
 * FWA-11  GET /fwa/requests/:id — 404 for missing id
 * FWA-12  PUT /fwa/requests/:id/approve — HR approves PENDING request
 * FWA-13  PUT /fwa/requests/:id/approve — 409 when request is not PENDING
 * FWA-14  PUT /fwa/requests/:id/reject — 400 when decisionNote is missing
 * FWA-15  PUT /fwa/requests/:id/reject — HR rejects with decisionNote
 * FWA-16  PUT /fwa/requests/:id/withdraw — employee withdraws own request
 * FWA-17  PUT /fwa/requests/:id/withdraw — 403 when withdrawing another's request
 * FWA-18  PUT /fwa/requests/:id/withdraw — 409 when request is not PENDING
 * FWA-19  GET /fwa/requests/overdue — HR sees only overdue PENDING requests
 * FWA-20  GET /fwa/requests/overdue — EMPLOYEE gets 403
 * FWA-21  POST /fwa/sweep — marks overdue PENDING as EXPIRED
 * FWA-22  POST /fwa/sweep — skips future-deadline PENDING requests
 * FWA-23  POST /fwa/sweep — EMPLOYEE gets 403
 * FWA-24  GET /fwa/dashboard — HR sees summary + pending list
 * FWA-25  GET /fwa/dashboard — response includes deadlineUrgency on pending items
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

// FWA Prisma mocks
const mockFwaCreate     = jest.fn();
const mockFwaFindMany   = jest.fn();
const mockFwaFindUnique = jest.fn();
const mockFwaUpdate     = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    fwaRequest:           { create: mockFwaCreate, findMany: mockFwaFindMany, findUnique: mockFwaFindUnique, update: mockFwaUpdate },
    attendanceRecord:     { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), findFirst: jest.fn() },
    attendanceAnomaly:    { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() },
    anomalyThreshold:     { findUnique: jest.fn().mockResolvedValue(null) },
    rosterEntry:          { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    attendancePeriod:     { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn(), update: jest.fn() },
    auditLog:             { create: jest.fn().mockResolvedValue({}) },
    employeeWorkLocation: { findMany: jest.fn().mockResolvedValue([]) },
    shiftTemplate:        { findMany: jest.fn().mockResolvedValue([]) },
    workingShift:         { findMany: jest.fn().mockResolvedValue([]) },
    workLocation:         { findMany: jest.fn().mockResolvedValue([]) },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
jest.mock('/app/shared/payroll-utils', () => ({ countWorkingDays: () => 22 }), { virtual: true });

global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

const request = require('supertest');
const app     = require('../src/index');

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysFromNow(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function monthsFromNow(m) {
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return d;
}

function makeFwa(overrides = {}) {
  return {
    id:             'fwa-001',
    employeeId:     'emp-001',
    type:           'FLEXI_PLACE',
    status:         'PENDING',
    proposedStart:  new Date('2026-07-01'),
    proposedEnd:    null,
    reason:         'Better work-life balance',
    details:        { wfhDaysPerWeek: 3 },
    reviewedById:   null,
    reviewedAt:     null,
    reviewDeadline: monthsFromNow(2),
    decisionNote:   null,
    notifiedAt:     null,
    createdAt:      new Date(),
    updatedAt:      new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  mockFwaCreate.mockImplementation(({ data }) => Promise.resolve({ ...data, createdAt: new Date(), updatedAt: new Date() }));
  mockFwaFindMany.mockResolvedValue([]);
  mockFwaFindUnique.mockResolvedValue(null);
  mockFwaUpdate.mockImplementation(({ where, data }) => Promise.resolve(makeFwa({ id: where.id, ...data })));
});

// ── FWA-01 ────────────────────────────────────────────────────────────────────
test('FWA-01 employee submits FLEXI_PLACE request → 201', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });

  const res = await request(app)
    .post('/attendance/fwa/requests')
    .set('Authorization', 'Bearer t')
    .send({ type: 'FLEXI_PLACE', proposedStart: '2026-07-01', reason: 'Better work-life balance', details: { wfhDaysPerWeek: 3 } });

  expect(res.status).toBe(201);
  expect(res.body.type).toBe('FLEXI_PLACE');
  expect(res.body.status).toBe('PENDING');
  expect(res.body.employeeId).toBe('emp-001');
  expect(res.body.reviewDeadline).toBeDefined();
});

// ── FWA-02 ────────────────────────────────────────────────────────────────────
test('FWA-02 400 when type is invalid', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });

  const res = await request(app)
    .post('/attendance/fwa/requests')
    .set('Authorization', 'Bearer t')
    .send({ type: 'FLEXI_MAGIC', proposedStart: '2026-07-01', reason: 'Test' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/type/i);
});

// ── FWA-03 ────────────────────────────────────────────────────────────────────
test('FWA-03 400 when reason is empty', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });

  const res = await request(app)
    .post('/attendance/fwa/requests')
    .set('Authorization', 'Bearer t')
    .send({ type: 'FLEXI_TIME', proposedStart: '2026-07-01', reason: '   ' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/reason/i);
});

// ── FWA-04 ────────────────────────────────────────────────────────────────────
test('FWA-04 400 when FLEXI_LOAD details have hoursPerWeek > 44', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });

  const res = await request(app)
    .post('/attendance/fwa/requests')
    .set('Authorization', 'Bearer t')
    .send({ type: 'FLEXI_LOAD', proposedStart: '2026-07-01', reason: 'Test', details: { hoursPerWeek: 50 } });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/hoursPerWeek/i);
});

// ── FWA-05 ────────────────────────────────────────────────────────────────────
test('FWA-05 reviewDeadline is exactly 2 months from today', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });
  const before = new Date();

  const res = await request(app)
    .post('/attendance/fwa/requests')
    .set('Authorization', 'Bearer t')
    .send({ type: 'FLEXI_PLACE', proposedStart: '2026-07-01', reason: 'WFH preferred' });

  const deadline = new Date(res.body.reviewDeadline);
  const expected = new Date(before);
  expected.setMonth(expected.getMonth() + 2);

  // Allow ±1 day for test timing
  expect(Math.abs(deadline - expected)).toBeLessThan(86_400_000 * 2);
});

// ── FWA-06 ────────────────────────────────────────────────────────────────────
test('FWA-06 employee sees only own requests', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });
  mockFwaFindMany.mockResolvedValue([makeFwa({ employeeId: 'emp-001' })]);

  const res = await request(app)
    .get('/attendance/fwa/requests')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body.requests).toHaveLength(1);
  // Confirm query was scoped to this employee
  const where = mockFwaFindMany.mock.calls[0][0].where;
  expect(where.employeeId).toBe('emp-001');
  // No summary for employees
  expect(res.body.summary).toBeUndefined();
});

// ── FWA-07 ────────────────────────────────────────────────────────────────────
test('FWA-07 HR_ADMIN sees all requests with summary', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockFwaFindMany.mockResolvedValue([
    makeFwa({ status: 'PENDING',   employeeId: 'emp-001' }),
    makeFwa({ status: 'APPROVED',  employeeId: 'emp-002' }),
    makeFwa({ status: 'REJECTED',  employeeId: 'emp-003' }),
  ]);

  const res = await request(app)
    .get('/attendance/fwa/requests')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body.requests).toHaveLength(3);
  expect(res.body.summary).toBeDefined();
  expect(res.body.summary.total).toBe(3);
  // HR query should not scope by employeeId
  const where = mockFwaFindMany.mock.calls[0][0].where;
  expect(where.employeeId).toBeUndefined();
});

// ── FWA-08 ────────────────────────────────────────────────────────────────────
test('FWA-08 HR can filter by status', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockFwaFindMany.mockResolvedValue([makeFwa({ status: 'PENDING' })]);

  const res = await request(app)
    .get('/attendance/fwa/requests?status=PENDING')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  const where = mockFwaFindMany.mock.calls[0][0].where;
  expect(where.status).toBe('PENDING');
});

// ── FWA-09 ────────────────────────────────────────────────────────────────────
test('FWA-09 employee can fetch own request', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });
  mockFwaFindUnique.mockResolvedValue(makeFwa({ id: 'fwa-x', employeeId: 'emp-001' }));

  const res = await request(app)
    .get('/attendance/fwa/requests/fwa-x')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body.id).toBe('fwa-x');
  expect(res.body.typeLabel).toBeDefined();
  expect(res.body.deadlineUrgency).toBeDefined();
});

// ── FWA-10 ────────────────────────────────────────────────────────────────────
test('FWA-10 employee gets 403 for another employee request', async () => {
  setUser({ sub: 'emp-002', role: 'EMPLOYEE' });
  mockFwaFindUnique.mockResolvedValue(makeFwa({ id: 'fwa-x', employeeId: 'emp-001' }));

  const res = await request(app)
    .get('/attendance/fwa/requests/fwa-x')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(403);
});

// ── FWA-11 ────────────────────────────────────────────────────────────────────
test('FWA-11 404 for missing request id', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });
  mockFwaFindUnique.mockResolvedValue(null);

  const res = await request(app)
    .get('/attendance/fwa/requests/does-not-exist')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(404);
});

// ── FWA-12 ────────────────────────────────────────────────────────────────────
test('FWA-12 HR approves PENDING request', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockFwaFindUnique.mockResolvedValue(makeFwa({ id: 'fwa-1', status: 'PENDING' }));

  const res = await request(app)
    .put('/attendance/fwa/requests/fwa-1/approve')
    .set('Authorization', 'Bearer t')
    .send({ decisionNote: 'Approved — business need can be met remotely' });

  expect(res.status).toBe(200);
  expect(mockFwaUpdate).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'fwa-1' },
    data:  expect.objectContaining({ status: 'APPROVED' }),
  }));
});

// ── FWA-13 ────────────────────────────────────────────────────────────────────
test('FWA-13 409 when approving a non-PENDING request', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockFwaFindUnique.mockResolvedValue(makeFwa({ status: 'APPROVED' }));

  const res = await request(app)
    .put('/attendance/fwa/requests/fwa-1/approve')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(409);
});

// ── FWA-14 ────────────────────────────────────────────────────────────────────
test('FWA-14 400 when rejecting without decisionNote', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockFwaFindUnique.mockResolvedValue(makeFwa({ status: 'PENDING' }));

  const res = await request(app)
    .put('/attendance/fwa/requests/fwa-1/reject')
    .set('Authorization', 'Bearer t')
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/decisionNote/i);
});

// ── FWA-15 ────────────────────────────────────────────────────────────────────
test('FWA-15 HR rejects with decisionNote', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockFwaFindUnique.mockResolvedValue(makeFwa({ id: 'fwa-1', status: 'PENDING' }));

  const res = await request(app)
    .put('/attendance/fwa/requests/fwa-1/reject')
    .set('Authorization', 'Bearer t')
    .send({ decisionNote: 'Operational requirements cannot accommodate WFH at this time' });

  expect(res.status).toBe(200);
  expect(mockFwaUpdate).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'REJECTED', decisionNote: 'Operational requirements cannot accommodate WFH at this time' }),
  }));
});

// ── FWA-16 ────────────────────────────────────────────────────────────────────
test('FWA-16 employee withdraws own request', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });
  mockFwaFindUnique.mockResolvedValue(makeFwa({ id: 'fwa-1', employeeId: 'emp-001', status: 'PENDING' }));

  const res = await request(app)
    .put('/attendance/fwa/requests/fwa-1/withdraw')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(mockFwaUpdate).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'WITHDRAWN' }),
  }));
});

// ── FWA-17 ────────────────────────────────────────────────────────────────────
test('FWA-17 403 when withdrawing another employee request', async () => {
  setUser({ sub: 'emp-002', role: 'EMPLOYEE' });
  mockFwaFindUnique.mockResolvedValue(makeFwa({ employeeId: 'emp-001', status: 'PENDING' }));

  const res = await request(app)
    .put('/attendance/fwa/requests/fwa-1/withdraw')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(403);
});

// ── FWA-18 ────────────────────────────────────────────────────────────────────
test('FWA-18 409 when withdrawing a non-PENDING request', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });
  mockFwaFindUnique.mockResolvedValue(makeFwa({ employeeId: 'emp-001', status: 'APPROVED' }));

  const res = await request(app)
    .put('/attendance/fwa/requests/fwa-1/withdraw')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(409);
});

// ── FWA-19 ────────────────────────────────────────────────────────────────────
test('FWA-19 HR gets only overdue PENDING in /overdue', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  const pastDeadline = new Date(Date.now() - 86_400_000 * 5); // 5 days ago
  const futureDeadline = new Date(Date.now() + 86_400_000 * 30);

  mockFwaFindMany.mockResolvedValue([
    makeFwa({ id: 'overdue', status: 'PENDING', reviewDeadline: pastDeadline }),
    makeFwa({ id: 'future',  status: 'PENDING', reviewDeadline: futureDeadline }),
  ]);

  const res = await request(app)
    .get('/attendance/fwa/requests/overdue')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body.overdue).toHaveLength(1);
  expect(res.body.overdue[0].id).toBe('overdue');
  expect(res.body.count).toBe(1);
});

// ── FWA-20 ────────────────────────────────────────────────────────────────────
test('FWA-20 EMPLOYEE gets 403 on /overdue', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });

  const res = await request(app)
    .get('/attendance/fwa/requests/overdue')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(403);
});

// ── FWA-21 ────────────────────────────────────────────────────────────────────
test('FWA-21 sweep marks overdue PENDING as EXPIRED', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  const overdue = makeFwa({ id: 'overdue-1', status: 'PENDING', reviewDeadline: new Date(Date.now() - 86_400_000) });
  mockFwaFindMany.mockResolvedValue([overdue]);

  const res = await request(app)
    .post('/attendance/fwa/sweep')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body.expired).toBe(1);
  expect(mockFwaUpdate).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'overdue-1' },
    data:  expect.objectContaining({ status: 'EXPIRED' }),
  }));
});

// ── FWA-22 ────────────────────────────────────────────────────────────────────
test('FWA-22 sweep skips future-deadline PENDING requests', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  const future = makeFwa({ status: 'PENDING', reviewDeadline: new Date(Date.now() + 86_400_000 * 30) });
  mockFwaFindMany.mockResolvedValue([future]);

  const res = await request(app)
    .post('/attendance/fwa/sweep')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body.expired).toBe(0);
  expect(mockFwaUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'EXPIRED' }),
  }));
});

// ── FWA-23 ────────────────────────────────────────────────────────────────────
test('FWA-23 EMPLOYEE gets 403 on sweep', async () => {
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });

  const res = await request(app)
    .post('/attendance/fwa/sweep')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(403);
});

// ── FWA-24 ────────────────────────────────────────────────────────────────────
test('FWA-24 HR dashboard returns summary and pending list', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockFwaFindMany.mockResolvedValue([
    makeFwa({ status: 'PENDING',  reviewDeadline: new Date(Date.now() + 86_400_000 * 20) }),
    makeFwa({ status: 'APPROVED', reviewDeadline: new Date(Date.now() + 86_400_000 * 5) }),
  ]);

  const res = await request(app)
    .get('/attendance/fwa/dashboard')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body.summary.total).toBe(2);
  expect(res.body.summary.pending).toBe(1);
  expect(res.body.summary.approved).toBe(1);
  expect(res.body.pending).toHaveLength(1);
  expect(res.body.asOf).toBeDefined();
});

// ── FWA-25 ────────────────────────────────────────────────────────────────────
test('FWA-25 dashboard pending items include deadlineUrgency', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockFwaFindMany.mockResolvedValue([
    makeFwa({ status: 'PENDING', reviewDeadline: new Date(Date.now() + 86_400_000 * 5) }), // CRITICAL
  ]);

  const res = await request(app)
    .get('/attendance/fwa/dashboard')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body.pending[0].deadlineUrgency).toBe('CRITICAL');
  expect(res.body.pending[0].daysUntilDeadline).toBeDefined();
});
