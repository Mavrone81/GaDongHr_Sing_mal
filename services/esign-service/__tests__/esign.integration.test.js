'use strict';
/**
 * Integration tests: ESV-003 — E-Signature & Document Acknowledgement
 *
 * ED-01  POST /esign/documents — HR creates template → 201 with placeholders
 * ED-02  POST /esign/documents — 400 when templateHtml missing
 * ED-03  POST /esign/documents — 409 duplicate code
 * ED-04  GET  /esign/documents — HR lists active templates
 * ED-05  PUT  /esign/documents/:id — HR updates template → 200
 * ER-01  POST /esign/requests — HR dispatches to single signatory → 201
 * ER-02  POST /esign/requests — skips already-PENDING signatory
 * ER-03  POST /esign/requests — 400 when signatoryIds is empty
 * ER-04  GET  /esign/requests — employee sees only own (no personalizedHtml)
 * ER-05  GET  /esign/requests — HR sees all with summary
 * ER-06  GET  /esign/requests/:id — first view records viewedAt
 * ER-07  GET  /esign/requests/:id — 403 when fetching another's request
 * ES-01  PUT  /esign/requests/:id/sign — employee signs → 200 with hash
 * ES-02  PUT  /esign/requests/:id/sign — 400 when signatoryName missing
 * ES-03  PUT  /esign/requests/:id/sign — 409 when already SIGNED
 * ES-04  PUT  /esign/requests/:id/sign — 409 when expired
 * ES-05  PUT  /esign/requests/:id/sign — 403 when signing another's request
 * ED-06  PUT  /esign/requests/:id/decline — 400 when declineReason missing
 * ED-07  PUT  /esign/requests/:id/decline — employee declines → 200
 * EV-01  PUT  /esign/requests/:id/revoke — HR revokes PENDING → 200
 * EV-02  PUT  /esign/requests/:id/revoke — 409 when already SIGNED
 * EA-01  GET  /esign/requests/:id/audit — HR sees audit trail
 * DB-01  GET  /esign/dashboard — HR gets compliance summary
 * SW-01  POST /esign/sweep — expires overdue PENDING requests
 * SW-02  POST /esign/sweep — EMPLOYEE gets 403
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
const mockDocCreate     = jest.fn();
const mockDocFindUnique = jest.fn();
const mockDocFindMany   = jest.fn();
const mockDocUpdate     = jest.fn();
const mockReqCreate     = jest.fn();
const mockReqFindUnique = jest.fn();
const mockReqFindMany   = jest.fn();
const mockReqFindFirst  = jest.fn();
const mockReqUpdate     = jest.fn();
const mockAuditCreate   = jest.fn();
const mockAuditFindMany = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    eSignDocument: { create: mockDocCreate, findUnique: mockDocFindUnique, findMany: mockDocFindMany, update: mockDocUpdate },
    eSignRequest:  { create: mockReqCreate, findUnique: mockReqFindUnique, findMany: mockReqFindMany, findFirst: mockReqFindFirst, update: mockReqUpdate },
    eSignAuditLog: { create: mockAuditCreate.mockResolvedValue({}), findMany: mockAuditFindMany },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

const request = require('supertest');
const app     = require('../src/index');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeDoc(overrides = {}) {
  return {
    id: 'doc-001', code: 'HANDBOOK', title: 'Employee Handbook',
    description: 'Company handbook', documentType: 'POLICY_ACKNOWLEDGEMENT',
    templateHtml: '<h1>Employee Handbook</h1><p>Dear {{name}},</p>',
    version: '1.0', isActive: true, annualRenewal: true, expiresInDays: 30,
    createdBy: 'hr-001', updatedBy: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequest(overrides = {}) {
  return {
    id: 'req-001', documentId: 'doc-001', documentVersion: '1.0',
    documentHash: 'abc123', signatoryId: 'emp-001', requestedById: 'hr-001',
    title: 'Employee Handbook — emp-001',
    personalizedHtml: '<h1>Employee Handbook</h1><p>Dear emp-001,</p>',
    status: 'PENDING', dueDate: new Date(Date.now() + 7 * 86_400_000),
    message: null, viewedAt: null, signedAt: null, signatoryIp: null,
    signedDocHash: null, signatureStatement: null, declineReason: null,
    revokedAt: null, revokedById: null, remindersSent: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'emp-001', role: 'EMPLOYEE' });
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  mockAuditCreate.mockResolvedValue({});
});

// ── ED-01 ─────────────────────────────────────────────────────────────────────
test('ED-01 POST /esign/documents — HR creates template → 201', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockDocCreate.mockResolvedValue(makeDoc());

  const res = await request(app)
    .post('/esign/documents')
    .send({ code: 'HANDBOOK', title: 'Employee Handbook', documentType: 'POLICY_ACKNOWLEDGEMENT', templateHtml: '<h1>Dear {{name}}</h1>' });

  expect(res.status).toBe(201);
  expect(res.body.code).toBe('HANDBOOK');
  expect(res.body.placeholders).toBeDefined();
});

// ── ED-02 ─────────────────────────────────────────────────────────────────────
test('ED-02 POST /esign/documents — 400 when templateHtml missing', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });

  const res = await request(app)
    .post('/esign/documents')
    .send({ code: 'TEST', title: 'Test Doc', documentType: 'CUSTOM' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/templateHtml/i);
});

// ── ED-03 ─────────────────────────────────────────────────────────────────────
test('ED-03 POST /esign/documents — 409 when code already exists', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockDocCreate.mockRejectedValue({ code: 'P2002' });

  const res = await request(app)
    .post('/esign/documents')
    .send({ code: 'HANDBOOK', title: 'Handbook', documentType: 'POLICY_ACKNOWLEDGEMENT', templateHtml: '<p>test</p>' });

  expect(res.status).toBe(409);
});

// ── ED-04 ─────────────────────────────────────────────────────────────────────
test('ED-04 GET /esign/documents — HR lists active templates', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockDocFindMany.mockResolvedValue([makeDoc()]);

  const res = await request(app).get('/esign/documents');

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
  const where = mockDocFindMany.mock.calls[0][0].where;
  expect(where.isActive).toBe(true);
});

// ── ED-05 ─────────────────────────────────────────────────────────────────────
test('ED-05 PUT /esign/documents/:id — HR updates template → 200', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockDocFindUnique.mockResolvedValue(makeDoc());
  mockDocUpdate.mockResolvedValue(makeDoc({ title: 'Updated Handbook', version: '1.1' }));

  const res = await request(app)
    .put('/esign/documents/doc-001')
    .send({ title: 'Updated Handbook', version: '1.1' });

  expect(res.status).toBe(200);
  expect(res.body.title).toBe('Updated Handbook');
});

// ── ER-01 ─────────────────────────────────────────────────────────────────────
test('ER-01 POST /esign/requests — HR dispatches → 201', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockDocFindUnique.mockResolvedValue(makeDoc());
  mockReqFindFirst.mockResolvedValue(null); // not already pending
  mockReqCreate.mockResolvedValue(makeRequest());

  const res = await request(app)
    .post('/esign/requests')
    .send({ documentId: 'doc-001', signatoryIds: ['emp-001'], variables: { name: 'Alice Tan' } });

  expect(res.status).toBe(201);
  expect(res.body.created).toBe(1);
  expect(res.body.skipped).toBe(0);
  expect(mockReqCreate).toHaveBeenCalledTimes(1);
});

// ── ER-02 ─────────────────────────────────────────────────────────────────────
test('ER-02 POST /esign/requests — skips already-PENDING signatory', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockDocFindUnique.mockResolvedValue(makeDoc());
  mockReqFindFirst.mockResolvedValue(makeRequest({ status: 'PENDING' }));

  const res = await request(app)
    .post('/esign/requests')
    .send({ documentId: 'doc-001', signatoryIds: ['emp-001'] });

  expect(res.status).toBe(201);
  expect(res.body.created).toBe(0);
  expect(res.body.skipped).toBe(1);
  expect(mockReqCreate).not.toHaveBeenCalled();
});

// ── ER-03 ─────────────────────────────────────────────────────────────────────
test('ER-03 POST /esign/requests — 400 when signatoryIds empty', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });

  const res = await request(app)
    .post('/esign/requests')
    .send({ documentId: 'doc-001', signatoryIds: [] });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/signatoryIds/i);
});

// ── ER-04 ─────────────────────────────────────────────────────────────────────
test('ER-04 GET /esign/requests — employee sees only own (no personalizedHtml in list)', async () => {
  mockReqFindMany.mockResolvedValue([makeRequest()]);

  const res = await request(app).get('/esign/requests');

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
  // Verify the where clause scoped to the employee
  const where = mockReqFindMany.mock.calls[0][0].where;
  expect(where.signatoryId).toBe('emp-001');
  // personalizedHtml not in list response (select excludes it)
  expect(res.body.requests[0]).not.toHaveProperty('personalizedHtml');
});

// ── ER-05 ─────────────────────────────────────────────────────────────────────
test('ER-05 GET /esign/requests — HR sees all with summary', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockReqFindMany.mockResolvedValue([makeRequest(), makeRequest({ id: 'req-002', signatoryId: 'emp-002', status: 'SIGNED' })]);

  const res = await request(app).get('/esign/requests');

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(2);
  expect(res.body.summary).toBeDefined();
  expect(res.body.summary.complianceRate).toBe(50);
});

// ── ER-06 ─────────────────────────────────────────────────────────────────────
test('ER-06 GET /esign/requests/:id — first view records viewedAt', async () => {
  mockReqFindUnique.mockResolvedValue(makeRequest({ viewedAt: null }));
  mockReqUpdate.mockResolvedValue(makeRequest({ viewedAt: new Date() }));

  const res = await request(app).get('/esign/requests/req-001');

  expect(res.status).toBe(200);
  expect(mockReqUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'req-001' }, data: expect.objectContaining({ viewedAt: expect.any(Date) }) })
  );
});

// ── ER-07 ─────────────────────────────────────────────────────────────────────
test('ER-07 GET /esign/requests/:id — 403 when fetching another\'s request', async () => {
  setUser({ sub: 'emp-999', role: 'EMPLOYEE' });
  mockReqFindUnique.mockResolvedValue(makeRequest({ signatoryId: 'emp-001' }));

  const res = await request(app).get('/esign/requests/req-001');
  expect(res.status).toBe(403);
});

// ── ES-01 ─────────────────────────────────────────────────────────────────────
test('ES-01 PUT /esign/requests/:id/sign — employee signs → 200 with hash', async () => {
  mockReqFindUnique.mockResolvedValue(makeRequest());
  mockReqUpdate.mockResolvedValue(makeRequest({ status: 'SIGNED', signedAt: new Date(), signedDocHash: 'def456' }));

  const res = await request(app)
    .put('/esign/requests/req-001/sign')
    .send({ signatoryName: 'Alice Tan' });

  expect(res.status).toBe(200);
  expect(res.body.status).toBe('SIGNED');
  expect(res.body.signedDocHash).toBeDefined();
});

// ── ES-02 ─────────────────────────────────────────────────────────────────────
test('ES-02 PUT /esign/requests/:id/sign — 400 when signatoryName missing', async () => {
  const res = await request(app)
    .put('/esign/requests/req-001/sign')
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/signatoryName/i);
});

// ── ES-03 ─────────────────────────────────────────────────────────────────────
test('ES-03 PUT /esign/requests/:id/sign — 409 when already SIGNED', async () => {
  mockReqFindUnique.mockResolvedValue(makeRequest({ status: 'SIGNED' }));

  const res = await request(app)
    .put('/esign/requests/req-001/sign')
    .send({ signatoryName: 'Alice Tan' });

  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/SIGNED/);
});

// ── ES-04 ─────────────────────────────────────────────────────────────────────
test('ES-04 PUT /esign/requests/:id/sign — 409 when request is expired', async () => {
  mockReqFindUnique.mockResolvedValue(makeRequest({ dueDate: new Date(Date.now() - 86_400_000) }));

  const res = await request(app)
    .put('/esign/requests/req-001/sign')
    .send({ signatoryName: 'Alice Tan' });

  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/expired/i);
});

// ── ES-05 ─────────────────────────────────────────────────────────────────────
test('ES-05 PUT /esign/requests/:id/sign — 403 when signing another\'s request', async () => {
  setUser({ sub: 'emp-999', role: 'EMPLOYEE' });
  mockReqFindUnique.mockResolvedValue(makeRequest({ signatoryId: 'emp-001' }));

  const res = await request(app)
    .put('/esign/requests/req-001/sign')
    .send({ signatoryName: 'Imposter' });

  expect(res.status).toBe(403);
});

// ── ED-06 ─────────────────────────────────────────────────────────────────────
test('ED-06 PUT /esign/requests/:id/decline — 400 when declineReason missing', async () => {
  const res = await request(app)
    .put('/esign/requests/req-001/decline')
    .send({});

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/declineReason/i);
});

// ── ED-07 ─────────────────────────────────────────────────────────────────────
test('ED-07 PUT /esign/requests/:id/decline — employee declines → 200', async () => {
  mockReqFindUnique.mockResolvedValue(makeRequest());
  mockReqUpdate.mockResolvedValue(makeRequest({ status: 'DECLINED', declineReason: 'Need clarification' }));

  const res = await request(app)
    .put('/esign/requests/req-001/decline')
    .send({ declineReason: 'Need clarification from HR' });

  expect(res.status).toBe(200);
  expect(res.body.status).toBe('DECLINED');
});

// ── EV-01 ─────────────────────────────────────────────────────────────────────
test('EV-01 PUT /esign/requests/:id/revoke — HR revokes PENDING → 200', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockReqFindUnique.mockResolvedValue(makeRequest());
  mockReqUpdate.mockResolvedValue(makeRequest({ status: 'REVOKED', revokedAt: new Date(), revokedById: 'hr-001' }));

  const res = await request(app).put('/esign/requests/req-001/revoke');

  expect(res.status).toBe(200);
  expect(res.body.status).toBe('REVOKED');
});

// ── EV-02 ─────────────────────────────────────────────────────────────────────
test('EV-02 PUT /esign/requests/:id/revoke — 409 when already SIGNED', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockReqFindUnique.mockResolvedValue(makeRequest({ status: 'SIGNED' }));

  const res = await request(app).put('/esign/requests/req-001/revoke');
  expect(res.status).toBe(409);
});

// ── EA-01 ─────────────────────────────────────────────────────────────────────
test('EA-01 GET /esign/requests/:id/audit — HR sees audit trail', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockReqFindUnique.mockResolvedValue(makeRequest());
  mockAuditFindMany.mockResolvedValue([
    { id: 'au-1', requestId: 'req-001', action: 'CREATED', actorId: 'hr-001', timestamp: new Date() },
    { id: 'au-2', requestId: 'req-001', action: 'VIEWED',  actorId: 'emp-001', timestamp: new Date() },
  ]);

  const res = await request(app).get('/esign/requests/req-001/audit');

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(2);
  expect(res.body.entries[0].action).toBe('CREATED');
});

// ── DB-01 ─────────────────────────────────────────────────────────────────────
test('DB-01 GET /esign/dashboard — HR gets compliance summary', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockReqFindMany.mockResolvedValue([
    makeRequest({ status: 'SIGNED' }),
    makeRequest({ id: 'req-002', signatoryId: 'emp-002', status: 'PENDING' }),
  ]);
  mockDocFindMany.mockResolvedValue([makeDoc()]);

  const res = await request(app).get('/esign/dashboard');

  expect(res.status).toBe(200);
  expect(res.body.summary).toBeDefined();
  expect(res.body.summary.total).toBe(2);
  expect(res.body.byDocument).toBeInstanceOf(Array);
});

// ── SW-01 ─────────────────────────────────────────────────────────────────────
test('SW-01 POST /esign/sweep — expires overdue PENDING requests', async () => {
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  const overdue  = makeRequest({ dueDate: new Date(Date.now() - 86_400_000) });
  const upcoming = makeRequest({ id: 'req-002', dueDate: new Date(Date.now() + 7 * 86_400_000) });
  mockReqFindMany.mockResolvedValue([overdue, upcoming]);
  mockReqUpdate.mockResolvedValue({ ...overdue, status: 'EXPIRED' });

  const res = await request(app).post('/esign/sweep');

  expect(res.status).toBe(200);
  expect(res.body.checked).toBe(2);
  expect(res.body.expired).toBe(1);
  expect(mockReqUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: overdue.id }, data: { status: 'EXPIRED' } })
  );
});

// ── SW-02 ─────────────────────────────────────────────────────────────────────
test('SW-02 POST /esign/sweep — EMPLOYEE gets 403', async () => {
  const res = await request(app).post('/esign/sweep');
  expect(res.status).toBe(403);
});
