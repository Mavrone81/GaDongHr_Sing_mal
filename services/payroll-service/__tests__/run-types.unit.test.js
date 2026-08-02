'use strict';
/**
 * PAY-001 — Pure-function unit tests for run-type helpers.
 *
 * Covers:
 *   - isSupplemental / isBiMonthly
 *   - computePeriodBoundaries: MONTHLY full month, BIMONTHLY FIRST (1-15),
 *     BIMONTHLY SECOND (16-end), Feb edge (28/29 days), throws on bad input
 *   - trimSupplementalEmployee: zeroes OW/AW/grossPay, carries YTDs
 *   - validateRunTypeShape: BIMONTHLY needs periodHalf; others reject periodHalf
 */

const {
  SUPPLEMENTAL_TYPES, PRIMARY_TYPES, PERIOD_HALVES,
  isSupplemental, isBiMonthly,
  computePeriodBoundaries, trimSupplementalEmployee, validateRunTypeShape,
} = require('../src/engines/run-types');

describe('run-types — category predicates', () => {
  test('R1 isSupplemental: ADHOC/BONUS/COMMISSION → true; MONTHLY/BIMONTHLY/FINAL_PAY → false', () => {
    expect(isSupplemental('ADHOC')).toBe(true);
    expect(isSupplemental('BONUS')).toBe(true);
    expect(isSupplemental('COMMISSION')).toBe(true);
    expect(isSupplemental('MONTHLY')).toBe(false);
    expect(isSupplemental('BIMONTHLY')).toBe(false);
    expect(isSupplemental('FINAL_PAY')).toBe(false);
  });

  test('R2 isBiMonthly: only BIMONTHLY → true', () => {
    expect(isBiMonthly('BIMONTHLY')).toBe(true);
    expect(isBiMonthly('MONTHLY')).toBe(false);
    expect(isBiMonthly('ADHOC')).toBe(false);
  });

  test('R3 exported lists are non-empty and disjoint', () => {
    expect(SUPPLEMENTAL_TYPES.length).toBeGreaterThan(0);
    expect(PRIMARY_TYPES.length).toBeGreaterThan(0);
    expect(PERIOD_HALVES).toEqual(['FIRST', 'SECOND']);
    const overlap = SUPPLEMENTAL_TYPES.filter(t => PRIMARY_TYPES.includes(t));
    expect(overlap).toEqual([]);
  });
});

describe('run-types — computePeriodBoundaries', () => {
  // Boundaries are UTC-anchored (see computePeriodBoundaries). Assert with the
  // getUTC accessors: local getters would read a different calendar date west
  // of UTC and make these assertions timezone-dependent.
  test('R4 MONTHLY: full month boundaries (May 2026 → 1 to 31, 31 days)', () => {
    const b = computePeriodBoundaries('2026-05', 'MONTHLY', null);
    expect(b.periodStart.getUTCDate()).toBe(1);
    expect(b.periodStart.getUTCMonth()).toBe(4); // May = index 4
    expect(b.periodEnd.getUTCDate()).toBe(31);
    expect(b.daysInMonth).toBe(31);
    expect(b.halfLabel).toBeNull();
  });

  test('R5 BIMONTHLY FIRST: days 1-15', () => {
    const b = computePeriodBoundaries('2026-05', 'BIMONTHLY', 'FIRST');
    expect(b.periodStart.getUTCDate()).toBe(1);
    expect(b.periodEnd.getUTCDate()).toBe(15);
    expect(b.halfLabel).toBe('FIRST');
  });

  test('R6 BIMONTHLY SECOND: days 16 to end-of-month', () => {
    const b = computePeriodBoundaries('2026-05', 'BIMONTHLY', 'SECOND');
    expect(b.periodStart.getUTCDate()).toBe(16);
    expect(b.periodEnd.getUTCDate()).toBe(31);
    expect(b.halfLabel).toBe('SECOND');
  });

  test('R7 BIMONTHLY SECOND Feb leap-year (2024-02) ends Feb 29', () => {
    const b = computePeriodBoundaries('2024-02', 'BIMONTHLY', 'SECOND');
    expect(b.periodStart.getUTCDate()).toBe(16);
    expect(b.periodEnd.getUTCDate()).toBe(29);
    expect(b.daysInMonth).toBe(29);
  });

  test('R8 BIMONTHLY SECOND Feb non-leap (2026-02) ends Feb 28', () => {
    const b = computePeriodBoundaries('2026-02', 'BIMONTHLY', 'SECOND');
    expect(b.periodEnd.getUTCDate()).toBe(28);
    expect(b.daysInMonth).toBe(28);
  });

  test('R9 BIMONTHLY without periodHalf throws', () => {
    expect(() => computePeriodBoundaries('2026-05', 'BIMONTHLY', null)).toThrow(/FIRST or SECOND/);
    expect(() => computePeriodBoundaries('2026-05', 'BIMONTHLY', 'MIDDLE')).toThrow(/FIRST or SECOND/);
  });

  test('R10 bad period string throws', () => {
    expect(() => computePeriodBoundaries('hello', 'MONTHLY', null)).toThrow(/Invalid period/);
    expect(() => computePeriodBoundaries('2026-13', 'MONTHLY', null)).toThrow(/Invalid period/);
    expect(() => computePeriodBoundaries('2026-00', 'MONTHLY', null)).toThrow(/Invalid period/);
  });

  test('R11 ADHOC ignores periodHalf and returns full month', () => {
    const b = computePeriodBoundaries('2026-05', 'ADHOC', null);
    expect(b.periodStart.getUTCDate()).toBe(1);
    expect(b.periodEnd.getUTCDate()).toBe(31);
    expect(b.halfLabel).toBeNull();
  });
});

