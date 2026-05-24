'use strict';
// Pure logic for TRN-003 government grant computations.
// - Absentee Payroll (AP) — SSG funded hours × rate (default SGD 7.50/hour)
// - ETS — SSG Enhanced Training Support grant = courseFee × percentage
// - SFEC — SkillsFuture Enterprise Credit covers 90% of OOP capped at remaining balance
// - SFC — SkillsFuture Credit declaration validation against employee balance

const AP_DEFAULT_RATE       = 7.50;  // SGD per training hour (SSG baseline)
const SFEC_COVERAGE_PERCENT = 0.90;  // SFEC covers 90% of qualifying OOP expense
const SFEC_DEFAULT_TOTAL    = 10000; // SGD per company (one-time)

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Absentee Payroll grant amount.
 * SSG pays AP × training hours × hourly rate (capped per programme).
 */
function computeApAmount(hours, hourlyRate = AP_DEFAULT_RATE) {
  const h = parseFloat(hours);
  const r = parseFloat(hourlyRate);
  if (!isFinite(h) || h < 0) return 0;
  if (!isFinite(r) || r < 0) return 0;
  return round2(h * r);
}

/**
 * ETS / SSG course-fee grant.
 * grant = courseFee × percentage  (0..1 fractional, e.g. 0.7 = 70%)
 */
function computeEtsGrant(courseFee, percentage) {
  const fee = parseFloat(courseFee);
  const pct = parseFloat(percentage);
  if (!isFinite(fee) || fee < 0) return 0;
  if (!isFinite(pct) || pct < 0 || pct > 1) return 0;
  return round2(fee * pct);
}

/**
 * SFEC coverage for a single claim.
 * Returns the lesser of (claimableAmount × 90%) and remaining balance.
 * `claimableAmount` is the company's out-of-pocket portion (post-SSG grant).
 */
function computeSfecCoverage(claimableAmount, sfecRemaining) {
  const c = parseFloat(claimableAmount);
  const r = parseFloat(sfecRemaining);
  if (!isFinite(c) || c < 0) return 0;
  if (!isFinite(r) || r < 0) return 0;
  return round2(Math.min(c * SFEC_COVERAGE_PERCENT, r));
}

/**
 * SFC declaration validation. Employees declare how much SFC they'll use
 * toward a course; declaration cannot exceed current balance.
 * Returns { ok: boolean, available, requested, error? }.
 */
function validateSfcDeclaration(requestedAmount, currentBalance) {
  const req = parseFloat(requestedAmount);
  const bal = parseFloat(currentBalance);
  if (!isFinite(req) || req <= 0) return { ok: false, available: bal, requested: req, error: 'Amount must be positive' };
  if (!isFinite(bal) || bal < 0) return { ok: false, available: 0, requested: req, error: 'No balance available' };
  if (req > bal) return { ok: false, available: bal, requested: req, error: `Insufficient balance: SGD ${bal} available, SGD ${req} requested` };
  return { ok: true, available: bal, requested: req, remaining: round2(bal - req) };
}

/**
 * Build SSG Absentee Payroll flat-file rows (pipe-delimited).
 * Header: NRIC|EmployeeName|CourseCode|HoursAttended|HourlyRate|ClaimAmount|PeriodStartDate|PeriodEndDate
 */
function formatSsgApExport(rows, periodStart, periodEnd) {
  const out = ['NRIC|EmployeeName|CourseCode|HoursAttended|HourlyRate|ClaimAmount|PeriodStartDate|PeriodEndDate'];
  for (const r of rows) {
    const nric = (r.nric || '').toUpperCase();
    const name = (r.employeeName || '').replace(/\|/g, ' ');
    const courseCode = r.ssgCourseCode || '';
    const hours = parseFloat(r.trainingHours || 0).toFixed(2);
    const rate  = parseFloat(r.hourlyRate || AP_DEFAULT_RATE).toFixed(2);
    const amt   = computeApAmount(r.trainingHours || 0, r.hourlyRate || AP_DEFAULT_RATE).toFixed(2);
    out.push([nric, name, courseCode, hours, rate, amt, periodStart, periodEnd].join('|'));
  }
  return out.join('\n');
}

module.exports = {
  AP_DEFAULT_RATE,
  SFEC_COVERAGE_PERCENT,
  SFEC_DEFAULT_TOTAL,
  computeApAmount,
  computeEtsGrant,
  computeSfecCoverage,
  validateSfcDeclaration,
  formatSsgApExport,
};
