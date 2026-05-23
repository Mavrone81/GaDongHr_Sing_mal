'use strict';
/**
 * Unit tests for Singapore payroll computation functions in shared/payroll-utils
 *
 * Regulatory basis:
 *   - CPF Act (Cap. 36) + CPF Board published rates (Jan 2025)
 *   - Employment Act (Cap. 91) — OT pay (Section 38), NPL, salary deductions
 *   - Skills Development Levy Act — SDL computation
 *   - Income Tax Act / IRAS AIS — AWS and bonus treatment
 *
 * CPF rate schedule Jan 2025 (employees aged ≤55, SC/PR):
 *   OW Ceiling:          SGD 6,800/month
 *   AW Ceiling (annual): SGD 102,000/year
 *   Employee rate:       20% (SC/PR Yr3+)
 *   Employer rate:       17% (SC/PR Yr3+)
 *
 * SDL schedule:
 *   Rate:     0.25% of remuneration (capped at SGD 4,500)
 *   Min:      SGD 2.00
 *   Max:      SGD 11.25
 */

const {
  computeCpf,
  computeSdl,
  computeOtPay,
  computeNplDeduction,
  computeAws,
  computeFwl,
  computeNetPay,
  cpfRound,
  countWorkingDays,
  countPeriodLeaveWorkingDays,
} = require('/app/shared/payroll-utils');

// ── Standard CPF rates for SC/PR Yr3+, age ≤55 ──────────────────────────────
const STD_RATES = { owCeiling: 6800, awCeiling: 102000, employeeRate: 0.20, employerRate: 0.17 };

// ── A) computeCpf — OW contribution ─────────────────────────────────────────
describe('computeCpf — Ordinary Wages (OW)', () => {
  describe('A1) SC/PR below OW ceiling', () => {
    test('standard employee: 20% employee + 17% employer on full OW', () => {
      const result = computeCpf({ ow: 5000, citizenStatus: 'SC', age: 35, rates: STD_RATES });
      // Employee: 5000 * 0.20 = 1000; Employer: 5000 * 0.17 = 850
      expect(result.employeeOw).toBe(1000);
      expect(result.employerOw).toBe(850);
      expect(result.totalEmployee).toBe(1000);
      expect(result.totalEmployer).toBe(850);
    });

    test('PR Yr3+: same rates as SC', () => {
      const result = computeCpf({ ow: 4000, citizenStatus: 'PR_YR3_PLUS', age: 40, rates: STD_RATES });
      expect(result.employeeOw).toBe(800);
      expect(result.employerOw).toBe(680);
    });
  });

  describe('A2) OW ceiling enforcement — MOM cap at SGD 6,800/month', () => {
    test('OW above ceiling is capped at 6800', () => {
      const result = computeCpf({ ow: 8000, citizenStatus: 'SC', age: 35, rates: STD_RATES });
      // Capped at 6800: Employee 6800*0.20=1360; Employer 6800*0.17=1156
      expect(result.employeeOw).toBe(1360);
      expect(result.employerOw).toBe(1156);
      expect(result.owSubjectToCpf).toBe(6800);
    });

    test('OW exactly at ceiling: no over-contribution', () => {
      const result = computeCpf({ ow: 6800, citizenStatus: 'SC', age: 35, rates: STD_RATES });
      expect(result.owSubjectToCpf).toBe(6800);
      expect(result.employeeOw).toBe(1360);
    });

    test('OW = 0: no contribution', () => {
      const result = computeCpf({ ow: 0, citizenStatus: 'SC', age: 35, rates: STD_RATES });
      expect(result.totalEmployee).toBe(0);
      expect(result.totalEmployer).toBe(0);
    });
  });

  describe('A3) Foreigner exemption — CPF Act Section 62', () => {
    test('FOREIGNER has zero CPF across all fields', () => {
      const result = computeCpf({ ow: 10000, aw: 5000, citizenStatus: 'FOREIGNER', age: 35, rates: STD_RATES });
      expect(result.employeeOw).toBe(0);
      expect(result.employerOw).toBe(0);
      expect(result.employeeAw).toBe(0);
      expect(result.employerAw).toBe(0);
      expect(result.totalEmployee).toBe(0);
      expect(result.totalEmployer).toBe(0);
    });
  });
});

