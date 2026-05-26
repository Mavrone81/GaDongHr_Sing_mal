'use strict';
/**
 * Unit tests: Flexi-Benefits Wallet Engine (BEN-002)
 *
 * CAT-01  WALLET_CATEGORIES — has exactly 6 categories
 * CAT-02  WALLET_CATEGORIES — all entries have code, name, requiresReceipt
 * DEF-01  DEFAULT_GRADE_AMOUNTS — has expected grades with positive amounts
 *
 * CB-01   computeBalance — basic remaining = credited - used - pending
 * CB-02   computeBalance — no pending claims → pending=0
 * CB-03   computeBalance — multiple pending claims summed
 * CB-04   computeBalance — null wallet returns zeros
 * CB-05   computeBalance — rounds to 2 decimal places
 *
 * WE-01   isWalletExpired — past expiresAt → true
 * WE-02   isWalletExpired — future expiresAt → false
 * WE-03   isWalletExpired — status EXPIRED → true regardless of date
 * WE-04   isWalletExpired — null wallet → true (safe default)
 *
 * SA-01   shouldAutoApprove — amount below threshold → true
 * SA-02   shouldAutoApprove — amount above threshold → false
 * SA-03   shouldAutoApprove — amount equals threshold → true (boundary inclusive)
 * SA-04   shouldAutoApprove — null config → false
 * SA-05   shouldAutoApprove — zero threshold → false (disabled)
 *
 * YE-01   computeYearEndSummary — aggregates remaining by grade
 * YE-02   computeYearEndSummary — excludes EXPIRED wallets
 * YE-03   computeYearEndSummary — empty input returns zeros
 *
 * BD-01   buildWalletDashboard — totalCredited / totalUsed / totalRemaining
 * BD-02   buildWalletDashboard — byGrade aggregation
 * BD-03   buildWalletDashboard — byCategory skips CANCELLED and REJECTED claims
 * BD-04   buildWalletDashboard — empty inputs return zeros
 */

const {
  WALLET_CATEGORIES,
  DEFAULT_GRADE_AMOUNTS,
  computeBalance,
  isWalletExpired,
  shouldAutoApprove,
  computeYearEndSummary,
  buildWalletDashboard,
  walletExpiresAt,
} = require('../src/engines/flexi-wallet.engine');

// ── WALLET_CATEGORIES ────────────────────────────────────────────────────────
test('CAT-01 WALLET_CATEGORIES has exactly 6 categories', () => {
  expect(WALLET_CATEGORIES).toHaveLength(6);
});

test('CAT-02 all categories have code, name, requiresReceipt', () => {
  for (const cat of WALLET_CATEGORIES) {
    expect(typeof cat.code).toBe('string');
    expect(cat.code.length).toBeGreaterThan(0);
    expect(typeof cat.name).toBe('string');
    expect(cat.name.length).toBeGreaterThan(0);
    expect(typeof cat.requiresReceipt).toBe('boolean');
  }
  const codes = WALLET_CATEGORIES.map(c => c.code);
  expect(codes).toContain('GYM');
  expect(codes).toContain('DENTAL');
  expect(codes).toContain('OPTICAL');
  expect(codes).toContain('HEALTH_SCREENING');
  expect(codes).toContain('WELLNESS');
  expect(codes).toContain('PROFESSIONAL_DEVELOPMENT');
});

// ── DEFAULT_GRADE_AMOUNTS ─────────────────────────────────────────────────────
test('DEF-01 DEFAULT_GRADE_AMOUNTS has expected grades with positive amounts', () => {
  expect(DEFAULT_GRADE_AMOUNTS.STAFF).toBeGreaterThan(0);
  expect(DEFAULT_GRADE_AMOUNTS.MGR).toBeGreaterThan(DEFAULT_GRADE_AMOUNTS.STAFF);
  expect(DEFAULT_GRADE_AMOUNTS.DIR).toBeGreaterThanOrEqual(DEFAULT_GRADE_AMOUNTS.MGR);
});

