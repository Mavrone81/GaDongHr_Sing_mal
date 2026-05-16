import { getMondayOf, getPeriodBounds, buildPeriodLog } from '../src/lib/attendanceUtils';
import type { ApiRecord } from '../src/lib/attendanceUtils';

// Fixed reference date: Friday 2026-05-15
const FRIDAY = new Date('2026-05-15T00:00:00');

describe('getMondayOf', () => {
  test('Monday → same day', () => {
    const mon = new Date('2026-05-11T00:00:00'); // Monday
    const result = getMondayOf(mon);
    expect(result.toISOString().slice(0, 10)).toBe('2026-05-11');
  });

  test('Friday → previous Monday', () => {
    const result = getMondayOf(FRIDAY);
    expect(result.toISOString().slice(0, 10)).toBe('2026-05-11');
  });

  test('Sunday → previous Monday', () => {
    const sun = new Date('2026-05-17T00:00:00');
    const result = getMondayOf(sun);
    expect(result.toISOString().slice(0, 10)).toBe('2026-05-11');
  });

  test('time is reset to 00:00:00.000', () => {
    const d = new Date('2026-05-15T14:30:00');
    const result = getMondayOf(d);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });
});

describe('getPeriodBounds', () => {
  describe('work-week mode (Mon–Fri)', () => {
    test('offset 0 → Mon–Fri of current week', () => {
      const { start, end } = getPeriodBounds('work-week', 0, FRIDAY);
      expect(start.toISOString().slice(0, 10)).toBe('2026-05-11');
      expect(end.toISOString().slice(0, 10)).toBe('2026-05-15');
    });

    test('offset +1 → next Mon–Fri', () => {
      const { start, end } = getPeriodBounds('work-week', 1, FRIDAY);
      expect(start.toISOString().slice(0, 10)).toBe('2026-05-18');
      expect(end.toISOString().slice(0, 10)).toBe('2026-05-22');
    });

    test('offset -1 → previous Mon–Fri', () => {
      const { start, end } = getPeriodBounds('work-week', -1, FRIDAY);
      expect(start.toISOString().slice(0, 10)).toBe('2026-05-04');
      expect(end.toISOString().slice(0, 10)).toBe('2026-05-08');
    });

    test('span is exactly 4 days (Mon to Fri)', () => {
      const { start, end } = getPeriodBounds('work-week', 0, FRIDAY);
      const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      expect(days).toBe(4);
    });
  });

  describe('week mode (Mon–Sun)', () => {
    test('offset 0 → Mon–Sun', () => {
      const { start, end } = getPeriodBounds('week', 0, FRIDAY);
      expect(start.toISOString().slice(0, 10)).toBe('2026-05-11');
      expect(end.toISOString().slice(0, 10)).toBe('2026-05-17');
    });

    test('span is exactly 6 days (Mon to Sun)', () => {
      const { start, end } = getPeriodBounds('week', 0, FRIDAY);
      const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      expect(days).toBe(6);
    });
  });

  describe('bi-weekly mode', () => {
    test('offset 0 → 14-day span', () => {
      const { start, end } = getPeriodBounds('bi-weekly', 0, FRIDAY);
      const days = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      expect(days).toBe(13);
    });

    test('offset +1 → shifts by 14 days', () => {
      const { start: s0 } = getPeriodBounds('bi-weekly', 0, FRIDAY);
      const { start: s1 } = getPeriodBounds('bi-weekly', 1, FRIDAY);
      const diff = (s1.getTime() - s0.getTime()) / (1000 * 60 * 60 * 24);
      expect(diff).toBe(14);
    });
  });

  describe('month mode', () => {
    test('offset 0 → first and last day of May 2026', () => {
      const { start, end } = getPeriodBounds('month', 0, FRIDAY);
      expect(start.toISOString().slice(0, 10)).toBe('2026-05-01');
      expect(end.toISOString().slice(0, 10)).toBe('2026-05-31');
    });

    test('offset -1 → April 2026', () => {
      const { start, end } = getPeriodBounds('month', -1, FRIDAY);
      expect(start.toISOString().slice(0, 10)).toBe('2026-04-01');
      expect(end.toISOString().slice(0, 10)).toBe('2026-04-30');
    });

    test('offset +1 → June 2026', () => {
      const { start, end } = getPeriodBounds('month', 1, FRIDAY);
      expect(start.toISOString().slice(0, 10)).toBe('2026-06-01');
      expect(end.toISOString().slice(0, 10)).toBe('2026-06-30');
    });
  });
});