// ── B) computeCpf — Additional Wages (AW) ───────────────────────────────────
describe('computeCpf — Additional Wages (AW)', () => {
  describe('B1) AW ceiling = SGD 102,000 - YTD OW', () => {
    test('AW within ceiling is fully subject to CPF', () => {
      // YTD OW=0, AW=10000: AW ceiling remaining = 102000-0=102000
      const result = computeCpf({ ow: 5000, aw: 10000, ytdOw: 0, ytdAw: 0, citizenStatus: 'SC', age: 35, rates: STD_RATES });
      // AW ceiling remaining = 102000 - 0 (ytdOw) - 5000 (this month's OW, capped) = 97000
      // AW subject: min(10000, min(97000, 102000-0)) = 10000
      expect(result.awSubjectToCpf).toBe(10000);
      expect(result.employeeAw).toBe(2000); // 10000*0.20
      expect(result.employerAw).toBe(1700); // 10000*0.17
    });

    test('AW exceeding remaining ceiling is capped (bonus bridging year)', () => {
      // YTD OW already = 81600 (12*6800), AW = 30000
      // AW ceiling remaining = 102000 - 81600 - 5000 (this OW) = 15400
      const result = computeCpf({ ow: 5000, aw: 30000, ytdOw: 81600, ytdAw: 0, citizenStatus: 'SC', age: 35, rates: STD_RATES });
      expect(result.awSubjectToCpf).toBe(15400);
      expect(result.employeeAw).toBe(cpfRound(15400 * 0.20));
    });

    test('AW = 0: no AW contribution', () => {
      const result = computeCpf({ ow: 5000, aw: 0, citizenStatus: 'SC', age: 35, rates: STD_RATES });
      expect(result.employeeAw).toBe(0);
      expect(result.employerAw).toBe(0);
    });
  });

  describe('B2) Annual AW ceiling carryover', () => {
    test('ytdAw reduces AW ceiling available', () => {
      // ytdAw = 95000 already used, AW = 10000, ytdOw = 0, this month OW = 5000
      // Combined ceiling remaining = 102000 - 0 (ytdOw) - 5000 (this OW) = 97000
      // Pure AW ceiling available = 102000 - 95000 (ytdAw) = 7000
      // awSubjectToCpf = min(10000, min(97000, 7000)) = 7000
      const result = computeCpf({ ow: 5000, aw: 10000, ytdOw: 0, ytdAw: 95000, citizenStatus: 'SC', age: 35, rates: STD_RATES });
      expect(result.awSubjectToCpf).toBe(7000);
    });

    test('ytdAw = 102000: no more AW CPF possible', () => {
      const result = computeCpf({ ow: 5000, aw: 5000, ytdOw: 0, ytdAw: 102000, citizenStatus: 'SC', age: 35, rates: STD_RATES });
      expect(result.awSubjectToCpf).toBe(0);
      expect(result.employeeAw).toBe(0);
    });
  });
});

// ── C) computeSdl — Skills Development Levy Act ──────────────────────────────
describe('computeSdl — SDL per MOM/Enterprise Singapore', () => {
  const sdlConfig = { rate: 0.0025, minAmount: 2.00, maxAmount: 11.25, salaryCap: 4500 };

  test('SDL below minimum: floors at SGD 2.00', () => {
    // 400 * 0.0025 = 1.00 < min 2.00, so SDL = 2.00
    expect(computeSdl(400, sdlConfig)).toBe(2.00);
  });

  test('SDL at typical salary (SGD 3,000): 3000*0.0025=7.50', () => {
    expect(computeSdl(3000, sdlConfig)).toBe(7.50);
  });

  test('SDL caps at SGD 11.25 (salary = 4500, 4500*0.0025=11.25)', () => {
    expect(computeSdl(4500, sdlConfig)).toBe(11.25);
  });

  test('SDL capped by salary ceiling (SGD 4,500): above 4500 salary still SGD 11.25', () => {
    expect(computeSdl(8000, sdlConfig)).toBe(11.25);
  });

  test('SDL for zero salary is 0 (not subject)', () => {
    expect(computeSdl(0, sdlConfig)).toBe(0);
  });

  test('SDL rounds to 2 decimal places', () => {
    // 2800 * 0.0025 = 7.00 — exact
    expect(computeSdl(2800, sdlConfig)).toBe(7.00);
    // 3100 * 0.0025 = 7.75
    expect(computeSdl(3100, sdlConfig)).toBe(7.75);
  });
});

