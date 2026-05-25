'use strict';
/**
 * PAY-005 payslip SLA engine.
 *
 * Pure — no DB. Given a payroll run + its payslips + "now", classify which
 * SLA alerts apply per MOM EA s.21 (salary paid within 7 days of the period
 * end; payslip issued by the payment date).
 *
 * Three alert types:
 *   PAYMENT_DATE_APPROACHING  — paymentDate within `approachingDays` (default 2)
 *                                and the run is not yet FINALISED.
 *   UNPUBLISHED_PAST_PAYMENT  — paymentDate ≤ now and ≥ 1 payslip is still
 *                                unpublished.
 *   LATE_PUBLICATION          — all published, but the LATEST publishedAt >
 *                                paymentDate. Fires once per run, severity
 *                                scales with daysLate.
 *
 * Severity ladder for UNPUBLISHED_PAST_PAYMENT + LATE_PUBLICATION:
 *   0 days  → MEDIUM
 *   1-2 d   → HIGH
 *   ≥ 3 d   → CRITICAL
 */

const DEFAULT_APPROACHING_DAYS = 2;

function daysBetween(a, b) {
  const startOfDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((startOfDay(new Date(a)) - startOfDay(new Date(b))) / (1000 * 60 * 60 * 24));
}

function severityFor(daysLate) {
  if (daysLate >= 3) return 'CRITICAL';
  if (daysLate >= 1) return 'HIGH';
  return 'MEDIUM';
}

/**
 * Classify SLA alerts for one run.
 *
 * @param {object} run         { id, period, paymentDate, status, finalisedAt }
 * @param {Array<object>} payslips  rows with { isPublished, publishedAt }
 * @param {object} opts
 * @param {Date} [opts.now]
 * @param {number} [opts.approachingDays]
 * @returns {Array<object>}    [{ type, severity, daysOverdue, unpublishedCount, message }]
 */
function classifyRunSla(run, payslips = [], opts = {}) {
  const out = [];
  if (!run?.paymentDate) return out;
  const now = opts.now ? new Date(opts.now) : new Date();
  const approachingDays = Number.isFinite(opts.approachingDays) ? opts.approachingDays : DEFAULT_APPROACHING_DAYS;
  const paymentDate = new Date(run.paymentDate);

  const total = payslips.length;
  const published = payslips.filter(p => p.isPublished);
  const unpublishedCount = total - published.length;

  const daysToPayment = daysBetween(paymentDate, now);
  const daysOverdue   = -daysToPayment;  // positive when payment date is past

  // PAYMENT_DATE_APPROACHING
  if (run.status !== 'FINALISED' && daysToPayment <= approachingDays && daysToPayment >= 0) {
    out.push({
      type: 'PAYMENT_DATE_APPROACHING',
      severity: daysToPayment === 0 ? 'HIGH' : 'MEDIUM',
      daysOverdue: 0,
      unpublishedCount,
      message: `Payment date ${paymentDate.toISOString().slice(0,10)} ${daysToPayment === 0 ? 'is TODAY' : `in ${daysToPayment} day(s)`} — run status is ${run.status}, not yet FINALISED`,
    });
  }

  // UNPUBLISHED_PAST_PAYMENT
  if (paymentDate < now && unpublishedCount > 0) {
    out.push({
      type: 'UNPUBLISHED_PAST_PAYMENT',
      severity: severityFor(daysOverdue),
      daysOverdue,
      unpublishedCount,
      message: `${unpublishedCount} of ${total} payslip(s) unpublished — payment date ${paymentDate.toISOString().slice(0,10)} was ${daysOverdue} day(s) ago`,
    });
  }

  // LATE_PUBLICATION — all published, but latest publishedAt > paymentDate
  if (unpublishedCount === 0 && published.length > 0) {
    let latest = null;
    for (const p of published) {
      if (!p.publishedAt) continue;
      const t = new Date(p.publishedAt);
      if (!latest || t > latest) latest = t;
    }
    if (latest && latest > paymentDate) {
      const lateDays = daysBetween(latest, paymentDate);
      out.push({
        type: 'LATE_PUBLICATION',
        severity: severityFor(lateDays),
        daysOverdue: lateDays,
        unpublishedCount: 0,
        message: `All payslips published, but latest publication (${latest.toISOString().slice(0,10)}) was ${lateDays} day(s) after payment date ${paymentDate.toISOString().slice(0,10)}`,
      });
    }
  }

  return out;
}

/**
 * Resolution check — alerts resolve when the violation no longer holds.
 * @param {object} alertRow      stored row from PayslipSlaAlert
 * @param {Array<object>} currentAlerts  from classifyRunSla(run, payslips, opts)
 * @returns {boolean}            true if the alert should be marked resolved
 */
function isAlertResolved(alertRow, currentAlerts) {
  return !currentAlerts.some(a => a.type === alertRow.type);
}

module.exports = {
  DEFAULT_APPROACHING_DAYS,
  classifyRunSla,
  isAlertResolved,
  severityFor,
  daysBetween,
};
