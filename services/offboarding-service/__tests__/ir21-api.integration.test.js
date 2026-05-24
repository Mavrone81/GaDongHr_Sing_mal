'use strict';
/**
 * Integration tests for OFF-004 IR21 routes.
 *
 * Covers:
 *   I1  — POST /offboarding/initiate sets ir21DeadlineDate + moniesWithheld for foreign employee
 *   I2  — POST /offboarding/initiate does NOT set withhold for local employee
 *   I3  — GET  /offboarding/ir21/dashboard lists pending IR21 cases with urgency
 *   I4  — POST /offboarding/:id/ir21-trigger sets SUBMITTED + moniesWithheld
 *   I5  — POST /offboarding/:id/ir21-trigger rejects re-trigger after CLEARANCE_ISSUED
 *   I6  — POST /offboarding/:id/ir21-populate fetches YTD and stores ir21FormData
 *   I7  — GET  /offboarding/:id/ir21-form returns form data + deadline info
 *   I8  — GET  /offboarding/:id/ir21-form returns formPopulated=false when not populated
 *   I9  — PUT  /offboarding/:id/ir21-clearance sets CLEARANCE_ISSUED + releases hold
 *   I10 — PUT  /offboarding/:id/ir21-clearance requires SUBMITTED status (rejects PENDING)
 *   I11 — POST /offboarding/:id/create-final-pay-run blocked when ir21Status=PENDING
 *   I12 — POST /offboarding/:id/create-final-pay-run blocked when ir21Status=SUBMITTED
 *   I13 — POST /offboarding/:id/create-final-pay-run allowed after CLEARANCE_ISSUED
 *   I14 — POST /offboarding/:id/create-final-pay-run allowed for local employees
 *   I15 — POST /offboarding/:id/ir21-populate returns 400 for local employee
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER', PAYROLL_OFFICER: 'PAYROLL_OFFICER', IT_ADMIN: 'IT_ADMIN', EMPLOYEE: 'EMPLOYEE' },
}), { virtual: true });
jest.mock('/app/shared/payroll-utils', () => ({
  countWorkingDays: (_start, _end) => 22,
}), { virtual: true });

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockCreate      = jest.fn();
const mockFindUnique  = jest.fn();
const mockFindMany    = jest.fn();
const mockUpdate      = jest.fn();
const mockClearUpdate = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => ({
    offboardingCase: {
      create: mockCreate,
      findUnique: mockFindUnique,
      findMany: mockFindMany,
      update: mockUpdate,
    },
    clearanceItem: { update: mockClearUpdate },
    $disconnect: jest.fn(),
  })),
}));

// ── fetch mock ────────────────────────────────────────────────────────────────
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── App ───────────────────────────────────────────────────────────────────────
const request = require('supertest');
const app     = require('../src/index');

// ── Helpers ───────────────────────────────────────────────────────────────────
const AUTH = 'Bearer test-token';

function foreignCase(overrides = {}) {
  return {
    id: 'case-001',
    employeeId: 'emp-f01',
    employeeName: 'Ravi Kumar',
    department: 'Engineering',
    reason: 'RESIGNATION',
    lastWorkingDate: new Date('2026-08-31T00:00:00Z'),
    noticeGivenDate: new Date('2026-07-31T00:00:00Z'),
    noticePeriodDays: 30,
    isForeignEmployee: true,
    ir21Status: 'PENDING',
    ir21FiledAt: null,
    ir21ClearedAt: null,
    ir21DeadlineDate: new Date('2026-08-01T00:00:00Z'),
    ir21FormData: null,
    moniesWithheld: true,
    moniesToRelease: false,
    finalPayData: null,
    finalPayRunId: null,
    status: 'INITIATED',
    initiatedBy: 'admin-001',
    clearanceItems: [],
    ...overrides,
  };
}

function localCase(overrides = {}) {
  return {
    ...foreignCase(),
    employeeId: 'emp-l01',
    isForeignEmployee: false,
    ir21Status: null,
    ir21DeadlineDate: null,
    moniesWithheld: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── I1: initiate foreign employee ─────────────────────────────────────────────
test('I1 — initiate sets ir21DeadlineDate and moniesWithheld for foreign employee', async () => {
  mockFindUnique.mockResolvedValueOnce(null); // no existing case
  mockCreate.mockResolvedValueOnce({ ...foreignCase(), clearanceItems: [] });

  const res = await request(app)
    .post('/offboarding/initiate')
    .set('Authorization', AUTH)
    .send({ employeeId: 'emp-f01', reason: 'RESIGNATION', lastWorkingDate: '2026-08-31', isForeignEmployee: true });

  expect(res.status).toBe(201);
  const createCall = mockCreate.mock.calls[0][0].data;
  expect(createCall.isForeignEmployee).toBe(true);
  expect(createCall.moniesWithheld).toBe(true);
  expect(createCall.ir21Status).toBe('PENDING');
  expect(createCall.ir21DeadlineDate).toBeInstanceOf(Date);
  // deadline should be 30 days before LWD 2026-08-31 → 2026-08-01
  expect(createCall.ir21DeadlineDate.toISOString().slice(0, 10)).toBe('2026-08-01');
});

// ── I2: initiate local employee ───────────────────────────────────────────────
test('I2 — initiate does NOT set withhold for local employee', async () => {
  mockFindUnique.mockResolvedValueOnce(null);
  mockCreate.mockResolvedValueOnce({ ...localCase(), clearanceItems: [] });

  const res = await request(app)
    .post('/offboarding/initiate')
    .set('Authorization', AUTH)
    .send({ employeeId: 'emp-l01', reason: 'RESIGNATION', lastWorkingDate: '2026-08-31', isForeignEmployee: false });

  expect(res.status).toBe(201);
  const createCall = mockCreate.mock.calls[0][0].data;
  expect(createCall.isForeignEmployee).toBe(false);
  expect(createCall.moniesWithheld).toBe(false);
  expect(createCall.ir21Status).toBeNull();
  expect(createCall.ir21DeadlineDate).toBeNull();
});

// ── I3: ir21/dashboard ────────────────────────────────────────────────────────
test('I3 — GET /offboarding/ir21/dashboard returns cases with urgency', async () => {
  const pastDeadline = new Date('2020-01-01T00:00:00Z');
  mockFindMany.mockResolvedValueOnce([
    foreignCase({ ir21DeadlineDate: pastDeadline }),
  ]);

  const res = await request(app)
    .get('/offboarding/ir21/dashboard')
    .set('Authorization', AUTH);

  expect(res.status).toBe(200);
  expect(res.body.summary.total).toBe(1);
  expect(res.body.cases[0].urgency).toBe('OVERDUE');
  expect(res.body.cases[0].daysUntilDeadline).toBeLessThan(0);
  expect(res.body.summary.overdue).toBe(1);
});

// ── I4: ir21-trigger ──────────────────────────────────────────────────────────
test('I4 — POST ir21-trigger sets SUBMITTED and moniesWithheld=true', async () => {
  mockFindUnique.mockResolvedValueOnce(foreignCase({ ir21Status: 'PENDING', ir21DeadlineDate: new Date('2026-08-01T00:00:00Z') }));
  const expected = foreignCase({ ir21Status: 'SUBMITTED', ir21FiledAt: new Date(), moniesWithheld: true });
  mockUpdate.mockResolvedValueOnce(expected);

  const res = await request(app)
    .post('/offboarding/case-001/ir21-trigger')
    .set('Authorization', AUTH);

  expect(res.status).toBe(200);
  expect(res.body.message).toMatch(/suspended/i);
  expect(res.body.daysUntilDeadline).toBeDefined();
  const updateData = mockUpdate.mock.calls[0][0].data;
  expect(updateData.ir21Status).toBe('SUBMITTED');
  expect(updateData.moniesWithheld).toBe(true);
});

// ── I5: ir21-trigger rejected after clearance ─────────────────────────────────
test('I5 — POST ir21-trigger returns 409 when already CLEARANCE_ISSUED', async () => {
  mockFindUnique.mockResolvedValueOnce(foreignCase({ ir21Status: 'CLEARANCE_ISSUED' }));

  const res = await request(app)
    .post('/offboarding/case-001/ir21-trigger')
    .set('Authorization', AUTH);

  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/CLEARANCE_ISSUED/);
});

// ── I6: ir21-populate ─────────────────────────────────────────────────────────
test('I6 — POST ir21-populate fetches YTD and stores ir21FormData', async () => {
  mockFindUnique.mockResolvedValueOnce(foreignCase());
  const ytdPayload = {
    employeeId: 'emp-f01', year: '2026',
    employmentIncome: 60000, awIncome: 5000,
    benefitsInKind: 2000, stockOptionGain: 0,
    employeeCpf: 7200, employerCpf: 8400,
    totalTaxableIncome: 67000,
    generatedAt: new Date().toISOString(),
  };
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ytdPayload });
  const updated = foreignCase({ ir21FormData: { ...ytdPayload, populatedAt: new Date().toISOString() } });
  mockUpdate.mockResolvedValueOnce(updated);

  const res = await request(app)
    .post('/offboarding/case-001/ir21-populate')
    .set('Authorization', AUTH);

  expect(res.status).toBe(200);
  expect(res.body.formData.employmentIncome).toBe(60000);
  expect(res.body.formData.totalTaxableIncome).toBe(67000);
  // Ensure internal key was passed to payroll
  const fetchCall = mockFetch.mock.calls[0];
  expect(fetchCall[1].headers['x-internal-service-key']).toBeDefined();
});

// ── I7: ir21-form populated ───────────────────────────────────────────────────
test('I7 — GET /offboarding/:id/ir21-form returns form data and deadline info', async () => {
  const formData = { employmentIncome: 60000, totalTaxableIncome: 67000 };
  mockFindUnique.mockResolvedValueOnce(foreignCase({ ir21FormData: formData, ir21DeadlineDate: new Date('2026-08-01T00:00:00Z') }));

  const res = await request(app)
    .get('/offboarding/case-001/ir21-form')
    .set('Authorization', AUTH);

  expect(res.status).toBe(200);
  expect(res.body.formPopulated).toBe(true);
  expect(res.body.formData.employmentIncome).toBe(60000);
  expect(res.body.ir21Status).toBe('PENDING');
  expect(res.body.daysUntilDeadline).toBeDefined();
  expect(res.body.moniesWithheld).toBe(true);
});

// ── I8: ir21-form not yet populated ──────────────────────────────────────────
test('I8 — GET /offboarding/:id/ir21-form returns formPopulated=false when not populated', async () => {
  mockFindUnique.mockResolvedValueOnce(foreignCase({ ir21FormData: null }));

  const res = await request(app)
    .get('/offboarding/case-001/ir21-form')
    .set('Authorization', AUTH);

  expect(res.status).toBe(200);
  expect(res.body.formPopulated).toBe(false);
  expect(res.body.formData).toBeNull();
});

// ── I9: ir21-clearance releases hold ─────────────────────────────────────────
test('I9 — PUT ir21-clearance sets CLEARANCE_ISSUED and releases moniesWithheld', async () => {
  mockFindUnique.mockResolvedValueOnce(foreignCase({ ir21Status: 'SUBMITTED' }));
  const cleared = foreignCase({ ir21Status: 'CLEARANCE_ISSUED', moniesWithheld: false, moniesToRelease: true, ir21ClearedAt: new Date() });
  mockUpdate.mockResolvedValueOnce(cleared);

  const res = await request(app)
    .put('/offboarding/case-001/ir21-clearance')
    .set('Authorization', AUTH)
    .send({ irasReference: 'IRAS-2026-123456' });

  expect(res.status).toBe(200);
  expect(res.body.message).toMatch(/released/i);
  const updateData = mockUpdate.mock.calls[0][0].data;
  expect(updateData.ir21Status).toBe('CLEARANCE_ISSUED');
  expect(updateData.moniesWithheld).toBe(false);
  expect(updateData.moniesToRelease).toBe(true);
});

// ── I10: ir21-clearance rejects non-SUBMITTED ─────────────────────────────────
test('I10 — PUT ir21-clearance returns 409 when status is PENDING (not yet filed)', async () => {
  mockFindUnique.mockResolvedValueOnce(foreignCase({ ir21Status: 'PENDING' }));

  const res = await request(app)
    .put('/offboarding/case-001/ir21-clearance')
    .set('Authorization', AUTH);

  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/SUBMITTED first/i);
});

// ── I11: create-final-pay-run blocked (PENDING) ───────────────────────────────
test('I11 — create-final-pay-run returns 409 when ir21Status=PENDING', async () => {
  mockFindUnique.mockResolvedValueOnce(foreignCase({ finalPayData: { grossFinalPay: 5000 }, ir21Status: 'PENDING', moniesWithheld: true }));

  const res = await request(app)
    .post('/offboarding/case-001/create-final-pay-run')
    .set('Authorization', AUTH);

  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/withheld/i);
  expect(res.body.ir21Status).toBe('PENDING');
  expect(res.body.resolution).toBeDefined();
});

// ── I12: create-final-pay-run blocked (SUBMITTED) ────────────────────────────
test('I12 — create-final-pay-run returns 409 when ir21Status=SUBMITTED', async () => {
  mockFindUnique.mockResolvedValueOnce(foreignCase({ finalPayData: { grossFinalPay: 5000 }, ir21Status: 'SUBMITTED', moniesWithheld: true }));

  const res = await request(app)
    .post('/offboarding/case-001/create-final-pay-run')
    .set('Authorization', AUTH);

  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/withheld/i);
});

// ── I13: create-final-pay-run allowed after clearance ────────────────────────
test('I13 — create-final-pay-run proceeds when ir21Status=CLEARANCE_ISSUED', async () => {
  mockFindUnique.mockResolvedValueOnce(foreignCase({
    ir21Status: 'CLEARANCE_ISSUED',
    moniesWithheld: false,
    finalPayData: { grossFinalPay: 5000 },
    employeeName: 'Ravi Kumar',
  }));
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'run-999' }) });
  mockUpdate.mockResolvedValueOnce(foreignCase({ finalPayRunId: 'run-999' }));

  const res = await request(app)
    .post('/offboarding/case-001/create-final-pay-run')
    .set('Authorization', AUTH);

  expect(res.status).toBe(200);
  expect(res.body.runId).toBe('run-999');
});

// ── I14: create-final-pay-run allowed for local employees ────────────────────
test('I14 — create-final-pay-run not blocked for local employee (ir21Status null)', async () => {
  mockFindUnique.mockResolvedValueOnce(localCase({
    finalPayData: { grossFinalPay: 3000 },
    ir21Status: null,
    moniesWithheld: false,
  }));
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'run-888' }) });
  mockUpdate.mockResolvedValueOnce(localCase({ finalPayRunId: 'run-888' }));

  const res = await request(app)
    .post('/offboarding/case-001/create-final-pay-run')
    .set('Authorization', AUTH);

  expect(res.status).toBe(200);
  expect(res.body.runId).toBe('run-888');
});

// ── I15: ir21-populate rejected for local employee ───────────────────────────
test('I15 — POST ir21-populate returns 400 for local (non-foreign) employee', async () => {
  mockFindUnique.mockResolvedValueOnce(localCase());

  const res = await request(app)
    .post('/offboarding/case-001/ir21-populate')
    .set('Authorization', AUTH);

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/non-SC/i);
});
