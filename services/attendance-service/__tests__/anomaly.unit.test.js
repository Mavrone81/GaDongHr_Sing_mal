'use strict';
/**
 * Unit tests for TAT-004 anomaly.engine.js — pure classifier, no DB.
 */

const {
  detectAnomaliesForRecord,
  detectMonthlyOtBreach,
  mergeThresholds,
  buildAnomalyKey,
  DEFAULT_THRESHOLDS,
  ANOMALY_TYPES,
  SEVERITY,
} = require('../src/engines/anomaly.engine');

// Test "now" — anchor every record date well before this so the engine treats
// the scheduled day as fully elapsed.
const NOW = new Date('2026-05-20T12:00:00Z');

function rec(over = {}) {
  return {
    id: 'r-1',
    employeeId: 'e-1',
    date: new Date('2026-05-19T00:00:00.000Z'),
    clockIn:  null,
    clockOut: null,
    scheduledStart: new Date('2026-05-19T01:00:00.000Z'), // 09:00 SGT
    scheduledEnd:   new Date('2026-05-19T09:30:00.000Z'), // 17:30 SGT
    status: 'PRESENT',
    otHours: 0,
    ...over,
  };
}

describe('mergeThresholds', () => {
  test('returns defaults when no override given', () => {
    expect(mergeThresholds()).toEqual({ ...DEFAULT_THRESHOLDS });
  });
  test('honours 0 overrides explicitly', () => {
    const t = mergeThresholds({ lateThresholdMin: 0 });
    expect(t.lateThresholdMin).toBe(0);
    expect(t.earlyDepartThresholdMin).toBe(DEFAULT_THRESHOLDS.earlyDepartThresholdMin);
  });
  test('ignores non-finite or null values', () => {
    const t = mergeThresholds({ lateThresholdMin: null, dailyOtThresholdHours: 'abc' });
    expect(t.lateThresholdMin).toBe(DEFAULT_THRESHOLDS.lateThresholdMin);
    expect(t.dailyOtThresholdHours).toBe(DEFAULT_THRESHOLDS.dailyOtThresholdHours);
  });
});

describe('buildAnomalyKey', () => {
  test('shapes a stable employee|date|type string', () => {
    expect(buildAnomalyKey({ employeeId: 'e1', date: new Date('2026-05-19T03:00:00Z'), type: 'LATE_ARRIVAL' }))
      .toBe('e1|2026-05-19|LATE_ARRIVAL');
  });
  test('accepts string dates', () => {
    expect(buildAnomalyKey({ employeeId: 'e1', date: '2026-05-19', type: 'AWOL' }))
      .toBe('e1|2026-05-19|AWOL');
  });
});

describe('detectAnomaliesForRecord — AWOL', () => {
  test('flags AWOL when scheduled, no clock-in, day fully elapsed', () => {
    const list = detectAnomaliesForRecord(rec({ status: 'ABSENT' }), { now: NOW });
    expect(list.find(a => a.type === ANOMALY_TYPES.AWOL)).toBeTruthy();
  });
  test('does NOT flag AWOL when status=ON_LEAVE', () => {
    const list = detectAnomaliesForRecord(rec({ status: 'ON_LEAVE' }), { now: NOW });
    expect(list.find(a => a.type === ANOMALY_TYPES.AWOL)).toBeUndefined();
  });
  test('does NOT flag AWOL when status=PUBLIC_HOLIDAY', () => {
    const list = detectAnomaliesForRecord(rec({ status: 'PUBLIC_HOLIDAY' }), { now: NOW });
    expect(list.find(a => a.type === ANOMALY_TYPES.AWOL)).toBeUndefined();
  });
  test('does NOT flag AWOL when day not yet over', () => {
    const earlyNow = new Date('2026-05-19T05:00:00Z'); // 13:00 SGT, still in shift
    const list = detectAnomaliesForRecord(rec({ status: 'ABSENT' }), { now: earlyNow });
    expect(list.find(a => a.type === ANOMALY_TYPES.AWOL)).toBeUndefined();
  });
  test('does NOT flag AWOL when no schedule', () => {
    const list = detectAnomaliesForRecord(rec({ status: 'ABSENT', scheduledStart: null, scheduledEnd: null }), { now: NOW });
    expect(list.find(a => a.type === ANOMALY_TYPES.AWOL)).toBeUndefined();
  });
});

