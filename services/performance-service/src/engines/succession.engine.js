'use strict';

// ── Performance band (from appraisal score 0–5) ───────────────────────────────
// Returns 1=Low, 2=Medium, 3=High, or null if no score
function performanceBand(score) {
  if (score === null || score === undefined) return null;
  if (score >= 3.5) return 3;
  if (score >= 2.0) return 2;
  return 1;
}

const PERF_LABEL = { 1: 'Low', 2: 'Medium', 3: 'High' };
const POT_LABEL  = { 1: 'Low', 2: 'Medium', 3: 'High' };

// 9-box labels: row = potential (3→1 top to bottom), col = performance (1→3 left to right)
// box = (3 - potentialBand) * 3 + performanceBand
const BOX_LABELS = {
  1: 'Potential Gem',      // High Pot, Low Perf
  2: 'Rising Star',        // High Pot, Med Perf
  3: 'Star',               // High Pot, High Perf
  4: 'Dilemma',            // Med Pot, Low Perf
  5: 'Core Employee',      // Med Pot, Med Perf
  6: 'High Performer',     // Med Pot, High Perf
  7: 'Underperformer',     // Low Pot, Low Perf
  8: 'Solid Contributor',  // Low Pot, Med Perf
  9: 'Expert',             // Low Pot, High Perf
};

function build9BoxEntry(performanceScore, potentialBand) {
  const perf = performanceBand(performanceScore);
  if (perf === null || !potentialBand || potentialBand < 1 || potentialBand > 3) return null;
  const box = (3 - potentialBand) * 3 + perf;
  return {
    box,
    label: BOX_LABELS[box],
    performanceBand: perf,
    performanceLabel: PERF_LABEL[perf],
    potentialBand,
    potentialLabel: POT_LABEL[potentialBand],
  };
}

// ── Position risk ─────────────────────────────────────────────────────────────
// HIGH  = no active nominees
// MEDIUM = best readiness is ONE_YEAR or TWO_YEARS only
// LOW    = at least one READY_NOW nominee
function computePositionRisk(nominees) {
  if (!nominees || nominees.length === 0) return 'HIGH';
  const levels = nominees.map(n => n.readiness);
  if (levels.includes('READY_NOW')) return 'LOW';
  if (levels.includes('ONE_YEAR')) return 'MEDIUM';
  return 'HIGH';
}

// ── Risk report row ───────────────────────────────────────────────────────────
function buildRiskReportRow(position, nominees) {
  const risk = computePositionRisk(nominees);
  const readyCounts = { READY_NOW: 0, ONE_YEAR: 0, TWO_YEARS: 0 };
  for (const n of nominees) readyCounts[n.readiness] = (readyCounts[n.readiness] || 0) + 1;
  return {
    positionId: position.id,
    jobTitle: position.jobTitle,
    department: position.department,
    currentHolderId: position.currentHolderId,
    riskLevel: risk,
    totalNominees: nominees.length,
    readyCounts,
  };
}

// ── Full risk report ──────────────────────────────────────────────────────────
function computeRiskReport(positions, nomineesByPosition) {
  const rows = positions.map(p => buildRiskReportRow(p, nomineesByPosition[p.id] || []));
  const summary = {
    total: rows.length,
    high: rows.filter(r => r.riskLevel === 'HIGH').length,
    medium: rows.filter(r => r.riskLevel === 'MEDIUM').length,
    low: rows.filter(r => r.riskLevel === 'LOW').length,
  };
  return { summary, rows };
}

// ── Dashboard KPIs ────────────────────────────────────────────────────────────
function computeSuccessionDashboard(positions, nominees) {
  const totalPositions = positions.length;
  const totalNominees = nominees.length;
  const readyNow = nominees.filter(n => n.readiness === 'READY_NOW').length;
  const oneYear  = nominees.filter(n => n.readiness === 'ONE_YEAR').length;
  const twoYears = nominees.filter(n => n.readiness === 'TWO_YEARS').length;

  const nomineesByPosition = {};
  for (const n of nominees) {
    if (!nomineesByPosition[n.positionId]) nomineesByPosition[n.positionId] = [];
    nomineesByPosition[n.positionId].push(n);
  }

  const highRisk   = positions.filter(p => computePositionRisk(nomineesByPosition[p.id] || []) === 'HIGH').length;
  const mediumRisk = positions.filter(p => computePositionRisk(nomineesByPosition[p.id] || []) === 'MEDIUM').length;
  const lowRisk    = positions.filter(p => computePositionRisk(nomineesByPosition[p.id] || []) === 'LOW').length;
  const coverageRate = totalPositions > 0 ? Math.round((lowRisk / totalPositions) * 100) : 0;

  return {
    totalPositions,
    totalNominees,
    byReadiness: { readyNow, oneYear, twoYears },
    byRisk: { high: highRisk, medium: mediumRisk, low: lowRisk },
    coverageRate,
  };
}

module.exports = {
  performanceBand,
  build9BoxEntry,
  computePositionRisk,
  buildRiskReportRow,
  computeRiskReport,
  computeSuccessionDashboard,
  BOX_LABELS,
};
