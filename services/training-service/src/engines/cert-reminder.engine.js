'use strict';
/**
 * Certification reminder engine (TRN-004).
 *
 * Reminders fire once per (cert, threshold). Thresholds: 90, 60, 30 days
 * before expiry. The scheduler runs daily; this module decides which
 * thresholds have crossed for each cert and returns a deterministic plan.
 *
 * Pure functions only — DB I/O lives in the route/scheduler caller.
 */

const THRESHOLDS = [90, 60, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(expiresAt, now) {
  if (!expiresAt) return Infinity;
  const diff = new Date(expiresAt).getTime() - now.getTime();
  // Ceil so an expiry 0.5 days away is still reported as "1 day". An expiry
  // 0.5 days in the past is reported as 0 — past-expiry handling is the
  // caller's job (we don't reminder-spam after expiry).
  return Math.ceil(diff / DAY_MS);
}

/**
 * Given one cert + the thresholds already-fired for it, return the list of
 * thresholds that should fire now.
 *
 * Rule: fire every threshold ≥ daysUntil that hasn't been fired yet, where
 * daysUntil ≤ threshold. That way if the scheduler misses a day, the 60-day
 * reminder still fires when we cross the 60-day line even if the 90-day one
 * was missed. (No catch-up retro-fire for thresholds the cert is already
 * past — once expiresAt is < 30 days, only the 30 reminder fires; not 60+90.)
 *
 * Actually simpler: fire each threshold T where daysUntil ≤ T AND threshold
 * not already sent. That gives idempotent crossings and correctly catches up
 * missed days.
 */
function thresholdsToFire(cert, alreadyFired, now) {
  if (!cert.expiresAt) return [];
  if (cert.status === 'REVOKED') return [];
  const d = daysUntil(cert.expiresAt, now);
  if (d < 0) return []; // already expired — no point reminding
  const fired = new Set(alreadyFired);
  return THRESHOLDS.filter(t => d <= t && !fired.has(t));
}

/**
 * Plan a full sweep over a list of certs. Each input cert must come with
 * { id, expiresAt, status, employeeId, renewalProgramId, firedThresholds: [] }.
 * Returns an ordered list of reminder rows to insert and a list of
 * auto-nomination upserts to perform (one per cert that has a renewal program
 * AND has crossed the 60-day threshold for the first time).
 *
 * Auto-nomination guardrail: trigger at the 60-day boundary only, so we
 * nominate once per cert lifecycle, not three times. The 30-day reminder
 * still fires for visibility, but doesn't re-enroll.
 */
function planSweep(certs, now) {
  const reminders = [];
  const nominations = [];
  for (const cert of certs) {
    const fire = thresholdsToFire(cert, cert.firedThresholds || [], now);
    const d = daysUntil(cert.expiresAt, now);
    for (const threshold of fire) {
      reminders.push({
        certId: cert.id,
        threshold,
        daysUntil: d,
        employeeId: cert.employeeId,
        certName: cert.certName,
      });
    }
    // Auto-nomination: only when the 60-day reminder has just fired this
    // sweep (not retroactively for 30 if 60 was already done).
    if (
      cert.renewalProgramId &&
      fire.includes(60) &&
      !(cert.firedThresholds || []).includes(60)
    ) {
      nominations.push({
        employeeId: cert.employeeId,
        programId: cert.renewalProgramId,
        certId: cert.id,
      });
    }
  }
  return { reminders, nominations };
}

module.exports = { THRESHOLDS, daysUntil, thresholdsToFire, planSweep };