describe('detectAnomaliesForRecord — LATE_ARRIVAL', () => {
  test('flags when clockIn is 20 min after scheduled (threshold=15)', () => {
    const r = rec({ clockIn: new Date('2026-05-19T01:20:00Z') }); // 09:20 SGT
    const list = detectAnomaliesForRecord(r, { now: NOW });
    const a = list.find(x => x.type === ANOMALY_TYPES.LATE_ARRIVAL);
    expect(a).toBeTruthy();
    expect(a.detail.lateMinutes).toBe(20);
    expect(a.severity).toBe(SEVERITY.LATE_ARRIVAL);
  });
  test('does NOT flag when exactly on time', () => {
    const r = rec({ clockIn: new Date('2026-05-19T01:00:00Z') });
    const list = detectAnomaliesForRecord(r, { now: NOW });
    expect(list.find(a => a.type === ANOMALY_TYPES.LATE_ARRIVAL)).toBeUndefined();
  });
  test('flags exactly at threshold boundary (15 min)', () => {
    const r = rec({ clockIn: new Date('2026-05-19T01:15:00Z') });
    const list = detectAnomaliesForRecord(r, { now: NOW });
    expect(list.find(a => a.type === ANOMALY_TYPES.LATE_ARRIVAL)).toBeTruthy();
  });
  test('respects custom higher threshold (clockIn 20 min late but threshold=30 → no flag)', () => {
    const r = rec({ clockIn: new Date('2026-05-19T01:20:00Z') });
    const list = detectAnomaliesForRecord(r, { thresholds: { lateThresholdMin: 30 }, now: NOW });
    expect(list.find(a => a.type === ANOMALY_TYPES.LATE_ARRIVAL)).toBeUndefined();
  });
});

describe('detectAnomaliesForRecord — EARLY_DEPARTURE', () => {
  test('flags when clockOut is 20 min before scheduled end', () => {
    const r = rec({
      clockIn:  new Date('2026-05-19T01:00:00Z'),
      clockOut: new Date('2026-05-19T09:10:00Z'), // 17:10 SGT — 20 min early
    });
    const list = detectAnomaliesForRecord(r, { now: NOW });
    const a = list.find(x => x.type === ANOMALY_TYPES.EARLY_DEPARTURE);
    expect(a).toBeTruthy();
    expect(a.detail.earlyMinutes).toBe(20);
  });
  test('does NOT flag when clockOut after scheduledEnd', () => {
    const r = rec({
      clockIn:  new Date('2026-05-19T01:00:00Z'),
      clockOut: new Date('2026-05-19T10:00:00Z'),
    });
    const list = detectAnomaliesForRecord(r, { now: NOW });
    expect(list.find(a => a.type === ANOMALY_TYPES.EARLY_DEPARTURE)).toBeUndefined();
  });
});

describe('detectAnomaliesForRecord — MISSING_CLOCK_OUT', () => {
  test('flags clock-in with no clock-out once grace past scheduled end', () => {
    const r = rec({ clockIn: new Date('2026-05-19T01:00:00Z') });
    const list = detectAnomaliesForRecord(r, { now: NOW });
    expect(list.find(a => a.type === ANOMALY_TYPES.MISSING_CLOCK_OUT)).toBeTruthy();
  });
  test('does NOT flag while still within grace window', () => {
    // scheduledEnd 09:30Z, grace 2h → cutoff 11:30Z. Test at 10:00Z.
    const r = rec({ clockIn: new Date('2026-05-19T01:00:00Z') });
    const earlyNow = new Date('2026-05-19T10:00:00Z');
    const list = detectAnomaliesForRecord(r, { now: earlyNow });
    expect(list.find(a => a.type === ANOMALY_TYPES.MISSING_CLOCK_OUT)).toBeUndefined();
  });
  test('with no schedule falls back to clockIn + 12h + grace', () => {
    const r = rec({
      clockIn: new Date('2026-05-19T01:00:00Z'),
      scheduledStart: null,
      scheduledEnd: null,
    });
    const lateNow = new Date('2026-05-19T16:00:00Z'); // 15h after clockIn — past 12+2 cutoff
    const list = detectAnomaliesForRecord(r, { now: lateNow });
    expect(list.find(a => a.type === ANOMALY_TYPES.MISSING_CLOCK_OUT)).toBeTruthy();
  });
});

