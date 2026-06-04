'use strict';
/**
 * PAY-001 — Idempotent database CHECK constraints for payroll integrity.
 *
 * These constraints back the application-level rules so neither a buggy code
 * path nor a direct DB write can violate them:
 *
 *   payroll_runs_maker_checker_diff
 *     CHECK ("approvedBy" IS NULL OR "approvedBy" != "initiatedBy")
 *     Enforces the maker-checker rule: the user who approves a payroll run
 *     must be a different user from the one who initiated it.
 *
 * Called once at service startup. Safe to re-run — uses DO blocks that detect
 * pre-existing constraints and skip.
 *
 * The constraint is only enforced when maker-checker is enabled. It must agree
 * with the application-level guard in payroll.routes.js, which skips the rule
 * when DISABLE_MAKER_CHECKER=true (single-admin deployments). If the two layers
 * disagree, a self-approving admin passes the app check only to be rejected by
 * the DB on UPDATE — so when the rule is disabled we make sure the constraint
 * is absent, and when it is enabled we (idempotently) create it.
 */

async function ensurePayrollConstraints(prisma) {
  const makerCheckerEnabled = process.env.DISABLE_MAKER_CHECKER !== 'true';
  try {
    if (!makerCheckerEnabled) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_maker_checker_diff;`
      );
      console.log('[payroll-service] Maker-checker disabled (DISABLE_MAKER_CHECKER=true); DB CHECK constraint payroll_runs_maker_checker_diff not enforced.');
      return;
    }
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'payroll_runs_maker_checker_diff'
        ) THEN
          ALTER TABLE payroll_runs
            ADD CONSTRAINT payroll_runs_maker_checker_diff
            CHECK ("approvedBy" IS NULL OR "approvedBy" <> "initiatedBy");
        END IF;
      END$$;
    `);
    console.log('[payroll-service] DB CHECK constraint payroll_runs_maker_checker_diff ensured.');
  } catch (err) {
    // Don't crash startup — log clearly so ops can investigate.
    console.error('[payroll-service] Failed to ensure payroll CHECK constraints:', err.message);
  }
}

module.exports = { ensurePayrollConstraints };
