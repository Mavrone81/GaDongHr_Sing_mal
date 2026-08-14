'use strict';

/**
 * The payroll write path against a REAL database.
 *
 * WHY THIS SUITE EXISTS. The unit suites mock the Prisma client, and a mock
 * answers any query — valid or not — with whatever the test queued. That is how
 * 25 findUnique calls with partial composite keys (a runtime
 * PrismaClientValidationError on every payroll compute) sat behind 2,500 green
 * tests until CI ran against a real database. This suite exists so that class
 * of defect fails HERE, in seconds, instead of in a live run.
 *
 * WHAT IS REAL: the Prisma client (generated for this service), the schema
 * (db push), every query, the tenant auto-scoping extension, and the whole
 * route stack via supertest.
 *
 * WHAT IS FAKED: only the network boundary — employee-service, the statutory
 * service and entity resolution are other PROCESSES in production, so
 * global.fetch is routed by URL. Auth is the standard test stub. Nothing that
 * touches the database is mocked.
 *
 * Runs under scripts/dev/test-isolation.sh (real Postgres + per-service client
 * generate), NOT under `npm run test:backend` — the mock-only job has no
 * database and its hoisted client may belong to another service's schema.
 */

const { randomUUID } = require('crypto');

// 64-hex dev key: encrypt() is used on every payslip write and fails closed
// without a key. Set before the crypto module loads.
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // gitleaks:allow
process.env.INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || 'db-contract-internal-key';
process.env.DISABLE_MAKER_CHECKER = 'true';

// The service maps /app/shared/(.*) to an empty mock; this suite wants the
// REAL crypto — encrypted payslip columns are part of the contract under test.
jest.mock('/app/shared/crypto', () => require('../../../shared/crypto'), { virtual: true });

const request = require('supertest');
const express = require('express');

const ENTITY_ID = randomUUID();
const EMP_A = `dbc-emp-a-${Date.now()}`;
const EMP_B = `dbc-emp-b-${Date.now()}`;
// A far-future period so re-runs and parallel runs never collide with data
// left by other suites (same convention as the e2e specs).
const PERIOD = '2097-04';

/**
 * The network boundary, routed by URL. Employee data and statutory results are
 * what the real neighbours would return; leave/attendance return 500 on
 * purpose — those integrations are non-fatal by design (caught and warned), and
 * this proves compute survives their absence rather than depending on it.
 */
function installFetchRouter() {
  global.fetch = jest.fn(async (url, opts = {}) => {
    const u = String(url);

    if (u.includes('/tenants/internal/entities/')) {
      return jsonRes(200, {
        id: ENTITY_ID, country: 'SG', state: null, currency: 'SGD',
        statutoryIds: { uen: 'T99TEST999X' }, isActive: true,
      });
    }
    if (u.includes('/employees/payroll-data')) {
      return jsonRes(200, [
        { employeeId: EMP_A, ow: 5000, aw: 0, grossPay: 5000, citizenStatus: 'SC', age: 35, startDate: '2020-01-01' },
        { employeeId: EMP_B, ow: 3000, aw: 500, grossPay: 3500, citizenStatus: 'SC', age: 45, startDate: '2020-01-01' },
      ]);
    }
    if (u.includes('/statutory/compute-batch')) {
      const body = JSON.parse(opts.body);
      return jsonRes(200, {
        rateVersion: 'SG-2097.T',
        results: body.employees.map((e) => ({
          employeeId: e.employeeId,
          employeeDeductions:    [{ code: 'CPF_EE', label: 'CPF (Employee)', amount: e.remuneration.ordinary * 0.2, basis: { t: 'test' } }],
          employerContributions: [{ code: 'CPF_ER', label: 'CPF (Employer)', amount: e.remuneration.ordinary * 0.17, basis: { t: 'test' } }],
          employerLevies:        [{ code: 'SDL', label: 'SDL', amount: 11.25, basis: { t: 'test' } }],
        })),
      });
    }
    if (u.includes('/notifications/')) return jsonRes(200, { ok: true });
    // leave + attendance + anything unrouted: non-fatal integrations.
    return jsonRes(500, { error: `no fake for ${u}` });
  });
}

function jsonRes(status, body) {
  return {
    ok: status < 400, status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let app, prisma, routes;

beforeAll(async () => {
  installFetchRouter();
  prisma = require('../src/utils/prisma');
  routes = require('../src/routes/payroll.routes');

  app = express();
  app.use(express.json({ limit: '2mb' }));
  const { tenantContextMiddleware } = require('/app/shared/tenant-context');
  app.use(tenantContextMiddleware);
  app.use('/payroll', routes);
  // Same shape as the service's real error handler: fail-closed statutory
  // errors carry .status = 503 and must surface as such, not as 500.
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));

  await cleanup();
});