// ── D) computeOtPay — EA Section 38 OT pay ──────────────────────────────────
describe('computeOtPay — Employment Act Section 38', () => {
  test('OT pay = 1.5x hourly rate (standard EA)', () => {
    // Monthly basic 3000, weekly 44 hours, 10 OT hours
    // Hourly = (3000*12)/(52*44) = 36000/2288 = ~15.734...
    // OT = 15.734 * 1.5 * 10 = 235.99
    const ot = computeOtPay(3000, 44, 10, 1.5);
    const hourly = (3000 * 12) / (52 * 44);
    const expected = Math.round(hourly * 1.5 * 10 * 100) / 100;
    expect(ot).toBe(expected);
  });

  test('OT pay at 2x multiplier (rest day/public holiday)', () => {
    const ot = computeOtPay(3000, 44, 8, 2.0);
    const hourly = (3000 * 12) / (52 * 44);
    const expected = Math.round(hourly * 2.0 * 8 * 100) / 100;
    expect(ot).toBe(expected);
  });

  test('zero OT hours = zero OT pay', () => {
    expect(computeOtPay(3000, 44, 0)).toBe(0);
  });

  test('OT hourly rate uses EA formula: annual/52/weekly_hours', () => {
    // Verify the hourly rate computation exactly
    const monthly = 4000;
    const weekly = 44;
    const otHours = 5;
    const mult = 1.5;
    const expectedHourly = (monthly * 12) / (52 * weekly);
    const expected = Math.round(expectedHourly * mult * otHours * 100) / 100;
    expect(computeOtPay(monthly, weekly, otHours, mult)).toBe(expected);
  });
});

// ── E) computeNplDeduction — No-Pay Leave deduction ─────────────────────────
describe('computeNplDeduction — NPL salary deduction', () => {
  test('NPL deduction = (monthly/26) * NPL days', () => {
    // 3000 / 26 = 115.3846..., 3 days = 346.15
    const deduction = computeNplDeduction(3000, 3);
    const expected = Math.round((3000 / 26) * 3 * 100) / 100;
    expect(deduction).toBe(expected);
  });

  test('zero NPL days = zero deduction', () => {
    expect(computeNplDeduction(3000, 0)).toBe(0);
  });

  test('1 day NPL deduction', () => {
    const deduction = computeNplDeduction(5200, 1);
    expect(deduction).toBe(Math.round((5200 / 26) * 100) / 100);
  });

  test('NPL deduction for high earner', () => {
    // 10000 / 26 * 5 = 1923.08
    const deduction = computeNplDeduction(10000, 5);
    expect(deduction).toBe(Math.round((10000 / 26) * 5 * 100) / 100);
  });
});

// ── F) computeAws — Annual Wage Supplement ──────────────────────────────────
describe('computeAws — AWS (13th Month Pay)', () => {
  test('full year AWS = 1x monthly basic', () => {
    expect(computeAws(4000, 12)).toBe(4000.00);
  });

  test('prorated AWS for 6 months service = 0.5x monthly basic', () => {
    expect(computeAws(4000, 6)).toBe(2000.00);
  });

  test('prorated AWS for 3 months service = 0.25x monthly basic', () => {
    expect(computeAws(4000, 3)).toBe(1000.00);
  });

  test('AWS rounds to 2 decimal places', () => {
    // 3000 * (7/12) = 1750.00 — exact
    expect(computeAws(3000, 7)).toBe(Math.round(3000 * (7 / 12) * 100) / 100);
  });

  test('AWS defaults to 12 months if not specified', () => {
    expect(computeAws(5000)).toBe(5000.00);
  });
});

