import { civilDate, toISODate, addDays, BUSINESS_TZ } from '../src/lib/timezone';

// These assertions hold in ANY runner timezone — civilDate resolves the calendar
// date in BUSINESS_TZ (Asia/Singapore, +08) via Intl, independent of process.env.TZ.
// They're the regression guard for the bug where local arithmetic was keyed with
// UTC `toISOString()` and shifted dates back a day in Singapore time.

describe('business-timezone date keys', () => {
  test('BUSINESS_TZ is Singapore', () => {
    expect(BUSINESS_TZ).toBe('Asia/Singapore');
  });

  test('instant late evening UTC maps to the next SGT calendar day', () => {
    // 2026-05-10 20:00Z === 2026-05-11 04:00 in Singapore
    expect(toISODate(civilDate(new Date('2026-05-10T20:00:00Z')))).toBe('2026-05-11');
  });

  test('the exact midnight-SGT boundary (16:30Z) rolls to the next day', () => {
    // 2026-05-11 16:30Z === 2026-05-12 00:30 SGT — the case the old UTC code got wrong
    expect(toISODate(civilDate(new Date('2026-05-11T16:30:00Z')))).toBe('2026-05-12');
  });

  test('an instant within the SGT day keeps that day', () => {
    // 2026-05-11 15:00Z === 2026-05-11 23:00 SGT
    expect(toISODate(civilDate(new Date('2026-05-11T15:00:00Z')))).toBe('2026-05-11');
  });

  test('addDays advances the civil date across month/year boundaries', () => {
    const dec31 = civilDate(new Date('2026-12-31T12:00:00+08:00'));
    expect(toISODate(addDays(dec31, 1))).toBe('2027-01-01');
    expect(toISODate(addDays(dec31, -1))).toBe('2026-12-30');
  });
});