// ── computeBalance ────────────────────────────────────────────────────────────
test('CB-01 basic remaining = credited - used - pending', () => {
  const wallet = { creditedAmount: 1000, usedAmount: 300, encashedAmount: 0, forfeitedAmount: 0, status: 'ACTIVE' };
  const pending = [{ claimAmount: 150 }];
  const b = computeBalance(wallet, pending);
  expect(b.credited).toBe(1000);
  expect(b.used).toBe(300);
  expect(b.pending).toBe(150);
  expect(b.remaining).toBe(550);
});

test('CB-02 no pending claims → pending=0', () => {
  const wallet = { creditedAmount: 800, usedAmount: 200, encashedAmount: 0, forfeitedAmount: 0, status: 'ACTIVE' };
  const b = computeBalance(wallet, []);
  expect(b.pending).toBe(0);
  expect(b.remaining).toBe(600);
});

test('CB-03 multiple pending claims summed', () => {
  const wallet = { creditedAmount: 1000, usedAmount: 100, encashedAmount: 0, forfeitedAmount: 0, status: 'ACTIVE' };
  const pending = [{ claimAmount: 80 }, { claimAmount: 120 }];
  const b = computeBalance(wallet, pending);
  expect(b.pending).toBe(200);
  expect(b.remaining).toBe(700);
});

test('CB-04 null wallet returns zeros', () => {
  const b = computeBalance(null, []);
  expect(b.credited).toBe(0);
  expect(b.remaining).toBe(0);
});

test('CB-05 rounds each input field before subtracting', () => {
  // Engine rounds creditedAmount and usedAmount to 2dp first, then subtracts
  // round2(100.005)=100.01, round2(33.333)=33.33 → remaining=round2(66.68)=66.68
  const wallet = { creditedAmount: 100.005, usedAmount: 33.333, encashedAmount: 0, forfeitedAmount: 0, status: 'ACTIVE' };
  const b = computeBalance(wallet, []);
  expect(b.credited).toBe(100.01);
  expect(b.used).toBe(33.33);
  expect(b.remaining).toBe(66.68);
});

// ── isWalletExpired ───────────────────────────────────────────────────────────
test('WE-01 past expiresAt → true', () => {
  const wallet = { status: 'ACTIVE', expiresAt: new Date('2025-12-31T15:59:59Z') };
  expect(isWalletExpired(wallet, new Date('2026-01-01T00:00:00Z'))).toBe(true);
});

test('WE-02 future expiresAt → false', () => {
  const wallet = { status: 'ACTIVE', expiresAt: new Date('2026-12-31T15:59:59Z') };
  expect(isWalletExpired(wallet, new Date('2026-06-01T00:00:00Z'))).toBe(false);
});

test('WE-03 status EXPIRED → true regardless of date', () => {
  const wallet = { status: 'EXPIRED', expiresAt: new Date('2099-12-31T15:59:59Z') };
  expect(isWalletExpired(wallet, new Date('2026-01-01'))).toBe(true);
});

test('WE-04 null wallet → true (safe default)', () => {
  expect(isWalletExpired(null)).toBe(true);
});

// ── shouldAutoApprove ─────────────────────────────────────────────────────────
test('SA-01 amount below threshold → true', () => {
  expect(shouldAutoApprove(30, { autoApproveThreshold: 50 })).toBe(true);
});

test('SA-02 amount above threshold → false', () => {
  expect(shouldAutoApprove(75, { autoApproveThreshold: 50 })).toBe(false);
});

test('SA-03 amount equals threshold → true (boundary inclusive)', () => {
  expect(shouldAutoApprove(50, { autoApproveThreshold: 50 })).toBe(true);
});

test('SA-04 null config → false', () => {
  expect(shouldAutoApprove(20, null)).toBe(false);
});

test('SA-05 zero threshold → false (disabled)', () => {
  expect(shouldAutoApprove(5, { autoApproveThreshold: 0 })).toBe(false);
});

