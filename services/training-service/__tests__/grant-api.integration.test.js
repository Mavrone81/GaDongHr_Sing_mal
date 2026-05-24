'use strict';
/**
 * Integration tests for TRN-003 grant routes (mounted under /training).
 *
 * Endpoints covered:
 *   G1  PUT  /programs/:id/grant-config — saves SSG/ETS/SFEC/AP config
 *   G2  PUT  /programs/:id/grant-config — rejects invalid grantPercentage
 *   G3  PUT  /enrollments/:id/training-hours — computes AP for SSG programs
 *   G4  PUT  /enrollments/:id/training-hours — non-SSG program → apComputedAmount=0
 *   G5  POST /grants/ap/compute — creates AP claims idempotently
 *   G6  POST /grants/ap/compute — rejects missing/invalid period
 *   G7  GET  /grants/ap/export — emits SSG pipe-delimited flat file
 *   G8  GET  /grants/ets/report — aggregates completed ETS-eligible enrollments
 *   G9  GET  /sfc/balance/:employeeId — returns balance; defaults to 0 if not set
 *   G10 GET  /sfc/balance/:employeeId — forbidden across employees for non-admins
 *   G11 PUT  /sfc/balance/:employeeId — upserts balance
 *   G12 POST /sfc/declarations — decrements balance + writes SFC GrantClaim
 *   G13 POST /sfc/declarations — rejects amount > balance
 *   G14 GET  /sfec/balance — uninitialised state
 *   G15 PUT  /sfec/balance — initialises singleton
 *   G16 POST /sfec/claims — 90% coverage + ledger decrement
 *   G17 POST /sfec/claims — rejects non-SFEC-eligible program
 *   G18 GET  /grant-claims — totals by claim type
 *   G19 PUT  /grant-claims/:id — status transition + submittedAt stamp
 *   G20 GET  /grants/summary — dashboard totals
 */

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = { sub: req.headers['x-user-id'] || 'admin-user-1', role: req.headers['x-user-role'] || 'HR_ADMIN' };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const mockDb = {
  trainingProgram: {
    findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn(), create: jest.fn(),
  },
  trainingEnrollment: {
    findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn(), upsert: jest.fn(), count: jest.fn(),
  },
  employeeSfcBalance: {
    findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(),
  },
  sfecLedger: {
    findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(),
  },
  grantClaim: {
    findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(),
  },
  employeeCertification: { findMany: jest.fn(), findUnique: jest.fn() },
  certReminder: { findMany: jest.fn(), create: jest.fn() },
  trainingMaterial: { findUnique: jest.fn() },
  competency: { findMany: jest.fn() },
  programCompetency: {},
  jobFamilyCompetency: { findMany: jest.fn() },
  employeeCompetency: { findMany: jest.fn() },
  $transaction: jest.fn(async (ops) => Promise.all(ops)),
};

jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockDb) }));

const request = require('supertest');
const { app } = require('../src/index');

const ADMIN_H = { 'x-user-role': 'HR_ADMIN', 'x-user-id': 'admin-1', 'x-employee-id': 'admin-emp', authorization: 'Bearer t' };
const EMP_H   = { 'x-user-role': 'EMPLOYEE', 'x-user-id': 'emp-user-1', 'x-employee-id': 'emp-1', authorization: 'Bearer t' };

beforeEach(() => jest.clearAllMocks());

// ── G1 ────────────────────────────────────────────────────────────────────────
test('G1 — PUT /programs/:id/grant-config saves SSG/ETS/SFEC/AP fields', async () => {
  mockDb.trainingProgram.update.mockResolvedValueOnce({
    id: 'prog-1', isSsgFunded: true, ssgCourseCode: 'TGS-001', etsEligible: true,
    sfecEligible: true, apHourlyRate: 7.5, courseFee: 1000, grantPercentage: 0.7,
  });

  const res = await request(app)
    .put('/training/programs/prog-1/grant-config')
    .set(ADMIN_H)
    .send({ isSsgFunded: true, ssgCourseCode: 'TGS-001', etsEligible: true, sfecEligible: true, apHourlyRate: 7.5, courseFee: 1000, grantPercentage: 0.7 });

  expect(res.status).toBe(200);
  expect(res.body.isSsgFunded).toBe(true);
  expect(res.body.grantPercentage).toBe(0.7);
});

