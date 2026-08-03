'use strict';
/**
 * ENT-006 — every statutory figure on a payslip records the rate version that
 * produced it, so the payslip stays reproducible after the rate tables move on.
 *
 * These rows are written ALONGSIDE the legacy SG-named encrypted columns
 * (employeeCpfEnc, employerCpfEnc, sdlAmountEnc), not instead of them. Every
 * existing reader — PDF engine, IRAS engine, reporting — keeps working
 * untouched while this becomes the new source of truth. Malaysian runs will
 * write only these rows, because "employeeCpfEnc" is meaningless for EPF.
 *
 * Migrating live payslip history outright would have been faster and is exactly
 * the kind of thing that cannot be undone if it is wrong.
 */
const { buildStatutoryLines } = require('../src/utils/statutory-lines');

const STATUTORY = {
  employeeId: 'emp-1',
  employeeDeductions:    [{ code: 'CPF_EE', label: 'CPF (Employee)', amount: 1000,  basis: { employeeRate: 0.2 } }],
  employerContributions: [{ code: 'CPF_ER', label: 'CPF (Employer)', amount: 850,   basis: { employerRate: 0.17 } }],
  employerLevies:        [{ code: 'SDL',    label: 'SDL',            amount: 11.25, basis: { rate: 0.0025 } }],
};

const enc = (v) => `enc(${v})`;

describe('buildStatutoryLines', () => {
  const rows = buildStatutoryLines({
    payslipId: 'ps-1', tenantId: 'ten-1', statutory: STATUTORY,
    rateVersion: 'SG-2026.1', encrypt: enc,
  });

  test('emits one row per statutory line', () => {
    expect(rows).toHaveLength(3);
  });

  test('classifies party and kind correctly', () => {
    expect(rows.find(r => r.code === 'CPF_EE')).toMatchObject({ party: 'EMPLOYEE', kind: 'DEDUCTION' });
    expect(rows.find(r => r.code === 'CPF_ER')).toMatchObject({ party: 'EMPLOYER', kind: 'CONTRIBUTION' });
    expect(rows.find(r => r.code === 'SDL')).toMatchObject({ party: 'EMPLOYER', kind: 'LEVY' });
  });

  // Amounts are money and are encrypted at rest like every other money column.
  test('encrypts every amount', () => {
    expect(rows.find(r => r.code === 'CPF_EE').amountEnc).toBe('enc(1000)');
    expect(rows.every(r => typeof r.amountEnc === 'string')).toBe(true);
  });

  test('stamps rateVersion on every row (ENT-006)', () => {
    expect(rows.every(r => r.rateVersion === 'SG-2026.1')).toBe(true);
  });

  test('preserves the basis for audit', () => {
    expect(rows.find(r => r.code === 'SDL').basis).toEqual({ rate: 0.0025 });
  });

  test('carries payslipId and tenantId onto every row', () => {
    expect(rows.every(r => r.payslipId === 'ps-1' && r.tenantId === 'ten-1')).toBe(true);
  });

  test('returns an empty array when there are no lines', () => {
    expect(buildStatutoryLines({
      payslipId: 'ps-1', tenantId: 'ten-1',
      statutory: { employeeDeductions: [], employerContributions: [], employerLevies: [] },
      rateVersion: 'SG-2026.1', encrypt: enc,
    })).toEqual([]);
  });

  // A Malaysian run returns EPF/SOCSO/EIS/PCB codes through the same contract.
  // Nothing here is Singapore-specific — that is the point of the generic table.
  test('is country-agnostic — MY codes flow through unchanged', () => {
    const my = buildStatutoryLines({
      payslipId: 'ps-2', tenantId: 'ten-1', rateVersion: 'MY-2026.1', encrypt: enc,
      statutory: {
        employeeDeductions:    [{ code: 'EPF_EE', label: 'EPF (Employee)', amount: 550, basis: {} },
                                { code: 'PCB',    label: 'Monthly Tax Deduction', amount: 120, basis: {} }],
        employerContributions: [{ code: 'EPF_ER', label: 'EPF (Employer)', amount: 650, basis: {} }],
        employerLevies:        [{ code: 'HRDF',   label: 'HRD Corp Levy', amount: 50, basis: {} }],
      },
    });
    expect(my).toHaveLength(4);
    expect(my.map(r => r.code).sort()).toEqual(['EPF_EE', 'EPF_ER', 'HRDF', 'PCB']);
    expect(my.every(r => r.rateVersion === 'MY-2026.1')).toBe(true);
  });

  test('tolerates a missing kind array', () => {
    const partial = buildStatutoryLines({
      payslipId: 'ps-3', tenantId: 'ten-1', rateVersion: 'SG-2026.1', encrypt: enc,
      statutory: { employeeDeductions: [{ code: 'CPF_EE', label: 'x', amount: 1, basis: {} }] },
    });
    expect(partial).toHaveLength(1);
  });
});
