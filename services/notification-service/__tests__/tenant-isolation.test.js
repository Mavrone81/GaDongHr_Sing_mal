'use strict';

// Cross-tenant isolation for notification-service (shared auto-scoping extension).
const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/utils/prisma');
const { run } = require('/app/shared/tenant-context');

const raw = new PrismaClient();
const A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const B = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const TITLES = ['ISO A1', 'ISO B1', 'ISO A2'];

beforeAll(async () => {
  await raw.notification.deleteMany({ where: { title: { in: TITLES } } });
  await raw.notification.create({ data: { tenantId: A, userId: 'u-a', title: 'ISO A1', body: 'b' } });
  await raw.notification.create({ data: { tenantId: B, userId: 'u-b', title: 'ISO B1', body: 'b' } });
});
afterAll(async () => {
  await raw.notification.deleteMany({ where: { title: { in: TITLES } } });
  await raw.$disconnect();
});

test('Tenant A context only sees Tenant A notifications', async () => {
  const rows = await run(A, async () => { return await prisma.notification.findMany({ where: {} }); });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.tenantId === A)).toBe(true);
  expect(rows.some((r) => r.title === 'ISO B1')).toBe(false);
});
test('Tenant A context CANNOT read a Tenant B notification', async () => {
  const leaked = await run(A, async () => { return await prisma.notification.findFirst({ where: { title: 'ISO B1' } }); });
  expect(leaked).toBeNull();
});
test('create stamps the active tenantId', async () => {
  const c = await run(A, async () => { return await prisma.notification.create({ data: { userId: 'u-a', title: 'ISO A2', body: 'b' } }); });
  expect(c.tenantId).toBe(A);
});
