'use strict';
/**
 * Benefits-in-Kind (BIK) computation engine for IRAS Appendix 8A.
 *
 * IRAS prescribed formulas (Income Tax Act, IRAS guidance for car/housing BIK):
 *
 * COMPANY CAR:
 *   Base benefit  = 3/7 × (capital cost − residual value at end of useful life)
 *   IRAS simplifies as: Annual taxable benefit = (3/7) × Cost of Car
 *   If employer also pays running costs (fuel, parking, road tax, insurance):
 *     additional taxable benefit = (3/7) × annual running cost
 *   For cars with engine capacity > 3000cc, employer typically applies a higher
 *   prescribed value — we leave the lookup table extensible (rate map below).
 *
 * HOUSING:
 *   Annual taxable benefit = IRAS-assessed Annual Value (AV) of the property
 *   provided rent-free, less any amount paid by the employee.
 *
 * CLUB MEMBERSHIP, GROUP INSURANCE, OTHER:
 *   Annual taxable benefit = actual cost paid by employer (manual entry).
 */

// IRAS car benefit factor — 3/7 of cost
const CAR_BENEFIT_FACTOR = 3 / 7;

// Engine capacity bands → prescribed-value multiplier (defaults to 1.0)
// If a regulator later publishes adjusted rates for high-cc cars, override here.
const ENGINE_CAPACITY_MULTIPLIER = [
  { maxCc: 1500, multiplier: 1.0 },
  { maxCc: 3000, multiplier: 1.0 },
  { maxCc: Infinity, multiplier: 1.0 },
];

function multiplierForEngine(cc) {
  if (!cc || cc <= 0) return 1.0;
  for (const band of ENGINE_CAPACITY_MULTIPLIER) {
    if (cc <= band.maxCc) return band.multiplier;
  }
  return 1.0;
}

/**
 * Compute annual taxable benefit for a company car.
 * @param {Object} p
 * @param {number} p.engineCapacity   cc (optional, used for prescribed multiplier)
 * @param {number} p.carPurchaseCost  SGD
 * @param {boolean} p.employerProvidesFuel
 * @param {number} p.runningCost       SGD/year (only used if employerProvidesFuel)
 * @returns {number} annual taxable benefit, SGD, 2-dp
 */
function computeCompanyCarBik({ engineCapacity = 0, carPurchaseCost = 0, employerProvidesFuel = false, runningCost = 0 }) {
  const m = multiplierForEngine(engineCapacity);
  const carBenefit = CAR_BENEFIT_FACTOR * (carPurchaseCost || 0) * m;
  const fuelBenefit = employerProvidesFuel ? CAR_BENEFIT_FACTOR * (runningCost || 0) : 0;
  return Math.round((carBenefit + fuelBenefit) * 100) / 100;
}

/**
 * Compute housing BIK.
 * @param {Object} p
 * @param {number} p.annualValue   IRAS-assessed AV, SGD/year
 * @param {number} [p.employeeContribution=0]   amount paid by employee, SGD/year
 * @returns {number} annual taxable benefit, SGD, 2-dp
 */
function computeHousingBik({ annualValue = 0, employeeContribution = 0 }) {
  const v = Math.max(0, (annualValue || 0) - (employeeContribution || 0));
  return Math.round(v * 100) / 100;
}

/**
 * Compute stock option taxable gain at exercise (Appendix 8B).
 * Gain = (OMV at exercise − option price) × shares exercised.
 * If OMV ≤ option price, gain is 0 (option underwater; not taxable).
 */
function computeStockOptionGain({ marketValueAtExercise = 0, optionPrice = 0, sharesExercised = 0 }) {
  const gainPerShare = Math.max(0, (marketValueAtExercise || 0) - (optionPrice || 0));
  const total = gainPerShare * (sharesExercised || 0);
  return Math.round(total * 100) / 100;
}

/**
 * Dispatcher: given a BIK input, compute its annual value.
 */
function computeBikAnnualValue(input) {
  switch (input.bikType) {
    case 'COMPANY_CAR':
      return computeCompanyCarBik(input);
    case 'HOUSING':
      return computeHousingBik({ annualValue: input.housingAnnualValue, employeeContribution: input.employeeContribution });
    case 'CLUB_MEMBERSHIP':
    case 'GROUP_INSURANCE':
    case 'OTHER':
    default:
      return Math.round((input.annualValue || 0) * 100) / 100;
  }
}

module.exports = {
  computeCompanyCarBik,
  computeHousingBik,
  computeStockOptionGain,
  computeBikAnnualValue,
  CAR_BENEFIT_FACTOR,
};
