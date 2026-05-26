'use strict';
/**
 * Flexi-Benefits Wallet Engine — pure functions, no Prisma/IO.
 *
 * Domain rules (BEN-002):
 *  • Employer-funded annual wallet credited Jan 1, expires Dec 31 (no carry-forward by default).
 *  • Six eligible categories: gym, dental, optical, health screening, wellness, professional dev.
 *  • Claims below autoApproveThreshold are auto-approved on submit; others require Finance review.
 *  • Year-end: remaining balance is either forfeited or encashed via payroll.
 *  • usedAmount tracks total APPROVED claim amounts; PENDING claims do not reduce it until approved.
 */

const WALLET_CATEGORIES = [
  {
    code: 'GYM',
    name: 'Gym & Fitness',
    description: 'Gym memberships, fitness classes, sports equipment',
    requiresReceipt: true,
  },
  {
    code: 'DENTAL',
    name: 'Dental',
    description: 'Dental check-ups, cleaning, and treatment not covered by group insurance',
    requiresReceipt: true,
  },
  {
    code: 'OPTICAL',
    name: 'Optical',
    description: 'Spectacles, contact lenses, eye examinations',
    requiresReceipt: true,
  },
  {
    code: 'HEALTH_SCREENING',
    name: 'Health Screening',
    description: 'Annual health screenings, vaccinations, and preventive check-ups',
    requiresReceipt: true,
  },
  {
    code: 'WELLNESS',
    name: 'Wellness',
    description: 'Yoga, meditation apps, mental health support, ergonomic equipment',
    requiresReceipt: true,
  },
  {
    code: 'PROFESSIONAL_DEVELOPMENT',
    name: 'Professional Development',
    description: 'Courses, books, certifications not covered under the training module',
    requiresReceipt: true,
  },
];

// Default wallet amounts per employment grade (SGD/year).
const DEFAULT_GRADE_AMOUNTS = {
  STAFF:     500,
  EXEC:      1000,
  MGR:       1500,
  DIR:       2000,
  VP:        2000,
  C_SUITE:   2000,
};

/**
 * computeBalance — derives balance fields for a wallet given its approved claims.
 *
 * @param {Object} wallet        — FlexiWallet row
 * @param {Array}  pendingClaims — FlexiClaim rows in PENDING status for this wallet
 * @returns {{credited, used, pending, remaining, encashed, forfeited}}
 */
function computeBalance(wallet, pendingClaims = []) {
  if (!wallet) return { credited: 0, used: 0, pending: 0, remaining: 0, encashed: 0, forfeited: 0 };
  const credited  = round2(Number(wallet.creditedAmount  || 0));
  const used      = round2(Number(wallet.usedAmount      || 0));
  const encashed  = round2(Number(wallet.encashedAmount  || 0));
  const forfeited = round2(Number(wallet.forfeitedAmount || 0));
  const pending   = round2((pendingClaims || []).reduce((s, c) => s + Number(c.claimAmount || 0), 0));
  const remaining = round2(credited - used - pending);
  return { credited, used, pending, remaining, encashed, forfeited };
}

/**
 * isWalletExpired — true when the wallet's expiry has passed OR status is EXPIRED.
 *
 * @param {Object} wallet — FlexiWallet row
 * @param {Date}   now    — reference date
 * @returns {boolean}
 */
function isWalletExpired(wallet, now = new Date()) {
  if (!wallet) return true;
  if (wallet.status === 'EXPIRED') return true;
  if (!wallet.expiresAt) return false;
  return new Date(wallet.expiresAt) < new Date(now);
}

/**
 * shouldAutoApprove — true when the claim amount is at or below the configured threshold.
 *
 * @param {number} claimAmount — the amount being claimed
 * @param {Object} config      — FlexiWalletConfig row (may be null)
 * @returns {boolean}
 */
function shouldAutoApprove(claimAmount, config) {
  if (!config) return false;
  const threshold = Number(config.autoApproveThreshold || 0);
  return threshold > 0 && Number(claimAmount || 0) <= threshold;
}

/**
 * computeYearEndSummary — aggregates active wallets for year-end forfeiture/encashment preview.
 *
 * @param {Array} wallets — FlexiWallet rows (ACTIVE only)
 * @returns {{ totalWallets, totalCredited, totalUsed, totalRemaining, byGrade }}
 */
