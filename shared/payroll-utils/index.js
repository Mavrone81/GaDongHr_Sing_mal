'use strict';

/**
 * Singapore CPF Computation Engine
 * Compliant with CPF Act (Cap. 36) and CPF Board published rates (Jan 2025)
 */

function computeCpf({ ow, aw = 0, ytdOw = 0, ytdAw = 0, citizenStatus, age, rates }) {
  if (citizenStatus === 'FOREIGNER') {
    return { employeeOw: 0, employerOw: 0, employeeAw: 0, employerAw: 0, totalEmployee: 0, totalEmployer: 0 };
  }

  const OW_CEILING = rates?.owCeiling || 6800;
  const AW_CEILING_ANNUAL = rates?.awCeiling || 102000;

  const employeeRate = rates?.employeeRate || 0;
  const employerRate = rates?.employerRate || 0;

  const owSubjectToCpf = Math.min(ow, OW_CEILING);
  const awCeilingRemaining = Math.max(AW_CEILING_ANNUAL - ytdOw - owSubjectToCpf, 0);
  const awSubjectToCpf = Math.min(aw, Math.min(awCeilingRemaining, AW_CEILING_ANNUAL - ytdAw));

  const employeeOw = cpfRound(owSubjectToCpf * employeeRate);
  const employerOw = cpfRound(owSubjectToCpf * employerRate);
  const employeeAw = cpfRound(awSubjectToCpf * employeeRate);
  const employerAw = cpfRound(awSubjectToCpf * employerRate);

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

module.exports = {
  computeCpf,
  computeSdl,
  computeOtPay,
  computeNplDeduction,
  computeAws,
  computeFwl,
  computeNetPay,
  cpfRound,
};
