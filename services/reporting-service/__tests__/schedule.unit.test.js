'use strict';

const { nextRunAt, firstRunAt, FREQUENCIES, RUN_HOUR_UTC } = require('../src/engines/schedule');

describe('schedule', () => {
  test('FREQUENCIES export', () => {
    expect(FREQUENCIES).toEqual(['DAILY', 'WEEKLY', 'MONTHLY']);
  });

  test('rejects unknown frequency', () => {
    expect(() => nextRunAt('YEARLY', new Date())).toThrow(/frequency/);
  });

  test('DAILY adds 1 day', () => {
    const prev = new Date(Date.UTC(2026, 4, 24, RUN_HOUR_UTC));
    const next = nextRunAt('DAILY', prev);
    expect(next.toISOString()).toBe(new Date(Date.UTC(2026, 4, 25, RUN_HOUR_UTC)).toISOString());
  });

  test('WEEKLY adds 7 days', () => {
    const prev = new Date(Date.UTC(2026, 4, 24, RUN_HOUR_UTC));
    const next = nextRunAt('WEEKLY', prev);
    expect(next.toISOString()).toBe(new Date(Date.UTC(2026, 4, 31, RUN_HOUR_UTC)).toISOString());
  });

  test('MONTHLY adds 1 month, preserves day', () => {
    const prev = new Date(Date.UTC(2026, 4, 24, RUN_HOUR_UTC)); // May 24
    const next = nextRunAt('MONTHLY', prev);
    expect(next.getUTCMonth()).toBe(5); // June
    expect(next.getUTCDate()).toBe(24);
  });

  test('MONTHLY clamps day for shorter months (Jan 31 → Feb 28)', () => {
    const prev = new Date(Date.UTC(2027, 0, 31, RUN_HOUR_UTC)); // Jan 31, 2027 (non-leap)
    const next = nextRunAt('MONTHLY', prev);
    expect(next.getUTCMonth()).toBe(1); // February
    expect(next.getUTCDate()).toBe(28); // 2027 not a leap year
  });

  test('MONTHLY Jan 31 → Feb 29 in leap year', () => {
    const prev = new Date(Date.UTC(2028, 0, 31, RUN_HOUR_UTC)); // Jan 31, 2028 (leap year)
    const next = nextRunAt('MONTHLY', prev);
    expect(next.getUTCMonth()).toBe(1);
    expect(next.getUTCDate()).toBe(29);
  });

  test('firstRunAt returns next 02:00 SGT slot in the future', () => {
    const now = new Date('2026-05-24T10:00:00Z'); // before 18:00 UTC = before 02:00 SGT next day
    const first = firstRunAt(now);
    expect(first.getTime()).toBeGreaterThan(now.getTime());
    expect(first.getUTCHours()).toBe(RUN_HOUR_UTC);
  });

  test('firstRunAt: if past today\'s slot, picks tomorrow', () => {
    const now = new Date('2026-05-24T19:00:00Z'); // already past 18:00 UTC
    const first = firstRunAt(now);
    expect(first.getUTCDate()).toBe(25);
    expect(first.getUTCHours()).toBe(RUN_HOUR_UTC);
  });
});
