'use strict';
/**
 * Migration (ENT-004): hoist per-tenant Singapore rate tables into the global,
 * platform-managed tables in hrms_statutory_sg.
 *
 * COPIES rather than moves. The per-tenant rows in hrms_payroll are left intact,
 * so this is reversible; a later release drops them once payroll no longer reads
 * them.
 *
 * Emits a DIVERGENCE REPORT naming any tenant whose rates differ from canonical.
 * scripts/migrate-cpf-jan2026.js had to be applied to every deployment
 * individually, so a tenant that never received it is still computing CPF on the
 * pre-2026 bands — under-contributing for senior workers and anyone above the
 * old $6,800 ceiling. That report identifies exactly which customers are
 * affected, which is worth having regardless of Malaysia.
 *
 * Usage:
 *   DRY_RUN=true node scripts/migrate-statutory-tables-sg.js
 *   node scripts/migrate-statutory-tables-sg.js
 *
 * Environment:
 *   PAYROLL_DB / STATUTORY_SG_DB — default hrms_payroll / hrms_statutory_sg
 *   POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_HOST / POSTGRES_PORT
 *   DRY_RUN=true — report without writing
 */

const { randomUUID } = require('crypto');
const { pgConfig } = require('./migrate-legal-entities');
const { SG_2026_1 } = require('../services/statutory-sg-service/src/seed/sg-2026-1');

const COMPARED_FIELDS = ['employeeRate', 'employerRate', 'owCeiling'];

function diffRateRows(canonical, actual) {
  const diffs = [];
  for (const c of canonical) {
    const found = (actual || []).find(
      a => a.citizenStatus === c.citizenStatus && a.ageMin === c.ageMin,
    );
    if (!found) {
      diffs.push({
        citizenStatus: c.citizenStatus, ageMin: c.ageMin,
        field: 'row', expected: 'present', found: 'missing',
      });
      continue;
    }
    for (const field of COMPARED_FIELDS) {
      if (c[field] !== undefined && found[field] !== c[field]) {
        diffs.push({
          citizenStatus: c.citizenStatus, ageMin: c.ageMin,
          field, expected: c[field], found: found[field],
        });
      }
    }
  }
  return diffs;
}

async function run() {
  const { Client } = require('pg');
  const dryRun = process.env.DRY_RUN === 'true';

  const payDb  = new Client(pgConfig(process.env.PAYROLL_DB || 'hrms_payroll'));
  const statDb = new Client(pgConfig(process.env.STATUTORY_SG_DB || 'hrms_statutory_sg'));
  await payDb.connect();
  await statDb.connect();

  try {
    // ── 1. Insert the canonical global rate set (idempotent) ──────────────────
    const { rows: existing } = await statDb.query(
      'SELECT version FROM rate_versions WHERE version = $1', [SG_2026_1.version],
    );

    if (existing.length) {
      console.log(`rate version ${SG_2026_1.version} already present — skipping insert`);
    } else if (dryRun) {
      console.log(`[dry-run] would insert ${SG_2026_1.version} with ${SG_2026_1.cpfRates.length} CPF rows + SDL config`);
    } else {
      await statDb.query('BEGIN');
      await statDb.query(
        `INSERT INTO rate_versions (id, country, version, "effectiveFrom", source, "retrievedAt", "isActive", "createdAt")
         VALUES ($1,'SG',$2,$3,$4,$5,true,NOW())`,
        [randomUUID(), SG_2026_1.version, SG_2026_1.effectiveFrom, SG_2026_1.source, SG_2026_1.retrievedAt],
      );
      for (const r of SG_2026_1.cpfRates) {
        await statDb.query(
          `INSERT INTO cpf_rates (id, "rateVersion", "citizenStatus", "ageMin", "ageMax",
                                  "employeeRate", "employerRate", "owCeiling", "awCeiling", "createdAt")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
          [randomUUID(), SG_2026_1.version, r.citizenStatus, r.ageMin, r.ageMax,
           r.employeeRate, r.employerRate, r.owCeiling, r.awCeiling],
        );
      }
      const s = SG_2026_1.sdlConfig;
      await statDb.query(
        `INSERT INTO sdl_config (id, "rateVersion", rate, "minAmount", "maxAmount", "salaryCap", "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [randomUUID(), SG_2026_1.version, s.rate, s.minAmount, s.maxAmount, s.salaryCap],
      );
      await statDb.query('COMMIT');
      console.log(`inserted ${SG_2026_1.version} with ${SG_2026_1.cpfRates.length} CPF rows + SDL config`);
    }

    // ── 2. Divergence report ─────────────────────────────────────────────────
    const { rows: tenants } = await payDb.query(
      'SELECT DISTINCT "tenantId" FROM cpf_rates WHERE "isActive" = true',
    );

    if (tenants.length === 0) {
      console.log('\nno per-tenant cpf_rates found — nothing to compare');
    } else {
      console.log('\ndivergence report:');
    }

    let diverged = 0;
    for (const { tenantId } of tenants) {
      const { rows: tenantRates } = await payDb.query(
        `SELECT "citizenStatus", "ageMin", "ageMax", "employeeRate", "employerRate", "owCeiling"
           FROM cpf_rates WHERE "tenantId" = $1 AND "isActive" = true`,
        [tenantId],
      );
      const diffs = diffRateRows(SG_2026_1.cpfRates, tenantRates);
      if (diffs.length === 0) {
        console.log(`  tenant ${tenantId}: matches ${SG_2026_1.version}`);
      } else {
        diverged++;
        console.log(`  tenant ${tenantId}: ${diffs.length} DIVERGENCE(S)`);
        for (const d of diffs) {
          console.log(`    ${d.citizenStatus} age>=${d.ageMin} ${d.field}: expected ${d.expected}, found ${d.found}`);
        }
      }
    }

    console.log(`\ntenants=${tenants.length} matching=${tenants.length - diverged} diverged=${diverged}`);
    if (diverged > 0) {
      console.log('⚠️  DIVERGENCE FOUND — those tenants computed CPF on different rates. Review before proceeding.');
    }
  } finally {
    await payDb.end();
    await statDb.end();
  }
}

module.exports = { diffRateRows, run };

if (require.main === module) {
  run().catch(err => { console.error(err); process.exit(1); });
}
