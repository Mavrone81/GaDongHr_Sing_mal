'use strict';

/**
 * The contract payroll-service calls, and the gate that stops it.
 *
 * The most important behaviour here is a REFUSAL: Malaysian payroll must not
 * compute on rate tables nobody has reconciled against the KWSP, PERKESO and
 * LHDN publications (PRD §A7.1). A provenance column that only gets written and
 * never read is a comment; these tests are what make it a gate.
 */

const request = require('supertest');

const mockPrisma = {
  rateVersion: { findFirst: jest.fn() },
  epfBand:     { findMany: jest.fn().mockResolvedValue([]) },
  socsoBand:   { findMany: jest.fn().mockResolvedValue([]) },
  eisBand:     { findMany: jest.fn().mockResolvedValue([]) },
  pcbBand:     { findMany: jest.fn().mockResolvedValue([]) },
  pcbRelief:   { findMany: jest.fn().mockResolvedValue([]) },
  hrdLevyRate: { findMany: jest.fn().mockResolvedValue([]) },
};
jest.mock('../src/utils/prisma', () => mockPrisma);

const app = require('../src/app');

const KEY = 'test-internal-key';
const VERIFIED = {
  version: 'MY-2026.1', source: 'KWSP Third Schedule',
  retrievedAt: new Date('2026-01-02'), verifiedAt: new Date('2026-01-03'),
  verifiedBy: 'a.reviewer', isActive: true,
};
const UNVERIFIED = { ...VERIFIED, verifiedAt: null, verifiedBy: null };

const post = (path, body) =>
  request(app).post(path).set('x-internal-service-key', KEY).send(body);

beforeEach(() => {
  process.env.INTERNAL_SERVICE_KEY = KEY;
  mockPrisma.rateVersion.findFirst.mockReset();
  [mockPrisma.epfBand, mockPrisma.socsoBand, mockPrisma.eisBand,
   mockPrisma.pcbBand, mockPrisma.pcbRelief, mockPrisma.hrdLevyRate]
    .forEach((m) => m.findMany.mockResolvedValue([]));
});

describe('the service is service-to-service only', () => {
  it('rejects a request with no internal key', async () => {
    const res = await request(app).get('/statutory/schema');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong internal key', async () => {
    const res = await request(app).get('/statutory/schema').set('x-internal-service-key', 'nope');
    expect(res.status).toBe(401);
  });

  /**
   * Fails CLOSED when unconfigured rather than falling back to a development
   * default — the VAPT C-07 defect class. An unset key must lock the door, not
   * open it.
   */
  it('rejects everything when INTERNAL_SERVICE_KEY is unset', async () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    const res = await request(app).get('/statutory/schema').set('x-internal-service-key', KEY);
    expect(res.status).toBe(401);
  });

  it('leaves /health open, so an orchestrator needs no credential', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ country: 'MY', status: 'ok' });
  });
});

describe('compute-batch refuses rather than guessing', () => {
  it('rejects a non-MY entity loudly', async () => {
    const res = await post('/statutory/compute-batch', {
      entity: { country: 'SG' }, employees: [{ employeeId: 'e1' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only computes MY entities/);
  });

  it('rejects an empty employee list', async () => {
    const res = await post('/statutory/compute-batch', { entity: { country: 'MY' }, employees: [] });
    expect(res.status).toBe(400);
  });

  it('fails closed when no rate version is active', async () => {
    mockPrisma.rateVersion.findFirst.mockResolvedValue(null);
    const res = await post('/statutory/compute-batch', {
      entity: { country: 'MY' }, employees: [{ employeeId: 'e1' }], period: '2026-03',
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/No active MY rate version/);
  });

  /**
   * THE GATE. An active-but-unverified rate version must block payroll and say
   * which publication needs checking — not compute plausible, wrong figures
   * that surface months later as an underpayment plus a late charge.
   */
  it('blocks on a rate version nobody has verified against its source', async () => {
    mockPrisma.rateVersion.findFirst.mockResolvedValue(UNVERIFIED);
    const res = await post('/statutory/compute-batch', {
      entity: { country: 'MY' }, employees: [{ employeeId: 'e1' }], period: '2026-03',
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/has not been verified against its source/);
    expect(res.body.error).toMatch(/KWSP Third Schedule/); // names what to check
    expect(res.body.error).toMatch(/A7\.1/);              // and the rule
  });

  /**
   * Verified but with empty tables: the run still must not proceed. It fails on
   * the missing band and NAMES the employee, because a zero statutory line is
   * an invisible underpayment.
   */
  it('names the employee when a band is missing', async () => {
    mockPrisma.rateVersion.findFirst.mockResolvedValue(VERIFIED);
    const res = await post('/statutory/compute-batch', {
      entity: { country: 'MY' }, period: '2026-03',
      employees: [{
        employeeId: 'emp-42',
        profile: { age: 30, citizenship: 'CITIZEN', mtdCategory: 1 },
        remuneration: { gross: 5000 },
      }],
    });
    expect(res.status).toBe(503);
    expect(res.body.employeeId).toBe('emp-42');
    expect(res.body.error).toMatch(/EPF_BAND_NOT_FOUND/);
  });
});

describe('the contract endpoints', () => {
  it('serves the MY schema, naming what payroll needs', async () => {
    const res = await request(app).get('/statutory/schema').set('x-internal-service-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('MYR');
    const required = res.body.employeeFields.filter((f) => f.required).map((f) => f.name);
    // The four that change the arithmetic rather than merely labelling it.
    expect(required).toEqual(expect.arrayContaining(['age', 'citizenship', 'mtdCategory']));
  });

  it('serves employment rules with the post-2022 45-hour week', async () => {
    const res = await request(app).get('/statutory/employment-rules').set('x-internal-service-key', KEY);
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('MY');
    // 48 was the pre-amendment figure; overtime is calculated on the excess, so
    // the stale number silently underpays.
    expect(res.body.normalHours.perWeek).toBe(45);
    expect(res.body.overtime.normalDay).toBe(1.5);
  });

  it('lists missing employee fields instead of half-writing a run', async () => {
    mockPrisma.rateVersion.findFirst.mockResolvedValue(VERIFIED);
    const res = await post('/statutory/validate', {
      employees: [
        { employeeId: 'good', profile: {
          age: 30, citizenship: 'CITIZEN', epfNumber: 'E1', socsoNumber: 'S1',
          incomeTaxNumber: 'T1', mtdCategory: 1 } },
        { employeeId: 'bad', profile: { age: 30 } },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.problems).toHaveLength(1);
    expect(res.body.problems[0].employeeId).toBe('bad');
    expect(res.body.problems[0].missing).toEqual(expect.arrayContaining(['citizenship', 'mtdCategory']));
  });

  /**
   * /validate runs before a payroll run starts, so it is where an operator
   * should discover the tables are unverified — not at compute time with a
   * half-built run.
   */
  it('reports an unverified rate version from validate too', async () => {
    mockPrisma.rateVersion.findFirst.mockResolvedValue(UNVERIFIED);
    const res = await post('/statutory/validate', { employees: [] });
    expect(res.body.ok).toBe(false);
    expect(res.body.rateVersionProblem).toMatch(/has not been verified/);
  });
});
