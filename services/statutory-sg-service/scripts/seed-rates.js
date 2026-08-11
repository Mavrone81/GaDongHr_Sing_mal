'use strict';

/**
 * Ensure the canonical SG rate version exists. Runs on every boot, idempotent.
 *
 * WHY THIS EXISTS
 *
 * compute-batch fails CLOSED when there is no active rate version — deliberately,
 * because computing CPF against a default or the nearest version is worse than
 * an outage. But nothing ever populated these tables on a FRESH stack: the only
 * writer was scripts/migrate-statutory-tables-sg.js, a one-off backfill for
 * EXISTING installs that a new deployment never runs.
 *
 * So a brand-new deployment came up unable to run payroll at all, and said so
 * only as "No active SG rate version" at compute time. That is the third
 * instance of the same pattern in this codebase — migration scripts doing work
 * that fresh installs also need (see also the Default tenant's legal entity).
 *
 * The migration script remains the right tool for EXISTING installs: it also
 * produces the per-tenant divergence report, which only makes sense where
 * per-tenant rows already exist. This one only ensures the baseline.
 */
const { PrismaClient } = require('@prisma/client');
const { SG_2026_1 } = require('../src/seed/sg-2026-1');

const prisma = new PrismaClient();

(async () => {
  try {
    const existing = await prisma.rateVersion.findUnique({
      where: { version: SG_2026_1.version },
    });
    if (existing) {
      console.log(`[seed-rates] ${SG_2026_1.version} already present — nothing to do`);
      await prisma.$disconnect();
      process.exit(0);
    }

    // One transaction: a half-seeded version is worse than none, because
    // compute would find it active and then compute against partial bands.
    await prisma.$transaction([
      prisma.rateVersion.create({
        data: {
          country: 'SG',
          version: SG_2026_1.version,
          effectiveFrom: new Date(SG_2026_1.effectiveFrom),
          source: SG_2026_1.source,
          retrievedAt: new Date(SG_2026_1.retrievedAt),
          isActive: true,
        },
      }),
      prisma.cpfRate.createMany({
        data: SG_2026_1.cpfRates.map((r) => ({
          rateVersion: SG_2026_1.version,
          citizenStatus: r.citizenStatus,
          ageMin: r.ageMin,
          ageMax: r.ageMax,
          employeeRate: r.employeeRate,
          employerRate: r.employerRate,
          owCeiling: r.owCeiling,
          awCeiling: r.awCeiling,
        })),
      }),
      prisma.sdlConfig.create({
        data: {
          rateVersion: SG_2026_1.version,
          rate: SG_2026_1.sdlConfig.rate,
          minAmount: SG_2026_1.sdlConfig.minAmount,
          maxAmount: SG_2026_1.sdlConfig.maxAmount,
          salaryCap: SG_2026_1.sdlConfig.salaryCap,
        },
      }),
    ]);

    console.log(
      `[seed-rates] seeded ${SG_2026_1.version}: ` +
      `${SG_2026_1.cpfRates.length} CPF bands + SDL config`);
    await prisma.$disconnect();
    process.exit(0);
  } catch (e) {
    console.error('[seed-rates] FAILED:', e.message);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }
})();
