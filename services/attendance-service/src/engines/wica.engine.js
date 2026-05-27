'use strict';
/**
 * WICA Engine — Work Injury Compensation Act 2019 (FWA-003)
 *
 * MOM reporting deadlines (via iReport):
 * - FATAL:               1 working day from incident date
 * - HOSPITALISATION:    10 working days from incident date
 * - PERMANENT_INCAPACITY: 10 working days from confirmed diagnosis
 * - MEDICAL_LEAVE_ONLY: no MOM reporting required (keep 3-year records)
 *
 * "Working day" = Monday–Friday (public holiday calendaring not implemented;
 *  HR must manually adjust for PH dates if needed).
 */

const CATEGORIES_REQUIRING_MOM_REPORT = new Set([
  'HOSPITALISATION',
  'PERMANENT_INCAPACITY',
  'FATAL',
]);

const DEADLINE_WORKING_DAYS = {
  FATAL:                1,
  HOSPITALISATION:      10,
  PERMANENT_INCAPACITY: 10,
  MEDICAL_LEAVE_ONLY:   null,
};

/**
 * True when the category requires a MOM iReport submission.
 */
function isReportableToMom(category) {
  return CATEGORIES_REQUIRING_MOM_REPORT.has(category);
}

/**
 * Add N working days (Mon–Fri) to a base date and return the deadline.
 * Returns null for MEDICAL_LEAVE_ONLY.
 */
function computeMomDeadline(incidentDate, category) {
  const days = DEADLINE_WORKING_DAYS[category];
  if (days === null || days === undefined) return null;

  const date    = new Date(incidentDate);
  let remaining = days;

  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }

  return date;
}

/**
 * Classify MOM reporting deadline urgency for the HR dashboard.
 * Returns: OVERDUE | CRITICAL | WARNING | OK | NOT_REQUIRED
 */
function classifyDeadlineUrgency(momReportDeadline, now = new Date()) {
  if (!momReportDeadline) return 'NOT_REQUIRED';
  const daysLeft = Math.floor(
    (new Date(momReportDeadline).getTime() - new Date(now).getTime()) / 86_400_000
  );
  if (daysLeft < 0)  return 'OVERDUE';
  if (daysLeft <= 1)  return 'CRITICAL';
  if (daysLeft <= 3)  return 'WARNING';
  return 'OK';
}

/**
 * Days until (negative = overdue) the MOM reporting deadline.
 */
function daysUntilMomDeadline(momReportDeadline, now = new Date()) {
  if (!momReportDeadline) return null;
  return Math.floor(
    (new Date(momReportDeadline).getTime() - new Date(now).getTime()) / 86_400_000
  );
}

/**
 * Incidents that have not been MOM-reported and whose deadline has passed.
 */
function findOverdueIncidents(incidents, now = new Date()) {
  const nowMs = new Date(now).getTime();
  return incidents.filter(i =>
    i.momReportDeadline &&
    !i.momReportedAt &&
    i.status !== 'MOM_REPORTED' &&
    i.status !== 'CLOSED' &&
    new Date(i.momReportDeadline).getTime() < nowMs
  );
}

/**
 * Build a summary object for the WICA dashboard.
 */
function buildWicaDashboard(incidents, claims, now = new Date()) {
  const summary = {
    totalIncidents:   incidents.length,
    byCategory:       { MEDICAL_LEAVE_ONLY: 0, HOSPITALISATION: 0, PERMANENT_INCAPACITY: 0, FATAL: 0 },
    byStatus:         { REPORTED: 0, UNDER_REVIEW: 0, MOM_REPORTED: 0, CLAIM_SUBMITTED: 0, CLOSED: 0 },
    momReportingDue:  0,   // reportable, not yet submitted, deadline not yet passed
    momOverdue:       0,   // reportable, not submitted, deadline passed
    openClaims:       0,
    claimsByStatus:   { PENDING: 0, INSURER_NOTIFIED: 0, UNDER_ASSESSMENT: 0, APPROVED: 0, PAID: 0, REJECTED: 0 },
  };

  for (const i of incidents) {
    if (summary.byCategory[i.category] !== undefined) summary.byCategory[i.category]++;
    if (summary.byStatus[i.status]     !== undefined) summary.byStatus[i.status]++;

    if (i.momReportDeadline && !i.momReportedAt && i.status !== 'MOM_REPORTED' && i.status !== 'CLOSED') {
      const urgency = classifyDeadlineUrgency(i.momReportDeadline, now);
      if (urgency === 'OVERDUE') summary.momOverdue++;
      else                       summary.momReportingDue++;
    }
  }

  for (const c of claims) {
    if (['PENDING', 'INSURER_NOTIFIED', 'UNDER_ASSESSMENT'].includes(c.status)) summary.openClaims++;
    if (summary.claimsByStatus[c.status] !== undefined) summary.claimsByStatus[c.status]++;
  }

  return summary;
}

const CATEGORY_LABELS = {
  MEDICAL_LEAVE_ONLY:    'Medical Leave Only (< 3 days)',
  HOSPITALISATION:       'Hospitalisation',
  PERMANENT_INCAPACITY:  'Permanent Incapacity',
  FATAL:                 'Fatal',
};

module.exports = {
  DEADLINE_WORKING_DAYS,
  CATEGORY_LABELS,
  isReportableToMom,
  computeMomDeadline,
  classifyDeadlineUrgency,
  daysUntilMomDeadline,
  findOverdueIncidents,
  buildWicaDashboard,
};
