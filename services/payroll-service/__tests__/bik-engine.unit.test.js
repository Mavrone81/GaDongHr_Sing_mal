'use strict';
/**
 * Unit tests for the Benefits-in-Kind / stock-option computation engine.
 * Singapore IRAS reference: Income Tax Act, Appendix 8A & 8B rules.
 */
const {
  computeCompanyCarBik,
  computeHousingBik,
  computeStockOptionGain,
  computeBikAnnualValue,
  CAR_BENEFIT_FACTOR,
} = require('../src/engines/bik.engine');

describe('Company car BIK (Appendix 8A)', () => {
  test('IRAS factor is 3/7', () => {
    expect(CAR_BENEFIT_FACTOR).toBeCloseTo(3 / 7, 10);
  });

  test('car-only benefit = (3/7) × purchase cost', () => {
    const v = computeCompanyCarBik({ carPurchaseCost: 140000 });
    expect(v).toBeCloseTo(60000, 2); // 140000 × 3/7 = 60000
  });

  test('with employer-paid fuel, adds (3/7) × annual running cost', () => {
    const v = computeCompanyCarBik({
      carPurchaseCost: 70000,
      employerProvidesFuel: true,
      runningCost: 14000,
    });
    // base = 70000 × 3/7 = 30000; fuel = 14000 × 3/7 = 6000; total = 36000
    expect(v).toBeCloseTo(36000, 2);
  });

  test('no employer fuel → fuel component excluded', () => {
    const v = computeCompanyCarBik({
      carPurchaseCost: 70000,
      employerProvidesFuel: false,
      runningCost: 14000,
    });
    expect(v).toBeCloseTo(30000, 2);
  });

  test('zero / null inputs return 0', () => {
    expect(computeCompanyCarBik({})).toBe(0);
    expect(computeCompanyCarBik({ carPurchaseCost: 0 })).toBe(0);
  });

  test('rounds to 2 decimal places', () => {
    const v = computeCompanyCarBik({ carPurchaseCost: 100001 });
    // 100001 × 3/7 = 42857.571428... → 42857.57
    expect(v).toBe(42857.57);
  });

  test('engine capacity multiplier defaults to 1.0 (no penalty band currently active)', () => {
    const small = computeCompanyCarBik({ engineCapacity: 1400, carPurchaseCost: 70000 });
    const large = computeCompanyCarBik({ engineCapacity: 4000, carPurchaseCost: 70000 });
    expect(small).toBeCloseTo(large, 2);
  });
});

describe('Housing BIK (Appendix 8A)', () => {
  test('annual value = IRAS-assessed AV', () => {
    expect(computeHousingBik({ annualValue: 24000 })).toBe(24000);
  });

  test('employee contribution reduces taxable benefit', () => {
    expect(computeHousingBik({ annualValue: 24000, employeeContribution: 6000 })).toBe(18000);
  });

  test('employee contribution greater than AV clamps to zero', () => {
    expect(computeHousingBik({ annualValue: 12000, employeeContribution: 50000 })).toBe(0);
  });

  test('zero inputs return zero', () => {
    expect(computeHousingBik({})).toBe(0);
  });
});

describe('Stock option taxable gain (Appendix 8B)', () => {
  test('gain = (OMV − option price) × shares', () => {
    const g = computeStockOptionGain({ marketValueAtExercise: 25, optionPrice: 10, sharesExercised: 1000 });
    expect(g).toBe(15000); // (25 − 10) × 1000
  });

  test('underwater option (OMV ≤ option price) returns 0', () => {
    expect(computeStockOptionGain({ marketValueAtExercise: 5, optionPrice: 10, sharesExercised: 1000 })).toBe(0);
    expect(computeStockOptionGain({ marketValueAtExercise: 10, optionPrice: 10, sharesExercised: 1000 })).toBe(0);
  });

  test('rounds to 2dp', () => {
    const g = computeStockOptionGain({ marketValueAtExercise: 12.567, optionPrice: 10, sharesExercised: 100 });
    // (12.567 − 10) × 100 = 256.7
    expect(g).toBe(256.7);
  });

  test('zero shares returns 0', () => {
    expect(computeStockOptionGain({ marketValueAtExercise: 25, optionPrice: 10, sharesExercised: 0 })).toBe(0);
  });
});

describe('Dispatcher computeBikAnnualValue', () => {
  test('routes COMPANY_CAR to car formula', () => {
    const v = computeBikAnnualValue({ bikType: 'COMPANY_CAR', carPurchaseCost: 70000 });
    expect(v).toBe(30000); // 70000 × 3/7
  });

  test('routes HOUSING to housing formula', () => {
    const v = computeBikAnnualValue({ bikType: 'HOUSING', housingAnnualValue: 18000 });
    expect(v).toBe(18000);
  });

  test('CLUB_MEMBERSHIP / GROUP_INSURANCE / OTHER use manual annualValue', () => {
    expect(computeBikAnnualValue({ bikType: 'CLUB_MEMBERSHIP', annualValue: 5000 })).toBe(5000);
    expect(computeBikAnnualValue({ bikType: 'GROUP_INSURANCE', annualValue: 2400 })).toBe(2400);
    expect(computeBikAnnualValue({ bikType: 'OTHER', annualValue: 1234.5 })).toBe(1234.5);
  });
});
