'use strict';
/**
 * CLM-004 GST validation + analytics engine.
 *
 * Pure — no DB. Two responsibilities:
 *   1. validateGstNumber(value) — IRAS GST registration number format check.
 *      Acceptable forms:
 *        - 9-char GSTN: "M12345678X" (one letter, 8 digits, one check letter)
 *        - 10-char UEN suffix: e.g. "200012345A" (older UEN form)
 *      Pure format check — actual registry lookup is the caller's job.
 *   2. checkRegistryMatch(gstNumber, asOfDate, registry) — finds the
 *      VendorGstRegistration row matching `gstNumber` whose effective window
 *      includes `asOfDate` and `isActive=true`. Returns { valid, reason, vendor }.
 *
 * Plus pure aggregators for the finance dashboard:
 *   - aggregateGstByPeriod(claims)
 *   - aggregateByCostCentre(claims)
 *   - aggregateByCategory(claims)
 *   - rankTopClaimants(claims, n)
 *   - computeCategoryBudgetUtilisation(claims, budgets) — spend vs budget
 */

const GST_RATE = 0.09;

// Singapore GST registration number: starts with a letter, 8 digits, ends
// with a check letter. We also allow the older 10-char UEN forms (post-2009
// "T<YY><PQ><nnnn><X>" or pre-2009 "<YYYY><nnnnn><X>"). All matched
// case-insensitively, stripped of internal whitespace and dashes.
const GSTN_RX = /^[A-Z]\d{8}[A-Z]$/;          // e.g. M12345678X
const UEN_2009_RX = /^T\d{2}[A-Z]{2}\d{4}[A-Z]$/; // e.g. T07LL1234X
const UEN_PRE_RX  = /^\d{9}[A-Z]$/;            // e.g. 200012345A

/**
 * Normalise and validate a GST number's FORMAT (not registry membership).
 * @param {string} value
 * @returns {{ valid: boolean, normalized: string|null, reason: string|null }}
 */
function validateGstNumber(value) {
  if (value == null || value === '') {
    return { valid: false, normalized: null, reason: 'empty' };
  }
  const cleaned = String(value).replace(/[\s-]/g, '').toUpperCase();
  if (GSTN_RX.test(cleaned) || UEN_2009_RX.test(cleaned) || UEN_PRE_RX.test(cleaned)) {
    return { valid: true, normalized: cleaned, reason: null };
  }
  return { valid: false, normalized: cleaned, reason: 'invalid_format' };
}

/**
 * Check whether a GST number is in the active registry on the given date.
 * @param {string|null} gstNumber
 * @param {Date|string} asOfDate
 * @param {Array<object>} registry  VendorGstRegistration rows
 * @returns {{ valid: boolean, reason: string|null, vendor: object|null, normalized: string|null }}
 */
function checkRegistryMatch(gstNumber, asOfDate, registry = []) {
  const fmt = validateGstNumber(gstNumber);
  if (!fmt.valid) return { valid: false, reason: fmt.reason, vendor: null, normalized: fmt.normalized };
  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  const norm = fmt.normalized;
  const match = registry.find(r => {
    if (!r || r.gstNumber == null) return false;
    if (String(r.gstNumber).toUpperCase() !== norm) return false;
    if (r.isActive === false) return false;
    if (r.effectiveFrom && new Date(r.effectiveFrom) > asOf) return false;
    if (r.effectiveTo   && new Date(r.effectiveTo)   < asOf) return false;
    return true;
  });
  if (!match) return { valid: false, reason: 'not_in_registry', vendor: null, normalized: norm };
  return { valid: true, reason: null, vendor: match, normalized: norm };
}

/**
 * Sum GST + total amounts grouped by claim.payrollPeriod (or "UNASSIGNED").
 * @param {Array<object>} claims
 * @returns {Array<{ period: string, totalAmount: number, totalGst: number, claimCount: number }>}
 */
function aggregateGstByPeriod(claims = []) {
  const map = new Map();
  for (const c of claims) {
    const key = c.payrollPeriod || 'UNASSIGNED';
    const row = map.get(key) || { period: key, totalAmount: 0, totalGst: 0, claimCount: 0 };
    row.totalAmount += Number(c.totalAmount || 0);
    row.totalGst    += Number(c.gstAmount   || 0);
    row.claimCount  += 1;
    map.set(key, row);
  }
  return Array.from(map.values()).map(r => ({
    period: r.period,
    totalAmount: round2(r.totalAmount),
    totalGst:    round2(r.totalGst),
    claimCount:  r.claimCount,
  })).sort((a, b) => a.period.localeCompare(b.period));
}

