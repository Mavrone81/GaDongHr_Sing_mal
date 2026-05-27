'use strict';
/**
 * Integration tests: HR Buddy Assignment (REC-004 item 1)
 *
 * BD-01  POST /onboarding/:id/buddy — assigns buddy, returns 201 + creates task
 * BD-02  POST /onboarding/:id/buddy — reassign updates existing record (upsert)
 * BD-03  POST /onboarding/:id/buddy — buddyId === employeeId returns 400
 * BD-04  POST /onboarding/:id/buddy — missing buddyId returns 400
 * BD-05  POST /onboarding/:id/buddy — EMPLOYEE role gets 403
 * BD-06  POST /onboarding/:id/buddy — proceeds when employee-service is down (fail-soft)
 * BD-07  GET  /onboarding/:id/buddy — returns the stored assignment
 * BD-08  GET  /onboarding/:id/buddy — 404 when nothing assigned
 * BD-09  DELETE /onboarding/:id/buddy — removes assignment, returns 204
 * BD-10  DELETE /onboarding/:id/buddy — 404 when nothing to delete
 * BD-11  DELETE /onboarding/:id/buddy — EMPLOYEE role gets 403
 * BD-12  POST assignment — notification fired to buddy when email is available
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
let mockCurrentUser = { sub: 'hr-001', email: 'hr@test.com', role: 'HR_ADMIN' };
const setUser = u => { mockCurrentUser = { ...mockCurrentUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockCurrentUser; next(); },
  authorize: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
    RECRUITER: 'RECRUITER',
  },
}), { virtual: true });

const mockBuddyFindUnique = jest.fn();
const mockBuddyCreate     = jest.fn();
const mockBuddyUpdate     = jest.fn();
const mockBuddyDelete     = jest.fn();
const mockTaskCreate      = jest.fn().mockResolvedValue({});

const mockDb = {
  candidate:          { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), create: jest.fn() },
  jobPosting:         { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  candidateStageEvent:{ create: jest.fn() },
  onboardingTask:     { createMany: jest.fn(), create: mockTaskCreate, findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  interviewRound:     { create: jest.fn(), update: jest.fn() },
  workPass:           { findMany: jest.fn().mockResolvedValue([]) },
  buddyAssignment:    { findUnique: mockBuddyFindUnique, create: mockBuddyCreate, update: mockBuddyUpdate, delete: mockBuddyDelete },
  $transaction:       jest.fn(),
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

// ── Fixtures ──────────────────────────────────────────────────────────────────
const NEW_HIRE_ID = 'emp-newhire-001';
const BUDDY_ID    = 'emp-buddy-001';

const STORED_ASSIGNMENT = {
  id: 'ba-001', employeeId: NEW_HIRE_ID, buddyId: BUDDY_ID,
  buddyName: 'Charlie Lim', newHireName: 'Alice Tan',
  startDate: new Date('2026-06-10'), assignedBy: 'hr-001',
  assignedAt: new Date(), note: null,
};

const BUDDY_PROFILE = {
  id: BUDDY_ID, firstName: 'Charlie', lastName: 'Lim',
  email: 'charlie@company.com', startDate: null,
};
const NEW_HIRE_PROFILE = {
  id: NEW_HIRE_ID, firstName: 'Alice', lastName: 'Tan',
  email: 'alice@company.com', startDate: '2026-06-10',
};

// fetch mock helper: first call = buddy lookup, second call = new hire lookup
function mockEmployeeServiceOk() {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => BUDDY_PROFILE })    // buddy
    .mockResolvedValueOnce({ ok: true, json: async () => NEW_HIRE_PROFILE }) // new hire
    .mockResolvedValue({ ok: true, json: async () => ({}) });                 // notification
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTaskCreate.mockResolvedValue({});
  global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
});

// ── BD-01 ─────────────────────────────────────────────────────────────────────
test('BD-01 POST /buddy assigns buddy and returns 201', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEmployeeServiceOk();
  mockBuddyFindUnique.mockResolvedValue(null); // no existing assignment
  mockBuddyCreate.mockResolvedValue(STORED_ASSIGNMENT);

  const res = await request(app)
    .post(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test')
    .send({ buddyId: BUDDY_ID });

  expect(res.status).toBe(201);
  expect(res.body.assignment.buddyId).toBe(BUDDY_ID);
  expect(res.body.triggers.taskCreated).toBe(true);
});

// ── BD-02 ─────────────────────────────────────────────────────────────────────
test('BD-02 POST /buddy reassignment updates existing record', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEmployeeServiceOk();
  mockBuddyFindUnique.mockResolvedValue(STORED_ASSIGNMENT); // existing
  mockBuddyUpdate.mockResolvedValue({ ...STORED_ASSIGNMENT, buddyId: 'emp-buddy-002' });

  const res = await request(app)
    .post(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test')
    .send({ buddyId: 'emp-buddy-002', note: 'Reassigned due to availability' });

  expect(res.status).toBe(201);
  expect(mockBuddyUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ where: { employeeId: NEW_HIRE_ID } })
  );
  expect(mockBuddyCreate).not.toHaveBeenCalled();
});

// ── BD-03 ─────────────────────────────────────────────────────────────────────
test('BD-03 POST /buddy buddyId same as employeeId returns 400', async () => {
  setUser({ role: 'HR_ADMIN' });

  const res = await request(app)
    .post(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test')
    .send({ buddyId: NEW_HIRE_ID });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/same person/i);
});

// ── BD-04 ─────────────────────────────────────────────────────────────────────
test('BD-04 POST /buddy missing buddyId returns 400', async () => {
  setUser({ role: 'HR_ADMIN' });

  const res = await request(app)
    .post(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test')
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/buddyId/i);
});

// ── BD-05 ─────────────────────────────────────────────────────────────────────
test('BD-05 POST /buddy EMPLOYEE role gets 403', async () => {
  setUser({ role: 'EMPLOYEE' });

  const res = await request(app)
    .post(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test')
    .send({ buddyId: BUDDY_ID });

  expect(res.status).toBe(403);
});

// ── BD-06 ─────────────────────────────────────────────────────────────────────
test('BD-06 POST /buddy proceeds when employee-service is unreachable', async () => {
  setUser({ role: 'HR_ADMIN' });
  // All fetch calls fail
  global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
  mockBuddyFindUnique.mockResolvedValue(null);
  mockBuddyCreate.mockResolvedValue({ ...STORED_ASSIGNMENT, buddyName: null, newHireName: null });

  const res = await request(app)
    .post(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test')
    .send({ buddyId: BUDDY_ID });

  expect(res.status).toBe(201);
  expect(res.body.assignment).toBeDefined();
  expect(res.body.triggers.notificationSent).toBe(false); // no email = no notification
});

// ── BD-07 ─────────────────────────────────────────────────────────────────────
test('BD-07 GET /buddy returns stored assignment', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockBuddyFindUnique.mockResolvedValue(STORED_ASSIGNMENT);

  const res = await request(app)
    .get(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body.buddyId).toBe(BUDDY_ID);
  expect(res.body.buddyName).toBe('Charlie Lim');
});

// ── BD-08 ─────────────────────────────────────────────────────────────────────
test('BD-08 GET /buddy returns 404 when nothing assigned', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockBuddyFindUnique.mockResolvedValue(null);

  const res = await request(app)
    .get(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(404);
});

// ── BD-09 ─────────────────────────────────────────────────────────────────────
test('BD-09 DELETE /buddy removes assignment and returns 204', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockBuddyFindUnique.mockResolvedValue(STORED_ASSIGNMENT);
  mockBuddyDelete.mockResolvedValue({});

  const res = await request(app)
    .delete(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(204);
  expect(mockBuddyDelete).toHaveBeenCalledWith({ where: { employeeId: NEW_HIRE_ID } });
});

// ── BD-10 ─────────────────────────────────────────────────────────────────────
test('BD-10 DELETE /buddy 404 when no assignment exists', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockBuddyFindUnique.mockResolvedValue(null);

  const res = await request(app)
    .delete(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(404);
});

// ── BD-11 ─────────────────────────────────────────────────────────────────────
test('BD-11 DELETE /buddy EMPLOYEE role gets 403', async () => {
  setUser({ role: 'EMPLOYEE' });

  const res = await request(app)
    .delete(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(403);
});

// ── BD-12 ─────────────────────────────────────────────────────────────────────
test('BD-12 POST /buddy fires notification to buddy email', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockBuddyFindUnique.mockResolvedValue(null);
  mockBuddyCreate.mockResolvedValue(STORED_ASSIGNMENT);

  let notificationBody = null;
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => BUDDY_PROFILE })
    .mockResolvedValueOnce({ ok: true, json: async () => NEW_HIRE_PROFILE })
    .mockImplementationOnce((url, opts) => {
      // third call = notification
      notificationBody = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

  await request(app)
    .post(`/recruitment/onboarding/${NEW_HIRE_ID}/buddy`)
    .set('Authorization', 'Bearer test')
    .send({ buddyId: BUDDY_ID, note: 'Please help Alice settle in' });

  // Give fire-and-forget tasks a tick to resolve
  await new Promise(r => setTimeout(r, 50));

  expect(notificationBody).not.toBeNull();
  expect(notificationBody.type).toBe('BUDDY_ASSIGNED');
  expect(notificationBody.recipients).toContain('charlie@company.com');
  expect(notificationBody.data.newHireName).toBe('Alice Tan');
});
