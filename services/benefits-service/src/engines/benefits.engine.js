'use strict';
/**
 * Benefits Engine — pure functions, no Prisma/IO.
 *
 * Domain rules:
 *  • BIK (Benefit-In-Kind) — employer-paid premiums for taxable plan types
 *    are added to IR8A as benefits-in-kind (Section 10(1)(b) IRAS).
 *  • Eligibility — plan can restrict by employee grade and/or minimum tenure.
 *  • Open enrollment — a date window during which employees can elect plans.
 *  • Annual premium — employer + employee + (per-dependent × N) sum.
 */

const PLAN_TYPES = ['GHS', 'GTL', 'PA', 'DENTAL', 'OUTPATIENT', 'OTHER'];

/**
 * computeBikValue — returns the employer-paid premium amount that should be
 * reported as a benefit-in-kind for tax purposes.
 *
 * @param {Object} plan       — { premiumEmployer, bikTaxable }
 * @param {Number} dependents — number of dependents enrolled
 * @returns {Number}          — BIK amount in SGD (0 if not taxable)
 */
function computeBikValue(plan, dependents = 0) {
  if (!plan || !plan.bikTaxable) return 0;
  const base = Number(plan.premiumEmployer || 0);
  const depPortion = Number(plan.premiumDependent || 0) * Number(dependents || 0);
  // BIK only on employer-paid portion. Dependent premiums fully employer-paid.
  return round2(base + depPortion);
}

/**
 * computeEnrollmentEligibility — checks if an employee is eligible for a plan.
 *
 * @param {Object} employee — { grade, joinedAt }
 * @param {Object} plan     — { eligibilityGrades, minTenureMonths, isActive, effectiveFrom, effectiveTo }
 * @param {Date}   now      — reference date
 * @returns {{eligible: boolean, reasons: string[]}}
 */