// ── G) computeFwl — Foreign Worker Levy ─────────────────────────────────────
describe('computeFwl — Foreign Worker Levy (MOM)', () => {
  test('FWL = daily rate * days in month', () => {
    // Daily rate SGD 15 (S-Pass basic), 31 days
    expect(computeFwl(15, 31)).toBe(465.00);
  });

  test('FWL for 28-day February', () => {
    expect(computeFwl(15, 28)).toBe(420.00);
  });

  test('FWL for zero daily rate = 0', () => {
    expect(computeFwl(0, 31)).toBe(0);
  });
});

// ── H) computeNetPay — Net pay calculation ──────────────────────────────────
describe('computeNetPay — Net Salary Computation', () => {
  test('net = gross - employee CPF', () => {
    const net = computeNetPay({ grossPay: 5000, employeeCpf: 1000 });
    expect(net).toBe(4000);
  });

  test('net includes NPL deduction', () => {
    const net = computeNetPay({ grossPay: 5000, employeeCpf: 1000, nplDeduction: 115.38 });
    expect(net).toBeCloseTo(3884.62, 1);
  });

  test('net includes reimbursements (positive)', () => {
    const net = computeNetPay({ grossPay: 5000, employeeCpf: 1000, reimbursements: 200 });
    expect(net).toBe(4200);
  });

  test('multiple deductions combine correctly', () => {
    const net = computeNetPay({
      grossPay: 5000,
      employeeCpf: 1000,
      nplDeduction: 115.38,
      loanRepayment: 200,
      reimbursements: 50,
    });
    // 5000 - 1000 - 115.38 - 200 + 50 = 3734.62
    expect(net).toBeCloseTo(3734.62, 1);
  });

  test('zero gross = negative net (edge case — deductions exceed gross)', () => {
    const net = computeNetPay({ grossPay: 100, employeeCpf: 20, absenceDeduction: 300 });
    expect(net).toBe(-220);
  });
});

// ── I) cpfRound — CPF rounding rule ─────────────────────────────────────────
describe('cpfRound — CPF Board rounding (nearest dollar)', () => {
  test('rounds 0.5 up', () => { expect(cpfRound(100.5)).toBe(101); });
  test('rounds 0.4 down', () => { expect(cpfRound(100.4)).toBe(100); });
  test('integer is unchanged', () => { expect(cpfRound(500)).toBe(500); });
  test('rounds large amount correctly', () => { expect(cpfRound(1360.5)).toBe(1361); });
});

