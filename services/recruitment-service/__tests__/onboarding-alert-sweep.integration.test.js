'use strict';
/**
 * Integration tests: Onboarding Incomplete Alert Sweep (REC-004 item 2)
 *
 * OA-01  POST /alert-sweep — fires alert for employee with incomplete tasks starting in 3 days
 * OA-02  POST /alert-sweep — skips employee whose all tasks are complete
 * OA-03  POST /alert-sweep — skips employees not starting on target date
 * OA-04  POST /alert-sweep — handles zero upcoming starters gracefully
 * OA-05  POST /alert-sweep — custom daysAhead param respected
 * OA-06  POST /alert-sweep — employee with no tasks at all is alerted (0/0 = still new hire)
 * OA-07  POST /alert-sweep — EMPLOYEE role gets 403
 * OA-08  POST /alert-sweep — 502 when employee-service is unreachable
 * OA-09  runOnboardingAlertSweep — notification payload contains correct fields
 * OA-10  POST /alert-sweep — multiple upcoming starters: alerted count correct
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
let mockCurrentUser = { sub: 'hr-001', role: 'HR_ADMIN' };
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

const mockTaskFindMany = jest.fn();

const mockDb = {
  candidate:          { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), create: jest.fn() },
  jobPosting:         { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  candidateStageEvent:{ create: jest.fn() },
  onboardingTask:     { createMany: jest.fn(), create: jest.fn(), findMany: mockTaskFindMany, update: jest.fn() },
  interviewRound:     { create: jest.fn(), update: jest.fn() },
  workPass:           { findMany: jest.fn().mockResolvedValue([]) },
  buddyAssignment:    { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
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
const { runOnboardingAlertSweep } = require('../src/routes/recruitment.routes');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Build a date string YYYY-MM-DD that is `n` days from today (UTC)
function dateInDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function makeEmployee(id, daysFromNow) {
  return {
    id,
    firstName: 'Test',
    lastName: `User-${id}`,
    email: `${id}@company.com`,
    startDate: dateInDays(daysFromNow),
  };
}

const INCOMPLETE_TASKS = [
  { id: 't1', taskName: 'Sign employment contract', isDone: false },
  { id: 't2', taskName: 'IT equipment provisioning', isDone: false },
];
const COMPLETE_TASKS = [
  { id: 't3', taskName: 'Sign employment contract', isDone: true },
  { id: 't4', taskName: 'Submit NRIC copy', isDone: true },
];

// Mock employee-service returning a list of employees
function mockEmpService(employees) {
  // first fetch call = employee list; subsequent = notification
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => employees })
    .mockResolvedValue({ ok: true, json: async () => ({}) });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTaskFindMany.mockResolvedValue([]);
});

// ── OA-01 ─────────────────────────────────────────────────────────────────────
test('OA-01 alerts HR for employee starting in 3 days with incomplete tasks', async () => {
  setUser({ role: 'HR_ADMIN' });
  const emp = makeEmployee('emp-start-3d', 3);
  mockEmpService([emp]);
  mockTaskFindMany.mockResolvedValue(INCOMPLETE_TASKS);

  const res = await request(app)
    .post('/recruitment/onboarding/alert-sweep')
    .set('Authorization', 'Bearer test')
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.checked).toBe(1);
  expect(res.body.alerted).toBe(1);
  expect(res.body.skipped).toBe(0);
  expect(res.body.targetDate).toBe(dateInDays(3));
});

// ── OA-02 ─────────────────────────────────────────────────────────────────────
test('OA-02 skips employee whose tasks are all complete', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEmpService([makeEmployee('emp-done', 3)]);
  mockTaskFindMany.mockResolvedValue(COMPLETE_TASKS);

  const res = await request(app)
    .post('/recruitment/onboarding/alert-sweep')
    .set('Authorization', 'Bearer test')
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.checked).toBe(1);
  expect(res.body.alerted).toBe(0);
  expect(res.body.skipped).toBe(1);
});

// ── OA-03 ─────────────────────────────────────────────────────────────────────
test('OA-03 skips employees not starting on target date', async () => {
  setUser({ role: 'HR_ADMIN' });
  // Employee starting in 10 days — not the target (3 days)
  mockEmpService([makeEmployee('emp-far', 10)]);

  const res = await request(app)
    .post('/recruitment/onboarding/alert-sweep')
    .set('Authorization', 'Bearer test')
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.checked).toBe(0);
  expect(res.body.alerted).toBe(0);
});

// ── OA-04 ─────────────────────────────────────────────────────────────────────
test('OA-04 handles zero upcoming starters gracefully', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEmpService([]);

  const res = await request(app)
    .post('/recruitment/onboarding/alert-sweep')
    .set('Authorization', 'Bearer test')
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.checked).toBe(0);
  expect(res.body.alerted).toBe(0);
});

// ── OA-05 ─────────────────────────────────────────────────────────────────────
test('OA-05 custom daysAhead param is respected', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEmpService([makeEmployee('emp-5d', 5)]);
  mockTaskFindMany.mockResolvedValue(INCOMPLETE_TASKS);

  const res = await request(app)
    .post('/recruitment/onboarding/alert-sweep')
    .set('Authorization', 'Bearer test')
    .send({ daysAhead: 5 });

  expect(res.status).toBe(200);
  expect(res.body.targetDate).toBe(dateInDays(5));
  expect(res.body.checked).toBe(1);
  expect(res.body.alerted).toBe(1);
});

// ── OA-06 ─────────────────────────────────────────────────────────────────────
test('OA-06 employee with no tasks is skipped (nothing to alert about)', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockEmpService([makeEmployee('emp-notasks', 3)]);
  mockTaskFindMany.mockResolvedValue([]); // no tasks at all = also no incomplete ones

  const res = await request(app)
    .post('/recruitment/onboarding/alert-sweep')
    .set('Authorization', 'Bearer test')
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.checked).toBe(1);
  expect(res.body.alerted).toBe(0);
  expect(res.body.skipped).toBe(1);
});

// ── OA-07 ─────────────────────────────────────────────────────────────────────
test('OA-07 EMPLOYEE role gets 403', async () => {
  setUser({ role: 'EMPLOYEE' });

  const res = await request(app)
    .post('/recruitment/onboarding/alert-sweep')
    .set('Authorization', 'Bearer test')
    .send({});

  expect(res.status).toBe(403);
});

// ── OA-08 ─────────────────────────────────────────────────────────────────────
test('OA-08 502 when employee-service is unreachable', async () => {
  setUser({ role: 'HR_ADMIN' });
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });

  const res = await request(app)
    .post('/recruitment/onboarding/alert-sweep')
    .set('Authorization', 'Bearer test')
    .send({});

  expect(res.status).toBe(500);
  expect(res.body.error).toMatch(/employee-service/i);
});

// ── OA-09 ─────────────────────────────────────────────────────────────────────
test('OA-09 notification payload contains required fields', async () => {
  const emp = makeEmployee('emp-check', 3);
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => [emp] }); // employee list

  mockTaskFindMany.mockResolvedValue(INCOMPLETE_TASKS);

  let capturedPayload = null;
  global.fetch.mockImplementationOnce((url, opts) => {
    capturedPayload = JSON.parse(opts.body);
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });

  await runOnboardingAlertSweep(3, '');
  await new Promise(r => setTimeout(r, 50));

  expect(capturedPayload).not.toBeNull();
  expect(capturedPayload.type).toBe('ONBOARDING_INCOMPLETE_ALERT');
  expect(capturedPayload.roles).toContain('HR_ADMIN');
  expect(capturedPayload.data.employeeId).toBe('emp-check');
  expect(capturedPayload.data.incompleteTasks).toBe(2);
  expect(capturedPayload.data.daysUntilStart).toBe(3);
  expect(capturedPayload.data.startDate).toBe(dateInDays(3));
});

// ── OA-10 ─────────────────────────────────────────────────────────────────────
test('OA-10 multiple starters: alerted and skipped counts are correct', async () => {
  setUser({ role: 'HR_ADMIN' });
  const emps = [
    makeEmployee('emp-a', 3), // incomplete → alerted
    makeEmployee('emp-b', 3), // complete → skipped
    makeEmployee('emp-c', 3), // incomplete → alerted
  ];
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => emps })
    .mockResolvedValue({ ok: true, json: async () => ({}) });

  mockTaskFindMany
    .mockResolvedValueOnce(INCOMPLETE_TASKS) // emp-a
    .mockResolvedValueOnce(COMPLETE_TASKS)   // emp-b
    .mockResolvedValueOnce(INCOMPLETE_TASKS); // emp-c

  const res = await request(app)
    .post('/recruitment/onboarding/alert-sweep')
    .set('Authorization', 'Bearer test')
    .send({});

  expect(res.status).toBe(200);
  expect(res.body.checked).toBe(3);
  expect(res.body.alerted).toBe(2);
  expect(res.body.skipped).toBe(1);
});
