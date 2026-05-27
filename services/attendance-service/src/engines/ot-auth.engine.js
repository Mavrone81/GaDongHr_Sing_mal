'use strict';
/**
 * OT Pre-Authorization Engine — FWA-002
 *
 * MOM Employment Act s.38: OT capped at 72 hours per calendar month.
 * Emergency OT may be authorized post-hoc within 24 hours of the work date.
 * All pure functions — no Prisma, no side effects.
 */

const MOM_MONTHLY_CAP_HOURS  = 72;  // MOM EA s.38
const EMERGENCY_WINDOW_HOURS = 24;  // post-hoc authorization window

/**
 * Check if adding requestedHours would breach the MOM 72h monthly cap.
 * alreadyApprovedHours: sum of APPROVED OtAuthorization.requestedHours this month.
 */
function checkMonthlyCap(alreadyApprovedHours, requestedHours) {
  const projectedTotal = alreadyApprovedHours + requestedHours;
  const remainingHours = Math.max(0, MOM_MONTHLY_CAP_HOURS - alreadyApprovedHours);
  return {
    canProceed: projectedTotal <= MOM_MONTHLY_CAP_HOURS,
    alreadyApprovedHours,
    requestedHours,
    projectedTotal,
    remainingHours,
    wouldExceed: projectedTotal > MOM_MONTHLY_CAP_HOURS,
    capHours: MOM_MONTHLY_CAP_HOURS,
  };
}

/**
 * Check if approving requestedHours would exceed the department OT budget.
 * Soft check — callers may warn rather than block.
 */
function checkBudget(budgetHours, usedHours, requestedHours) {
  const projectedUsed   = usedHours + requestedHours;
  const remainingBudget = Math.max(0, budgetHours - usedHours);
  return {
    canProceed:      projectedUsed <= budgetHours,
    budgetHours,
    usedHours,
    requestedHours,
    projectedUsed,
    remainingBudget,
    wouldExceed: projectedUsed > budgetHours,
  };
}

/**
 * Emergency OT: the planned date has already passed (OT already worked)
 * and we are still within the 24-hour post-hoc window.
 */
function isWithinEmergencyWindow(plannedDate, now = new Date()) {
  const plannedMs = new Date(plannedDate).getTime();
  const nowMs     = new Date(now).getTime();
  const elapsedMs = nowMs - plannedMs;
  return elapsedMs >= 0 && elapsedMs <= EMERGENCY_WINDOW_HOURS * 3_600_000;
}

/**
 * Compute when an OT authorization request expires:
 * - Standard: must be approved before OT is worked → expires at start of plannedDate
 * - Emergency: must be approved within 24h of the planned date
 */
function computeExpiresAt(plannedDate, isEmergency) {
  const planned = new Date(plannedDate);
  if (isEmergency) {
    return new Date(planned.getTime() + EMERGENCY_WINDOW_HOURS * 3_600_000);
  }
  return new Date(planned); // expires at start of the OT day
}

/**
 * Build a monthly OT summary from a list of OtAuthorization rows.
 * Groups by employee and department; sorts descending by approvedHours.
 */
function buildMonthlyOtSummary(authorizations, period) {
  const approved = authorizations.filter(a => a.status === 'APPROVED');
  const pending  = authorizations.filter(a => a.status === 'PENDING');
  const rejected = authorizations.filter(a => a.status === 'REJECTED');

  const byEmployeeMap   = {};
  const byDepartmentMap = {};

  for (const a of approved) {
    if (!byEmployeeMap[a.employeeId]) {
      byEmployeeMap[a.employeeId] = { employeeId: a.employeeId, approvedHours: 0, requestCount: 0 };
    }
    byEmployeeMap[a.employeeId].approvedHours  += a.requestedHours;
    byEmployeeMap[a.employeeId].requestCount++;

    if (a.departmentId) {
      if (!byDepartmentMap[a.departmentId]) {
        byDepartmentMap[a.departmentId] = { departmentId: a.departmentId, approvedHours: 0, requestCount: 0 };
      }
      byDepartmentMap[a.departmentId].approvedHours += a.requestedHours;
      byDepartmentMap[a.departmentId].requestCount++;
    }
  }

  return {
    period,
    total:              authorizations.length,
    approved:           approved.length,
    pending:            pending.length,
    rejected:           rejected.length,
    totalApprovedHours: approved.reduce((s, a) => s + a.requestedHours, 0),
    byEmployee:         Object.values(byEmployeeMap).sort((a, b) => b.approvedHours - a.approvedHours),
    byDepartment:       Object.values(byDepartmentMap).sort((a, b) => b.approvedHours - a.approvedHours),
  };
}

/**
 * Determine which PENDING requests should be swept to AUTO_EXPIRED.
 */
function findExpiredOtRequests(pendingRequests, now = new Date()) {
  const nowMs = new Date(now).getTime();
  return pendingRequests.filter(r => new Date(r.expiresAt).getTime() < nowMs);
}

module.exports = {
  MOM_MONTHLY_CAP_HOURS,
  EMERGENCY_WINDOW_HOURS,
  checkMonthlyCap,
  checkBudget,
  isWithinEmergencyWindow,
  computeExpiresAt,
  buildMonthlyOtSummary,
  findExpiredOtRequests,
};
