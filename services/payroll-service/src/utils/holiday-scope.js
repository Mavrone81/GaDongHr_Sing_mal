'use strict';

/**
 * ENT-001 — narrows a tenant's holiday rows to one legal entity.
 *
 * Public holidays are a property of the jurisdiction an entity operates in, not
 * of the tenant. A group tenant with a Singapore and a Malaysian entity observes
 * two different calendars, and they overlap on some dates and diverge on others.
 *
 * Keys are UTC-anchored YYYY-MM-DD, matching countWorkingDays in
 * shared/payroll-utils and formatCivil in frontend/src/lib/timezone.ts. Reading
 * the date with local getters here would shift the day east of UTC and silently
 * un-match the holiday — the defect fixed in 3059057.
 *
 * Rows with no legalEntityId (pre-backfill) are excluded rather than treated as
 * global: leaking them into every entity would make a Malaysian payroll observe
 * Singapore holidays, which is worse than observing none.
 */
function buildHolidaySet(holidays, legalEntityId) {
  const set = new Set();
  for (const h of holidays || []) {
    if (!h.legalEntityId || h.legalEntityId !== legalEntityId) continue;
    set.add(new Date(h.date).toISOString().slice(0, 10));
  }
  return set;
}

module.exports = { buildHolidaySet };