// ── computeYearEndSummary ─────────────────────────────────────────────────────
test('YE-01 aggregates remaining by grade', () => {
  const wallets = [
    { status: 'ACTIVE', employeeGrade: 'STAFF', creditedAmount: 500, usedAmount: 200 },
    { status: 'ACTIVE', employeeGrade: 'MGR',   creditedAmount: 1500, usedAmount: 500 },
    { status: 'ACTIVE', employeeGrade: 'STAFF', creditedAmount: 500,  usedAmount: 100 },
  ];
  const s = computeYearEndSummary(wallets);
  expect(s.totalWallets).toBe(3);
  expect(s.totalCredited).toBe(2500);
  expect(s.totalUsed).toBe(800);
  expect(s.totalRemaining).toBe(1700);
  expect(s.byGrade.STAFF.count).toBe(2);
  expect(s.byGrade.STAFF.remaining).toBe(700);
  expect(s.byGrade.MGR.remaining).toBe(1000);
});

test('YE-02 excludes EXPIRED wallets', () => {
  const wallets = [
    { status: 'ACTIVE',  employeeGrade: 'STAFF', creditedAmount: 500, usedAmount: 100 },
    { status: 'EXPIRED', employeeGrade: 'STAFF', creditedAmount: 500, usedAmount: 0   },
  ];
  const s = computeYearEndSummary(wallets);
  expect(s.totalWallets).toBe(1);
  expect(s.totalCredited).toBe(500);
});

test('YE-03 empty input returns zeros', () => {
  const s = computeYearEndSummary([]);
  expect(s.totalWallets).toBe(0);
  expect(s.totalRemaining).toBe(0);
});

// ── buildWalletDashboard ──────────────────────────────────────────────────────
test('BD-01 totalCredited / totalUsed / totalRemaining', () => {
  const wallets = [
    { employeeGrade: 'STAFF', creditedAmount: 500,  usedAmount: 200, forfeitedAmount: 0, encashedAmount: 0, status: 'ACTIVE' },
    { employeeGrade: 'MGR',   creditedAmount: 1500, usedAmount: 600, forfeitedAmount: 0, encashedAmount: 0, status: 'ACTIVE' },
  ];
  const d = buildWalletDashboard(wallets, []);
  expect(d.totalCredited).toBe(2000);
  expect(d.totalUsed).toBe(800);
  expect(d.totalRemaining).toBe(1200);
  expect(d.activeWallets).toBe(2);
});

test('BD-02 byGrade aggregation', () => {
  const wallets = [
    { employeeGrade: 'STAFF', creditedAmount: 500,  usedAmount: 100, forfeitedAmount: 0, encashedAmount: 0, status: 'ACTIVE' },
    { employeeGrade: 'STAFF', creditedAmount: 500,  usedAmount: 200, forfeitedAmount: 0, encashedAmount: 0, status: 'ACTIVE' },
    { employeeGrade: 'DIR',   creditedAmount: 2000, usedAmount: 500, forfeitedAmount: 0, encashedAmount: 0, status: 'EXPIRED' },
  ];
  const d = buildWalletDashboard(wallets, []);
  expect(d.byGrade.STAFF.wallets).toBe(2);
  expect(d.byGrade.STAFF.credited).toBe(1000);
  expect(d.byGrade.STAFF.used).toBe(300);
  expect(d.byGrade.STAFF.remaining).toBe(700);
  expect(d.byGrade.DIR.wallets).toBe(1);
});

test('BD-03 byCategory skips CANCELLED and REJECTED claims', () => {
  const claims = [
    { status: 'APPROVED',  categoryCode: 'GYM',    categoryName: 'Gym', claimAmount: 100, approvedAmount: 100 },
    { status: 'CANCELLED', categoryCode: 'GYM',    categoryName: 'Gym', claimAmount: 50  },
    { status: 'REJECTED',  categoryCode: 'DENTAL',  categoryName: 'Dental', claimAmount: 80 },
    { status: 'PENDING',   categoryCode: 'OPTICAL', categoryName: 'Optical', claimAmount: 40 },
  ];
  const d = buildWalletDashboard([], claims);
  expect(d.byCategory.GYM.claims).toBe(1);          // only APPROVED counted
  expect(d.byCategory.OPTICAL.claims).toBe(1);       // PENDING counted
  expect(d.byCategory.DENTAL).toBeUndefined();       // REJECTED excluded
});

test('BD-04 empty inputs return zeros', () => {
  const d = buildWalletDashboard([], []);
  expect(d.totalCredited).toBe(0);
  expect(d.totalUsed).toBe(0);
  expect(d.activeWallets).toBe(0);
});
