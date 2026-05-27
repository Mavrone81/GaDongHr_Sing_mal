'use strict';
/**
 * Integration tests: Policy Acknowledgements — REC-004
 *
 * AK-01  POST /seed — creates 4 default policy documents
 * AK-02  POST /seed — idempotent: re-running skips already-existing docs
 * AK-03  GET  /policy-documents — returns active docs only (default)
 * AK-04  GET  /policy-documents?includeInactive=true — returns all docs
 * AK-05  POST /policy-documents — creates doc (HR Admin)
 * AK-06  POST /policy-documents — 403 for EMPLOYEE role
 * AK-07  PUT  /policy-documents/:id — updates title and version
 * AK-08  GET  /:employeeId/acknowledgements — returns pending acks with summary
 * AK-09  POST /:employeeId/acknowledgements/:docId — acknowledges document
 * AK-10  POST /:employeeId/acknowledgements/:docId — 409 when already acknowledged
 * AK-11  POST /:employeeId/acknowledgements/:docId — 404 when record not assigned
 * AK-12  GET  /:employeeId/acknowledgements — allComplete true when all done
 * AK-13  GET  /acknowledgements/pending — HR dashboard shows employees with pending acks
 * AK-14  Candidate approval (POST /candidates/:id/approve) queues acknowledgements
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

const mockPolicyDocFindUnique  = jest.fn();
const mockPolicyDocFindMany    = jest.fn();
const mockPolicyDocCreate      = jest.fn();
const mockPolicyDocUpdate      = jest.fn();
const mockPolicyAckFindUnique  = jest.fn();
const mockPolicyAckFindMany    = jest.fn();
const mockPolicyAckUpdate      = jest.fn();
const mockPolicyAckCreateMany  = jest.fn();

const MCF_POSTED_20D_AGO = (() => { const d = new Date(); d.setDate(d.getDate() - 20); return d; })();

const mockDb = {
  candidate: {
    findUnique: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
  },
  jobPosting: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  candidateStageEvent: { create: jest.fn() },
  onboardingTask: { createMany: jest.fn(), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  interviewRound: { create: jest.fn(), update: jest.fn() },
  workPass: { findMany: jest.fn().mockResolvedValue([]) },
  buddyAssignment: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  policyDocument: {
    findUnique: mockPolicyDocFindUnique,
    findMany:   mockPolicyDocFindMany,
    create:     mockPolicyDocCreate,
    update:     mockPolicyDocUpdate,
  },
  policyAcknowledgement: {
    findUnique:  mockPolicyAckFindUnique,
    findMany:    mockPolicyAckFindMany,
    update:      mockPolicyAckUpdate,
    createMany:  mockPolicyAckCreateMany,
  },
  $transaction: jest.fn(),
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

const DOC_HANDBOOK = {
  id: 'doc-001', code: 'HANDBOOK', title: 'Employee Handbook',
  description: 'Company policies', version: '1.0', isRequired: true, isActive: true,
  documentHash: null, documentUrl: null, createdBy: 'hr-001', updatedBy: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const DOC_HARASSMENT = {
  id: 'doc-002', code: 'HARASSMENT_POLICY', title: 'Harassment Policy',
  description: 'Zero-tolerance policy', version: '1.0', isRequired: true, isActive: true,
  documentHash: null, documentUrl: null, createdBy: 'hr-001', updatedBy: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const DOC_PDPA = {
  id: 'doc-003', code: 'PDPA_CONSENT', title: 'PDPA Consent',
  description: 'Data protection consent', version: '1.0', isRequired: true, isActive: true,
  documentHash: null, documentUrl: null, createdBy: 'hr-001', updatedBy: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const DOC_IT = {
  id: 'doc-004', code: 'IT_ACCEPTABLE_USE', title: 'IT Acceptable Use Policy',
  description: 'IT rules', version: '1.0', isRequired: true, isActive: true,
  documentHash: null, documentUrl: null, createdBy: 'hr-001', updatedBy: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const ALL_DOCS = [DOC_HANDBOOK, DOC_HARASSMENT, DOC_PDPA, DOC_IT];

const EMP_ID = 'emp-newhire-001';

const PENDING_ACK = {
  id: 'ack-001', employeeId: EMP_ID, documentId: 'doc-001',
  status: 'PENDING', acknowledgedAt: null, ipAddress: null, documentHash: null,
  createdAt: new Date(),
  document: { code: 'HANDBOOK', title: 'Employee Handbook', description: 'Company policies', version: '1.0', documentUrl: null },
};
const ACKNOWLEDGED_ACK = {
  ...PENDING_ACK,
  id: 'ack-002', documentId: 'doc-002',
  status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), ipAddress: '127.0.0.1',
  document: { code: 'HARASSMENT_POLICY', title: 'Harassment Policy', description: 'Zero-tolerance', version: '1.0', documentUrl: null },
};

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'hr-001', role: 'HR_ADMIN' });
  mockDb.$transaction.mockImplementation(async ops => { for (const op of ops) await op; return []; });
  mockDb.onboardingTask.createMany.mockResolvedValue({ count: 5 });
  mockDb.onboardingTask.create.mockResolvedValue({});
  mockPolicyAckCreateMany.mockResolvedValue({ count: 4 });
});

// ── AK-01 ─────────────────────────────────────────────────────────────────────
test('AK-01 POST /seed creates 4 default policy documents', async () => {
  // No existing docs → all created
  mockPolicyDocFindUnique.mockResolvedValue(null);
  mockPolicyDocCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'new-' + data.code, ...data }));

  const res = await request(app)
    .post('/recruitment/onboarding/policy-documents/seed')
    .set('Authorization', 'Bearer test')
    .send();

  expect(res.status).toBe(201);
  expect(res.body.created).toBe(4);
  expect(res.body.skipped).toBe(0);
  expect(res.body.total).toBe(4);
  expect(mockPolicyDocCreate).toHaveBeenCalledTimes(4);
});

// ── AK-02 ─────────────────────────────────────────────────────────────────────
test('AK-02 POST /seed is idempotent — existing docs are skipped', async () => {
  // All 4 docs already exist
  mockPolicyDocFindUnique.mockResolvedValue(DOC_HANDBOOK);

  const res = await request(app)
    .post('/recruitment/onboarding/policy-documents/seed')
    .set('Authorization', 'Bearer test')
    .send();

  expect(res.status).toBe(201);
  expect(res.body.created).toBe(0);
  expect(res.body.skipped).toBe(4);
  expect(mockPolicyDocCreate).not.toHaveBeenCalled();
});

// ── AK-03 ─────────────────────────────────────────────────────────────────────
test('AK-03 GET /policy-documents returns active docs only by default', async () => {
  mockPolicyDocFindMany.mockResolvedValue(ALL_DOCS);

  const res = await request(app)
    .get('/recruitment/onboarding/policy-documents')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(4);
  // Verify the query used isActive: true filter
  expect(mockPolicyDocFindMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { isActive: true } })
  );
});

// ── AK-04 ─────────────────────────────────────────────────────────────────────
test('AK-04 GET /policy-documents?includeInactive=true returns all docs', async () => {
  const inactiveDoc = { ...DOC_HANDBOOK, id: 'doc-old', isActive: false };
  mockPolicyDocFindMany.mockResolvedValue([...ALL_DOCS, inactiveDoc]);

  const res = await request(app)
    .get('/recruitment/onboarding/policy-documents?includeInactive=true')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(5);
  expect(mockPolicyDocFindMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: {} })
  );
});

// ── AK-05 ─────────────────────────────────────────────────────────────────────
test('AK-05 POST /policy-documents creates doc (HR Admin)', async () => {
  mockPolicyDocCreate.mockResolvedValue({ ...DOC_HANDBOOK, id: 'doc-new', code: 'CUSTOM_POLICY' });

  const res = await request(app)
    .post('/recruitment/onboarding/policy-documents')
    .set('Authorization', 'Bearer test')
    .send({ code: 'CUSTOM_POLICY', title: 'Custom Policy', description: 'A custom policy doc' });

  expect(res.status).toBe(201);
  expect(res.body.code).toBe('CUSTOM_POLICY');
});

// ── AK-06 ─────────────────────────────────────────────────────────────────────
test('AK-06 POST /policy-documents returns 403 for EMPLOYEE role', async () => {
  setUser({ role: 'EMPLOYEE' });

  const res = await request(app)
    .post('/recruitment/onboarding/policy-documents')
    .set('Authorization', 'Bearer test')
    .send({ code: 'CUSTOM', title: 'Custom' });

  expect(res.status).toBe(403);
});

// ── AK-07 ─────────────────────────────────────────────────────────────────────
test('AK-07 PUT /policy-documents/:id updates title and version', async () => {
  const updated = { ...DOC_HANDBOOK, title: 'Updated Handbook', version: '2.0', updatedBy: 'hr-001' };
  mockPolicyDocUpdate.mockResolvedValue(updated);

  const res = await request(app)
    .put('/recruitment/onboarding/policy-documents/doc-001')
    .set('Authorization', 'Bearer test')
    .send({ title: 'Updated Handbook', version: '2.0' });

  expect(res.status).toBe(200);
  expect(res.body.title).toBe('Updated Handbook');
  expect(res.body.version).toBe('2.0');
  expect(mockPolicyDocUpdate).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'doc-001' }, data: expect.objectContaining({ title: 'Updated Handbook', version: '2.0' }) })
  );
});

// ── AK-08 ─────────────────────────────────────────────────────────────────────
test('AK-08 GET /:employeeId/acknowledgements returns acks with summary', async () => {
  mockPolicyAckFindMany.mockResolvedValue([PENDING_ACK, ACKNOWLEDGED_ACK]);

  const res = await request(app)
    .get(`/recruitment/onboarding/${EMP_ID}/acknowledgements`)
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body.employeeId).toBe(EMP_ID);
  expect(res.body.summary.total).toBe(2);
  expect(res.body.summary.done).toBe(1);
  expect(res.body.summary.pending).toBe(1);
  expect(res.body.summary.allComplete).toBe(false);
  expect(res.body.acknowledgements).toHaveLength(2);
});

// ── AK-09 ─────────────────────────────────────────────────────────────────────
test('AK-09 POST /:employeeId/acknowledgements/:docId acknowledges document', async () => {
  mockPolicyAckFindUnique.mockResolvedValue({ ...PENDING_ACK, document: DOC_HANDBOOK });
  const updatedAck = { ...PENDING_ACK, status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), ipAddress: '::1', document: { code: 'HANDBOOK', title: 'Employee Handbook', version: '1.0' } };
  mockPolicyAckUpdate.mockResolvedValue(updatedAck);

  const res = await request(app)
    .post(`/recruitment/onboarding/${EMP_ID}/acknowledgements/doc-001`)
    .set('Authorization', 'Bearer test')
    .send();

  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ACKNOWLEDGED');
  expect(mockPolicyAckUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { employeeId_documentId: { employeeId: EMP_ID, documentId: 'doc-001' } },
      data: expect.objectContaining({ status: 'ACKNOWLEDGED' }),
    })
  );
});

// ── AK-10 ─────────────────────────────────────────────────────────────────────
test('AK-10 POST /:employeeId/acknowledgements/:docId returns 409 when already acknowledged', async () => {
  mockPolicyAckFindUnique.mockResolvedValue({ ...ACKNOWLEDGED_ACK, document: DOC_HARASSMENT });

  const res = await request(app)
    .post(`/recruitment/onboarding/${EMP_ID}/acknowledgements/doc-002`)
    .set('Authorization', 'Bearer test')
    .send();

  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/already acknowledged/i);
  expect(mockPolicyAckUpdate).not.toHaveBeenCalled();
});

// ── AK-11 ─────────────────────────────────────────────────────────────────────
test('AK-11 POST /:employeeId/acknowledgements/:docId returns 404 when not assigned', async () => {
  mockPolicyAckFindUnique.mockResolvedValue(null);

  const res = await request(app)
    .post(`/recruitment/onboarding/${EMP_ID}/acknowledgements/doc-999`)
    .set('Authorization', 'Bearer test')
    .send();

  expect(res.status).toBe(404);
  expect(res.body.error).toMatch(/not found/i);
});

// ── AK-12 ─────────────────────────────────────────────────────────────────────
test('AK-12 GET /:employeeId/acknowledgements shows allComplete true when all done', async () => {
  const allDone = ALL_DOCS.map((d, i) => ({
    id: `ack-${i}`, employeeId: EMP_ID, documentId: d.id,
    status: 'ACKNOWLEDGED', acknowledgedAt: new Date(),
    document: { code: d.code, title: d.title, description: d.description, version: d.version, documentUrl: null },
  }));
  mockPolicyAckFindMany.mockResolvedValue(allDone);

  const res = await request(app)
    .get(`/recruitment/onboarding/${EMP_ID}/acknowledgements`)
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body.summary.allComplete).toBe(true);
  expect(res.body.summary.pending).toBe(0);
  expect(res.body.summary.total).toBe(4);
});

// ── AK-13 ─────────────────────────────────────────────────────────────────────
test('AK-13 GET /acknowledgements/pending returns grouped HR dashboard', async () => {
  setUser({ role: 'HR_ADMIN' });
  const pendingAcks = [
    { ...PENDING_ACK, employeeId: 'emp-a', document: { code: 'HANDBOOK', title: 'Employee Handbook' } },
    { ...PENDING_ACK, id: 'ack-x', employeeId: 'emp-a', documentId: 'doc-002', document: { code: 'PDPA_CONSENT', title: 'PDPA Consent' } },
    { ...PENDING_ACK, id: 'ack-y', employeeId: 'emp-b', documentId: 'doc-003', document: { code: 'HARASSMENT_POLICY', title: 'Harassment Policy' } },
  ];
  mockPolicyAckFindMany.mockResolvedValue(pendingAcks);

  const res = await request(app)
    .get('/recruitment/onboarding/acknowledgements/pending')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body.totalEmployees).toBe(2);
  expect(res.body.totalPending).toBe(3);
  const empA = res.body.employees.find(e => e.employeeId === 'emp-a');
  expect(empA.pendingCount).toBe(2);
  const empB = res.body.employees.find(e => e.employeeId === 'emp-b');
  expect(empB.pendingCount).toBe(1);
});

// ── AK-14 ─────────────────────────────────────────────────────────────────────
test('AK-14 candidate approval queues acknowledgements (acknowledgementsQueued = true)', async () => {
  setUser({ role: 'HR_ADMIN' });

  const candidate = {
    id: 'cand-ack-001', firstName: 'John', lastName: 'Doe', email: 'john@test.com',
    phone: null, currentTitle: 'Engineer', stage: 'OFFER', isHired: false,
    isOfferMade: true, employeeId: null, jobId: 'job-001', expectedSalary: 5000,
    job: { id: 'job-001', title: 'Engineer', department: 'Engineering', mcfPostedAt: MCF_POSTED_20D_AGO, fcfExempt: false },
    createdAt: new Date(), updatedAt: new Date(),
  };
  const createdEmployee = { id: 'emp-john-001', firstName: 'John', lastName: 'Doe', email: 'john@test.com' };

  mockDb.candidate.findUnique.mockResolvedValue(candidate);
  mockDb.candidate.update.mockResolvedValue({ ...candidate, stage: 'HIRED', isHired: true, employeeId: 'emp-john-001' });
  mockDb.candidateStageEvent.create.mockResolvedValue({});
  // Return 4 active docs so acknowledgements can be queued
  mockPolicyDocFindMany.mockResolvedValue(ALL_DOCS);
  mockPolicyAckCreateMany.mockResolvedValue({ count: 4 });

  global.fetch
    .mockResolvedValueOnce({ ok: true, json: async () => createdEmployee }) // employee POST
    .mockResolvedValue({ ok: true, json: async () => ({}) });               // leave + email

  const res = await request(app)
    .post('/recruitment/candidates/cand-ack-001/approve')
    .set('Authorization', 'Bearer test')
    .send({ startDate: '2026-07-01' });

  expect(res.status).toBe(201);
  expect(res.body.triggers.acknowledgementsQueued).toBe(true);

  // Give fire-and-forget a tick
  await new Promise(r => setTimeout(r, 50));

  expect(mockPolicyAckCreateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ employeeId: 'emp-john-001' }),
      ]),
      skipDuplicates: true,
    })
  );
});