afterEach(async () => {
  if (typeof routes.drainBackgroundWork === 'function') await routes.drainBackgroundWork();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function cleanup() {
  // Period-based, not employee-id-based: EMP_A/B embed Date.now(), so a
  // previous run's payslips carry DIFFERENT ids — deleting by this run's ids
  // would leave them behind, and their run rows could then fail to delete.
  // Everything this suite creates lives in PERIOD, so PERIOD scopes the sweep.
  await prisma.payslip.deleteMany({ where: { period: PERIOD } });
  await prisma.payrollRun.deleteMany({ where: { period: PERIOD } });
  await prisma.payrollPeriodConfig.deleteMany({ where: { period: PERIOD } });
}

const AUTH = { Authorization: 'Bearer test' };

describe('payroll run lifecycle against a real database', () => {
  let runId;

  it('creates a run (requires legalEntityId per ENT-001)', async () => {
    const res = await request(app).post('/payroll/runs').set(AUTH)
      .send({ period: PERIOD, runType: 'MONTHLY', legalEntityId: ENTITY_ID });
    expect(res.status).toBe(201);
    expect(res.body.legalEntityId).toBe(ENTITY_ID);
    runId = res.body.id;
  });

  it('refuses a duplicate run for the same period (the NONE sentinel)', async () => {
    const res = await request(app).post('/payroll/runs').set(AUTH)
      .send({ period: PERIOD, runType: 'MONTHLY', legalEntityId: ENTITY_ID });
    expect(res.status).toBe(409);
  });

  /**
   * The test the mocks could never run. This exercises — for real —
   * payrollPeriodConfig lookup (the query that 500'd every compute for weeks),
   * public-holiday reads, payslip upserts with encrypted columns, and the run
   * total update, all inside one request.
   */
  it('computes the run: real queries, real payslips written', async () => {
    const res = await request(app).post(`/payroll/runs/${runId}/compute`).set(AUTH).send({});
    expect({ status: res.status, body: res.body }).toMatchObject({ status: 200 });

    const slips = await prisma.payslip.findMany({ where: { runId } });
    expect(slips).toHaveLength(2);

    // The figures survive the encrypt/decrypt round trip with the arithmetic
    // intact: 20% employee CPF on OW, net = gross - cpf.
    const { decrypt } = require('/app/shared/crypto');
    const a = slips.find((s) => s.employeeId === EMP_A);
    expect(parseFloat(decrypt(a.employeeCpfEnc))).toBe(1000); // 5000 * 0.2
    expect(parseFloat(decrypt(a.netPayEnc))).toBe(4000);      // 5000 - 1000
  });

  it('re-compute is idempotent: upserts, never duplicates', async () => {
    const res = await request(app).post(`/payroll/runs/${runId}/compute`).set(AUTH).send({});
    expect(res.status).toBe(200);
    const slips = await prisma.payslip.findMany({ where: { runId } });
    expect(slips).toHaveLength(2);
  });

  it('approve then finalise walks the state machine', async () => {
    const approve = await request(app).post(`/payroll/runs/${runId}/approve`).set(AUTH).send({});
    expect({ status: approve.status, body: approve.body }).toMatchObject({ status: 200 });

    const finalise = await request(app).post(`/payroll/runs/${runId}/finalise`).set(AUTH).send({});
    expect({ status: finalise.status, body: finalise.body }).toMatchObject({ status: 200 });

    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    expect(run.status).toBe('FINALISED');
  });

  /**
   * Fail closed, observed for real: when the statutory service is down the run
   * must stay DRAFT with zero payslips — not compute with zeros.
   */
  it('leaves a run in DRAFT with no payslips when statutory is unavailable', async () => {
    const create = await request(app).post('/payroll/runs').set(AUTH)
      .send({ period: PERIOD, runType: 'ADHOC', legalEntityId: ENTITY_ID });
    expect(create.status).toBe(201);
    const adhocId = create.body.id;

    const realFetch = global.fetch;
    global.fetch = jest.fn(async (url, opts) => {
      if (String(url).includes('/statutory/')) throw new Error('ECONNREFUSED');
      return realFetch(url, opts);
    });
    try {
      const res = await request(app).post(`/payroll/runs/${adhocId}/compute`).set(AUTH).send({});
      expect(res.status).toBe(503);
      const run = await prisma.payrollRun.findUnique({ where: { id: adhocId } });
      expect(run.status).toBe('DRAFT');
      expect(await prisma.payslip.count({ where: { runId: adhocId } })).toBe(0);
    } finally {
      global.fetch = realFetch;
    }
  });
});
