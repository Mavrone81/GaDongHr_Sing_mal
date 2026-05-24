'use strict';
// Pure logic for AST-003 asset / licence / return alert evaluation.

const THRESHOLDS = {
  WARRANTY:    [60, 30, 7],   // days before warranty expiry
  MAINTENANCE: [30, 14, 7],   // days before next scheduled maintenance
  RETURN:      [14, 7, 1],    // days before contract end / offboarding date
  LICENCE:     [60, 30, 7],   // days before software licence expiry
};

/**
 * Days remaining until `target`. Date-only comparison at UTC midnight.
 * Returns a positive integer for the future, 0 for today, negative for past.
 */
function daysUntil(target, now = new Date()) {
  if (!target) return null;
  const n = new Date(now);
  n.setUTCHours(0, 0, 0, 0);
  const t = new Date(target);
  t.setUTCHours(0, 0, 0, 0);
  return Math.ceil((t - n) / (1000 * 60 * 60 * 24));
}

/**
 * Pick the most-urgent (smallest) threshold the days-remaining value has
 * crossed into. A value of 20 days against [60,30,7] returns 30 — the 60-day
 * band is crossed and 30-day window also reached; 7 not yet.
 */
function bandFor(daysRemaining, thresholds) {
  if (daysRemaining < 0) return -1; // overdue
  let result = null;
  for (const t of thresholds) {
    if (daysRemaining <= t) {
      result = result === null ? t : Math.min(result, t);
    }
  }
  return result;
}

/**
 * Classify urgency colour for dashboard display.
 */
function classifyUrgency(daysRemaining) {
  if (daysRemaining == null) return 'NONE';
  if (daysRemaining < 0) return 'OVERDUE';
  if (daysRemaining <= 7) return 'CRITICAL';
  if (daysRemaining <= 30) return 'WARNING';
  return 'OK';
}

/**
 * Given an entity with a target date and a set of previously fired thresholds,
 * return the list of thresholds that should fire on this sweep. Idempotent:
 * thresholds already in `firedThresholds` are skipped.
 */
function pendingThresholds(daysRemaining, alertType, firedThresholds = []) {
  if (daysRemaining == null) return [];
  const thresholds = THRESHOLDS[alertType] || [];
  const fired = new Set(firedThresholds);
  const out = [];
  for (const t of thresholds) {
    if (daysRemaining <= t && daysRemaining >= 0 && !fired.has(t)) out.push(t);
  }
  return out;
}

/**
 * Build a human-readable alert message.
 */
function formatAlertMessage(alertType, entityLabel, daysRemaining) {
  const tense = daysRemaining < 0
    ? `expired ${Math.abs(daysRemaining)} day(s) ago`
    : (daysRemaining === 0 ? 'expires today' : `expires in ${daysRemaining} day(s)`);
  const verb = alertType === 'MAINTENANCE'
    ? (daysRemaining < 0 ? `maintenance overdue by ${Math.abs(daysRemaining)} day(s)` : (daysRemaining === 0 ? 'maintenance due today' : `maintenance due in ${daysRemaining} day(s)`))
    : alertType === 'RETURN'
    ? (daysRemaining < 0 ? `return overdue by ${Math.abs(daysRemaining)} day(s)` : (daysRemaining === 0 ? 'return due today' : `return due in ${daysRemaining} day(s)`))
    : tense;
  return `${alertType}: ${entityLabel} — ${verb}`;
}

module.exports = {
  THRESHOLDS,
  daysUntil,
  bandFor,
  classifyUrgency,
  pendingThresholds,
  formatAlertMessage,
};
