'use strict';

/**
 * A5b — regression test for the compound-unique bug family on EmployeeSfcBalance.
 *
 * Schema: `@@unique([tenantId, employeeId])` (prisma/schema.prisma:280). Covers
 * TWO independent call sites on this model, found in two separate passes:
 *
 *   #11 — POST /training/sfc/declarations (../src/routes/grant.routes.js ~:333)
 *   built its `where` from `employeeId` alone, inside a `$transaction([...])` —
 *   not a valid Prisma unique selector once the index is `[tenantId, employeeId]`
 *   — so it threw `PrismaClientValidationError` on every declaration, rolling back
 *   the whole transaction (the enrollment update and the grant-claim record too,
 *   not just the balance write).
 *
 *   #17 — PUT /training/sfc/balance/:employeeId (~:287-288), found by DevLead's
 *   full-class sweep after #11 landed — same model, same bare-`{employeeId}`
 *   mistake, one route over. NOTE: this is a DIFFERENT file/route than the
 *   "training 288/334" pair REFUTED in STOCKTAKE §4 — those line numbers were in
 *   training.routes.js, not grant.routes.js; the overlap is coincidental.
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked).
 *
 * Mutation proof (run once a DB is available): revert the relevant `where` edit in
 * grant.routes.js, run this file (expect the affected describe block to fail — for
 * #11, a 500 / Prisma validation message that also rolls back the enrollment and
 * grant-claim writes; for #17, a 500 on the second call), restore the fix, run
 * again (expect the statuses/rows asserted below) — paste both runs.
 */

let mockUser = { sub: 'admin-001', role: 'HR_ADMIN', employeeId: null, tenantId: null };
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
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER' },
}), { virtual: true });

const request = require('supertest');
const { PrismaClient } = require('@prisma/client');
const { app } = require('../src/index');

const raw = new PrismaClient();
const TENANT_A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const EMP_ID = 'ffffffff-0000-0000-0000-0000000000ff';
let programId, enrollmentId;

afterEach(() => { jest.clearAllMocks(); setUser({ sub: 'admin-001', role: 'HR_ADMIN', employeeId: null, tenantId: TENANT_A }); });

beforeAll(async () => {
  await raw.employeeSfcBalance.deleteMany({ where: { employeeId: EMP_ID } });
  const program = await raw.trainingProgram.create({
    data: { tenantId: TENANT_A, title: 'A5b SFC test program', status: 'PUBLISHED', createdBy: 'seed' },
  });
  programId = program.id;
  const enrollment = await raw.trainingEnrollment.create({
    data: { tenantId: TENANT_A, programId, employeeId: EMP_ID },
  });
  enrollmentId = enrollment.id;
  await raw.employeeSfcBalance.create({
    data: { tenantId: TENANT_A, employeeId: EMP_ID, balanceAmount: 500, updatedBy: 'seed' },
  });
});

afterAll(async () => {
  await raw.grantClaim.deleteMany({ where: { employeeId: EMP_ID } });
  await raw.trainingEnrollment.deleteMany({ where: { employeeId: EMP_ID } });
  await raw.trainingProgram.deleteMany({ where: { id: programId } });
  await raw.employeeSfcBalance.deleteMany({ where: { employeeId: EMP_ID } });
  await raw.$disconnect();
});

describe('EmployeeSfcBalance tenant-scoped upsert inside a $transaction (A5b #11)', () => {
  test('declaring SFC decrements the tenant-scoped balance and writes the enrollment + claim', async () => {
    setUser({ tenantId: TENANT_A, employeeId: EMP_ID, role: 'EMPLOYEE' });
    const res = await request(app)
      .post('/training/sfc/declarations')
      .send({ employeeId: EMP_ID, enrollmentId, amount: 100 });

    expect(res.status).toBe(200);

    const bal = await raw.employeeSfcBalance.findUnique({ where: { tenantId_employeeId: { tenantId: TENANT_A, employeeId: EMP_ID } } });
    expect(bal.balanceAmount).toBe(400);

    const enrollment = await raw.trainingEnrollment.findUnique({ where: { id: enrollmentId } });
    expect(enrollment.sfcDeclaredAmount).toBe(100);

    const claims = await raw.grantClaim.findMany({ where: { employeeId: EMP_ID, claimType: 'SFC' } });
    expect(claims.length).toBe(1);
    expect(claims[0].claimAmount).toBe(100);
  });

  test('a second declaration updates (not duplicates) the same tenant-scoped balance row', async () => {
    setUser({ tenantId: TENANT_A, employeeId: EMP_ID, role: 'EMPLOYEE' });
    const res = await request(app)
      .post('/training/sfc/declarations')
      .send({ employeeId: EMP_ID, enrollmentId, amount: 50 });
    expect(res.status).toBe(200);

    const rows = await raw.employeeSfcBalance.findMany({ where: { employeeId: EMP_ID } });
    expect(rows.length).toBe(1);
    expect(rows[0].balanceAmount).toBe(350);
  });
});

describe('EmployeeSfcBalance tenant-scoped upsert on the admin balance-set route (A5b #17, was: where:{employeeId})', () => {
  const EMP_ID_2 = 'aaaaaaaa-9999-0000-0000-0000000000aa';

  afterAll(async () => {
    await raw.employeeSfcBalance.deleteMany({ where: { employeeId: EMP_ID_2 } });
  });

  test('first PUT creates the balance (create path, unaffected by this bug)', async () => {
    setUser({ tenantId: TENANT_A, role: 'HR_ADMIN' });
    const res = await request(app)
      .put(`/training/sfc/balance/${EMP_ID_2}`)
      .send({ balanceAmount: 1000, lifetimeReceived: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.balanceAmount).toBe(1000);
  });

  test('a second PUT UPDATES the tenant-scoped row (was: where:{employeeId})', async () => {
    setUser({ tenantId: TENANT_A, role: 'HR_ADMIN' });
    const res = await request(app)
      .put(`/training/sfc/balance/${EMP_ID_2}`)
      .send({ balanceAmount: 750 });
    expect(res.status).toBe(200);
    expect(res.body.balanceAmount).toBe(750);

    const rows = await raw.employeeSfcBalance.findMany({ where: { employeeId: EMP_ID_2 } });
    expect(rows.length).toBe(1); // updated in place, not duplicated
  });
});
