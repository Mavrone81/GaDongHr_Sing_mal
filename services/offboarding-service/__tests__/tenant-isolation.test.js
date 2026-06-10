'use strict';

// Cross-tenant isolation for offboarding-service (shared auto-scoping extension).
const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/utils/prisma');
const { run } = require('/app/shared/tenant-context');

const raw = new PrismaClient();
const A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const B = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const EMPS = ['ISO-A1', 'ISO-B1', 'ISO-A2'];
const d = (s) => new Date(s);

function row(tenantId, employeeId) {
  return { tenantId, employeeId, lastWorkingDate: d('2024-02-01'), noticeGivenDate: d('2024-01-01'), noticePeriodDays: 30, initiatedBy: 'tester', reason: 'RESIGNATION' };
}

beforeAll(async () => {
  await raw.offboardingCase.deleteMany({ where: { employeeId: { in: EMPS } } });
  await raw.offboardingCase.create({ data: row(A, 'ISO-A1') });
  await raw.offboardingCase.create({ data: row(B, 'ISO-B1') });
});
afterAll(async () => {
  await raw.offboardingCase.deleteMany({ where: { employeeId: { in: EMPS } } });
  await raw.$disconnect();
});

test('Tenant A context only sees Tenant A offboarding cases', async () => {
  const rows = await run(A, async () => { return await prisma.offboardingCase.findMany({ where: {} }); });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.tenantId === A)).toBe(true);
  expect(rows.some((r) => r.employeeId === 'ISO-B1')).toBe(false);
});
test('Tenant A context CANNOT read a Tenant B offboarding case', async () => {
  const leaked = await run(A, async () => { return await prisma.offboardingCase.findFirst({ where: { employeeId: 'ISO-B1' } }); });
  expect(leaked).toBeNull();
});
test('create stamps the active tenantId', async () => {
  const c = await run(A, async () => { return await prisma.offboardingCase.create({ data: row(undefined, 'ISO-A2') }); });
  expect(c.tenantId).toBe(A);
});
