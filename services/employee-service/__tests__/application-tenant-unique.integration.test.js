'use strict';

/**
 * A5b — regression test for the compound-unique bug family on EmployeeApplication.
 *
 * Schema: `@@unique([tenantId, userId])` (prisma/schema.prisma:270). The re-submit
 * path of POST /employees/apply (../src/routes/employee.routes.js ~:1151) built its
 * `where` from `userId` alone — not a valid Prisma unique selector once the index is
 * `[tenantId, userId]` — so it threw `PrismaClientValidationError` on every
 * re-submission, before any SQL ran.
 *
 * UNLIKE the other 7 A5b sites, this route has NO `authenticate` middleware — it is
 * public, gated only by a signed invite token (see the route's own header comment)
 * — so there is no request-scoped tenantId available to build a `tenantId_userId`
 * selector from. The fix used here instead keys the update by `existing.id` (the
 * row's own primary key, fetched by the `findFirst` immediately above it), which is
 * always a valid, unambiguous selector regardless of tenant context. This test does
 * NOT mock auth-middleware at all, on purpose — proving the fix works with zero
 * tenant context in play, the same as production traffic on this route.
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked).
 *
 * Mutation proof (run once a DB is available): revert the `where` edit in
 * employee.routes.js, run this file (expect the second POST to return 500 / Prisma
 * validation message on resubmission), restore the fix, run again (expect 201 both
 * times, one row) — paste both runs.
 */

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const app = require('../src/index');

const raw = new PrismaClient();
const USER_ID = 'aaaaaaaa-1111-0000-0000-0000000000aa';
const EMAIL = 'a5b-apply-test@example.local';
const INVITE_TOKEN = 'a5b-test-invite-token';

global.fetch = jest.fn(async (url, opts) => {
  const u = String(url);
  if (u.includes('/users/invite/derive-key')) {
    return { ok: true, json: async () => ({ rawToken: 'unused-in-this-test' }) };
  }
  if (u.includes(`/users/invite/${INVITE_TOKEN}`)) {
    return { ok: true, json: async () => ({ id: USER_ID, email: EMAIL }) };
  }
  if (u.includes('/users/consume-invite')) {
    return { ok: true, json: async () => ({ ok: true }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
});

afterEach(() => { global.fetch.mockClear(); });

beforeAll(async () => {
  await raw.employeeApplication.deleteMany({ where: { userId: USER_ID } });
});

afterAll(async () => {
  await raw.employeeApplication.deleteMany({ where: { userId: USER_ID } });
  await raw.$disconnect();
});

describe('EmployeeApplication update-by-id on a public, unauthenticated route (A5b #12)', () => {
  test('first submission creates the application (create path, unaffected by this bug)', async () => {
    const res = await request(app).post('/employees/apply').send({
      inviteToken: INVITE_TOKEN,
      fullName: 'A5B Test Applicant',
      department: 'Eng',
    });
    expect(res.status).toBe(201);
    expect(res.body.applicationId).toBeTruthy();

    const row = await raw.employeeApplication.findFirst({ where: { userId: USER_ID } });
    expect(row).not.toBeNull();
    expect(row.fullName).toBe('A5B Test Applicant');
  });

  test('re-submission UPDATES the existing row by id (was: where:{userId})', async () => {
    const res = await request(app).post('/employees/apply').send({
      inviteToken: INVITE_TOKEN,
      fullName: 'A5B Test Applicant (amended)',
      department: 'Eng',
      bankName: 'Test Bank',
    });
    expect(res.status).toBe(201);

    const rows = await raw.employeeApplication.findMany({ where: { userId: USER_ID } });
    expect(rows.length).toBe(1); // updated in place, not duplicated
    expect(rows[0].fullName).toBe('A5B Test Applicant (amended)');
    expect(rows[0].bankName).toBe('Test Bank');
  });
});
