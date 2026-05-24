'use strict';
/**
 * Unit tests for src/engines/ir21.engine.js
 *
 * Covers:
 *   - computeIr21Deadline        (30-day lead rule)
 *   - daysUntilDeadline          (positive, zero, negative)
 *   - classifyDeadlineUrgency    (OVERDUE / CRITICAL / WARNING / OK)
 *   - shouldWithholdPay          (status matrix × isForeign)
 *   - buildDashboardEntry        (composite output)
 */

const {
  computeIr21Deadline,
  daysUntilDeadline,
  classifyDeadlineUrgency,
  shouldWithholdPay,
  buildDashboardEntry,
  IR21_FILING_LEAD_DAYS,
} = require('../src/engines/ir21.engine');

// ── computeIr21Deadline ───────────────────────────────────────────────────────
describe('computeIr21Deadline', () => {
  test('deadline is exactly 30 days before LWD', () => {
    const lwd = new Date('2026-06-30T00:00:00Z');
    const deadline = computeIr21Deadline(lwd);
    const diffDays = (lwd - deadline) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(IR21_FILING_LEAD_DAYS);
  });

  test('handles end-of-month LWD across month boundary', () => {
    const lwd = new Date('2026-03-31T00:00:00Z');
    const deadline = computeIr21Deadline(lwd);
    expect(deadline.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  test('handles leap year', () => {
    const lwd = new Date('2028-02-29T00:00:00Z');
    const deadline = computeIr21Deadline(lwd);
    // 29 Feb − 30 days = 30 Jan
    expect(deadline.toISOString().slice(0, 10)).toBe('2028-01-30');
  });

  test('handles new year boundary', () => {
    const lwd = new Date('2026-01-15T00:00:00Z');
    const deadline = computeIr21Deadline(lwd);
    // 15 Jan − 30 days = 16 Dec previous year
    expect(deadline.toISOString().slice(0, 10)).toBe('2025-12-16');
  });

  test('accepts string date input', () => {
    const deadline = computeIr21Deadline('2026-07-01');
    expect(deadline).toBeInstanceOf(Date);
    expect(deadline.toISOString().slice(0, 10)).toBe('2026-06-01');
  });
});

// ── daysUntilDeadline ─────────────────────────────────────────────────────────
describe('daysUntilDeadline', () => {
  function makeDeadline(offsetDays) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d;
  }

  test('returns positive when deadline is in the future', () => {
    expect(daysUntilDeadline(makeDeadline(10))).toBe(10);
  });

  test('returns 0 when deadline is today', () => {
    expect(daysUntilDeadline(makeDeadline(0))).toBe(0);
  });

  test('returns negative when deadline has passed', () => {
    expect(daysUntilDeadline(makeDeadline(-5))).toBe(-5);
  });

  test('returns 1 for deadline tomorrow', () => {
    expect(daysUntilDeadline(makeDeadline(1))).toBe(1);
  });
});

// ── classifyDeadlineUrgency ───────────────────────────────────────────────────
describe('classifyDeadlineUrgency', () => {
  test('OVERDUE when days < 0', () => {
    expect(classifyDeadlineUrgency(-1)).toBe('OVERDUE');
    expect(classifyDeadlineUrgency(-30)).toBe('OVERDUE');
  });

  test('CRITICAL when 0-7 days', () => {
    expect(classifyDeadlineUrgency(0)).toBe('CRITICAL');
    expect(classifyDeadlineUrgency(7)).toBe('CRITICAL');
  });

  test('WARNING when 8-14 days', () => {
    expect(classifyDeadlineUrgency(8)).toBe('WARNING');
    expect(classifyDeadlineUrgency(14)).toBe('WARNING');
  });

  test('OK when > 14 days', () => {
    expect(classifyDeadlineUrgency(15)).toBe('OK');
    expect(classifyDeadlineUrgency(60)).toBe('OK');
  });
});

// ── shouldWithholdPay ─────────────────────────────────────────────────────────
describe('shouldWithholdPay', () => {
  test('false for local employees regardless of ir21Status', () => {
    expect(shouldWithholdPay(false, 'PENDING')).toBe(false);
    expect(shouldWithholdPay(false, 'SUBMITTED')).toBe(false);
    expect(shouldWithholdPay(false, null)).toBe(false);
  });

  test('true for foreign employee with PENDING status', () => {
    expect(shouldWithholdPay(true, 'PENDING')).toBe(true);
  });

  test('true for foreign employee with SUBMITTED status', () => {
    expect(shouldWithholdPay(true, 'SUBMITTED')).toBe(true);
  });

  test('false for foreign employee with CLEARANCE_ISSUED', () => {
    expect(shouldWithholdPay(true, 'CLEARANCE_ISSUED')).toBe(false);
  });

  test('false for foreign employee with NOT_REQUIRED', () => {
    expect(shouldWithholdPay(true, 'NOT_REQUIRED')).toBe(false);
  });

  test('false for foreign employee with PAYRELEASED', () => {
    expect(shouldWithholdPay(true, 'PAYRELEASED')).toBe(false);
  });
});

// ── buildDashboardEntry ───────────────────────────────────────────────────────
describe('buildDashboardEntry', () => {
  function makeCase(overrides = {}) {
    const lwd = new Date('2026-08-31T00:00:00Z');
    return {
      id: 'case-001',
      employeeId: 'emp-001',
      employeeName: 'John Doe',
      department: 'Engineering',
      lastWorkingDate: lwd,
      ir21Status: 'SUBMITTED',
      ir21DeadlineDate: computeIr21Deadline(lwd),
      ir21FiledAt: new Date('2026-07-25T00:00:00Z'),
      ir21ClearedAt: null,
      moniesWithheld: true,
      ir21FormData: { employmentIncome: 50000 },
      ...overrides,
    };
  }

  test('sets formPopulated=true when ir21FormData exists', () => {
    const entry = buildDashboardEntry(makeCase());
    expect(entry.formPopulated).toBe(true);
  });

  test('sets formPopulated=false when ir21FormData is null', () => {
    const entry = buildDashboardEntry(makeCase({ ir21FormData: null }));
    expect(entry.formPopulated).toBe(false);
  });

  test('computes daysUntilDeadline and urgency', () => {
    // deadline in the past → OVERDUE
    const pastDeadline = new Date('2020-01-01T00:00:00Z');
    const entry = buildDashboardEntry(makeCase({ ir21DeadlineDate: pastDeadline }));
    expect(entry.daysUntilDeadline).toBeLessThan(0);
    expect(entry.urgency).toBe('OVERDUE');
  });

  test('sets urgency=null when ir21DeadlineDate is null', () => {
    const entry = buildDashboardEntry(makeCase({ ir21DeadlineDate: null }));
    expect(entry.urgency).toBeNull();
    expect(entry.daysUntilDeadline).toBeNull();
  });

  test('includes all required dashboard fields', () => {
    const entry = buildDashboardEntry(makeCase());
    expect(entry).toMatchObject({
      id: 'case-001',
      employeeId: 'emp-001',
      employeeName: 'John Doe',
      department: 'Engineering',
      ir21Status: 'SUBMITTED',
      moniesWithheld: true,
    });
  });
});