describe('detectAnomaliesForRecord — EXCESSIVE_OT', () => {
  test('flags single-day OT >= 4h by default', () => {
    const r = rec({ clockIn: new Date('2026-05-19T01:00:00Z'), clockOut: new Date('2026-05-19T13:30:00Z'), otHours: 4.5 });
    const list = detectAnomaliesForRecord(r, { now: NOW });
    const a = list.find(x => x.type === ANOMALY_TYPES.EXCESSIVE_OT);
    expect(a).toBeTruthy();
    expect(a.detail.otHours).toBe(4.5);
  });
  test('uses billableOtHours when present', () => {
    const r = rec({ clockIn: new Date('2026-05-19T01:00:00Z'), clockOut: new Date('2026-05-19T13:30:00Z'), otHours: 4.5, billableOtHours: 1 });
    const list = detectAnomaliesForRecord(r, { now: NOW });
    expect(list.find(x => x.type === ANOMALY_TYPES.EXCESSIVE_OT)).toBeUndefined();
  });
  test('does NOT flag below threshold', () => {
    const r = rec({ clockIn: new Date('2026-05-19T01:00:00Z'), clockOut: new Date('2026-05-19T12:00:00Z'), otHours: 2 });
    const list = detectAnomaliesForRecord(r, { now: NOW });
    expect(list.find(a => a.type === ANOMALY_TYPES.EXCESSIVE_OT)).toBeUndefined();
  });
});

describe('detectMonthlyOtBreach', () => {
  test('flags when sum of OT >= 60h', () => {
    const records = Array.from({ length: 15 }, (_, i) => ({
      employeeId: 'e1',
      date: new Date(`2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
      otHours: 4,
    }));
    const a = detectMonthlyOtBreach(records);
    expect(a).toBeTruthy();
    expect(a.type).toBe(ANOMALY_TYPES.MONTHLY_OT_BREACH);
    expect(a.detail.totalOtHours).toBe(60);
  });
  test('returns null below threshold', () => {
    const records = [{ otHours: 30, date: new Date() }, { otHours: 20, date: new Date() }];
    expect(detectMonthlyOtBreach(records)).toBeNull();
  });
  test('respects custom monthlyOtAlertHours override', () => {
    const records = [{ otHours: 35, date: new Date() }];
    const a = detectMonthlyOtBreach(records, { thresholds: { monthlyOtAlertHours: 30 } });
    expect(a).toBeTruthy();
    expect(a.detail.threshold).toBe(30);
  });
  test('prefers billableOtHours over raw otHours', () => {
    const records = [{ otHours: 90, billableOtHours: 30, date: new Date() }];
    expect(detectMonthlyOtBreach(records)).toBeNull();
  });
});

describe('multi-anomaly composition', () => {
  test('one record can trigger several anomaly types at once', () => {
    const r = rec({
      clockIn:  new Date('2026-05-19T01:30:00Z'),    // 30 min late
      clockOut: new Date('2026-05-19T09:00:00Z'),    // 30 min early
      otHours: 5,
    });
    const list = detectAnomaliesForRecord(r, { now: NOW });
    const types = list.map(a => a.type).sort();
    expect(types).toEqual([ANOMALY_TYPES.EARLY_DEPARTURE, ANOMALY_TYPES.EXCESSIVE_OT, ANOMALY_TYPES.LATE_ARRIVAL].sort());
  });
});
