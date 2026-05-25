'use strict';

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = { sub: req.headers['x-user-id'] || 'user-1', role: req.headers['x-user-role'] || 'HR_ADMIN' };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    FINANCE_ADMIN: 'FINANCE_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
    MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const mockDb = {
  reportTemplate: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  reportSchedule: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  reportRun: { findMany: jest.fn(), create: jest.fn() },
  statutorySubmission: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockDb) }));
jest.mock('axios');
const axios = require('axios');

const request = require('supertest');
const { app } = require('../src/index');

const ADMIN = { 'x-user-role': 'HR_ADMIN', 'x-user-id': 'user-admin', authorization: 'Bearer test' };
const PAYROLL = { 'x-user-role': 'PAYROLL_OFFICER', 'x-user-id': 'user-pay', authorization: 'Bearer test' };

const SAMPLE_EMPLOYEES = [
  { id: 'emp-1', employeeCode: 'E001', fullName: 'Alice Tan', nric: 'S1234567A', nationality: 'Singapore Citizen', workPassType: 'SC', employmentType: 'FULL_TIME', isActive: true, joinDate: '2024-01-15', gender: 'Female' },
  { id: 'emp-2', employeeCode: 'E002', fullName: 'Bob Chen', fin: 'G7654321P', nationality: 'Malaysian', workPassType: 'WP', employmentType: 'FULL_TIME', isActive: true, joinDate: '2026-05-01', gender: 'Male' },
  { id: 'emp-3', employeeCode: 'E003', fullName: 'Carol Lim', nric: 'S9876543B', nationality: 'Singapore Citizen', workPassType: 'SC', employmentType: 'PART_TIME', isActive: true, joinDate: '2025-03-10', gender: 'Female' },
];

const SAMPLE_RUNS = { runs: [{ id: 'run-001', period: '2026-05', status: 'FINALISED' }] };

const SAMPLE_PAYSLIPS_FWL = {
  payslips: [
    { employeeId: 'emp-2', period: '2026-05', grossPay: 2500, netPay: 2100, sdl: 6.25, fwl: 600, ytdGross: 12500 },
  ],
};

const SAMPLE_PAYSLIPS_SDL = {
  payslips: [
    { employeeId: 'emp-1', period: '2026-05', grossPay: 5000, netPay: 4300, sdl: 11.25, fwl: 0, ytdGross: 25000 },
    { employeeId: 'emp-2', period: '2026-05', grossPay: 2500, netPay: 2100, sdl: 6.25, fwl: 600, ytdGross: 12500 },
    { employeeId: 'emp-3', period: '2026-05', grossPay: 1500, netPay: 1300, sdl: 3.75, fwl: 0, ytdGross: 7500 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── S1-S4: FWL Report ─────────────────────────────────────────────────────────
describe('GET /reports/fwl/:period', () => {
  test('S1 — returns FWL breakdown for WP employees', async () => {
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_RUNS })                              // runs
      .mockResolvedValueOnce({ data: SAMPLE_PAYSLIPS_FWL })                      // payslips for run-001
      .mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });         // employee list

    const res = await request(app).get('/reports/fwl/2026-05').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('2026-05');
    expect(res.body.totalEmployees).toBe(1);
    expect(res.body.totals.totalFwl).toBe(600);
    expect(res.body.rows[0].employeeId).toBe('emp-2');
    expect(res.body.rows[0].fwlAmount).toBe(600);
    expect(res.body.rows[0].passType).toBe('WP');
  });

  test('S2 — returns empty result when no finalised runs', async () => {
    axios.get.mockResolvedValueOnce({ data: { runs: [] } });

    const res = await request(app).get('/reports/fwl/2026-01').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.totals.totalFwl).toBe(0);
  });

  test('S3 — employees with fwl=0 are excluded from FWL report', async () => {
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_RUNS })
      .mockResolvedValueOnce({ data: SAMPLE_PAYSLIPS_SDL })      // payslips — emp-1 and emp-3 have fwl=0
      .mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });

    const res = await request(app).get('/reports/fwl/2026-05').set(ADMIN);
    expect(res.status).toBe(200);
    // Only emp-2 has fwl > 0
    expect(res.body.totalEmployees).toBe(1);
    expect(res.body.rows[0].employeeId).toBe('emp-2');
  });

  test('S4 — byPassType breakdown in totals', async () => {
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_RUNS })
      .mockResolvedValueOnce({ data: SAMPLE_PAYSLIPS_FWL })
      .mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });

    const res = await request(app).get('/reports/fwl/2026-05').set(ADMIN);
    expect(res.body.totals.byPassType).toHaveProperty('WP');
    expect(res.body.totals.byPassType.WP).toBe(600);
  });
});

