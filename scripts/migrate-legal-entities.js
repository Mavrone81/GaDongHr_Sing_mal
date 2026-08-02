'use strict';
/**
 * Migration (ENT-003): give every existing tenant exactly one primary
 * LegalEntity, derived from its CompanyProfile, with country SG.
 *
 * Every tenant alive today computes Singapore payroll — the `country` column on
 * `tenants` has never been read by any code path (it was captured at signup and
 * ignored). We therefore force SG rather than honouring that field: trusting it
 * would silently change behaviour for any tenant who picked another country on
 * the signup form and has been running SG payroll ever since.
 *
 * Idempotent: a tenant that already has a primary entity is skipped.
 *
 * Usage:
 *   node scripts/migrate-legal-entities.js
 *   DRY_RUN=true node scripts/migrate-legal-entities.js
 *
 * Environment:
 *   AUTH_DB            — defaults to hrms_auth
 *   POSTGRES_USER      — defaults to hrms
 *   POSTGRES_PASSWORD  — required (export it; never inline a read of .env)
 *   POSTGRES_HOST      — defaults to localhost
 *   POSTGRES_PORT      — defaults to 5432
 *   DRY_RUN=true       — print intended changes without applying
 */

const { randomUUID } = require('crypto');

function deriveEntityCode(slug) {
  const code = String(slug || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return code || 'ENTITY';
}

function buildEntityFromTenant(tenant, profile) {
  return {
    tenantId: tenant.id,
    name: (profile && profile.legalName) || tenant.name,
    code: deriveEntityCode(tenant.slug),
    country: 'SG',
    currency: 'SGD',
    timezone: 'Asia/Singapore',
    registrationNo: (profile && profile.registrationNo) || null,
    isPrimary: true,
  };
}

function pgConfig(database) {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || 'hrms',
    password: process.env.POSTGRES_PASSWORD,
    database,
  };
}

/**
 * Point every employee at their tenant's primary entity.
 *
 * Crosses a database boundary: entities live in hrms_auth, employees in
 * hrms_employee, because each service owns its own database. Two connections
 * rather than a join.
 */
async function backfillEmployees(dryRun) {
  const { Client } = require('pg');

  const authDb = new Client(pgConfig(process.env.AUTH_DB || 'hrms_auth'));
  const empDb  = new Client(pgConfig(process.env.EMPLOYEE_DB || 'hrms_employee'));
  await authDb.connect();
  await empDb.connect();

  try {
    const { rows: entities } = await authDb.query(
      'SELECT id, "tenantId" FROM legal_entities WHERE "isPrimary" = true',
    );

    let updated = 0;
    for (const e of entities) {
      if (dryRun) {
        const { rows } = await empDb.query(
          'SELECT COUNT(*)::int AS n FROM employees WHERE "tenantId" = $1 AND "legalEntityId" IS NULL',
          [e.tenantId],
        );
        if (rows[0].n > 0) {
          console.log(`[dry-run] would set legalEntityId=${e.id} on ${rows[0].n} employees`);
        }
        updated += rows[0].n;
      } else {
        const r = await empDb.query(
          'UPDATE employees SET "legalEntityId" = $1 WHERE "tenantId" = $2 AND "legalEntityId" IS NULL',
          [e.id, e.tenantId],
        );
        updated += r.rowCount;
      }
    }

    console.log(`${dryRun ? '[dry-run] ' : ''}employees backfilled=${updated}`);
  } finally {
    await authDb.end();
    await empDb.end();
  }
}

async function run() {
  const { Client } = require('pg');
  const dryRun = process.env.DRY_RUN === 'true';

  const client = new Client(pgConfig(process.env.AUTH_DB || 'hrms_auth'));
  await client.connect();

  const { rows: tenants } = await client.query(`
    SELECT t.id, t.name, t.slug, t.country,
           p."legalName" AS profile_legal_name,
           p."registrationNo" AS profile_registration_no
      FROM tenants t
      LEFT JOIN company_profiles p ON p."tenantId" = t.id
  `);

  let created = 0, skipped = 0;

  for (const row of tenants) {
    const { rows: existing } = await client.query(
      'SELECT id FROM legal_entities WHERE "tenantId" = $1 AND "isPrimary" = true LIMIT 1',
      [row.id],
    );
    if (existing.length) { skipped++; continue; }

    const entity = buildEntityFromTenant(
      { id: row.id, name: row.name, slug: row.slug, country: row.country },
      row.profile_legal_name
        ? { legalName: row.profile_legal_name, registrationNo: row.profile_registration_no }
        : null,
    );

    if (dryRun) {
      console.log(`[dry-run] would create entity ${entity.code} (${entity.name}) for tenant ${row.id}`);
    } else {
      await client.query(
        `INSERT INTO legal_entities
           (id, "tenantId", name, code, country, currency, timezone,
            "registrationNo", "isPrimary", "isActive", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true,NOW(),NOW())`,
        [randomUUID(), entity.tenantId, entity.name, entity.code, entity.country,
         entity.currency, entity.timezone, entity.registrationNo],
      );
    }
    created++;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}tenants=${tenants.length} created=${created} skipped=${skipped}`);
  await client.end();

  // Must run after the entities exist — it resolves them by tenant.
  await backfillEmployees(dryRun);
}

module.exports = { buildEntityFromTenant, deriveEntityCode, pgConfig, backfillEmployees, run };

if (require.main === module) {
  run().catch(err => { console.error(err); process.exit(1); });
}
