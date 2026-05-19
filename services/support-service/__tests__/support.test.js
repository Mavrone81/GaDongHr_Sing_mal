'use strict';

const request = require('supertest');

// ── Mocks ─────────────────────────────────────────────────────────────────────
let mockCurrentUser = { sub: 'user-hr', role: 'HR_ADMIN', email: 'hr@test.com', employeeId: 'emp-hr', name: 'HR User' };
const setUser = u => { mockCurrentUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockCurrentUser; next(); },
  authorize: (...allowedRoles) => (req, res, next) => {
    if (!allowedRoles.includes(mockCurrentUser.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN',
    MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

const mockDb = {
  ticket: {
    create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    update: jest.fn(), count: jest.fn(),
  },
  ticketMessage: { create: jest.fn() },
  $transaction: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

const app = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const TICKET = {
  id: 'tick-001', employeeId: 'emp-001', category: 'LEAVE', subject: 'Leave balance wrong',
  status: 'OPEN', priority: 'NORMAL', createdAt: new Date(), updatedAt: new Date(),
  messages: [{ id: 'msg-001', ticketId: 'tick-001', authorId: 'user-001', authorRole: 'EMPLOYEE', authorName: 'Alice', body: 'My balance is wrong', createdAt: new Date() }],
};

const MSG = { id: 'msg-002', ticketId: 'tick-001', authorId: 'user-hr', authorRole: 'HR_ADMIN', authorName: 'HR User', body: 'We will look into it', createdAt: new Date() };

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'user-hr', role: 'HR_ADMIN', email: 'hr@test.com', employeeId: 'emp-hr', name: 'HR User' });
});

// ── Health ─────────────────────────────────────────────────────────────────────
describe('GET /health', () => {
  test('200', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.service).toBe('support-service');
  });
});

// ── POST /support/tickets ─────────────────────────────────────────────────────
describe('A) POST /support/tickets', () => {
  test('201 — employee creates ticket', async () => {
    mockDb.ticket.create.mockResolvedValue(TICKET);
    const r = await request(app)
      .post('/support/tickets')
      .set('Authorization', 'Bearer test')
      .send({ subject: 'Leave balance wrong', category: 'LEAVE', body: 'My balance shows 0 but I have 14 days' });
    expect(r.status).toBe(201);
    expect(r.body.id).toBe('tick-001');
    expect(mockDb.ticket.create).toHaveBeenCalledTimes(1);
    const callData = mockDb.ticket.create.mock.calls[0][0].data;
    expect(callData.subject).toBe('Leave balance wrong');
    expect(callData.category).toBe('LEAVE');
  });

  test('400 — missing subject', async () => {
    const r = await request(app)
      .post('/support/tickets')
      .set('Authorization', 'Bearer test')
      .send({ body: 'Some body' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/subject/);
  });

  test('400 — missing body', async () => {
    const r = await request(app)
      .post('/support/tickets')
      .set('Authorization', 'Bearer test')
      .send({ subject: 'Subject only' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/body/);
  });

  test('400 — no employeeId on user', async () => {
    setUser({ sub: 'user-no-emp', role: 'EMPLOYEE', email: 'x@test.com', employeeId: null, name: 'No Emp' });
    const r = await request(app)
      .post('/support/tickets')
      .set('Authorization', 'Bearer test')
      .send({ subject: 'Test', body: 'Test body' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/employee/i);
  });
});

// ── GET /support/tickets/my ───────────────────────────────────────────────────
describe('B) GET /support/tickets/my', () => {
  test('200 — returns own tickets', async () => {
    mockDb.ticket.findMany.mockResolvedValue([TICKET]);
    mockDb.ticket.count.mockResolvedValue(1);
    const r = await request(app)
      .get('/support/tickets/my')
      .set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body.tickets).toHaveLength(1);
    expect(r.body.total).toBe(1);
  });

  test('200 — no employeeId returns empty array', async () => {
    setUser({ sub: 'u', role: 'EMPLOYEE', employeeId: null, name: 'No Emp' });
    const r = await request(app).get('/support/tickets/my').set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });
});

// ── GET /support/tickets (admin) ──────────────────────────────────────────────
describe('C) GET /support/tickets', () => {
  test('200 — HR admin sees all tickets', async () => {
    mockDb.ticket.findMany.mockResolvedValue([TICKET]);
    mockDb.ticket.count.mockResolvedValue(1);
    const r = await request(app)
      .get('/support/tickets')
      .set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body.tickets).toHaveLength(1);
  });

  test('403 — employee cannot access admin list', async () => {
    setUser({ sub: 'emp-u', role: 'EMPLOYEE', employeeId: 'emp-001', name: 'Emp' });
    const r = await request(app)
      .get('/support/tickets')
      .set('Authorization', 'Bearer test');
    expect(r.status).toBe(403);
  });
});

// ── GET /support/tickets/:id ──────────────────────────────────────────────────
describe('D) GET /support/tickets/:id', () => {
  test('200 — HR admin can view any ticket', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(TICKET);
    const r = await request(app)
      .get('/support/tickets/tick-001')
      .set('Authorization', 'Bearer test');
    expect(r.status).toBe(200);
    expect(r.body.id).toBe('tick-001');
  });

  test('404 — ticket not found', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(null);
    const r = await request(app)
      .get('/support/tickets/nonexistent')
      .set('Authorization', 'Bearer test');
    expect(r.status).toBe(404);
  });

  test('403 — employee cannot view another employee ticket', async () => {
    setUser({ sub: 'other-user', role: 'EMPLOYEE', employeeId: 'emp-other', name: 'Other' });
    mockDb.ticket.findUnique.mockResolvedValue(TICKET); // employeeId: emp-001, not emp-other
    const r = await request(app)
      .get('/support/tickets/tick-001')
      .set('Authorization', 'Bearer test');
    expect(r.status).toBe(403);
  });
});

