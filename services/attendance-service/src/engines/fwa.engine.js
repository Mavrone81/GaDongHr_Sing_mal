'use strict';
/**
 * FWA Engine — Flexi-Work Arrangements (MOM Dec 2024 mandate)
 *
 * MOM Tripartite Guidelines on FWA (effective 1 Dec 2024):
 * - Employers with ≥10 employees must have a formal FWA request process
 * - Must respond in writing within 2 MONTHS of the request date
 * - Cannot retaliate against employees who make FWA requests
 * - All three types must be considered: Flexi-Time, Flexi-Load, Flexi-Place
 */

const FWA_TYPES    = ['FLEXI_TIME', 'FLEXI_LOAD', 'FLEXI_PLACE'];
const FWA_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'];

// MOM mandated 2-calendar-month response window
const RESPONSE_MONTHS = 2;

/**
 * Compute the MOM-mandated review deadline: exactly 2 calendar months
 * after the request creation date.
 */
function computeReviewDeadline(requestDate) {
  // UTC-anchored, matching shared/payroll-utils and the convention in
  // frontend/src/lib/timezone.ts. setMonth/getMonth walk the LOCAL calendar
  // while callers read the result with the getUTC accessors, so off UTC the
  // deadline landed on the wrong date.
  const d = new Date(requestDate);
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + RESPONSE_MONTHS,
    d.getUTCDate(),
  ));
}

/**
 * Classify urgency of the review deadline for HR dashboard.
 * Returns: OVERDUE | CRITICAL | WARNING | OK
 */
function classifyDeadlineUrgency(reviewDeadline, now = new Date()) {
  const deadlineMs = new Date(reviewDeadline).getTime();
  const nowMs      = new Date(now).getTime();
  const daysLeft   = Math.floor((deadlineMs - nowMs) / 86_400_000);
  if (daysLeft < 0)  return 'OVERDUE';
  if (daysLeft <= 7)  return 'CRITICAL';
  if (daysLeft <= 14) return 'WARNING';
  return 'OK';
}

/**
 * Compute days until (or past) the review deadline.
 * Negative = overdue.
 */
function daysUntilDeadline(reviewDeadline, now = new Date()) {
  return Math.floor(
    (new Date(reviewDeadline).getTime() - new Date(now).getTime()) / 86_400_000
  );
}

/**
 * Validate type-specific details field.
 * Returns { valid: true } or { valid: false, reason: string }
 */
function validateDetails(type, details) {
  if (!details) return { valid: true }; // details is optional — defaults applied at runtime

  switch (type) {
    case 'FLEXI_TIME': {
      const { proposedStartTime, proposedEndTime } = details;
      if (proposedStartTime && !/^\d{2}:\d{2}$/.test(proposedStartTime))
        return { valid: false, reason: 'proposedStartTime must be HH:MM' };
      if (proposedEndTime && !/^\d{2}:\d{2}$/.test(proposedEndTime))
        return { valid: false, reason: 'proposedEndTime must be HH:MM' };
      return { valid: true };
    }
    case 'FLEXI_LOAD': {
      const { hoursPerWeek, daysPerWeek } = details;
      if (hoursPerWeek !== undefined && (hoursPerWeek <= 0 || hoursPerWeek > 44))
        return { valid: false, reason: 'hoursPerWeek must be 1–44' };
      if (daysPerWeek !== undefined && (daysPerWeek < 1 || daysPerWeek > 5))
        return { valid: false, reason: 'daysPerWeek must be 1–5' };
      return { valid: true };
    }
    case 'FLEXI_PLACE': {
      const { wfhDaysPerWeek } = details;
      if (wfhDaysPerWeek !== undefined && (wfhDaysPerWeek < 1 || wfhDaysPerWeek > 5))
        return { valid: false, reason: 'wfhDaysPerWeek must be 1–5' };
      return { valid: true };
    }
    default:
      return { valid: false, reason: `Unknown FWA type: ${type}` };
  }
}

/**
 * Build a summary object for the HR dashboard from a list of requests.
 */
function buildDashboardSummary(requests, now = new Date()) {
  const summary = {
    total:    requests.length,
    pending:  0,
    approved: 0,
    rejected: 0,
    withdrawn:0,
    expired:  0,
    overdue:  0,   // PENDING requests past their deadline
    byType:   { FLEXI_TIME: 0, FLEXI_LOAD: 0, FLEXI_PLACE: 0 },
  };

  for (const r of requests) {
    const status = r.status.toLowerCase();
    if (summary[status] !== undefined) summary[status]++;
    if (summary.byType[r.type] !== undefined) summary.byType[r.type]++;

    if (r.status === 'PENDING') {
      const days = daysUntilDeadline(r.reviewDeadline, now);
      if (days < 0) summary.overdue++;
    }
  }

  return summary;
}

/**
 * Determine which PENDING requests should be swept to EXPIRED
 * (no response given after the review deadline).
 */
function findExpiredRequests(pendingRequests, now = new Date()) {
  const nowMs = new Date(now).getTime();
  return pendingRequests.filter(r => new Date(r.reviewDeadline).getTime() < nowMs);
}

/**
 * MOM-compliant type labels for UI and notifications.
 */
const TYPE_LABELS = {
  FLEXI_TIME:  'Flexi-Time (flexible start/end hours)',
  FLEXI_LOAD:  'Flexi-Load (reduced hours / part-time)',
  FLEXI_PLACE: 'Flexi-Place (work from home / remote)',
};

module.exports = {
  FWA_TYPES,
  FWA_STATUSES,
  RESPONSE_MONTHS,
  TYPE_LABELS,
  computeReviewDeadline,
  classifyDeadlineUrgency,
  daysUntilDeadline,
  validateDetails,
  buildDashboardSummary,
  findExpiredRequests,
};
