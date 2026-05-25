'use strict';
/**
 * LEA-005 MSF reimbursement cap engine.
 *
 * Pure — no DB. Given a leave application, the employee's daily rate, and the
 * leave-type's MSF cap configuration, returns the reimbursable amount along
 * with which cap (if any) bit. Daily / weekly / period caps are all honoured;
 * the binding cap is the LOWEST applicable ceiling.
 *
 * MSF cap semantics (Singapore MOM rules, current as of 2026):
 *   - GPML (Govt-Paid Maternity Leave)   — SGD 10,000 per 4-week block, 4 blocks total
 *   - GPPL (Govt-Paid Paternity Leave)   — SGD 2,500 per week
 *   - CCL  (Childcare Leave, child < 7)   — SGD 500 per week, capped at SGD 100/day
 *   - SPL  (Shared Parental Leave)        — SGD 500 per week
 *   - Extended CCL (child 7-12)           — SGD 500 per week
 *
 * Cap precedence (when more than one cap is set on a leave type):
 *   1. Daily cap clamps each day's reimbursement
 *   2. Weekly cap clamps the sum across the 7-day period
 *   3. Period cap clamps the sum across the configured MSF period block
 *   4. The smallest binding cap "wins" and is reported as claimCapApplied
 *
 * The engine treats `totalDays` as the canonical work-day count for the
 * application — it does NOT manufacture day-by-day grain. For period-level
 * computation it scales the weekly cap × ceil(days/5) and the period cap is
 * already total-period scoped.
 */

const DAYS_PER_WEEK = 5;          // standard SG work week
const DEFAULT_PERIOD_WEEKS = 1;   // most MSF types are 1 week; GPML overrides to 4

/**
 * Compute the reimbursable claim amount for one approved govt-paid leave.
 *
 * @param {object} args
 * @param {number} args.totalDays    days of leave on the application (incl. fractional)
 * @param {number} args.dailyRate    employee's daily rate (gross / working days)
 * @param {object} args.leaveType    { msfDailyCap, msfWeeklyCap, msfPeriodCap, msfPeriodWeeks }
 * @returns {{
 *   uncappedAmount: number,
 *   capApplied: 'NONE'|'DAILY'|'WEEKLY'|'PERIOD',
 *   capValue: number|null,
 *   amount: number,
 *   dailyRate: number,
 *   notes: string,
 * }}
 */
function computeClaimAmount({ totalDays, dailyRate, leaveType = {} }) {
  const days = Number(totalDays) || 0;
  const rate = Number(dailyRate) || 0;
  if (days <= 0 || rate <= 0) {
    return { uncappedAmount: 0, capApplied: 'NONE', capValue: null, amount: 0, dailyRate: rate, notes: 'No claim — zero days or zero rate' };
  }
  const uncappedAmount = round2(days * rate);

  // Build the set of candidate "capped totals" we'd get from each cap kind.
  // Whichever yields the SMALLEST total is the binding cap.
  const candidates = [];
  candidates.push({ kind: 'NONE', total: uncappedAmount, value: null });
  if (Number.isFinite(leaveType.msfDailyCap) && leaveType.msfDailyCap > 0) {
    const cappedDaily = Math.min(rate, leaveType.msfDailyCap);
    candidates.push({ kind: 'DAILY', total: round2(days * cappedDaily), value: leaveType.msfDailyCap });
  }
  if (Number.isFinite(leaveType.msfWeeklyCap) && leaveType.msfWeeklyCap > 0) {
    const weeks = days / DAYS_PER_WEEK;
    candidates.push({ kind: 'WEEKLY', total: round2(weeks * leaveType.msfWeeklyCap), value: leaveType.msfWeeklyCap });
  }
  if (Number.isFinite(leaveType.msfPeriodCap) && leaveType.msfPeriodCap > 0) {
    const periodWeeks = Number.isFinite(leaveType.msfPeriodWeeks) && leaveType.msfPeriodWeeks > 0
      ? leaveType.msfPeriodWeeks
      : DEFAULT_PERIOD_WEEKS;
    const periodDays = periodWeeks * DAYS_PER_WEEK;
    // Pro-rate the period cap by how much of the period the leave covers
    const fraction = Math.min(1, days / periodDays);
    candidates.push({ kind: 'PERIOD', total: round2(leaveType.msfPeriodCap * fraction), value: leaveType.msfPeriodCap });
  }
  // Pick the cap with the smallest total — that's the binding cap.
  candidates.sort((a, b) => a.total - b.total);
  const winner = candidates[0];
  const capApplied = winner.kind;
  return {
    uncappedAmount,
    capApplied,
    capValue: winner.value,
    amount: winner.total,
    dailyRate: rate,
    notes: capApplied === 'NONE'
      ? 'Full amount reimbursable — no MSF cap bound'
      : `${capApplied} cap clamped reimbursement (saving SGD ${round2(uncappedAmount - winner.total).toFixed(2)})`,
  };
}

/**
 * Build a payload suitable for the per-application claim record write.
 * Use after computeClaimAmount(); the engine doesn't touch the DB.
 */
function buildClaimRecord({ application, leaveType, dailyRate, computed }) {
  return {
    claimStatus:         'NOT_SUBMITTED',
    claimAmount:         computed.amount,
    claimDailyRate:      computed.dailyRate,
    claimUncappedAmount: computed.uncappedAmount,
    claimCapApplied:     computed.capApplied,
    claimNotes:          computed.notes,
    leaveTypeCode:       leaveType.code,
    employeeId:          application.employeeId,
  };
}

/**
 * Status machine for claim lifecycle.
 *   NOT_SUBMITTED → SUBMITTED → REIMBURSED / REJECTED
 *   REJECTED → NOT_SUBMITTED (resubmission)
 *   NOT_APPLICABLE is a fixed bucket (caller can't transition into it from another state)
 */
const TRANSITIONS = Object.freeze({
  NOT_APPLICABLE: new Set([]),
  NOT_SUBMITTED:  new Set(['SUBMITTED', 'REJECTED']),
  SUBMITTED:      new Set(['REIMBURSED', 'REJECTED']),
  REIMBURSED:     new Set([]),
  REJECTED:       new Set(['NOT_SUBMITTED']),
});

function validateTransition(from, to) {
  if (!TRANSITIONS[from])             return { ok: false, error: `Unknown from state ${from}` };
  if (!Object.keys(TRANSITIONS).includes(to)) return { ok: false, error: `Unknown to state ${to}` };
  if (from === to)                    return { ok: false, error: `Already in status ${to}` };
  if (!TRANSITIONS[from].has(to))     return { ok: false, error: `Cannot transition ${from} → ${to}` };
  return { ok: true };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = {
  DAYS_PER_WEEK,
  DEFAULT_PERIOD_WEEKS,
  computeClaimAmount,
  buildClaimRecord,
  validateTransition,
  TRANSITIONS,
};
