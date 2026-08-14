'use strict';
/**
 * Integration tests for PAY-011: Govt-paid leave claim generation and tracking.
 * Tests: G1-G19
 */

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { sub: 'admin-001', role: 'HR_ADMIN' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER' },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encrypt: v => String(v),
  decrypt: v => String(v),
}), { virtual: true });

jest.mock('dotenv', () => ({ config: () => {} }));
jest.mock('pdfkit', () => {
  const { EventEmitter } = require('events');
  return jest.fn().mockImplementation(() => {
    const ee = new EventEmitter();
    ee.font = () => ee; ee.fontSize = () => ee; ee.text = () => ee;
    ee.moveDown = () => ee; ee.lineTo = () => ee; ee.stroke = () => ee;
    ee.moveTo = () => ee; ee.pipe = () => {}; ee.end = () => ee.emit('end');
    return ee;
  });
});

// ── Prisma mock ───────────────────────────────────────────────────────────────
const mockPayslipFindMany   = jest.fn();
const mockClaimUpsert       = jest.fn();
const mockClaimFindMany     = jest.fn();
const mockClaimCount        = jest.fn();
const mockClaimFindUnique   = jest.fn();
const mockClaimUpdate       = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    payrollRun:              { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    payrollLineItem:         { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), delete: jest.fn() },
    payslip:                 { deleteMany: jest.fn(), createMany: jest.fn(), upsert: jest.fn(), findMany: mockPayslipFindMany, update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    cpfRate:                 { findMany: jest.fn().mockResolvedValue([]) },
    sdlConfig:               { findFirst: jest.fn().mockResolvedValue(null) },
    payComponent:            { findMany: jest.fn().mockResolvedValue([]) },
    payrollPeriodConfig:     { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    publicHoliday:           { findMany: jest.fn().mockResolvedValue([]) },
    bikItem:                 { findMany: jest.fn().mockResolvedValue([]) },
    stockOptionExercise:     { findMany: jest.fn().mockResolvedValue([]) },
    costCentre:              { findMany: jest.fn().mockResolvedValue([]) },
    govtLeaveClaimPayroll:   {
      upsert:      mockClaimUpsert,
      findMany:    mockClaimFindMany,
      count:       mockClaimCount,
      findUnique:  mockClaimFindUnique,
      update:      mockClaimUpdate,
    },
  })),
}));

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({ on: jest.fn(), pipe: jest.fn() }),
  existsSync: jest.fn().mockReturnValue(true),
}));

const request = require('supertest');
const app     = require('../src/index');

afterEach(() => jest.clearAllMocks());

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeLeaveApp({ employeeId = 'E001', code = 'ML', name = 'Maternity Leave', days = 5 } = {}) {
  return { employeeId, leaveType: { code, name, isGovtPaid: true }, totalDays: days };
}

function makePayslip({ employeeId = 'E001', govtPaidDays = 5, govtPaidAmount = '1500' } = {}) {
  return { employeeId, govtPaidDays, govtPaidAmountEnc: govtPaidAmount, isPublished: true };
}

function mockLeaveService(applications) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ applications }),
  });
}

