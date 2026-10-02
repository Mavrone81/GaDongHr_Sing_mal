'use strict';

/**
 * A5b — regression test for the compound-unique bug family on OfferLetter.
 * Found by DevLead's full-class sweep (not in the original 13) — `OfferLetter`
 * was never on anyone's candidate-model list until this pass.
 *
 * Schema: `@@unique([tenantId, candidateId])` (prisma/schema.prisma:335). Two
 * `offerLetter.update` call sites inside POST /recruitment/candidates/:id/offer-letter
 * (../src/routes/recruitment.routes.js ~:1338 re-generate path, ~:1396 e-sign-sent
 * path) built their `where` from `candidateId` alone — not a valid Prisma unique
 * selector once the index is `[tenantId, candidateId]` — so both threw
 * `PrismaClientValidationError` on every call after the first (the first call always
 * takes the `create` branch, which is unaffected).
 *
 * A third site (PUT /recruitment/candidates/:id/offer-letter, status-update route,
 * ~:1536) has the same shape and is fixed the same way, covered separately below.
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked). NOT this repo's
 * existing offer-letter.integration.test.js, which mocks @prisma/client entirely and
 * so cannot detect this bug class.
 *
 * NOTE: recruitment-service is not registered in the root jest.config.js (tracked
 * separately, DevLead/centralized fix) — run via `cd services/recruitment-service
 * && npm test`, not the root runner, until that lands.
 *
 * Mutation proof (run once a DB is available): revert the three `where` edits in
 * recruitment.routes.js, run this file (expect the second call in each describe
 * block to fail with a Prisma validation error), restore the fix, run again (expect
 * the statuses asserted below) — paste both runs.
 */

let mockUser = { sub: 'admin-001', role: 'HR_ADMIN', tenantId: null };
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
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN' },
}), { virtual: true });

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');

const raw = new PrismaClient();
const TENANT_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
let candidateId;

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }); // no e-sign dispatch unless a test overrides it
  setUser({ sub: 'admin-001', role: 'HR_ADMIN', tenantId: TENANT_A });
});

beforeAll(async () => {
  await raw.candidate.deleteMany({ where: { email: 'a5b-offer-test@example.local' } });
  const candidate = await raw.candidate.create({
    data: {
      tenantId: TENANT_A, firstName: 'A5B', lastName: 'Offer', email: 'a5b-offer-test@example.local',
      stage: 'OFFER',
    },
  });
  candidateId = candidate.id;
});

afterAll(async () => {
  await raw.offerLetter.deleteMany({ where: { candidateId } });
  await raw.candidate.deleteMany({ where: { id: candidateId } });
  await raw.$disconnect();
});

describe('OfferLetter tenant-scoped update (A5b new sites #14-15: regenerate + e-sign-sent)', () => {
  test('first POST creates the offer letter (create path, unaffected by this bug)', async () => {
    const { app } = require('../src/index');
    setUser({ tenantId: TENANT_A });
    const res = await request(app)
      .post(`/recruitment/candidates/${candidateId}/offer-letter`)
      .send({ sendForEsign: false });
    expect(res.status).toBe(201);
    expect(res.body.offerLetter.status).toBe('DRAFT');
  });

  test('re-generating the SAME offer letter UPDATES it (was: where:{candidateId}, ~:1338)', async () => {
    const { app } = require('../src/index');
    setUser({ tenantId: TENANT_A });
    const res = await request(app)
      .post(`/recruitment/candidates/${candidateId}/offer-letter`)
      .send({ sendForEsign: false, reportingManager: 'A. Manager' });
    expect(res.status).toBe(201);
    expect(res.body.offerLetter.reportingManager).toBe('A. Manager');

    const rows = await raw.offerLetter.findMany({ where: { candidateId } });
    expect(rows.length).toBe(1); // updated in place, not duplicated
  });

  test('a successful e-sign dispatch updates the same tenant-scoped row (was: where:{candidateId}, ~:1396)', async () => {
    const { app } = require('../src/index');
    setUser({ tenantId: TENANT_A });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ requestId: 'esign-req-1' }) });

    const res = await request(app)
      .post(`/recruitment/candidates/${candidateId}/offer-letter`)
      .send({ sendForEsign: true });
    expect(res.status).toBe(201);
    expect(res.body.esignDispatched).toBe(true);

    const row = await raw.offerLetter.findUnique({ where: { tenantId_candidateId: { tenantId: TENANT_A, candidateId } } });
    expect(row.status).toBe('SENT');
    expect(row.esignRequestId).toBe('esign-req-1');
  });
});

describe('OfferLetter tenant-scoped update on the status-update route (A5b new site #16, ~:1536)', () => {
  test('marking the offer SIGNED updates the tenant-scoped row (was: where:{candidateId})', async () => {
    const { app } = require('../src/index');
    setUser({ tenantId: TENANT_A });
    const res = await request(app)
      .put(`/recruitment/candidates/${candidateId}/offer-letter`)
      .send({ status: 'SIGNED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('SIGNED');
  });
});
