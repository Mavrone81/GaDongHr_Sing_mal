'use strict';

// Cross-tenant isolation for claims-service (shared auto-scoping extension).
// Run inside the container (DATABASE_URL reachable).
const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/utils/prisma');
const { run } = require('/app/shared/tenant-context');

const raw = new PrismaClient();
const A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const B = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const CODES = ['ISO-A1', 'ISO-B1', 'ISO-A2'];

beforeAll(async () => {
  await raw.claimCategory.deleteMany({ where: { code: { in: CODES } } });
  await raw.claimCategory.create({ data: { tenantId: A, code: 'ISO-A1', name: 'ISO A1' } });
  await raw.claimCategory.create({ data: { tenantId: B, code: 'ISO-B1', name: 'ISO B1' } });
});
afterAll(async () => {
  await raw.claimCategory.deleteMany({ where: { code: { in: CODES } } });
  await raw.$disconnect();
});

test('Tenant A context only sees Tenant A claim categories', async () => {
  const rows = await run(A, async () => { return await prisma.claimCategory.findMany({ where: {} }); });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.tenantId === A)).toBe(true);
  expect(rows.some((r) => r.code === 'ISO-B1')).toBe(false);
});
test('Tenant A context CANNOT read a Tenant B claim category', async () => {
  const leaked = await run(A, async () => { return await prisma.claimCategory.findFirst({ where: { code: 'ISO-B1' } }); });
  expect(leaked).toBeNull();
});
test('create stamps the active tenantId', async () => {
  const c = await run(A, async () => { return await prisma.claimCategory.create({ data: { code: 'ISO-A2', name: 'ISO A2' } }); });
  expect(c.tenantId).toBe(A);
});
