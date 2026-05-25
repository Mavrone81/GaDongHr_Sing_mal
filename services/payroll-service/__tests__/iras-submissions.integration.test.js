'use strict';
/**
 * Integration tests for PAY-007 IRAS submission tracking routes:
 *
 *   POST   /payroll/iras-submissions
 *   GET    /payroll/iras-submissions
 *   GET    /payroll/iras-submissions/deadlines
 *   GET    /payroll/iras-submissions/:id
 *   PUT    /payroll/iras-submissions/:id
 *   DELETE /payroll/iras-submissions/:id
 *   POST   /payroll/iras-submissions/sweep
 */

let mockUser = { sub: 'admin-001', role: 'HR_ADMIN' };
const setUser = (u) => { mockUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', LINE_MANAGER: 'LINE_MANAGER',
    EMPLOYEE: 'EMPLOYEE', FINANCE_ADMIN: 'FINANCE_ADMIN',
  },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encrypt: v => String(v), decrypt: v => String(v),
  encryptNumber: v => String(v), decryptNumber: v => Number(v),
}), { virtual: true });

jest.mock('dotenv', () => ({ config: () => {} }));

const mockDb = {
  irasSubmission: {
    findFirst:  jest.fn(),
    findUnique: jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    delete:     jest.fn(),
  },
  payrollRun:       { findUnique: jest.fn() },
  payslip:          { findMany: jest.fn(), findFirst: jest.fn() },
  payrollLineItem:  { findMany: jest.fn().mockResolvedValue([]) },
  payslipSlaAlert:  { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  payComponent:     { findUnique: jest.fn() },
};
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ([]) });

const request = require('supertest');
const app = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', role: 'HR_ADMIN' });
});

// ── POST /iras-submissions ─────────────────────────────────────────────────