function mockClaimRow(overrides = {}) {
  return {
    id: 'claim-001', employeeId: 'E001', period: '2026-05',
    leaveTypeCode: 'ML', leaveTypeName: 'Maternity Leave',
    leaveDays: 5, dailyRateEnc: '300', claimableAmountEnc: '1500',
    cpfOnGovtPaidEnc: null, nsMakeupAmountEnc: null, nsAllowancePerDay: null,
    status: 'PENDING', submissionRef: null, submittedAt: null,
    reimbursedAmountEnc: null, reimbursedAt: null, notes: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

// ── G1-G5: POST /payroll/govt-leave-claims/generate ──────────────────────────
describe('G1-G5: POST /payroll/govt-leave-claims/generate', () => {
  test('G1 — 400 if period missing', async () => {
    const res = await request(app).post('/payroll/govt-leave-claims/generate');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/period/i);
  });

  test('G2 — 400 if period format invalid', async () => {
    const res = await request(app).post('/payroll/govt-leave-claims/generate?period=2026/05');
    expect(res.status).toBe(400);
  });

  test('G3 — 200 with empty message when no govt-paid leave found', async () => {
    mockLeaveService([]); // no approved leaves
    const res = await request(app).post('/payroll/govt-leave-claims/generate?period=2026-05');
    expect(res.status).toBe(200);
    expect(res.body.generated).toBe(0);
    expect(res.body.message).toMatch(/no govt-paid leave/i);
  });

  test('G4 — 201 generates ML claim for employee with payslip govtPaidDays', async () => {
    mockLeaveService([makeLeaveApp()]);
    mockPayslipFindMany.mockResolvedValue([makePayslip()]);
    mockClaimUpsert.mockResolvedValue(mockClaimRow());

    const res = await request(app).post('/payroll/govt-leave-claims/generate?period=2026-05');
    expect(res.status).toBe(201);
    expect(res.body.generated).toBe(1);
    expect(mockClaimUpsert).toHaveBeenCalledTimes(1);

    const createData = mockClaimUpsert.mock.calls[0][0].create;
    expect(createData.leaveTypeCode).toBe('ML');
    expect(createData.leaveDays).toBe(5);
    // dailyRate = govtPaidAmount / govtPaidDays = 1500 / 5 = 300
    expect(parseFloat(createData.dailyRateEnc)).toBe(300);
    // claimable = min(300, 500) × 5 = 1500 (300 < 500 cap)
    expect(parseFloat(createData.claimableAmountEnc)).toBe(1500);
  });

  test('G5 — employee skipped when no matching payslip', async () => {
    mockLeaveService([makeLeaveApp({ employeeId: 'E002' })]);
    mockPayslipFindMany.mockResolvedValue([]); // no payslips
    mockClaimUpsert.mockResolvedValue(mockClaimRow());

    const res = await request(app).post('/payroll/govt-leave-claims/generate?period=2026-05');
    expect(res.status).toBe(201);
    expect(res.body.generated).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.skippedDetails[0].employeeId).toBe('E002');
  });
});

// ── G6-G8: MSF daily cap enforcement ─────────────────────────────────────────
describe('G6-G8: MSF daily cap enforcement', () => {
  test('G6 — ML: daily rate above SGD 500 cap is clamped', async () => {
    // govtPaidAmount = 3000, govtPaidDays = 5 → dailyRate = 600 > 500 cap
    mockLeaveService([makeLeaveApp({ days: 5 })]);
    mockPayslipFindMany.mockResolvedValue([makePayslip({ govtPaidDays: 5, govtPaidAmount: '3000' })]);
    mockClaimUpsert.mockResolvedValue(mockClaimRow());

    await request(app).post('/payroll/govt-leave-claims/generate?period=2026-05');

    const createData = mockClaimUpsert.mock.calls[0][0].create;
    expect(parseFloat(createData.dailyRateEnc)).toBe(600);
    expect(parseFloat(createData.claimableAmountEnc)).toBe(2500); // 500 × 5
  });

  test('G7 — CCL: daily rate above SGD 100 cap is clamped', async () => {
    // 3 days CCL at daily rate 200 → cap 100 → claimable = 300
    mockLeaveService([makeLeaveApp({ code: 'CCL', name: 'Child Care Leave', days: 3 })]);
    mockPayslipFindMany.mockResolvedValue([makePayslip({ govtPaidDays: 3, govtPaidAmount: '600' })]);
    mockClaimUpsert.mockResolvedValue(mockClaimRow());

    await request(app).post('/payroll/govt-leave-claims/generate?period=2026-05');

    const createData = mockClaimUpsert.mock.calls[0][0].create;
    expect(parseFloat(createData.dailyRateEnc)).toBe(200);
    expect(parseFloat(createData.claimableAmountEnc)).toBe(300); // 100 × 3
  });

  test('G8 — PL: daily rate below cap — no clamping', async () => {
    // 2 days PL at daily rate 400 < 500 cap → claimable = 800
    mockLeaveService([makeLeaveApp({ code: 'PL', name: 'Paternity Leave', days: 2 })]);
    mockPayslipFindMany.mockResolvedValue([makePayslip({ govtPaidDays: 2, govtPaidAmount: '800' })]);
    mockClaimUpsert.mockResolvedValue(mockClaimRow());

    await request(app).post('/payroll/govt-leave-claims/generate?period=2026-05');

    const createData = mockClaimUpsert.mock.calls[0][0].create;
    expect(parseFloat(createData.claimableAmountEnc)).toBe(800);
  });
});

