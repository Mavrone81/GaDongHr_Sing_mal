'use strict';

const { daysUntil, thresholdsToFire, planSweep, THRESHOLDS } =
  require('../src/engines/cert-reminder.engine');

const NOW = new Date('2026-05-24T00:00:00Z');
const addDays = (d) => new Date(NOW.getTime() + d * 86400000);

describe('cert-reminder.engine', () => {
  describe('THRESHOLDS', () => {
    test('exposes 90/60/30 day thresholds', () => {
      expect(THRESHOLDS).toEqual([90, 60, 30]);
    });
  });

  describe('daysUntil', () => {
    test('returns positive days for future expiry', () => {
      expect(daysUntil(addDays(30), NOW)).toBe(30);
      expect(daysUntil(addDays(60), NOW)).toBe(60);
      expect(daysUntil(addDays(91), NOW)).toBe(91);
    });
    test('returns negative for past expiry', () => {
      expect(daysUntil(addDays(-1), NOW)).toBeLessThan(0);
    });
    test('returns Infinity for null expiresAt', () => {
      expect(daysUntil(null, NOW)).toBe(Infinity);
    });
  });

  describe('thresholdsToFire', () => {
    test('fires nothing when expiry is more than 90 days out', () => {
      const cert = { expiresAt: addDays(120), status: 'ACTIVE' };
      expect(thresholdsToFire(cert, [], NOW)).toEqual([]);
    });

    test('fires only 90 when 90-day window crossed', () => {
      const cert = { expiresAt: addDays(85), status: 'ACTIVE' };
      expect(thresholdsToFire(cert, [], NOW)).toEqual([90]);
    });

    test('fires 90+60 when 60-day window crossed and nothing fired yet', () => {
      const cert = { expiresAt: addDays(55), status: 'ACTIVE' };
      expect(thresholdsToFire(cert, [], NOW)).toEqual([90, 60]);
    });

    test('fires 90+60+30 when 30-day window crossed and nothing fired yet', () => {
      const cert = { expiresAt: addDays(15), status: 'ACTIVE' };
      expect(thresholdsToFire(cert, [], NOW)).toEqual([90, 60, 30]);
    });

    test('does not re-fire thresholds that already fired', () => {
      const cert = { expiresAt: addDays(55), status: 'ACTIVE' };
      expect(thresholdsToFire(cert, [90], NOW)).toEqual([60]);
      expect(thresholdsToFire(cert, [90, 60], NOW)).toEqual([]);
    });

    test('skips REVOKED certs entirely', () => {
      const cert = { expiresAt: addDays(15), status: 'REVOKED' };
      expect(thresholdsToFire(cert, [], NOW)).toEqual([]);
    });

    test('skips already-expired certs (no reminder spam after expiry)', () => {
      const cert = { expiresAt: addDays(-5), status: 'ACTIVE' };
      expect(thresholdsToFire(cert, [], NOW)).toEqual([]);
    });

    test('catches up missed thresholds — 90 fires even though 60 not yet crossed', () => {
      // Imagine the sweep never ran during the 90-day window, then runs at day-55.
      // Both 90 and 60 should fire on this run.
      const cert = { expiresAt: addDays(55), status: 'ACTIVE' };
      expect(thresholdsToFire(cert, [], NOW)).toEqual([90, 60]);
    });
  });

  describe('planSweep', () => {
    test('produces a reminder per crossed threshold across multiple certs', () => {
      const certs = [
        { id: 'c1', employeeId: 'e1', certName: 'CPR', expiresAt: addDays(20), status: 'ACTIVE', firedThresholds: [] },
        { id: 'c2', employeeId: 'e2', certName: 'OSHA', expiresAt: addDays(80), status: 'ACTIVE', firedThresholds: [] },
        { id: 'c3', employeeId: 'e3', certName: 'AED', expiresAt: addDays(120), status: 'ACTIVE', firedThresholds: [] },
      ];
      const { reminders } = planSweep(certs, NOW);
      // c1: 90+60+30 (all crossed). c2: 90 only. c3: none.
      expect(reminders).toHaveLength(4);
      expect(reminders.filter(r => r.certId === 'c1').map(r => r.threshold)).toEqual([90, 60, 30]);
      expect(reminders.filter(r => r.certId === 'c2').map(r => r.threshold)).toEqual([90]);
      expect(reminders.filter(r => r.certId === 'c3')).toEqual([]);
    });

    test('records actual daysUntil on each reminder row', () => {
      const certs = [{ id: 'c1', employeeId: 'e1', certName: 'CPR', expiresAt: addDays(20), status: 'ACTIVE', firedThresholds: [] }];
      const { reminders } = planSweep(certs, NOW);
      reminders.forEach(r => expect(r.daysUntil).toBe(20));
    });

    test('auto-nominates exactly once per cert — only on the 60-day crossing', () => {
      // Cert crosses 90 and 60 simultaneously this sweep → one nomination.
      const certs = [{
        id: 'c1', employeeId: 'e1', certName: 'CPR',
        expiresAt: addDays(55), status: 'ACTIVE', renewalProgramId: 'p1',
        firedThresholds: [],
      }];
      const { nominations } = planSweep(certs, NOW);
      expect(nominations).toHaveLength(1);
      expect(nominations[0]).toEqual({ employeeId: 'e1', programId: 'p1', certId: 'c1' });
    });

    test('does NOT re-nominate when 30-day fires later (60 already fired)', () => {
      const certs = [{
        id: 'c1', employeeId: 'e1', certName: 'CPR',
        expiresAt: addDays(20), status: 'ACTIVE', renewalProgramId: 'p1',
        firedThresholds: [90, 60],
      }];
      const { reminders, nominations } = planSweep(certs, NOW);
      expect(reminders.map(r => r.threshold)).toEqual([30]);
      expect(nominations).toEqual([]);
    });

    test('does NOT nominate when only 90-day fires (employee gets warning, not enrolled yet)', () => {
      const certs = [{
        id: 'c1', employeeId: 'e1', certName: 'CPR',
        expiresAt: addDays(85), status: 'ACTIVE', renewalProgramId: 'p1',
        firedThresholds: [],
      }];
      const { reminders, nominations } = planSweep(certs, NOW);
      expect(reminders.map(r => r.threshold)).toEqual([90]);
      expect(nominations).toEqual([]);
    });

    test('does NOT nominate cert without renewalProgramId', () => {
      const certs = [{
        id: 'c1', employeeId: 'e1', certName: 'CPR',
        expiresAt: addDays(55), status: 'ACTIVE', renewalProgramId: null,
        firedThresholds: [],
      }];
      const { nominations } = planSweep(certs, NOW);
      expect(nominations).toEqual([]);
    });

    test('idempotent — re-running same sweep with thresholds now recorded yields no output', () => {
      const certs = [{
        id: 'c1', employeeId: 'e1', certName: 'CPR',
        expiresAt: addDays(20), status: 'ACTIVE', renewalProgramId: 'p1',
        firedThresholds: [90, 60, 30],
      }];
      const { reminders, nominations } = planSweep(certs, NOW);
      expect(reminders).toEqual([]);
      expect(nominations).toEqual([]);
    });
  });
});
