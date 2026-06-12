'use strict';

/**
 * One-off migration: encrypt any pre-existing plaintext `passNumber` values
 * in place (the column now holds AES-256-GCM ciphertext, like nric/salary/bank).
 * Idempotent — values that are already ciphertext are skipped, so it is safe to
 * re-run. Requires ENCRYPTION_KEY in the environment.
 *
 * Run (inside the container):
 *   docker exec hrms-employee node /app/services/employee-service/scripts/encrypt-passnumber.js
 */

const { PrismaClient } = require('@prisma/client');

// Works both in-container (/app/shared) and from the repo (relative).
let cryptoLib;
try { cryptoLib = require('/app/shared/crypto'); }
catch { cryptoLib = require('../../../shared/crypto'); }
const { encrypt } = cryptoLib;

function looksEncrypted(v) {
  try { const o = JSON.parse(v); return !!(o && o.iv && o.tag && o.data); }
  catch { return false; }
}

(async () => {
  const prisma = new PrismaClient();
  const rows = await prisma.employee.findMany({
    where: { passNumber: { not: null } },
    select: { id: true, passNumber: true },
  });
  let migrated = 0, skipped = 0;
  for (const r of rows) {
    if (!r.passNumber || looksEncrypted(r.passNumber)) { skipped++; continue; }
    await prisma.employee.update({ where: { id: r.id }, data: { passNumber: encrypt(r.passNumber) } });
    migrated++;
  }
  console.log(`passNumber migration: encrypted ${migrated}, skipped ${skipped} (already-encrypted/empty), of ${rows.length} non-null.`);
  await prisma.$disconnect();
})().catch((e) => { console.error('migration failed:', e.message); process.exit(1); });
