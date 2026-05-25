'use strict';
/**
 * Unit tests for REC-003 workpass.engine.js — pure functions, no DB.
 */

const {
  ALERT_THRESHOLDS,
  daysUntilExpiry,
  pendingAlerts,
  urgencyBand,
  isForeignPass,
  consumesDrcQuota,
  computeDrcUsage,
  defaultRenewalChecklist,
} = require('../src/engines/workpass.engine');

const NOW = new Date('2026-05-25T00:00:00Z');

describe('daysUntilExpiry', () => {
  test('positive for future expiry', () => {
    expect(daysUntilExpiry(new Date('2026-08-23T00:00:00Z'), NOW)).toBe(90);
  });
  test('0 for same day', () => {
    expect(daysUntilExpiry(new Date('2026-05-25T15:00:00Z'), NOW)).toBe(0);
  });
  test('negative for past expiry', () => {
    expect(daysUntilExpiry(new Date('2026-05-20T00:00:00Z'), NOW)).toBe(-5);
  });
  test('handles null gracefully', () => {
    expect(daysUntilExpiry(null, NOW)).toBe(Infinity);
  });
});

describe('urgencyBand', () => {
  test('classifies bands correctly', () => {
    expect(urgencyBand(-1)).toBe('EXPIRED');
    expect(urgencyBand(0)).toBe('CRITICAL');
    expect(urgencyBand(30)).toBe('CRITICAL');
    expect(urgencyBand(31)).toBe('WARNING');
    expect(urgencyBand(60)).toBe('WARNING');
    expect(urgencyBand(90)).toBe('NOTICE');
    expect(urgencyBand(120)).toBe('OK');
  });
});

describe('pendingAlerts', () => {
  function pass(expiry, over = {}) {
    return { id: 'wp1', employeeId: 'e1', passType: 'WP', passNumber: 'WP1234', expiryDate: new Date(expiry), status: 'ACTIVE', ...over };
  }
  test('returns no alerts when > 90 days out', () => {
    const alerts = pendingAlerts(pass('2026-09-30T00:00:00Z'), NOW); // 128 days
    expect(alerts).toHaveLength(0);
  });
  test('fires 90-day alert when expiry is 90 days out', () => {
    const alerts = pendingAlerts(pass('2026-08-23T00:00:00Z'), NOW);
    expect(alerts.map(a => a.threshold)).toEqual([90]);
  });
  test('fires 90 + 60 when expiry is 60 days out', () => {
    const alerts = pendingAlerts(pass('2026-07-24T00:00:00Z'), NOW); // 60 days
    expect(alerts.map(a => a.threshold).sort((a, b) => b - a)).toEqual([90, 60]);
  });
  test('fires 90 + 60 + 30 when expiry is 30 days out', () => {
    const alerts = pendingAlerts(pass('2026-06-24T00:00:00Z'), NOW); // 30 days
    expect(alerts.map(a => a.threshold).sort((a, b) => b - a)).toEqual([90, 60, 30]);
  });
  test('fires all thresholds including 0 once expired', () => {
    const alerts = pendingAlerts(pass('2026-05-24T00:00:00Z'), NOW); // -1 day
    expect(alerts.map(a => a.threshold).sort((a, b) => b - a)).toEqual([90, 60, 30, 0]);
    const expired = alerts.find(a => a.threshold === 0);
    expect(expired.message).toMatch(/EXPIRED/);
  });
  test('skips CANCELLED passes entirely', () => {
    expect(pendingAlerts(pass('2026-06-01T00:00:00Z', { status: 'CANCELLED' }), NOW)).toHaveLength(0);
  });
  test('message at 0-day-out reads "expires TODAY"', () => {
    const alerts = pendingAlerts(pass('2026-05-25T15:00:00Z'), NOW);
    const today = alerts.find(a => a.threshold === 0);
    expect(today.message).toMatch(/TODAY/);
  });
});

describe('isForeignPass / consumesDrcQuota', () => {
  test('foreign pass types', () => {
    expect(isForeignPass('WP')).toBe(true);
    expect(isForeignPass('S_PASS')).toBe(true);
    expect(isForeignPass('EP')).toBe(true);
    expect(isForeignPass('CITIZEN')).toBe(false);
  });
  test('only WP + S-Pass consume DRC quota', () => {
    expect(consumesDrcQuota('WP')).toBe(true);
    expect(consumesDrcQuota('S_PASS')).toBe(true);
    expect(consumesDrcQuota('EP')).toBe(false);  // EP holders don't consume DRC quota
    expect(consumesDrcQuota('SC')).toBe(false);
  });
});

