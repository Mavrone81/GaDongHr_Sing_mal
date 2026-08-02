'use strict';

/**
 * ENT-001 — rejects an employee↔entity assignment that crosses a tenant
 * boundary.
 *
 * Enforced at assignment time, not at payroll time (spec §3.4). A mislinked
 * employee reaching the compute path would not error — it would produce a
 * perfectly plausible payslip under the wrong country's statutory rules, and
 * surface months later as a compliance problem rather than a bug.
 *
 * A falsy tenantId on either side is a mismatch, never a pass: undefined must
 * not match undefined.
 */
function assertEntityMatchesTenant(entity, tenantId) {
  if (!entity) {
    throw Object.assign(new Error('Legal entity not found'), { status: 400 });
  }
  if (!tenantId || !entity.tenantId || entity.tenantId !== tenantId) {
    throw Object.assign(new Error('Legal entity does not belong to this tenant'), { status: 400 });
  }
}

module.exports = { assertEntityMatchesTenant };
