'use strict';
/**
 * SUP-004 — Self-Service FAQ integration tests.
 *
 *   F1  GET  /support/faqs — published only, ordered by displayOrder
 *   F2  GET  /support/faqs?category=LEAVE — category filter
 *   F3  GET  /support/faqs?category=BOGUS — 400
 *   F4  GET  /support/faqs?search=payslip — keyword OR match on question/answer
 *   F5  GET  /support/faqs/:id — returns entry + increments viewCount
 *   F6  GET  /support/faqs/:id — 404 when not found
 *   F7  GET  /support/faqs/:id — 404 for unpublished if employee
 *   F8  GET  /support/faqs/:id — admin can see unpublished
 *   F9  POST /support/faqs/:id/feedback wasHelpful=true increments helpfulCount
 *   F10 POST /support/faqs/:id/feedback wasHelpful=false increments notHelpfulCount
 *   F11 POST /support/faqs/:id/feedback rejects non-boolean
 *   F12 GET  /support/faqs/admin/all — admin only (403 for employee)
 *   F13 POST /support/faqs — admin creates entry
 *   F14 POST /support/faqs — rejects bad category
 *   F15 POST /support/faqs — rejects missing question/answer
 *   F16 PUT  /support/faqs/:id — admin edits entry
 *   F17 PUT  /support/faqs/:id — 404 when not found
 *   F18 DELETE /support/faqs/:id — soft-deletes (isPublished=false)
 *   F19 POST /support/faqs/seed — idempotent — creates only missing entries
 *   F20 POST /support/faqs — 403 for non-admin (regression)
 */

const request = require('supertest');

// ── Auth mock ─────────────────────────────────────────────────────────────────
let mockCurrentUser = { sub: 'user-hr', role: 'HR_ADMIN', email: 'hr@test.com', employeeId: 'emp-hr', name: 'HR User' };
const setUser = u => { mockCurrentUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockCurrentUser; next(); },
  authorize: (...allowedRoles) => (_req, res, next) => {
    if (!allowedRoles.includes(mockCurrentUser.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN',
    MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockDb = {
  ticket: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
  ticketMessage: { create: jest.fn() },
  faqEntry: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn().mockImplementation(() => mockDb) }));

const app = require('../src/index');

const FAQ = {
  id: 'faq-1',
  question: 'How do I view my payslip?',
  answer: 'Self-Service → My Payslips',
  category: 'PAYROLL',
  isPublished: true,
  displayOrder: 1,
  viewCount: 0, helpfulCount: 0, notHelpfulCount: 0,
  createdBy: 'user-hr', updatedBy: null,
  createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'user-hr', role: 'HR_ADMIN', email: 'hr@test.com', employeeId: 'emp-hr', name: 'HR User' });
});

// ── F1 ────────────────────────────────────────────────────────────────────────
test('F1 — GET /support/faqs returns published list ordered by displayOrder', async () => {
  mockDb.faqEntry.findMany.mockResolvedValueOnce([FAQ]);
  const r = await request(app).get('/support/faqs');
  expect(r.status).toBe(200);
  expect(r.body).toHaveLength(1);
  const call = mockDb.faqEntry.findMany.mock.calls[0][0];
  expect(call.where.isPublished).toBe(true);
  expect(call.orderBy[0].displayOrder).toBe('asc');
});

// ── F2 ────────────────────────────────────────────────────────────────────────
test('F2 — category filter applied', async () => {
  mockDb.faqEntry.findMany.mockResolvedValueOnce([FAQ]);
  await request(app).get('/support/faqs?category=LEAVE');
  expect(mockDb.faqEntry.findMany.mock.calls[0][0].where.category).toBe('LEAVE');
});

// ── F3 ────────────────────────────────────────────────────────────────────────
test('F3 — invalid category returns 400', async () => {
  const r = await request(app).get('/support/faqs?category=BOGUS');
  expect(r.status).toBe(400);
});