function computeYearEndSummary(wallets) {
  const list = (wallets || []).filter(w => w.status === 'ACTIVE');
  const summary = {
    totalWallets:   list.length,
    totalCredited:  0,
    totalUsed:      0,
    totalRemaining: 0,
    byGrade:        {},
  };
  for (const w of list) {
    const credited  = Number(w.creditedAmount || 0);
    const used      = Number(w.usedAmount     || 0);
    const remaining = round2(credited - used);
    summary.totalCredited  = round2(summary.totalCredited  + credited);
    summary.totalUsed      = round2(summary.totalUsed      + used);
    summary.totalRemaining = round2(summary.totalRemaining + remaining);
    const grade = w.employeeGrade || 'UNKNOWN';
    if (!summary.byGrade[grade]) summary.byGrade[grade] = { count: 0, credited: 0, used: 0, remaining: 0 };
    summary.byGrade[grade].count     += 1;
    summary.byGrade[grade].credited  = round2(summary.byGrade[grade].credited  + credited);
    summary.byGrade[grade].used      = round2(summary.byGrade[grade].used      + used);
    summary.byGrade[grade].remaining = round2(summary.byGrade[grade].remaining + remaining);
  }
  return summary;
}

/**
 * buildWalletDashboard — HR aggregate view across all wallets and claims.
 *
 * @param {Array} wallets — FlexiWallet rows
 * @param {Array} claims  — FlexiClaim rows (all statuses)
 * @returns {{ totalCredited, totalUsed, totalRemaining, totalForfeited, byGrade, byCategory }}
 */
function buildWalletDashboard(wallets, claims) {
  const wList = Array.isArray(wallets) ? wallets : [];
  const cList = Array.isArray(claims)  ? claims  : [];

  const result = {
    totalCredited:  0,
    totalUsed:      0,
    totalRemaining: 0,
    totalForfeited: 0,
    activeWallets:  0,
    byGrade:        {},
    byCategory:     {},
  };

  for (const w of wList) {
    const credited  = Number(w.creditedAmount  || 0);
    const used      = Number(w.usedAmount      || 0);
    const remaining = round2(credited - used);
    const forfeited = Number(w.forfeitedAmount || 0);
    result.totalCredited  = round2(result.totalCredited  + credited);
    result.totalUsed      = round2(result.totalUsed      + used);
    result.totalRemaining = round2(result.totalRemaining + remaining);
    result.totalForfeited = round2(result.totalForfeited + forfeited);
    if (w.status === 'ACTIVE') result.activeWallets += 1;

    const grade = w.employeeGrade || 'UNKNOWN';
    if (!result.byGrade[grade]) result.byGrade[grade] = { wallets: 0, credited: 0, used: 0, remaining: 0 };
    result.byGrade[grade].wallets   += 1;
    result.byGrade[grade].credited  = round2(result.byGrade[grade].credited  + credited);
    result.byGrade[grade].used      = round2(result.byGrade[grade].used      + used);
    result.byGrade[grade].remaining = round2(result.byGrade[grade].remaining + remaining);
  }

  for (const c of cList) {
    if (c.status === 'CANCELLED' || c.status === 'REJECTED') continue;
    const cat = c.categoryCode || 'OTHER';
    if (!result.byCategory[cat]) result.byCategory[cat] = { name: c.categoryName || cat, claims: 0, totalClaimed: 0, totalApproved: 0 };
    result.byCategory[cat].claims      += 1;
    result.byCategory[cat].totalClaimed = round2(result.byCategory[cat].totalClaimed + Number(c.claimAmount || 0));
    if (c.status === 'APPROVED') {
      result.byCategory[cat].totalApproved = round2(result.byCategory[cat].totalApproved + Number(c.approvedAmount || c.claimAmount || 0));
    }
  }

  return result;
}

/**
 * walletExpiresAt — returns SGT Dec 31 23:59:59 for the given year.
 *
 * @param {number} year — e.g. 2026
 * @returns {Date}
 */
function walletExpiresAt(year) {
  // Dec 31 23:59:59 UTC+8 = Dec 31 15:59:59 UTC
  return new Date(Date.UTC(year, 11, 31, 15, 59, 59));
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

module.exports = {
  WALLET_CATEGORIES,
  DEFAULT_GRADE_AMOUNTS,
  computeBalance,
  isWalletExpired,
  shouldAutoApprove,
  computeYearEndSummary,
  buildWalletDashboard,
  walletExpiresAt,
  round2,
};
