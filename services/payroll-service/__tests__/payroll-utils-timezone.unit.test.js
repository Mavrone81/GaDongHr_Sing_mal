'use strict';
/**
 * Timezone regression guard for the server-side working-day helpers.
 *
 * THE BUG: countWorkingDays derived the day-of-week with LOCAL accessors
 * (setHours(0,0,0,0), getDay, setDate) but keyed public holidays with
 * toISOString() — a UTC date string. East of UTC those are different days, so
 * local midnight serialised to the PREVIOUS calendar date, the holiday key
 * missed, the holiday was counted as a working day, and EA s.20 pro-rated
 * salary came out wrong (G8: expected 5000, got 4761.90).
 *
 * It never surfaced because CI runs UTC, where the two happen to agree. It
 * fails on any +08 machine — i.e. every Singapore and Malaysian deployment,
 * and every developer here.
 *
 * This is the same defect frontend/src/lib/timezone.ts was written to
 * eliminate; the fix had only ever been applied client-side.
 *
 * CONVENTION (matches lib/timezone.ts): date-only values are anchored at
 * UTC midnight and read with the getUTC accessors and toISOString. Never mix
 * local getters with UTC serialisation.
 *
 * Every assertion below must hold under ANY TZ. Verified against UTC,
 * Asia/Singapore, Asia/Kuala_Lumpur and America/New_York.
 */
const { countWorkingDays, countPeriodLeaveWorkingDays } = require('/app/shared/payroll-utils');

const MAY_START = new Date('2026-05-01');
const MAY_END   = new Date('2026-05-31');

describe('countWorkingDays is timezone-independent', () => {
  test('excludes a public holiday that falls on a weekday', () => {
    // 2026-05-01 is a Friday. Mon 4 – Fri 29 plus Fri 1 = 21 weekdays in May;
    // excluding May 1 leaves 20.
    const withHoliday = countWorkingDays(MAY_START, MAY_END, new Set(['2026-05-01']));
    const withNone    = countWorkingDays(MAY_START, MAY_END, new Set());
    expect(withNone - withHoliday).toBe(1);
  });

  test('a single holiday day counts as zero working days', () => {
    expect(countWorkingDays(
      new Date('2026-05-01'), new Date('2026-05-01'), new Set(['2026-05-01']),
    )).toBe(0);
  });

  test('the same day without a holiday counts as one', () => {
    expect(countWorkingDays(
      new Date('2026-05-01'), new Date('2026-05-01'), new Set(),
    )).toBe(1);
  });

  test('identifies weekends by UTC day-of-week, not local', () => {
    // 2026-05-02 Sat, 2026-05-03 Sun — zero working days either way.
    expect(countWorkingDays(new Date('2026-05-02'), new Date('2026-05-03'), new Set())).toBe(0);
  });

  test('Monday is a working day at the exact range boundary', () => {
    // 2026-05-04 is a Monday. A local-midnight anchor in +08 would serialise
    // it as Sunday 2026-05-03 and drop it.
    expect(countWorkingDays(new Date('2026-05-04'), new Date('2026-05-04'), new Set())).toBe(1);
  });

  test('SIX_DAY counts Saturday but still excludes a Saturday holiday', () => {
    expect(countWorkingDays(
      new Date('2026-05-02'), new Date('2026-05-02'), new Set(), 'SIX_DAY',
    )).toBe(1);
    expect(countWorkingDays(
      new Date('2026-05-02'), new Date('2026-05-02'), new Set(['2026-05-02']), 'SIX_DAY',
    )).toBe(0);
  });
});

describe('countPeriodLeaveWorkingDays is timezone-independent', () => {
  test('half-day on a holiday is zero', () => {
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-05-01'), new Date('2026-05-01'),
      MAY_START, MAY_END, new Set(['2026-05-01']), 'FIVE_DAY', true,
    )).toBe(0);
  });

  test('half-day on an ordinary weekday is 0.5', () => {
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-05-04'), new Date('2026-05-04'),
      MAY_START, MAY_END, new Set(), 'FIVE_DAY', true,
    )).toBe(0.5);
  });

  test('half-day on a Saturday is zero', () => {
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-05-02'), new Date('2026-05-02'),
      MAY_START, MAY_END, new Set(), 'FIVE_DAY', true,
    )).toBe(0);
  });

  test('leave spanning a holiday excludes it', () => {
    // Fri 1 May (holiday) + Sat 2 May → 0 working days.
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-05-01'), new Date('2026-05-02'),
      MAY_START, MAY_END, new Set(['2026-05-01']),
    )).toBe(0);
  });
});
