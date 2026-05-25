'use strict';

// MSF/MINDEF daily caps per leave-type code (SGD).
// GPML SGD 10,000/4-week = 500/day (5-day week)
// GPPL SGD 2,500/week    = 500/day
// CCL  SGD 500/week      = 100/day
// SPL  follows GPPL      = 500/day
// NSL  no MSF cap — claim is make-up pay formula (see computeNsMakeupAmount)
const DAILY_CAPS = {
  ML:  500,
  PL:  500,
  CCL: 100,
  SPL: 500,
};

// Returns the claimable amount for a single govt-paid leave entry (non-NS).
// Caps the daily rate at the MSF schedule; NSL must use computeNsMakeupAmount.
function computeClaimableAmount(leaveTypeCode, leaveDays, dailyRate) {
  const cap = DAILY_CAPS[leaveTypeCode];
  const effectiveDailyRate = cap != null ? Math.min(dailyRate, cap) : dailyRate;
  return round2(effectiveDailyRate * leaveDays);
}

// NS make-up pay: the employer pays the civilian rate; MINDEF separately pays the
// NS allowance to the employee. The employer claims the net cost from MINDEF.
// nsAllowancePerDay defaults to 0 (full civilian rate claimed) if not supplied.
function computeNsMakeupAmount(leaveDays, dailyRate, nsAllowancePerDay = 0) {
  const makeupPerDay = Math.max(0, dailyRate - nsAllowancePerDay);
  return round2(makeupPerDay * leaveDays);
}

// Employer CPF contribution attributable to the govt-paid days.
// Provides the "CPF treatment differentiation" for reimbursement tracking.
function computeCpfOnGovtPaid(claimableAmount, employerCpfRate) {
  if (!employerCpfRate || employerCpfRate <= 0) return 0;
  return round2(claimableAmount * employerCpfRate);
}

// Build a single claim record ready for upsert (no DB calls).
function buildClaimRecord({ employeeId, period, leaveTypeCode, leaveTypeName, leaveDays, dailyRate, nsAllowancePerDay, employerCpfRate }) {
  const isNsl = leaveTypeCode === 'NSL';
  const claimableAmount = isNsl
    ? computeNsMakeupAmount(leaveDays, dailyRate, nsAllowancePerDay)
    : computeClaimableAmount(leaveTypeCode, leaveDays, dailyRate);

  const cpfOnGovtPaid = computeCpfOnGovtPaid(claimableAmount, employerCpfRate);
  const nsMakeupAmount = isNsl ? claimableAmount : null;

  return {
    employeeId,
    period,
    leaveTypeCode,
    leaveTypeName,
    leaveDays,
    dailyRate: round2(dailyRate),
    claimableAmount: round2(claimableAmount),
    cpfOnGovtPaid: cpfOnGovtPaid > 0 ? round2(cpfOnGovtPaid) : null,
    nsMakeupAmount: nsMakeupAmount != null ? round2(nsMakeupAmount) : null,
    nsAllowancePerDay: isNsl ? (nsAllowancePerDay || 0) : null,
  };
}

// Aggregate raw leave applications into {employeeId → {leaveTypeCode → {days, name}}} map.
// Expects each application to have: { employeeId, leaveType: { code, name, isGovtPaid }, totalDays }.
function groupLeavesByEmployeeAndType(applications) {
  const groups = {};
  for (const app of applications) {
    const lt = app.leaveType;
    if (!lt || !lt.isGovtPaid) continue;
    const empId = app.employeeId;
    const code  = lt.code;
    if (!groups[empId]) groups[empId] = {};
    if (!groups[empId][code]) groups[empId][code] = { days: 0, name: lt.name };
    groups[empId][code].days += app.totalDays || 0;
  }
  return groups;
}

// Allowed status transitions.
const TRANSITIONS = {
  PENDING:   ['SUBMITTED', 'REJECTED'],
  SUBMITTED: ['REIMBURSED', 'REJECTED'],
  REJECTED:  [],
  REIMBURSED: [],
};

function isValidTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = {
  DAILY_CAPS,
  computeClaimableAmount,
  computeNsMakeupAmount,
  computeCpfOnGovtPaid,
  buildClaimRecord,
  groupLeavesByEmployeeAndType,
  isValidTransition,
  round2,
};
