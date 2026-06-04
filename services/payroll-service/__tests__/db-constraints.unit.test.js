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
 */

const { ensurePayrollConstraints } = require('../src/db-constraints');

function makePrisma(impl) {
  return { $executeRawUnsafe: jest.fn(impl || (async () => 0)) };
}

describe('ensurePayrollConstraints — generated SQL', () => {
  let logSpy, errSpy;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
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
});
