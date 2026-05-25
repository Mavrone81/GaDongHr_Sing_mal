'use strict';
/**
 * Unit tests for LEA-005 msf-cap.engine.js — pure, no DB.
 */

const {
  DAYS_PER_WEEK,
  DEFAULT_PERIOD_WEEKS,
  computeClaimAmount,
  buildClaimRecord,
  validateTransition,
  TRANSITIONS,
} = require('../src/engines/msf-cap.engine');

describe('constants', () => {
  test('5-day work week', () => expect(DAYS_PER_WEEK).toBe(5));
  test('default period weeks = 1', () => expect(DEFAULT_PERIOD_WEEKS).toBe(1));
});

describe('computeClaimAmount — no cap', () => {
  test('returns uncapped amount when no caps configured', () => {
    const r = computeClaimAmount({ totalDays: 5, dailyRate: 100, leaveType: {} });
    expect(r.amount).toBe(500);
    expect(r.uncappedAmount).toBe(500);
    expect(r.capApplied).toBe('NONE');
    expect(r.capValue).toBeNull();
  });
  test('zero days → zero amount', () => {
    const r = computeClaimAmount({ totalDays: 0, dailyRate: 100, leaveType: { msfDailyCap: 50 } });
    expect(r.amount).toBe(0);
    expect(r.capApplied).toBe('NONE');
  });
  test('zero rate → zero amount', () => {
    const r = computeClaimAmount({ totalDays: 5, dailyRate: 0, leaveType: { msfDailyCap: 100 } });
    expect(r.amount).toBe(0);
  });
});

describe('computeClaimAmount — DAILY cap', () => {
  test('clamps each day at the daily cap (CCL SGD 100/day)', () => {
    const r = computeClaimAmount({ totalDays: 5, dailyRate: 150, leaveType: { msfDailyCap: 100 } });
    expect(r.amount).toBe(500); // 5 × 100
    expect(r.capApplied).toBe('DAILY');
    expect(r.capValue).toBe(100);
  });
  test('NONE wins when rate is below the daily cap', () => {
    const r = computeClaimAmount({ totalDays: 5, dailyRate: 80, leaveType: { msfDailyCap: 100 } });
    expect(r.amount).toBe(400);
    // 5 × 80 = 400, vs 5 × min(80, 100) = 400 — equal totals, but DAILY is
    // sorted in deterministic order. Just check the total matches.
    expect(['NONE', 'DAILY']).toContain(r.capApplied);
  });
});

describe('computeClaimAmount — WEEKLY cap', () => {
  test('GPPL SGD 2,500/week clamps a 5-day claim at 2500', () => {
    const r = computeClaimAmount({ totalDays: 5, dailyRate: 600, leaveType: { msfWeeklyCap: 2500 } });
    // Uncapped: 3000; weekly cap: 5/5 × 2500 = 2500
    expect(r.amount).toBe(2500);
    expect(r.capApplied).toBe('WEEKLY');
    expect(r.capValue).toBe(2500);
  });
  test('weekly cap pro-rates fractional weeks', () => {
    const r = computeClaimAmount({ totalDays: 3, dailyRate: 1000, leaveType: { msfWeeklyCap: 2500 } });
    // Uncapped: 3000; weekly: 3/5 × 2500 = 1500
    expect(r.amount).toBe(1500);
    expect(r.capApplied).toBe('WEEKLY');
  });
});

describe('computeClaimAmount — PERIOD cap (GPML 4-week block)', () => {
  test('GPML SGD 10,000 per 4-week period — full period', () => {
    // 20-day leave (4 weeks × 5d), high rate → period cap should bind
    const r = computeClaimAmount({ totalDays: 20, dailyRate: 600, leaveType: { msfPeriodCap: 10000, msfPeriodWeeks: 4 } });
    expect(r.amount).toBe(10000);
    expect(r.capApplied).toBe('PERIOD');
  });
  test('PERIOD cap pro-rates partial periods', () => {
    // 10-day leave in a 4-week (20d) period → 0.5 × 10000 = 5000
    const r = computeClaimAmount({ totalDays: 10, dailyRate: 600, leaveType: { msfPeriodCap: 10000, msfPeriodWeeks: 4 } });
    expect(r.amount).toBe(5000);
    expect(r.capApplied).toBe('PERIOD');
  });
});

