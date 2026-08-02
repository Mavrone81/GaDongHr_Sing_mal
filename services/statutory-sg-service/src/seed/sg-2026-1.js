'use strict';
/**
 * Canonical Singapore statutory rates — version SG-2026.1.
 *
 * PROVENANCE IS PART OF THE DATA (PRD §A7.1). Every value here is transcribed
 * from scripts/seed.js, which already holds the Jan 2026 figures verified
 * against the CPF Board rate table (TESTING.md §11 records that verification,
 * and scripts/migrate-cpf-jan2026.js documents the change from the prior set).
 * Nothing here was typed from memory.
 *
 * A bad transcription fails loudly rather than silently: the divergence report
 * in scripts/migrate-statutory-tables-sg.js compares every tenant's existing
 * rows against this set, so a wrong value would report every tenant as
 * diverging — an obviously wrong result rather than a subtly wrong payslip.
 */

const CPF_ROWS = [
  // [citizenStatus, ageMin, ageMax, employeeRate, employerRate]
  // SC and PR Year 3+ — CPF Board Table 1
  ['SC_PR',     0,  55,   0.20,  0.17 ],  // <=55:   20% / 17%     (total 37%)
  ['SC_PR',    55,  60,   0.18,  0.16 ],  // 55-60:  18% / 16%     (Jan 2026 enhanced)
  ['SC_PR',    60,  65,   0.125, 0.125],  // 60-65:  12.5% / 12.5% (Jan 2026 enhanced)
  ['SC_PR',    65,  70,   0.075, 0.09 ],  // 65-70:  7.5% / 9%
  ['SC_PR',    70,  null, 0.05,  0.075],  // 70+:    5% / 7.5%     (floor)
  // PR Year 1 graduated (G/G) — Table 2
  ['PR_YEAR1',  0,  60,   0.05,  0.04 ],
  ['PR_YEAR1', 60,  null, 0.05,  0.035],
  // PR Year 2 graduated (G/G) — Table 3
  ['PR_YEAR2',  0,  55,   0.15,  0.09 ],
  ['PR_YEAR2', 55,  60,   0.125, 0.06 ],
  ['PR_YEAR2', 60,  65,   0.075, 0.035],
  ['PR_YEAR2', 65,  null, 0.05,  0.035],
  // Foreigner — exempt per CPF Act s.7
  ['FOREIGNER', 0,  null, 0.0,   0.0  ],
];

// OW monthly ceiling raised 6,800 -> 8,000 for Jan 2026 (final step of the
// Budget 2023 four-year ramp). AW annual ceiling unchanged at 102,000.
const OW_CEILING = 8000;
const AW_CEILING = 102000;

const SG_2026_1 = {
  version: 'SG-2026.1',
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  source: 'CPF Board — CPF Contribution Rate Table from 1 January 2026 (Tables 1, 2, 3), via scripts/seed.js',
  retrievedAt: new Date('2026-05-22T00:00:00Z'),
  cpfRates: CPF_ROWS.map(([citizenStatus, ageMin, ageMax, employeeRate, employerRate]) => ({
    citizenStatus, ageMin, ageMax, employeeRate, employerRate,
    owCeiling: OW_CEILING, awCeiling: AW_CEILING,
  })),
  sdlConfig: { rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500 },
};

module.exports = { SG_2026_1 };
