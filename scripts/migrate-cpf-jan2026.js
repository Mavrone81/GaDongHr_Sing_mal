'use strict';
/**
 * Migration: upgrade CPF contribution rates to Jan 2026 values.
 *
 * Source of truth: CPF Board "CPF Contribution Rate Table from 1 January 2026"
 * (CPFcontributionratesfrom1Jan2026.pdf in this repo, Tables 1, 2, and 3).
 *
 * Changes vs the pre-Jan-2026 seed:
 *   - OW monthly ceiling: $6,800  →  $8,000
 *   - SC/PR Yr3+ age 55-60:  16% / 15%      →  18% / 16%
 *   - SC/PR Yr3+ age 60-65:  10.5% / 11.5%  →  12.5% / 12.5%
 *   - SC/PR Yr3+ age 65-70:  7.5% / 9%      →  (unchanged)
 *   - SC/PR Yr3+ age 70+:    5% / 7.5%      →  (unchanged)
 *   - PR Year 1: single row 0/null with 5%/4%
 *       → split into 0-60 (5%/4%) and 60+ (5%/3.5%)
 *   - PR Year 2: single row 0/null with 15%/9%
 *       → split into ≤55 (15%/9%), 55-60 (12.5%/6%), 60-65 (7.5%/3.5%), 65+ (5%/3.5%)
 *   - FOREIGNER:  unchanged (0%/0%)
 *
 * Use this script when an existing deployment already has Jan 2025 (or earlier)
 * rates seeded in `cpf_rates`. The seed.js insert-only path will not update
 * them, since it skips when rows already exist.
 *
 * Safety: this is a destructive replace. It deletes ALL rows in cpf_rates and
 * inserts the Jan 2026 rows in one transaction. Run AFTER any existing payroll
 * runs for periods before 2026-01 have been FINALISED (those should retain
 * their historical CPF computations via the payslip records, not the rate
 * table — verify this before running).
 *
 * Usage:
 *   node scripts/migrate-cpf-jan2026.js
 *
 * Environment:
 *   PAYROLL_DB           — defaults to hrms_payroll
 *   POSTGRES_USER        — defaults to hrms
 *   POSTGRES_PASSWORD    — defaults to hrms_secret_2025
 *   POSTGRES_HOST        — defaults to localhost
 *   POSTGRES_PORT        — defaults to 5432
 *   DRY_RUN=true         — print intended changes without applying
 */

const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

const DRY_RUN = process.env.DRY_RUN === 'true';

const RATES_JAN_2026 = [
  // [citizenStatus, ageMin, ageMax, employeeRate, employerRate]
  ['SC_PR',    0,  55,   0.20,  0.17 ],
  ['SC_PR',   55,  60,   0.18,  0.16 ],
  ['SC_PR',   60,  65,   0.125, 0.125],
  ['SC_PR',   65,  70,   0.075, 0.09 ],
  ['SC_PR',   70,  null, 0.05,  0.075],
  ['PR_YEAR1', 0,  60,   0.05,  0.04 ],
  ['PR_YEAR1', 60, null, 0.05,  0.035],
  ['PR_YEAR2', 0,  55,   0.15,  0.09 ],
  ['PR_YEAR2', 55, 60,   0.125, 0.06 ],
  ['PR_YEAR2', 60, 65,   0.075, 0.035],
  ['PR_YEAR2', 65, null, 0.05,  0.035],
  ['FOREIGNER', 0, null, 0.0,   0.0  ],
];

const OW_CEILING = 8000;
const AW_CEILING = 102000;
const EFFECTIVE = '2026-01-01';

async function main() {
  const db = new Client({
    user:     process.env.POSTGRES_USER     || 'hrms',
    password: process.env.POSTGRES_PASSWORD || 'hrms_secret_2025',
    host:     process.env.POSTGRES_HOST     || 'localhost',
    port:     Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.PAYROLL_DB        || 'hrms_payroll',
  });
  await db.connect();

  console.log(`[migrate-cpf-jan2026] Connected to ${db.database}`);
  console.log(`[migrate-cpf-jan2026] DRY_RUN=${DRY_RUN}`);

  // Snapshot the existing rates so the operator can see what's being replaced.
  const existing = await db.query(
    `SELECT "citizenStatus", "ageMin", "ageMax", "employeeRate", "employerRate", "owCeiling", "awCeiling", "effectiveDate"
     FROM cpf_rates ORDER BY "citizenStatus", "ageMin"`,
  );
  console.log(`[migrate-cpf-jan2026] Existing rows (${existing.rowCount}):`);
  for (const r of existing.rows) {
    console.log(`  ${r.citizenStatus.padEnd(10)} age ${String(r.ageMin).padStart(2)}-${r.ageMax ?? '∞'.padStart(3)}  ` +
                `emp ${Number(r.employeeRate).toFixed(3)}  emplr ${Number(r.employerRate).toFixed(3)}  ` +
                `OW≤${r.owCeiling}  AW≤${r.awCeiling}  eff ${String(r.effectiveDate).slice(0, 10)}`);
  }

  console.log(`\n[migrate-cpf-jan2026] Replacing with Jan 2026 rates (${RATES_JAN_2026.length} rows):`);
  for (const [cs, amin, amax, er, emr] of RATES_JAN_2026) {
    console.log(`  ${cs.padEnd(10)} age ${String(amin).padStart(2)}-${amax === null ? '∞' : String(amax).padStart(2)}` +
                `   emp ${er.toFixed(3)}  emplr ${emr.toFixed(3)}  OW≤${OW_CEILING}  eff ${EFFECTIVE}`);
  }

  if (DRY_RUN) {
    console.log('\n[migrate-cpf-jan2026] DRY_RUN — no changes applied.');
    await db.end();
    return;
  }

  await db.query('BEGIN');
  try {
    await db.query(`DELETE FROM cpf_rates`);
    for (const [cs, amin, amax, er, emr] of RATES_JAN_2026) {
      await db.query(
        `INSERT INTO cpf_rates (id, "citizenStatus", "ageMin", "ageMax", "employeeRate", "employerRate",
                                 "owCeiling", "awCeiling", "effectiveDate", "isActive", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW())`,
        [uuidv4(), cs, amin, amax, er, emr, OW_CEILING, AW_CEILING, EFFECTIVE],
      );
    }
    await db.query('COMMIT');
    console.log(`\n[migrate-cpf-jan2026] ✅ Migration complete — ${RATES_JAN_2026.length} rows in cpf_rates.`);
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
  await db.end();
}

main().catch(err => {
  console.error('[migrate-cpf-jan2026] FAILED:', err);
  process.exit(1);
});
