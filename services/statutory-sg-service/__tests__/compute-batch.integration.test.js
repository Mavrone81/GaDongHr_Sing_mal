'use strict';
/**
 * The contract endpoint payroll-service calls.
 *
 * Batched deliberately: a 500-employee run makes ONE call, not 500.
 *
 * FAIL-CLOSED throughout. If no active rate version exists, or no CPF band
 * matches an employee, this returns 503 and payroll leaves the run in DRAFT.
 * It must never fall back to a default or the nearest band — a plausible wrong
 * CPF figure is far worse than an unavailable payroll run, because it surfaces
 * months later as a compliance problem rather than immediately as an outage.
 */
const request = require('supertest');

const mockPrisma = {
  rateVersion: { findFirst: jest.fn() },
  cpfRate:     { findMany: jest.fn() },
  sdlConfig:   { findUnique: jest.fn() },
};
jest.mock('../src/utils/prisma', () => mockPrisma);

process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
const app = require('../src/app');

const KEY = { 'x-internal-service-key': 'test-internal-key' };

const RATES = [
  { citizenStatus: 'SC_PR', ageMin: 0, ageMax: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 8000, awCeiling: 102000 },
];

function body(overrides = {}) {
  return {
    period: { year: 2026, month: 1 },
    entity: { country: 'SG', state: null, statutoryIds: {} },
    employees: [{
      employeeId: 'emp-1',
      profile: { citizenStatus: 'SC', age: 35 },
      remuneration: { ordinary: 5000, additional: 0, gross: 5000, ytdOrdinary: 0, ytdAdditional: 0 },
    }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.rateVersion.findFirst.mockResolvedValue({ version: 'SG-2026.1' });
  mockPrisma.cpfRate.findMany.mockResolvedValue(RATES);
  mockPrisma.sdlConfig.findUnique.mockResolvedValue({ rate: 0.0025, minAmount: 2, maxAmount: 11.25, salaryCap: 4500 });
});

describe('POST /statutory/compute-batch', () => {
  test('returns CPF employee and employer lines', async () => {
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.status).toBe(200);

    const r = res.body.results[0];
    expect(r.employeeId).toBe('emp-1');
    // 5000 * 0.20 = 1000 employee; total round(5000*0.37) = 1850 → employer 850
    expect(r.employeeDeductions).toEqual([expect.objectContaining({ code: 'CPF_EE', amount: 1000 })]);
    expect(r.employerContributions).toEqual([expect.objectContaining({ code: 'CPF_ER', amount: 850 })]);
  });

  test('returns SDL as an employer levy', async () => {
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    // min(5000, 4500) * 0.0025 = 11.25 → at the max cap
    expect(res.body.results[0].employerLevies).toEqual([
      expect.objectContaining({ code: 'SDL', amount: 11.25 }),
    ]);
  });

  test('echoes the active rate version (ENT-006)', async () => {
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.body.rateVersion).toBe('SG-2026.1');
  });

  test('carries the applied band in `basis` for audit', async () => {
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.body.results[0].employeeDeductions[0].basis).toMatchObject({
      citizenStatus: 'SC_PR', employeeRate: 0.20, owCeiling: 8000,
    });
  });

  test('computes every employee in the batch', async () => {
    const two = body({ employees: [
      { employeeId: 'emp-1', profile: { citizenStatus: 'SC', age: 35 }, remuneration: { ordinary: 5000, additional: 0, gross: 5000, ytdOrdinary: 0, ytdAdditional: 0 } },
      { employeeId: 'emp-2', profile: { citizenStatus: 'SC', age: 40 }, remuneration: { ordinary: 3000, additional: 0, gross: 3000, ytdOrdinary: 0, ytdAdditional: 0 } },
    ] });
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(two);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[1].employeeDeductions[0].amount).toBe(600);
  });

  test('returns zero CPF for a foreigner but still levies SDL', async () => {
    mockPrisma.cpfRate.findMany.mockResolvedValue([
      ...RATES,
      { citizenStatus: 'FOREIGNER', ageMin: 0, ageMax: null, employeeRate: 0, employerRate: 0, owCeiling: 8000, awCeiling: 102000 },
    ]);
    const foreign = body({ employees: [{
      employeeId: 'emp-3', profile: { citizenStatus: 'FOREIGNER', age: 30 },
      remuneration: { ordinary: 5000, additional: 0, gross: 5000, ytdOrdinary: 0, ytdAdditional: 0 },
    }] });
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(foreign);
    expect(res.body.results[0].employeeDeductions[0].amount).toBe(0);
    expect(res.body.results[0].employerLevies[0].amount).toBe(11.25);
  });

  // ── fail-closed ────────────────────────────────────────────────────────────
  test('returns 503 when no active rate version exists', async () => {
    mockPrisma.rateVersion.findFirst.mockResolvedValue(null);
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.status).toBe(503);
  });

  test('returns 503 when no CPF band matches the employee', async () => {
    mockPrisma.cpfRate.findMany.mockResolvedValue([]);
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.status).toBe(503);
  });

  test('names the employee when a band is missing', async () => {
    mockPrisma.cpfRate.findMany.mockResolvedValue([]);
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body());
    expect(res.body.error).toMatch(/emp-1/);
  });

  // ── access + shape ─────────────────────────────────────────────────────────
  test('rejects a missing internal key', async () => {
    const res = await request(app).post('/statutory/compute-batch').send(body());
    expect(res.status).toBe(401);
  });

  test('rejects a wrong internal key', async () => {
    const res = await request(app).post('/statutory/compute-batch')
      .set({ 'x-internal-service-key': 'wrong' }).send(body());
    expect(res.status).toBe(401);
  });

  // Routing to the wrong country service must be loud, not silently computed
  // as Singapore.
  test('rejects a non-SG entity', async () => {
    const my = body({ entity: { country: 'MY', state: 'SGR', statutoryIds: {} } });
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(my);
    expect(res.status).toBe(400);
  });

  test('rejects an empty employees array', async () => {
    const res = await request(app).post('/statutory/compute-batch').set(KEY).send(body({ employees: [] }));
    expect(res.status).toBe(400);
  });
});
