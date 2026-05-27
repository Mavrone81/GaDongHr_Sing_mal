'use strict';

const {
  ageYears,
  computeChildEntitlements,
  youngestChild,
  computeEmployeeEntitlements,
  ageBracketLabel,
  LEAVE_TYPE_SEEDS,
  CODES,
} = require('../src/engines/ccl.engine');

const REF = new Date('2026-06-01'); // fixed reference date for all tests

// ── ageYears ─────────────────────────────────────────────────────────────────

test('CE-01 ageYears exact birthday today = 0', () => {
  expect(ageYears(new Date('2026-06-01'), REF)).toBe(0);
});

test('CE-02 ageYears birthday yesterday = 0', () => {
  expect(ageYears(new Date('2026-05-31'), REF)).toBe(0);
});

test('CE-03 ageYears 1 year ago exact = 1', () => {
  expect(ageYears(new Date('2025-06-01'), REF)).toBe(1);
});

test('CE-04 ageYears birthday tomorrow in prior year = 0 (not yet had birthday)', () => {
  expect(ageYears(new Date('2025-06-02'), REF)).toBe(0);
});

test('CE-05 ageYears 7 years ago = 7', () => {
  expect(ageYears(new Date('2019-06-01'), REF)).toBe(7);
});

test('CE-06 ageYears 12 years ago = 12', () => {
  expect(ageYears(new Date('2014-06-01'), REF)).toBe(12);
});

test('CE-07 ageYears 13 years ago = 13', () => {
  expect(ageYears(new Date('2013-06-01'), REF)).toBe(13);
});

// ── computeChildEntitlements — < 2 years ─────────────────────────────────────

test('CE-08 SC child < 2 years → CCL=6 + UICL=12', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2025-06-01', citizenship: 'SC' }, REF);
  expect(result).toEqual(expect.arrayContaining([
    { code: 'CCL', days: 6 },
    { code: 'UICL', days: 12 },
  ]));
  expect(result).toHaveLength(2);
});

test('CE-09 PR child < 2 years → CCL=2 only', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2025-06-01', citizenship: 'PR' }, REF);
  expect(result).toEqual([{ code: 'CCL', days: 2 }]);
});

test('CE-10 Foreigner child < 2 years → CCL=2 only', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2025-06-01', citizenship: 'FOREIGNER' }, REF);
  expect(result).toEqual([{ code: 'CCL', days: 2 }]);
});

// ── computeChildEntitlements — 2 to < 7 years ────────────────────────────────

test('CE-11 SC child exactly age 2 → CCL=6', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2024-06-01', citizenship: 'SC' }, REF);
  expect(result).toEqual([{ code: 'CCL', days: 6 }]);
});

test('CE-12 SC child age 6 → CCL=6', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2020-06-01', citizenship: 'SC' }, REF);
  expect(result).toEqual([{ code: 'CCL', days: 6 }]);
});

test('CE-13 PR child age 4 → CCL=2', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2022-06-01', citizenship: 'PR' }, REF);
  expect(result).toEqual([{ code: 'CCL', days: 2 }]);
});

test('CE-14 Foreigner child age 5 → CCL=2', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2021-06-01', citizenship: 'FOREIGNER' }, REF);
  expect(result).toEqual([{ code: 'CCL', days: 2 }]);
});

// ── computeChildEntitlements — 7 to 12 years ─────────────────────────────────

test('CE-15 SC child age 7 → ECL=2', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2019-06-01', citizenship: 'SC' }, REF);
  expect(result).toEqual([{ code: 'ECL', days: 2 }]);
});

test('CE-16 SC child age 12 → ECL=2', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2014-06-01', citizenship: 'SC' }, REF);
  expect(result).toEqual([{ code: 'ECL', days: 2 }]);
});

test('CE-17 PR child age 10 → no entitlement', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2016-06-01', citizenship: 'PR' }, REF);
  expect(result).toEqual([]);
});

test('CE-18 Foreigner child age 8 → no entitlement', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2018-06-01', citizenship: 'FOREIGNER' }, REF);
  expect(result).toEqual([]);
});

// ── computeChildEntitlements — ≥ 13 years ────────────────────────────────────

test('CE-19 SC child age 13 → no entitlement', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2013-06-01', citizenship: 'SC' }, REF);
  expect(result).toEqual([]);
});

test('CE-20 SC child age 20 → no entitlement', () => {
  const result = computeChildEntitlements({ dateOfBirth: '2006-06-01', citizenship: 'SC' }, REF);
  expect(result).toEqual([]);
});

// ── youngestChild ─────────────────────────────────────────────────────────────

test('CE-21 youngestChild empty array → null', () => {
  expect(youngestChild([])).toBeNull();
});

