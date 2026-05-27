'use strict';

/**
 * CCL / UICL / ECL entitlement engine.
 *
 * Statutory source: Child Development Co-Savings Act + Employment Act Part IX.
 * Entitlement is determined by the YOUNGEST verified child's age and citizenship
 * at the time of computation (not at time of leave application).
 *
 * Age bands (child's age in full years on the computation date):
 *   < 2 years   → CCL (SC=6, PR/Foreigner=2) + UICL 12 (SC only, unpaid)
 *   2–6 years   → CCL (SC=6, PR/Foreigner=2)
 *   7–12 years  → ECL 2 (SC only); PR/Foreigner = no entitlement
 *   ≥ 13 years  → no entitlement
 */

// Citizenship values match the DB enum
const CITIZENSHIP = { SC: 'SC', PR: 'PR', FOREIGNER: 'FOREIGNER' };

// Leave type codes used in LeaveType.code
const CODES = { CCL: 'CCL', UICL: 'UICL', ECL: 'ECL' };

// Default leave-type seed data (used when auto-creating LeaveType rows)
const LEAVE_TYPE_SEEDS = {
  CCL:  { code: 'CCL',  name: 'Childcare Leave',              isPaid: true,  isStatutory: true,  isGovtPaid: true,  msfDailyCap: 100, msfWeeklyCap: 500 },
  UICL: { code: 'UICL', name: 'Unpaid Infant Care Leave',     isPaid: false, isStatutory: true,  isGovtPaid: false },
  ECL:  { code: 'ECL',  name: 'Extended Childcare Leave',     isPaid: true,  isStatutory: true,  isGovtPaid: true,  msfDailyCap: 100, msfWeeklyCap: 500 },
};

/**
 * Compute a child's age in full years on a given reference date.
 */
function ageYears(dateOfBirth, referenceDate) {
  const dob = new Date(dateOfBirth);
  const ref = new Date(referenceDate);
  let age = ref.getFullYear() - dob.getFullYear();
  const mDiff = ref.getMonth() - dob.getMonth();
  if (mDiff < 0 || (mDiff === 0 && ref.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * Compute entitlement rows for a single child.
 * Returns an array of { code, days } objects (may be empty for no entitlement).
 */
function computeChildEntitlements(child, referenceDate) {
  const age = ageYears(child.dateOfBirth, referenceDate || new Date());
  const cit = child.citizenship;

  if (age < 0 || age >= 13) return [];

  if (age < 2) {
    if (cit === CITIZENSHIP.SC) {
      return [
        { code: CODES.CCL,  days: 6 },
        { code: CODES.UICL, days: 12 },
      ];
    }
    // PR or Foreigner
    return [{ code: CODES.CCL, days: 2 }];
  }

  if (age < 7) {
    // 2 – 6 years
    const days = cit === CITIZENSHIP.SC ? 6 : 2;
    return [{ code: CODES.CCL, days }];
  }

  // 7 – 12 years
  if (cit === CITIZENSHIP.SC) {
    return [{ code: CODES.ECL, days: 2 }];
  }
  return []; // PR / Foreigner: no entitlement
}

/**
 * Find the youngest child from an array of child records.
 * Returns null if array is empty.
 */
function youngestChild(children) {
  if (!children || children.length === 0) return null;
  return children.reduce((youngest, c) => {
    const d = new Date(c.dateOfBirth);
    return d > new Date(youngest.dateOfBirth) ? c : youngest;
  }, children[0]);
}

/**
 * Compute the CCL/UICL/ECL entitlements for an employee based on their
 * VERIFIED children (youngest child rule).
 *
 * @param {Array} verifiedChildren — array of child records with {dateOfBirth, citizenship}
 * @param {Date}  [referenceDate]  — defaults to today
 * @returns {{ youngest: child|null, entitlements: [{code, days}], ageYears: number|null }}
 */
function computeEmployeeEntitlements(verifiedChildren, referenceDate) {
  const ref = referenceDate || new Date();
  const youngest = youngestChild(verifiedChildren);
  if (!youngest) {
    return { youngest: null, entitlements: [], ageYears: null };
  }
  const age = ageYears(youngest.dateOfBirth, ref);
  const entitlements = computeChildEntitlements(youngest, ref);
  return { youngest, entitlements, ageYears: age };
}

/**
 * Describe the age bracket for human-readable output.
 */
function ageBracketLabel(ageInYears) {
  if (ageInYears === null || ageInYears === undefined) return 'Unknown';
  if (ageInYears < 2)  return '< 2 years';
  if (ageInYears < 7)  return '2 to < 7 years';
  if (ageInYears <= 12) return '7 to 12 years';
  return '≥ 13 years (no entitlement)';
}

module.exports = {
  CITIZENSHIP,
  CODES,
  LEAVE_TYPE_SEEDS,
  ageYears,
  computeChildEntitlements,
  youngestChild,
  computeEmployeeEntitlements,
  ageBracketLabel,
};
