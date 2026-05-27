'use strict';
/**
 * Unit tests: FWA Engine (fwa.engine.js)
 *
 * FE-01  computeReviewDeadline — adds exactly 2 calendar months
 * FE-02  computeReviewDeadline — handles month-end overflow (Jan 31 → Mar 31)
 * FE-03  computeReviewDeadline — handles December → February rollover
 * FE-04  classifyDeadlineUrgency — OK when more than 14 days remain
 * FE-05  classifyDeadlineUrgency — WARNING when 14 days or fewer
 * FE-06  classifyDeadlineUrgency — CRITICAL when 7 days or fewer
 * FE-07  classifyDeadlineUrgency — OVERDUE when deadline has passed
 * FE-08  daysUntilDeadline — positive when future
 * FE-09  daysUntilDeadline — negative when overdue
 * FE-10  validateDetails — returns valid:true when details is null/undefined
 * FE-11  validateDetails — FLEXI_TIME rejects bad HH:MM format
 * FE-12  validateDetails — FLEXI_TIME accepts valid times
 * FE-13  validateDetails — FLEXI_LOAD rejects hoursPerWeek > 44
 * FE-14  validateDetails — FLEXI_LOAD rejects daysPerWeek > 5
 * FE-15  validateDetails — FLEXI_LOAD accepts valid values
 * FE-16  validateDetails — FLEXI_PLACE rejects wfhDaysPerWeek > 5
 * FE-17  validateDetails — FLEXI_PLACE accepts valid values
 * FE-18  validateDetails — unknown type returns invalid
 * FE-19  buildDashboardSummary — counts by status correctly
 * FE-20  buildDashboardSummary — counts overdue PENDING separately
 * FE-21  buildDashboardSummary — byType breakdown correct
 * FE-22  buildDashboardSummary — empty list returns all zeros
 * FE-23  findExpiredRequests — returns only PENDING past deadline
 * FE-24  findExpiredRequests — does not return future-deadline requests
 * FE-25  FWA_TYPES constant contains all 3 types
 */

const {
  FWA_TYPES,
  RESPONSE_MONTHS,
  computeReviewDeadline,
  classifyDeadlineUrgency,
  daysUntilDeadline,
  validateDetails,
  buildDashboardSummary,
  findExpiredRequests,
} = require('../src/engines/fwa.engine');

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysFromNow(n, base = new Date()) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function makeRequest(overrides = {}) {
  return {
    id:             'fwa-001',
    employeeId:     'emp-001',
    type:           'FLEXI_PLACE',
    status:         'PENDING',
    reviewDeadline: daysFromNow(30),
    createdAt:      new Date(),
    ...overrides,
  };
}

// ── FE-01 ──────────────────────────────────────────────────────────────────────
test('FE-01 computeReviewDeadline adds exactly 2 calendar months', () => {
  const base     = new Date('2026-01-15T00:00:00.000Z');
  const deadline = computeReviewDeadline(base);
  expect(deadline.getUTCFullYear()).toBe(2026);
  expect(deadline.getUTCMonth()).toBe(2); // March = index 2
  expect(deadline.getUTCDate()).toBe(15);
});

// ── FE-02 ──────────────────────────────────────────────────────────────────────
test('FE-02 computeReviewDeadline handles Jan 31 → Mar 31', () => {
  const base     = new Date('2026-01-31T00:00:00.000Z');
  const deadline = computeReviewDeadline(base);
  expect(deadline.getUTCMonth()).toBe(2); // March
  expect(deadline.getUTCDate()).toBe(31);
});

// ── FE-03 ──────────────────────────────────────────────────────────────────────
test('FE-03 computeReviewDeadline handles December to February rollover', () => {
  const base     = new Date('2025-12-01T00:00:00.000Z');
  const deadline = computeReviewDeadline(base);
  expect(deadline.getUTCFullYear()).toBe(2026);
  expect(deadline.getUTCMonth()).toBe(1); // February
});

// ── FE-04 ──────────────────────────────────────────────────────────────────────
test('FE-04 classifyDeadlineUrgency OK when >14 days remain', () => {
  const deadline = daysFromNow(30);
  expect(classifyDeadlineUrgency(deadline, new Date())).toBe('OK');
});