describe('buildPeriodLog', () => {
  const mon = new Date('2026-05-11T00:00:00');
  const fri = new Date('2026-05-15T00:00:00');

  test('produces one row per day inclusive of start and end', () => {
    const rows = buildPeriodLog([], mon, fri);
    expect(rows).toHaveLength(5);
  });

  test('all rows absent when no API records provided', () => {
    const rows = buildPeriodLog([], mon, fri);
    rows.forEach(r => expect(r.status).toBe('absent'));
  });

  test('weekends get status "weekend"', () => {
    const startSat = new Date('2026-05-09T00:00:00'); // Saturday
    const endSun   = new Date('2026-05-10T00:00:00'); // Sunday
    const rows = buildPeriodLog([], startSat, endSun);
    expect(rows[0].status).toBe('weekend');
    expect(rows[1].status).toBe('weekend');
  });

  test('merges API record → status present', () => {
    const apiRecs: ApiRecord[] = [{
      date: '2026-05-11T00:00:00Z',
      clockIn: '2026-05-11T01:00:00Z',  // 09:00 SGT
      clockOut: '2026-05-11T09:00:00Z', // 17:00 SGT
      hoursWorked: 8,
      status: 'PRESENT',
    }];
    const rows = buildPeriodLog(apiRecs, mon, fri);
    const mondayRow = rows.find(r => r.isoDate === '2026-05-11')!;
    expect(mondayRow.status).toBe('present');
    expect(mondayRow.clockIn).not.toBeNull();
    expect(mondayRow.clockOut).not.toBeNull();
    expect(mondayRow.duration).toBe('8h 0m');
  });

  test('HALF_DAY status maps to "half"', () => {
    const apiRecs: ApiRecord[] = [{ date: '2026-05-11T00:00:00Z', status: 'HALF_DAY' }];
    const rows = buildPeriodLog(apiRecs, mon, fri);
    expect(rows.find(r => r.isoDate === '2026-05-11')!.status).toBe('half');
  });

  test('LEAVE status maps to "leave"', () => {
    const apiRecs: ApiRecord[] = [{ date: '2026-05-11T00:00:00Z', status: 'LEAVE' }];
    const rows = buildPeriodLog(apiRecs, mon, fri);
    expect(rows.find(r => r.isoDate === '2026-05-11')!.status).toBe('leave');
  });

  test('duration is null when hoursWorked is null', () => {
    const apiRecs: ApiRecord[] = [{ date: '2026-05-11T00:00:00Z', clockIn: '2026-05-11T01:00:00Z', hoursWorked: null }];
    const rows = buildPeriodLog(apiRecs, mon, fri);
    expect(rows.find(r => r.isoDate === '2026-05-11')!.duration).toBeNull();
  });

  test('duration rounds minutes correctly for 8.5h', () => {
    const apiRecs: ApiRecord[] = [{ date: '2026-05-11T00:00:00Z', hoursWorked: 8.5 }];
    const rows = buildPeriodLog(apiRecs, mon, fri);
    expect(rows.find(r => r.isoDate === '2026-05-11')!.duration).toBe('8h 30m');
  });

  test('isoDate and dayOfWeek are set correctly', () => {
    const rows = buildPeriodLog([], mon, fri);
    expect(rows[0].isoDate).toBe('2026-05-11');
    expect(rows[0].dayOfWeek).toBe(1); // Monday
    expect(rows[4].isoDate).toBe('2026-05-15');
    expect(rows[4].dayOfWeek).toBe(5); // Friday
  });
});
