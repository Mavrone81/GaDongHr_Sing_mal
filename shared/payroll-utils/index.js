'use strict';

/**
 * Generic payroll arithmetic shared across services.
 *
 * COUNTRY-SPECIFIC STATUTORY COMPUTATION IS NOT HERE. Singapore's CPF, SDL and
 * FWL moved to services/statutory-sg-service/src/engines/cpf.engine.js in the
 * P1 extraction; Malaysia's EPF/SOCSO/EIS/PCB will live in its own sibling
 * service. What remains is arithmetic the payroll run lifecycle needs whatever
 * country it is running — OT, no-pay leave, AWS, net pay, and working-day
 * counting.
 *
 * computeOtPay keeps a 1.5x default because that is Singapore's EA s.38 rate.
 * Malaysia's s.60A differentiates 1.5x / 2x / 3x by day type, so the multiplier
 * becomes country-supplied in P4 — the function itself stays generic.
 *
 * TIMEZONE: every date-only value here is UTC-anchored and read with the getUTC
 * accessors. See toUtcMidnight.
 */

function computeOtPay(monthlyBasic, weeklyHours, otHours, otMultiplier = 1.5) {
  const annualBasic = monthlyBasic * 12;
  const hourlyRate = annualBasic / 52 / weeklyHours;
  const otPay = hourlyRate * otMultiplier * otHours;
  return Math.round(otPay * 100) / 100;
}

function computeNplDeduction(monthlyBasic, nplDays) {
  const dailyRate = monthlyBasic / 26;
  return Math.round(dailyRate * nplDays * 100) / 100;
}

function computeAws(monthlyBasic, monthsServed = 12) {
  return Math.round(monthlyBasic * (monthsServed / 12) * 100) / 100;
}

function computeNetPay({ grossPay, employeeCpf, nplDeduction = 0, absenceDeduction = 0, loanRepayment = 0, advanceRecovery = 0, garnishment = 0, reimbursements = 0 }) {
  return Math.round((grossPay - employeeCpf - nplDeduction - absenceDeduction - loanRepayment - advanceRecovery - garnishment + reimbursements) * 100) / 100;
}

/**
 * Anchor a date-only value at UTC midnight.
 *
 * Server-side counterpart of the convention in frontend/src/lib/timezone.ts:
 * a business date is a calendar date, not an instant, so it is represented as
 * UTC midnight and read back with the getUTC accessors. SG/MY/ID observe no
 * DST, so this is exact for the business timezones in scope.

 */
function toUtcMidnight(value) {
  const d = new Date(value);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Count Mon-Fri (or Mon-Sat for SIX_DAY) working days between two dates, inclusive.
// holidaySet: Set of 'YYYY-MM-DD' strings for public holidays.
//
// TIMEZONE: everything here is UTC-anchored. The previous implementation mixed
// local accessors (setHours/getDay/setDate) with a UTC holiday key
// (toISOString), so east of UTC local midnight serialised to the PREVIOUS
// calendar date — the holiday key missed, the holiday counted as a working
// day, and EA s.20 pro-rated salary was wrong. CI runs UTC, where the two
// agree, so it only failed on +08 machines: every SG and MY deployment.
// Do not reintroduce a local getter here.
function countWorkingDays(from, to, holidaySet = new Set(), workDayType = 'FIVE_DAY') {
  const maxDow = workDayType === 'SIX_DAY' ? 6 : 5;
  let count = 0;
  const d = toUtcMidnight(from);
  const end = toUtcMidnight(to);
  while (d <= end) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= maxDow && !holidaySet.has(d.toISOString().slice(0, 10))) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

// Working days of a leave application that fall inside a payroll period.
// Cross-month leaves are clamped to [periodStart, periodEnd].
// isHalfDay=true returns 0.5 if the single day is a working day in the period, else 0.
function countPeriodLeaveWorkingDays(leaveStart, leaveEnd, periodStart, periodEnd, holidaySet = new Set(), workDayType = 'FIVE_DAY', isHalfDay = false) {
  const effStart = leaveStart < periodStart ? periodStart : leaveStart;
  const effEnd   = leaveEnd   > periodEnd   ? periodEnd   : leaveEnd;
  if (effStart > effEnd) return 0;

  if (isHalfDay) {
    // Same UTC anchoring as countWorkingDays. This branch previously read the
    // day-of-week locally while keying the holiday in UTC — correct only when
    // the input happened to already be UTC midnight.
    const anchor = toUtcMidnight(effStart);
    const ds  = anchor.toISOString().slice(0, 10);
    const dow = anchor.getUTCDay();
    const maxDow = workDayType === 'SIX_DAY' ? 6 : 5;
    return (dow >= 1 && dow <= maxDow && !holidaySet.has(ds)) ? 0.5 : 0;
  }

  return countWorkingDays(effStart, effEnd, holidaySet, workDayType);
}

module.exports = {
  computeOtPay,
  computeNplDeduction,
  computeAws,
  computeNetPay,
  countWorkingDays,
  countPeriodLeaveWorkingDays,
};