// ── J) Edge cases — IRAS-relevant scenarios ──────────────────────────────────
describe('J) Edge and IRAS-compliance cases', () => {
  test('CPF on salary just below S$50 threshold — bracket logic NOT implemented (system simplification)', () => {
    // Per CPF Board, wages ≤ S$50 require NIL contribution (both sides).
    // The engine doesn't implement the bracket structure — it always applies
    // the full rate. Documented as a known simplification; the figures asserted
    // below are what the engine produces, NOT what CPF Board mandates.
    //
    // Per CPF Board rounding (Jan 2026 PDF "Steps to compute CPF contribution"):
    //   total    = round nearest    = round(49 × 0.37) = round(18.13) = 18
    //   employee = floor             = floor(49 × 0.20) = floor(9.80) = 9
    //   employer = total − employee  = 18 − 9 = 9
    const result = computeCpf({ ow: 49, citizenStatus: 'SC', age: 35, rates: { ...STD_RATES, employeeRate: 0.20, employerRate: 0.17 } });
    expect(result.employeeOw).toBe(9);
    expect(result.employerOw).toBe(9);
    expect(result.totalEmployee + result.totalEmployer).toBe(18);
  });

  test('PR Year 1 graduated rates (lower contribution)', () => {
    // PR Yr1: Employer 4%, Employee 5% (graduated rate)
    const pr1Rates = { ...STD_RATES, employeeRate: 0.05, employerRate: 0.04 };
    const result = computeCpf({ ow: 4000, citizenStatus: 'PR_YEAR1', age: 35, rates: pr1Rates });
    expect(result.employeeOw).toBe(cpfRound(4000 * 0.05));
    expect(result.employerOw).toBe(cpfRound(4000 * 0.04));
  });

  test('PR Year 2 graduated rates', () => {
    const pr2Rates = { ...STD_RATES, employeeRate: 0.15, employerRate: 0.09 };
    const result = computeCpf({ ow: 4000, citizenStatus: 'PR_YEAR2', age: 35, rates: pr2Rates });
    expect(result.employeeOw).toBe(cpfRound(4000 * 0.15));
    expect(result.employerOw).toBe(cpfRound(4000 * 0.09));
  });

  test('AWS is subject to CPF (IRAS: bonus forms part of AW)', () => {
    // AWS = 6000; OW = 5000, no prior AW. Should compute CPF on 6000 as AW.
    const result = computeCpf({ ow: 5000, aw: 6000, ytdOw: 0, ytdAw: 0, citizenStatus: 'SC', age: 35, rates: STD_RATES });
    expect(result.awSubjectToCpf).toBe(6000);
    expect(result.employeeAw).toBe(cpfRound(6000 * 0.20));
  });

  test('total CPF (employee + employer) adds up', () => {
    const result = computeCpf({ ow: 5000, aw: 2000, citizenStatus: 'SC', age: 35, rates: STD_RATES });
    const total = result.totalEmployee + result.totalEmployer;
    const expected = result.employeeOw + result.employerOw + result.employeeAw + result.employerAw;
    expect(total).toBe(expected);
  });
});

// ── I) countWorkingDays ──────────────────────────────────────────────────────
// Calendar dates used: Jan 2026 (22 working days), Feb 2026 (20 working days)
// Jan 20 = Tue, Jan 26 = Mon, Jan 31 = Sat
// Feb 1 = Sun, Feb 2 = Mon, Feb 8 = Sun
describe('countWorkingDays', () => {
  const NO_HOLIDAYS = new Set();

  test('I1 — FIVE_DAY: Mon–Fri within one week, excludes weekend', () => {
    // May 4–10 2026: Mon(4), Tue(5), Wed(6), Thu(7), Fri(8) = 5; Sat(9), Sun(10) = 0
    expect(countWorkingDays(new Date('2026-05-04'), new Date('2026-05-10'), NO_HOLIDAYS)).toBe(5);
  });

  test('I2 — SIX_DAY: Mon–Sat, excludes Sunday only', () => {
    // May 4–10 2026: Mon–Sat = 6; Sun = 0
    expect(countWorkingDays(new Date('2026-05-04'), new Date('2026-05-10'), NO_HOLIDAYS, 'SIX_DAY')).toBe(6);
  });

  test('I3 — public holiday reduces count by 1', () => {
    // May 4–8 = 5 working days; mark May 5 (Tue) as holiday → 4
    const holidays = new Set(['2026-05-05']);
    expect(countWorkingDays(new Date('2026-05-04'), new Date('2026-05-08'), holidays)).toBe(4);
  });

  test('I4 — full January 2026: 22 working days (FIVE_DAY, no holidays)', () => {
    // Jan 1=Thu, Jan 2=Fri, then 4 full Mon–Fri weeks (Jan 5–30) + Jan 1–2 = 2+20 = 22
    expect(countWorkingDays(new Date('2026-01-01'), new Date('2026-01-31'), NO_HOLIDAYS)).toBe(22);
  });

  test('I5 — full February 2026: 20 working days (FIVE_DAY, no holidays)', () => {
    // Feb 1=Sun; 4 Mon–Fri weeks = 20
    expect(countWorkingDays(new Date('2026-02-01'), new Date('2026-02-28'), NO_HOLIDAYS)).toBe(20);
  });
});

