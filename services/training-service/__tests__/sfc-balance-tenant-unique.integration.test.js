'use strict';

/**
 * A5b — regression test for the compound-unique bug family on EmployeeSfcBalance.
 *
 * Schema: `@@unique([tenantId, employeeId])` (prisma/schema.prisma:280). POST
 * /training/sfc/declarations (../src/routes/grant.routes.js ~:333) built its
 * `where` from `employeeId` alone, inside a `$transaction([...])` — not a valid
 * Prisma unique selector once the index is `[tenantId, employeeId]` — so it threw
 * `PrismaClientValidationError` on every declaration, rolling back the whole
 * transaction (the enrollment update and the grant-claim record too, not just the
 * balance write).
 *
 * Needs a reachable DATABASE_URL (real @prisma/client, not mocked).
 *
 * Mutation proof (run once a DB is available): revert the `where` edit in
 * grant.routes.js, run this file (expect 500 / Prisma validation message, and
 * confirm via raw queries that NEITHER the enrollment nor the grant claim were
 * written — the transaction rollback), restore the fix, run again (expect the
 * statuses/rows asserted below) — paste both runs.
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
    data: { tenantId: TENANT_A, title: 'A5b SFC test program', status: 'PUBLISHED' },
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
