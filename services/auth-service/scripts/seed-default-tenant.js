'use strict';

// Idempotent: ensures the fixed "Default" tenant + its subscription exist, so
// all pre-multitenancy rows (which the schema default stamps with this id) have
// a real tenant behind them. Runs on every boot BEFORE seed:rbac / seed:admin
// (those create roles/users that default to this tenant).
//
// Uses a RAW PrismaClient (not the auto-scoping client) so it can write tenant
// rows without a tenant context.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

(async () => {
  try {
    // The Default tenant represents the existing single-tenant deployment — it
    // must never be paywalled, so status ACTIVE + a far-future trial end.
    const farFuture = new Date('2099-12-31T00:00:00Z');

    await prisma.tenant.upsert({
      where: { id: DEFAULT_TENANT_ID },
      update: {},
      create: {
        id: DEFAULT_TENANT_ID,
        name: 'Default',
        slug: 'default',
        country: 'SG',
        status: 'ACTIVE',
        trialEndsAt: farFuture,
      },
    });

    await prisma.subscription.upsert({
      where: { tenantId: DEFAULT_TENANT_ID },
      update: {},
      create: {
        tenantId: DEFAULT_TENANT_ID,
        plan: 'trial',
        status: 'active',
        trialEndsAt: farFuture,
      },
    });

    // Defensive backfill: stamp any rows that somehow carry a NULL tenantId
    // (the column default covers existing rows on db push, but this makes the
    // script safe to run against partially-migrated data).
    await prisma.$executeRawUnsafe(`UPDATE users        SET "tenantId" = '${DEFAULT_TENANT_ID}' WHERE "tenantId" IS NULL;`);
    await prisma.$executeRawUnsafe(`UPDATE roles        SET "tenantId" = '${DEFAULT_TENANT_ID}' WHERE "tenantId" IS NULL;`);
    await prisma.$executeRawUnsafe(`UPDATE audit_logs   SET "tenantId" = '${DEFAULT_TENANT_ID}' WHERE "tenantId" IS NULL;`);
    await prisma.$executeRawUnsafe(`UPDATE otp_tokens   SET "tenantId" = '${DEFAULT_TENANT_ID}' WHERE "tenantId" IS NULL;`);

    console.log('[seed-default-tenant] Default tenant ensured:', DEFAULT_TENANT_ID);
    await prisma.$disconnect();
    process.exit(0);
  } catch (e) {
    console.error('[seed-default-tenant] FAILED:', e.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
})();
