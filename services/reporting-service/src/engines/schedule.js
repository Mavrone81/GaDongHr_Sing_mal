'use strict';
/**
 * RPT-003 Phase 1 — schedule next-run calculator.
 *
 * Pure function. Given the previous nextRunAt + frequency, returns the next
 * one. Frequencies fire at 02:00 SGT (= 18:00 UTC the previous day) — outside
 * business hours, but before East-coast morning so emails land overnight.
 *
 * DAILY    → +1 day
 * WEEKLY   → +7 days (same weekday)
 * MONTHLY  → +1 calendar month (same day of month, clamped to month length)
 */

const RUN_HOUR_UTC = 18; // 02:00 SGT
const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'];

function startOfNextRunSlot(now) {
  const d = new Date(now);
  const target = new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    RUN_HOUR_UTC, 0, 0, 0,
  ));
  if (target <= d) target.setUTCDate(target.getUTCDate() + 1);
  return target;
}

function nextRunAt(frequency, previous) {
  if (!FREQUENCIES.includes(frequency)) {
    throw new Error(`frequency must be one of: ${FREQUENCIES.join(', ')}`);
  }
  const base = previous instanceof Date ? new Date(previous) : new Date(previous);
  if (Number.isNaN(base.getTime())) throw new Error('previous must be a valid date');
  const next = new Date(base);
  switch (frequency) {
    case 'DAILY':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'MONTHLY': {
      const day = next.getUTCDate();
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + 1);
      // Clamp to last day of target month
      const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
      next.setUTCDate(Math.min(day, last));
      break;
    }
  }
  return next;
}

/**
 * For initial schedule creation: pick the first nextRunAt = the next 02:00 SGT
 * boundary, then optionally bumped forward to align with frequency expectations.
 * For simplicity we always start at the next 02:00 SGT slot.
 */
function firstRunAt(now = new Date()) {
  return startOfNextRunSlot(now);
}

module.exports = { FREQUENCIES, RUN_HOUR_UTC, nextRunAt, firstRunAt, startOfNextRunSlot };