// ── G9-G10: NS make-up pay ────────────────────────────────────────────────────
describe('G9-G10: NS make-up pay formula', () => {
  test('G9 — NSL: nsMakeupAmount = (dailyRate - nsAllowancePerDay) × days', async () => {
    // dailyRate = 1000/5 = 200; NS allowance = 80; makeup = (200-80) × 5 = 600
    mockLeaveService([makeLeaveApp({ code: 'NSL', name: 'NS Leave', days: 5 })]);
    mockPayslipFindMany.mockResolvedValue([makePayslip({ govtPaidDays: 5, govtPaidAmount: '1000' })]);
    mockClaimUpsert.mockResolvedValue(mockClaimRow());

    await request(app).post('/payroll/govt-leave-claims/generate?period=2026-05&nsAllowancePerDay=80');

    const createData = mockClaimUpsert.mock.calls[0][0].create;
    expect(parseFloat(createData.nsMakeupAmountEnc)).toBe(600);
    expect(parseFloat(createData.claimableAmountEnc)).toBe(600); // claimable = makeup for NSL
    expect(createData.nsAllowancePerDay).toBe(80);
  });

  test('G10 — NSL: nsAllowancePerDay defaults to 0 → full civilian rate claimed', async () => {
    mockLeaveService([makeLeaveApp({ code: 'NSL', name: 'NS Leave', days: 3 })]);
    mockPayslipFindMany.mockResolvedValue([makePayslip({ govtPaidDays: 3, govtPaidAmount: '900' })]);
    mockClaimUpsert.mockResolvedValue(mockClaimRow());

    await request(app).post('/payroll/govt-leave-claims/generate?period=2026-05');

    const createData = mockClaimUpsert.mock.calls[0][0].create;
    expect(parseFloat(createData.nsMakeupAmountEnc)).toBe(900); // 300 × 3
  });
});

// ── G11-G13: GET /payroll/govt-leave-claims ───────────────────────────────────
describe('G11-G13: GET /payroll/govt-leave-claims', () => {
  test('G11 — 200 returns paginated list', async () => {
    mockClaimFindMany.mockResolvedValue([mockClaimRow()]);
    mockClaimCount.mockResolvedValue(1);

    const res = await request(app).get('/payroll/govt-leave-claims');
    expect(res.status).toBe(200);
    expect(res.body.claims).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  test('G12 — filters by period and status are forwarded to Prisma where clause', async () => {
    mockClaimFindMany.mockResolvedValue([]);
    mockClaimCount.mockResolvedValue(0);

    await request(app).get('/payroll/govt-leave-claims?period=2026-05&status=PENDING');
    expect(mockClaimFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ period: '2026-05', status: 'PENDING' }) })
    );
  });

  test('G13 — filters by leaveTypeCode and employeeId', async () => {
    mockClaimFindMany.mockResolvedValue([]);
    mockClaimCount.mockResolvedValue(0);

    await request(app).get('/payroll/govt-leave-claims?leaveTypeCode=ML&employeeId=E001');
    expect(mockClaimFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ leaveTypeCode: 'ML', employeeId: 'E001' }) })
    );
  });
});