// ── S5-S8: SDL Summary ────────────────────────────────────────────────────────
describe('GET /reports/sdl-summary/:period', () => {
  test('S5 — returns total SDL and per-employee breakdown', async () => {
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_RUNS })
      .mockResolvedValueOnce({ data: SAMPLE_PAYSLIPS_SDL })
      .mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });

    const res = await request(app).get('/reports/sdl-summary/2026-05').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.period).toBe('2026-05');
    expect(res.body.totalEmployees).toBe(3);
    // 11.25 + 6.25 + 3.75 = 21.25
    expect(res.body.totalSdl).toBe(21.25);
    expect(res.body.rows).toHaveLength(3);
    expect(res.body.ssgSubmissionNote).toContain('21.25');
  });

  test('S6 — returns empty when no finalised runs', async () => {
    axios.get.mockResolvedValueOnce({ data: { runs: [] } });
    const res = await request(app).get('/reports/sdl-summary/2026-01').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.totalSdl).toBe(0);
  });

  test('S7 — rows include fullName from employee service', async () => {
    axios.get
      .mockResolvedValueOnce({ data: SAMPLE_RUNS })
      .mockResolvedValueOnce({ data: { payslips: [
        { employeeId: 'emp-1', grossPay: 5000, sdl: 11.25, fwl: 0 },
      ]} })
      .mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });

    const res = await request(app).get('/reports/sdl-summary/2026-05').set(PAYROLL);
    expect(res.status).toBe(200);
    expect(res.body.rows[0].fullName).toBe('Alice Tan');
    expect(res.body.rows[0].sdlAmount).toBe(11.25);
  });
});

// ── S9-S12: MOM Headcount ─────────────────────────────────────────────────────
describe('GET /reports/mom-headcount', () => {
  test('S9 — returns headcount breakdown by nationality and pass type', async () => {
    axios.get.mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });

    const res = await request(app).get('/reports/mom-headcount?year=2026&month=5').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.reportType).toBe('MOM_MONTHLY_HEADCOUNT');
    expect(res.body.year).toBe(2026);
    expect(res.body.month).toBe(5);
    expect(res.body.summary.totalActive).toBe(3);
    expect(res.body.byPassType).toBeDefined();
  });

  test('S10 — counts new hires within the reporting month', async () => {
    axios.get.mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });

    const res = await request(app).get('/reports/mom-headcount?year=2026&month=5').set(ADMIN);
    // emp-2 joined 2026-05-01
    expect(res.body.summary.newHires).toBe(1);
  });

  test('S11 — gender breakdown', async () => {
    axios.get.mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });

    const res = await request(app).get('/reports/mom-headcount?year=2026&month=5').set(ADMIN);
    expect(res.body.summary.male).toBe(1);
    expect(res.body.summary.female).toBe(2);
  });

  test('S12 — residents vs foreigners split', async () => {
    axios.get.mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });

    const res = await request(app).get('/reports/mom-headcount?year=2026&month=5').set(ADMIN);
    // emp-1, emp-3 = SC (residents), emp-2 = WP (foreigner)
    expect(res.body.summary.residents).toBe(2);
    expect(res.body.summary.foreigners).toBe(1);
  });
});

