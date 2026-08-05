'use strict';

/**
 * SOCSO / PERKESO — Employees' Social Security Act 1969 (PRD MYP-002).
 *
 * Two categories, and getting the category wrong is the expensive mistake:
 *
 *   Category 1 — employee below 60, Malaysian citizen or PR.
 *                Employment Injury AND Invalidity schemes. Employer and
 *                employee both contribute.
 *   Category 2 — employee 60 or above, and foreign workers.
 *                Employment Injury scheme ONLY. Employer contributes; the
 *                employee share is nil.
 *
 * Deducting an employee share from a Category 2 worker is an unlawful deduction
 * from wages, so the category is derived here rather than trusted from input.
 * Like EPF this is a published band table (PERKESO Second Schedule), not a
 * percentage — see the note in epf.engine.js for why that distinction matters.
 */

/**
 * Category is DERIVED, never supplied. A caller that passed its own category
 * could quietly deduct from a 60-year-old.
 */
function categoryFor({ age, citizenship }) {
  if (age >= 60) return 2;
  if (citizenship === 'FOREIGNER') return 2;
  return 1;
}

function findBand(bands, { wages, category }) {
  return bands.find((b) =>
    b.category === category &&
    wages >= b.wageFrom &&
    (b.wageTo === null || b.wageTo === undefined || wages <= b.wageTo)) || null;
}

/**
 * @returns {{employee: number, employer: number, category: number, basis: object}}
 * @throws {Error} when no band matches — the run must stop rather than compute
 *   a zero contribution, which would look like a legitimately exempt employee.
 */
function computeSocso({ wages, age, citizenship, bands }) {
  const category = categoryFor({ age, citizenship });
  const band = findBand(bands, { wages, category });
  if (!band) {
    const err = new Error(`No SOCSO band for wages ${wages}, category ${category}`);
    err.code = 'SOCSO_BAND_NOT_FOUND';
    throw err;
  }

  // Belt and braces: even if a Category 2 row were seeded with an employee
  // amount, no employee share may be taken. The table is data and data can be
  // wrong; this rule comes from the Act.
  const employee = category === 2 ? 0 : band.employeeAmount;

  return {
    employee,
    employer: band.employerAmount,
    category,
    basis: {
      wageFrom: band.wageFrom,
      wageTo: band.wageTo,
      category,
      scheme: category === 1 ? 'INJURY_AND_INVALIDITY' : 'INJURY_ONLY',
      employeeAmount: band.employeeAmount,
      employerAmount: band.employerAmount,
      employeeSuppressed: category === 2 && band.employeeAmount > 0,
    },
  };
}

module.exports = { computeSocso, categoryFor, findBand };