// ── F4 ────────────────────────────────────────────────────────────────────────
test('F4 — search keyword applies OR on question/answer', async () => {
  mockDb.faqEntry.findMany.mockResolvedValueOnce([FAQ]);
  await request(app).get('/support/faqs?search=payslip');
  const where = mockDb.faqEntry.findMany.mock.calls[0][0].where;
  expect(where.OR).toBeDefined();
  expect(where.OR[0].question.contains).toBe('payslip');
  expect(where.OR[1].answer.contains).toBe('payslip');
});

// ── F5 ────────────────────────────────────────────────────────────────────────
test('F5 — GET /support/faqs/:id returns entry and increments viewCount', async () => {
  mockDb.faqEntry.findUnique.mockResolvedValueOnce(FAQ);
  mockDb.faqEntry.update.mockResolvedValueOnce({ ...FAQ, viewCount: 1 });
  const r = await request(app).get('/support/faqs/faq-1');
  expect(r.status).toBe(200);
  expect(r.body.id).toBe('faq-1');
  // viewCount increment is fire-and-forget but should have been called
  await new Promise(r => setImmediate(r));
  expect(mockDb.faqEntry.update).toHaveBeenCalledWith({
    where: { id: 'faq-1' },
    data: { viewCount: { increment: 1 } },
  });
});

// ── F6 ────────────────────────────────────────────────────────────────────────
test('F6 — GET /support/faqs/:id returns 404 when not found', async () => {
  mockDb.faqEntry.findUnique.mockResolvedValueOnce(null);
  const r = await request(app).get('/support/faqs/missing');
  expect(r.status).toBe(404);
});

// ── F7 ────────────────────────────────────────────────────────────────────────
test('F7 — unpublished FAQ hidden from employees', async () => {
  setUser({ sub: 'emp-1', role: 'EMPLOYEE', employeeId: 'emp-1', name: 'Emp' });
  mockDb.faqEntry.findUnique.mockResolvedValueOnce({ ...FAQ, isPublished: false });
  const r = await request(app).get('/support/faqs/faq-1');
  expect(r.status).toBe(404);
});

// ── F8 ────────────────────────────────────────────────────────────────────────
test('F8 — admin can see unpublished FAQ', async () => {
  mockDb.faqEntry.findUnique.mockResolvedValueOnce({ ...FAQ, isPublished: false });
  mockDb.faqEntry.update.mockResolvedValueOnce({ ...FAQ, isPublished: false, viewCount: 1 });
  const r = await request(app).get('/support/faqs/faq-1');
  expect(r.status).toBe(200);
  expect(r.body.isPublished).toBe(false);
});

// ── F9 ────────────────────────────────────────────────────────────────────────
test('F9 — feedback wasHelpful=true increments helpfulCount', async () => {
  mockDb.faqEntry.findUnique.mockResolvedValueOnce(FAQ);
  mockDb.faqEntry.update.mockResolvedValueOnce({ ...FAQ, helpfulCount: 1 });
  const r = await request(app).post('/support/faqs/faq-1/feedback').send({ wasHelpful: true });
  expect(r.status).toBe(200);
  expect(r.body.helpfulCount).toBe(1);
  expect(mockDb.faqEntry.update.mock.calls[0][0].data).toEqual({ helpfulCount: { increment: 1 } });
});

// ── F10 ───────────────────────────────────────────────────────────────────────
test('F10 — feedback wasHelpful=false increments notHelpfulCount', async () => {
  mockDb.faqEntry.findUnique.mockResolvedValueOnce(FAQ);
  mockDb.faqEntry.update.mockResolvedValueOnce({ ...FAQ, notHelpfulCount: 1 });
  const r = await request(app).post('/support/faqs/faq-1/feedback').send({ wasHelpful: false });
  expect(r.status).toBe(200);
  expect(r.body.notHelpfulCount).toBe(1);
});

// ── F11 ───────────────────────────────────────────────────────────────────────
test('F11 — feedback rejects non-boolean wasHelpful', async () => {
  const r = await request(app).post('/support/faqs/faq-1/feedback').send({ wasHelpful: 'yes' });
  expect(r.status).toBe(400);
});

