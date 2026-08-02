'use strict';

/**
 * Storage sentinel for a run with no period half.
 *
 * periodHalf used to be NULL for MONTHLY/ADHOC runs. Postgres treats every NULL
 * as DISTINCT from every other NULL in a unique index, so the run key did not
 * constrain those runs at all — two identical monthly runs for the same entity
 * and period were both accepted, and duplicate finalised payroll was possible.
 * Only the application-level findFirst stood in the way, which a double-submit
 * can race.
 *
 * NONE is a real value, so the key constrains again. The alternatives were
 * Postgres 15+ `UNIQUE NULLS NOT DISTINCT` (Prisma 5.22 cannot express it) and
 * a partial index (`prisma db push` drops indexes it does not manage) — both
 * fragile in a way this is not.
 *
 * The API contract is unchanged: callers still omit periodHalf for
 * non-bimonthly runs, and validateRunTypeShape still rejects one if supplied.
 * NONE is applied server-side, at the storage boundary only.
 */
const PERIOD_HALF_NONE = 'NONE';

function toStoredPeriodHalf(periodHalf) {
  return (periodHalf === null || periodHalf === undefined || periodHalf === '')
    ? PERIOD_HALF_NONE
    : periodHalf;
}

/**
 * Builds the Prisma compound-unique `where` for a payroll run.
 *
 * The previous key was [period, runType, periodHalf] with no tenant dimension,
 * so any two tenants collided on the same BIMONTHLY period — the second to
 * create one got a P2002 reported as "a run for this period already exists".
 * It also has to carry legalEntityId now: a group tenant legitimately runs
 * January payroll once per entity.
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
      tenantId, legalEntityId, period, runType,
      periodHalf: toStoredPeriodHalf(periodHalf),
    },
  };
}

module.exports = { buildRunUniqueWhere, toStoredPeriodHalf, PERIOD_HALF_NONE };
