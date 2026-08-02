'use strict';
/**
 * The read-side contract: schema, employment-rules, validate.
 *
 * employment-rules is what lets leave-service and attendance-service stay
 * country-agnostic in P4 — they read rules rather than holding constants.
 */
const request = require('supertest');

jest.mock('../src/utils/prisma', () => ({
  rateVersion: { findFirst: jest.fn() },
  cpfRate:     { findMany: jest.fn() },
  sdlConfig:   { findUnique: jest.fn() },
}));

process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
const app = require('../src/app');
const KEY = { 'x-internal-service-key': 'test-internal-key' };

describe('GET /statutory/schema', () => {
  test('declares SG identity types', async () => {
    const res = await request(app).get('/statutory/schema').set(KEY);
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('SG');
    expect(res.body.identityTypes).toEqual(expect.arrayContaining(['NRIC', 'FIN']));
  });

  test('declares the employee fields CPF needs', async () => {
    const res = await request(app).get('/statutory/schema').set(KEY);
    const required = res.body.employeeFields.filter(f => f.required).map(f => f.name);
    expect(required).toEqual(expect.arrayContaining(['citizenStatus', 'dateOfBirth']));
  });

  test('requires an internal key', async () => {
    expect((await request(app).get('/statutory/schema')).status).toBe(401);
  });
});

describe('GET /statutory/employment-rules', () => {
  test('reports the SG 44-hour week', async () => {
    const res = await request(app).get('/statutory/employment-rules').set(KEY);
    expect(res.body.normalWeeklyHours).toBe(44);
  });

  // SG EA s.38 has a single OT rate. MY s.60A differentiates 1.5/2/3 — that
  // difference is exactly why this lives behind the contract rather than as a
  // constant in attendance-service.
  test('reports a single 1.5x overtime multiplier', async () => {
    const res = await request(app).get('/statutory/employment-rules').set(KEY);
    expect(res.body.overtimeMultipliers).toEqual({ NORMAL: 1.5, REST_DAY: 1.5, PUBLIC_HOLIDAY: 1.5 });
  });

  test('reports flat statutory leave entitlements', async () => {
    const res = await request(app).get('/statutory/employment-rules').set(KEY);
    expect(res.body.leaveEntitlements.ANNUAL).toEqual([{ minServiceMonths: 0, days: 7 }]);
  });

  // The tiered SHAPE is what keeps consumers country-agnostic: SG has one tier,
  // MY will have three, and neither consumer needs to know which.
  test('entitlements are a service-tiered list, even where SG is flat', async () => {
    const res = await request(app).get('/statutory/employment-rules').set(KEY);
    for (const tiers of Object.values(res.body.leaveEntitlements)) {
      expect(Array.isArray(tiers)).toBe(true);
      expect(tiers[0]).toHaveProperty('minServiceMonths');
      expect(tiers[0]).toHaveProperty('days');
    }
  });
});

describe('POST /statutory/validate', () => {
  const entity = { country: 'SG', state: null, statutoryIds: {} };

  test('passes a complete employee', async () => {
    const res = await request(app).post('/statutory/validate').set(KEY).send({
      entity, employees: [{ employeeId: 'e1', profile: { citizenStatus: 'SC', dateOfBirth: '1990-01-01' } }],
    });
    expect(res.body).toEqual({ valid: true, problems: [] });
  });

  // Caught BEFORE compute starts, listing employees — never mid-run with half
  // the payslips already written.
  test('reports missing fields per employee', async () => {
    const res = await request(app).post('/statutory/validate').set(KEY).send({
      entity, employees: [{ employeeId: 'e1', profile: {} }],
    });
    expect(res.body.valid).toBe(false);
    expect(res.body.problems).toEqual([{ employeeId: 'e1', missing: ['citizenStatus', 'dateOfBirth'] }]);
  });

  test('reports every failing employee, not just the first', async () => {
    const res = await request(app).post('/statutory/validate').set(KEY).send({
      entity, employees: [
        { employeeId: 'e1', profile: {} },
        { employeeId: 'e2', profile: { citizenStatus: 'SC', dateOfBirth: '1990-01-01' } },
        { employeeId: 'e3', profile: { citizenStatus: 'SC' } },
      ],
    });
    expect(res.body.problems.map(p => p.employeeId)).toEqual(['e1', 'e3']);
  });

  test('treats an empty string as missing', async () => {
    const res = await request(app).post('/statutory/validate').set(KEY).send({
      entity, employees: [{ employeeId: 'e1', profile: { citizenStatus: '', dateOfBirth: '1990-01-01' } }],
    });
    expect(res.body.problems[0].missing).toEqual(['citizenStatus']);
  });
});