describe('computeDrcUsage', () => {
  const configs = [
    { sector: 'SERVICES', workerTier: 'BASIC', ratioLimit: 0.35, alertThreshold: 0.85 },
    { sector: 'CONSTRUCTION', workerTier: 'BASIC', ratioLimit: 0.83, alertThreshold: 0.85 },
  ];
  test('OK when far below quota', () => {
    const passes = [
      { passType: 'WP', sector: 'SERVICES', workerTier: 'BASIC', status: 'ACTIVE' },
    ];
    const usage = computeDrcUsage({ workPasses: passes, totalHeadcount: 100, configs });
    const services = usage.find(u => u.sector === 'SERVICES');
    expect(services.foreignCount).toBe(1);
    expect(services.currentRatio).toBeCloseTo(0.01, 4);
    expect(services.status).toBe('OK');
  });
  test('APPROACHING when at 90% of cap (≥ 85% threshold)', () => {
    // SERVICES cap 0.35, 32 foreign workers / 100 = 0.32 → 91% utilisation
    const passes = Array.from({ length: 32 }, () => ({ passType: 'WP', sector: 'SERVICES', workerTier: 'BASIC', status: 'ACTIVE' }));
    const usage = computeDrcUsage({ workPasses: passes, totalHeadcount: 100, configs });
    const services = usage.find(u => u.sector === 'SERVICES');
    expect(services.status).toBe('APPROACHING');
  });
  test('BREACH when above cap', () => {
    const passes = Array.from({ length: 40 }, () => ({ passType: 'WP', sector: 'SERVICES', workerTier: 'BASIC', status: 'ACTIVE' }));
    const usage = computeDrcUsage({ workPasses: passes, totalHeadcount: 100, configs });
    const services = usage.find(u => u.sector === 'SERVICES');
    expect(services.status).toBe('BREACH');
    expect(services.message).toMatch(/exceeds/);
  });
  test('excludes EXPIRED / CANCELLED passes from count', () => {
    const passes = [
      { passType: 'WP', sector: 'SERVICES', workerTier: 'BASIC', status: 'ACTIVE' },
      { passType: 'WP', sector: 'SERVICES', workerTier: 'BASIC', status: 'EXPIRED' },
      { passType: 'WP', sector: 'SERVICES', workerTier: 'BASIC', status: 'CANCELLED' },
    ];
    const usage = computeDrcUsage({ workPasses: passes, totalHeadcount: 100, configs });
    expect(usage.find(u => u.sector === 'SERVICES').foreignCount).toBe(1);
  });
  test('excludes EP holders from DRC count', () => {
    const passes = [
      { passType: 'EP', sector: 'SERVICES', workerTier: 'BASIC', status: 'ACTIVE' },
      { passType: 'WP', sector: 'SERVICES', workerTier: 'BASIC', status: 'ACTIVE' },
    ];
    const usage = computeDrcUsage({ workPasses: passes, totalHeadcount: 100, configs });
    expect(usage.find(u => u.sector === 'SERVICES').foreignCount).toBe(1);
  });
  test('zero headcount returns OK rows with currentRatio=0', () => {
    const usage = computeDrcUsage({ workPasses: [{ passType: 'WP', sector: 'SERVICES' }], totalHeadcount: 0, configs });
    expect(usage[0].currentRatio).toBe(0);
    expect(usage[0].status).toBe('OK');
  });
});

describe('defaultRenewalChecklist', () => {
  test('returns base items for any pass type', () => {
    const items = defaultRenewalChecklist('EP');
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items).toEqual(expect.arrayContaining([
      expect.stringMatching(/MOM EPOL/),
      expect.stringMatching(/IPA letter/),
    ]));
  });
  test('adds medical exam + tier for WP', () => {
    const items = defaultRenewalChecklist('WP');
    expect(items).toEqual(expect.arrayContaining([expect.stringMatching(/medical/i), expect.stringMatching(/tier/i)]));
  });
  test('adds qualifications check for S_PASS', () => {
    const items = defaultRenewalChecklist('S_PASS');
    expect(items).toEqual(expect.arrayContaining([expect.stringMatching(/qualifications/i)]));
  });
});

describe('ALERT_THRESHOLDS export', () => {
  test('contains 90/60/30/0 in descending order', () => {
    expect(ALERT_THRESHOLDS).toEqual([90, 60, 30, 0]);
  });
});
