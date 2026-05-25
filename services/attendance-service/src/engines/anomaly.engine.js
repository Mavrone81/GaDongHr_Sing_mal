'use strict';
/**
 * TAT-004 attendance-anomaly engine.
 *
 * Pure classifier — given a single AttendanceRecord (plus optional schedule
 * + threshold config), returns the anomaly types that apply. No DB access.
 *
 * Anomaly types:
 *   LATE_ARRIVAL     — clockIn > scheduledStart + lateThresholdMin
 *   EARLY_DEPARTURE  — clockOut < scheduledEnd  by > earlyDepartThresholdMin
 *   MISSING_CLOCK_OUT — clockIn present, clockOut null, record date in past
 *   AWOL             — scheduled for the day but no clockIn at all,
 *                      status ∉ {ON_LEAVE, PUBLIC_HOLIDAY}
 *   EXCESSIVE_OT     — single-day OT hours ≥ dailyOtThresholdHours
 *
 * MONTHLY_OT_BREACH is handled separately by `detectMonthlyOtBreach()` — it
 * needs the whole period's records and is fired once per employee per period.
 */

const DEFAULT_THRESHOLDS = Object.freeze({
  lateThresholdMin:          15,   // any tardiness ≥ 15 min after schedule = flag
  earlyDepartThresholdMin:   15,   // leaving ≥ 15 min before schedule end = flag
  dailyOtThresholdHours:     4,    // > 4h OT in one day = flag (excessive single-day OT)
  monthlyOtAlertHours:       60,   // 60h cumulative monthly OT = alert (MOM 72h cap is hard)
  missingClockOutGraceHours: 2,    // record date considered "past" only after grace
});

const ANOMALY_TYPES = Object.freeze({
  LATE_ARRIVAL:       'LATE_ARRIVAL',
  EARLY_DEPARTURE:    'EARLY_DEPARTURE',
  MISSING_CLOCK_OUT:  'MISSING_CLOCK_OUT',
  AWOL:               'AWOL',
  EXCESSIVE_OT:       'EXCESSIVE_OT',
  MONTHLY_OT_BREACH:  'MONTHLY_OT_BREACH',
});

const SEVERITY = Object.freeze({
  LATE_ARRIVAL:      'LOW',
  EARLY_DEPARTURE:   'LOW',
  MISSING_CLOCK_OUT: 'MEDIUM',
  AWOL:              'HIGH',
  EXCESSIVE_OT:      'MEDIUM',
  MONTHLY_OT_BREACH: 'HIGH',
});

function diffMinutes(a, b) {
  return Math.round((new Date(a) - new Date(b)) / 60000);
}

/**
 * Merge caller thresholds onto defaults. Undefined / null fields fall back to
 * the default — values of 0 are honoured (a 0 grace means "any minute counts").
 */
function mergeThresholds(custom = {}) {
  const out = { ...DEFAULT_THRESHOLDS };
  for (const k of Object.keys(DEFAULT_THRESHOLDS)) {
    if (custom[k] != null && Number.isFinite(custom[k])) out[k] = custom[k];
  }
  return out;
}

/**
 * Detect per-record anomalies (everything except MONTHLY_OT_BREACH).
 *
 * @param {object} record   attendance row — must carry clockIn, clockOut,
 *                          scheduledStart, scheduledEnd, status, otHours, date
 * @param {object} opts
 * @param {object} [opts.thresholds]  override defaults
 * @param {Date}   [opts.now]         override "now" for tests/sweeps
 * @returns {Array<object>}  [{ type, severity, message, detail }, ...]
 */