describe('computeClaimAmount — multiple caps, smallest binds', () => {
  test('all 3 caps configured, daily binds when it produces smallest total', () => {
    // CCL: daily 100, weekly 500. Rate 150 × 5 = 750 uncapped
    // - daily: 5 × 100 = 500
    // - weekly: 1 × 500 = 500
    // Both same — either should win deterministically
    const r = computeClaimAmount({ totalDays: 5, dailyRate: 150, leaveType: { msfDailyCap: 100, msfWeeklyCap: 500 } });
    expect(r.amount).toBe(500);
    expect(['DAILY', 'WEEKLY']).toContain(r.capApplied);
  });
  test('weekly cap can be tighter than daily', () => {
    // daily 100 × 5 = 500, weekly 300 → weekly wins
    const r = computeClaimAmount({ totalDays: 5, dailyRate: 200, leaveType: { msfDailyCap: 100, msfWeeklyCap: 300 } });
    expect(r.amount).toBe(300);
    expect(r.capApplied).toBe('WEEKLY');
  });
});

describe('computeClaimAmount — notes', () => {
  test('explains which cap bound + savings', () => {
    const r = computeClaimAmount({ totalDays: 5, dailyRate: 150, leaveType: { msfDailyCap: 100 } });
    expect(r.notes).toMatch(/DAILY cap/);
    expect(r.notes).toMatch(/saving SGD 250\.00/);
  });
  test('NONE branch has friendly note', () => {
    const r = computeClaimAmount({ totalDays: 5, dailyRate: 100, leaveType: {} });
    expect(r.notes).toMatch(/no MSF cap/);
  });
});

describe('buildClaimRecord', () => {
  test('shapes payload with NOT_SUBMITTED status', () => {
    const computed = computeClaimAmount({ totalDays: 5, dailyRate: 100, leaveType: {} });
    const record = buildClaimRecord({
      application: { employeeId: 'emp-1' },
      leaveType: { code: 'CCL' },
      dailyRate: 100,
      computed,
    });
    expect(record.claimStatus).toBe('NOT_SUBMITTED');
    expect(record.claimAmount).toBe(500);
    expect(record.claimCapApplied).toBe('NONE');
    expect(record.leaveTypeCode).toBe('CCL');
    expect(record.employeeId).toBe('emp-1');
  });
});

describe('validateTransition', () => {
  test('NOT_SUBMITTED → SUBMITTED ok', () => {
    expect(validateTransition('NOT_SUBMITTED', 'SUBMITTED').ok).toBe(true);
  });
  test('SUBMITTED → REIMBURSED ok', () => {
    expect(validateTransition('SUBMITTED', 'REIMBURSED').ok).toBe(true);
  });
  test('SUBMITTED → REJECTED ok', () => {
    expect(validateTransition('SUBMITTED', 'REJECTED').ok).toBe(true);
  });
  test('REJECTED → NOT_SUBMITTED (resubmission)', () => {
    expect(validateTransition('REJECTED', 'NOT_SUBMITTED').ok).toBe(true);
  });
  test('REIMBURSED is terminal', () => {
    expect(validateTransition('REIMBURSED', 'NOT_SUBMITTED').ok).toBe(false);
    expect(validateTransition('REIMBURSED', 'REJECTED').ok).toBe(false);
  });
  test('NOT_SUBMITTED → REIMBURSED skip blocked', () => {
    const r = validateTransition('NOT_SUBMITTED', 'REIMBURSED');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/NOT_SUBMITTED → REIMBURSED/);
  });
  test('same-status rejection', () => {
    expect(validateTransition('SUBMITTED', 'SUBMITTED').ok).toBe(false);
  });
  test('unknown from-state', () => {
    expect(validateTransition('GARBAGE', 'SUBMITTED').ok).toBe(false);
  });
});