// ── G2 ────────────────────────────────────────────────────────────────────────
test('G2 — grant-config rejects invalid grantPercentage > 1', async () => {
  const res = await request(app)
    .put('/training/programs/prog-1/grant-config')
    .set(ADMIN_H)
    .send({ grantPercentage: 1.5 });
  expect(res.status).toBe(400);
});

// ── G3 ────────────────────────────────────────────────────────────────────────
test('G3 — PUT /enrollments/:id/training-hours computes AP for SSG program', async () => {
  mockDb.trainingEnrollment.findUnique.mockResolvedValueOnce({
    id: 'enr-1', programId: 'prog-1', employeeId: 'emp-1',
    program: { isSsgFunded: true, apHourlyRate: 7.5 },
  });
  mockDb.trainingEnrollment.update.mockResolvedValueOnce({
    id: 'enr-1', trainingHours: 8, apComputedAmount: 60,
  });

  const res = await request(app)
    .put('/training/enrollments/enr-1/training-hours')
    .set(ADMIN_H)
    .send({ trainingHours: 8, attendanceDate: '2026-05-15' });

  expect(res.status).toBe(200);
  expect(res.body.computedApAmount).toBe(60);
  expect(res.body.hourlyRateUsed).toBe(7.5);
});

// ── G4 ────────────────────────────────────────────────────────────────────────
test('G4 — non-SSG program → apComputedAmount=0 even with hours', async () => {
  mockDb.trainingEnrollment.findUnique.mockResolvedValueOnce({
    id: 'enr-2', programId: 'prog-2', employeeId: 'emp-1',
    program: { isSsgFunded: false, apHourlyRate: null },
  });
  mockDb.trainingEnrollment.update.mockResolvedValueOnce({ id: 'enr-2', trainingHours: 5, apComputedAmount: 0 });

  const res = await request(app)
    .put('/training/enrollments/enr-2/training-hours')
    .set(ADMIN_H)
    .send({ trainingHours: 5 });

  expect(res.status).toBe(200);
  expect(res.body.computedApAmount).toBe(0);
});

// ── G5 ────────────────────────────────────────────────────────────────────────
test('G5 — POST /grants/ap/compute creates claims and is idempotent', async () => {
  const ssgProg = { id: 'prog-1', isSsgFunded: true, apHourlyRate: 7.5 };
  mockDb.trainingEnrollment.findMany.mockResolvedValueOnce([
    { id: 'enr-1', programId: 'prog-1', employeeId: 'emp-1', trainingHours: 8, program: ssgProg },
    { id: 'enr-2', programId: 'prog-1', employeeId: 'emp-2', trainingHours: 4, program: ssgProg },
  ]);
  mockDb.grantClaim.findMany.mockResolvedValueOnce([{ enrollmentId: 'enr-1' }]); // already claimed
  mockDb.grantClaim.create.mockImplementationOnce(({ data }) => Promise.resolve({ ...data, id: 'claim-1' }));
  mockDb.trainingEnrollment.update.mockResolvedValue({});

  const res = await request(app)
    .post('/training/grants/ap/compute')
    .set(ADMIN_H)
    .send({ period: '2026-05' });

  expect(res.status).toBe(200);
  expect(res.body.candidatesScanned).toBe(2);
  expect(res.body.alreadyClaimed).toBe(1);
  expect(res.body.created).toBe(1);
  expect(res.body.totalAmount).toBe(30); // 4h × 7.5
});

// ── G6 ────────────────────────────────────────────────────────────────────────
test('G6 — AP compute rejects invalid period', async () => {
  const res = await request(app)
    .post('/training/grants/ap/compute')
    .set(ADMIN_H)
    .send({ period: 'not-a-period' });
  expect(res.status).toBe(400);
});