// ── F12 ───────────────────────────────────────────────────────────────────────
test('F12 — GET /support/faqs/admin/all returns 403 for employee', async () => {
  setUser({ sub: 'emp-1', role: 'EMPLOYEE', employeeId: 'emp-1', name: 'Emp' });
  const r = await request(app).get('/support/faqs/admin/all');
  expect(r.status).toBe(403);
});

// ── F13 ───────────────────────────────────────────────────────────────────────
test('F13 — admin creates FAQ entry', async () => {
  mockDb.faqEntry.create.mockImplementationOnce(({ data }) => Promise.resolve({ id: 'new-1', ...data }));
  const r = await request(app).post('/support/faqs').send({
    question: 'New Q?', answer: 'New A.', category: 'LEAVE', displayOrder: 5,
  });
  expect(r.status).toBe(201);
  expect(r.body.question).toBe('New Q?');
  expect(r.body.category).toBe('LEAVE');
  expect(r.body.createdBy).toBe('user-hr');
});

// ── F14 ───────────────────────────────────────────────────────────────────────
test('F14 — create rejects bad category', async () => {
  const r = await request(app).post('/support/faqs').send({ question: 'Q', answer: 'A', category: 'NOPE' });
  expect(r.status).toBe(400);
});

// ── F15 ───────────────────────────────────────────────────────────────────────
test('F15 — create rejects missing question or answer', async () => {
  const r1 = await request(app).post('/support/faqs').send({ answer: 'A' });
  expect(r1.status).toBe(400);
  const r2 = await request(app).post('/support/faqs').send({ question: 'Q' });
  expect(r2.status).toBe(400);
});

// ── F16 ───────────────────────────────────────────────────────────────────────
test('F16 — admin edits FAQ entry', async () => {
  mockDb.faqEntry.update.mockImplementationOnce(({ data }) => Promise.resolve({ id: 'faq-1', ...FAQ, ...data }));
  const r = await request(app).put('/support/faqs/faq-1').send({ answer: 'Updated answer', displayOrder: 9 });
  expect(r.status).toBe(200);
  expect(r.body.answer).toBe('Updated answer');
  expect(r.body.updatedBy).toBe('user-hr');
});

// ── F17 ───────────────────────────────────────────────────────────────────────
test('F17 — PUT 404 when not found', async () => {
  mockDb.faqEntry.update.mockRejectedValueOnce({ code: 'P2025' });
  const r = await request(app).put('/support/faqs/missing').send({ answer: 'X' });
  expect(r.status).toBe(404);
});

// ── F18 ───────────────────────────────────────────────────────────────────────
test('F18 — DELETE soft-deletes (isPublished=false)', async () => {
  mockDb.faqEntry.update.mockResolvedValueOnce({ ...FAQ, isPublished: false });
  const r = await request(app).delete('/support/faqs/faq-1');
  expect(r.status).toBe(200);
  expect(mockDb.faqEntry.update.mock.calls[0][0].data.isPublished).toBe(false);
});

// ── F19 ───────────────────────────────────────────────────────────────────────
test('F19 — POST /support/faqs/seed is idempotent', async () => {
  // First seed call: 1 already exists, 5 are new
  mockDb.faqEntry.findFirst
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: 'pre-2' }) // 2nd seed already exists
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);
  mockDb.faqEntry.create.mockImplementation(({ data }) => Promise.resolve({ id: `seed-${data.displayOrder}`, ...data }));

  const r = await request(app).post('/support/faqs/seed');
  expect(r.status).toBe(200);
  expect(r.body.seedTotal).toBe(6);
  expect(r.body.created).toBe(5);
  expect(r.body.skipped).toBe(1);
});

// ── F20 ───────────────────────────────────────────────────────────────────────
test('F20 — POST /support/faqs returns 403 for employee', async () => {
  setUser({ sub: 'emp-1', role: 'EMPLOYEE', employeeId: 'emp-1', name: 'Emp' });
  const r = await request(app).post('/support/faqs').send({ question: 'Q', answer: 'A' });
  expect(r.status).toBe(403);
});
