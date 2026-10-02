'use strict';

/**
 * A5c — regression test for the compound-unique bug family on PayrollJournal.
 *
 * Schema: `@@unique([tenantId, runId])` (prisma/schema.prisma:495). Two
 * separate inline occurrences of the same pattern build their `where` from
 * `runId` alone — not a valid Prisma unique selector once the index is
 * `[tenantId, runId]` — and throw `PrismaClientValidationError` before any SQL
 * runs, inside a `$transaction(async (tx) => ...)`:
 *   - POST /payroll/runs/:id/finalise      (payroll.routes.js:894)
 *   - POST /payroll/runs/:id/journal       (cost-centre.routes.js:214, a
 *     duplicate of the same bug in a second file)
 *
 * finalise's journal generation is wrapped in its own try/catch ("best-effort
 * — never block finalisation"), so the symptom there is NOT a 500: the whole
 * request still returns 200, but `journal.error` carries the Prisma
 * validation message and no PayrollJournal row is ever created. The
 * standalone /journal route has no such wrapper and returns a real 500.
 * Both are asserted below, against their real symptom, not an assumed one.
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked) — this is
 * what proves the fix against Prisma's actual WhereUniqueInput validation,
 * which the mocked-Prisma unit suites (payroll-api.integration.test.js)
 * cannot catch: a jest.fn() accepts any `where` shape (Architect, A5a).
 *
 * Mutation proof (run once a DB is available):
 *   1. Revert the `tenantId_runId` edits in payroll.routes.js and
 *      cost-centre.routes.js (or check out baseline/gadong-main-9113e8c for
 *      both files).
 *   2. Run this file — expect the finalise test's journal.error to contain
 *      "PrismaClientValidationError" / "needs at least one of", and the
 *      standalone journal test to return 500 with the same message — that is
 *      "fails for the right reason."
 *   3. Restore the fix. Run again — expect the statuses/bodies asserted below.
 *   4. Paste both runs into the PR/handoff.
 */

process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // gitleaks:allow

let mockUser = { sub: 'admin-001', role: 'SUPER_ADMIN', tenantId: null };
const setUser = (u) => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockUser;
    const tc = require('/app/shared/tenant-context');
    tc.setTenant(mockUser.tenantId || tc.DEFAULT_TENANT_ID);
    next();
  },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

// Mock fs/pdfkit — unrelated to this test, avoids real file/PDF work at require-time.
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({ on: jest.fn(), pipe: jest.fn() }),
  existsSync: jest.fn().mockReturnValue(true),
}));
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

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/index');

const raw = new PrismaClient();
const TENANT_A = 'aaaaaaaa-0000-0000-0000-00000000005c';
const PERIOD = '2099-05'; // far-future, won't collide with other tests/seed data
const FINALISE_RUN_ID = 'a5c00000-0000-0000-0000-00000000f001';
const JOURNAL_RUN_ID = 'a5c00000-0000-0000-0000-00000000f002';

async function makeApprovedRun(id) {
  await raw.payrollRun.create({
    data: {
      id, tenantId: TENANT_A, period: PERIOD, runType: 'ADHOC', periodHalf: 'NONE',
      status: 'APPROVED', initiatedBy: 'admin-001', approvedBy: 'admin-002',
    },
  });
}

beforeAll(async () => {
  await raw.payrollJournalEntry.deleteMany({ where: { journal: { runId: { in: [FINALISE_RUN_ID, JOURNAL_RUN_ID] } } } });
  await raw.payrollJournal.deleteMany({ where: { runId: { in: [FINALISE_RUN_ID, JOURNAL_RUN_ID] } } });
  await raw.payrollRun.deleteMany({ where: { id: { in: [FINALISE_RUN_ID, JOURNAL_RUN_ID] } } });
});

afterEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', role: 'SUPER_ADMIN', tenantId: TENANT_A });
});

afterAll(async () => {
  const { drainBackgroundWork } = require('../src/routes/payroll.routes');
  if (typeof drainBackgroundWork === 'function') await drainBackgroundWork();
  await raw.payrollJournalEntry.deleteMany({ where: { journal: { runId: { in: [FINALISE_RUN_ID, JOURNAL_RUN_ID] } } } });
  await raw.payrollJournal.deleteMany({ where: { runId: { in: [FINALISE_RUN_ID, JOURNAL_RUN_ID] } } });
  await raw.payrollRun.deleteMany({ where: { id: { in: [FINALISE_RUN_ID, JOURNAL_RUN_ID] } } });
  await raw.$disconnect();
});

describe('PayrollJournal tenant-scoped findUnique (A5c #1 — payroll.routes.js:894, embedded in finalise)', () => {
  test('finalise generates a real journal row scoped to the caller tenant (was: where:{runId} inside $transaction)', async () => {
    setUser({ tenantId: TENANT_A });
    await makeApprovedRun(FINALISE_RUN_ID);

    const res = await request(app).post(`/payroll/runs/${FINALISE_RUN_ID}/finalise`).send({});

    // finalise itself always 200 — journal generation is best-effort and
    // never blocks finalisation. The bug's symptom lives inside the nested
    // journal field, not the HTTP status.
    expect(res.status).toBe(200);
    expect(res.body.journal).toBeTruthy();
    expect(res.body.journal.error).toBeUndefined();

    const row = await raw.payrollJournal.findUnique({
      where: { tenantId_runId: { tenantId: TENANT_A, runId: FINALISE_RUN_ID } },
    });
    expect(row).not.toBeNull();
    expect(row.tenantId).toBe(TENANT_A);
  });
});

describe('PayrollJournal tenant-scoped findUnique (A5c #2 — cost-centre.routes.js:214, standalone route)', () => {
  test('POST /payroll/runs/:id/journal generates a real journal row (was: where:{runId} inside $transaction)', async () => {
    setUser({ tenantId: TENANT_A });
    await makeApprovedRun(JOURNAL_RUN_ID);
    await raw.payrollRun.update({ where: { id: JOURNAL_RUN_ID }, data: { status: 'FINALISED' } });

    const res = await request(app).post(`/payroll/runs/${JOURNAL_RUN_ID}/journal`).send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Journal generated/);

    const row = await raw.payrollJournal.findUnique({
      where: { tenantId_runId: { tenantId: TENANT_A, runId: JOURNAL_RUN_ID } },
    });
    expect(row).not.toBeNull();
    expect(row.tenantId).toBe(TENANT_A);
  });
});
