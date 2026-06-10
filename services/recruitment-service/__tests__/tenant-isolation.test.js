'use strict';

// Cross-tenant isolation for recruitment-service (shared auto-scoping extension).
const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/utils/prisma');
const { run } = require('/app/shared/tenant-context');

const raw = new PrismaClient();
const A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const B = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const EMAILS = ['iso-a1@iso.local', 'iso-b1@iso.local', 'iso-a2@iso.local'];

beforeAll(async () => {
  await raw.candidate.deleteMany({ where: { email: { in: EMAILS } } });
  await raw.candidate.create({ data: { tenantId: A, firstName: 'ISO', lastName: 'A1', email: 'iso-a1@iso.local' } });
  await raw.candidate.create({ data: { tenantId: B, firstName: 'ISO', lastName: 'B1', email: 'iso-b1@iso.local' } });
});
afterAll(async () => {
  await raw.candidate.deleteMany({ where: { email: { in: EMAILS } } });
  await raw.$disconnect();
});

test('Tenant A context only sees Tenant A candidates', async () => {
  const rows = await run(A, async () => { return await prisma.candidate.findMany({ where: {} }); });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.tenantId === A)).toBe(true);
  expect(rows.some((r) => r.email === 'iso-b1@iso.local')).toBe(false);
});
test('Tenant A context CANNOT read a Tenant B candidate', async () => {
  const leaked = await run(A, async () => { return await prisma.candidate.findFirst({ where: { email: 'iso-b1@iso.local' } }); });
  expect(leaked).toBeNull();
});
test('create stamps the active tenantId', async () => {
  const c = await run(A, async () => { return await prisma.candidate.create({ data: { firstName: 'ISO', lastName: 'A2', email: 'iso-a2@iso.local' } }); });
  expect(c.tenantId).toBe(A);
});