// ── G7 ────────────────────────────────────────────────────────────────────────
test('G7 — GET /grants/ap/export emits SSG-format flat file', async () => {
  mockDb.grantClaim.findMany.mockResolvedValueOnce([
    {
      id: 'c-1', claimType: 'AP', employeeId: 'emp-1', programId: 'prog-1',
      program: { ssgCourseCode: 'TGS-001', apHourlyRate: 7.5 },
      enrollment: { trainingHours: 8 },
    },
  ]);

  const res = await request(app)
    .get('/training/grants/ap/export?period=2026-05')
    .set({ ...ADMIN_H, 'x-employee-lookup': JSON.stringify({ 'emp-1': { nric: 'S1234567A', fullName: 'Alice Tan' } }) });

  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/text\/plain/);
  expect(res.text.split('\n')[0]).toMatch(/NRIC\|EmployeeName/);
  expect(res.text).toContain('S1234567A');
  expect(res.text).toContain('Alice Tan');
  expect(res.text).toContain('60.00');
});

// ── G8 ────────────────────────────────────────────────────────────────────────
test('G8 — GET /grants/ets/report aggregates ETS-eligible completions', async () => {
  mockDb.trainingEnrollment.findMany.mockResolvedValueOnce([
    {
      id: 'enr-1', employeeId: 'emp-1', programId: 'prog-1', completedAt: new Date('2026-04-15'),
      program: { title: 'Cybersecurity 101', ssgCourseCode: 'TGS-CY', courseFee: 1000, grantPercentage: 0.7, isSsgFunded: true, etsEligible: true },
    },
    {
      id: 'enr-2', employeeId: 'emp-2', programId: 'prog-1', completedAt: new Date('2026-04-20'),
      program: { title: 'Cybersecurity 101', ssgCourseCode: 'TGS-CY', courseFee: 1000, grantPercentage: 0.7, isSsgFunded: true, etsEligible: true },
    },
  ]);

  const res = await request(app)
    .get('/training/grants/ets/report?from=2026-04-01&to=2026-04-30')
    .set(ADMIN_H);

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(2);
  expect(res.body.totalGrantClaimable).toBe(1400); // 700 × 2
  expect(res.body.rows[0].grantAmount).toBe(700);
});

// ── G9 ────────────────────────────────────────────────────────────────────────
test('G9 — GET /sfc/balance/:employeeId returns 0 when not set', async () => {
  mockDb.employeeSfcBalance.findUnique.mockResolvedValueOnce(null);

  const res = await request(app)
    .get('/training/sfc/balance/emp-1')
    .set(ADMIN_H);

  expect(res.status).toBe(200);
  expect(res.body.balanceAmount).toBe(0);
  expect(res.body.note).toMatch(/initialise/i);
});

// ── G10 ───────────────────────────────────────────────────────────────────────
test('G10 — GET /sfc/balance/:other forbidden for non-admin employee', async () => {
  const res = await request(app)
    .get('/training/sfc/balance/emp-OTHER')
    .set(EMP_H);
  expect(res.status).toBe(403);
});

// ── G11 ───────────────────────────────────────────────────────────────────────
test('G11 — PUT /sfc/balance/:employeeId upserts balance', async () => {
  mockDb.employeeSfcBalance.upsert.mockResolvedValueOnce({
    id: 'bal-1', employeeId: 'emp-1', balanceAmount: 500, lifetimeReceived: 500, lifetimeUsed: 0,
  });

  const res = await request(app)
    .put('/training/sfc/balance/emp-1')
    .set(ADMIN_H)
    .send({ balanceAmount: 500 });

  expect(res.status).toBe(200);
  expect(res.body.balanceAmount).toBe(500);
});