describe('run-types — trimSupplementalEmployee', () => {
  test('R12 zeroes OW/AW/grossPay and carries YTDs from prior', () => {
    const emp = {
      employeeId: 'E1', ow: 5000, aw: 1000, grossPay: 5000,
      ytdOw: 1000, ytdEmployeeCpf: 200, ytdEmployerCpf: 170,
    };
    const prior = {
      basicSalary: 5000, grossPay: 5000,
      ytdGross: 25000, ytdEmployeeCpf: 5000, ytdEmployerCpf: 4250,
    };
    trimSupplementalEmployee(emp, prior);
    expect(emp.ow).toBe(0);
    expect(emp.aw).toBe(0);
    expect(emp.grossPay).toBe(0);
    expect(emp.ytdOw).toBe(25000);
    expect(emp.ytdEmployeeCpf).toBe(5000);
    expect(emp.ytdEmployerCpf).toBe(4250);
  });

  test('R13 no prior: emp unchanged', () => {
    const emp = { ow: 5000, aw: 0, grossPay: 5000, ytdOw: 0 };
    const ret = trimSupplementalEmployee(emp, null);
    expect(ret.ow).toBe(5000);
    expect(ret.grossPay).toBe(5000);
  });

  test('R14 missing YTDs in prior default to emp value or 0', () => {
    const emp = { ow: 5000, ytdEmployeeCpf: 100 };
    trimSupplementalEmployee(emp, { ytdGross: 9999 });
    expect(emp.ow).toBe(0);
    expect(emp.ytdOw).toBe(9999);
    // ytdEmployeeCpf from prior is undefined → fall back to emp's existing 100
    expect(emp.ytdEmployeeCpf).toBe(100);
    expect(emp.ytdEmployerCpf).toBe(0); // emp had no value → 0
  });
});

describe('run-types — validateRunTypeShape', () => {
  test('R15 BIMONTHLY needs periodHalf', () => {
    expect(validateRunTypeShape('BIMONTHLY', null)).toMatch(/periodHalf/);
    expect(validateRunTypeShape('BIMONTHLY', '')).toMatch(/periodHalf/);
    expect(validateRunTypeShape('BIMONTHLY', 'BOTH')).toMatch(/periodHalf/);
  });

  test('R16 BIMONTHLY with valid half → null', () => {
    expect(validateRunTypeShape('BIMONTHLY', 'FIRST')).toBeNull();
    expect(validateRunTypeShape('BIMONTHLY', 'SECOND')).toBeNull();
  });

  test('R17 non-BIMONTHLY with periodHalf is rejected', () => {
    expect(validateRunTypeShape('MONTHLY', 'FIRST')).toMatch(/only valid for BIMONTHLY/);
    expect(validateRunTypeShape('ADHOC', 'SECOND')).toMatch(/only valid for BIMONTHLY/);
  });

  test('R18 non-BIMONTHLY without periodHalf is accepted', () => {
    expect(validateRunTypeShape('MONTHLY', null)).toBeNull();
    expect(validateRunTypeShape('ADHOC', null)).toBeNull();
    expect(validateRunTypeShape('BONUS', '')).toBeNull();
  });
});
