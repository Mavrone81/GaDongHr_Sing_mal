'use strict';
// Pure IR21 deadline / withhold logic — no side effects, fully unit-testable.

const IR21_FILING_LEAD_DAYS = 30; // IRAS requires filing ≥1 month before cessation

/**
 * Compute the latest date by which IR21 must be filed.
 * IRAS rule: file at least 1 month before last working day OR 1 month
 * before any lump-sum payment, whichever is earlier.
 */
function computeIr21Deadline(lastWorkingDate) {
  const lwd = new Date(lastWorkingDate);
  const deadline = new Date(lwd);
  deadline.setDate(deadline.getDate() - IR21_FILING_LEAD_DAYS);
  return deadline;
}

/**
 * Days remaining until the deadline (negative = overdue).
 * Comparison is date-only (SGT midnight normalised to UTC midnight).
 */
function daysUntilDeadline(ir21DeadlineDate) {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const dl = new Date(ir21DeadlineDate);
  dl.setUTCHours(0, 0, 0, 0);
  return Math.ceil((dl - now) / (1000 * 60 * 60 * 24));
}

/**
 * Classify urgency for dashboard colour-coding.
 * OVERDUE  — deadline passed, IR21 not yet filed
 * CRITICAL — ≤7 days left
 * WARNING  — 8-14 days left
 * OK       — >14 days
 */
function classifyDeadlineUrgency(days) {
  if (days < 0) return 'OVERDUE';
  if (days <= 7) return 'CRITICAL';
  if (days <= 14) return 'WARNING';
  return 'OK';
}

/**
 * True when final pay must be withheld pending IRAS clearance.
 * Withheld while status is PENDING or SUBMITTED; released on CLEARANCE_ISSUED.
 */
function shouldWithholdPay(isForeignEmployee, ir21Status) {
  if (!isForeignEmployee) return false;
  return ir21Status === 'PENDING' || ir21Status === 'SUBMITTED';
}

/**
 * Build dashboard entry for a single offboarding case.
 */
function buildDashboardEntry(offCase, nowOverride) {
  const now = nowOverride || new Date();
  const days = offCase.ir21DeadlineDate ? daysUntilDeadline(offCase.ir21DeadlineDate) : null;
  return {
    id: offCase.id,
    employeeId: offCase.employeeId,
    employeeName: offCase.employeeName,
    department: offCase.department,
    lastWorkingDate: offCase.lastWorkingDate,
    ir21Status: offCase.ir21Status,
    ir21DeadlineDate: offCase.ir21DeadlineDate,
    ir21FiledAt: offCase.ir21FiledAt,
    ir21ClearedAt: offCase.ir21ClearedAt,
    moniesWithheld: offCase.moniesWithheld,
    formPopulated: !!offCase.ir21FormData,
    daysUntilDeadline: days,
    urgency: days !== null ? classifyDeadlineUrgency(days) : null,
  };
}

module.exports = {
  IR21_FILING_LEAD_DAYS,
  computeIr21Deadline,
  daysUntilDeadline,
  classifyDeadlineUrgency,
  shouldWithholdPay,
  buildDashboardEntry,
};