// ── G12 ───────────────────────────────────────────────────────────────────────
test('G12 — POST /sfc/declarations decrements balance and writes SFC claim', async () => {
  mockDb.trainingEnrollment.findUnique.mockResolvedValueOnce({
    id: 'enr-1', employeeId: 'emp-1', programId: 'prog-1', sfcDeclaredAmount: 0,
  });
  mockDb.employeeSfcBalance.findUnique.mockResolvedValueOnce({
    id: 'bal-1', employeeId: 'emp-1', balanceAmount: 500, lifetimeUsed: 0,
  });
  mockDb.employeeSfcBalance.upsert.mockResolvedValueOnce({
    id: 'bal-1', employeeId: 'emp-1', balanceAmount: 300, lifetimeUsed: 200,
  });
  mockDb.trainingEnrollment.update.mockResolvedValueOnce({ id: 'enr-1', sfcDeclaredAmount: 200 });
  mockDb.grantClaim.create.mockResolvedValueOnce({ id: 'sfc-claim-1', claimType: 'SFC', claimAmount: 200 });

  const res = await request(app)
    .post('/training/sfc/declarations')
    .set(ADMIN_H)
    .send({ employeeId: 'emp-1', enrollmentId: 'enr-1', amount: 200 });

  expect(res.status).toBe(200);
  expect(res.body.balance.balanceAmount).toBe(300);
  expect(res.body.claim.claimAmount).toBe(200);
});

// ── G13 ───────────────────────────────────────────────────────────────────────
test('G13 — SFC declaration rejected when amount > balance', async () => {
  mockDb.trainingEnrollment.findUnique.mockResolvedValueOnce({
    id: 'enr-1', employeeId: 'emp-1', programId: 'prog-1',
  });
  mockDb.employeeSfcBalance.findUnique.mockResolvedValueOnce({ balanceAmount: 100 });

  const res = await request(app)
    .post('/training/sfc/declarations')
    .set(ADMIN_H)
    .send({ employeeId: 'emp-1', enrollmentId: 'enr-1', amount: 200 });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/Insufficient/);
});

// ── G14 ───────────────────────────────────────────────────────────────────────
test('G14 — GET /sfec/balance returns uninitialised state when no row', async () => {
  mockDb.sfecLedger.findUnique.mockResolvedValueOnce(null);

  const res = await request(app)
    .get('/training/sfec/balance')
    .set(ADMIN_H);

  expect(res.status).toBe(200);
  expect(res.body.initialised).toBe(false);
  expect(res.body.totalCredit).toBe(10000);
  expect(res.body.remainingAmount).toBe(10000);
});

// ── G15 ───────────────────────────────────────────────────────────────────────
test('G15 — PUT /sfec/balance initialises singleton ledger', async () => {
  mockDb.sfecLedger.upsert.mockResolvedValueOnce({
    id: 'singleton', totalCredit: 10000, usedAmount: 0, updatedBy: 'admin-1',
  });

  const res = await request(app)
    .put('/training/sfec/balance')
    .set(ADMIN_H)
    .send({ totalCredit: 10000, notes: 'Initial company SFEC' });

  expect(res.status).toBe(200);
  expect(res.body.totalCredit).toBe(10000);
  expect(res.body.remainingAmount).toBe(10000);
});

// ── G16 ───────────────────────────────────────────────────────────────────────
test('G16 — POST /sfec/claims applies 90% coverage and decrements ledger', async () => {
  mockDb.trainingProgram.findUnique.mockResolvedValueOnce({ id: 'prog-1', sfecEligible: true });
  mockDb.sfecLedger.findUnique.mockResolvedValueOnce({ id: 'singleton', totalCredit: 10000, usedAmount: 0 });
  mockDb.sfecLedger.update.mockResolvedValueOnce({ id: 'singleton', totalCredit: 10000, usedAmount: 900, updatedBy: 'admin-1' });
  mockDb.grantClaim.create.mockResolvedValueOnce({ id: 'sfec-1', claimType: 'SFEC', claimAmount: 900, status: 'APPROVED' });

  const res = await request(app)
    .post('/training/sfec/claims')
    .set(ADMIN_H)
    .send({ programId: 'prog-1', employeeId: 'emp-1', oopAmount: 1000 });

  expect(res.status).toBe(201);
  expect(res.body.claim.claimAmount).toBe(900);
  expect(res.body.ledger.remainingAmount).toBe(9100);
});

