'use strict';

/**
 * ENT-006 — flattens a statutory result into per-line payslip rows.
 *
 * Written ALONGSIDE the legacy SG-named encrypted columns (employeeCpfEnc,
 * employerCpfEnc, sdlAmountEnc), not instead of them. Every existing reader —
 * PDF engine, IRAS engine, reporting — keeps working untouched while this
 * becomes the new source of truth. A later release moves those readers across
 * and drops the columns.
 *
 * Dual-writing is slower than migrating outright and leaves redundant columns
 * for a release. That is the trade being made deliberately: the Malaysian build
 * cannot corrupt existing Singapore payslip history, and a migration of live
 * payslips is exactly the kind of change that cannot be undone if it is wrong.
 *
 * Nothing here is Singapore-specific. A Malaysian run returns EPF/SOCSO/EIS/PCB
 * codes through the same contract and lands in the same table — which is why
 * MY runs can write only these rows, since "employeeCpfEnc" is meaningless for
 * EPF.
 */
const KINDS = [
  ['employeeDeductions',    'EMPLOYEE', 'DEDUCTION'],
  ['employerContributions', 'EMPLOYER', 'CONTRIBUTION'],
  ['employerLevies',        'EMPLOYER', 'LEVY'],
];

function buildStatutoryLines({ payslipId, tenantId, statutory, rateVersion, encrypt }) {
  const rows = [];
  for (const [key, party, kind] of KINDS) {
    for (const line of (statutory && statutory[key]) || []) {
      rows.push({
        payslipId, tenantId,
        code: line.code,
        label: line.label,
        party,
        kind,
        amountEnc: encrypt(String(line.amount)),
        // The audit trail: which band or rate produced this figure. Paired with
        // rateVersion it is what makes a payslip defensible years later.
        basis: line.basis || null,
        rateVersion,
      });
    }
  }
  return rows;
}

module.exports = { buildStatutoryLines };
