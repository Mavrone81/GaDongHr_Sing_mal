'use strict';

/**
 * EIS / SIP — Employment Insurance System Act 2017 (PRD MYP-003).
 *
 * EIS is narrower than SOCSO: employees aged 60 and above, and foreign workers,
 * are OUTSIDE the scheme entirely. That is an exclusion, not a nil band — so
 * this returns zero with an explicit reason rather than looking up a band and
 * finding nothing, which would be indistinguishable from a missing table.
 *
 * The distinction matters when the run fails closed: "no band for this wage" is
 * a data problem the operator must fix, whereas "excluded by age" is the
 * correct answer and must not stop the run.
 */

const EXCLUDED_NONE = null;

/** @returns {string|null} the reason this employee is out of scope, or null. */
function exclusionReason({ age, citizenship }) {
  if (age >= 60) return 'AGE_60_OR_ABOVE';
  if (citizenship === 'FOREIGNER') return 'FOREIGN_WORKER';
  return EXCLUDED_NONE;
}

function findBand(bands, wages) {
  return bands.find((b) =>
    wages >= b.wageFrom &&
    (b.wageTo === null || b.wageTo === undefined || wages <= b.wageTo)) || null;
}

/**
 * @returns {{employee: number, employer: number, excluded: string|null, basis: object}}
 * @throws {Error} only when the employee IS in scope and no band matches.
 */
function computeEis({ wages, age, citizenship, bands }) {
  const excluded = exclusionReason({ age, citizenship });
  if (excluded) {
    return {
      employee: 0,
      employer: 0,
      excluded,
      basis: { excluded, scheme: 'EIS', note: 'Outside the scheme — not a nil band' },
    };
  }

  const band = findBand(bands, wages);
  if (!band) {
    const err = new Error(`No EIS band for wages ${wages}`);
    err.code = 'EIS_BAND_NOT_FOUND';
    throw err;
  }

  return {
    employee: band.employeeAmount,
    employer: band.employerAmount,
    excluded: EXCLUDED_NONE,
    basis: {
      wageFrom: band.wageFrom,
      wageTo: band.wageTo,
      employeeAmount: band.employeeAmount,
      employerAmount: band.employerAmount,
    },
  };
}

module.exports = { computeEis, exclusionReason, findBand };
