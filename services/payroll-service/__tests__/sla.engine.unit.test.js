'use strict';
/**
 * Unit tests for PAY-005 sla.engine.js — pure classifier, no DB.
 */

const { classifyRunSla, isAlertResolved, severityFor, daysBetween } = require('../src/engines/sla.engine');

const NOW = new Date('2026-05-25T00:00:00Z');

function run(over = {}) {
  return {
    id: 'r1', period: '2026-05', status: 'APPROVED',
    paymentDate: new Date('2026-06-07T00:00:00Z'),
    ...over,
  };
}

function ps(isPublished, publishedAt) {
  return { isPublished, publishedAt: publishedAt ? new Date(publishedAt) : null };
}

describe('severityFor', () => {
  test('ladders MEDIUM → HIGH → CRITICAL by daysLate', () => {
    expect(severityFor(0)).toBe('MEDIUM');
    expect(severityFor(1)).toBe('HIGH');
    expect(severityFor(2)).toBe('HIGH');
    expect(severityFor(3)).toBe('CRITICAL');
    expect(severityFor(10)).toBe('CRITICAL');
  });
});

describe('daysBetween', () => {
  test('handles UTC-day alignment', () => {
    expect(daysBetween(new Date('2026-05-26T23:59Z'), new Date('2026-05-25T00:00Z'))).toBe(1);
    expect(daysBetween(new Date('2026-05-25T00:00Z'), new Date('2026-05-25T23:59Z'))).toBe(0);
  });
});

describe('classifyRunSla — PAYMENT_DATE_APPROACHING', () => {
  test('fires within default 2-day window when not finalised', () => {
    const r = run({ paymentDate: new Date('2026-05-26T00:00Z'), status: 'APPROVED' });
    const alerts = classifyRunSla(r, [ps(false)], { now: NOW });
    expect(alerts.find(a => a.type === 'PAYMENT_DATE_APPROACHING')).toBeTruthy();
  });
  test('does NOT fire when run is already FINALISED', () => {
    const r = run({ paymentDate: new Date('2026-05-26T00:00Z'), status: 'FINALISED' });
    const alerts = classifyRunSla(r, [ps(true, '2026-05-20')], { now: NOW });
    expect(alerts.find(a => a.type === 'PAYMENT_DATE_APPROACHING')).toBeUndefined();
  });
  test('elevates to HIGH when payment date is TODAY', () => {
    const r = run({ paymentDate: new Date('2026-05-25T15:00Z'), status: 'APPROVED' });
    const alerts = classifyRunSla(r, [ps(false)], { now: NOW });
    const a = alerts.find(x => x.type === 'PAYMENT_DATE_APPROACHING');
    expect(a.severity).toBe('HIGH');
  });
});

describe('classifyRunSla — UNPUBLISHED_PAST_PAYMENT', () => {
  test('fires when paymentDate past and some payslips still unpublished', () => {
    const r = run({ paymentDate: new Date('2026-05-22T00:00Z'), status: 'APPROVED' });
    const alerts = classifyRunSla(r, [ps(true, '2026-05-22'), ps(false), ps(false)], { now: NOW });
    const a = alerts.find(x => x.type === 'UNPUBLISHED_PAST_PAYMENT');
    expect(a).toBeTruthy();
    expect(a.unpublishedCount).toBe(2);
    expect(a.daysOverdue).toBe(3);
    expect(a.severity).toBe('CRITICAL');
  });
  test('does NOT fire when all payslips published', () => {
    const r = run({ paymentDate: new Date('2026-05-22T00:00Z'), status: 'FINALISED' });
    const alerts = classifyRunSla(r, [ps(true, '2026-05-22'), ps(true, '2026-05-22')], { now: NOW });
    expect(alerts.find(x => x.type === 'UNPUBLISHED_PAST_PAYMENT')).toBeUndefined();
  });
});

describe('classifyRunSla — LATE_PUBLICATION', () => {
  test('fires when latest publishedAt > paymentDate', () => {
    const r = run({ paymentDate: new Date('2026-05-22T00:00Z'), status: 'FINALISED' });
    const alerts = classifyRunSla(r, [ps(true, '2026-05-23'), ps(true, '2026-05-24')], { now: NOW });
    const a = alerts.find(x => x.type === 'LATE_PUBLICATION');
    expect(a).toBeTruthy();
    expect(a.daysOverdue).toBe(2);
    expect(a.severity).toBe('HIGH');
  });
  test('does NOT fire when latest publishedAt ≤ paymentDate', () => {
    const r = run({ paymentDate: new Date('2026-05-25T00:00Z'), status: 'FINALISED' });
    const alerts = classifyRunSla(r, [ps(true, '2026-05-24')], { now: NOW });
    expect(alerts.find(x => x.type === 'LATE_PUBLICATION')).toBeUndefined();
  });
  test('returns empty when paymentDate is null', () => {
    const r = run({ paymentDate: null });
    expect(classifyRunSla(r, [ps(false)], { now: NOW })).toEqual([]);
  });
});

describe('isAlertResolved', () => {
  test('returns true when stored alert no longer in current classification', () => {
    const stored = { type: 'UNPUBLISHED_PAST_PAYMENT' };
    expect(isAlertResolved(stored, [{ type: 'LATE_PUBLICATION' }])).toBe(true);
  });
  test('returns false when alert still active', () => {
    const stored = { type: 'UNPUBLISHED_PAST_PAYMENT' };
    expect(isAlertResolved(stored, [{ type: 'UNPUBLISHED_PAST_PAYMENT' }])).toBe(false);
  });
});
