'use strict';
/**
 * PAY-001 — Payroll run-type helpers.
 *
 * Pure functions (no Prisma, no axios) for:
 *   - Identifying run-type categories (bi-monthly, supplemental)
 *   - Computing period date boundaries for MONTHLY vs BIMONTHLY/FIRST|SECOND
 *   - Supplemental auto-trim: zero out the OW/AW/grossPay for an employee
 *     that already has a published payslip in this period — prevents
 *     double-counting when consolidatePeriod later sums payslips.
 *
 * Run-type categories:
 *   PRIMARY (full salary): MONTHLY, BIMONTHLY
 *   SUPPLEMENTAL (paycode-only): ADHOC, BONUS, COMMISSION
 *   SPECIAL (full pay, no trim): FINAL_PAY
 */

const SUPPLEMENTAL_TYPES = ['ADHOC', 'BONUS', 'COMMISSION'];
const PRIMARY_TYPES      = ['MONTHLY', 'BIMONTHLY'];
const PERIOD_HALVES      = ['FIRST', 'SECOND'];

function isSupplemental(runType) {
  return SUPPLEMENTAL_TYPES.includes(runType);
}

function isBiMonthly(runType) {
  return runType === 'BIMONTHLY';
}

/**
 * Compute period date boundaries.
 *
 * @param {string}  period      "YYYY-MM"
 * @param {string}  runType     "MONTHLY" | "BIMONTHLY" | "ADHOC" | ...
 * @param {?string} periodHalf  "FIRST" | "SECOND" | null  (required when runType=BIMONTHLY)
 * @returns {{ periodStart: Date, periodEnd: Date, daysInMonth: number, halfLabel: ?string }}
 */
function computePeriodBoundaries(period, runType, periodHalf) {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`Invalid period: ${period} (expected YYYY-MM)`);
  }
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 0); // last day of the month
  const daysInMonth = monthEnd.getDate();

  if (runType === 'BIMONTHLY') {
    if (!PERIOD_HALVES.includes(periodHalf)) {
      throw new Error(`BIMONTHLY run requires periodHalf=FIRST or SECOND (got: ${periodHalf})`);
    }
    if (periodHalf === 'FIRST') {
      return {
        periodStart: monthStart,
        periodEnd:   new Date(year, month - 1, 15),
        daysInMonth,
        halfLabel:   'FIRST',
      };
    }
    // SECOND
    return {
      periodStart: new Date(year, month - 1, 16),
      periodEnd:   monthEnd,
      daysInMonth,
      halfLabel:   'SECOND',
    };
  }

  // Non-bi-monthly: full month
  return { periodStart: monthStart, periodEnd: monthEnd, daysInMonth, halfLabel: null };
}

/**
 * Supplemental auto-trim: in place mutate emp to remove OW/AW/grossPay and
 * carry-over YTDs from the prior payslip — so the supplemental run only
 * contributes the new paycode deltas (no double-counting of base salary
 * when consolidatePeriod later sums runs).
 *
 * @param {object} emp    employee payroll record (mutated)
 * @param {object} prior  prior payslip values (basicSalary, grossPay, ytdGross, ytdEmployeeCpf, ytdEmployerCpf)
 * @returns {object} the same emp (mutated, for chaining/test readability)
 */
function trimSupplementalEmployee(emp, prior) {
  if (!prior) return emp;
  emp.ow            = 0;
  emp.aw            = 0;
  emp.grossPay      = 0;
  // YTD carry-over: prior payslip's YTDs already include the OW that was paid,
  // so the supplemental's CPF computation correctly enforces the ceiling.
  emp.ytdOw          = prior.ytdGross ?? emp.ytdOw ?? 0;
  emp.ytdEmployeeCpf = prior.ytdEmployeeCpf ?? emp.ytdEmployeeCpf ?? 0;
  emp.ytdEmployerCpf = prior.ytdEmployerCpf ?? emp.ytdEmployerCpf ?? 0;
  return emp;
}

/**
 * Validate run-type + periodHalf combination for the POST /runs request body.
 * @returns {?string} an error message, or null when valid.
 */
function validateRunTypeShape(runType, periodHalf) {
  const RT = (runType || '').toUpperCase();
  if (RT === 'BIMONTHLY') {
    if (!PERIOD_HALVES.includes(periodHalf)) {
      return 'BIMONTHLY run requires periodHalf: FIRST or SECOND';
    }
  } else {
    if (periodHalf != null && periodHalf !== '') {
      return `periodHalf is only valid for BIMONTHLY runs (received runType=${RT})`;
    }
  }
  return null;
}

module.exports = {
  SUPPLEMENTAL_TYPES, PRIMARY_TYPES, PERIOD_HALVES,
  isSupplemental, isBiMonthly,
  computePeriodBoundaries, trimSupplementalEmployee, validateRunTypeShape,
};