test('CE-22 youngestChild null → null', () => {
  expect(youngestChild(null)).toBeNull();
});

test('CE-23 youngestChild single → that child', () => {
  const c = { id: '1', dateOfBirth: '2023-01-01' };
  expect(youngestChild([c])).toBe(c);
});

test('CE-24 youngestChild picks most recent DOB', () => {
  const older  = { id: '1', dateOfBirth: '2020-01-01' };
  const younger = { id: '2', dateOfBirth: '2023-06-15' };
  const oldest  = { id: '3', dateOfBirth: '2018-03-10' };
  expect(youngestChild([older, younger, oldest])).toBe(younger);
});

// ── computeEmployeeEntitlements ───────────────────────────────────────────────

test('CE-25 no verified children → empty entitlements', () => {
  const result = computeEmployeeEntitlements([], REF);
  expect(result.entitlements).toEqual([]);
  expect(result.youngest).toBeNull();
  expect(result.ageYears).toBeNull();
});

test('CE-26 youngest child SC < 2 → CCL=6 + UICL=12', () => {
  const children = [
    { id: '1', dateOfBirth: '2025-01-01', citizenship: 'SC' }, // age 1
    { id: '2', dateOfBirth: '2022-01-01', citizenship: 'SC' }, // age 4
  ];
  const { entitlements, youngest, ageYears: age } = computeEmployeeEntitlements(children, REF);
  expect(youngest.id).toBe('1');
  expect(age).toBe(1);
  expect(entitlements).toEqual(expect.arrayContaining([
    { code: 'CCL',  days: 6 },
    { code: 'UICL', days: 12 },
  ]));
});

test('CE-27 youngest child PR age 3 → CCL=2', () => {
  const children = [{ id: '1', dateOfBirth: '2023-01-01', citizenship: 'PR' }]; // age ~3
  const { entitlements } = computeEmployeeEntitlements(children, REF);
  expect(entitlements).toEqual([{ code: 'CCL', days: 2 }]);
});

test('CE-28 youngest child SC age 12 → ECL=2', () => {
  const children = [{ id: '1', dateOfBirth: '2014-01-01', citizenship: 'SC' }]; // age 12
  const { entitlements } = computeEmployeeEntitlements(children, REF);
  expect(entitlements).toEqual([{ code: 'ECL', days: 2 }]);
});

test('CE-29 youngest child age 13 → no entitlement', () => {
  const children = [{ id: '1', dateOfBirth: '2013-01-01', citizenship: 'SC' }];
  const { entitlements } = computeEmployeeEntitlements(children, REF);
  expect(entitlements).toEqual([]);
});

// ── ageBracketLabel ───────────────────────────────────────────────────────────

test('CE-30 ageBracketLabel 0 → < 2 years', () => {
  expect(ageBracketLabel(0)).toBe('< 2 years');
});
test('CE-31 ageBracketLabel 1 → < 2 years', () => {
  expect(ageBracketLabel(1)).toBe('< 2 years');
});
test('CE-32 ageBracketLabel 2 → 2 to < 7 years', () => {
  expect(ageBracketLabel(2)).toBe('2 to < 7 years');
});
test('CE-33 ageBracketLabel 6 → 2 to < 7 years', () => {
  expect(ageBracketLabel(6)).toBe('2 to < 7 years');
});
test('CE-34 ageBracketLabel 7 → 7 to 12 years', () => {
  expect(ageBracketLabel(7)).toBe('7 to 12 years');
});
test('CE-35 ageBracketLabel 12 → 7 to 12 years', () => {
  expect(ageBracketLabel(12)).toBe('7 to 12 years');
});
test('CE-36 ageBracketLabel 13 → ≥ 13 years (no entitlement)', () => {
  expect(ageBracketLabel(13)).toMatch(/≥ 13/);
});
test('CE-37 ageBracketLabel null → Unknown', () => {
  expect(ageBracketLabel(null)).toBe('Unknown');
});

// ── LEAVE_TYPE_SEEDS completeness ─────────────────────────────────────────────

test('CE-38 LEAVE_TYPE_SEEDS has CCL, UICL, ECL entries', () => {
  expect(LEAVE_TYPE_SEEDS).toHaveProperty('CCL');
  expect(LEAVE_TYPE_SEEDS).toHaveProperty('UICL');
  expect(LEAVE_TYPE_SEEDS).toHaveProperty('ECL');
});

test('CE-39 UICL seed isPaid=false', () => {
  expect(LEAVE_TYPE_SEEDS.UICL.isPaid).toBe(false);
});

test('CE-40 CCL and ECL seeds isPaid=true', () => {
  expect(LEAVE_TYPE_SEEDS.CCL.isPaid).toBe(true);
  expect(LEAVE_TYPE_SEEDS.ECL.isPaid).toBe(true);
});