function aggregateByCostCentre(claims = []) {
  const map = new Map();
  for (const c of claims) {
    const key = c.costCentre || 'UNALLOCATED';
    const row = map.get(key) || { costCentre: key, totalAmount: 0, totalGst: 0, claimCount: 0 };
    row.totalAmount += Number(c.totalAmount || 0);
    row.totalGst    += Number(c.gstAmount   || 0);
    row.claimCount  += 1;
    map.set(key, row);
  }
  return Array.from(map.values())
    .map(r => ({ ...r, totalAmount: round2(r.totalAmount), totalGst: round2(r.totalGst) }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

/**
 * Aggregate by category. Caller passes `categoryLookup` (id → { code, name })
 * to enrich the output — handy for the dashboard.
 */
function aggregateByCategory(claims = [], categoryLookup = new Map()) {
  const map = new Map();
  for (const c of claims) {
    const key = c.categoryId || 'UNKNOWN';
    const row = map.get(key) || { categoryId: key, totalAmount: 0, totalGst: 0, claimCount: 0 };
    row.totalAmount += Number(c.totalAmount || 0);
    row.totalGst    += Number(c.gstAmount   || 0);
    row.claimCount  += 1;
    map.set(key, row);
  }
  return Array.from(map.values())
    .map(r => {
      const cat = categoryLookup.get?.(r.categoryId) || categoryLookup[r.categoryId];
      return {
        ...r,
        categoryCode: cat?.code || null,
        categoryName: cat?.name || null,
        totalAmount: round2(r.totalAmount),
        totalGst:    round2(r.totalGst),
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

/**
 * Rank top N claimants by total reimbursed amount in the period.
 * Tie-break on claimCount descending, then employeeId asc for determinism.
 */
function rankTopClaimants(claims = [], n = 10) {
  const map = new Map();
  for (const c of claims) {
    const key = c.employeeId;
    if (!key) continue;
    const row = map.get(key) || { employeeId: key, totalAmount: 0, totalGst: 0, claimCount: 0 };
    row.totalAmount += Number(c.totalAmount || 0);
    row.totalGst    += Number(c.gstAmount   || 0);
    row.claimCount  += 1;
    map.set(key, row);
  }
  const rows = Array.from(map.values()).map(r => ({
    ...r, totalAmount: round2(r.totalAmount), totalGst: round2(r.totalGst),
  }));
  rows.sort((a, b) => {
    if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;
    if (b.claimCount  !== a.claimCount)  return b.claimCount  - a.claimCount;
    return a.employeeId.localeCompare(b.employeeId);
  });
  return rows.slice(0, Math.max(0, n | 0));
}

/**
 * Spend-vs-budget for each (categoryId, period). Returns one row per budget
 * (even if there are no claims yet), plus an unbudgeted row aggregating
 * spend that has no matching budget for that period.
 */
function computeCategoryBudgetUtilisation(claims = [], budgets = [], categoryLookup = new Map()) {
  const claimByKey = new Map();
  for (const c of claims) {
    if (!c.categoryId || !c.payrollPeriod) continue;
    const k = `${c.categoryId}|${c.payrollPeriod}`;
    const row = claimByKey.get(k) || { spent: 0, count: 0 };
    row.spent += Number(c.totalAmount || 0);
    row.count += 1;
    claimByKey.set(k, row);
  }
  const out = [];
  const matched = new Set();
  for (const b of budgets) {
    const k = `${b.categoryId}|${b.period}`;
    const got = claimByKey.get(k) || { spent: 0, count: 0 };
    matched.add(k);
    const utilisationPct = b.budgetAmount > 0 ? got.spent / b.budgetAmount : 0;
    let status = 'OK';
    if (utilisationPct >= 1) status = 'BREACH';
    else if (utilisationPct >= 0.85) status = 'APPROACHING';
    const cat = categoryLookup.get?.(b.categoryId) || categoryLookup[b.categoryId];
    out.push({
      categoryId: b.categoryId,
      categoryCode: cat?.code || null,
      categoryName: cat?.name || null,
      period: b.period,
      budgetAmount: round2(b.budgetAmount),
      spent: round2(got.spent),
      remaining: round2(b.budgetAmount - got.spent),
      utilisationPct: Math.round(utilisationPct * 10000) / 10000,
      claimCount: got.count,
      status,
    });
  }
  // Unbudgeted spend rows
  for (const [k, row] of claimByKey.entries()) {
    if (matched.has(k)) continue;
    const [categoryId, period] = k.split('|');
    const cat = categoryLookup.get?.(categoryId) || categoryLookup[categoryId];
    out.push({
      categoryId,
      categoryCode: cat?.code || null,
      categoryName: cat?.name || null,
      period,
      budgetAmount: 0,
      spent: round2(row.spent),
      remaining: -round2(row.spent),
      utilisationPct: 0,
      claimCount: row.count,
      status: 'UNBUDGETED',
    });
  }
  return out.sort((a, b) => {
    if (a.period !== b.period) return a.period.localeCompare(b.period);
    return (a.categoryCode || '').localeCompare(b.categoryCode || '');
  });
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = {
  GST_RATE,
  validateGstNumber,
  checkRegistryMatch,
  aggregateGstByPeriod,
  aggregateByCostCentre,
  aggregateByCategory,
  rankTopClaimants,
  computeCategoryBudgetUtilisation,
};
