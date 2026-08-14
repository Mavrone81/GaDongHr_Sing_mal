'use strict';
/**
 * Integration tests for BIK / Appendix 8A & 8B routes.
 *
 * Covers:
 *   - POST   /payroll/bik-items          (upsert with IRAS formula + MANUAL methods)
 *   - GET    /payroll/bik-items
 *   - GET    /payroll/bik-items/:id
 *   - PUT    /payroll/bik-items/:id
 *   - DELETE /payroll/bik-items/:id
 *   - POST   /payroll/stock-options
 *   - POST   /payroll/stock-options/:id/exercises
 *   - GET    /payroll/appendix-8a/:year
 *   - GET    /payroll/appendix-8a-file/:year
 *   - GET    /payroll/appendix-8b/:year
 *   - GET    /payroll/appendix-8b-file/:year
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER', EMPLOYEE: 'EMPLOYEE' },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encrypt: v => v,                     // pass-through for tests
  decrypt: v => v,
  encryptNumber: v => String(v),
  decryptNumber: v => parseFloat(v),
}), { virtual: true });

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

const mockBikFindMany   = jest.fn();
const mockBikFindUnique = jest.fn();
const mockBikCreate     = jest.fn();
const mockBikUpdate     = jest.fn();
const mockBikDelete     = jest.fn();

const mockSoGrantCreate     = jest.fn();
const mockSoGrantFindMany   = jest.fn();
const mockSoGrantFindUnique = jest.fn();
const mockSoGrantUpdate     = jest.fn();
const mockSoGrantDelete     = jest.fn();

const mockSoExerciseCreate     = jest.fn();
const mockSoExerciseFindMany   = jest.fn();
const mockSoExerciseDelete     = jest.fn();

// Shared payroll-side mocks used by the IR8A regression tests below.
const mockPayslipFindMany     = jest.fn().mockResolvedValue([]);
const mockLineItemFindMany    = jest.fn().mockResolvedValue([]);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    bikItem: {
      findMany: mockBikFindMany,
      findUnique: mockBikFindUnique,
      create: mockBikCreate,
      update: mockBikUpdate,
      delete: mockBikDelete,
    },
    stockOptionGrant: {
      create: mockSoGrantCreate,
      findMany: mockSoGrantFindMany,
      findUnique: mockSoGrantFindUnique,
      update: mockSoGrantUpdate,
      delete: mockSoGrantDelete,
    },
    stockOptionExercise: {
      create: mockSoExerciseCreate,
      findMany: mockSoExerciseFindMany,
      delete: mockSoExerciseDelete,
    },
    // ── Stubs for payroll.routes.js so app boots ────────────────────────────
    payrollRun: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    payrollLineItem: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: mockLineItemFindMany, create: jest.fn(), delete: jest.fn() },
    // ENT-006 dual-write target. Payroll writes one row per statutory
    // figure alongside the legacy SG-named columns.
    payslipStatutoryLine: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    payslip: { deleteMany: jest.fn(), createMany: jest.fn(), upsert: jest.fn(), findMany: mockPayslipFindMany, update: jest.fn(), updateMany: jest.fn() },
    cpfRate: { findMany: jest.fn() },
    sdlConfig: { findFirst: jest.fn() },
    payrollComponent: { findMany: jest.fn().mockResolvedValue([]) },
    payrollOverride: { findMany: jest.fn().mockResolvedValue([]) },
    payComponent: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    payrollPeriodConfig: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    publicHoliday: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), delete: jest.fn() },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({ on: jest.fn(), pipe: jest.fn() }),
  existsSync: jest.fn().mockReturnValue(true),
}));

const request = require('supertest');
const app = require('../src/index');

afterEach(() => jest.clearAllMocks());

// ── BIK Items ─────────────────────────────────────────────────────────────────

describe('POST /payroll/bik-items', () => {
  test('400 when employeeId/year/bikType missing', async () => {
    const res = await request(app).post('/payroll/bik-items').send({ employeeId: 'emp-1' });
    expect(res.status).toBe(400);
  });

  test('400 when bikType is not in allowed set', async () => {
    const res = await request(app).post('/payroll/bik-items').send({
      employeeId: 'emp-1', year: 2026, bikType: 'YACHT',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bikType must be one of/);
  });

  test('201 — creates COMPANY_CAR BIK with IRAS formula; computes (3/7) × cost', async () => {
    mockBikFindUnique.mockResolvedValue(null);
    mockBikCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'bik-1', ...data }));

    const res = await request(app).post('/payroll/bik-items').send({
      employeeId: 'emp-1', year: 2026, bikType: 'COMPANY_CAR',
      carPurchaseCost: 70000, engineCapacity: 1600,
    });

    expect(res.status).toBe(201);
    expect(res.body.annualValue).toBeCloseTo(30000, 2); // 70000 × 3/7
    expect(res.body.annualValueEnc).toBe('30000'); // crypto mocked as pass-through
    expect(mockBikCreate).toHaveBeenCalled();
  });

  test('201 — HOUSING BIK uses housing AV directly', async () => {
    mockBikFindUnique.mockResolvedValue(null);
    mockBikCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'bik-2', ...data }));

    const res = await request(app).post('/payroll/bik-items').send({
      employeeId: 'emp-1', year: 2026, bikType: 'HOUSING', housingAnnualValue: 24000,
    });

    expect(res.status).toBe(201);
    expect(res.body.annualValue).toBe(24000);
  });

  test('201 — MANUAL method stores supplied annualValue without recompute', async () => {
    mockBikFindUnique.mockResolvedValue(null);
    mockBikCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'bik-3', ...data }));

    const res = await request(app).post('/payroll/bik-items').send({
      employeeId: 'emp-1', year: 2026, bikType: 'CLUB_MEMBERSHIP',
      computationMethod: 'MANUAL', annualValue: 4500,
    });

    expect(res.status).toBe(201);
    expect(res.body.annualValue).toBe(4500);
    expect(res.body.computationMethod).toBe('MANUAL');
  });

  test('200 — upserts when (employeeId, year, bikType) already exists', async () => {
    mockBikFindUnique.mockResolvedValue({ id: 'bik-existing', employeeId: 'emp-1', year: 2026, bikType: 'HOUSING' });
    mockBikUpdate.mockImplementation(({ data }) => Promise.resolve({ id: 'bik-existing', ...data }));

    const res = await request(app).post('/payroll/bik-items').send({
      employeeId: 'emp-1', year: 2026, bikType: 'HOUSING', housingAnnualValue: 30000,
    });

    expect(res.status).toBe(200); // existing → update
    expect(mockBikUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'bik-existing' } }));
    expect(res.body.annualValue).toBe(30000);
  });
});

describe('GET /payroll/bik-items', () => {
  test('200 — returns items with decrypted annualValue', async () => {
    mockBikFindMany.mockResolvedValue([
      { id: 'bik-1', employeeId: 'emp-1', year: 2026, bikType: 'COMPANY_CAR', annualValueEnc: '30000' },
      { id: 'bik-2', employeeId: 'emp-2', year: 2026, bikType: 'HOUSING',     annualValueEnc: '18000' },
    ]);

    const res = await request(app).get('/payroll/bik-items?year=2026');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.items[0].annualValue).toBe(30000);
    expect(res.body.items[1].annualValue).toBe(18000);
  });

  test('passes year + employeeId filters to Prisma', async () => {
    mockBikFindMany.mockResolvedValue([]);
    await request(app).get('/payroll/bik-items?year=2025&employeeId=emp-9&bikType=HOUSING');
    expect(mockBikFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { year: 2025, employeeId: 'emp-9', bikType: 'HOUSING' },
    }));
  });
});

describe('PUT /payroll/bik-items/:id', () => {
  test('404 when not found', async () => {
    mockBikFindUnique.mockResolvedValue(null);
    const res = await request(app).put('/payroll/bik-items/bik-x').send({ carPurchaseCost: 99999 });
    expect(res.status).toBe(404);
  });

  test('200 — recomputes annualValue on input change', async () => {
    mockBikFindUnique.mockResolvedValue({
      id: 'bik-1', employeeId: 'emp-1', year: 2026, bikType: 'COMPANY_CAR',
      carPurchaseCost: 70000, engineCapacity: 1600, employerProvidesFuel: false,
      runningCost: 0, housingAnnualValue: null, annualValueEnc: '30000',
      computationMethod: 'IRAS_FORMULA', description: null, notes: null,
    });
    mockBikUpdate.mockImplementation(({ data }) => Promise.resolve({ id: 'bik-1', ...data }));

    const res = await request(app).put('/payroll/bik-items/bik-1').send({
      carPurchaseCost: 140000,
    });
    expect(res.status).toBe(200);
    expect(res.body.annualValue).toBeCloseTo(60000, 2); // 140000 × 3/7
  });
});

describe('DELETE /payroll/bik-items/:id', () => {
  test('200 — deletes', async () => {
    mockBikDelete.mockResolvedValue({});
    const res = await request(app).delete('/payroll/bik-items/bik-1');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  test('404 — when prisma returns P2025', async () => {
    mockBikDelete.mockRejectedValue({ code: 'P2025' });
    const res = await request(app).delete('/payroll/bik-items/bik-x');
    expect(res.status).toBe(404);
  });
});

// ── Stock Options ─────────────────────────────────────────────────────────────

describe('POST /payroll/stock-options', () => {
  test('400 when required fields missing', async () => {
    const res = await request(app).post('/payroll/stock-options').send({ employeeId: 'emp-1' });
    expect(res.status).toBe(400);
  });

  test('201 — creates grant with defaults', async () => {
    mockSoGrantCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'g-1', ...data }));
    const res = await request(app).post('/payroll/stock-options').send({
      employeeId: 'emp-1', grantDate: '2025-01-15', totalShares: 5000, optionPrice: 10,
    });
    expect(res.status).toBe(201);
    expect(res.body.scheme).toBe('ESOP');
    expect(res.body.totalShares).toBe(5000);
  });
});

describe('POST /payroll/stock-options/:id/exercises', () => {
  test('404 when grant not found', async () => {
    mockSoGrantFindUnique.mockResolvedValue(null);
    const res = await request(app).post('/payroll/stock-options/g-x/exercises').send({
      exerciseDate: '2026-03-01', sharesExercised: 100, marketValueAtExercise: 25,
    });
    expect(res.status).toBe(404);
  });

  test('201 — computes taxable gain = (OMV − option price) × shares', async () => {
    mockSoGrantFindUnique.mockResolvedValue({ id: 'g-1', employeeId: 'emp-1', optionPrice: 10 });
    mockSoExerciseCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'ex-1', ...data }));

    const res = await request(app).post('/payroll/stock-options/g-1/exercises').send({
      exerciseDate: '2026-03-01', sharesExercised: 1000, marketValueAtExercise: 25,
    });

    expect(res.status).toBe(201);
    expect(res.body.taxableGain).toBe(15000); // (25 − 10) × 1000
    expect(res.body.taxableGainEnc).toBe('15000');
  });

  test('underwater exercise yields 0 gain', async () => {
    mockSoGrantFindUnique.mockResolvedValue({ id: 'g-1', employeeId: 'emp-1', optionPrice: 30 });
    mockSoExerciseCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'ex-2', ...data }));

    const res = await request(app).post('/payroll/stock-options/g-1/exercises').send({
      exerciseDate: '2026-03-01', sharesExercised: 1000, marketValueAtExercise: 20,
    });

    expect(res.status).toBe(201);
    expect(res.body.taxableGain).toBe(0);
  });
});

// ── Appendix 8A aggregation ───────────────────────────────────────────────────

describe('GET /payroll/appendix-8a/:year', () => {
  test('200 — aggregates BIK totals per employee per type', async () => {
    mockBikFindMany.mockResolvedValue([
      { employeeId: 'emp-1', year: 2026, bikType: 'COMPANY_CAR', annualValueEnc: '30000' },
      { employeeId: 'emp-1', year: 2026, bikType: 'HOUSING',     annualValueEnc: '24000' },
      { employeeId: 'emp-2', year: 2026, bikType: 'COMPANY_CAR', annualValueEnc: '15000' },
    ]);

    const res = await request(app).get('/payroll/appendix-8a/2026');
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.count).toBe(2);

    const emp1 = res.body.records.find(r => r.employeeId === 'emp-1');
    expect(emp1.totalBik).toBe(54000);
    expect(emp1.byType.COMPANY_CAR).toBe(30000);
    expect(emp1.byType.HOUSING).toBe(24000);

    const emp2 = res.body.records.find(r => r.employeeId === 'emp-2');
    expect(emp2.totalBik).toBe(15000);
  });
});

describe('GET /payroll/appendix-8a-file/:year', () => {
  test('200 — returns pipe-delimited IRAS-format file', async () => {
    mockBikFindMany.mockResolvedValue([
      { employeeId: 'emp-1', year: 2026, bikType: 'COMPANY_CAR', annualValueEnc: '30000', description: 'BMW X3' },
    ]);

    const res = await request(app).get('/payroll/appendix-8a-file/2026');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-disposition']).toMatch(/Appendix-8A-2026\.txt/);
    expect(res.text.split('\n')[0]).toMatch(/^APPENDIX_8A\|2026\|/);
    expect(res.text).toContain('emp-1|COMPANY_CAR|30000|BMW X3');
  });
});

// ── Appendix 8B aggregation ───────────────────────────────────────────────────

describe('GET /payroll/appendix-8b/:year', () => {
  test('200 — aggregates exercise gains within the year', async () => {
    mockSoExerciseFindMany.mockResolvedValue([
      {
        id: 'ex-1', grantId: 'g-1', exerciseDate: new Date('2026-03-01'),
        sharesExercised: 1000, marketValueAtExercise: 25, taxableGainEnc: '15000',
        grant: { employeeId: 'emp-1', grantDate: new Date('2025-01-15'), optionPrice: 10, scheme: 'ESOP' },
      },
      {
        id: 'ex-2', grantId: 'g-2', exerciseDate: new Date('2026-06-15'),
        sharesExercised: 500, marketValueAtExercise: 30, taxableGainEnc: '10000',
        grant: { employeeId: 'emp-1', grantDate: new Date('2025-02-01'), optionPrice: 10, scheme: 'ESOP' },
      },
    ]);

    const res = await request(app).get('/payroll/appendix-8b/2026');
    expect(res.status).toBe(200);
    expect(res.body.exercises).toHaveLength(2);
    expect(res.body.totals).toHaveLength(1);
    expect(res.body.totals[0].employeeId).toBe('emp-1');
    expect(res.body.totals[0].totalGain).toBe(25000);
  });
});

describe('GET /payroll/appendix-8b-file/:year', () => {
  test('200 — returns IRAS-format flat-file with header + rows', async () => {
    mockSoExerciseFindMany.mockResolvedValue([
      {
        id: 'ex-1', grantId: 'g-1', exerciseDate: new Date('2026-03-01'),
        sharesExercised: 1000, marketValueAtExercise: 25, taxableGainEnc: '15000',
        grant: { employeeId: 'emp-1', grantDate: new Date('2025-01-15'), optionPrice: 10, scheme: 'ESOP' },
      },
    ]);
    const res = await request(app).get('/payroll/appendix-8b-file/2026');
    expect(res.status).toBe(200);
    expect(res.text.split('\n')[0]).toMatch(/^APPENDIX_8B\|2026\|/);
    expect(res.text).toContain('emp-1|2025-01-15|2026-03-01|1000|10|25|15000|ESOP');
  });
});

// ── REGRESSION: IR8A endpoint now folds in BIK + ESOP totals ──────────────────

describe('Regression — GET /payroll/ir8a-data/:year includes BIK + stock option gains', () => {
  test('records contain benefitsInKind (Appendix 8A) and stockOptionGain (Appendix 8B)', async () => {
    mockPayslipFindMany.mockResolvedValueOnce([
      { id: 'ps-1', employeeId: 'emp-1', period: '2026-12', isPublished: true,
        ytdGrossEnc: '120000', ytdEmployeeCpfEnc: '24000', ytdEmployerCpfEnc: '20400' },
    ]);
    mockLineItemFindMany.mockResolvedValueOnce([
      { employeeId: 'emp-1', wageType: 'AW', isIrasTaxable: true, amountEnc: '12000' },
    ]);
    mockBikFindMany.mockResolvedValueOnce([
      { employeeId: 'emp-1', year: 2026, bikType: 'COMPANY_CAR', annualValueEnc: '30000' },
    ]);
    mockSoExerciseFindMany.mockResolvedValueOnce([
      {
        id: 'ex-1', exerciseDate: new Date('2026-03-01'),
        sharesExercised: 1000, marketValueAtExercise: 25, taxableGainEnc: '15000',
        grant: { employeeId: 'emp-1' },
      },
    ]);

    const res = await request(app).get('/payroll/ir8a-data/2026');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const r = res.body.records[0];
    expect(r.employeeId).toBe('emp-1');
    expect(r.employmentIncome).toBe(120000);
    expect(r.awIncome).toBe(12000);
    expect(r.benefitsInKind).toBe(30000);   // ← Appendix 8A integration
    expect(r.stockOptionGain).toBe(15000);  // ← Appendix 8B integration
  });

  test('IR8A flat-file includes BIK and ESOP columns', async () => {
    mockPayslipFindMany.mockResolvedValueOnce([
      { id: 'ps-1', employeeId: 'emp-1', period: '2026-12', isPublished: true,
        ytdGrossEnc: '120000', ytdEmployeeCpfEnc: '24000', ytdEmployerCpfEnc: '20400' },
    ]);
    mockLineItemFindMany.mockResolvedValueOnce([]);
    mockBikFindMany.mockResolvedValueOnce([
      { employeeId: 'emp-1', year: 2026, bikType: 'HOUSING', annualValueEnc: '18000' },
    ]);
    mockSoExerciseFindMany.mockResolvedValueOnce([
      {
        id: 'ex-1', exerciseDate: new Date('2026-04-15'),
        sharesExercised: 500, marketValueAtExercise: 20, taxableGainEnc: '5000',
        grant: { employeeId: 'emp-1' },
      },
    ]);

    const res = await request(app).get('/payroll/ir8a-file/2026');
    expect(res.status).toBe(200);
    expect(res.text.split('\n')[0]).toMatch(/^IR8A\|2026\|/);
    // Row format: NRIC|name|income|empCpf|erlCpf|aw|bik|esop
    const dataRow = res.text.split('\n')[1];
    const cols = dataRow.split('|');
    expect(cols).toHaveLength(8);            // 8 columns post-change
    expect(parseFloat(cols[6])).toBe(18000); // bik
    expect(parseFloat(cols[7])).toBe(5000);  // esop
  });
});
