'use strict';

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'PAYROLL_OFFICER' }; next(); },
  authorize: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER', EMPLOYEE: 'EMPLOYEE' },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encrypt: v => `enc(${v})`, decrypt: v => v.replace(/^enc\(|\)$/g, ''),
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

jest.mock('dotenv', () => ({ config: () => {} }));

const mockRunFindUnique        = jest.fn();
const mockGiroPaymentDeleteMany = jest.fn().mockResolvedValue({});
const mockGiroPaymentCreateMany = jest.fn().mockResolvedValue({});
const mockGiroPaymentFindMany   = jest.fn().mockResolvedValue([]);
const mockGiroPaymentUpdate     = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    payrollRun:          { findUnique: mockRunFindUnique, findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
    payrollLineItem:     { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    payslip:             { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), createMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    cpfRate:             { findMany: jest.fn().mockResolvedValue([]) },
    sdlConfig:           { findFirst: jest.fn().mockResolvedValue(null) },
    payComponent:        { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    payrollComponent:    { findMany: jest.fn().mockResolvedValue([]) },
    payrollOverride:     { findMany: jest.fn().mockResolvedValue([]) },
    payrollPeriodConfig: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    publicHoliday:       { findMany: jest.fn().mockResolvedValue([]) },
    auditLog:            { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    giroPayment: {
      deleteMany: mockGiroPaymentDeleteMany,
      createMany: mockGiroPaymentCreateMany,
      findMany:   mockGiroPaymentFindMany,
      update:     mockGiroPaymentUpdate,
    },
    $disconnect: jest.fn(),
  })),
}));

const request = require('supertest');
const app = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const FINALISED_RUN = {
  id: 'run-giro-001', period: '2026-05', legalEntityId: 'ent-1', runType: 'MONTHLY', status: 'FINALISED',
  payslips: [
    { id: 'ps-1', employeeId: 'emp-1', netPayEnc: '3500', grossPayEnc: '4000' },
    { id: 'ps-2', employeeId: 'emp-2', netPayEnc: '2800', grossPayEnc: '3200' },
  ],
};

const EMP_PAYROLL_DATA = [
  { employeeId: 'emp-1', fullName: 'Alice Tan', bankCode: '7375', bankBranchCode: '001', bankAccount: '1234567890' },
  { employeeId: 'emp-2', fullName: 'Bob Lim',   bankCode: '7171', bankBranchCode: '002', bankAccount: '0987654321' },
];

function mockRun(run) {
  mockRunFindUnique.mockResolvedValue(run);
}

function mockEmployeeFetch(employees = EMP_PAYROLL_DATA) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => employees,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGiroPaymentDeleteMany.mockResolvedValue({});
  mockGiroPaymentCreateMany.mockResolvedValue({});
});

// ── GR-01 UOB — returns 615-char fixed-width records ─────────────────────────
test('GR-01 GET bank-giro UOB returns fixed-width file', async () => {
  mockRun(FINALISED_RUN);
  mockEmployeeFetch();

  const res = await request(app)
    .get('/payroll/bank-giro/run-giro-001?bank=uob')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.headers['content-disposition']).toMatch(/UGBI/);
  const lines = res.text.split('\r\n');
  expect(lines[0]).toHaveLength(615);  // header record
  expect(lines[1]).toHaveLength(615);  // first detail
  expect(lines[2]).toHaveLength(615);  // second detail
  const trailer = lines.find(l => l.startsWith('9'));
  expect(trailer).toBeDefined();
});

// ── GR-02 OCBC — returns 1000-char fixed-width records ───────────────────────
test('GR-02 GET bank-giro OCBC returns 1000-char records', async () => {
  mockRun(FINALISED_RUN);
  mockEmployeeFetch();

  const res = await request(app)
    .get('/payroll/bank-giro/run-giro-001?bank=ocbc')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  const lines = res.text.split('\r\n');
  expect(lines[0]).toHaveLength(1000);
});

// ── GR-03 DBS — returns fixed-width file with record type at end ──────────────
test('GR-03 GET bank-giro DBS returns file with record types at end', async () => {
  mockRun(FINALISED_RUN);
  mockEmployeeFetch();

  const res = await request(app)
    .get('/payroll/bank-giro/run-giro-001?bank=dbs')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  const lines = res.text.split('\r\n').filter(l => l);
  expect(lines[0].slice(-1)).toBe('0');  // header record type
  expect(lines[1].slice(-1)).toBe('1');  // first detail record type
  expect(lines[lines.length - 1].slice(-1)).toBe('9');  // trailer
});

