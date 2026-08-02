'use strict';
/**
 * Unit tests for Singapore statutory computation — CPF, SDL, FWL.
 *
 * Regulatory basis:
 *   - CPF Act (Cap. 36) + CPF Board published rates
 *   - Skills Development Levy Act — SDL computation
 *   - Employment of Foreign Manpower Act — FWL
 *
 * MOVED VERBATIM from services/payroll-service/__tests__/payroll-utils.unit.test.js
 * in the P1 statutory extraction. Every assertion and expected value is
 * unchanged: these tests passing against the relocated engine is the proof that
 * the move preserved behaviour, so altering them would defeat their purpose.
 *
 * CPF rate schedule used by the fixtures (employees aged <=55, SC/PR):
 *   OW Ceiling:      SGD 6,800/month      AW Ceiling: SGD 102,000/year
 *   Employee rate:   20%                  Employer rate: 17%
 * SDL: 0.25% of remuneration capped at SGD 4,500; min SGD 2.00, max SGD 11.25.
 */

const {
  computeCpf,
  computeSdl,
  computeFwl,
  cpfRound,
} = require('../src/engines/cpf.engine');

// Standard CPF rates for SC/PR Yr3+, age <=55
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

