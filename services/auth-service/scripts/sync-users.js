'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const authPrisma = new PrismaClient();

async function main() {
  console.log('Starting User Synchronization...');

  const employeeUrl = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';
  
  console.log(`Fetching employees from ${employeeUrl}/employees...`);
  
  let employees = [];
  try {
    const internalKey = process.env.INTERNAL_SERVICE_KEY;
    const response = await fetch(`${employeeUrl}/employees?limit=1000`, {
      headers: { 'x-internal-service-key': internalKey }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    employees = data.employees || [];
  } catch (err) {
    console.error('Failed to fetch employees:', err.message);
    return;
  }

  console.log(`Found ${employees.length} employees to process.`);

  const employeeRole = await authPrisma.role.findFirst({
    where: { name: 'EMPLOYEE' }
  });

  if (!employeeRole) {
    console.error('EMPLOYEE role not found in Auth database.');
    return;
  }

  let createdCount = 0;
  let skippedCount = 0;

  for (const emp of employees) {
    const existing = await authPrisma.user.findUnique({
      where: { email: emp.workEmail.toLowerCase() }
    });

    if (existing) {
      skippedCount++;
      continue;
    }

    const passwordHash = await bcrypt.hash('EzyHRM@2025!', 12);
    await authPrisma.user.create({
      data: {
        id: uuidv4(),
        email: emp.workEmail.toLowerCase(),
        passwordHash,
        name: emp.fullName,
        roleId: employeeRole.id,
        employeeId: emp.id
      }
    });

    console.log(`- Created user for: ${emp.fullName} (${emp.workEmail})`);
    createdCount++;
  }

  console.log('--- Sync Report ---');
  console.log(`Total Employees: ${employees.length}`);
  console.log(`Users Created:   ${createdCount}`);
  console.log(`Users Skipped:   ${skippedCount}`);
  console.log('Sync Complete.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await authPrisma.$disconnect();
  });