// ── S13-S14: MOM Manpower Survey ──────────────────────────────────────────────
describe('GET /reports/mom-manpower-survey', () => {
  test('S13 — returns annual survey data', async () => {
    axios.get.mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });

    const res = await request(app).get('/reports/mom-manpower-survey?year=2026').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.reportType).toBe('MOM_ANNUAL_MANPOWER_SURVEY');
    expect(res.body.year).toBe(2026);
    expect(res.body.totalEmployees).toBe(3);
    expect(res.body.surveyNote).toContain('2026');
  });

  test('S14 — counts new hires for the year', async () => {
    axios.get.mockResolvedValueOnce({ data: { employees: SAMPLE_EMPLOYEES } });

    const res = await request(app).get('/reports/mom-manpower-survey?year=2026').set(ADMIN);
    // emp-2 joined 2026-05-01 (within 2026)
    expect(res.body.newHires).toBe(1);
  });
});

// ── S15-S20: Submission history ───────────────────────────────────────────────
describe('POST /reports/submissions', () => {
  const SUB_ROW = {
    id: 'sub-001', type: 'SDL_SSG', period: '2026-05', status: 'DRAFT',
    referenceNumber: null, fileName: null, notes: null,
    submittedAt: null, submittedBy: 'user-admin', acknowledgedAt: null,
    createdAt: new Date(), updatedAt: new Date(),
  };

  test('S15 — creates a DRAFT submission record', async () => {
    mockDb.statutorySubmission.create.mockResolvedValue(SUB_ROW);

    const res = await request(app).post('/reports/submissions').set(ADMIN)
      .send({ type: 'SDL_SSG', period: '2026-05' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('SDL_SSG');
    expect(res.body.status).toBe('DRAFT');
  });

  test('S16 — 400 when type missing', async () => {
    const res = await request(app).post('/reports/submissions').set(ADMIN)
      .send({ period: '2026-05' });
    expect(res.status).toBe(400);
  });

  test('S17 — 400 when type is invalid', async () => {
    const res = await request(app).post('/reports/submissions').set(ADMIN)
      .send({ type: 'BOGUS', period: '2026-05' });
    expect(res.status).toBe(400);
  });

  test('S18 — 400 when period missing', async () => {
    const res = await request(app).post('/reports/submissions').set(ADMIN)
      .send({ type: 'CPF_E_SUBMIT' });
    expect(res.status).toBe(400);
  });
});

describe('GET /reports/submissions', () => {
  test('S19 — lists submissions with total', async () => {
    const rows = [
      { id: 'sub-001', type: 'SDL_SSG', period: '2026-05', status: 'DRAFT' },
      { id: 'sub-002', type: 'CPF_E_SUBMIT', period: '2026-05', status: 'SUBMITTED' },
    ];
    mockDb.statutorySubmission.findMany.mockResolvedValue(rows);
    mockDb.statutorySubmission.count.mockResolvedValue(2);

    const res = await request(app).get('/reports/submissions').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.submissions).toHaveLength(2);
    expect(res.body.total).toBe(2);
  });
});

describe('PUT /reports/submissions/:id', () => {
  test('S20 — marks submission as SUBMITTED and stamps submittedAt', async () => {
    const existing = { id: 'sub-001', type: 'CPF_E_SUBMIT', period: '2026-05', status: 'DRAFT', submittedAt: null, acknowledgedAt: null };
    const updated  = { ...existing, status: 'SUBMITTED', submittedAt: new Date(), referenceNumber: 'CPF-2026-001' };
    mockDb.statutorySubmission.findUnique.mockResolvedValue(existing);
    mockDb.statutorySubmission.update.mockResolvedValue(updated);

    const res = await request(app).put('/reports/submissions/sub-001').set(ADMIN)
      .send({ status: 'SUBMITTED', referenceNumber: 'CPF-2026-001' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.referenceNumber).toBe('CPF-2026-001');
    expect(mockDb.statutorySubmission.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submittedAt: expect.any(Date) }) }),
    );
  });
});
