'use strict';
/**
 * Year-end carry-forward + carry-forward expiry engine (LEA-007).
 *
 * Carry-forward computation:
 *   unused        = entitledDays + previous carryForward − usedDays − pendingDays
 *   carriedForward = min(max(0, unused), leaveType.maxCarryForward)
 *   forfeited      = max(0, unused − carriedForward)
 *
 * Expiry behaviour:
 *   - Each year's entitlement has `carryForwardExpiry` (default 31 Dec 23:59:59).
 *   - A daily sweep runs after midnight; if `now >= carryForwardExpiry` and the
 *     entitlement still has unused carry-forward days, those days are moved
 *     into `expiredDays` and `carryForward` is set to 0.
 *   - Already-consumed carry-forward days are not affected.
 *
 * Notes:
 *   - `maxCarryForward = 0` → entire unused balance is forfeited (zero carry-forward).
 *   - `maxCarryForward < 0` is treated as unlimited (everything carries forward).
 */

const SGT_OFFSET_MINUTES = 8 * 60; // Singapore Standard Time is UTC+8 year-round.

/**
 * Default expiry = 31 Dec of `targetYear` at 23:59:59 Singapore time.
 * Stored as UTC, so 23:59:59 SGT = 15:59:59 UTC.
 */
function defaultExpiryFor(targetYear) {
  const sgtMs = Date.UTC(targetYear, 11, 31, 23, 59, 59); // treat numbers as SGT
  return new Date(sgtMs - SGT_OFFSET_MINUTES * 60 * 1000);
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Compute carry-forward outcome for a single entitlement.
 * @param {Object} prev   previous-year entitlement
 * @param {Object} leaveType
 */
function computeCarryForward(prev, leaveType) {
  const used    = prev.usedDays || 0;
  const pending = prev.pendingDays || 0;
  const balance = (prev.entitledDays || 0) + (prev.carryForward || 0) - used - pending;
  const unused  = Math.max(0, balance);

  let carriedForward, forfeited;
  if ((leaveType.maxCarryForward || 0) < 0) {
    // unlimited
    carriedForward = unused;
    forfeited = 0;
  } else {
    carriedForward = Math.min(unused, leaveType.maxCarryForward || 0);
    forfeited = round2(unused - carriedForward);
  }
  return {
    unusedBalance: round2(unused),
    carriedForward: round2(carriedForward),
    forfeited,
  };
}

/**
 * Returns the effective expiry date for a given target year.
 * If a custom date is provided (any format Date can parse), use it; else default.
 */
function resolveExpiry(targetYear, customExpiry) {
  if (customExpiry) {
    const d = new Date(customExpiry);
    if (!isNaN(d.getTime())) return d;
  }
  return defaultExpiryFor(targetYear);
}

/**
 * Decide whether a given entitlement is past expiry and what the sweep would do.
 * Returns { shouldExpire, expiredAmount, newCarryForward, newExpiredDays }.
 */
function evaluateExpiry(entitlement, now = new Date()) {
  const cf = entitlement.carryForward || 0;
  if (cf <= 0) return { shouldExpire: false, expiredAmount: 0 };
  if (!entitlement.carryForwardExpiry) return { shouldExpire: false, expiredAmount: 0 };
  const expiry = entitlement.carryForwardExpiry instanceof Date
    ? entitlement.carryForwardExpiry
    : new Date(entitlement.carryForwardExpiry);
  if (isNaN(expiry.getTime())) return { shouldExpire: false, expiredAmount: 0 };
  if (now < expiry) return { shouldExpire: false, expiredAmount: 0 };

  // Compute how much of the original carry-forward remains un-used.
  // usedDays first consumes the current-year entitlement, then carry-forward —
  // but practically we treat any remaining carry-forward at expiry as forfeited.
  // i.e. expiredAmount = current carryForward (the residual that hasn't been
  // explicitly drawn down or expired previously).
  const expiredAmount = round2(cf);
  return {
    shouldExpire: true,
    expiredAmount,
    newCarryForward: 0,
    newExpiredDays: round2((entitlement.expiredDays || 0) + expiredAmount),
  };
}

module.exports = {
  computeCarryForward,
  defaultExpiryFor,
  resolveExpiry,
  evaluateExpiry,
};