function computeEnrollmentEligibility(employee, plan, now = new Date()) {
  const reasons = [];

  if (!plan) {
    return { eligible: false, reasons: ['Plan not found'] };
  }
  if (!plan.isActive) {
    reasons.push('Plan is inactive');
  }
  if (plan.effectiveFrom && new Date(plan.effectiveFrom) > now) {
    reasons.push('Plan not yet effective');
  }
  if (plan.effectiveTo && new Date(plan.effectiveTo) < now) {
    reasons.push('Plan has ended');
  }

  // Grade restriction (empty array = all grades eligible)
  if (Array.isArray(plan.eligibilityGrades) && plan.eligibilityGrades.length > 0) {
    if (!employee?.grade || !plan.eligibilityGrades.includes(employee.grade)) {
      reasons.push(`Restricted to grades: ${plan.eligibilityGrades.join(', ')}`);
    }
  }

  // Tenure restriction
  if (plan.minTenureMonths > 0) {
    if (!employee?.joinedAt) {
      reasons.push('Employment date unknown — tenure cannot be verified');
    } else {
      const joinDate = new Date(employee.joinedAt);
      const monthsServed =
        (now.getFullYear() - joinDate.getFullYear()) * 12 +
        (now.getMonth() - joinDate.getMonth());
      if (monthsServed < plan.minTenureMonths) {
        reasons.push(`Requires ${plan.minTenureMonths} months tenure (currently ${monthsServed})`);
      }
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

/**
 * buildEnrollmentSummary — aggregates a list of enrollments by status and plan.
 *
 * @param {Array} enrollments — list of EmployeeEnrollment records
 * @returns {Object}          — { total, byStatus, byPlanType, totalEmployerPremium, totalEmployeePremium }
 */
function buildEnrollmentSummary(enrollments) {
  const list = Array.isArray(enrollments) ? enrollments : [];
  const summary = {
    total: list.length,
    active: 0,
    cancelled: 0,
    expired: 0,
    byStatus: {},
    byPlanType: {},
    totalEmployerPremium: 0,
    totalEmployeePremium: 0,
  };
  for (const e of list) {
    summary.byStatus[e.status] = (summary.byStatus[e.status] || 0) + 1;
    if (e.status === 'ACTIVE') summary.active += 1;
    else if (e.status === 'CANCELLED') summary.cancelled += 1;
    else if (e.status === 'EXPIRED') summary.expired += 1;

    const planType = e.plan?.type || 'UNKNOWN';
    summary.byPlanType[planType] = (summary.byPlanType[planType] || 0) + 1;

    if (e.status === 'ACTIVE') {
      summary.totalEmployerPremium += Number(e.annualPremiumEmployer || 0);
      summary.totalEmployeePremium += Number(e.annualPremiumEmployee || 0);
    }
  }
  summary.totalEmployerPremium = round2(summary.totalEmployerPremium);
  summary.totalEmployeePremium = round2(summary.totalEmployeePremium);
  return summary;
}

/**
 * isInOpenEnrollmentPeriod — checks if a date falls within an enrollment window.
 *
 * @param {Date}   date   — date to check
 * @param {Object} period — { startDate, endDate, status }
 * @returns {boolean}
 */
function isInOpenEnrollmentPeriod(date, period) {
  if (!period || !period.startDate || !period.endDate) return false;
  if (period.status === 'CLOSED') return false;
  const d = new Date(date).getTime();
  const start = new Date(period.startDate).getTime();
  const end = new Date(period.endDate).getTime();
  return d >= start && d <= end;
}

/**
 * computeAnnualPremium — total premium for an enrollment.
 *
 * @param {Object} plan       — { premiumEmployer, premiumEmployee, premiumDependent }
 * @param {Number} dependents — count of enrolled dependents
 * @returns {{employer: Number, employee: Number, total: Number}}
 */
function computeAnnualPremium(plan, dependents = 0) {
  if (!plan) return { employer: 0, employee: 0, total: 0 };
  const employer = Number(plan.premiumEmployer || 0);
  const employee = Number(plan.premiumEmployee || 0);
  const perDep   = Number(plan.premiumDependent || 0);
  const depTotal = perDep * Number(dependents || 0);
  // Per Singapore practice: dependent premiums billed to employer when plan covers dependents.
  const employerTotal = round2(employer + depTotal);
  const employeeTotal = round2(employee);
  return {
    employer: employerTotal,
    employee: employeeTotal,
    total: round2(employerTotal + employeeTotal),
  };
}

/**
 * buildClaimsSummary — aggregate claims by status, total claimed, total approved.
 *
 * @param {Array} claims — list of InsuranceClaim records
 * @returns {Object}
 */
function buildClaimsSummary(claims) {
  const list = Array.isArray(claims) ? claims : [];
  const summary = {
    total: list.length,
    byStatus: {},
    totalClaimed: 0,
    totalApproved: 0,
    totalReimbursed: 0,
  };
  for (const c of list) {
    summary.byStatus[c.status] = (summary.byStatus[c.status] || 0) + 1;
    summary.totalClaimed += Number(c.claimAmount || 0);
    if (c.status === 'APPROVED' || c.status === 'REIMBURSED') {
      summary.totalApproved += Number(c.approvedAmount || 0);
    }
    if (c.status === 'REIMBURSED') {
      summary.totalReimbursed += Number(c.approvedAmount || 0);
    }
  }
  summary.totalClaimed = round2(summary.totalClaimed);
  summary.totalApproved = round2(summary.totalApproved);
  summary.totalReimbursed = round2(summary.totalReimbursed);
  return summary;
}

/**
 * computeReconciliation — compare expected employer premium vs paid (insurer billing).
 *
 * @param {Array}  activeEnrollments — enrollments contributing to this period
 * @param {Number} insurerBilled     — amount insurer billed for this period
 * @returns {{expected: Number, billed: Number, variance: Number, varianceRate: Number}}
 */
function computeReconciliation(activeEnrollments, insurerBilled = 0) {
  const expected = (activeEnrollments || [])
    .filter(e => e.status === 'ACTIVE')
    .reduce((sum, e) => sum + Number(e.annualPremiumEmployer || 0), 0);
  const billed = Number(insurerBilled || 0);
  const variance = round2(billed - expected);
  const varianceRate = expected === 0 ? 0 : round2((variance / expected) * 100);
  return {
    expected: round2(expected),
    billed: round2(billed),
    variance,
    varianceRate,
  };
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

module.exports = {
  PLAN_TYPES,
  computeBikValue,
  computeEnrollmentEligibility,
  buildEnrollmentSummary,
  isInOpenEnrollmentPeriod,
  computeAnnualPremium,
  buildClaimsSummary,
  computeReconciliation,
};
