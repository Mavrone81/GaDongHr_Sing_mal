'use strict';
/**
 * Unit tests for TAT-005 time-reconciliation engine.
 *
 * Convention for fixtures: 5 May 2026 is a Tuesday. Times below are in UTC
 * but the engine doesn't care about timezone — it just diffs Date objects.
 */
const { reconcileRecord, classifyDelta } = require('../src/engines/time-reconciliation.engine');

const t = (h, m = 0) => new Date(Date.UTC(2026, 4, 5, h, m, 0));

const DEFAULT_SHIFT = {
  breakMinutes: 60,
  hoursPerDay: 8,
  graceMinutesEarly: 15,
  graceMinutesLate: 15,
};

describe('classifyDelta()', () => {
  test('zero/negative → NOT_APPLICABLE', () => {
    expect(classifyDelta(0, 15)).toBe('NOT_APPLICABLE');
    expect(classifyDelta(-5, 15)).toBe('NOT_APPLICABLE');
  });

  test('within grace → AUTO_APPROVED (boundary inclusive)', () => {
    expect(classifyDelta(1, 15)).toBe('AUTO_APPROVED');
    expect(classifyDelta(15, 15)).toBe('AUTO_APPROVED');
  });

  test('outside grace → PENDING', () => {
    expect(classifyDelta(16, 15)).toBe('PENDING');
    expect(classifyDelta(120, 15)).toBe('PENDING');
  });
});

describe('reconcileRecord() — early-in delta', () => {
  test('clock-in within grace → AUTO_APPROVED, full hours counted', () => {
    const r = reconcileRecord(
      { clockIn: t(8, 50), clockOut: t(17, 30), scheduledStart: t(9), scheduledEnd: t(17, 30) },
      DEFAULT_SHIFT,
    );
    // 10 minutes early, within 15-min grace
    expect(r.earlyMinutes).toBe(10);
    expect(r.earlyStatus).toBe('AUTO_APPROVED');
    expect(r.lateMinutes).toBe(0);
    expect(r.lateStatus).toBe('NOT_APPLICABLE');
    // billable = 8:50 → 17:30 = 8h40m gross − 60m break = 7h40m
    expect(r.billableHours).toBeCloseTo(7.67, 2);
  });

  test('clock-in 45min early → PENDING, billable clips to scheduled start', () => {
    const r = reconcileRecord(
      { clockIn: t(8, 15), clockOut: t(17, 30), scheduledStart: t(9), scheduledEnd: t(17, 30) },
      DEFAULT_SHIFT,
    );
    expect(r.earlyMinutes).toBe(45);
    expect(r.earlyStatus).toBe('PENDING');
    // clipped to scheduled — 9:00 → 17:30 = 8h30m − 60m = 7h30m
    expect(r.billableHours).toBe(7.5);
  });

  test('existing APPROVED status is preserved across re-reconciliation', () => {
    const r = reconcileRecord(
      {
        clockIn: t(8, 15), clockOut: t(17, 30),
        scheduledStart: t(9), scheduledEnd: t(17, 30),
        earlyStatus: 'APPROVED',
      },
      DEFAULT_SHIFT,
    );
    expect(r.earlyStatus).toBe('APPROVED');
    // Approved early time counts — billable = 8:15 → 17:30 = 9h15m − 60m = 8h15m
    expect(r.billableHours).toBe(8.25);
    expect(r.billableOtHours).toBe(0.25);
  });

  test('existing DENIED status is preserved and time is clipped', () => {
    const r = reconcileRecord(
      {
        clockIn: t(8, 15), clockOut: t(17, 30),
        scheduledStart: t(9), scheduledEnd: t(17, 30),
        earlyStatus: 'DENIED',
      },
      DEFAULT_SHIFT,
    );
    expect(r.earlyStatus).toBe('DENIED');
    expect(r.billableHours).toBe(7.5);
  });
});

describe('reconcileRecord() — late-out delta', () => {
  test('clock-out within grace → AUTO_APPROVED', () => {
    const r = reconcileRecord(
      { clockIn: t(9), clockOut: t(17, 40), scheduledStart: t(9), scheduledEnd: t(17, 30) },
      DEFAULT_SHIFT,
    );
    expect(r.lateMinutes).toBe(10);
    expect(r.lateStatus).toBe('AUTO_APPROVED');
    // 9:00 → 17:40 = 8h40m − 60m = 7h40m
    expect(r.billableHours).toBeCloseTo(7.67, 2);
  });

  test('clock-out 90min late → PENDING, billable clips to scheduled end', () => {
    const r = reconcileRecord(
      { clockIn: t(9), clockOut: t(19), scheduledStart: t(9), scheduledEnd: t(17, 30) },
      DEFAULT_SHIFT,
    );
    expect(r.lateMinutes).toBe(90);
    expect(r.lateStatus).toBe('PENDING');
    // clipped to scheduled — 9:00 → 17:30 = 8h30m − 60m = 7h30m
    expect(r.billableHours).toBe(7.5);
    expect(r.billableOtHours).toBe(0);
  });

  test('clock-out 90min late and APPROVED → OT counted', () => {
    const r = reconcileRecord(
      {
        clockIn: t(9), clockOut: t(19),
        scheduledStart: t(9), scheduledEnd: t(17, 30),
        lateStatus: 'APPROVED',
      },
      DEFAULT_SHIFT,
    );
    expect(r.lateStatus).toBe('APPROVED');
    // 9:00 → 19:00 = 10h − 60m = 9h, OT = 9 − 8 = 1h
    expect(r.billableHours).toBe(9);
    expect(r.billableOtHours).toBe(1);
  });
});

