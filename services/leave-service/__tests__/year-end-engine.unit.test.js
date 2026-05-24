'use strict';
/**
 * Unit tests for LEA-007 carry-forward + expiry engine.
 */
const {
  computeCarryForward, defaultExpiryFor, resolveExpiry, evaluateExpiry,
} = require('../src/engines/year-end.engine');

describe('computeCarryForward()', () => {
  test('unused = entitled + carryIn − used − pending; capped by maxCarryForward', () => {
    const r = computeCarryForward(
      { entitledDays: 14, carryForward: 3, usedDays: 8, pendingDays: 1 },
      { maxCarryForward: 7 },
    );
    // unused = 14 + 3 − 8 − 1 = 8, capped at 7 → forfeit 1
    expect(r.unusedBalance).toBe(8);
    expect(r.carriedForward).toBe(7);
    expect(r.forfeited).toBe(1);
  });

  test('zero unused — nothing carried, nothing forfeited', () => {
    const r = computeCarryForward(
      { entitledDays: 14, carryForward: 0, usedDays: 14, pendingDays: 0 },
      { maxCarryForward: 7 },
    );
    expect(r.unusedBalance).toBe(0);
    expect(r.carriedForward).toBe(0);
    expect(r.forfeited).toBe(0);
  });

  test('over-used entitlement (negative balance) clamps to zero', () => {
    const r = computeCarryForward(
      { entitledDays: 7, carryForward: 0, usedDays: 9, pendingDays: 0 },
      { maxCarryForward: 5 },
    );
    expect(r.unusedBalance).toBe(0);
    expect(r.carriedForward).toBe(0);
  });

  test('maxCarryForward = 0 → entire unused balance forfeited', () => {
    const r = computeCarryForward(
      { entitledDays: 10, carryForward: 0, usedDays: 3, pendingDays: 0 },
      { maxCarryForward: 0 },
    );
    expect(r.unusedBalance).toBe(7);
    expect(r.carriedForward).toBe(0);
    expect(r.forfeited).toBe(7);
  });

  test('maxCarryForward < 0 treated as unlimited', () => {
    const r = computeCarryForward(
      { entitledDays: 14, carryForward: 0, usedDays: 0, pendingDays: 0 },
      { maxCarryForward: -1 },
    );
    expect(r.carriedForward).toBe(14);
    expect(r.forfeited).toBe(0);
  });

  test('fractional days rounded to 2 decimals', () => {
    const r = computeCarryForward(
      { entitledDays: 14, carryForward: 0, usedDays: 6.5, pendingDays: 0.25 },
      { maxCarryForward: 7 },
    );
    // unused = 14 − 6.5 − 0.25 = 7.25, capped 7 → forfeit 0.25
    expect(r.unusedBalance).toBeCloseTo(7.25, 2);
    expect(r.carriedForward).toBe(7);
    expect(r.forfeited).toBe(0.25);
  });
});

describe('defaultExpiryFor() — 31 Dec 23:59:59 SGT', () => {
  test('returns the UTC moment for 31-Dec-targetYear 23:59:59 SGT', () => {
    const d = defaultExpiryFor(2027);
    // 31 Dec 2027 23:59:59 SGT = 31 Dec 2027 15:59:59 UTC
    expect(d.toISOString()).toBe('2027-12-31T15:59:59.000Z');
  });

  test('year boundary works across DST-free SGT zone', () => {
    const d2025 = defaultExpiryFor(2025);
    const d2026 = defaultExpiryFor(2026);
    expect(d2026 > d2025).toBe(true);
  });
});

describe('resolveExpiry()', () => {
  test('uses custom expiry when provided', () => {
    const d = resolveExpiry(2027, '2027-06-30T16:00:00Z');
    expect(d.toISOString()).toBe('2027-06-30T16:00:00.000Z');
  });

  test('falls back to default when no custom expiry', () => {
    const d = resolveExpiry(2027, undefined);
    expect(d.toISOString()).toBe('2027-12-31T15:59:59.000Z');
  });

  test('falls back to default on invalid date string', () => {
    const d = resolveExpiry(2027, 'not-a-date');
    expect(d.toISOString()).toBe('2027-12-31T15:59:59.000Z');
  });
});

describe('evaluateExpiry() — daily sweep decisions', () => {
  test('does not expire while carryForward is zero', () => {
    const ev = evaluateExpiry({ carryForward: 0, carryForwardExpiry: new Date('2025-01-01') });
    expect(ev.shouldExpire).toBe(false);
  });

  test('does not expire when expiry timestamp is null (HR-permitted indefinite)', () => {
    const ev = evaluateExpiry({ carryForward: 5, carryForwardExpiry: null });
    expect(ev.shouldExpire).toBe(false);
  });

  test('does not expire when now < expiry', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const ev = evaluateExpiry({ carryForward: 5, carryForwardExpiry: future });
    expect(ev.shouldExpire).toBe(false);
  });

  test('expires when now >= expiry; forfeits remaining carryForward into expiredDays', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const ev = evaluateExpiry({ carryForward: 5, carryForwardExpiry: past, expiredDays: 2 });
    expect(ev.shouldExpire).toBe(true);
    expect(ev.expiredAmount).toBe(5);
    expect(ev.newCarryForward).toBe(0);
    expect(ev.newExpiredDays).toBe(7);
  });

  test('treats expiry exactly equal to now as expired (inclusive boundary)', () => {
    const now = new Date('2027-12-31T15:59:59.000Z');
    const ev = evaluateExpiry({ carryForward: 3, carryForwardExpiry: now, expiredDays: 0 }, now);
    expect(ev.shouldExpire).toBe(true);
    expect(ev.expiredAmount).toBe(3);
  });
});
