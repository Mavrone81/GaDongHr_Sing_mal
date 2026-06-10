'use strict';

// Proves the auto-scoping Prisma extension isolates tenants: a query run under
// Tenant A's context can never read Tenant B's rows, and creates are stamped
// with the active tenantId. Requires a reachable DATABASE_URL (run inside the
// auth-service container or with the DB published locally).
const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/utils/prisma');          // auto-scoping client
const { run } = require('../src/utils/tenantContext');

const raw = new PrismaClient();                          // un-scoped, for setup
const A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const B = 'bbbbbbbb-0000-0000-0000-0000000000bb';
const farFuture = new Date('2099-12-31T00:00:00Z');

beforeAll(async () => {
  for (const id of [A, B]) {
    await raw.tenant.upsert({
      where: { id },
      update: {},
      create: { id, name: `iso-${id.slice(0, 4)}`, slug: `iso-${id.slice(0, 8)}`, trialEndsAt: farFuture },
    });
  }
  await raw.user.upsert({
    where: { tenantId_email: { tenantId: A, email: 'iso-a@test.local' } },
    update: {}, create: { tenantId: A, email: 'iso-a@test.local', passwordHash: 'x', name: 'User A' },
  });
  await raw.user.upsert({
    where: { tenantId_email: { tenantId: B, email: 'iso-b@test.local' } },
    update: {}, create: { tenantId: B, email: 'iso-b@test.local', passwordHash: 'x', name: 'User B' },
  });
});

afterAll(async () => {
  await raw.user.deleteMany({ where: { tenantId: { in: [A, B] } } });
  await raw.tenant.deleteMany({ where: { id: { in: [A, B] } } });
  await raw.$disconnect();
});

// NOTE: the operations must be AWAITED INSIDE run() so the Prisma query
// executes within the AsyncLocalStorage context — the same way an async Express
// route handler runs inside `als.run(store, () => next())`.

test('Tenant A context only sees Tenant A users', async () => {
  const users = await run(A, async () => { return await prisma.user.findMany({ where: {} }); });
  expect(users.length).toBeGreaterThan(0);
  expect(users.every((u) => u.tenantId === A)).toBe(true);
  expect(users.some((u) => u.email === 'iso-b@test.local')).toBe(false);
});

test('Tenant A context CANNOT read a Tenant B user by email', async () => {
  const leaked = await run(A, async () => { return await prisma.user.findFirst({ where: { email: 'iso-b@test.local' } }); });
  expect(leaked).toBeNull();
});

test('Tenant B context only sees Tenant B users', async () => {
  const users = await run(B, async () => { return await prisma.user.findMany({ where: {} }); });
  expect(users.every((u) => u.tenantId === B)).toBe(true);
  expect(users.some((u) => u.email === 'iso-a@test.local')).toBe(false);
});

test('create stamps the active tenantId', async () => {
  const created = await run(A, async () => {
    return await prisma.user.create({ data: { email: 'iso-create@test.local', passwordHash: 'x', name: 'Created' } });
  });
  expect(created.tenantId).toBe(A);
  await raw.user.delete({ where: { id: created.id } });
});
