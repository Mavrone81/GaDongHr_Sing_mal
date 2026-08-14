'use strict';
/**
 * Integration tests for Cost Centre & Payroll Journal API (PAY-012).
 *
 * Covers:
 *   - POST   /cost-centres
 *   - GET    /cost-centres
 *   - POST   /employees/:id/cost-centres  (with 100% validation)
 *   - POST   /payroll/runs/:id/journal    (idempotent regen, balanced totals)
 *   - GET    /payroll/runs/:id/journal
 *   - GET    /payroll/runs/:id/journal/export?format=csv|xero|quickbooks|sap
 *
 * Regression:
 *   - finalising a run also triggers journal auto-generation
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER', EMPLOYEE: 'EMPLOYEE' },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encrypt: v => v, decrypt: v => v,
  encryptNumber: v => String(v), decryptNumber: v => parseFloat(v),
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

const mockCcCreate     = jest.fn();
const mockCcFindMany   = jest.fn();
const mockCcFindUnique = jest.fn();
const mockCcUpdate     = jest.fn();
const mockCcDelete     = jest.fn();

const mockAllocFindMany   = jest.fn().mockResolvedValue([]);
const mockAllocFindFirst  = jest.fn();
const mockAllocDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
const mockAllocCreateMany = jest.fn().mockResolvedValue({ count: 0 });

const mockJournalFindUnique = jest.fn();
const mockJournalCreate     = jest.fn();
const mockJournalDelete     = jest.fn();
const mockJournalUpdate     = jest.fn();

const mockJournalEntryCreateMany = jest.fn().mockResolvedValue({ count: 0 });

const mockPayslipFindMany = jest.fn().mockResolvedValue([]);
const mockRunFindUnique   = jest.fn();
const mockRunUpdate       = jest.fn().mockResolvedValue({});
const mockPayslipUpdateMany = jest.fn().mockResolvedValue({ count: 0 });

jest.mock('@prisma/client', () => {
  const transaction = jest.fn(async (arg) => {
    if (typeof arg === 'function') {
      // Provide a tx client with the same surface as the main client
      return arg({
        payrollJournal: { findUnique: mockJournalFindUnique, findFirst: mockJournalFindUnique, create: mockJournalCreate, delete: mockJournalDelete, update: mockJournalUpdate },
        payrollJournalEntry: { createMany: mockJournalEntryCreateMany },
        employeeCostCentre: { deleteMany: mockAllocDeleteMany, createMany: mockAllocCreateMany, findMany: mockAllocFindMany },
      });
    }
    // Array transaction
    return Promise.all(arg);
  });

  return {
    PrismaClient: jest.fn().mockImplementation(() => ({
      costCentre: {
        create: mockCcCreate, findMany: mockCcFindMany, findUnique: mockCcFindUnique,
        update: mockCcUpdate, delete: mockCcDelete,
      },
      employeeCostCentre: {
        findMany: mockAllocFindMany, findFirst: mockAllocFindFirst,
        deleteMany: mockAllocDeleteMany, createMany: mockAllocCreateMany,
      },
      payrollJournal: {
        findUnique: mockJournalFindUnique, findFirst: mockJournalFindUnique, create: mockJournalCreate,
        delete: mockJournalDelete, update: mockJournalUpdate,
      },
      payrollJournalEntry: { createMany: mockJournalEntryCreateMany },
      // ENT-006 dual-write target. Payroll writes one row per statutory
      // figure alongside the legacy SG-named columns.
      payslipStatutoryLine: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      payslip: { findMany: mockPayslipFindMany, updateMany: mockPayslipUpdateMany, upsert: jest.fn(), update: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
      payrollRun: { findUnique: mockRunFindUnique, update: mockRunUpdate, findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
      payrollLineItem: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), createMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
      cpfRate: { findMany: jest.fn() },
      sdlConfig: { findFirst: jest.fn() },
      payrollComponent: { findMany: jest.fn().mockResolvedValue([]) },
      payrollOverride: { findMany: jest.fn().mockResolvedValue([]) },
      payComponent: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      payrollPeriodConfig: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      publicHoliday: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), delete: jest.fn() },
      bikItem: { findMany: jest.fn().mockResolvedValue([]) },
      stockOptionExercise: { findMany: jest.fn().mockResolvedValue([]) },
      stockOptionGrant: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
      $transaction: transaction,
    })),
  };
});

jest.mock('dotenv', () => ({ config: () => {} }));
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({ on: jest.fn(), pipe: jest.fn() }),
  existsSync: jest.fn().mockReturnValue(true),
}));

const request = require('supertest');
const app = require('../src/index');

afterEach(() => jest.clearAllMocks());

// ── Cost-centre CRUD ─────────────────────────────────────────────────────────

describe('POST /cost-centres', () => {
  test('400 when code or name missing', async () => {
    const res = await request(app).post('/cost-centres').send({});
    expect(res.status).toBe(400);
  });

  test('201 — creates with normalised uppercase code', async () => {
    mockCcCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'cc-1', ...data }));
    const res = await request(app).post('/cost-centres').send({ code: 'eng-sg', name: 'Engineering SG' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('ENG-SG');
  });

  test('409 — conflict when code already exists', async () => {
    mockCcCreate.mockRejectedValue({ code: 'P2002' });
    const res = await request(app).post('/cost-centres').send({ code: 'ENG', name: 'Eng' });
    expect(res.status).toBe(409);
  });
});

describe('GET /cost-centres', () => {
  test('200 — returns list, filterable by active', async () => {
    mockCcFindMany.mockResolvedValue([
      { id: 'cc-1', code: 'ENG', name: 'Engineering', isActive: true },
      { id: 'cc-2', code: 'OPS', name: 'Operations',  isActive: true },
    ]);
    const res = await request(app).get('/cost-centres?active=true');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(mockCcFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
  });
});

describe('DELETE /cost-centres/:id', () => {
  test('409 — cannot delete if allocated to any employee', async () => {
    mockAllocFindFirst.mockResolvedValue({ id: 'a-1', costCentreId: 'cc-1' });
    const res = await request(app).delete('/cost-centres/cc-1');
    expect(res.status).toBe(409);
  });

  test('200 — deletes when no allocations', async () => {
    mockAllocFindFirst.mockResolvedValue(null);
    mockCcDelete.mockResolvedValue({});
    const res = await request(app).delete('/cost-centres/cc-1');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});

// ── Employee allocations ──────────────────────────────────────────────────────

describe('POST /employees/:id/cost-centres', () => {
  test('400 — when percentages do not sum to 100', async () => {
    const res = await request(app).post('/employees/emp-1/cost-centres').send({
      allocations: [
        { costCentreId: 'cc-1', percentage: 50 },
        { costCentreId: 'cc-2', percentage: 49 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/must sum to 100/);
  });

  test('400 — when cost-centre ids do not all exist', async () => {
    mockCcFindMany.mockResolvedValue([{ id: 'cc-1' }]); // only one of two found
    const res = await request(app).post('/employees/emp-1/cost-centres').send({
      allocations: [
        { costCentreId: 'cc-1', percentage: 60 },
        { costCentreId: 'cc-missing', percentage: 40 },
      ],
    });
    expect(res.status).toBe(400);
  });

  test('200 — replaces allocations atomically when valid', async () => {
    mockCcFindMany.mockResolvedValue([{ id: 'cc-1' }, { id: 'cc-2' }]);
    mockAllocFindMany.mockResolvedValueOnce([
      { id: 'a-1', employeeId: 'emp-1', costCentreId: 'cc-1', percentage: 60, costCentre: { code: 'ENG' } },
      { id: 'a-2', employeeId: 'emp-1', costCentreId: 'cc-2', percentage: 40, costCentre: { code: 'OPS' } },
    ]);

    const res = await request(app).post('/employees/emp-1/cost-centres').send({
      allocations: [
        { costCentreId: 'cc-1', percentage: 60 },
        { costCentreId: 'cc-2', percentage: 40 },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });
});

// ── Journal generation ────────────────────────────────────────────────────────

describe('POST /payroll/runs/:id/journal', () => {
  test('404 when run not found', async () => {
    mockRunFindUnique.mockResolvedValue(null);
    const res = await request(app).post('/payroll/runs/run-x/journal');
    expect(res.status).toBe(404);
  });

  test('400 when run not FINALISED', async () => {
    mockRunFindUnique.mockResolvedValue({ id: 'run-1', period: '2026-05', status: 'APPROVED' });
    const res = await request(app).post('/payroll/runs/run-1/journal');
    expect(res.status).toBe(400);
  });

  test('200 — balanced journal generated from finalised payslips', async () => {
    mockRunFindUnique.mockResolvedValue({ id: 'run-1', period: '2026-05', status: 'FINALISED' });
    mockPayslipFindMany.mockResolvedValueOnce([
      {
        id: 'ps-1', runId: 'run-1', employeeId: 'emp-1', period: '2026-05',
        grossPayEnc: '6000', netPayEnc: '4800', employeeCpfEnc: '1200', employerCpfEnc: '1020',
        sdlAmountEnc: '11.25', fwlAmountEnc: '0',
      },
    ]);
    mockAllocFindMany.mockResolvedValueOnce([]); // no cost centres assigned
    mockJournalFindUnique.mockResolvedValueOnce(null);
    mockJournalCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'j-1', ...data }));

    const res = await request(app).post('/payroll/runs/run-1/journal');
    expect(res.status).toBe(200);
    expect(res.body.balanced).toBe(true);
    expect(res.body.totalDebit).toBeCloseTo(res.body.totalCredit, 2);
    expect(res.body.entryCount).toBeGreaterThan(0);
    expect(mockJournalCreate).toHaveBeenCalled();
    expect(mockJournalEntryCreateMany).toHaveBeenCalled();
  });

  test('idempotent regen — deletes prior journal then re-creates', async () => {
    mockRunFindUnique.mockResolvedValue({ id: 'run-1', period: '2026-05', status: 'FINALISED' });
    mockPayslipFindMany.mockResolvedValueOnce([]);
    mockJournalFindUnique.mockResolvedValueOnce({ id: 'j-old', runId: 'run-1' });
    mockJournalCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'j-new', ...data }));

    const res = await request(app).post('/payroll/runs/run-1/journal');
    expect(res.status).toBe(200);
    expect(mockJournalDelete).toHaveBeenCalledWith({ where: { id: 'j-old' } });
    expect(mockJournalCreate).toHaveBeenCalled();
  });
});

// ── Journal export ────────────────────────────────────────────────────────────

describe('GET /payroll/runs/:id/journal/export', () => {
  const stockJournal = {
    id: 'j-1', runId: 'run-1', period: '2026-05', totalDebit: 7020, totalCredit: 7020, status: 'DRAFT',
    entries: [
      { id: 'e-1', account: '5100', accountName: 'Salary Expense',     side: 'DEBIT',  description: 'Salary', amountEnc: '6000',  costCentre: { code: 'ENG' }, employeeId: 'emp-1' },
      { id: 'e-2', account: '2200', accountName: 'Employee CPF Payable', side: 'CREDIT', description: 'CPF',  amountEnc: '1200',  costCentre: null,            employeeId: 'emp-1' },
      { id: 'e-3', account: '1100', accountName: 'Bank Payable',         side: 'CREDIT', description: 'Net',  amountEnc: '4800',  costCentre: null,            employeeId: 'emp-1' },
    ],
  };

  test('400 — invalid format', async () => {
    mockJournalFindUnique.mockResolvedValueOnce(stockJournal);
    const res = await request(app).get('/payroll/runs/run-1/journal/export?format=excel');
    expect(res.status).toBe(400);
  });

  test('csv format', async () => {
    mockJournalFindUnique.mockResolvedValueOnce(stockJournal);
    mockJournalUpdate.mockResolvedValue({});
    const res = await request(app).get('/payroll/runs/run-1/journal/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/\.csv/);
    expect(res.text.split('\n')[0]).toContain('Date,Account');
  });

  test('xero format', async () => {
    mockJournalFindUnique.mockResolvedValueOnce(stockJournal);
    mockJournalUpdate.mockResolvedValue({});
    const res = await request(app).get('/payroll/runs/run-1/journal/export?format=xero');
    expect(res.status).toBe(200);
    expect(res.text.split('\n')[0]).toBe('Narration,Date,Description,AccountCode,TaxRate,Amount,TrackingName1,TrackingOption1');
  });

  test('quickbooks format yields .iif', async () => {
    mockJournalFindUnique.mockResolvedValueOnce(stockJournal);
    mockJournalUpdate.mockResolvedValue({});
    const res = await request(app).get('/payroll/runs/run-1/journal/export?format=quickbooks');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/\.iif/);
    expect(res.text).toContain('!TRNS');
  });

  test('sap format', async () => {
    mockJournalFindUnique.mockResolvedValueOnce(stockJournal);
    mockJournalUpdate.mockResolvedValue({});
    const res = await request(app).get('/payroll/runs/run-1/journal/export?format=sap');
    expect(res.status).toBe(200);
    expect(res.text.split('\n')[0]).toBe('PostingDate,DocType,GLAccount,Debit,Credit,Currency,ProfitCentre,Text,Reference');
  });

  test('marks journal as EXPORTED on success', async () => {
    mockJournalFindUnique.mockResolvedValueOnce(stockJournal);
    mockJournalUpdate.mockResolvedValue({});
    await request(app).get('/payroll/runs/run-1/journal/export?format=csv');
    expect(mockJournalUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'EXPORTED', exportFormat: 'CSV' }),
    }));
  });
});

// ── Regression: finalise auto-generates journal ────────────────────────────────

describe('Regression — POST /payroll/runs/:id/finalise triggers journal generation', () => {
  test('finalising an APPROVED run produces a journal in the response', async () => {
    mockRunFindUnique.mockResolvedValue({ id: 'run-1', period: '2026-05', status: 'APPROVED' });
    mockPayslipFindMany.mockResolvedValue([
      {
        id: 'ps-1', runId: 'run-1', employeeId: 'emp-1', period: '2026-05',
        grossPayEnc: '6000', netPayEnc: '4800', employeeCpfEnc: '1200', employerCpfEnc: '1020',
        sdlAmountEnc: '11.25', fwlAmountEnc: '0',
      },
    ]);
    mockJournalFindUnique.mockResolvedValueOnce(null);
    mockJournalCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'j-1', ...data }));

    const res = await request(app).post('/payroll/runs/run-1/finalise');
    expect(res.status).toBe(200);
    expect(res.body.journal).toBeDefined();
    expect(res.body.journal.balanced).toBe(true);
    expect(res.body.journal.entries).toBeGreaterThan(0);
  });
});
