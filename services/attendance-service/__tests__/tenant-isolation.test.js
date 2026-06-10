'use strict';

// Cross-tenant isolation for attendance-service (shared auto-scoping extension).
const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/utils/prisma');
const { run } = require('/app/shared/tenant-context');

const raw = new PrismaClient();
const A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const B = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const NAMES = ['ISO A1', 'ISO B1', 'ISO A2'];

beforeAll(async () => {
  await raw.shiftTemplate.deleteMany({ where: { name: { in: NAMES } } });
  await raw.shiftTemplate.create({ data: { tenantId: A, name: 'ISO A1', startTime: '09:00', endTime: '18:00' } });
  await raw.shiftTemplate.create({ data: { tenantId: B, name: 'ISO B1', startTime: '09:00', endTime: '18:00' } });
});
afterAll(async () => {
  await raw.shiftTemplate.deleteMany({ where: { name: { in: NAMES } } });
  await raw.$disconnect();
});

test('Tenant A context only sees Tenant A shift templates', async () => {
  const rows = await run(A, async () => { return await prisma.shiftTemplate.findMany({ where: {} }); });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.tenantId === A)).toBe(true);
  expect(rows.some((r) => r.name === 'ISO B1')).toBe(false);
});
test('Tenant A context CANNOT read a Tenant B shift template', async () => {
  const leaked = await run(A, async () => { return await prisma.shiftTemplate.findFirst({ where: { name: 'ISO B1' } }); });
  expect(leaked).toBeNull();
});
test('create stamps the active tenantId', async () => {
  const c = await run(A, async () => { return await prisma.shiftTemplate.create({ data: { name: 'ISO A2', startTime: '10:00', endTime: '19:00' } }); });
  expect(c.tenantId).toBe(A);
});