// ── FE-05 ──────────────────────────────────────────────────────────────────────
test('FE-05 classifyDeadlineUrgency WARNING when ≤14 days', () => {
  expect(classifyDeadlineUrgency(daysFromNow(14), new Date())).toBe('WARNING');
  expect(classifyDeadlineUrgency(daysFromNow(10), new Date())).toBe('WARNING');
});

// ── FE-06 ──────────────────────────────────────────────────────────────────────
test('FE-06 classifyDeadlineUrgency CRITICAL when ≤7 days', () => {
  expect(classifyDeadlineUrgency(daysFromNow(7), new Date())).toBe('CRITICAL');
  expect(classifyDeadlineUrgency(daysFromNow(1), new Date())).toBe('CRITICAL');
});

// ── FE-07 ──────────────────────────────────────────────────────────────────────
test('FE-07 classifyDeadlineUrgency OVERDUE when deadline has passed', () => {
  expect(classifyDeadlineUrgency(daysFromNow(-1), new Date())).toBe('OVERDUE');
  expect(classifyDeadlineUrgency(daysFromNow(-30), new Date())).toBe('OVERDUE');
});

// ── FE-08 ──────────────────────────────────────────────────────────────────────
test('FE-08 daysUntilDeadline positive for future deadline', () => {
  const days = daysUntilDeadline(daysFromNow(10), new Date());
  expect(days).toBe(10);
});

// ── FE-09 ──────────────────────────────────────────────────────────────────────
test('FE-09 daysUntilDeadline negative when overdue', () => {
  const days = daysUntilDeadline(daysFromNow(-5), new Date());
  expect(days).toBe(-5);
});

// ── FE-10 ──────────────────────────────────────────────────────────────────────
test('FE-10 validateDetails returns valid when details is null', () => {
  expect(validateDetails('FLEXI_TIME', null).valid).toBe(true);
  expect(validateDetails('FLEXI_LOAD', undefined).valid).toBe(true);
});

// ── FE-11 ──────────────────────────────────────────────────────────────────────
test('FE-11 validateDetails FLEXI_TIME rejects bad time format', () => {
  const r = validateDetails('FLEXI_TIME', { proposedStartTime: '9:00' });
  expect(r.valid).toBe(false);
  expect(r.reason).toMatch(/HH:MM/);
});

// ── FE-12 ──────────────────────────────────────────────────────────────────────
test('FE-12 validateDetails FLEXI_TIME accepts valid times', () => {
  expect(validateDetails('FLEXI_TIME', { proposedStartTime: '09:00', proposedEndTime: '18:00' }).valid).toBe(true);
});

// ── FE-13 ──────────────────────────────────────────────────────────────────────
test('FE-13 validateDetails FLEXI_LOAD rejects hoursPerWeek > 44', () => {
  const r = validateDetails('FLEXI_LOAD', { hoursPerWeek: 50 });
  expect(r.valid).toBe(false);
  expect(r.reason).toMatch(/hoursPerWeek/);
});

// ── FE-14 ──────────────────────────────────────────────────────────────────────
test('FE-14 validateDetails FLEXI_LOAD rejects daysPerWeek > 5', () => {
  const r = validateDetails('FLEXI_LOAD', { daysPerWeek: 6 });
  expect(r.valid).toBe(false);
});

// ── FE-15 ──────────────────────────────────────────────────────────────────────
test('FE-15 validateDetails FLEXI_LOAD accepts valid values', () => {
  expect(validateDetails('FLEXI_LOAD', { hoursPerWeek: 32, daysPerWeek: 4 }).valid).toBe(true);
});

// ── FE-16 ──────────────────────────────────────────────────────────────────────
test('FE-16 validateDetails FLEXI_PLACE rejects wfhDaysPerWeek > 5', () => {
  const r = validateDetails('FLEXI_PLACE', { wfhDaysPerWeek: 6 });
  expect(r.valid).toBe(false);
});

// ── FE-17 ──────────────────────────────────────────────────────────────────────
test('FE-17 validateDetails FLEXI_PLACE accepts valid values', () => {
  expect(validateDetails('FLEXI_PLACE', { wfhDaysPerWeek: 3 }).valid).toBe(true);
});

