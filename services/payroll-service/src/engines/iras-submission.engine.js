'use strict';
/**
 * PAY-007 IRAS / CPF submission engine.
 *
 * Pure — no DB. Three responsibilities:
 *   1. computeDeadline(kind, scope) — returns the statutory deadline Date for
 *      one submission given its kind + scope (period / year / employee LWD).
 *        CPF_E_SUBMIT: 14th of the month FOLLOWING the wage period
 *        IR8A / APPENDIX_8A / APPENDIX_8B: 1 Mar of the year AFTER the income year
 *        IR21: lastWorkingDate − 30 days (IRAS rule, foreign employees)
 *   2. classifyUrgency(deadline, now) — OVERDUE / CRITICAL (≤ 3 d) /
 *      WARNING (≤ 14 d) / NOTICE (≤ 30 d) / OK.
 *   3. validateTransition(from, to) — guards the DRAFT → SUBMITTED →
 *      ACKNOWLEDGED / REJECTED state machine. Returns { ok, error }.
 *
 * Also exports buildScopeKey for callers to compute the natural-key string
 * used to upsert / dedupe submissions.
 */

const KINDS = Object.freeze(['CPF_E_SUBMIT', 'IR8A', 'APPENDIX_8A', 'APPENDIX_8B', 'IR21']);
const STATUSES = Object.freeze(['DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'REJECTED']);

const TRANSITIONS = Object.freeze({
  DRAFT:        new Set(['SUBMITTED', 'REJECTED']),
  SUBMITTED:    new Set(['ACKNOWLEDGED', 'REJECTED']),
  ACKNOWLEDGED: new Set([]),
  REJECTED:     new Set(['DRAFT']),
});

function startOfDayUtc(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

function daysBetween(a, b) {
  return Math.round((startOfDayUtc(a) - startOfDayUtc(b)) / (1000 * 60 * 60 * 24));
}

/**
 * Compute the statutory deadline for a submission.
 *
 * @param {string} kind  IrasSubmissionKind
 * @param {object} scope { period: "YYYY-MM", year: Int, lastWorkingDate: Date|string }
 * @returns {Date|null}  null if the required scope field is missing
 */
function computeDeadline(kind, scope = {}) {
  if (kind === 'CPF_E_SUBMIT') {
    if (!scope.period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(scope.period)) return null;
    const [y, m] = scope.period.split('-').map(Number);
    // Following month, day 14 (e.g. period 2026-05 → 2026-06-14)
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear  = m === 12 ? y + 1 : y;
    return new Date(Date.UTC(nextYear, nextMonth - 1, 14, 23, 59, 59));
  }
  if (kind === 'IR8A' || kind === 'APPENDIX_8A' || kind === 'APPENDIX_8B') {
    const yearN = Number(scope.year);
    if (!Number.isFinite(yearN)) return null;
    // 1 March of the FOLLOWING year (IRAS AIS rule)
    return new Date(Date.UTC(yearN + 1, 2, 1, 23, 59, 59)); // month index 2 = March
  }
  if (kind === 'IR21') {
    if (!scope.lastWorkingDate) return null;
    const lwd = new Date(scope.lastWorkingDate);
    if (Number.isNaN(lwd.getTime())) return null;
    const d = new Date(lwd); d.setUTCDate(d.getUTCDate() - 30);
    return d;
  }
  return null;
}

/**
 * Classify how urgent a deadline is, given "now".
 * @param {Date|string|null} deadline
 * @param {Date} [now]
 * @returns {{ urgency: string, daysUntilDeadline: number|null }}
 */
function classifyUrgency(deadline, now = new Date()) {
  if (!deadline) return { urgency: 'UNSCHEDULED', daysUntilDeadline: null };
  const days = daysBetween(deadline, now);
  let urgency = 'OK';
  if (days < 0)        urgency = 'OVERDUE';
  else if (days <= 3)  urgency = 'CRITICAL';
  else if (days <= 14) urgency = 'WARNING';
  else if (days <= 30) urgency = 'NOTICE';
  return { urgency, daysUntilDeadline: days };
}

/**
 * Guard a status transition.
 * @param {string} from
 * @param {string} to
 * @returns {{ ok: boolean, error?: string }}
 */
function validateTransition(from, to) {
  if (!STATUSES.includes(to)) return { ok: false, error: `Invalid target status ${to}` };
  if (from === to) return { ok: false, error: `Already in status ${to}` };
  const allowed = TRANSITIONS[from] || new Set();
  if (!allowed.has(to)) return { ok: false, error: `Cannot transition ${from} → ${to}` };
  return { ok: true };
}

/**
 * Natural-key string for dedup (one row per kind + scope).
 * Examples:
 *   CPF_E_SUBMIT|2026-05
 *   IR8A|2026
 *   IR21|emp-uuid-001
 */
function buildScopeKey(kind, scope = {}) {
  if (kind === 'CPF_E_SUBMIT') return `${kind}|${scope.period || ''}`;
  if (kind === 'IR8A' || kind === 'APPENDIX_8A' || kind === 'APPENDIX_8B') return `${kind}|${scope.year ?? ''}`;
  if (kind === 'IR21')         return `${kind}|${scope.employeeId || ''}`;
  return `${kind}|`;
}

/**
 * Auto-stamp helper — given a target status, returns the timestamp + actor
 * patch the route should merge into the update.
 * @param {string} toStatus
 * @param {string} actorId
 * @param {object} extra  { referenceNumber, rejectedReason }
 */
function buildTransitionPatch(toStatus, actorId, extra = {}) {
  const now = new Date();
  const patch = { status: toStatus };
  if (toStatus === 'SUBMITTED') {
    patch.submittedAt = now;
    patch.submittedBy = actorId || null;
    if (extra.referenceNumber != null) patch.referenceNumber = extra.referenceNumber;
  }
  if (toStatus === 'ACKNOWLEDGED') {
    patch.acknowledgedAt = now;
    patch.acknowledgedBy = actorId || null;
    if (extra.referenceNumber != null) patch.referenceNumber = extra.referenceNumber;
  }
  if (toStatus === 'REJECTED') {
    patch.rejectedAt = now;
    if (extra.rejectedReason != null) patch.rejectedReason = extra.rejectedReason;
  }
  if (toStatus === 'DRAFT') {
    // Resubmission after REJECTED — clear the rejected stamp
    patch.rejectedAt = null;
    patch.rejectedReason = null;
  }
  return patch;
}

module.exports = {
  KINDS,
  STATUSES,
  TRANSITIONS,
  computeDeadline,
  classifyUrgency,
  validateTransition,
  buildScopeKey,
  buildTransitionPatch,
  daysBetween,
};
