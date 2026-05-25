'use strict';
/**
 * Unit tests for PAY-007 iras-submission.engine.js — pure, no DB.
 */

const {
  KINDS,
  STATUSES,
  computeDeadline,
  classifyUrgency,
  validateTransition,
  buildScopeKey,
  buildTransitionPatch,
  daysBetween,
} = require('../src/engines/iras-submission.engine');

describe('constants', () => {
  test('KINDS whitelist', () => {
    expect(KINDS).toEqual(['CPF_E_SUBMIT', 'IR8A', 'APPENDIX_8A', 'APPENDIX_8B', 'IR21']);
  });
  test('STATUSES whitelist', () => {
    expect(STATUSES).toEqual(['DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'REJECTED']);
  });
});

describe('computeDeadline', () => {
  test('CPF_E_SUBMIT — 14th of month after period', () => {
    const d = computeDeadline('CPF_E_SUBMIT', { period: '2026-05' });
    expect(d.toISOString().slice(0, 10)).toBe('2026-06-14');
  });
  test('CPF_E_SUBMIT — December wraps to January', () => {
    const d = computeDeadline('CPF_E_SUBMIT', { period: '2026-12' });
    expect(d.toISOString().slice(0, 10)).toBe('2027-01-14');
  });
  test('CPF_E_SUBMIT — invalid period returns null', () => {
    expect(computeDeadline('CPF_E_SUBMIT', { period: '2026-13' })).toBeNull();
    expect(computeDeadline('CPF_E_SUBMIT', {})).toBeNull();
  });
  test('IR8A — 1 March of year after income year', () => {
    const d = computeDeadline('IR8A', { year: 2026 });
    expect(d.toISOString().slice(0, 10)).toBe('2027-03-01');
  });
  test('APPENDIX_8A / APPENDIX_8B — same as IR8A', () => {
    expect(computeDeadline('APPENDIX_8A', { year: 2026 }).toISOString().slice(0, 10)).toBe('2027-03-01');
    expect(computeDeadline('APPENDIX_8B', { year: 2026 }).toISOString().slice(0, 10)).toBe('2027-03-01');
  });
  test('IR21 — lastWorkingDate − 30 days', () => {
    const d = computeDeadline('IR21', { lastWorkingDate: '2026-06-30' });
    expect(d.toISOString().slice(0, 10)).toBe('2026-05-31');
  });
  test('IR21 — null when LWD missing', () => {
    expect(computeDeadline('IR21', {})).toBeNull();
  });
  test('unknown kind → null', () => {
    expect(computeDeadline('NOPE', {})).toBeNull();
  });
});

describe('classifyUrgency', () => {
  const NOW = new Date('2026-05-25T00:00:00Z');
  test('OVERDUE for past deadline', () => {
    const out = classifyUrgency(new Date('2026-05-20'), NOW);
    expect(out.urgency).toBe('OVERDUE');
    expect(out.daysUntilDeadline).toBe(-5);
  });
  test('CRITICAL within 3 days', () => {
    const out = classifyUrgency(new Date('2026-05-27'), NOW);
    expect(out.urgency).toBe('CRITICAL');
  });
  test('WARNING within 14 days', () => {
    const out = classifyUrgency(new Date('2026-06-05'), NOW);
    expect(out.urgency).toBe('WARNING');
  });
  test('NOTICE within 30 days', () => {
    const out = classifyUrgency(new Date('2026-06-20'), NOW);
    expect(out.urgency).toBe('NOTICE');
  });
  test('OK > 30 days out', () => {
    const out = classifyUrgency(new Date('2026-08-01'), NOW);
    expect(out.urgency).toBe('OK');
  });
  test('UNSCHEDULED for null deadline', () => {
    expect(classifyUrgency(null, NOW).urgency).toBe('UNSCHEDULED');
  });
});

describe('validateTransition', () => {
  test('DRAFT → SUBMITTED ok', () => {
    expect(validateTransition('DRAFT', 'SUBMITTED').ok).toBe(true);
  });
  test('DRAFT → ACKNOWLEDGED blocked', () => {
    const r = validateTransition('DRAFT', 'ACKNOWLEDGED');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/DRAFT → ACKNOWLEDGED/);
  });
  test('SUBMITTED → ACKNOWLEDGED ok', () => {
    expect(validateTransition('SUBMITTED', 'ACKNOWLEDGED').ok).toBe(true);
  });
  test('SUBMITTED → REJECTED ok', () => {
    expect(validateTransition('SUBMITTED', 'REJECTED').ok).toBe(true);
  });
  test('ACKNOWLEDGED is terminal', () => {
    expect(validateTransition('ACKNOWLEDGED', 'SUBMITTED').ok).toBe(false);
    expect(validateTransition('ACKNOWLEDGED', 'DRAFT').ok).toBe(false);
  });
  test('REJECTED → DRAFT allowed (resubmission)', () => {
    expect(validateTransition('REJECTED', 'DRAFT').ok).toBe(true);
  });
  test('rejects same-status transition', () => {
    expect(validateTransition('DRAFT', 'DRAFT').ok).toBe(false);
  });
  test('rejects unknown target', () => {
    expect(validateTransition('DRAFT', 'WHATEVER').ok).toBe(false);
  });
});

describe('buildScopeKey', () => {
  test('CPF_E_SUBMIT format', () => {
    expect(buildScopeKey('CPF_E_SUBMIT', { period: '2026-05' })).toBe('CPF_E_SUBMIT|2026-05');
  });
  test('IR8A format', () => {
    expect(buildScopeKey('IR8A', { year: 2026 })).toBe('IR8A|2026');
  });
  test('IR21 format', () => {
    expect(buildScopeKey('IR21', { employeeId: 'emp-1' })).toBe('IR21|emp-1');
  });
});

describe('buildTransitionPatch', () => {
  test('SUBMITTED stamps submittedAt + actor + reference', () => {
    const p = buildTransitionPatch('SUBMITTED', 'admin-1', { referenceNumber: 'CPF-12345' });
    expect(p.status).toBe('SUBMITTED');
    expect(p.submittedBy).toBe('admin-1');
    expect(p.submittedAt).toBeInstanceOf(Date);
    expect(p.referenceNumber).toBe('CPF-12345');
  });
  test('ACKNOWLEDGED stamps acknowledgedAt + actor', () => {
    const p = buildTransitionPatch('ACKNOWLEDGED', 'admin-1');
    expect(p.acknowledgedBy).toBe('admin-1');
    expect(p.acknowledgedAt).toBeInstanceOf(Date);
  });
  test('REJECTED stamps rejectedAt + reason', () => {
    const p = buildTransitionPatch('REJECTED', 'admin-1', { rejectedReason: 'malformed file' });
    expect(p.rejectedAt).toBeInstanceOf(Date);
    expect(p.rejectedReason).toBe('malformed file');
  });
  test('DRAFT (resubmission) clears rejected stamps', () => {
    const p = buildTransitionPatch('DRAFT', 'admin-1');
    expect(p.rejectedAt).toBeNull();
    expect(p.rejectedReason).toBeNull();
  });
});

describe('daysBetween — UTC-day aligned', () => {
  test('handles within-same-day', () => {
    expect(daysBetween(new Date('2026-05-25T23:59Z'), new Date('2026-05-25T00:00Z'))).toBe(0);
  });
});
