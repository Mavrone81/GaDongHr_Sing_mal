'use strict';
/**
 * Unit tests for src/engines/alert.engine.js (AST-003)
 */

const { THRESHOLDS, daysUntil, bandFor, classifyUrgency, pendingThresholds, formatAlertMessage } = require('../src/engines/alert.engine');

const future = (days) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

describe('THRESHOLDS', () => {
  test('all four alert types defined', () => {
    expect(THRESHOLDS).toHaveProperty('WARRANTY');
    expect(THRESHOLDS).toHaveProperty('MAINTENANCE');
    expect(THRESHOLDS).toHaveProperty('RETURN');
    expect(THRESHOLDS).toHaveProperty('LICENCE');
  });
  test('WARRANTY thresholds ordered descending', () => {
    expect(THRESHOLDS.WARRANTY).toEqual([60, 30, 7]);
  });
  test('RETURN thresholds ordered descending', () => {
    expect(THRESHOLDS.RETURN).toEqual([14, 7, 1]);
  });
});

describe('daysUntil', () => {
  test('positive for future date', () => {
    expect(daysUntil(future(10))).toBe(10);
  });
  test('zero for today', () => {
    expect(daysUntil(future(0))).toBe(0);
  });
  test('negative for past date', () => {
    expect(daysUntil(future(-5))).toBe(-5);
  });
  test('null for null input', () => {
    expect(daysUntil(null)).toBeNull();
  });
});

describe('bandFor', () => {
  test('returns 60 for 45-day warranty', () => {
    expect(bandFor(45, [60, 30, 7])).toBe(60);
  });
  test('returns 30 for 20-day warranty', () => {
    expect(bandFor(20, [60, 30, 7])).toBe(30);
  });
  test('returns 7 for 3-day warranty', () => {
    expect(bandFor(3, [60, 30, 7])).toBe(7);
  });
  test('returns null when above all thresholds', () => {
    expect(bandFor(100, [60, 30, 7])).toBeNull();
  });
  test('returns -1 for overdue', () => {
    expect(bandFor(-1, [60, 30, 7])).toBe(-1);
  });
});

describe('classifyUrgency', () => {
  test('OVERDUE for negative', () => {
    expect(classifyUrgency(-1)).toBe('OVERDUE');
  });
  test('CRITICAL for 0-7 days', () => {
    expect(classifyUrgency(0)).toBe('CRITICAL');
    expect(classifyUrgency(7)).toBe('CRITICAL');
  });
  test('WARNING for 8-30 days', () => {
    expect(classifyUrgency(8)).toBe('WARNING');
    expect(classifyUrgency(30)).toBe('WARNING');
  });
  test('OK for > 30 days', () => {
    expect(classifyUrgency(31)).toBe('OK');
  });
  test('NONE for null', () => {
    expect(classifyUrgency(null)).toBe('NONE');
  });
});

describe('pendingThresholds (idempotency)', () => {
  test('returns all crossed thresholds when none fired yet', () => {
    expect(pendingThresholds(5, 'WARRANTY', [])).toEqual([60, 30, 7]);
  });
  test('skips already-fired thresholds', () => {
    expect(pendingThresholds(5, 'WARRANTY', [60, 30])).toEqual([7]);
  });
  test('returns nothing if outside band', () => {
    expect(pendingThresholds(75, 'WARRANTY', [])).toEqual([]);
  });
  test('returns nothing for negative days (overdue handled separately)', () => {
    expect(pendingThresholds(-5, 'WARRANTY', [])).toEqual([]);
  });
  test('LICENCE uses its own thresholds', () => {
    expect(pendingThresholds(25, 'LICENCE', [])).toEqual([60, 30]);
  });
});

describe('formatAlertMessage', () => {
  test('warranty message contains entity label and days', () => {
    const msg = formatAlertMessage('WARRANTY', 'AST-001 Laptop', 10);
    expect(msg).toContain('AST-001 Laptop');
    expect(msg).toContain('10 day');
    expect(msg).toContain('expires');
  });
  test('maintenance uses "maintenance due" verb', () => {
    expect(formatAlertMessage('MAINTENANCE', 'AST-002', 7)).toContain('maintenance due');
  });
  test('return uses "return due" verb', () => {
    expect(formatAlertMessage('RETURN', 'AST-003', 5)).toContain('return due');
  });
  test('overdue formatting', () => {
    expect(formatAlertMessage('WARRANTY', 'X', -3)).toContain('expired 3 day');
  });
  test('today formatting', () => {
    expect(formatAlertMessage('LICENCE', 'Office365', 0)).toContain('today');
  });
});
