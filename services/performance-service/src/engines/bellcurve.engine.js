'use strict';

// Default MAS/HR best-practice 5-band distribution (1–5 scale)
const DEFAULT_BANDS = [
  { label: 'Outstanding',    minScore: 4.5, maxScore: 5.0, targetPct: 10, deviationTolerance: 5 },
  { label: 'Exceeds',        minScore: 3.5, maxScore: 4.49, targetPct: 25, deviationTolerance: 7 },
  { label: 'Meets',          minScore: 2.5, maxScore: 3.49, targetPct: 50, deviationTolerance: 10 },
  { label: 'Needs Improvement', minScore: 1.5, maxScore: 2.49, targetPct: 10, deviationTolerance: 5 },
  { label: 'Unsatisfactory', minScore: 0,   maxScore: 1.49, targetPct: 5,  deviationTolerance: 5 },
];

function validateBands(bands) {
  if (!Array.isArray(bands) || bands.length === 0) return 'bands must be a non-empty array';
  for (const b of bands) {
    if (b.minScore == null || b.maxScore == null) return 'each band requires minScore and maxScore';
    if (b.minScore > b.maxScore) return `band "${b.label}": minScore must be <= maxScore`;
    if (b.targetPct == null || b.targetPct < 0 || b.targetPct > 100) return `band "${b.label}": targetPct must be 0–100`;
    if (b.deviationTolerance != null && (b.deviationTolerance < 0 || b.deviationTolerance > 100))
      return `band "${b.label}": deviationTolerance must be 0–100`;
  }
  const total = bands.reduce((s, b) => s + b.targetPct, 0);
  if (Math.abs(total - 100) > 1) return `targetPct values must sum to 100 (got ${total.toFixed(1)})`;
  return null;
}

function effectiveScore(appraisal) {
  return appraisal.calibratedScore ?? appraisal.overallScore ?? null;
}

function computeDistribution(appraisals, bands) {
  const total = appraisals.filter(a => effectiveScore(a) !== null).length;
  return bands.map(band => {
    const members = appraisals.filter(a => {
      const s = effectiveScore(a);
      return s !== null && s >= band.minScore && s <= band.maxScore;
    });
    const count   = members.length;
    const actualPct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    const deviation = Math.round((actualPct - band.targetPct) * 10) / 10;
    const tolerance = band.deviationTolerance ?? 10;
    let status = 'OK';
    if (Math.abs(deviation) > tolerance) status = deviation > 0 ? 'OVER' : 'UNDER';
    else if (Math.abs(deviation) > tolerance * 0.6) status = 'WARNING';
    return { label: band.label, minScore: band.minScore, maxScore: band.maxScore, targetPct: band.targetPct, actualPct, count, deviation, status };
  });
}

function hasDeviation(distribution) {
  return distribution.some(b => b.status === 'OVER' || b.status === 'UNDER');
}

function groupByDepartment(appraisals, employeeMap, bands) {
  const byDept = {};
  for (const ap of appraisals) {
    const emp  = employeeMap[ap.employeeId];
    const dept = emp?.department || 'Unassigned';
    if (!byDept[dept]) byDept[dept] = [];
    byDept[dept].push({ ...ap, _employeeName: emp?.fullName || null, _department: dept });
  }
  const result = {};
  for (const [dept, list] of Object.entries(byDept)) {
    result[dept] = {
      count: list.length,
      appraisals: list,
      distribution: bands ? computeDistribution(list, bands) : null,
    };
  }
  return result;
}

module.exports = { DEFAULT_BANDS, validateBands, effectiveScore, computeDistribution, hasDeviation, groupByDepartment };
