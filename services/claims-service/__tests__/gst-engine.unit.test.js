'use strict';
/**
 * Unit tests for CLM-004 gst.engine.js — pure functions, no DB.
 */

const {
  GST_RATE,
  validateGstNumber,
  checkRegistryMatch,
  aggregateGstByPeriod,
  aggregateByCostCentre,
  aggregateByCategory,
  rankTopClaimants,
  computeCategoryBudgetUtilisation,
} = require('../src/engines/gst.engine');

describe('GST_RATE constant', () => {
  test('matches IRAS 2026 9% rate', () => {
    expect(GST_RATE).toBe(0.09);
  });
});

describe('validateGstNumber', () => {
  test('accepts standard 9-char GSTN (M12345678X)', () => {
    const r = validateGstNumber('M12345678X');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('M12345678X');
  });
  test('accepts lowercase + whitespace + hyphens', () => {
    const r = validateGstNumber(' m1234-5678x ');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('M12345678X');
  });
  test('accepts post-2009 UEN form (T07LL1234X)', () => {
    expect(validateGstNumber('T07LL1234X').valid).toBe(true);
  });
  test('accepts pre-2009 UEN form (200012345A)', () => {
    expect(validateGstNumber('200012345A').valid).toBe(true);
  });
  test('rejects empty/null', () => {
    expect(validateGstNumber(null).valid).toBe(false);
    expect(validateGstNumber('').valid).toBe(false);
    expect(validateGstNumber(null).reason).toBe('empty');
  });
  test('rejects too-short / wrong shape', () => {
    expect(validateGstNumber('ABC').valid).toBe(false);
    expect(validateGstNumber('M12345678').valid).toBe(false); // missing check letter
    expect(validateGstNumber('1234567890').valid).toBe(false); // all digits
  });
});

describe('checkRegistryMatch', () => {
  const registry = [
    { gstNumber: 'M12345678X', vendorName: 'Acme Pte Ltd', isActive: true,  effectiveFrom: new Date('2020-01-01') },
    { gstNumber: 'M99999999Z', vendorName: 'Old Vendor',   isActive: true,  effectiveFrom: new Date('2015-01-01'), effectiveTo: new Date('2024-12-31') },
    { gstNumber: 'M88888888Y', vendorName: 'Inactive',     isActive: false, effectiveFrom: new Date('2020-01-01') },
  ];

  test('matches active vendor', () => {
    const r = checkRegistryMatch('M12345678X', new Date('2026-05-01'), registry);
    expect(r.valid).toBe(true);
    expect(r.vendor.vendorName).toBe('Acme Pte Ltd');
  });
  test('matches case-insensitively after normalisation', () => {
    const r = checkRegistryMatch(' m12345678x ', new Date('2026-05-01'), registry);
    expect(r.valid).toBe(true);
  });
  test('rejects vendor whose effectiveTo has passed', () => {
    const r = checkRegistryMatch('M99999999Z', new Date('2026-05-01'), registry);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('not_in_registry');
  });
  test('rejects inactive vendor', () => {
    const r = checkRegistryMatch('M88888888Y', new Date('2026-05-01'), registry);
    expect(r.valid).toBe(false);
  });
  test('rejects invalid format before registry check', () => {
    const r = checkRegistryMatch('NOPE', new Date('2026-05-01'), registry);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('invalid_format');
  });
  test('rejects empty number', () => {
    const r = checkRegistryMatch(null, new Date('2026-05-01'), registry);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('empty');
  });
  test('rejects vendor whose effectiveFrom is in future', () => {
    const future = [{ gstNumber: 'M11111111A', vendorName: 'Future', isActive: true, effectiveFrom: new Date('2030-01-01') }];
    const r = checkRegistryMatch('M11111111A', new Date('2026-05-01'), future);
    expect(r.valid).toBe(false);
  });
});

// ── Aggregators ─────────────────────────────────────────────────────────────

const SAMPLE_CLAIMS = [
  { id: 'c1', employeeId: 'e1', categoryId: 'cat-1', payrollPeriod: '2026-05', costCentre: 'CC-A', totalAmount: 1090, gstAmount: 90 },
  { id: 'c2', employeeId: 'e1', categoryId: 'cat-1', payrollPeriod: '2026-05', costCentre: 'CC-A', totalAmount: 218,  gstAmount: 18 },
  { id: 'c3', employeeId: 'e2', categoryId: 'cat-2', payrollPeriod: '2026-05', costCentre: 'CC-B', totalAmount: 545,  gstAmount: 45 },
  { id: 'c4', employeeId: 'e3', categoryId: 'cat-1', payrollPeriod: '2026-04', costCentre: null,    totalAmount: 100,  gstAmount: 0 },
  { id: 'c5', employeeId: 'e2', categoryId: 'cat-1', payrollPeriod: null,      costCentre: 'CC-B', totalAmount: 50,   gstAmount: 0 },
];