function detectAnomaliesForRecord(record, opts = {}) {
  const thresholds = mergeThresholds(opts.thresholds);
  const now = opts.now ? new Date(opts.now) : new Date();
  const anomalies = [];
  if (!record) return anomalies;

  const status = record.status;
  const hasClockIn  = !!record.clockIn;
  const hasClockOut = !!record.clockOut;
  const hasSchedule = !!record.scheduledStart && !!record.scheduledEnd;

  // ── AWOL ────────────────────────────────────────────────────────────────────
  // Scheduled to work, no clock-in, not on leave/PH, and the scheduled day has
  // fully elapsed (now > scheduledEnd) so we don't false-flag a future-day roster.
  if (hasSchedule && !hasClockIn && status !== 'ON_LEAVE' && status !== 'PUBLIC_HOLIDAY') {
    if (now > new Date(record.scheduledEnd)) {
      anomalies.push({
        type: ANOMALY_TYPES.AWOL,
        severity: SEVERITY.AWOL,
        message: `No clock-in recorded for a scheduled work day`,
        detail: { scheduledStart: record.scheduledStart, scheduledEnd: record.scheduledEnd, status },
      });
    }
  }

  // ── LATE_ARRIVAL ────────────────────────────────────────────────────────────
  if (hasClockIn && hasSchedule) {
    const lateMin = Math.max(0, diffMinutes(record.clockIn, record.scheduledStart));
    if (lateMin >= thresholds.lateThresholdMin) {
      anomalies.push({
        type: ANOMALY_TYPES.LATE_ARRIVAL,
        severity: SEVERITY.LATE_ARRIVAL,
        message: `Clocked in ${lateMin} min after scheduled start`,
        detail: { lateMinutes: lateMin, threshold: thresholds.lateThresholdMin },
      });
    }
  }

  // ── EARLY_DEPARTURE ─────────────────────────────────────────────────────────
  if (hasClockOut && hasSchedule) {
    const earlyMin = Math.max(0, diffMinutes(record.scheduledEnd, record.clockOut));
    if (earlyMin >= thresholds.earlyDepartThresholdMin) {
      anomalies.push({
        type: ANOMALY_TYPES.EARLY_DEPARTURE,
        severity: SEVERITY.EARLY_DEPARTURE,
        message: `Clocked out ${earlyMin} min before scheduled end`,
        detail: { earlyMinutes: earlyMin, threshold: thresholds.earlyDepartThresholdMin },
      });
    }
  }

  // ── MISSING_CLOCK_OUT ───────────────────────────────────────────────────────
  // Employee clocked in but never clocked out. We only flag once the scheduled
  // end (+ grace) has passed — otherwise the employee is still legitimately
  // working. If there's no schedule, fall back to "more than `graceHours` since
  // clockIn" so legacy/no-roster cases still get caught.
  if (hasClockIn && !hasClockOut) {
    const graceMs = thresholds.missingClockOutGraceHours * 3600 * 1000;
    const cutoff = hasSchedule
      ? new Date(new Date(record.scheduledEnd).getTime() + graceMs)
      : new Date(new Date(record.clockIn).getTime() + 12 * 3600 * 1000 + graceMs);
    if (now > cutoff) {
      anomalies.push({
        type: ANOMALY_TYPES.MISSING_CLOCK_OUT,
        severity: SEVERITY.MISSING_CLOCK_OUT,
        message: `Clocked in at ${new Date(record.clockIn).toISOString()} but never clocked out`,
        detail: { clockIn: record.clockIn, gracePastEndHours: thresholds.missingClockOutGraceHours },
      });
    }
  }

  // ── EXCESSIVE_OT (single-day) ───────────────────────────────────────────────
  // Use billable OT when reconciled (TAT-005) — falls back to raw otHours.
  const otHours = record.billableOtHours != null ? record.billableOtHours : (record.otHours || 0);
  if (otHours >= thresholds.dailyOtThresholdHours) {
    anomalies.push({
      type: ANOMALY_TYPES.EXCESSIVE_OT,
      severity: SEVERITY.EXCESSIVE_OT,
      message: `OT of ${otHours.toFixed(2)}h in a single day exceeds threshold`,
      detail: { otHours, threshold: thresholds.dailyOtThresholdHours },
    });
  }

  return anomalies;
}

/**
 * Detect monthly OT breach by summing one employee's billable/raw OT across
 * the period. Returns a single MONTHLY_OT_BREACH anomaly or null.
 *
 * Pinned to a "marker date" (last record in the period or month-end) so the
 * idempotency key can stably target one row per employee per period.
 *
 * @param {Array<object>} records  one employee's records in the period
 * @param {object} opts
 * @param {object} [opts.thresholds]
 * @param {Date}   [opts.markerDate]  date stamped onto the anomaly row
 */
function detectMonthlyOtBreach(records, opts = {}) {
  const thresholds = mergeThresholds(opts.thresholds);
  const sum = (records || []).reduce((acc, r) => {
    const ot = r.billableOtHours != null ? r.billableOtHours : (r.otHours || 0);
    return acc + (Number.isFinite(ot) ? ot : 0);
  }, 0);
  if (sum < thresholds.monthlyOtAlertHours) return null;
  return {
    type: ANOMALY_TYPES.MONTHLY_OT_BREACH,
    severity: SEVERITY.MONTHLY_OT_BREACH,
    message: `Cumulative monthly OT of ${sum.toFixed(2)}h ≥ alert threshold ${thresholds.monthlyOtAlertHours}h`,
    detail: { totalOtHours: Math.round(sum * 100) / 100, threshold: thresholds.monthlyOtAlertHours },
    markerDate: opts.markerDate || (records?.length ? records[records.length - 1].date : null),
  };
}

/**
 * Build the unique key for an anomaly row — keeps the daily sweep idempotent.
 * For per-record anomalies: employeeId + ISO date + type.
 * For monthly breach: employeeId + first-of-month + type.
 */
function buildAnomalyKey({ employeeId, date, type }) {
  const dStr = date instanceof Date
    ? date.toISOString().slice(0, 10)
    : (typeof date === 'string' ? date.slice(0, 10) : '');
  return `${employeeId}|${dStr}|${type}`;
}

module.exports = {
  detectAnomaliesForRecord,
  detectMonthlyOtBreach,
  mergeThresholds,
  buildAnomalyKey,
  DEFAULT_THRESHOLDS,
  ANOMALY_TYPES,
  SEVERITY,
};
