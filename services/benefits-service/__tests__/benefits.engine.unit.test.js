'use strict';
/**
 * Unit tests: Benefits Engine (BEN-001)
 *
 * BIK-01  computeBikValue — non-taxable plan → 0
 * BIK-02  computeBikValue — taxable plan, no dependents → premiumEmployer
 * BIK-03  computeBikValue — taxable plan with dependents adds per-dep premium
 *
 * EL-01   eligibility — inactive plan rejected
 * EL-02   eligibility — plan not yet effective rejected
 * EL-03   eligibility — plan expired rejected
 * EL-04   eligibility — grade restriction rejects ineligible employee
 * EL-05   eligibility — grade restriction accepts eligible employee
 * EL-06   eligibility — empty eligibilityGrades = all eligible
 * EL-07   eligibility — tenure shortfall rejected
 * EL-08   eligibility — tenure met accepted
 * EL-09   eligibility — null plan returns ineligible
 *
 * SUM-01  buildEnrollmentSummary — counts by status
 * SUM-02  buildEnrollmentSummary — sums premium for ACTIVE only
 * SUM-03  buildEnrollmentSummary — empty list returns zeros
 * SUM-04  buildEnrollmentSummary — groups by plan type
 *
 * OEP-01  isInOpenEnrollmentPeriod — within window → true
 * OEP-02  isInOpenEnrollmentPeriod — before window → false
 * OEP-03  isInOpenEnrollmentPeriod — CLOSED status → false even within dates
 *
 * PR-01   computeAnnualPremium — no dependents
 * PR-02   computeAnnualPremium — 2 dependents adds per-dep × 2
 * PR-03   computeAnnualPremium — null plan returns zeros
 *
 * CS-01   buildClaimsSummary — counts by status & sums amounts
 * CS-02   buildClaimsSummary — totalReimbursed only for REIMBURSED status
 *
 * RC-01   computeReconciliation — billed > expected → positive variance
 * RC-02   computeReconciliation — perfect match → zero variance
 * RC-03   computeReconciliation — zero expected → 0% varianceRate
 */

const {
  computeBikValue,
  computeEnrollmentEligibility,
  buildEnrollmentSummary,
  isInOpenEnrollmentPeriod,
  computeAnnualPremium,
  buildClaimsSummary,
  computeReconciliation,
} = require('../src/engines/benefits.engine');

// ── computeBikValue ───────────────────────────────────────────────────────────
test('BIK-01 non-taxable plan → 0', () => {
  expect(computeBikValue({ premiumEmployer: 500, bikTaxable: false })).toBe(0);
});

test('BIK-02 taxable plan, no deps → premiumEmployer', () => {
  expect(computeBikValue({ premiumEmployer: 500, premiumDependent: 100, bikTaxable: true })).toBe(500);
});

test('BIK-03 taxable plan + 2 dependents → adds 2×perDep', () => {
  expect(computeBikValue({ premiumEmployer: 500, premiumDependent: 100, bikTaxable: true }, 2)).toBe(700);
});

// ── eligibility ───────────────────────────────────────────────────────────────
const futureDate = new Date(Date.now() + 30 * 86400000);
const pastDate   = new Date(Date.now() - 30 * 86400000);

test('EL-01 inactive plan rejected', () => {
  const r = computeEnrollmentEligibility({ grade: 'MGR' }, {
    isActive: false, effectiveFrom: pastDate, eligibilityGrades: [], minTenureMonths: 0,
  });
  expect(r.eligible).toBe(false);
  expect(r.reasons.join(' ')).toMatch(/inactive/i);
});

test('EL-02 plan not yet effective rejected', () => {
  const r = computeEnrollmentEligibility({ grade: 'MGR' }, {
    isActive: true, effectiveFrom: futureDate, eligibilityGrades: [], minTenureMonths: 0,
  });
  expect(r.eligible).toBe(false);
  expect(r.reasons.join(' ')).toMatch(/not yet effective/i);
});

test('EL-03 plan ended rejected', () => {
  const r = computeEnrollmentEligibility({ grade: 'MGR' }, {
    isActive: true, effectiveFrom: pastDate, effectiveTo: pastDate,
    eligibilityGrades: [], minTenureMonths: 0,
  });
  expect(r.eligible).toBe(false);
  expect(r.reasons.join(' ')).toMatch(/ended/i);
});

