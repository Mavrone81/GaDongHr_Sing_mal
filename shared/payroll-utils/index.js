'use strict';

/**
 * Singapore CPF Computation Engine
 * Compliant with CPF Act (Cap. 36) and CPF Board published rates (Jan 2026)
 *
 * Rounding methodology per CPF Board "Steps to compute CPF contribution"
 * (printed at the bottom of every official rate table PDF):
 *   1) Total CPF contribution: round to nearest dollar (< $0.50 → down, ≥ $0.50 → up)
 *   2) Employee's share:        round DOWN to nearest dollar
 *   3) Employer's share:        Total − Employee's share (derived, not separately rounded)
 *
 * OW and AW are computed separately and summed (per the same instructions).
 */

function computeCpf({ ow, aw = 0, ytdOw = 0, ytdAw = 0, citizenStatus, age, rates }) {
  if (citizenStatus === 'FOREIGNER') {
    return { employeeOw: 0, employerOw: 0, employeeAw: 0, employerAw: 0, totalEmployee: 0, totalEmployer: 0 };
  }

  const OW_CEILING = rates?.owCeiling || 8000;
  const AW_CEILING_ANNUAL = rates?.awCeiling || 102000;

  const employeeRate = rates?.employeeRate || 0;
  const employerRate = rates?.employerRate || 0;
  const totalRate    = employeeRate + employerRate;

  const owSubjectToCpf = Math.min(ow, OW_CEILING);
  const awCeilingRemaining = Math.max(AW_CEILING_ANNUAL - ytdOw - owSubjectToCpf, 0);
  const awSubjectToCpf = Math.min(aw, Math.min(awCeilingRemaining, AW_CEILING_ANNUAL - ytdAw));

  // CPF Board 3-step rounding (OW): total = round nearest; employee = floor; employer = total − employee
  const owTotal    = Math.round(owSubjectToCpf * totalRate);
  const employeeOw = Math.floor(owSubjectToCpf * employeeRate);
  const employerOw = owTotal - employeeOw;

  // Same rounding rules applied to AW component
  const awTotal    = Math.round(awSubjectToCpf * totalRate);
  const employeeAw = Math.floor(awSubjectToCpf * employeeRate);
  const employerAw = awTotal - employeeAw;

  return {
    employeeOw,
    employerOw,
    employeeAw,
    employerAw,
    totalEmployee: employeeOw + employeeAw,
    totalEmployer: employerOw + employerAw,
    owSubjectToCpf,
    awSubjectToCpf,
  };
}

// Legacy helper retained for backward compatibility. Prefer the explicit
// 3-step rounding pattern in computeCpf above for new code.
function cpfRound(amount) {
  return Math.round(amount);
}

function computeSdl(grossMonthlyRemuneration, config = {}) {
  const rate = config.rate || 0.0025;
  const min = config.minAmount || 2.00;
  const max = config.maxAmount || 11.25;
  const cap = config.salaryCap || 4500;

  if (grossMonthlyRemuneration <= 0) return 0;
  const sdl = Math.min(Math.max(Math.min(grossMonthlyRemuneration, cap) * rate, min), max);
  return Math.round(sdl * 100) / 100;
}

function computeOtPay(monthlyBasic, weeklyHours, otHours, otMultiplier = 1.5) {
  const annualBasic = monthlyBasic * 12;
  const hourlyRate = annualBasic / 52 / weeklyHours;
  const otPay = hourlyRate * otMultiplier * otHours;
  return Math.round(otPay * 100) / 100;
}

function computeNplDeduction(monthlyBasic, nplDays) {
  const dailyRate = monthlyBasic / 26;
  return Math.round(dailyRate * nplDays * 100) / 100;
}

function computeAws(monthlyBasic, monthsServed = 12) {
  return Math.round(monthlyBasic * (monthsServed / 12) * 100) / 100;
}

function computeFwl(dailyRate, daysInMonth) {
  return Math.round(dailyRate * daysInMonth * 100) / 100;
}

function computeNetPay({ grossPay, employeeCpf, nplDeduction = 0, absenceDeduction = 0, loanRepayment = 0, advanceRecovery = 0, garnishment = 0, reimbursements = 0 }) {
  return Math.round((grossPay - employeeCpf - nplDeduction - absenceDeduction - loanRepayment - advanceRecovery - garnishment + reimbursements) * 100) / 100;
}

// Count Mon-Fri (or Mon-Sat for SIX_DAY) working days between two dates, inclusive.
// holidaySet: Set of 'YYYY-MM-DD' strings for public holidays.
function countWorkingDays(from, to, holidaySet = new Set(), workDayType = 'FIVE_DAY') {
  const maxDow = workDayType === 'SIX_DAY' ? 6 : 5;
  let count = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(23, 59, 59, 999);
  while (d <= end) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= maxDow && !holidaySet.has(d.toISOString().slice(0, 10))) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// Working days of a leave application that fall inside a payroll period.
// Cross-month leaves are clamped to [periodStart, periodEnd].
// isHalfDay=true returns 0.5 if the single day is a working day in the period, else 0.
function countPeriodLeaveWorkingDays(leaveStart, leaveEnd, periodStart, periodEnd, holidaySet = new Set(), workDayType = 'FIVE_DAY', isHalfDay = false) {
  const effStart = leaveStart < periodStart ? periodStart : leaveStart;
  const effEnd   = leaveEnd   > periodEnd   ? periodEnd   : leaveEnd;
  if (effStart > effEnd) return 0;

  if (isHalfDay) {
    const ds  = effStart.toISOString().slice(0, 10);
    const dow = effStart.getDay();
    const maxDow = workDayType === 'SIX_DAY' ? 6 : 5;
    return (dow >= 1 && dow <= maxDow && !holidaySet.has(ds)) ? 0.5 : 0;
  }

  return countWorkingDays(effStart, effEnd, holidaySet, workDayType);
}

module.exports = {
  computeCpf,
  computeSdl,
  computeOtPay,
  computeNplDeduction,
  computeAws,
  computeFwl,
  computeNetPay,
  cpfRound,
  countWorkingDays,
  countPeriodLeaveWorkingDays,
};
