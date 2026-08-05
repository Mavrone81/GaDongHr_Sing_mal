'use strict';

/**
 * PCB / MTD — Income Tax (Deduction from Remuneration) Rules 1994 (PRD MYP-004).
 *
 * The spec requires the LHDN **computerised calculation method**, not the
 * schedule-table lookup, for normal remuneration:
 *
 *     MTD = [ (P − M) × R + B − (Z + X) ] / (n + 1)
 *
 *   P  chargeable income for the year, projected from current remuneration
 *      net of allowable reliefs
 *   M  the chargeable-income floor of the applicable band
 *   R  the band's rate
 *   B  cumulative tax at that floor, which varies by MTD category
 *   Z  accumulated zakat paid this year
 *   X  accumulated MTD already paid this year
 *   n  remaining months in the year AFTER the current one
 *
 * Two things about this formula bite in practice:
 *
 * 1. The divisor is (n + 1), not n. In December n is 0 and the divisor is 1 —
 *    the whole remaining liability falls in the final month. Using n would
 *    divide by zero in December and under-deduct all year.
 *
 * 2. It can go NEGATIVE when Z + X already exceeds the year's liability
 *    (typically after zakat). A negative MTD is not a refund through payroll;
 *    LHDN's method floors it at zero. Returning a negative here would credit
 *    the employee money the employer never withheld.
 */

/** Bands are per MTD category — category 3 carries the child rebate in B. */
function findBand(bands, { chargeable, category }) {
  return bands.find((b) =>
    b.category === category &&
    chargeable >= b.chargeableFrom &&
    (b.chargeableTo === null || b.chargeableTo === undefined || chargeable <= b.chargeableTo)) || null;
}

/**
 * Project the year's chargeable income from the current month's remuneration.
 *
 * `P = (current monthly net of EPF) × remaining months + accumulated to date
 *      + current month − total reliefs`
 *
 * @param {object} a
 * @param {number} a.monthlyRemuneration current month's gross
 * @param {number} a.monthlyEpf employee EPF this month (deductible, capped)
 * @param {number} a.accumulatedRemuneration gross paid earlier this year
 * @param {number} a.accumulatedEpf employee EPF paid earlier this year
 * @param {number} a.remainingMonths months left AFTER the current one (n)
 * @param {number} a.totalReliefs individual + spouse + child + other reliefs
 */
function projectChargeableIncome({
  monthlyRemuneration, monthlyEpf, accumulatedRemuneration, accumulatedEpf,
  remainingMonths, totalReliefs,
}) {
  const netMonthly = monthlyRemuneration - monthlyEpf;
  const projectedRemaining = netMonthly * remainingMonths;
  const toDate = (accumulatedRemuneration - accumulatedEpf) + netMonthly;
  return Math.max(0, toDate + projectedRemaining - totalReliefs);
}

/**
 * @returns {{amount: number, basis: object}} amount is MYR, rounded to 5 sen
 *   the way LHDN expresses MTD.
 * @throws {Error} when no band matches the projected income.
 */
function computePcb({
  monthlyRemuneration, monthlyEpf = 0,
  accumulatedRemuneration = 0, accumulatedEpf = 0,
  remainingMonths, category, totalReliefs = 0,
  zakatPaid = 0, mtdPaid = 0,
  bands,
}) {
  if (!Number.isInteger(remainingMonths) || remainingMonths < 0) {
    const err = new Error(`remainingMonths must be a non-negative integer, got ${remainingMonths}`);
    err.code = 'PCB_BAD_PERIOD';
    throw err;
  }

  const P = projectChargeableIncome({
    monthlyRemuneration, monthlyEpf, accumulatedRemuneration, accumulatedEpf,
    remainingMonths, totalReliefs,
  });

  const band = findBand(bands, { chargeable: P, category });
  if (!band) {
    const err = new Error(`No PCB band for chargeable income ${P}, category ${category}`);
    err.code = 'PCB_BAND_NOT_FOUND';
    throw err;
  }

  const { chargeableFrom: M, rate: R, cumulativeTax: B } = band;
  const yearLiability = (P - M) * R + B;
  const raw = (yearLiability - (zakatPaid + mtdPaid)) / (remainingMonths + 1);

  // Floored at zero: MTD never refunds through payroll (see the header note).
  const amount = roundTo5Sen(Math.max(0, raw));

  return {
    amount,
    basis: {
      projectedChargeableIncome: P,
      bandFloor: M, bandRate: R, cumulativeTax: B,
      category,
      yearLiability: round2(yearLiability),
      zakatPaid, mtdPaid,
      remainingMonths,
      divisor: remainingMonths + 1,
      flooredAtZero: raw < 0,
      method: 'LHDN_COMPUTERISED',
    },
  };
}

/** LHDN expresses MTD in multiples of 5 sen. */
function roundTo5Sen(amount) {
  return Math.round(amount * 20) / 20;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = { computePcb, projectChargeableIncome, findBand, roundTo5Sen };