describe('POST /payroll/iras-submissions', () => {
  test('I1 — creates new CPF_E_SUBMIT row with auto-deadline', async () => {
    mockDb.irasSubmission.findFirst.mockResolvedValueOnce(null);
    mockDb.irasSubmission.create.mockImplementation(async ({ data }) => ({ ...data, id: 's1' }));
    const res = await request(app).post('/payroll/iras-submissions').send({
      kind: 'CPF_E_SUBMIT', period: '2026-05', fileName: 'cpf-esubmit-2026-05.txt',
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.submission.deadline).toBeDefined();
    // Deadline should be 2026-06-14
    expect(new Date(res.body.submission.deadline).toISOString().slice(0, 10)).toBe('2026-06-14');
  });

  test('I2 — re-recording same scope updates instead of duplicating', async () => {
    mockDb.irasSubmission.findFirst.mockResolvedValueOnce({ id: 's1', kind: 'CPF_E_SUBMIT', period: '2026-05', status: 'SUBMITTED', referenceNumber: 'CPF-12345' });
    mockDb.irasSubmission.update.mockResolvedValueOnce({ id: 's1', kind: 'CPF_E_SUBMIT', status: 'SUBMITTED' });
    const res = await request(app).post('/payroll/iras-submissions').send({
      kind: 'CPF_E_SUBMIT', period: '2026-05', fileName: 'updated.txt',
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    // Status / referenceNumber are NOT clobbered
    const data = mockDb.irasSubmission.update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.referenceNumber).toBeUndefined();
  });

  test('I3 — auto-hashes when fileContentBase64 supplied', async () => {
    mockDb.irasSubmission.findFirst.mockResolvedValueOnce(null);
    mockDb.irasSubmission.create.mockImplementation(async ({ data }) => ({ ...data, id: 's1' }));
    const content = Buffer.from('EMPLOYER|UEN|2026-05|CPF_SUBMIT').toString('base64');
    const res = await request(app).post('/payroll/iras-submissions').send({
      kind: 'CPF_E_SUBMIT', period: '2026-05', fileContentBase64: content,
    });
    expect(res.status).toBe(201);
    expect(res.body.submission.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.submission.fileSize).toBeGreaterThan(0);
  });

  test('I4 — IR8A requires year', async () => {
    const res = await request(app).post('/payroll/iras-submissions').send({ kind: 'IR8A' });
    expect(res.status).toBe(400);
  });

  test('I5 — CPF_E_SUBMIT requires period in YYYY-MM', async () => {
    const res = await request(app).post('/payroll/iras-submissions').send({ kind: 'CPF_E_SUBMIT', period: '2026-13' });
    expect(res.status).toBe(400);
  });

  test('I6 — IR21 requires employeeId', async () => {
    const res = await request(app).post('/payroll/iras-submissions').send({ kind: 'IR21' });
    expect(res.status).toBe(400);
  });

  test('I7 — unknown kind → 400', async () => {
    const res = await request(app).post('/payroll/iras-submissions').send({ kind: 'NOPE' });
    expect(res.status).toBe(400);
  });

  test('I8 — 403 for non-admin', async () => {
    setUser({ sub: 'e-1', role: 'EMPLOYEE' });
    const res = await request(app).post('/payroll/iras-submissions').send({ kind: 'CPF_E_SUBMIT', period: '2026-05' });
    expect(res.status).toBe(403);
  });
});

// ── GET /iras-submissions ─────────────────────────────────────────────────

describe('GET /payroll/iras-submissions', () => {
  test('I9 — returns rows + summary with urgency banding', async () => {
    const past   = new Date(Date.now() - 5 * 86400e3);
    const soon   = new Date(Date.now() + 2 * 86400e3);
    const later  = new Date(Date.now() + 40 * 86400e3);
    mockDb.irasSubmission.findMany.mockResolvedValueOnce([
      { id: 'a', kind: 'CPF_E_SUBMIT', status: 'DRAFT',     deadline: past  },
      { id: 'b', kind: 'IR8A',         status: 'SUBMITTED', deadline: soon  },
      { id: 'c', kind: 'IR8A',         status: 'ACKNOWLEDGED', deadline: later },
    ]);
    const res = await request(app).get('/payroll/iras-submissions');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.summary.byUrgency.OVERDUE).toBe(1);
    expect(res.body.summary.byUrgency.CRITICAL).toBe(1);
    expect(res.body.summary.byKind.IR8A).toBe(2);
    expect(res.body.summary.byStatus.ACKNOWLEDGED).toBe(1);
  });

  test('I10 — filters by kind + status + year', async () => {
    mockDb.irasSubmission.findMany.mockResolvedValueOnce([]);
    await request(app).get('/payroll/iras-submissions?kind=IR8A&status=SUBMITTED&year=2026');
    const call = mockDb.irasSubmission.findMany.mock.calls[0][0];
    expect(call.where.kind).toBe('IR8A');
    expect(call.where.status).toBe('SUBMITTED');
    expect(call.where.year).toBe(2026);
  });
});

// ── GET /iras-submissions/deadlines ───────────────────────────────────────

describe('GET /payroll/iras-submissions/deadlines', () => {
  test('I11 — only includes non-ACKNOWLEDGED rows within window', async () => {
    mockDb.irasSubmission.findMany.mockResolvedValueOnce([
      { id: 'a', kind: 'CPF_E_SUBMIT', status: 'DRAFT', deadline: new Date(Date.now() + 10 * 86400e3) },
      { id: 'b', kind: 'IR8A',         status: 'DRAFT', deadline: new Date(Date.now() + 90 * 86400e3) }, // outside default 60d window
    ]);
    const res = await request(app).get('/payroll/iras-submissions/deadlines');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    // Verify the where clause excludes ACKNOWLEDGED rows
    const call = mockDb.irasSubmission.findMany.mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ['DRAFT', 'SUBMITTED', 'REJECTED'] });
  });

  test('I12 — honours withinDays query param', async () => {
    mockDb.irasSubmission.findMany.mockResolvedValueOnce([
      { id: 'a', kind: 'IR8A', status: 'DRAFT', deadline: new Date(Date.now() + 80 * 86400e3) },
    ]);
    const res = await request(app).get('/payroll/iras-submissions/deadlines?withinDays=120');
    expect(res.body.total).toBe(1);
    expect(res.body.withinDays).toBe(120);
  });
});

// ── GET /iras-submissions/:id ─────────────────────────────────────────────

describe('GET /payroll/iras-submissions/:id', () => {
  test('I13 — returns single submission with urgency', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({
      id: 's1', kind: 'CPF_E_SUBMIT', status: 'DRAFT', deadline: new Date(Date.now() + 5 * 86400e3),
    });
    const res = await request(app).get('/payroll/iras-submissions/s1');
    expect(res.status).toBe(200);
    expect(res.body.urgency).toBe('WARNING');
  });

  test('I14 — 404 when missing', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).get('/payroll/iras-submissions/missing');
    expect(res.status).toBe(404);
  });
});

// ── PUT /iras-submissions/:id — transitions ──────────────────────────────

