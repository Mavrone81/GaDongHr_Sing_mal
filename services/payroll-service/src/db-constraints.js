'use strict';
/**
 * PAY-001 — Idempotent database CHECK constraints for payroll integrity.
 *
 * These constraints back the application-level rules so neither a buggy code
 * path nor a direct DB write can violate them:
 *
 *   payroll_runs_maker_checker_diff
 *     CHECK (approved_by IS NULL OR approved_by != initiated_by)
 *     Enforces the maker-checker rule: the user who approves a payroll run
 *     must be a different user from the one who initiated it.
 *
 * Called once at service startup. Safe to re-run — uses DO blocks that detect
 * pre-existing constraints and skip.
 */

async function ensurePayrollConstraints(prisma) {
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'payroll_runs_maker_checker_diff'
        ) THEN
          ALTER TABLE payroll_runs
            ADD CONSTRAINT payroll_runs_maker_checker_diff
            CHECK (approved_by IS NULL OR approved_by <> initiated_by);
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