// ── GR-04 SCB — returns generic CSV with format-status header ────────────────
test('GR-04 GET bank-giro SCB returns generic CSV with warning header', async () => {
  mockRun(FINALISED_RUN);
  mockEmployeeFetch();

  const res = await request(app)
    .get('/payroll/bank-giro/run-giro-001?bank=scb')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.headers['x-bank-format-status']).toMatch(/GENERIC/i);
  expect(res.headers['content-disposition']).toMatch(/SCB-GIRO/);
  expect(res.text).toMatch(/PAYMENT_DATE,PAYEE_NAME/);
  expect(res.text).toMatch(/ALICE TAN/i);
});

// ── GR-05 HSBC — generic CSV ──────────────────────────────────────────────────
test('GR-05 GET bank-giro HSBC returns generic CSV', async () => {
  mockRun(FINALISED_RUN);
  mockEmployeeFetch();

  const res = await request(app)
    .get('/payroll/bank-giro/run-giro-001?bank=hsbc')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.text).toMatch(/HSBC-GIRO/i);
  expect(res.text).toMatch(/SALA/);
});

// ── GR-06 Maybank — generic CSV ───────────────────────────────────────────────
test('GR-06 GET bank-giro Maybank returns generic CSV', async () => {
  mockRun(FINALISED_RUN);
  mockEmployeeFetch();

  const res = await request(app)
    .get('/payroll/bank-giro/run-giro-001?bank=maybank')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.text).toMatch(/MAYBANK-GIRO/i);
});

// ── GR-07 Unknown bank — 400 ──────────────────────────────────────────────────
test('GR-07 GET bank-giro unknown bank returns 400', async () => {
  mockRun(FINALISED_RUN);
  const res = await request(app)
    .get('/payroll/bank-giro/run-giro-001?bank=xyz')
    .set('Authorization', 'Bearer test');
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/Unsupported bank/);
});

// ── GR-08 Run not FINALISED — 400 ────────────────────────────────────────────
test('GR-08 GET bank-giro non-finalised run returns 400', async () => {
  mockRun({ ...FINALISED_RUN, status: 'APPROVED', payslips: [] });
  const res = await request(app)
    .get('/payroll/bank-giro/run-giro-001?bank=uob')
    .set('Authorization', 'Bearer test');
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/FINALISED/);
});

// ── GR-09 GIRO generation persists payment records ───────────────────────────
test('GR-09 GIRO generation writes GiroPayment records', async () => {
  mockRun(FINALISED_RUN);
  mockEmployeeFetch();

  await request(app)
    .get('/payroll/bank-giro/run-giro-001?bank=uob')
    .set('Authorization', 'Bearer test');

  // fire-and-forget — give it a tick to resolve
  await new Promise(r => setTimeout(r, 50));
  expect(mockGiroPaymentDeleteMany).toHaveBeenCalledWith({ where: { runId: 'run-giro-001' } });
  expect(mockGiroPaymentCreateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ employeeId: 'emp-1', bank: 'uob' })]) })
  );
});

// ── GR-10 GET /payments — returns payment list with summary ──────────────────
test('GR-10 GET payments returns summary', async () => {
  mockGiroPaymentFindMany.mockResolvedValue([
    { id: 'gp-1', runId: 'run-giro-001', employeeId: 'emp-1', status: 'SENT',     bank: 'uob', bankAccount: '1234567890', generatedAt: new Date() },
    { id: 'gp-2', runId: 'run-giro-001', employeeId: 'emp-2', status: 'RETURNED', bank: 'uob', bankAccount: '0987654321', generatedAt: new Date(), returnCode: '02', returnReason: 'Account closed' },
  ]);

  const res = await request(app)
    .get('/payroll/bank-giro/run-giro-001/payments')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(2);
  expect(res.body.summary.sent).toBe(1);
  expect(res.body.summary.returned).toBe(1);
  expect(res.body.failedPayments).toHaveLength(1);
  expect(res.body.failedPayments[0].returnCode).toBe('02');
});

