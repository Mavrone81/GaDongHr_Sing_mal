'use strict';
/**
 * Seed/upsert the initial super-admin account.
 *
 * Requires ADMIN_EMAIL and ADMIN_PASSWORD to be provided via the environment.
 * Previously this script defaulted to literal hardcoded passwords for both the
 * configured admin account and a silently-created secondary account — both were
 * known default credentials and a backdoor pattern. They have been removed.
 *
 * The account is created with mustChangePassword=true so that the first login
 * forces password rotation before the account can be used.
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

const PASSWORD_MIN_LEN = 12;
const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

function assertEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`[seed-initial-admin] FATAL: ${name} env var is required. Refusing to use a default password.`);
    process.exit(1);
  }
  return v.trim();
}

async function main() {
  const adminEmail = assertEnv('ADMIN_EMAIL').toLowerCase();
  const adminPassword = assertEnv('ADMIN_PASSWORD');
  const adminName = process.env.ADMIN_NAME || 'System Administrator';

  if (adminPassword.length < PASSWORD_MIN_LEN || !PASSWORD_PATTERN.test(adminPassword)) {
    console.error(`[seed-initial-admin] FATAL: ADMIN_PASSWORD must be >=${PASSWORD_MIN_LEN} chars and include upper, lower, digit, symbol.`);
    process.exit(1);
  }

  const superAdminRole = await prisma.role.findUnique({ where: { name: 'SUPER_ADMIN' } });
  if (!superAdminRole) {
    console.error('[seed-initial-admin] FATAL: SUPER_ADMIN role not found. Run seed-rbac.js first.');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    console.log(`[seed-initial-admin] ${adminEmail} already exists — leaving password untouched, pinning to SUPER_ADMIN.`);
    await prisma.user.update({
      where: { id: existing.id },
      data: { roleId: superAdminRole.id, isActive: true },
    });
  } else {
    console.log(`[seed-initial-admin] creating ${adminEmail} (mustChangePassword=true)`);
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        name: adminName,
        roleId: superAdminRole.id,
        isActive: true,
        mustChangePassword: true,
      },
    });
  }
  console.log('[seed-initial-admin] complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