describe('reconcileRecord() — short hours never trigger approval flow', () => {
  test('clock-in 30min late → no early delta, billable starts at actual clock-in', () => {
    const r = reconcileRecord(
      { clockIn: t(9, 30), clockOut: t(17, 30), scheduledStart: t(9), scheduledEnd: t(17, 30) },
      DEFAULT_SHIFT,
    );
    expect(r.earlyMinutes).toBe(0);
    expect(r.earlyStatus).toBe('NOT_APPLICABLE');
    // 9:30 → 17:30 = 8h − 60m = 7h
    expect(r.billableHours).toBe(7);
  });

  test('clock-out 30min early → no late delta, billable ends at actual clock-out', () => {
    const r = reconcileRecord(
      { clockIn: t(9), clockOut: t(17), scheduledStart: t(9), scheduledEnd: t(17, 30) },
      DEFAULT_SHIFT,
    );
    expect(r.lateMinutes).toBe(0);
    expect(r.lateStatus).toBe('NOT_APPLICABLE');
    // 9:00 → 17:00 = 8h − 60m = 7h
    expect(r.billableHours).toBe(7);
  });
});

describe('reconcileRecord() — no schedule (no roster entry)', () => {
  test('null scheduledStart/End → all NOT_APPLICABLE, billable uses raw clock times', () => {
    const r = reconcileRecord(
      { clockIn: t(9), clockOut: t(17, 30), scheduledStart: null, scheduledEnd: null },
      DEFAULT_SHIFT,
    );
    expect(r.earlyStatus).toBe('NOT_APPLICABLE');
    expect(r.lateStatus).toBe('NOT_APPLICABLE');
    expect(r.earlyMinutes).toBe(0);
    expect(r.lateMinutes).toBe(0);
    // 9:00 → 17:30 = 8h30m − 60m = 7h30m
    expect(r.billableHours).toBe(7.5);
  });

  test('only clockIn (no clockOut yet) returns billableHours null', () => {
    const r = reconcileRecord(
      { clockIn: t(9), clockOut: null, scheduledStart: t(9), scheduledEnd: t(17, 30) },
      DEFAULT_SHIFT,
    );
    expect(r.billableHours).toBeNull();
    expect(r.billableOtHours).toBe(0);
  });
});

describe('reconcileRecord() — combined early+late', () => {
  test('both within grace → both AUTO_APPROVED, full hours counted', () => {
    const r = reconcileRecord(
      { clockIn: t(8, 55), clockOut: t(17, 40), scheduledStart: t(9), scheduledEnd: t(17, 30) },
      DEFAULT_SHIFT,
    );
    expect(r.earlyStatus).toBe('AUTO_APPROVED');
    expect(r.lateStatus).toBe('AUTO_APPROVED');
    // 8:55 → 17:40 = 8h45m − 60m = 7h45m
    expect(r.billableHours).toBe(7.75);
  });

  test('early PENDING + late APPROVED → only late counts', () => {
    const r = reconcileRecord(
      {
        clockIn: t(8, 0), clockOut: t(19),
        scheduledStart: t(9), scheduledEnd: t(17, 30),
        lateStatus: 'APPROVED',
      },
      DEFAULT_SHIFT,
    );
    expect(r.earlyStatus).toBe('PENDING');
    expect(r.lateStatus).toBe('APPROVED');
    // billable start clips to schedule (early not approved): 9:00 → 19:00 = 10h − 60m = 9h
    expect(r.billableHours).toBe(9);
    expect(r.billableOtHours).toBe(1);
  });
});

describe('reconcileRecord() — shift parameter overrides', () => {
  test('custom grace of 30 minutes', () => {
    const r = reconcileRecord(
      { clockIn: t(8, 40), clockOut: t(17, 30), scheduledStart: t(9), scheduledEnd: t(17, 30) },
      { ...DEFAULT_SHIFT, graceMinutesEarly: 30 },
    );
    // 20 min early — inside the loosened 30-min grace
    expect(r.earlyStatus).toBe('AUTO_APPROVED');
  });

  test('zero grace → any delta is PENDING', () => {
    const r = reconcileRecord(
      { clockIn: t(8, 59), clockOut: t(17, 30), scheduledStart: t(9), scheduledEnd: t(17, 30) },
      { ...DEFAULT_SHIFT, graceMinutesEarly: 0 },
    );
    expect(r.earlyMinutes).toBe(1);
    expect(r.earlyStatus).toBe('PENDING');
  });

  test('custom hoursPerDay drives OT cut-off', () => {
    const r = reconcileRecord(
      {
        clockIn: t(8), clockOut: t(20),
        scheduledStart: t(9), scheduledEnd: t(20),
        earlyStatus: 'APPROVED',
      },
      { ...DEFAULT_SHIFT, hoursPerDay: 10 },
    );
    // 8:00 → 20:00 = 12h − 60m = 11h, OT cut-off at 10h → 1h OT
    expect(r.billableHours).toBe(11);
    expect(r.billableOtHours).toBe(1);
  });
});
