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
 *
 * ── Provenance ────────────────────────────────────────────────────────────────
 * Moved VERBATIM from shared/payroll-utils in the P1 statutory extraction. Not a
 * line of arithmetic was changed: the entire safety argument for that refactor
 * is that the existing Singapore suite passes unaltered across the new HTTP
 * boundary, and "improving" the engine while moving it would destroy that proof.
 *
 * Only the country-specific statutory functions live here. Generic payroll
 * arithmetic — OT, NPL, AWS, net pay, working-day counting — stayed in
 * shared/payroll-utils, because the run lifecycle needs it regardless of
 * country.
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

function computeFwl(dailyRate, daysInMonth) {
  return Math.round(dailyRate * daysInMonth * 100) / 100;
}

module.exports = { computeCpf, computeSdl, computeFwl, cpfRound };
