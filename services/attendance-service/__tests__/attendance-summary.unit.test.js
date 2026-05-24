'use strict';
/**
 * Unit tests for TAT-005 attendance-summary engine.
 */
const {
  summarizeEmployee, summarizeAll, DEFAULT_OT_MONTHLY_CAP,
} = require('../src/engines/attendance-summary.engine');

const rec = (overrides) => ({
  employeeId: 'emp-1',
  date: new Date('2026-05-04'),
  hoursWorked: 0,
  otHours: 0,
  status: 'PRESENT',
  ...overrides,
});

describe('summarizeEmployee()', () => {
  test('PRESENT records accumulate regular hours, capped at hoursPerDay', () => {
    const r = summarizeEmployee(
      [
        rec({ hoursWorked: 8 }),
        rec({ date: new Date('2026-05-05'), hoursWorked: 9.5 }),
        rec({ date: new Date('2026-05-06'), hoursWorked: 7 }),
      ],
      { expectedWorkDays: 22 },
    );
    // 8 + 8 (capped) + 7 = 23
    expect(r.regularHours).toBe(23);
    expect(r.otHours).toBe(0);
  });

  test('LATE records add a lateDay AND regular hours', () => {
    const r = summarizeEmployee(
      [
        rec({ status: 'LATE', hoursWorked: 7.25 }),
        rec({ date: new Date('2026-05-05'), status: 'LATE', hoursWorked: 7.5 }),
      ],
      { expectedWorkDays: 22 },
    );
    expect(r.lateDays).toBe(2);
    expect(r.regularHours).toBe(14.75);
  });

  test('HALF_DAY records contribute up to hoursPerDay/2 and bump halfDayDays', () => {
    const r = summarizeEmployee(
      [rec({ status: 'HALF_DAY', hoursWorked: 5 })], // capped at 4
      { expectedWorkDays: 22 },
    );
    expect(r.halfDayDays).toBe(1);
    expect(r.regularHours).toBe(4);
  });

  test('ABSENT bumps absentDays but adds no hours', () => {
    const r = summarizeEmployee(
      [
        rec({ status: 'ABSENT' }),
        rec({ date: new Date('2026-05-05'), status: 'ABSENT' }),
        rec({ date: new Date('2026-05-06'), status: 'PRESENT', hoursWorked: 8 }),
      ],
      { expectedWorkDays: 22 },
    );
    expect(r.absentDays).toBe(2);
    expect(r.regularHours).toBe(8);
  });

  test('ON_LEAVE rows are ignored (leave engine handles them)', () => {
    const r = summarizeEmployee(
      [rec({ status: 'ON_LEAVE', hoursWorked: 8 })],
      { expectedWorkDays: 22 },
    );
    expect(r.regularHours).toBe(0);
    expect(r.absentDays).toBe(0);
  });

  test('OT total respects the 72h monthly cap; uncapped exposed as rawOtHours', () => {
    const records = [];
    for (let i = 0; i < 20; i++) records.push(rec({ otHours: 5 })); // 100h uncapped
    const r = summarizeEmployee(records, { expectedWorkDays: 22 });
    expect(r.rawOtHours).toBe(100);
    expect(r.otHours).toBe(DEFAULT_OT_MONTHLY_CAP);
    expect(r.otCapped).toBe(true);
  });

  test('OT total below cap is reported verbatim', () => {
    const r = summarizeEmployee(
      [rec({ otHours: 3 }), rec({ date: new Date('2026-05-05'), otHours: 2.5 })],
      { expectedWorkDays: 22 },
    );
    expect(r.otHours).toBe(5.5);
    expect(r.otCapped).toBe(false);
  });

  test('PUBLIC_HOLIDAY with hours worked → phWorkedDays + regular hours', () => {
    const r = summarizeEmployee(
      [
        rec({ date: new Date('2026-05-01'), status: 'PUBLIC_HOLIDAY', hoursWorked: 8 }),
        rec({ date: new Date('2026-05-02'), status: 'PUBLIC_HOLIDAY', hoursWorked: 0 }),
      ],
      { expectedWorkDays: 22 },
    );
    expect(r.phWorkedDays).toBe(1);
    expect(r.regularHours).toBe(8);
  });

  test('PRESENT on a PH date (per holidaySet) also counts as PH worked', () => {
    const r = summarizeEmployee(
      [rec({ date: new Date('2026-05-01'), status: 'PRESENT', hoursWorked: 8 })],
      { expectedWorkDays: 22, holidaySet: new Set(['2026-05-01']) },
    );
    expect(r.phWorkedDays).toBe(1);
    expect(r.regularHours).toBe(8);
  });

  test('empty record list returns zeroed summary with expected days echoed back', () => {
    const r = summarizeEmployee([], { expectedWorkDays: 22 });
    expect(r).toEqual({
      expectedWorkDays: 22,
      regularHours: 0,
      otHours: 0,
      rawOtHours: 0,
      otCapped: false,
      absentDays: 0,
      lateDays: 0,
      halfDayDays: 0,
      phWorkedDays: 0,
    });
  });

  test('rejects non-numeric expectedWorkDays', () => {
    expect(() => summarizeEmployee([], { expectedWorkDays: 'oops' })).toThrow(/non-negative/);
  });
});

