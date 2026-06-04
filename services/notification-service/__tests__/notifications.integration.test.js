'use strict';
/**
 * Integration tests: Notification Service
 *
 * NS-01  POST /notifications/send — in-app created for recipientIds
 * NS-02  POST /notifications/send — role-broadcast stored as userId='role:ROLE'
 * NS-03  POST /notifications/send — email-only recipients do not create in-app record
 * NS-04  POST /notifications/send — 400 when type missing
 * NS-05  POST /notifications/send — renders LEAVE_APPROVED template correctly
 * NS-06  POST /notifications/send — renders ONBOARDING_INCOMPLETE_ALERT template
 * NS-07  POST /notifications/send — unknown type falls back to SYSTEM template
 * NS-08  GET /notifications/me — returns own + role-broadcast records
 * NS-09  GET /notifications/me — ?unread=true filters to unread only
 * NS-10  GET /notifications/me — ?limit capped at 100
 * NS-11  GET /notifications/me/unread-count — returns correct count
 * NS-12  PUT /notifications/me/read-all — marks all unread as read
 * NS-13  PUT /notifications/:id/read — marks single notification as read
 * NS-14  GET /notifications/me/all — alias returns same as /me
 * NS-15  POST /notifications/in-app — legacy endpoint creates in-app record
 * NS-16  POST /notifications/in-app — 400 when required fields missing
 * NS-17  POST /notifications/email — legacy plain email accepted
 * NS-18  POST /notifications/email — structured call stores role in-app records
 * NS-19  GET /notifications/:userId — legacy lookup by userId
 * NS-20  GET /notifications/me — returns empty array when no records
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
let mockCurrentUser = { sub: 'user-001', role: 'HR_ADMIN' };
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
    RECRUITER: 'RECRUITER', IT_ADMIN: 'IT_ADMIN',
  },
}), { virtual: true });

// Prisma mock
const mockCreate     = jest.fn();
const mockFindMany   = jest.fn();
const mockFindUnique = jest.fn();
const mockCount      = jest.fn();
const mockUpdateMany = jest.fn();
const mockUpdate     = jest.fn();

const mockDb = {
  notification: {
    create:     mockCreate,
    findMany:   mockFindMany,
    findUnique: mockFindUnique,
    count:      mockCount,
    updateMany: mockUpdateMany,
    update:     mockUpdate,
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

// Nodemailer mock — sendMail always resolves
jest.mock('nodemailer', () => ({
  createTransport: () => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test' }),
  }),
}));

// uuid mock — each call returns a unique id
let mockUuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `mock-uuid-${++mockUuidCounter}` }));

const request = require('supertest');
const { app }  = require('../src/index');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeNotif(overrides = {}) {
  return {
    id: 'n-001', userId: 'user-001', type: 'IN_APP',
    title: 'Test', body: 'Body', category: 'SYSTEM', link: '/dashboard',
    isRead: false, readAt: null, meta: null, createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUuidCounter = 0;
  mockCreate.mockImplementation(({ data }) => Promise.resolve({ ...data, createdAt: new Date().toISOString() }));
  mockFindMany.mockResolvedValue([]);
  mockCount.mockResolvedValue(0);
  mockUpdateMany.mockResolvedValue({ count: 0 });
  mockUpdate.mockImplementation(({ where, data }) =>
    Promise.resolve({ id: where.id, ...data, type: 'IN_APP', title: 'T', body: 'B' })
  );
});

// ── NS-01 ─────────────────────────────────────────────────────────────────────
test('NS-01 send creates in-app record for each recipientId', async () => {
  setUser({ role: 'HR_ADMIN' });

  const res = await request(app)
    .post('/notifications/send')
    .set('Authorization', 'Bearer t')
    .send({ type: 'SYSTEM', recipientIds: ['emp-1', 'emp-2'], data: {} });

  expect(res.status).toBe(201);
  expect(res.body.sent).toBe(2);
  expect(res.body.inAppIds).toHaveLength(2);
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(mockCreate.mock.calls[0][0].data.userId).toBe('emp-1');
  expect(mockCreate.mock.calls[1][0].data.userId).toBe('emp-2');
});

// ── NS-02 ─────────────────────────────────────────────────────────────────────
test('NS-02 send stores role-broadcast as userId=role:ROLE', async () => {
  setUser({ role: 'HR_ADMIN' });

  const res = await request(app)
    .post('/notifications/send')
    .set('Authorization', 'Bearer t')
    .send({ type: 'SYSTEM', roles: ['HR_ADMIN', 'HR_MANAGER'], data: {} });

  expect(res.status).toBe(201);
  expect(res.body.sent).toBe(2);
  expect(mockCreate.mock.calls[0][0].data.userId).toBe('role:HR_ADMIN');
  expect(mockCreate.mock.calls[1][0].data.userId).toBe('role:HR_MANAGER');
});

// ── NS-03 ─────────────────────────────────────────────────────────────────────
test('NS-03 email-only recipients do not create in-app records', async () => {
  setUser({ role: 'HR_ADMIN' });

  const res = await request(app)
    .post('/notifications/send')
    .set('Authorization', 'Bearer t')
    .send({ type: 'SYSTEM', recipients: ['a@co.com', 'b@co.com'], data: {} });

  expect(res.status).toBe(201);
  expect(res.body.sent).toBe(2);
  expect(res.body.inAppIds).toHaveLength(0);
  expect(mockCreate).not.toHaveBeenCalled();
});

// ── NS-04 ─────────────────────────────────────────────────────────────────────
test('NS-04 send returns 400 when type is missing', async () => {
  setUser({ role: 'HR_ADMIN' });

  const res = await request(app)
    .post('/notifications/send')
    .set('Authorization', 'Bearer t')
    .send({ recipientIds: ['emp-1'] });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/type/i);
});

// ── NS-05 ─────────────────────────────────────────────────────────────────────
test('NS-05 LEAVE_APPROVED template renders correct title and category', async () => {
  setUser({ role: 'HR_ADMIN' });

  await request(app)
    .post('/notifications/send')
    .set('Authorization', 'Bearer t')
    .send({
      type: 'LEAVE_APPROVED',
      recipientIds: ['emp-1'],
      data: { leaveType: 'Annual Leave', startDate: '2026-06-01', endDate: '2026-06-05' },
    });

  const created = mockCreate.mock.calls[0][0].data;
  expect(created.title).toMatch(/approved/i);
  expect(created.category).toBe('LEAVE');
  expect(created.body).toContain('Annual Leave');
});

// ── NS-06 ─────────────────────────────────────────────────────────────────────
test('NS-06 ONBOARDING_INCOMPLETE_ALERT template includes employee name and count', async () => {
  setUser({ role: 'HR_ADMIN' });

  await request(app)
    .post('/notifications/send')
    .set('Authorization', 'Bearer t')
    .send({
      type: 'ONBOARDING_INCOMPLETE_ALERT',
      roles: ['HR_ADMIN'],
      data: {
        employeeName: 'Alice Tan',
        daysUntilStart: 3,
        startDate: '2026-05-29',
        incompleteTasks: 2,
        totalTasks: 5,
        pendingTaskNames: ['Sign contract', 'IT setup'],
      },
    });

  const created = mockCreate.mock.calls[0][0].data;
  expect(created.title).toContain('Alice Tan');
  expect(created.title).toContain('3');
  expect(created.category).toBe('ONBOARDING');
  expect(created.userId).toBe('role:HR_ADMIN');
});

// ── NS-07 ─────────────────────────────────────────────────────────────────────
test('NS-07 unknown type falls back to SYSTEM template', async () => {
  setUser({ role: 'HR_ADMIN' });

  await request(app)
    .post('/notifications/send')
    .set('Authorization', 'Bearer t')
    .send({
      type: 'TOTALLY_UNKNOWN_EVENT',
      recipientIds: ['emp-1'],
      data: { title: 'Custom title', body: 'Custom body' },
    });

  const created = mockCreate.mock.calls[0][0].data;
  expect(created.category).toBe('SYSTEM');
  expect(created.title).toBe('Custom title');
});

// ── NS-08 ─────────────────────────────────────────────────────────────────────
test('NS-08 GET /me returns own + role-broadcast notifications', async () => {
  setUser({ sub: 'user-001', role: 'HR_ADMIN' });

  const own       = makeNotif({ userId: 'user-001' });
  const broadcast = makeNotif({ id: 'n-002', userId: 'role:HR_ADMIN' });
  mockFindMany.mockResolvedValue([broadcast, own]);

  const res = await request(app)
    .get('/notifications/me')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(2);

  const queryWhere = mockFindMany.mock.calls[0][0].where;
  expect(queryWhere.userId.in).toContain('user-001');
  expect(queryWhere.userId.in).toContain('role:HR_ADMIN');
});

// ── NS-09 ─────────────────────────────────────────────────────────────────────
test('NS-09 GET /me?unread=true adds isRead:false filter', async () => {
  setUser({ sub: 'user-001', role: 'HR_ADMIN' });
  mockFindMany.mockResolvedValue([makeNotif({ isRead: false })]);

  const res = await request(app)
    .get('/notifications/me?unread=true')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  const queryWhere = mockFindMany.mock.calls[0][0].where;
  expect(queryWhere.isRead).toBe(false);
});

// ── NS-10 ─────────────────────────────────────────────────────────────────────
test('NS-10 GET /me?limit=200 is capped to 100', async () => {
  setUser({ sub: 'user-001', role: 'HR_ADMIN' });

  await request(app)
    .get('/notifications/me?limit=200')
    .set('Authorization', 'Bearer t');

  expect(mockFindMany.mock.calls[0][0].take).toBe(100);
});

// ── NS-11 ─────────────────────────────────────────────────────────────────────
test('NS-11 GET /me/unread-count returns count object', async () => {
  setUser({ sub: 'user-001', role: 'HR_ADMIN' });
  mockCount.mockResolvedValue(7);

  const res = await request(app)
    .get('/notifications/me/unread-count')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body.count).toBe(7);

  const where = mockCount.mock.calls[0][0].where;
  expect(where.userId.in).toContain('user-001');
  expect(where.userId.in).toContain('role:HR_ADMIN');
  expect(where.isRead).toBe(false);
});

// ── NS-12 ─────────────────────────────────────────────────────────────────────
test('NS-12 PUT /me/read-all marks unread as read for user + role', async () => {
  setUser({ sub: 'user-001', role: 'HR_ADMIN' });
  mockUpdateMany.mockResolvedValue({ count: 5 });

  const res = await request(app)
    .put('/notifications/me/read-all')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body.updated).toBe(5);

  const where = mockUpdateMany.mock.calls[0][0].where;
  expect(where.userId.in).toContain('user-001');
  expect(where.userId.in).toContain('role:HR_ADMIN');
  expect(where.isRead).toBe(false);
  expect(mockUpdateMany.mock.calls[0][0].data.isRead).toBe(true);
});

// ── NS-13 ─────────────────────────────────────────────────────────────────────
test('NS-13 PUT /:id/read marks single notification as read', async () => {
  // H-04: PUT /:id/read now uses updateMany scoped by userId, then findUnique
  // for the response shape. HR_ADMIN bypasses the userId scope (admin allowlist).
  setUser({ sub: 'user-001', role: 'HR_ADMIN' });
  mockUpdateMany.mockResolvedValueOnce({ count: 1 });
  mockFindUnique.mockResolvedValueOnce({ id: 'notif-abc', isRead: true, readAt: new Date() });

  const res = await request(app)
    .put('/notifications/notif-abc/read')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ id: 'notif-abc' }),
    data:  expect.objectContaining({ isRead: true }),
  }));
});

// ── NS-14 ─────────────────────────────────────────────────────────────────────
test('NS-14 GET /me/all alias returns notifications', async () => {
  setUser({ sub: 'user-001', role: 'HR_ADMIN' });
  mockFindMany.mockResolvedValue([makeNotif()]);

  const res = await request(app)
    .get('/notifications/me/all')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
});

// ── NS-15 ─────────────────────────────────────────────────────────────────────
test('NS-15 POST /in-app creates notification record', async () => {
  setUser({ role: 'HR_ADMIN' });

  const res = await request(app)
    .post('/notifications/in-app')
    .set('Authorization', 'Bearer t')
    .send({ userId: 'emp-5', title: 'Hi', body: 'Hello there', category: 'SYSTEM' });

  expect(res.status).toBe(201);
  expect(mockCreate.mock.calls[0][0].data.userId).toBe('emp-5');
  expect(mockCreate.mock.calls[0][0].data.type).toBe('IN_APP');
});

// ── NS-16 ─────────────────────────────────────────────────────────────────────
test('NS-16 POST /in-app returns 400 when required fields missing', async () => {
  setUser({ role: 'HR_ADMIN' });

  const res = await request(app)
    .post('/notifications/in-app')
    .set('Authorization', 'Bearer t')
    .send({ userId: 'emp-5' }); // missing title + body

  expect(res.status).toBe(400);
});

// ── NS-17 ─────────────────────────────────────────────────────────────────────
test('NS-17 POST /email legacy plain-email call accepted', async () => {
  setUser({ role: 'HR_ADMIN' });

  const res = await request(app)
    .post('/notifications/email')
    .set('Authorization', 'Bearer t')
    .send({ to: 'user@co.com', subject: 'Hello', html: '<p>Hi</p>' });

  expect(res.status).toBe(200);
  expect(res.body.message).toMatch(/sent/i);
});

// ── NS-18 ─────────────────────────────────────────────────────────────────────
test('NS-18 POST /email structured call stores role in-app records', async () => {
  setUser({ role: 'HR_ADMIN' });

  const res = await request(app)
    .post('/notifications/email')
    .set('Authorization', 'Bearer t')
    .send({
      type: 'LEAVE_PENDING_APPROVAL',
      roles: ['HR_ADMIN'],
      recipients: ['hr@co.com'],
      data: { employeeName: 'Bob', leaveType: 'MC', startDate: '2026-06-10', endDate: '2026-06-11' },
    });

  expect(res.status).toBe(200);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCreate.mock.calls[0][0].data.userId).toBe('role:HR_ADMIN');
  expect(res.body.roles).toBe(1);
});

// ── NS-19 ─────────────────────────────────────────────────────────────────────
test('NS-19 GET /notifications/:userId legacy lookup', async () => {
  setUser({ sub: 'admin', role: 'HR_ADMIN' });
  mockFindMany.mockResolvedValue([makeNotif({ userId: 'emp-7' })]);

  const res = await request(app)
    .get('/notifications/emp-7')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(mockFindMany.mock.calls[0][0].where.userId).toBe('emp-7');
});

// ── NS-20 ─────────────────────────────────────────────────────────────────────
test('NS-20 GET /notifications/me returns empty array when no records', async () => {
  setUser({ sub: 'new-user', role: 'EMPLOYEE' });
  mockFindMany.mockResolvedValue([]);

  const res = await request(app)
    .get('/notifications/me')
    .set('Authorization', 'Bearer t');

  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

// ── NS-21..23  PUT /notifications/smtp-config host validation ───────────────────
// Regression: a UI save of host=127.0.0.1 silently broke ALL outbound mail
// (login OTPs + password resets) until the next restart, with no error shown.
describe('PUT /notifications/smtp-config — host validation', () => {
  test('NS-21 rejects a loopback host with 400 and does not change config', async () => {
    setUser({ role: 'IT_ADMIN' });
    for (const host of ['127.0.0.1', 'localhost', '0.0.0.0', '::1']) {
      const res = await request(app)
        .put('/notifications/smtp-config')
        .set('Authorization', 'Bearer t')
        .send({ host });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/loopback|reachable mail server/i);
    }
  });

  test('NS-22 rejects an empty host with 400', async () => {
    setUser({ role: 'IT_ADMIN' });
    const res = await request(app)
      .put('/notifications/smtp-config')
      .set('Authorization', 'Bearer t')
      .send({ host: '   ' });
    expect(res.status).toBe(400);
  });

  test('NS-23 accepts a real SMTP host', async () => {
    setUser({ role: 'IT_ADMIN' });
    const res = await request(app)
      .put('/notifications/smtp-config')
      .set('Authorization', 'Bearer t')
      .send({ host: 'smtp.titan.email', port: 587 });
    expect(res.status).toBe(200);
    expect(res.body.host).toBe('smtp.titan.email');
  });
});
