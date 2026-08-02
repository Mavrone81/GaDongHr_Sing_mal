'use strict';

/**
 * Builds the Prisma compound-unique `where` for a payroll run.
 *
 * The previous key was [period, runType, periodHalf] with no tenant dimension,
 * so any two tenants collided on the same period — the second to create a
 * 2026-01 MONTHLY run got a P2002 reported as "a run for this period already
 * exists". It also has to carry legalEntityId now: a group tenant legitimately
 * runs January payroll once per entity.
 *
 * Both identifiers are required rather than defaulted. A run whose tenant or
 * entity is unknown must fail loudly here, not quietly widen the key and
 * reintroduce the collision.
 */
function buildRunUniqueWhere({ tenantId, legalEntityId, period, runType, periodHalf = null }) {
  if (!tenantId) throw new Error('tenantId is required to scope a payroll run');
  if (!legalEntityId) throw new Error('legalEntityId is required to scope a payroll run');
  return {
    tenantId_legalEntityId_period_runType_periodHalf: {
      tenantId, legalEntityId, period, runType, periodHalf,
    },
  };
}

module.exports = { buildRunUniqueWhere };
