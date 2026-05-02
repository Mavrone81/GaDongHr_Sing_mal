'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  console.log('Ensuring default super admin account...');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@hrms.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const adminName = process.env.ADMIN_NAME || 'System Administrator';

  // 1. Find the SUPER_ADMIN role
  const superAdminRole = await prisma.role.findUnique({
    where: { name: 'SUPER_ADMIN' }
  });

  if (!superAdminRole) {
    console.error('Error: SUPER_ADMIN role not found. Please run seed-rbac.js first.');
    process.exit(1);
  }

  // 2. Ensure all known admin accounts are pinned to SUPER_ADMIN
  const adminAccounts = [
    { email: adminEmail.toLowerCase(), password: adminPassword, name: adminName },
    { email: 'admin@vorkhive.sg', password: '***REMOVED***', name: 'Main System Admin' },
  ];

  for (const acc of adminAccounts) {
    const existing = await prisma.user.findUnique({ where: { email: acc.email } });
    if (existing) {
      console.log(`- ${acc.email} already exists. Ensuring SUPER_ADMIN role...`);
      await prisma.user.update({
        where: { id: existing.id },
        data: { roleId: superAdminRole.id, isActive: true },
      });
    } else {
      console.log(`- Creating super admin: ${acc.email}`);
      const passwordHash = await bcrypt.hash(acc.password, 10);
      await prisma.user.create({
        data: {
          email: acc.email,
          passwordHash,
          name: acc.name,
          roleId: superAdminRole.id,
          isActive: true,
        },
      });
      console.log(`- Created ${acc.email} successfully.`);
    }
  }

  console.log('Admin seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
