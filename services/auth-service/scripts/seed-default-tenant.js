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

    // ENT-001: a tenant must have at least one legal entity, because a payroll
    // run belongs to exactly one and POST /payroll/runs requires it. Without
    // this a FRESH stack — CI, a new dev machine, a new deployment — has a
    // tenant that cannot run payroll at all, and the only thing that created an
    // entity was scripts/migrate-legal-entities.js, a one-off backfill for
    // EXISTING installs that a fresh boot never runs.
    //
    // The Default tenant stands for the pre-multitenancy Singapore deployment,
    // so its primary entity is SG/SGD. Upserted on (tenantId, code) so repeated
    // boots are a no-op and an operator's edits to name/registrationNo survive.
    await prisma.legalEntity.upsert({
      where: { tenantId_code: { tenantId: DEFAULT_TENANT_ID, code: 'DEFAULT' } },
      update: {},
      create: {
        tenantId: DEFAULT_TENANT_ID,
        name: 'Default Entity',
        code: 'DEFAULT',
        country: 'SG',
        currency: 'SGD',
        timezone: 'Asia/Singapore',
        isPrimary: true,
        isActive: true,
      },
    });

    // Defensive backfill: stamp any rows that somehow carry a NULL tenantId
    // (the column default covers existing rows on db push, but this makes the
    // script safe to run against partially-migrated data).
    await prisma.$executeRawUnsafe(`UPDATE users        SET "tenantId" = '${DEFAULT_TENANT_ID}' WHERE "tenantId" IS NULL;`);
    await prisma.$executeRawUnsafe(`UPDATE roles        SET "tenantId" = '${DEFAULT_TENANT_ID}' WHERE "tenantId" IS NULL;`);
    await prisma.$executeRawUnsafe(`UPDATE audit_logs   SET "tenantId" = '${DEFAULT_TENANT_ID}' WHERE "tenantId" IS NULL;`);
    await prisma.$executeRawUnsafe(`UPDATE otp_tokens   SET "tenantId" = '${DEFAULT_TENANT_ID}' WHERE "tenantId" IS NULL;`);

    console.log('[seed-default-tenant] Default tenant + primary legal entity ensured:', DEFAULT_TENANT_ID);
    await prisma.$disconnect();
    process.exit(0);
  } catch (e) {
    console.error('[seed-default-tenant] FAILED:', e.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
})();
