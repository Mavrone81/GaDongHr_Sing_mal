'use strict';
/**
 * TAT-005 time-reconciliation engine.
 *
 * Compares an AttendanceRecord's actual clock-in/clock-out against the
 * employee's scheduled shift bounds and produces:
 *
 *   - earlyMinutes, lateMinutes (≥ 0; short hours are NOT captured here —
 *     they count against the employee automatically via shorter hoursWorked)
 *   - earlyStatus, lateStatus per the DeltaStatus enum:
 *       NOT_APPLICABLE — no delta on this side (or no schedule available)
 *       AUTO_APPROVED  — within shift grace; counts in payroll automatically
 *       PENDING        — outside grace, awaiting manager decision
 *       APPROVED       — manager said yes (set by route handler, not here)
 *       DENIED         — manager said no  (set by route handler, not here)
 *   - billableStart, billableEnd — the time window the employee is paid for,
 *     after clipping unapproved/denied early/late time to scheduled bounds.
 *   - billableHours = (billableEnd − billableStart) / 60 − breakMinutes/60
 *   - billableOtHours = portion of billableHours above shift hoursPerDay
 *
 * Pure: no DB access, no I/O. Caller is responsible for persisting the result.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const diffMinutes = (a, b) => Math.round((a - b) / 60000);

/**
 * Classify a delta against a grace window.
 * @param {number} deltaMinutes  must be >= 0
 * @param {number} graceMinutes
 * @returns {string} DeltaStatus
 */
function classifyDelta(deltaMinutes, graceMinutes) {
  if (deltaMinutes <= 0) return 'NOT_APPLICABLE';
  if (deltaMinutes <= graceMinutes) return 'AUTO_APPROVED';
  return 'PENDING';
}

/**
 * Recompute deltas + billable hours for a single record.
 *
 * @param {object} record  attendance row — must carry clockIn, clockOut,
 *                         scheduledStart, scheduledEnd (any may be null),
 *                         and the existing earlyStatus/lateStatus so we can
 *                         preserve a manager decision (APPROVED/DENIED) across
 *                         re-reconciliations triggered by a fresh clock event.
 * @param {object} shift   { breakMinutes, hoursPerDay, graceMinutesEarly,
 *                           graceMinutesLate }
 * @returns {object}       a patch suitable for prisma.update(): the new
 *                         earlyMinutes/lateMinutes/statuses + billable values.
 *                         Only includes fields that should be written.
 */
function reconcileRecord(record, shift = {}) {
  const breakMinutes      = shift.breakMinutes ?? 60;
  const hoursPerDay       = shift.hoursPerDay  ?? 8;
  const graceMinutesEarly = shift.graceMinutesEarly ?? 15;
  const graceMinutesLate  = shift.graceMinutesLate  ?? 15;

  const clockIn      = record.clockIn        ? new Date(record.clockIn)        : null;
  const clockOut     = record.clockOut       ? new Date(record.clockOut)       : null;
  const schedStart   = record.scheduledStart ? new Date(record.scheduledStart) : null;
  const schedEnd     = record.scheduledEnd   ? new Date(record.scheduledEnd)   : null;

  // ── Early delta ────────────────────────────────────────────────────────────
  let earlyMinutes = 0;
  let earlyStatus  = 'NOT_APPLICABLE';
  if (clockIn && schedStart) {
    earlyMinutes = Math.max(0, diffMinutes(schedStart, clockIn));
    if (earlyMinutes === 0) {
      earlyStatus = 'NOT_APPLICABLE';
    } else if (record.earlyStatus === 'APPROVED' || record.earlyStatus === 'DENIED') {
      // Preserve manager decision across re-reconciliation.
      earlyStatus = record.earlyStatus;
    } else {
      earlyStatus = classifyDelta(earlyMinutes, graceMinutesEarly);
    }
  }

  // ── Late delta ─────────────────────────────────────────────────────────────
  let lateMinutes = 0;
  let lateStatus  = 'NOT_APPLICABLE';
  if (clockOut && schedEnd) {
    lateMinutes = Math.max(0, diffMinutes(clockOut, schedEnd));
    if (lateMinutes === 0) {
      lateStatus = 'NOT_APPLICABLE';
    } else if (record.lateStatus === 'APPROVED' || record.lateStatus === 'DENIED') {
      lateStatus = record.lateStatus;
    } else {
      lateStatus = classifyDelta(lateMinutes, graceMinutesLate);
    }
  }

  // ── Billable bounds ────────────────────────────────────────────────────────
  // Early side counts iff approved (AUTO or manual). Otherwise clip to schedule.
  // If there's no schedule at all (no roster), pay the actual time as-is.
  let billableStart = clockIn;
  let billableEnd   = clockOut;
  if (schedStart && clockIn) {
    const earlyApproved = earlyStatus === 'AUTO_APPROVED' || earlyStatus === 'APPROVED';
    if (clockIn < schedStart && !earlyApproved) {
      billableStart = schedStart;
    }
    if (clockIn > schedStart) {
      // Employee was late — actual time stands; the short hours hurt them.
      billableStart = clockIn;
    }
  }
  if (schedEnd && clockOut) {
    const lateApproved = lateStatus === 'AUTO_APPROVED' || lateStatus === 'APPROVED';
    if (clockOut > schedEnd && !lateApproved) {
      billableEnd = schedEnd;
    }
    if (clockOut < schedEnd) {
      // Employee left early — actual time stands.
      billableEnd = clockOut;
    }
  }

  let billableHours   = null;
  let billableOtHours = 0;
  if (billableStart && billableEnd) {
    const gross = diffMinutes(billableEnd, billableStart);
    const net   = Math.max(0, gross - breakMinutes);
    billableHours   = round2(net / 60);
    billableOtHours = round2(Math.max(0, billableHours - hoursPerDay));
  }

  return {
    earlyMinutes,
    lateMinutes,
    earlyStatus,
    lateStatus,
    billableHours,
    billableOtHours,
  };
}

module.exports = {
  reconcileRecord,
  classifyDelta,
};