test('EL-04 grade restriction rejects ineligible employee', () => {
  const r = computeEnrollmentEligibility({ grade: 'JR' }, {
    isActive: true, effectiveFrom: pastDate, eligibilityGrades: ['MGR','DIR'], minTenureMonths: 0,
  });
  expect(r.eligible).toBe(false);
  expect(r.reasons.join(' ')).toMatch(/Restricted to grades/);
});

test('EL-05 grade restriction accepts eligible employee', () => {
  const r = computeEnrollmentEligibility({ grade: 'MGR' }, {
    isActive: true, effectiveFrom: pastDate, eligibilityGrades: ['MGR','DIR'], minTenureMonths: 0,
  });
  expect(r.eligible).toBe(true);
});

test('EL-06 empty eligibilityGrades = all eligible', () => {
  const r = computeEnrollmentEligibility({ grade: 'JR' }, {
    isActive: true, effectiveFrom: pastDate, eligibilityGrades: [], minTenureMonths: 0,
  });
  expect(r.eligible).toBe(true);
});

test('EL-07 tenure shortfall rejected', () => {
  const joinedThreeMonthsAgo = new Date();
  joinedThreeMonthsAgo.setMonth(joinedThreeMonthsAgo.getMonth() - 3);
  const r = computeEnrollmentEligibility(
    { grade: 'MGR', joinedAt: joinedThreeMonthsAgo },
    { isActive: true, effectiveFrom: pastDate, eligibilityGrades: [], minTenureMonths: 6 }
  );
  expect(r.eligible).toBe(false);
  expect(r.reasons.join(' ')).toMatch(/6 months tenure/);
});

test('EL-08 tenure met accepted', () => {
  const joinedYearAgo = new Date();
  joinedYearAgo.setFullYear(joinedYearAgo.getFullYear() - 1);
  const r = computeEnrollmentEligibility(
    { grade: 'MGR', joinedAt: joinedYearAgo },
    { isActive: true, effectiveFrom: pastDate, eligibilityGrades: [], minTenureMonths: 6 }
  );
  expect(r.eligible).toBe(true);
});

test('EL-09 null plan returns ineligible', () => {
  const r = computeEnrollmentEligibility({ grade: 'MGR' }, null);
  expect(r.eligible).toBe(false);
  expect(r.reasons[0]).toMatch(/not found/i);
});

// ── buildEnrollmentSummary ────────────────────────────────────────────────────
test('SUM-01 counts by status', () => {
  const r = buildEnrollmentSummary([
    { status: 'ACTIVE',    plan: { type: 'GHS' }, annualPremiumEmployer: 500 },
    { status: 'ACTIVE',    plan: { type: 'GTL' }, annualPremiumEmployer: 200 },
    { status: 'CANCELLED', plan: { type: 'GHS' }, annualPremiumEmployer: 500 },
    { status: 'EXPIRED',   plan: { type: 'PA'  }, annualPremiumEmployer: 100 },
  ]);
  expect(r.total).toBe(4);
  expect(r.active).toBe(2);
  expect(r.cancelled).toBe(1);
  expect(r.expired).toBe(1);
});

test('SUM-02 sums premium for ACTIVE only', () => {
  const r = buildEnrollmentSummary([
    { status: 'ACTIVE',    plan: { type: 'GHS' }, annualPremiumEmployer: 500, annualPremiumEmployee: 50 },
    { status: 'CANCELLED', plan: { type: 'GHS' }, annualPremiumEmployer: 999, annualPremiumEmployee: 99 },
  ]);
  expect(r.totalEmployerPremium).toBe(500);
  expect(r.totalEmployeePremium).toBe(50);
});

test('SUM-03 empty list returns zeros', () => {
  const r = buildEnrollmentSummary([]);
  expect(r.total).toBe(0);
  expect(r.totalEmployerPremium).toBe(0);
});

