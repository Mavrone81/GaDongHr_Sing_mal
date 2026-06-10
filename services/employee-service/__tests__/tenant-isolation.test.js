'use strict';

// Proves employee-service rows are tenant-isolated by the shared auto-scoping
// extension. Run inside the container (DATABASE_URL reachable).
const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/utils/prisma');          // auto-scoping client
const { run } = require('/app/shared/tenant-context');

const raw = new PrismaClient();                          // un-scoped, for setup
const A = 'aaaaaaaa-0000-0000-0000-0000000000aa';
const B = 'bbbbbbbb-0000-0000-0000-0000000000bb';

function emp(tenantId, code) {
  return {
    tenantId, employeeCode: code, fullName: `ISO ${code}`,
    workEmail: `${code}@iso.local`, department: 'Eng', designation: 'Dev',
    startDate: new Date('2024-01-01'),
  };
}

beforeAll(async () => {
  await raw.employee.deleteMany({ where: { employeeCode: { in: ['ISO-A1', 'ISO-B1'] } } });
  await raw.employee.create({ data: emp(A, 'ISO-A1') });
  await raw.employee.create({ data: emp(B, 'ISO-B1') });
});

afterAll(async () => {
  await raw.employee.deleteMany({ where: { employeeCode: { in: ['ISO-A1', 'ISO-B1', 'ISO-A2'] } } });
  await raw.$disconnect();
});

test('Tenant A context only sees Tenant A employees', async () => {
  const rows = await run(A, async () => { return await prisma.employee.findMany({ where: {} }); });
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((e) => e.tenantId === A)).toBe(true);
  expect(rows.some((e) => e.employeeCode === 'ISO-B1')).toBe(false);
});

test('Tenant A context CANNOT read a Tenant B employee', async () => {
  const leaked = await run(A, async () => { return await prisma.employee.findFirst({ where: { employeeCode: 'ISO-B1' } }); });
  expect(leaked).toBeNull();
});

test('create stamps the active tenantId', async () => {
  const created = await run(A, async () => {
    return await prisma.employee.create({ data: { employeeCode: 'ISO-A2', fullName: 'ISO A2', workEmail: 'a2@iso.local', department: 'Eng', designation: 'Dev', startDate: new Date('2024-01-01') } });
  });
  expect(created.tenantId).toBe(A);
});
