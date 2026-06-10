'use strict';

// Cross-tenant isolation for payroll-service (shared auto-scoping extension).
const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/utils/prisma');
const { run } = require('/app/shared/tenant-context');

const raw = new PrismaClient();
const A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const B = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const CODES = ['ISO-A1', 'ISO-B1', 'ISO-A2'];

beforeAll(async () => {
  await raw.costCentre.deleteMany({ where: { code: { in: CODES } } });
  await raw.costCentre.create({ data: { tenantId: A, code: 'ISO-A1', name: 'ISO A1' } });
  await raw.costCentre.create({ data: { tenantId: B, code: 'ISO-B1', name: 'ISO B1' } });
});
afterAll(async () => {
  await raw.costCentre.deleteMany({ where: { code: { in: CODES } } });
  await raw.$disconnect();
});

test('Tenant A context only sees Tenant A cost centres', async () => {
  const rows = await run(A, async () => { return await prisma.costCentre.findMany({ where: {} }); });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.tenantId === A)).toBe(true);
  expect(rows.some((r) => r.code === 'ISO-B1')).toBe(false);
});
test('Tenant A context CANNOT read a Tenant B cost centre', async () => {
  const leaked = await run(A, async () => { return await prisma.costCentre.findFirst({ where: { code: 'ISO-B1' } }); });
  expect(leaked).toBeNull();
});
test('create stamps the active tenantId', async () => {
  const c = await run(A, async () => { return await prisma.costCentre.create({ data: { code: 'ISO-A2', name: 'ISO A2' } }); });
  expect(c.tenantId).toBe(A);
});
