'use strict';
/**
 * Migration: replace NULL `periodHalf` with the NONE sentinel on payroll_runs.
 *
 * WHY: Postgres treats every NULL as DISTINCT from every other NULL inside a
 * unique index. periodHalf is NULL for every MONTHLY/ADHOC/BONUS run, so the
 * PayrollRun unique key
 *   [tenantId, legalEntityId, period, runType, periodHalf]
 * constrained nothing for them — two identical monthly runs for the same entity
 * and period were both accepted, and duplicate finalised payroll was possible.
 * Only the application-level findFirst stood in the way, and a double-submit
 * races it.
 *
 * ⚠ RUN THIS BEFORE `prisma db push`.
 * The schema makes periodHalf non-nullable. Prisma refuses to apply that while
 * NULLs exist and suggests `--force-reset`, which DROPS THE DATABASE. Never do
 * that on real data. Correct order:
 *
 *     1. node scripts/migrate-period-half-sentinel.js     (this script)
 *     2. prisma db push                                   (now a no-op risk)
 *
 * Idempotent: re-running finds nothing to do.
 *
 * Usage:
 *   DRY_RUN=true node scripts/migrate-period-half-sentinel.js
 *   node scripts/migrate-period-half-sentinel.js
 *
 * Environment:
 *   PAYROLL_DB         — defaults to hrms_payroll
 *   POSTGRES_USER      — defaults to hrms
 *   POSTGRES_PASSWORD  — required (export it; never inline a read of .env)
 *   POSTGRES_HOST      — defaults to localhost
 *   POSTGRES_PORT      — defaults to 5432
 *   DRY_RUN=true       — report without changing anything
 */

const { pgConfig } = require('./migrate-legal-entities');

async function run() {
  const { Client } = require('pg');
  const dryRun = process.env.DRY_RUN === 'true';

  const db = new Client(pgConfig(process.env.PAYROLL_DB || 'hrms_payroll'));
  await db.connect();

  try {
    const { rows: before } = await db.query(
      'SELECT COUNT(*)::int AS n FROM payroll_runs WHERE "periodHalf" IS NULL',
    );
    const nullCount = before[0].n;

    if (dryRun) {
      console.log(`[dry-run] would add 'NONE' to the PeriodHalf enum if absent`);
      console.log(`[dry-run] would set periodHalf='NONE' on ${nullCount} payroll runs`);
      return;
    }

    // ADD VALUE must be committed before the value can be used in an UPDATE,
    // so this deliberately runs outside a transaction with the update.
    await db.query(`ALTER TYPE "PeriodHalf" ADD VALUE IF NOT EXISTS 'NONE'`);

    const res = await db.query(
      `UPDATE payroll_runs SET "periodHalf" = 'NONE' WHERE "periodHalf" IS NULL`,
    );

    const { rows: after } = await db.query(
      'SELECT COUNT(*)::int AS n FROM payroll_runs WHERE "periodHalf" IS NULL',
    );

    console.log(`payroll runs updated=${res.rowCount} (was ${nullCount} NULL, now ${after[0].n})`);
    if (after[0].n !== 0) {
      throw new Error(`${after[0].n} rows still NULL — do NOT run prisma db push`);
    }
    console.log('safe to run: prisma db push');
  } finally {
    await db.end();
  }
}

module.exports = { run };

if (require.main === module) {
  run().catch(err => { console.error(err); process.exit(1); });
}
