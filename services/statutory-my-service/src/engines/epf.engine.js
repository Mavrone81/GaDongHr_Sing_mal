'use strict';

/**
 * EPF — Employees Provident Fund Act 1991 (PRD MYP-001).
 *
 * WHY THIS IS A LOOKUP AND NOT A PERCENTAGE
 *
 * The KWSP Third Schedule publishes an exact ringgit amount for each wage band,
 * and those amounts are NOT simply the percentage applied to the wage. The
 * schedule works on the band's upper limit and applies its own rounding, so
 * `Math.round(wage * 0.11)` disagrees with the published figure at many bands.
 * A few sen per employee per month is not a rounding curiosity: KWSP reconciles
 * against the schedule, and the employer carries the shortfall plus a late
 * charge. So the table IS the specification, and this engine only looks up.
 *
 * Percentages appear once, above the schedule's top band, where the Act applies
 * them directly. Those rows carry employeeRate/employerRate instead of amounts.
 */

/** Wage used for the EPF lookup: EPF applies to wages as defined by the Act. */
function findBand(bands, { wages, age, citizenship }) {
  const ageBand = age >= 60 ? 'AGE_60_PLUS' : 'BELOW_60';
  return bands.find((b) =>
    b.ageBand === ageBand &&
    b.citizenship === citizenship &&
    wages >= b.wageFrom &&
    (b.wageTo === null || b.wageTo === undefined || wages <= b.wageTo)) || null;
}

/**
 * Round HALF UP to the ringgit above, which is how KWSP expresses the
 * percentage bands ("the next ringgit"). Deliberately not Math.round: for a
 * contribution, rounding .5 down would systematically under-contribute.
 */
function toNextRinggit(amount) {
  return Math.ceil(Math.round(amount * 100) / 100);
}

/**
 * @returns {{employee: number, employer: number, basis: object}}
 * @throws {Error} when no band matches — the caller must fail the run, never
 *   substitute zero. A missing band means the table is incomplete for this
 *   employee, and a zero EPF line on a payslip is a silent underpayment.
 */
function computeEpf({ wages, age, citizenship, bands }) {
  const band = findBand(bands, { wages, age, citizenship });
  if (!band) {
    const err = new Error(
      `No EPF band for wages ${wages}, age ${age}, citizenship ${citizenship}`);
    err.code = 'EPF_BAND_NOT_FOUND';
    throw err;
  }

  // A band is either an amount band (from the schedule) or a percentage band
  // (above its top). Never both, and never neither.
  const hasAmounts = band.employeeAmount !== null && band.employeeAmount !== undefined;
  const hasRates = band.employeeRate !== null && band.employeeRate !== undefined;
  if (hasAmounts === hasRates) {
    const err = new Error(
      `EPF band ${band.id ?? band.wageFrom} defines ${hasAmounts ? 'both' : 'neither'} amounts and rates`);
    err.code = 'EPF_BAND_MALFORMED';
    throw err;
  }

  const employee = hasAmounts ? band.employeeAmount : toNextRinggit(wages * band.employeeRate);
  const employer = hasAmounts ? band.employerAmount : toNextRinggit(wages * band.employerRate);

  return {
    employee,
    employer,
    // The audit trail: which band produced this figure, so a payslip stays
    // defensible years after the table has moved on.
    basis: {
      wageFrom: band.wageFrom,
      wageTo: band.wageTo,
      ageBand: band.ageBand,
      citizenship: band.citizenship,
      employeeAmount: band.employeeAmount ?? null,
      employerAmount: band.employerAmount ?? null,
      employeeRate: band.employeeRate ?? null,
      employerRate: band.employerRate ?? null,
      method: hasAmounts ? 'THIRD_SCHEDULE_BAND' : 'STATUTORY_PERCENTAGE',
    },
  };
}

module.exports = { computeEpf, findBand, toNextRinggit };