test('SUM-04 groups by plan type', () => {
  const r = buildEnrollmentSummary([
    { status: 'ACTIVE', plan: { type: 'GHS' } },
    { status: 'ACTIVE', plan: { type: 'GHS' } },
    { status: 'ACTIVE', plan: { type: 'DENTAL' } },
  ]);
  expect(r.byPlanType.GHS).toBe(2);
  expect(r.byPlanType.DENTAL).toBe(1);
});

// ── isInOpenEnrollmentPeriod ──────────────────────────────────────────────────
test('OEP-01 within window → true', () => {
  const now = new Date('2026-06-15');
  expect(isInOpenEnrollmentPeriod(now, {
    startDate: '2026-06-01', endDate: '2026-06-30', status: 'ACTIVE',
  })).toBe(true);
});

test('OEP-02 before window → false', () => {
  const now = new Date('2026-05-15');
  expect(isInOpenEnrollmentPeriod(now, {
    startDate: '2026-06-01', endDate: '2026-06-30', status: 'ACTIVE',
  })).toBe(false);
});

test('OEP-03 CLOSED status → false', () => {
  const now = new Date('2026-06-15');
  expect(isInOpenEnrollmentPeriod(now, {
    startDate: '2026-06-01', endDate: '2026-06-30', status: 'CLOSED',
  })).toBe(false);
});

// ── computeAnnualPremium ──────────────────────────────────────────────────────
test('PR-01 no dependents', () => {
  const p = computeAnnualPremium({ premiumEmployer: 500, premiumEmployee: 50, premiumDependent: 100 }, 0);
  expect(p.employer).toBe(500);
  expect(p.employee).toBe(50);
  expect(p.total).toBe(550);
});

test('PR-02 2 dependents adds per-dep × 2', () => {
  const p = computeAnnualPremium({ premiumEmployer: 500, premiumEmployee: 50, premiumDependent: 100 }, 2);
  expect(p.employer).toBe(700);  // 500 + 100*2
  expect(p.employee).toBe(50);
  expect(p.total).toBe(750);
});

test('PR-03 null plan returns zeros', () => {
  expect(computeAnnualPremium(null, 0)).toEqual({ employer: 0, employee: 0, total: 0 });
});

// ── buildClaimsSummary ────────────────────────────────────────────────────────
test('CS-01 counts by status & sums amounts', () => {
  const r = buildClaimsSummary([
    { status: 'SUBMITTED',  claimAmount: 100 },
    { status: 'APPROVED',   claimAmount: 200, approvedAmount: 180 },
    { status: 'REIMBURSED', claimAmount: 300, approvedAmount: 250 },
    { status: 'REJECTED',   claimAmount: 400 },
  ]);
  expect(r.total).toBe(4);
  expect(r.byStatus.SUBMITTED).toBe(1);
  expect(r.byStatus.APPROVED).toBe(1);
  expect(r.byStatus.REIMBURSED).toBe(1);
  expect(r.byStatus.REJECTED).toBe(1);
  expect(r.totalClaimed).toBe(1000);
  expect(r.totalApproved).toBe(430); // 180 + 250
});

test('CS-02 totalReimbursed only for REIMBURSED status', () => {
  const r = buildClaimsSummary([
    { status: 'APPROVED',   claimAmount: 200, approvedAmount: 180 },
    { status: 'REIMBURSED', claimAmount: 300, approvedAmount: 250 },
  ]);
  expect(r.totalReimbursed).toBe(250);
});

// ── computeReconciliation ─────────────────────────────────────────────────────
test('RC-01 billed > expected → positive variance', () => {
  const r = computeReconciliation([
    { status: 'ACTIVE', annualPremiumEmployer: 500 },
    { status: 'ACTIVE', annualPremiumEmployer: 500 },
  ], 1100);
  expect(r.expected).toBe(1000);
  expect(r.billed).toBe(1100);
  expect(r.variance).toBe(100);
  expect(r.varianceRate).toBe(10);
});

test('RC-02 perfect match → zero variance', () => {
  const r = computeReconciliation([
    { status: 'ACTIVE', annualPremiumEmployer: 750 },
  ], 750);
  expect(r.variance).toBe(0);
});

test('RC-03 zero expected → 0% varianceRate', () => {
  const r = computeReconciliation([], 0);
  expect(r.expected).toBe(0);
  expect(r.varianceRate).toBe(0);
});