// ── G14: GET /payroll/govt-leave-claims/summary ───────────────────────────────
describe('G14: GET /payroll/govt-leave-claims/summary', () => {
  test('G14 — 200 returns aggregated totals', async () => {
    mockClaimFindMany.mockResolvedValue([
      mockClaimRow({ status: 'PENDING',   claimableAmountEnc: '1500' }),
      mockClaimRow({ id: 'c2', leaveTypeCode: 'NSL', leaveTypeName: 'NS Leave', status: 'SUBMITTED', claimableAmountEnc: '600', nsMakeupAmountEnc: '600' }),
    ]);

    const res = await request(app).get('/payroll/govt-leave-claims/summary?period=2026-05');
    expect(res.status).toBe(200);
    expect(res.body.totalClaims).toBe(2);
    expect(res.body.totalClaimable).toBe(2100);
    expect(res.body.byStatus.PENDING).toBe(1);
    expect(res.body.byStatus.SUBMITTED).toBe(1);
    expect(res.body.byType.ML).toBeDefined();
    expect(res.body.byType.NSL).toBeDefined();
    expect(res.body.totalNsMakeup).toBe(600);
  });

  test('G14b — 400 when period missing', async () => {
    const res = await request(app).get('/payroll/govt-leave-claims/summary');
    expect(res.status).toBe(400);
  });
});

// ── G15-G19: PUT /payroll/govt-leave-claims/:id ───────────────────────────────
describe('G15-G19: PUT /payroll/govt-leave-claims/:id', () => {
  test('G15 — 404 when claim not found', async () => {
    mockClaimFindUnique.mockResolvedValue(null);
    const res = await request(app).put('/payroll/govt-leave-claims/bad-id').send({ status: 'SUBMITTED' });
    expect(res.status).toBe(404);
  });

  test('G16 — PENDING → SUBMITTED: stamps submittedAt', async () => {
    mockClaimFindUnique.mockResolvedValue(mockClaimRow({ status: 'PENDING' }));
    mockClaimUpdate.mockResolvedValue(mockClaimRow({ status: 'SUBMITTED', submissionRef: 'REF-001', submittedAt: new Date() }));

    const res = await request(app).put('/payroll/govt-leave-claims/claim-001').send({ status: 'SUBMITTED', submissionRef: 'REF-001' });
    expect(res.status).toBe(200);
    const updateData = mockClaimUpdate.mock.calls[0][0].data;
    expect(updateData.status).toBe('SUBMITTED');
    expect(updateData.submittedAt).toBeDefined();
    expect(updateData.submissionRef).toBe('REF-001');
  });

  test('G17 — SUBMITTED → REIMBURSED: stamps reimbursedAt + stores amount', async () => {
    mockClaimFindUnique.mockResolvedValue(mockClaimRow({ status: 'SUBMITTED' }));
    mockClaimUpdate.mockResolvedValue(mockClaimRow({ status: 'REIMBURSED' }));

    const res = await request(app).put('/payroll/govt-leave-claims/claim-001').send({ status: 'REIMBURSED', reimbursedAmount: 1450 });
    expect(res.status).toBe(200);
    const updateData = mockClaimUpdate.mock.calls[0][0].data;
    expect(updateData.status).toBe('REIMBURSED');
    expect(updateData.reimbursedAt).toBeDefined();
    expect(parseFloat(updateData.reimbursedAmountEnc)).toBe(1450);
  });

  test('G18 — 409 on invalid transition (PENDING → REIMBURSED)', async () => {
    mockClaimFindUnique.mockResolvedValue(mockClaimRow({ status: 'PENDING' }));
    const res = await request(app).put('/payroll/govt-leave-claims/claim-001').send({ status: 'REIMBURSED' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot transition/i);
  });

  test('G19 — 409 on transition from terminal state (REIMBURSED → SUBMITTED)', async () => {
    mockClaimFindUnique.mockResolvedValue(mockClaimRow({ status: 'REIMBURSED' }));
    const res = await request(app).put('/payroll/govt-leave-claims/claim-001').send({ status: 'SUBMITTED' });
    expect(res.status).toBe(409);
  });
});
