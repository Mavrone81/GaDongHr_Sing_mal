'use strict';

// Cross-tenant isolation for asset-service (shared auto-scoping extension).
const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/utils/prisma');
const { run } = require('/app/shared/tenant-context');

const raw = new PrismaClient();
const A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const B = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const CODES = ['ISO-A1', 'ISO-B1', 'ISO-A2'];

beforeAll(async () => {
  await raw.asset.deleteMany({ where: { assetCode: { in: CODES } } });
  await raw.asset.create({ data: { tenantId: A, assetCode: 'ISO-A1', name: 'ISO A1', category: 'LAPTOP' } });
  await raw.asset.create({ data: { tenantId: B, assetCode: 'ISO-B1', name: 'ISO B1', category: 'LAPTOP' } });
});
afterAll(async () => {
  await raw.asset.deleteMany({ where: { assetCode: { in: CODES } } });
  await raw.$disconnect();
});

test('Tenant A context only sees Tenant A assets', async () => {
  const rows = await run(A, async () => { return await prisma.asset.findMany({ where: {} }); });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.tenantId === A)).toBe(true);
  expect(rows.some((r) => r.assetCode === 'ISO-B1')).toBe(false);
});
test('Tenant A context CANNOT read a Tenant B asset', async () => {
  const leaked = await run(A, async () => { return await prisma.asset.findFirst({ where: { assetCode: 'ISO-B1' } }); });
  expect(leaked).toBeNull();
});
test('create stamps the active tenantId', async () => {
  const c = await run(A, async () => { return await prisma.asset.create({ data: { assetCode: 'ISO-A2', name: 'ISO A2', category: 'LAPTOP' } }); });
  expect(c.tenantId).toBe(A);
});