describe('aggregateGstByPeriod', () => {
  test('groups by payrollPeriod with UNASSIGNED bucket', () => {
    const rows = aggregateGstByPeriod(SAMPLE_CLAIMS);
    const by = Object.fromEntries(rows.map(r => [r.period, r]));
    expect(by['2026-05'].totalGst).toBeCloseTo(153, 2);
    expect(by['2026-04'].totalGst).toBe(0);
    expect(by['UNASSIGNED'].claimCount).toBe(1);
  });
  test('returns ascending period order', () => {
    const rows = aggregateGstByPeriod(SAMPLE_CLAIMS);
    expect(rows[0].period).toBe('2026-04');
  });
});

describe('aggregateByCostCentre', () => {
  test('groups by costCentre with UNALLOCATED bucket, descending', () => {
    const rows = aggregateByCostCentre(SAMPLE_CLAIMS);
    expect(rows[0].costCentre).toBe('CC-A');
    expect(rows[0].totalAmount).toBeCloseTo(1308, 2);
    const cc = Object.fromEntries(rows.map(r => [r.costCentre, r]));
    expect(cc['UNALLOCATED'].claimCount).toBe(1);
  });
});

describe('aggregateByCategory', () => {
  test('enriches with categoryCode + name from lookup', () => {
    const lookup = new Map([
      ['cat-1', { id: 'cat-1', code: 'TRAVEL', name: 'Travel' }],
      ['cat-2', { id: 'cat-2', code: 'MEAL',   name: 'Meal'   }],
    ]);
    const rows = aggregateByCategory(SAMPLE_CLAIMS, lookup);
    const cat1 = rows.find(r => r.categoryId === 'cat-1');
    expect(cat1.categoryCode).toBe('TRAVEL');
    expect(cat1.claimCount).toBe(4);
    expect(cat1.totalAmount).toBeCloseTo(1458, 2);
  });
  test('handles object-style lookup (plain {})', () => {
    const rows = aggregateByCategory(SAMPLE_CLAIMS, { 'cat-1': { code: 'TRAVEL', name: 'Travel' } });
    expect(rows.find(r => r.categoryId === 'cat-1').categoryCode).toBe('TRAVEL');
  });
});

describe('rankTopClaimants', () => {
  test('orders by totalAmount descending', () => {
    const top = rankTopClaimants(SAMPLE_CLAIMS, 5);
    expect(top[0].employeeId).toBe('e1');
    expect(top[0].totalAmount).toBeCloseTo(1308, 2);
    expect(top[1].employeeId).toBe('e2');
  });
  test('honours limit', () => {
    expect(rankTopClaimants(SAMPLE_CLAIMS, 1)).toHaveLength(1);
  });
  test('tie-break: claimCount desc, then employeeId asc', () => {
    const claims = [
      { employeeId: 'b', totalAmount: 100 },
      { employeeId: 'a', totalAmount: 100, },
      { employeeId: 'a', totalAmount: 0 }, // a wins via claimCount tiebreak
    ];
    const top = rankTopClaimants(claims, 5);
    expect(top[0].employeeId).toBe('a');
  });
});

describe('computeCategoryBudgetUtilisation', () => {
  const budgets = [
    { categoryId: 'cat-1', period: '2026-05', budgetAmount: 1000 },
    { categoryId: 'cat-2', period: '2026-05', budgetAmount: 5000 },
    { categoryId: 'cat-3', period: '2026-05', budgetAmount: 200 },
  ];
  const claims = [
    { categoryId: 'cat-1', payrollPeriod: '2026-05', totalAmount: 900 }, // OK
    { categoryId: 'cat-1', payrollPeriod: '2026-05', totalAmount: 50 },  // → spent 950, > 85% = APPROACHING
    { categoryId: 'cat-2', payrollPeriod: '2026-05', totalAmount: 6000 },// BREACH
    { categoryId: 'cat-9', payrollPeriod: '2026-05', totalAmount: 75 },  // UNBUDGETED
  ];
  test('classifies OK / APPROACHING / BREACH', () => {
    const rows = computeCategoryBudgetUtilisation(claims, budgets);
    const c1 = rows.find(r => r.categoryId === 'cat-1');
    const c2 = rows.find(r => r.categoryId === 'cat-2');
    const c3 = rows.find(r => r.categoryId === 'cat-3');
    expect(c1.status).toBe('APPROACHING');
    expect(c1.spent).toBe(950);
    expect(c1.remaining).toBe(50);
    expect(c2.status).toBe('BREACH');
    expect(c3.status).toBe('OK');
    expect(c3.spent).toBe(0);
  });
  test('emits UNBUDGETED row for unbudgeted spend', () => {
    const rows = computeCategoryBudgetUtilisation(claims, budgets);
    const unbudgeted = rows.find(r => r.categoryId === 'cat-9');
    expect(unbudgeted.status).toBe('UNBUDGETED');
    expect(unbudgeted.spent).toBe(75);
    expect(unbudgeted.remaining).toBe(-75);
  });
  test('handles empty claims (all budgeted rows show 0 spend)', () => {
    const rows = computeCategoryBudgetUtilisation([], budgets);
    expect(rows).toHaveLength(3);
    expect(rows.every(r => r.spent === 0)).toBe(true);
  });
});