// ── J) countPeriodLeaveWorkingDays — cross-month pro-ration ─────────────────
// User example: leave Jan 20 – Feb 8, 2026
//   Jan portion (Jan 20–31): Jan 20(Tue)–23(Fri)=4, Jan 26(Mon)–30(Fri)=5, Jan 31=Sat → 9 days
//   Feb portion (Feb 1–8):   Feb 1=Sun, Feb 2(Mon)–6(Fri)=5, Feb 7=Sat, Feb 8=Sun   → 5 days
describe('countPeriodLeaveWorkingDays', () => {
  const NO_HOLIDAYS = new Set();
  const MAY_START   = new Date('2026-05-01');
  const MAY_END     = new Date('2026-05-31');
  const JAN_START   = new Date('2026-01-01');
  const JAN_END     = new Date('2026-01-31');
  const FEB_START   = new Date('2026-02-01');
  const FEB_END     = new Date('2026-02-28');

  test('J1 — same-month leave returns working days in range', () => {
    // May 5 (Mon) – May 6 (Tue) = 2 working days
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-05-05'), new Date('2026-05-06'), MAY_START, MAY_END, NO_HOLIDAYS
    )).toBe(2);
  });

  test('J2 — cross-month start (Apr 28 → May 3): only May working days counted', () => {
    // May portion: May 1(Fri)=1; May 2(Sat), May 3(Sun)=0 → 1
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-04-28'), new Date('2026-05-03'), MAY_START, MAY_END, NO_HOLIDAYS
    )).toBe(1);
  });

  test('J3 — cross-month end (May 28 → Jun 5): only May working days counted', () => {
    // May 28(Thu)=1, May 29(Fri)=1, May 30(Sat), May 31(Sun)=0 → 2
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-05-28'), new Date('2026-06-05'), MAY_START, MAY_END, NO_HOLIDAYS
    )).toBe(2);
  });

  test('J4 — leave entirely before period: returns 0', () => {
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-01-05'), new Date('2026-01-10'), MAY_START, MAY_END, NO_HOLIDAYS
    )).toBe(0);
  });

  test('J5 — leave entirely after period: returns 0', () => {
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-06-01'), new Date('2026-06-10'), MAY_START, MAY_END, NO_HOLIDAYS
    )).toBe(0);
  });

  test('J6 — half-day on Monday: returns 0.5', () => {
    // May 12 (Mon), half-day
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-05-12'), new Date('2026-05-12'), MAY_START, MAY_END, NO_HOLIDAYS, 'FIVE_DAY', true
    )).toBe(0.5);
  });

  test('J7 — half-day on Saturday (FIVE_DAY): returns 0', () => {
    // May 9 (Sat) is not a working day
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-05-09'), new Date('2026-05-09'), MAY_START, MAY_END, NO_HOLIDAYS, 'FIVE_DAY', true
    )).toBe(0);
  });

  test('J8 — half-day on Saturday (SIX_DAY): returns 0.5', () => {
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-05-09'), new Date('2026-05-09'), MAY_START, MAY_END, NO_HOLIDAYS, 'SIX_DAY', true
    )).toBe(0.5);
  });

  test('J9 — public holiday within leave range: not counted as working day', () => {
    // May 1 (Fri) is a holiday; leave May 1–2: 0 working days (holiday + Sat)
    const holidays = new Set(['2026-05-01']);
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-05-01'), new Date('2026-05-02'), MAY_START, MAY_END, holidays
    )).toBe(0);
  });

  test('J10 — user example: Jan 20–Feb 8 counted from Jan period = 9 working days', () => {
    // Jan 20(Tue)–23(Fri)=4, Jan 26(Mon)–30(Fri)=5, Jan 31(Sat)=0 → 9
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-01-20'), new Date('2026-02-08'), JAN_START, JAN_END, NO_HOLIDAYS
    )).toBe(9);
  });

  test('J11 — user example: Jan 20–Feb 8 counted from Feb period = 5 working days', () => {
    // Feb 1(Sun)=0, Feb 2(Mon)–6(Fri)=5, Feb 7(Sat)=0, Feb 8(Sun)=0 → 5
    expect(countPeriodLeaveWorkingDays(
      new Date('2026-01-20'), new Date('2026-02-08'), FEB_START, FEB_END, NO_HOLIDAYS
    )).toBe(5);
  });
});