describe('summarizeEmployee() — TAT-005 billable-hours precedence', () => {
  test('billableHours present → used instead of raw hoursWorked', () => {
    // raw says 10h worked but only 7.5h are billable after clipping unapproved time
    const r = summarizeEmployee(
      [rec({ status: 'PRESENT', hoursWorked: 10, billableHours: 7.5, billableOtHours: 0 })],
      { expectedWorkDays: 22 },
    );
    expect(r.regularHours).toBe(7.5);
    expect(r.otHours).toBe(0);
  });

  test('billableOtHours present → used instead of raw otHours', () => {
    const r = summarizeEmployee(
      [rec({ status: 'PRESENT', hoursWorked: 12, otHours: 4, billableHours: 9, billableOtHours: 1 })],
      { expectedWorkDays: 22 },
    );
    // raw OT 4 capped to billable 1
    expect(r.otHours).toBe(1);
    // regular hours capped at hoursPerDay=8 even though billable says 9
    expect(r.regularHours).toBe(8);
  });

  test('legacy rows without billableHours fall back to raw', () => {
    const r = summarizeEmployee(
      [rec({ status: 'PRESENT', hoursWorked: 8, otHours: 1.5 })], // no billable* fields
      { expectedWorkDays: 22 },
    );
    expect(r.regularHours).toBe(8);
    expect(r.otHours).toBe(1.5);
  });

  test('billableHours=0 (clipped to nothing) counts as legitimate billable', () => {
    const r = summarizeEmployee(
      [rec({ status: 'PRESENT', hoursWorked: 1, billableHours: 0, billableOtHours: 0 })],
      { expectedWorkDays: 22 },
    );
    // billable says 0 — must not fall back to raw 1
    expect(r.regularHours).toBe(0);
  });
});

describe('summarizeAll()', () => {
  test('groups records by employeeId and summarizes each', () => {
    const records = [
      { employeeId: 'emp-A', date: new Date('2026-05-04'), status: 'PRESENT', hoursWorked: 8, otHours: 1 },
      { employeeId: 'emp-A', date: new Date('2026-05-05'), status: 'ABSENT',  hoursWorked: 0, otHours: 0 },
      { employeeId: 'emp-B', date: new Date('2026-05-04'), status: 'LATE',    hoursWorked: 7, otHours: 0 },
    ];
    const r = summarizeAll(records, { expectedWorkDays: 22 });
    expect(Object.keys(r).sort()).toEqual(['emp-A', 'emp-B']);
    expect(r['emp-A'].regularHours).toBe(8);
    expect(r['emp-A'].absentDays).toBe(1);
    expect(r['emp-A'].otHours).toBe(1);
    expect(r['emp-B'].lateDays).toBe(1);
  });

  test('employeeIds opt-in adds zero summaries for employees with no records', () => {
    const r = summarizeAll([], { expectedWorkDays: 22, employeeIds: ['emp-X'] });
    expect(r['emp-X']).toBeDefined();
    expect(r['emp-X'].regularHours).toBe(0);
    expect(r['emp-X'].expectedWorkDays).toBe(22);
  });
});
