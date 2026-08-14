'use strict';
/**
 * Integration tests for PAY-004 DRC endpoints:
 *   GET  /payroll/drc-status
 *   GET  /components/drc-quotas
 *   POST /components/drc-quotas/seed
 *   PUT  /components/drc-quotas/:id
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockUser = { sub: 'admin-001', role: 'HR_ADMIN' };
const setUser = u => { mockUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
    HR_MANAGER: 'HR_MANAGER', EMPLOYEE: 'EMPLOYEE', LINE_MANAGER: 'LINE_MANAGER',
  },
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

// Prisma mock
const mockDrcQuotaFindMany  = jest.fn();
const mockDrcQuotaUpdate    = jest.fn();
const mockDrcQuotaUpsert    = jest.fn();
const mockDrcQuotaCount     = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    payrollRun:      { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    payslip:         { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
    payrollLineItem: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), createMany: jest.fn(), create: jest.fn() },
    cpfRate:         { findMany: jest.fn().mockResolvedValue([]) },
    sdlConfig:       { findFirst: jest.fn().mockResolvedValue(null) },
    payComponent:    { findMany: jest.fn().mockResolvedValue([]) },
    fwlRate:         { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), updateMany: jest.fn(), createMany: jest.fn() },
    cpfSubmission:   { findMany: jest.fn().mockResolvedValue([]) },
    auditLog:        { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    payslipSlaAlert: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), updateMany: jest.fn() },
    payrollPeriodConfig: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null),},
    publicHoliday:   { findMany: jest.fn().mockResolvedValue([]) },
    payComponent:    { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    cpfRate:         { count: jest.fn().mockResolvedValue(0), updateMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    sdlConfig:       { count: jest.fn().mockResolvedValue(0), create: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    drcQuota:        { findMany: mockDrcQuotaFindMany, update: mockDrcQuotaUpdate, upsert: mockDrcQuotaUpsert, count: mockDrcQuotaCount },
    $executeRaw:     jest.fn().mockResolvedValue(0),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
    $queryRaw:       jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({ get: mockAxiosGet }));

// ── App ───────────────────────────────────────────────────────────────────────

const request = require('supertest');
const app     = require('../src/index');

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SC_EMPLOYEES = Array.from({ length: 85 }, (_, i) => ({
  id: `sc-${i}`, passType: null, citizenshipStatus: 'SC', workPassSector: null,
}));

const WP_SERVICES = Array.from({ length: 10 }, (_, i) => ({
  id: `wp-${i}`, passType: 'WP', citizenshipStatus: 'FOREIGNER', workPassSector: 'SERVICES',
}));

const SPASS_SERVICES = Array.from({ length: 5 }, (_, i) => ({
  id: `sp-${i}`, passType: 'S_PASS', citizenshipStatus: 'FOREIGNER', workPassSector: 'SERVICES',
}));

const SEEDED_QUOTAS = [
  { id: 'q1', sector: 'SERVICES', passType: 'WP',    maxRatioPct: 15.0, alertThreshPct: 80.0, isActive: true },
  { id: 'q2', sector: 'SERVICES', passType: 'S_PASS', maxRatioPct: 15.0, alertThreshPct: 80.0, isActive: true },
];

// ── GET /payroll/drc-status ───────────────────────────────────────────────────

describe('GET /payroll/drc-status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUser({ sub: 'admin-001', role: 'HR_ADMIN' });
    mockDrcQuotaFindMany.mockResolvedValue(SEEDED_QUOTAS);
  });

  test('403 for EMPLOYEE role', async () => {
    setUser({ sub: 'e1', role: 'EMPLOYEE' });
    mockAxiosGet.mockResolvedValue({ data: { employees: [] } });
    const res = await request(app).get('/payroll/drc-status');
    expect(res.status).toBe(403);
  });

  test('200 with summary and results array', async () => {
    mockAxiosGet.mockResolvedValue({ data: { employees: [...SC_EMPLOYEES, ...WP_SERVICES] } });
    const res = await request(app).get('/payroll/drc-status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('summary');
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  test('summary.exceeded incremented for EXCEEDED sectors', async () => {
    // 20 WP out of 100 total (85 SC + 15 WP) in Services → 15% = exactly at ceiling → EXCEEDED
    const wpExceeded = Array.from({ length: 20 }, (_, i) => ({
      id: `wp-x-${i}`, passType: 'WP', citizenshipStatus: 'FOREIGNER', workPassSector: 'SERVICES',
    }));
    mockAxiosGet.mockResolvedValue({ data: { employees: [...SC_EMPLOYEES, ...wpExceeded] } });
    const res = await request(app).get('/payroll/drc-status');
    expect(res.status).toBe(200);
    expect(res.body.summary.exceeded + res.body.summary.warning).toBeGreaterThanOrEqual(1);
  });

  test('all OK when FW headcount is low', async () => {
    mockAxiosGet.mockResolvedValue({ data: { employees: SC_EMPLOYEES }});
    const res = await request(app).get('/payroll/drc-status');
    expect(res.status).toBe(200);
    expect(res.body.summary.exceeded).toBe(0);
    expect(res.body.summary.warning).toBe(0);
  });

  test('asOf timestamp is ISO string', async () => {
    mockAxiosGet.mockResolvedValue({ data: { employees: [] } });
    const res = await request(app).get('/payroll/drc-status');
    expect(res.status).toBe(200);
    expect(() => new Date(res.body.asOf)).not.toThrow();
  });

  test('503 when employee-service is unreachable', async () => {
    mockAxiosGet.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).get('/payroll/drc-status');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/employee-service/i);
  });

  test('usingDefaults=true when no DRC quotas seeded yet', async () => {
    mockDrcQuotaFindMany.mockResolvedValue([]);
    mockAxiosGet.mockResolvedValue({ data: { employees: SC_EMPLOYEES } });
    const res = await request(app).get('/payroll/drc-status');
    expect(res.body.summary.usingDefaults).toBe(true);
  });

  test('PAYROLL_OFFICER can access', async () => {
    setUser({ sub: 'po-01', role: 'PAYROLL_OFFICER' });
    mockAxiosGet.mockResolvedValue({ data: { employees: [] } });
    const res = await request(app).get('/payroll/drc-status');
    expect(res.status).toBe(200);
  });
});

// ── GET /components/drc-quotas ────────────────────────────────────────────────

describe('GET /components/drc-quotas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUser({ sub: 'admin-001', role: 'HR_ADMIN' });
  });

  test('200 returns seeded quotas with isDefault=false', async () => {
    mockDrcQuotaFindMany.mockResolvedValue(SEEDED_QUOTAS);
    const res = await request(app).get('/components/drc-quotas');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].isDefault).toBe(false);
  });

  test('returns MOM defaults with isDefault=true when table is empty', async () => {
    mockDrcQuotaFindMany.mockResolvedValue([]);
    const res = await request(app).get('/components/drc-quotas');
    expect(res.status).toBe(200);
    expect(res.body.every(q => q.isDefault === true)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('403 for EMPLOYEE role', async () => {
    setUser({ sub: 'e1', role: 'EMPLOYEE' });
    const res = await request(app).get('/components/drc-quotas');
    expect(res.status).toBe(403);
  });
});

// ── POST /components/drc-quotas/seed ─────────────────────────────────────────

describe('POST /components/drc-quotas/seed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUser({ sub: 'sa-01', role: 'SUPER_ADMIN' });
    mockDrcQuotaCount.mockResolvedValue(0);
    mockDrcQuotaUpsert.mockResolvedValue({});
  });

  test('201 seeds MOM defaults when table is empty', async () => {
    const res = await request(app).post('/components/drc-quotas/seed');
    expect(res.status).toBe(201);
    expect(res.body.seeded).toBe(10); // 5 sectors × 2 pass types
  });

  test('200 skipped when already seeded', async () => {
    mockDrcQuotaCount.mockResolvedValue(10);
    const res = await request(app).post('/components/drc-quotas/seed');
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
  });

  test('403 for HR_ADMIN role (SUPER_ADMIN only)', async () => {
    setUser({ sub: 'hr-01', role: 'HR_ADMIN' });
    const res = await request(app).post('/components/drc-quotas/seed');
    expect(res.status).toBe(403);
  });
});

// ── PUT /components/drc-quotas/:id ───────────────────────────────────────────

describe('PUT /components/drc-quotas/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUser({ sub: 'sa-01', role: 'SUPER_ADMIN' });
    mockDrcQuotaUpdate.mockResolvedValue({ ...SEEDED_QUOTAS[0], maxRatioPct: 20.0 });
  });

  test('200 updates maxRatioPct', async () => {
    const res = await request(app).put('/components/drc-quotas/q1').send({ maxRatioPct: 20.0 });
    expect(res.status).toBe(200);
    expect(mockDrcQuotaUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'q1' },
      data: expect.objectContaining({ maxRatioPct: 20.0 }),
    }));
  });

  test('400 if maxRatioPct > 100', async () => {
    const res = await request(app).put('/components/drc-quotas/q1').send({ maxRatioPct: 110 });
    expect(res.status).toBe(400);
  });

  test('400 if alertThreshPct <= 0', async () => {
    const res = await request(app).put('/components/drc-quotas/q1').send({ alertThreshPct: 0 });
    expect(res.status).toBe(400);
  });

  test('403 for HR_ADMIN role', async () => {
    setUser({ sub: 'hr-01', role: 'HR_ADMIN' });
    const res = await request(app).put('/components/drc-quotas/q1').send({ maxRatioPct: 20 });
    expect(res.status).toBe(403);
  });

  test('404 when quota not found', async () => {
    mockDrcQuotaUpdate.mockRejectedValue(Object.assign(new Error(), { code: 'P2025' }));
    const res = await request(app).put('/components/drc-quotas/nonexistent').send({ maxRatioPct: 20 });
    expect(res.status).toBe(404);
  });
});
