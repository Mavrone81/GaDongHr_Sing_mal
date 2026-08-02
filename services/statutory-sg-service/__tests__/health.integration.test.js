'use strict';
/**
 * statutory-sg-service — the Singapore half of the per-country statutory split.
 *
 * It owns CPF/SDL/FWL computation and the global, platform-managed rate tables.
 * payroll-service keeps the run lifecycle and calls this over HTTP, so Malaysian
 * statutory code (P2) has no path into Singapore payroll.
 *
 * The app is exported separately from the listener so Supertest can drive it
 * without binding a port.
 */
const request = require('supertest');
const app = require('../src/app');

describe('GET /health', () => {
  test('reports service identity and country', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('statutory-sg-service');
    expect(res.body.status).toBe('ok');
    expect(res.body.country).toBe('SG');
  });

  test('is reachable without an internal key — liveness must not require auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