// ── POST /support/tickets/:id/messages ────────────────────────────────────────
describe('E) POST /support/tickets/:id/messages', () => {
  test('201 — HR admin adds reply', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(TICKET);
    mockDb.$transaction.mockResolvedValue([MSG, {}]);
    const r = await request(app)
      .post('/support/tickets/tick-001/messages')
      .set('Authorization', 'Bearer test')
      .send({ body: 'We will look into it' });
    expect(r.status).toBe(201);
    expect(r.body.body).toBe('We will look into it');
  });

  test('400 — missing body', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(TICKET);
    const r = await request(app)
      .post('/support/tickets/tick-001/messages')
      .set('Authorization', 'Bearer test')
      .send({});
    expect(r.status).toBe(400);
  });

  test('400 — cannot reply to closed ticket', async () => {
    mockDb.ticket.findUnique.mockResolvedValue({ ...TICKET, status: 'CLOSED' });
    const r = await request(app)
      .post('/support/tickets/tick-001/messages')
      .set('Authorization', 'Bearer test')
      .send({ body: 'Re-open please' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/closed/i);
  });

  test('404 — ticket not found', async () => {
    mockDb.ticket.findUnique.mockResolvedValue(null);
    const r = await request(app)
      .post('/support/tickets/bad-id/messages')
      .set('Authorization', 'Bearer test')
      .send({ body: 'Hello' });
    expect(r.status).toBe(404);
  });
});

// ── PUT /support/tickets/:id ──────────────────────────────────────────────────
describe('F) PUT /support/tickets/:id', () => {
  test('200 — HR admin updates status to IN_PROGRESS', async () => {
    mockDb.ticket.update.mockResolvedValue({ ...TICKET, status: 'IN_PROGRESS', messages: TICKET.messages });
    const r = await request(app)
      .put('/support/tickets/tick-001')
      .set('Authorization', 'Bearer test')
      .send({ status: 'IN_PROGRESS' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('IN_PROGRESS');
  });

  test('403 — employee cannot update status', async () => {
    setUser({ sub: 'emp-u', role: 'EMPLOYEE', employeeId: 'emp-001', name: 'Emp' });
    const r = await request(app)
      .put('/support/tickets/tick-001')
      .set('Authorization', 'Bearer test')
      .send({ status: 'CLOSED' });
    expect(r.status).toBe(403);
  });
});