// ── FE-18 ──────────────────────────────────────────────────────────────────────
test('FE-18 validateDetails unknown type returns invalid', () => {
  const r = validateDetails('FLEXI_UNKNOWN', {});
  expect(r.valid).toBe(false);
});

// ── FE-19 ──────────────────────────────────────────────────────────────────────
test('FE-19 buildDashboardSummary counts by status correctly', () => {
  const requests = [
    makeRequest({ status: 'PENDING',   reviewDeadline: daysFromNow(30) }),
    makeRequest({ status: 'APPROVED',  reviewDeadline: daysFromNow(20) }),
    makeRequest({ status: 'REJECTED',  reviewDeadline: daysFromNow(20) }),
    makeRequest({ status: 'WITHDRAWN', reviewDeadline: daysFromNow(20) }),
  ];
  const s = buildDashboardSummary(requests, new Date());
  expect(s.pending).toBe(1);
  expect(s.approved).toBe(1);
  expect(s.rejected).toBe(1);
  expect(s.withdrawn).toBe(1);
  expect(s.total).toBe(4);
});

// ── FE-20 ──────────────────────────────────────────────────────────────────────
test('FE-20 buildDashboardSummary counts overdue PENDING separately', () => {
  const requests = [
    makeRequest({ status: 'PENDING', reviewDeadline: daysFromNow(-5) }), // overdue
    makeRequest({ status: 'PENDING', reviewDeadline: daysFromNow(10) }), // not overdue
  ];
  const s = buildDashboardSummary(requests, new Date());
  expect(s.pending).toBe(2);
  expect(s.overdue).toBe(1);
});

// ── FE-21 ──────────────────────────────────────────────────────────────────────
test('FE-21 buildDashboardSummary byType breakdown correct', () => {
  const requests = [
    makeRequest({ type: 'FLEXI_TIME' }),
    makeRequest({ type: 'FLEXI_TIME' }),
    makeRequest({ type: 'FLEXI_PLACE' }),
  ];
  const s = buildDashboardSummary(requests, new Date());
  expect(s.byType.FLEXI_TIME).toBe(2);
  expect(s.byType.FLEXI_PLACE).toBe(1);
  expect(s.byType.FLEXI_LOAD).toBe(0);
});

// ── FE-22 ──────────────────────────────────────────────────────────────────────
test('FE-22 buildDashboardSummary empty list returns all zeros', () => {
  const s = buildDashboardSummary([], new Date());
  expect(s.total).toBe(0);
  expect(s.pending).toBe(0);
  expect(s.overdue).toBe(0);
});

// ── FE-23 ──────────────────────────────────────────────────────────────────────
test('FE-23 findExpiredRequests returns PENDING requests past deadline', () => {
  const requests = [
    makeRequest({ id: 'overdue-1', status: 'PENDING', reviewDeadline: daysFromNow(-10) }),
    makeRequest({ id: 'future-1',  status: 'PENDING', reviewDeadline: daysFromNow(5) }),
  ];
  const expired = findExpiredRequests(requests, new Date());
  expect(expired).toHaveLength(1);
  expect(expired[0].id).toBe('overdue-1');
});

// ── FE-24 ──────────────────────────────────────────────────────────────────────
test('FE-24 findExpiredRequests does not return future-deadline requests', () => {
  const requests = [
    makeRequest({ status: 'PENDING', reviewDeadline: daysFromNow(1) }),
    makeRequest({ status: 'PENDING', reviewDeadline: daysFromNow(60) }),
  ];
  expect(findExpiredRequests(requests, new Date())).toHaveLength(0);
});

// ── FE-25 ──────────────────────────────────────────────────────────────────────
test('FE-25 FWA_TYPES contains all 3 MOM-defined types', () => {
  expect(FWA_TYPES).toContain('FLEXI_TIME');
  expect(FWA_TYPES).toContain('FLEXI_LOAD');
  expect(FWA_TYPES).toContain('FLEXI_PLACE');
  expect(FWA_TYPES).toHaveLength(3);
});

// ── Constant check ─────────────────────────────────────────────────────────────
test('RESPONSE_MONTHS is 2 per MOM mandate', () => {
  expect(RESPONSE_MONTHS).toBe(2);
});
