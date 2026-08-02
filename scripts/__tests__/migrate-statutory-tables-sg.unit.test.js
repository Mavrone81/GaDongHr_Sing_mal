'use strict';
/**
 * ENT-004 — hoisting per-tenant statutory rates into the global tables.
 *
 * The divergence report is the valuable half. scripts/migrate-cpf-jan2026.js had
 * to be run against every deployment individually, so a tenant that never
 * received it is still computing CPF on the pre-2026 bands — under-contributing
 * for senior workers and high earners. This comparison names those tenants.
 */
const { diffRateRows } = require('../migrate-statutory-tables-sg');

const CANONICAL = [
  { citizenStatus: 'SC_PR', ageMin: 0,  ageMax: 55, employeeRate: 0.20, employerRate: 0.17, owCeiling: 8000 },
  { citizenStatus: 'SC_PR', ageMin: 55, ageMax: 60, employeeRate: 0.18, employerRate: 0.16, owCeiling: 8000 },
];

describe('diffRateRows', () => {
  test('reports nothing when the tenant matches canonical', () => {
    expect(diffRateRows(CANONICAL, CANONICAL)).toEqual([]);
  });

  // The exact drift the Jan 2026 migration existed to fix: a tenant that never
  // ran it is still on the old 16%/15% band for 55-60.
  test('reports a stale rate', () => {
    const stale = [CANONICAL[0], { ...CANONICAL[1], employeeRate: 0.16 }];
    expect(diffRateRows(CANONICAL, stale)).toEqual([
      { citizenStatus: 'SC_PR', ageMin: 55, field: 'employeeRate', expected: 0.18, found: 0.16 },
    ]);
  });

  test('reports a stale OW ceiling', () => {
    const stale = [{ ...CANONICAL[0], owCeiling: 6800 }, CANONICAL[1]];
    expect(diffRateRows(CANONICAL, stale)).toEqual([
      { citizenStatus: 'SC_PR', ageMin: 0, field: 'owCeiling', expected: 8000, found: 6800 },
    ]);
  });

  test('reports a missing row', () => {
    expect(diffRateRows(CANONICAL, [CANONICAL[0]])).toEqual([
      { citizenStatus: 'SC_PR', ageMin: 55, field: 'row', expected: 'present', found: 'missing' },
    ]);
  });

  test('reports every differing field on one row', () => {
    const stale = [CANONICAL[0], { ...CANONICAL[1], employeeRate: 0.16, employerRate: 0.15 }];
    expect(diffRateRows(CANONICAL, stale)).toHaveLength(2);
  });

  test('an empty tenant table reports every row missing', () => {
    expect(diffRateRows(CANONICAL, [])).toHaveLength(2);
  });
});
