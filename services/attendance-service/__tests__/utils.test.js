'use strict';
const { haversineMetres, isLate, calcHoursWorked, calcOtHours } = require('../src/utils');

describe('haversineMetres', () => {
  test('same point → 0 metres', () => {
    expect(haversineMetres(1.3521, 103.8198, 1.3521, 103.8198)).toBeCloseTo(0, 0);
  });

  test('Raffles Place ↔ Marina Bay Sands (~1.2 km)', () => {
    // Raffles Place: 1.2841, 103.8514  |  MBS: 1.2835, 103.8607
    const dist = haversineMetres(1.2841, 103.8514, 1.2835, 103.8607);
    expect(dist).toBeGreaterThan(800);
    expect(dist).toBeLessThan(1200);
  });

  test('Singapore ↔ Kuala Lumpur (~310 km)', () => {
    const dist = haversineMetres(1.3521, 103.8198, 3.1390, 101.6869);
    expect(dist).toBeGreaterThan(290_000);
    expect(dist).toBeLessThan(330_000);
  });

  test('within 200 m geofence radius', () => {
    // 100 m north of origin
    const dist = haversineMetres(1.3521, 103.8198, 1.3530, 103.8198);
    expect(dist).toBeLessThan(200);
  });

  test('outside 200 m geofence radius', () => {
    // ~500 m north of origin
    const dist = haversineMetres(1.3521, 103.8198, 1.3566, 103.8198);
    expect(dist).toBeGreaterThan(200);
  });
});

describe('isLate', () => {
  // Singapore is UTC+8 (no DST). 09:14 SGT = 01:14 UTC. 09:15 SGT = 01:15 UTC.

  test('09:00 SGT → not late', () => {
    // 09:00 SGT = 01:00 UTC
    const d = new Date('2026-05-16T01:00:00.000Z');
    expect(isLate(d)).toBe(false);
  });

  test('09:14 SGT → not late', () => {
    const d = new Date('2026-05-16T01:14:00.000Z');
    expect(isLate(d)).toBe(false);
  });

  test('09:15 SGT → late (boundary)', () => {
    const d = new Date('2026-05-16T01:15:00.000Z');
    expect(isLate(d)).toBe(true);
  });

  test('09:30 SGT → late', () => {
    const d = new Date('2026-05-16T01:30:00.000Z');
    expect(isLate(d)).toBe(true);
  });

  test('10:00 SGT → late', () => {
    const d = new Date('2026-05-16T02:00:00.000Z');
    expect(isLate(d)).toBe(true);
  });

  test('08:59 SGT → not late', () => {
    const d = new Date('2026-05-16T00:59:00.000Z');
    expect(isLate(d)).toBe(false);
  });
});

describe('calcHoursWorked', () => {
  test('8h shift → 8.00', () => {
    const ci = new Date('2026-05-16T01:00:00Z');
    const co = new Date('2026-05-16T09:00:00Z');
    expect(calcHoursWorked(ci, co)).toBe(8.00);
  });

  test('8.5h shift → 8.50', () => {
    const ci = new Date('2026-05-16T01:00:00Z');
    const co = new Date('2026-05-16T09:30:00Z');
    expect(calcHoursWorked(ci, co)).toBe(8.50);
  });

  test('rounds to 2 decimal places', () => {
    const ci = new Date('2026-05-16T01:00:00Z');
    const co = new Date('2026-05-16T09:20:00Z'); // 8h 20m = 8.333...h
    expect(calcHoursWorked(ci, co)).toBe(8.33);
  });
});

describe('calcOtHours', () => {
  test('< 8h → 0 OT', () => {
    expect(calcOtHours(7.5)).toBe(0);
  });

  test('exactly 8h → 0 OT', () => {
    expect(calcOtHours(8)).toBe(0);
  });

  test('9h → 1h OT', () => {
    expect(calcOtHours(9)).toBe(1);
  });

  test('10.5h → 2.5h OT', () => {
    expect(calcOtHours(10.5)).toBe(2.5);
  });

  test('rounds to 2dp', () => {
    // 8 + 1/3h ≈ 8.33h → 0.33h OT
    expect(calcOtHours(8.33)).toBe(0.33);
  });
});