describe('PUT /payroll/iras-submissions/:id', () => {
  test('I15 — DRAFT → SUBMITTED with referenceNumber', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({ id: 's1', kind: 'CPF_E_SUBMIT', status: 'DRAFT', deadline: new Date() });
    mockDb.irasSubmission.update.mockImplementation(async ({ data }) => ({ id: 's1', kind: 'CPF_E_SUBMIT', status: data.status, referenceNumber: data.referenceNumber, deadline: new Date() }));
    const res = await request(app).put('/payroll/iras-submissions/s1').send({ status: 'SUBMITTED', referenceNumber: 'CPF-2026-12345' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.referenceNumber).toBe('CPF-2026-12345');
  });

  test('I16 — SUBMITTED requires referenceNumber', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({ id: 's1', status: 'DRAFT' });
    const res = await request(app).put('/payroll/iras-submissions/s1').send({ status: 'SUBMITTED' });
    expect(res.status).toBe(400);
  });

  test('I17 — REJECTED requires rejectedReason', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({ id: 's1', status: 'SUBMITTED' });
    const res = await request(app).put('/payroll/iras-submissions/s1').send({ status: 'REJECTED' });
    expect(res.status).toBe(400);
  });

  test('I18 — DRAFT → ACKNOWLEDGED blocked with 409', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({ id: 's1', status: 'DRAFT' });
    const res = await request(app).put('/payroll/iras-submissions/s1').send({ status: 'ACKNOWLEDGED', referenceNumber: 'X' });
    expect(res.status).toBe(409);
  });

  test('I19 — ACKNOWLEDGED is terminal (any further transition → 409)', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({ id: 's1', status: 'ACKNOWLEDGED' });
    const res = await request(app).put('/payroll/iras-submissions/s1').send({ status: 'REJECTED', rejectedReason: 'X' });
    expect(res.status).toBe(409);
  });

  test('I20 — referenceNumber-only update (no status change) is allowed', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({ id: 's1', status: 'DRAFT', deadline: new Date() });
    mockDb.irasSubmission.update.mockResolvedValueOnce({ id: 's1', status: 'DRAFT', referenceNumber: 'CPF-99', deadline: new Date() });
    const res = await request(app).put('/payroll/iras-submissions/s1').send({ referenceNumber: 'CPF-99' });
    expect(res.status).toBe(200);
    expect(res.body.referenceNumber).toBe('CPF-99');
  });

  test('I21 — SUBMITTED → ACKNOWLEDGED stamps timestamp', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({ id: 's1', status: 'SUBMITTED' });
    mockDb.irasSubmission.update.mockImplementation(async ({ data }) => ({ id: 's1', status: data.status, acknowledgedAt: data.acknowledgedAt, deadline: new Date() }));
    const res = await request(app).put('/payroll/iras-submissions/s1').send({ status: 'ACKNOWLEDGED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACKNOWLEDGED');
    expect(res.body.acknowledgedAt).toBeDefined();
  });

  test('I22 — REJECTED → DRAFT (resubmission) clears rejected stamps', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({ id: 's1', status: 'REJECTED', rejectedAt: new Date(), rejectedReason: 'bad format' });
    mockDb.irasSubmission.update.mockImplementation(async ({ data }) => ({ id: 's1', status: data.status, rejectedAt: data.rejectedAt, rejectedReason: data.rejectedReason, deadline: new Date() }));
    const res = await request(app).put('/payroll/iras-submissions/s1').send({ status: 'DRAFT' });
    expect(res.status).toBe(200);
    expect(res.body.rejectedAt).toBeNull();
    expect(res.body.rejectedReason).toBeNull();
  });
});

// ── DELETE /iras-submissions/:id ─────────────────────────────────────────

describe('DELETE /payroll/iras-submissions/:id', () => {
  test('I23 — deletes only DRAFT rows', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({ id: 's1', status: 'DRAFT' });
    mockDb.irasSubmission.delete.mockResolvedValueOnce({});
    const res = await request(app).delete('/payroll/iras-submissions/s1');
    expect(res.status).toBe(200);
  });

  test('I24 — 409 when not DRAFT', async () => {
    mockDb.irasSubmission.findUnique.mockResolvedValueOnce({ id: 's1', status: 'SUBMITTED' });
    const res = await request(app).delete('/payroll/iras-submissions/s1');
    expect(res.status).toBe(409);
  });
});

// ── POST /iras-submissions/sweep ─────────────────────────────────────────

describe('POST /payroll/iras-submissions/sweep', () => {
  test('I25 — returns buckets per urgency band', async () => {
    mockDb.irasSubmission.findMany.mockResolvedValueOnce([
      { deadline: new Date(Date.now() - 86400e3) },              // OVERDUE
      { deadline: new Date(Date.now() + 1 * 86400e3) },          // CRITICAL
      { deadline: new Date(Date.now() + 10 * 86400e3) },         // WARNING
      { deadline: new Date(Date.now() + 25 * 86400e3) },         // NOTICE
      { deadline: new Date(Date.now() + 60 * 86400e3) },         // OK
    ]);
    const res = await request(app).post('/payroll/iras-submissions/sweep').send({});
    expect(res.status).toBe(200);
    expect(res.body.scanned).toBe(5);
    expect(res.body.buckets.OVERDUE).toBe(1);
    expect(res.body.buckets.CRITICAL).toBe(1);
    expect(res.body.buckets.WARNING).toBe(1);
    expect(res.body.buckets.NOTICE).toBe(1);
    expect(res.body.buckets.OK).toBe(1);
  });
});
