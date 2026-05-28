'use strict';
/**
 * Bulk-create auth-service user accounts for every employee in the
 * employee-service that doesn't yet have one.
 *
 * Each new user gets:
 *   - a random per-user temporary password (32-byte hex), bcrypt-hashed
 *   - mustChangePassword=true so first login forces rotation
 *   - an invite token (40-byte hex, single-use, 7-day expiry) printed to stdout
 *     so an operator can deliver the password-reset link out of band
 *
 * Previously this script bcrypt-hashed a single hardcoded shared password for
 * every account it created — anyone with seed-script knowledge could have
 * accessed every synced user. That literal has been removed.
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const authPrisma = new PrismaClient();

function randomPassword() {
  // 32 bytes of CSPRNG entropy, encoded as base64url for transport friendliness.
  // bcrypt limits us to 72 bytes — this is well under that.
  return crypto.randomBytes(32).toString('base64url');
}

function randomInviteToken() {
  return crypto.randomBytes(40).toString('hex');
}

async function main() {
  console.log('Starting User Synchronization...');

  if (!process.env.INTERNAL_SERVICE_KEY) {
    console.error('FATAL: INTERNAL_SERVICE_KEY env var is required.');
    process.exit(1);
  }

  const employeeUrl = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';
  console.log(`Fetching employees from ${employeeUrl}/employees...`);

  let employees = [];
  try {
    const response = await fetch(`${employeeUrl}/employees?limit=1000`, {
      headers: { 'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY },
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    employees = data.employees || [];
  } catch (err) {
    console.error('Failed to fetch employees:', err.message);
    return;
  }

  console.log(`Found ${employees.length} employees to process.`);

  const employeeRole = await authPrisma.role.findFirst({ where: { name: 'EMPLOYEE' } });
  if (!employeeRole) {
    console.error('EMPLOYEE role not found in Auth database.');
    return;
  }

  let createdCount = 0;
  let skippedCount = 0;
  const inviteRecords = [];

  for (const emp of employees) {
    const existing = await authPrisma.user.findUnique({ where: { email: emp.workEmail.toLowerCase() } });
    if (existing) {
      skippedCount++;
      continue;
    }

    const tempPassword = randomPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const inviteToken  = randomInviteToken();
    const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await authPrisma.user.create({
      data: {
        id: uuidv4(),
        email: emp.workEmail.toLowerCase(),
        passwordHash,
        name: emp.fullName,
        roleId: employeeRole.id,
        employeeId: emp.id,
        mustChangePassword: true,
        inviteToken,
        inviteExpiry,
      },
    });

    inviteRecords.push({ email: emp.workEmail, inviteToken });
    console.log(`- Created user for: ${emp.fullName} (${emp.workEmail})`);
    createdCount++;
  }

  console.log('--- Sync Report ---');
  console.log(`Total Employees: ${employees.length}`);
  console.log(`Users Created:   ${createdCount}`);
  console.log(`Users Skipped:   ${skippedCount}`);
  if (inviteRecords.length > 0) {
    console.log('\nInvite tokens (deliver out-of-band — DO NOT email through this script):');
    for (const r of inviteRecords) console.log(`  ${r.email}\t${r.inviteToken}`);
  }
  console.log('Sync Complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => authPrisma.$disconnect());
