'use strict';
/**
 * PAY-001 — Unit/regression tests for ensurePayrollConstraints.
 *
 * Regression context: the maker-checker CHECK constraint SQL originally
 * referenced unquoted snake_case columns (approved_by / initiated_by). The
 * Prisma model PayrollRun has NO @map on initiatedBy/approvedBy, so Postgres
 * stores case-preserved identifiers — unquoted `approved_by` does not exist and
 * the ALTER TABLE threw "column ... does not exist". The error was swallowed by
 * the try/catch, so the constraint was silently never created and the
 * maker-checker rule was unenforced at the DB level.
 *
 * These tests lock the fix in place:
 *   - SQL must reference quoted camelCase "approvedBy" / "initiatedBy"
 *   - SQL must NOT reference the broken snake_case identifiers
 *   - Creation is guarded idempotently by constraint name (IF NOT EXISTS)
 *   - Failures are swallowed (startup must not crash) and logged
 *
 * The constraint is gated on DISABLE_MAKER_CHECKER so the DB layer agrees with
 * the app-level guard in payroll.routes.js: when the rule is disabled (single
 * admin) the constraint must be dropped, not created, otherwise a self-approving
 * admin passes the app check but is rejected by the DB on UPDATE.
 */

const { ensurePayrollConstraints } = require('../src/db-constraints');

function makePrisma(impl) {
  return { $executeRawUnsafe: jest.fn(impl || (async () => 0)) };
}

describe('ensurePayrollConstraints — generated SQL', () => {
  let logSpy, errSpy, prevFlag;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // DC1–DC4 assert the maker-checker-enabled path; ensure the flag is unset.
    prevFlag = process.env.DISABLE_MAKER_CHECKER;
    delete process.env.DISABLE_MAKER_CHECKER;
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (prevFlag === undefined) delete process.env.DISABLE_MAKER_CHECKER;
    else process.env.DISABLE_MAKER_CHECKER = prevFlag;
  });

  test('DC1 — references quoted camelCase columns "approvedBy"/"initiatedBy"', async () => {
    const prisma = makePrisma();
    await ensurePayrollConstraints(prisma);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = prisma.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('"approvedBy"');
    expect(sql).toContain('"initiatedBy"');
  });

  test('DC2 — regression: does NOT reference non-existent snake_case columns', async () => {
    const prisma = makePrisma();
    await ensurePayrollConstraints(prisma);

    const sql = prisma.$executeRawUnsafe.mock.calls[0][0];
    // The original bug: unquoted snake_case columns that Postgres has no record of.
    expect(sql).not.toMatch(/\bapproved_by\b/);
    expect(sql).not.toMatch(/\binitiated_by\b/);
  });

  test('DC3 — guards creation idempotently by constraint name', async () => {
    const prisma = makePrisma();
    await ensurePayrollConstraints(prisma);

    const sql = prisma.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('payroll_runs_maker_checker_diff');
    expect(sql).toContain('IF NOT EXISTS');
    expect(sql).toMatch(/ALTER TABLE\s+payroll_runs/);
  });

  test('DC4 — swallows DB errors so startup does not crash, and logs them', async () => {
    const prisma = makePrisma(async () => {
      throw new Error('column "approved_by" does not exist');
    });

    await expect(ensurePayrollConstraints(prisma)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    const loggedMsg = errSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(loggedMsg).toMatch(/Failed to ensure payroll CHECK constraints/);
  });

  test('DC5 — DISABLE_MAKER_CHECKER=true drops the constraint instead of adding it', async () => {
    process.env.DISABLE_MAKER_CHECKER = 'true';
    const prisma = makePrisma();
    await ensurePayrollConstraints(prisma);

    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    const sql = prisma.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS\s+payroll_runs_maker_checker_diff/);
    // It must NOT create the constraint — that would block single-admin self-approval.
    expect(sql).not.toMatch(/ADD CONSTRAINT/);
  });

  test('DC6 — regression: disabled path agrees with the app guard (no ADD CONSTRAINT)', async () => {
    // Mirrors payroll.routes.js: process.env.DISABLE_MAKER_CHECKER !== \'true\' ⇒ enabled.
    // Any other value (incl. \'false\') keeps the rule enabled and creates the constraint.
    process.env.DISABLE_MAKER_CHECKER = 'false';
    const prisma = makePrisma();
    await ensurePayrollConstraints(prisma);

    const sql = prisma.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toMatch(/ADD CONSTRAINT\s+payroll_runs_maker_checker_diff/);
    expect(sql).not.toMatch(/DROP CONSTRAINT/);
  });
});