// ── G17 ───────────────────────────────────────────────────────────────────────
test('G17 — SFEC claim rejected when program is not SFEC-eligible', async () => {
  mockDb.trainingProgram.findUnique.mockResolvedValueOnce({ id: 'prog-1', sfecEligible: false });

  const res = await request(app)
    .post('/training/sfec/claims')
    .set(ADMIN_H)
    .send({ programId: 'prog-1', employeeId: 'emp-1', oopAmount: 1000 });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/SFEC-eligible/);
});

// ── G18 ───────────────────────────────────────────────────────────────────────
test('G18 — GET /grant-claims returns totals by claim type', async () => {
  mockDb.grantClaim.findMany.mockResolvedValueOnce([
    { id: 'c-1', claimType: 'AP',   claimAmount: 60,  status: 'PENDING',  program: { title: 'A' } },
    { id: 'c-2', claimType: 'AP',   claimAmount: 30,  status: 'PAID',     program: { title: 'A' } },
    { id: 'c-3', claimType: 'ETS',  claimAmount: 700, status: 'APPROVED', program: { title: 'B' } },
    { id: 'c-4', claimType: 'SFEC', claimAmount: 900, status: 'APPROVED', program: { title: 'C' } },
    { id: 'c-5', claimType: 'SFC',  claimAmount: 200, status: 'APPROVED', program: { title: 'D' } },
  ]);

  const res = await request(app)
    .get('/training/grant-claims')
    .set(ADMIN_H);

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(5);
  expect(res.body.totalsByType.AP).toBe(90);
  expect(res.body.totalsByType.ETS).toBe(700);
  expect(res.body.totalsByType.SFEC).toBe(900);
  expect(res.body.totalsByType.SFC).toBe(200);
});

// ── G19 ───────────────────────────────────────────────────────────────────────
test('G19 — PUT /grant-claims/:id transitions to SUBMITTED with submittedAt stamp', async () => {
  mockDb.grantClaim.update.mockImplementationOnce(({ data }) => Promise.resolve({ id: 'c-1', status: 'SUBMITTED', submittedAt: data.submittedAt, submissionRef: 'SSG-2026-REF-001' }));

  const res = await request(app)
    .put('/training/grant-claims/c-1')
    .set(ADMIN_H)
    .send({ status: 'SUBMITTED', submissionRef: 'SSG-2026-REF-001' });

  expect(res.status).toBe(200);
  expect(res.body.status).toBe('SUBMITTED');
  expect(res.body.submissionRef).toBe('SSG-2026-REF-001');
  expect(res.body.submittedAt).toBeDefined();
});

// ── G20 ───────────────────────────────────────────────────────────────────────
test('G20 — GET /grants/summary returns dashboard totals + SFEC remaining', async () => {
  mockDb.grantClaim.findMany.mockResolvedValueOnce([
    { claimType: 'AP', claimAmount: 90, status: 'PAID' },
    { claimType: 'ETS', claimAmount: 700, status: 'APPROVED' },
    { claimType: 'SFEC', claimAmount: 900, status: 'PAID' },
  ]);
  mockDb.sfecLedger.findUnique.mockResolvedValueOnce({ totalCredit: 10000, usedAmount: 900 });

  const res = await request(app)
    .get('/training/grants/summary')
    .set(ADMIN_H);

  expect(res.status).toBe(200);
  expect(res.body.totalClaimsByType.AP).toBe(90);
  expect(res.body.totalClaimsByType.ETS).toBe(700);
  expect(res.body.totalClaimsByType.SFEC).toBe(900);
  expect(res.body.paidByType.AP).toBe(90);
  expect(res.body.paidByType.SFEC).toBe(900);
  expect(res.body.paidByType.ETS).toBe(0);
  expect(res.body.totalClaimable).toBe(1690);
  expect(res.body.totalPaid).toBe(990);
  expect(res.body.sfec.remainingAmount).toBe(9100);
});
