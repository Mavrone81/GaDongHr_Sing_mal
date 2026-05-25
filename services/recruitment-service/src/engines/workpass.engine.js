'use strict';
/**
 * REC-003 work-pass expiry + DRC quota engine.
 *
 * Pure — no DB access. Two responsibilities:
 *   1. classifyExpiry(workPass, now) → which threshold (if any) has been
 *      crossed today, and what the alert message should say.
 *   2. computeDrcUsage(workPasses, totalHeadcount, configs) → per-sector
 *      foreign-worker ratio, comparison against quota limits, alert flags.
 */

const ALERT_THRESHOLDS = Object.freeze([90, 60, 30, 0]);

const FOREIGN_PASS_TYPES = Object.freeze(new Set(['WP', 'WORK_PERMIT', 'S_PASS', 'SPASS', 'EP', 'EMPLOYMENT_PASS']));
const DRC_QUOTA_PASS_TYPES = Object.freeze(new Set(['WP', 'WORK_PERMIT', 'S_PASS', 'SPASS']));

/**
 * Days remaining until the work pass expires. Negative = already expired.
 * @param {Date|string} expiryDate
 * @param {Date} [now]
 * @returns {number} integer days (positive = future, 0 = today, negative = past)
 */
function daysUntilExpiry(expiryDate, now = new Date()) {
  if (!expiryDate) return Infinity;
  const e = new Date(expiryDate);
  if (Number.isNaN(e.getTime())) return Infinity;
  const startOfDay = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const diffMs = startOfDay(e) - startOfDay(now);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Given a work pass + "now", returns the list of threshold values that
 * SHOULD have alerts at this point. Caller upserts on (passId, threshold)
 * for idempotency.
 *
 * Threshold semantics: a threshold X is "crossed" when daysRemaining ≤ X.
 * Once an alert fires for threshold X, it remains a historical record —
 * lower thresholds (closer to expiry) fire when their windows are reached.
 *
 * @param {object} workPass  { expiryDate, status, passType }
 * @param {Date}   [now]
 * @returns {Array<{ threshold: number, message: string, daysRemaining: number }>}
 */
function pendingAlerts(workPass, now = new Date()) {
  if (!workPass?.expiryDate) return [];
  if (workPass.status === 'CANCELLED') return [];
  const daysRemaining = daysUntilExpiry(workPass.expiryDate, now);
  const out = [];
  for (const t of ALERT_THRESHOLDS) {
    if (daysRemaining <= t) {
      out.push({
        threshold: t,
        daysRemaining,
        message: buildAlertMessage(workPass, t, daysRemaining),
      });
    }
  }
  return out;
}

function buildAlertMessage(workPass, threshold, daysRemaining) {
  if (threshold === 0) {
    return daysRemaining === 0
      ? `${workPass.passType} pass ${workPass.passNumber || ''} expires TODAY`.trim()
      : `${workPass.passType} pass ${workPass.passNumber || ''} EXPIRED ${Math.abs(daysRemaining)} day(s) ago`.trim();
  }
  return `${workPass.passType} pass ${workPass.passNumber || ''} expires in ${daysRemaining} day(s) (≤ ${threshold}-day threshold)`.trim();
}

/**
 * Build the alert urgency band — drives dashboard sort + colour.
 * @param {number} daysRemaining
 * @returns {'EXPIRED'|'CRITICAL'|'WARNING'|'NOTICE'|'OK'}
 */
function urgencyBand(daysRemaining) {
  if (daysRemaining < 0) return 'EXPIRED';
  if (daysRemaining <= 30) return 'CRITICAL';
  if (daysRemaining <= 60) return 'WARNING';
  if (daysRemaining <= 90) return 'NOTICE';
  return 'OK';
}

/**
 * Determine if a pass is a foreign work pass (used to count toward DRC
 * quota). EP holders count toward total foreign headcount but DON'T
 * consume DRC quota — quota only covers WP + S-Pass per MOM rules.
 */
function isForeignPass(passType) {
  if (!passType) return false;
  return FOREIGN_PASS_TYPES.has(String(passType).toUpperCase());
}

function consumesDrcQuota(passType) {
  if (!passType) return false;
  return DRC_QUOTA_PASS_TYPES.has(String(passType).toUpperCase());
}

/**
 * Compute Dependency Ratio Ceiling (DRC) usage per sector.
 *
 * DRC = (foreign workers consuming quota) / (total workforce)
 * MOM caps this ratio per sector. We surface:
 *   - currentRatio
 *   - ratioLimit (from config)
 *   - utilisationPct = currentRatio / ratioLimit
 *   - status: 'OK' | 'APPROACHING' | 'BREACH'
 *
 * @param {object} args
 * @param {Array<object>} args.workPasses    active WP/S-Pass records (must carry sector + workerTier)
 * @param {number}        args.totalHeadcount full company headcount (incl. locals)
 * @param {Array<object>} args.configs       DrcQuotaConfig rows
 * @returns {Array<object>} per-sector breakdown
 */
function computeDrcUsage({ workPasses = [], totalHeadcount = 0, configs = [] } = {}) {
  if (!Number.isFinite(totalHeadcount) || totalHeadcount <= 0) {
    return configs.map(c => ({
      sector: c.sector,
      workerTier: c.workerTier,
      foreignCount: 0,
      totalHeadcount: 0,
      currentRatio: 0,
      ratioLimit: c.ratioLimit,
      utilisationPct: 0,
      status: 'OK',
      message: 'No headcount data',
    }));
  }
  // Group quota-consuming passes by (sector, workerTier)
  const counts = new Map();
  for (const p of workPasses) {
    if (p.status === 'CANCELLED' || p.status === 'EXPIRED') continue;
    if (!consumesDrcQuota(p.passType)) continue;
    const sector = p.sector || 'UNSPECIFIED';
    const tier   = p.workerTier || 'BASIC';
    const key    = `${sector}|${tier}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return configs.map(c => {
    const key = `${c.sector}|${c.workerTier}`;
    const foreignCount   = counts.get(key) || 0;
    const currentRatio   = foreignCount / totalHeadcount;
    const utilisationPct = c.ratioLimit > 0 ? currentRatio / c.ratioLimit : 0;
    let status = 'OK';
    if (currentRatio > c.ratioLimit) status = 'BREACH';
    else if (utilisationPct >= (c.alertThreshold || 0.85)) status = 'APPROACHING';
    const message = status === 'BREACH'
      ? `BREACH — ${(currentRatio * 100).toFixed(1)}% exceeds MOM cap ${(c.ratioLimit * 100).toFixed(1)}%`
      : status === 'APPROACHING'
        ? `Approaching cap — ${(currentRatio * 100).toFixed(1)}% / ${(c.ratioLimit * 100).toFixed(1)}% (${(utilisationPct * 100).toFixed(0)}% utilisation)`
        : `${(currentRatio * 100).toFixed(1)}% of ${(c.ratioLimit * 100).toFixed(1)}% allowed`;
    return {
      sector: c.sector,
      workerTier: c.workerTier,
      foreignCount,
      totalHeadcount,
      currentRatio: Math.round(currentRatio * 10000) / 10000,
      ratioLimit: c.ratioLimit,
      utilisationPct: Math.round(utilisationPct * 10000) / 10000,
      status,
      message,
    };
  });
}

/**
 * Default checklist items to seed when a renewal is initiated.
 */
function defaultRenewalChecklist(passType) {
  const upper = String(passType || '').toUpperCase();
  const base = [
    'Verify employee employment status is active',
    'Confirm current salary meets pass minimum',
    'Update employee personal particulars',
    'Collect renewal documents (passport copy, photo)',
    'Submit renewal application via MOM EPOL',
    'Pay renewal fee',
    'Receive IPA letter from MOM',
    'Issue new pass card to employee',
  ];
  if (upper.includes('WP') || upper.includes('WORK_PERMIT')) {
    base.push('Schedule medical examination');
    base.push('Confirm sector + worker tier for FWL/DRC');
  }
  if (upper.includes('S_PASS') || upper === 'SPASS') {
    base.push('Verify educational qualifications');
  }
  return base;
}

module.exports = {
  ALERT_THRESHOLDS,
  daysUntilExpiry,
  pendingAlerts,
  urgencyBand,
  isForeignPass,
  consumesDrcQuota,
  computeDrcUsage,
  defaultRenewalChecklist,
};