// ── GR-11 POST /ack — CSV format marks returned payments ─────────────────────
test('GR-11 POST ack CSV marks returned payments', async () => {
  mockRun({ id: 'run-giro-001', status: 'FINALISED' });
  mockGiroPaymentFindMany
    .mockResolvedValueOnce([
      { id: 'gp-1', runId: 'run-giro-001', employeeId: 'emp-1', bankAccount: '1234567890', status: 'PENDING' },
      { id: 'gp-2', runId: 'run-giro-001', employeeId: 'emp-2', bankAccount: '0987654321', status: 'PENDING' },
    ])
    .mockResolvedValueOnce([
      { id: 'gp-1', status: 'RETURNED', returnCode: 'R02', returnReason: 'Account closed' },
    ]);
  mockGiroPaymentUpdate.mockResolvedValue({});

  const csvAck = [
    'ACCOUNT_NO,STATUS,RETURN_CODE,REASON',
    '1234567890,S,,',
    '0987654321,R,R02,Account closed',
  ].join('\n');

  const res = await request(app)
    .post('/payroll/bank-giro/run-giro-001/ack?bank=uob&format=csv')
    .set('Authorization', 'Bearer test')
    .send({ fileContent: csvAck });

  expect(res.status).toBe(200);
  expect(res.body.matched).toBe(2);
  expect(res.body.unmatched).toBe(0);
  expect(res.body.failedCount).toBe(1);
  expect(mockGiroPaymentUpdate).toHaveBeenCalledTimes(2);
});

// ── GR-12 POST /ack — DBS format identifies return records ───────────────────
test('GR-12 POST ack DBS format parses return codes', async () => {
  mockRun({ id: 'run-giro-001', status: 'FINALISED' });
  mockGiroPaymentFindMany
    .mockResolvedValueOnce([
      { id: 'gp-1', bankAccount: '1234567890', status: 'PENDING', runId: 'run-giro-001', employeeId: 'emp-1' },
    ])
    .mockResolvedValueOnce([]);
  mockGiroPaymentUpdate.mockResolvedValue({});

  // DBS return file: detail record 114 chars, return code at slice(93,96), record type "1" at end
  // Offset: 4(bank)+14(acct)+20(name)+2(txnCode)+11(amount) = 51 before filler
  // Return code at index 93 => 42 filler chars before it, 17 after, then '1'
  const acct = '1234567890    '; // 14-char padded account
  const filler = ' '.repeat(42) + '02 ' + ' '.repeat(17); // 62 chars total; '02 ' at indices 93-95
  const detailLine = '7171' + acct + 'ALICE TAN           ' + '22' + '00000035000' + filler + '1';

  const res = await request(app)
    .post('/payroll/bank-giro/run-giro-001/ack?bank=dbs&format=dbs')
    .set('Authorization', 'Bearer test')
    .send({ fileContent: detailLine });

  expect(res.status).toBe(200);
  expect(res.body.parsedRows).toBe(1);
  expect(mockGiroPaymentUpdate).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'RETURNED', returnCode: '02' }),
  }));
});

// ── GR-13 POST /ack — missing fileContent returns 400 ────────────────────────
test('GR-13 POST ack missing fileContent returns 400', async () => {
  mockRun({ id: 'run-giro-001', status: 'FINALISED' });
  const res = await request(app)
    .post('/payroll/bank-giro/run-giro-001/ack?bank=uob')
    .set('Authorization', 'Bearer test')
    .send({});
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/fileContent/);
});

// ── GR-14 POST /ack — no payment records returns 400 ─────────────────────────
test('GR-14 POST ack with no payment records returns 400', async () => {
  mockRun({ id: 'run-giro-001', status: 'FINALISED' });
  mockGiroPaymentFindMany.mockResolvedValueOnce([]);

  const res = await request(app)
    .post('/payroll/bank-giro/run-giro-001/ack?bank=uob')
    .set('Authorization', 'Bearer test')
    .send({ fileContent: 'ACCOUNT_NO,STATUS\n1234567890,S' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/generate the GIRO file first/);
});

// ── GR-15 POST /ack — unmatched accounts counted correctly ───────────────────
test('GR-15 POST ack unmatched accounts are counted', async () => {
  mockRun({ id: 'run-giro-001', status: 'FINALISED' });
  mockGiroPaymentFindMany
    .mockResolvedValueOnce([
      { id: 'gp-1', bankAccount: '1111111111', status: 'PENDING', runId: 'run-giro-001', employeeId: 'emp-1' },
    ])
    .mockResolvedValueOnce([]);
  mockGiroPaymentUpdate.mockResolvedValue({});

  const csvAck = 'ACCOUNT_NO,STATUS\n9999999999,S'; // different account

  const res = await request(app)
    .post('/payroll/bank-giro/run-giro-001/ack?bank=uob&format=csv')
    .set('Authorization', 'Bearer test')
    .send({ fileContent: csvAck });

  expect(res.status).toBe(200);
  expect(res.body.matched).toBe(0);
  expect(res.body.unmatched).toBe(1);
});
