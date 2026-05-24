'use strict';
/**
 * Unit tests for src/engines/grant.engine.js (TRN-003)
 *
 * Covers:
 *   - computeApAmount       (hours × rate, default SGD 7.50)
 *   - computeEtsGrant       (fee × percentage, 0..1 validation)
 *   - computeSfecCoverage   (90% of OOP, capped at remaining balance)
 *   - validateSfcDeclaration (positive, sufficient balance)
 *   - formatSsgApExport     (pipe-delimited flat-file header + rows)
 */

const {
  AP_DEFAULT_RATE,
  SFEC_COVERAGE_PERCENT,
  SFEC_DEFAULT_TOTAL,
  computeApAmount,
  computeEtsGrant,
  computeSfecCoverage,
  validateSfcDeclaration,
  formatSsgApExport,
} = require('../src/engines/grant.engine');

// ── Constants ─────────────────────────────────────────────────────────────────
describe('constants', () => {
  test('default AP rate is SGD 7.50/hr', () => {
    expect(AP_DEFAULT_RATE).toBe(7.5);
  });
  test('SFEC covers 90%', () => {
    expect(SFEC_COVERAGE_PERCENT).toBe(0.9);
  });
  test('default SFEC total is SGD 10,000', () => {
    expect(SFEC_DEFAULT_TOTAL).toBe(10000);
  });
});

// ── computeApAmount ───────────────────────────────────────────────────────────
describe('computeApAmount', () => {
  test('8 hours × default rate = SGD 60', () => {
    expect(computeApAmount(8)).toBe(60);
  });
  test('custom rate honoured', () => {
    expect(computeApAmount(10, 5)).toBe(50);
  });
  test('fractional hours rounded to 2dp', () => {
    expect(computeApAmount(2.5, 7.5)).toBe(18.75);
  });
  test('zero hours returns 0', () => {
    expect(computeApAmount(0)).toBe(0);
  });
  test('negative hours returns 0', () => {
    expect(computeApAmount(-5)).toBe(0);
  });
  test('non-numeric input returns 0', () => {
    expect(computeApAmount('abc')).toBe(0);
    expect(computeApAmount(null)).toBe(0);
    expect(computeApAmount(undefined)).toBe(0);
  });
});

// ── computeEtsGrant ───────────────────────────────────────────────────────────
describe('computeEtsGrant', () => {
  test('70% of SGD 1000 fee = SGD 700', () => {
    expect(computeEtsGrant(1000, 0.7)).toBe(700);
  });
  test('90% with ETS top-up', () => {
    expect(computeEtsGrant(2000, 0.9)).toBe(1800);
  });
  test('rejects percentage > 1', () => {
    expect(computeEtsGrant(1000, 1.5)).toBe(0);
  });
  test('rejects negative percentage', () => {
    expect(computeEtsGrant(1000, -0.5)).toBe(0);
  });
  test('rejects negative fee', () => {
    expect(computeEtsGrant(-500, 0.7)).toBe(0);
  });
  test('rounds to 2 dp', () => {
    expect(computeEtsGrant(333.33, 0.7)).toBe(233.33);
  });
});

// ── computeSfecCoverage ──────────────────────────────────────────────────────
describe('computeSfecCoverage', () => {
  test('90% of OOP when balance sufficient', () => {
    expect(computeSfecCoverage(1000, 10000)).toBe(900);
  });
  test('capped at remaining balance', () => {
    expect(computeSfecCoverage(5000, 1500)).toBe(1500);
  });
  test('zero balance returns 0', () => {
    expect(computeSfecCoverage(1000, 0)).toBe(0);
  });
  test('zero OOP returns 0', () => {
    expect(computeSfecCoverage(0, 5000)).toBe(0);
  });
  test('negative inputs return 0', () => {
    expect(computeSfecCoverage(-100, 5000)).toBe(0);
    expect(computeSfecCoverage(1000, -100)).toBe(0);
  });
  test('exact full-balance scenario', () => {
    // 90% of 1500 = 1350; balance = 1350 → returns 1350
    expect(computeSfecCoverage(1500, 1350)).toBe(1350);
  });
});

// ── validateSfcDeclaration ────────────────────────────────────────────────────
describe('validateSfcDeclaration', () => {
  test('valid declaration within balance', () => {
    const r = validateSfcDeclaration(200, 500);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(300);
  });
  test('declaration equals balance', () => {
    const r = validateSfcDeclaration(500, 500);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
  });
  test('rejects insufficient balance', () => {
    const r = validateSfcDeclaration(600, 500);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Insufficient/);
  });
  test('rejects zero/negative amount', () => {
    expect(validateSfcDeclaration(0, 500).ok).toBe(false);
    expect(validateSfcDeclaration(-100, 500).ok).toBe(false);
  });
  test('rejects non-numeric', () => {
    expect(validateSfcDeclaration('abc', 500).ok).toBe(false);
  });
});

// ── formatSsgApExport ─────────────────────────────────────────────────────────
describe('formatSsgApExport', () => {
  test('header line is present and pipe-delimited', () => {
    const out = formatSsgApExport([], '2026-05-01', '2026-05-31');
    expect(out).toMatch(/NRIC\|EmployeeName\|CourseCode/);
    expect(out.split('\n').length).toBe(1); // only header
  });

  test('writes one row per claim with computed AP amount', () => {
    const rows = [
      { nric: 'S1234567A', employeeName: 'Alice Tan',  ssgCourseCode: 'TGS-001', trainingHours: 8, hourlyRate: 7.5 },
      { nric: 'S7654321B', employeeName: 'Bob Lee',    ssgCourseCode: 'TGS-002', trainingHours: 4, hourlyRate: 7.5 },
    ];
    const out = formatSsgApExport(rows, '2026-05-01', '2026-05-31');
    const lines = out.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[1]).toContain('S1234567A');
    expect(lines[1]).toContain('TGS-001');
    expect(lines[1]).toContain('60.00'); // 8 × 7.5
    expect(lines[2]).toContain('30.00'); // 4 × 7.5
  });

  test('sanitises pipe characters from name', () => {
    const rows = [{ nric: 'S1', employeeName: 'Alice|Tan', ssgCourseCode: 'TGS-001', trainingHours: 1, hourlyRate: 7.5 }];
    const out = formatSsgApExport(rows, '2026-05-01', '2026-05-31');
    expect(out).not.toMatch(/Alice\|Tan/);
    expect(out).toMatch(/Alice Tan/);
  });

  test('defaults missing rate to AP_DEFAULT_RATE', () => {
    const rows = [{ nric: 'S1', employeeName: 'A', ssgCourseCode: 'TGS-001', trainingHours: 2 }];
    const out = formatSsgApExport(rows, '2026-05-01', '2026-05-31');
    expect(out).toContain('15.00'); // 2 × 7.5
  });
});
