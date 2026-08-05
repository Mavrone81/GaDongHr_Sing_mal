'use strict';

/**
 * Malaysian statutory engines.
 *
 * NOTE ON THE FIXTURES. Every band below is INVENTED for testing the lookup
 * logic and is deliberately not a transcription of any published schedule.
 * PRD §A7.2 requires the real reconciliation tests to transcribe expected values
 * from the KWSP Third Schedule and PERKESO Second Schedule directly, "never
 * hand-derived" — so putting plausible-looking real figures here would be worse
 * than useless: it would look like the reconciliation had been done.
 *
 * What these tests pin is the BEHAVIOUR the published tables get fed into:
 * band selection, the age-60 and foreign-worker boundaries, fail-closed on a
 * missing band, and the MTD formula. Those are the parts that are wrong in code
 * rather than wrong in data.
 */

const { computeEpf, toNextRinggit } = require('../src/engines/epf.engine');
const { computeSocso, categoryFor } = require('../src/engines/socso.engine');
const { computeEis, exclusionReason } = require('../src/engines/eis.engine');
const { computePcb, roundTo5Sen } = require('../src/engines/pcb.engine');

// ── EPF ──────────────────────────────────────────────────────────────────────

const EPF_BANDS = [
  { wageFrom: 0,    wageTo: 1000, ageBand: 'BELOW_60',    citizenship: 'CITIZEN', employeeAmount: 100, employerAmount: 130 },
  { wageFrom: 1000, wageTo: 5000, ageBand: 'BELOW_60',    citizenship: 'CITIZEN', employeeAmount: 550, employerAmount: 650 },
  { wageFrom: 5000, wageTo: null, ageBand: 'BELOW_60',    citizenship: 'CITIZEN', employeeRate: 0.11, employerRate: 0.12 },
  { wageFrom: 0,    wageTo: null, ageBand: 'AGE_60_PLUS', citizenship: 'CITIZEN', employeeAmount: 0,   employerAmount: 200 },
];

describe('EPF is a band lookup, not a percentage', () => {
  it('returns the published amount for the band, not wage x rate', () => {
    const r = computeEpf({ wages: 2000, age: 30, citizenship: 'CITIZEN', bands: EPF_BANDS });
    expect(r.employee).toBe(550);          // the band's amount
    expect(r.employee).not.toBe(2000 * 0.11); // NOT the percentage
    expect(r.basis.method).toBe('THIRD_SCHEDULE_BAND');
  });

  it('applies the statutory percentage above the schedule top band', () => {
    const r = computeEpf({ wages: 8000, age: 30, citizenship: 'CITIZEN', bands: EPF_BANDS });
    expect(r.basis.method).toBe('STATUTORY_PERCENTAGE');
    expect(r.employee).toBe(toNextRinggit(8000 * 0.11));
  });

  it('crosses to the 60-plus table at exactly 60', () => {
    const under = computeEpf({ wages: 2000, age: 59, citizenship: 'CITIZEN', bands: EPF_BANDS });
    const over  = computeEpf({ wages: 2000, age: 60, citizenship: 'CITIZEN', bands: EPF_BANDS });
    expect(under.basis.ageBand).toBe('BELOW_60');
    expect(over.basis.ageBand).toBe('AGE_60_PLUS');
  });

  /**
   * The important one. A missing band must stop the run — a zero EPF line is an
   * invisible underpayment that KWSP will reconcile against the schedule later,
   * with the employer carrying the shortfall.
   */
  it('throws rather than computing zero when no band matches', () => {
    expect(() => computeEpf({ wages: 2000, age: 30, citizenship: 'FOREIGNER', bands: EPF_BANDS }))
      .toThrow(/No EPF band/);
  });

  it('rejects a band defining both amounts and rates', () => {
    const bad = [{ ...EPF_BANDS[0], employeeRate: 0.11, employerRate: 0.12 }];
    expect(() => computeEpf({ wages: 500, age: 30, citizenship: 'CITIZEN', bands: bad }))
      .toThrow(/both/);
  });

  it('rounds a percentage band up to the next ringgit, never down', () => {
    expect(toNextRinggit(100.01)).toBe(101);
    expect(toNextRinggit(100.5)).toBe(101);
    expect(toNextRinggit(100)).toBe(100);
  });
});

// ── SOCSO ────────────────────────────────────────────────────────────────────

const SOCSO_BANDS = [
  { wageFrom: 0, wageTo: null, category: 1, employeeAmount: 10, employerAmount: 35 },
  { wageFrom: 0, wageTo: null, category: 2, employeeAmount: 0,  employerAmount: 15 },
];

describe('SOCSO category is derived, never trusted from input', () => {
  it.each([
    [30, 'CITIZEN',   1],
    [59, 'PR',        1],
    [60, 'CITIZEN',   2],  // age boundary
    [30, 'FOREIGNER', 2],  // foreign workers are Category 2 at any age
  ])('age %i, %s -> category %i', (age, citizenship, expected) => {
    expect(categoryFor({ age, citizenship })).toBe(expected);
  });

  /**
   * Deducting an employee share from a Category 2 worker is an unlawful
   * deduction from wages, so the Act wins over the table even if the table is
   * seeded wrongly.
   */
  it('takes no employee share in Category 2, even if the band carries one', () => {
    const bands = [{ wageFrom: 0, wageTo: null, category: 2, employeeAmount: 99, employerAmount: 15 }];
    const r = computeSocso({ wages: 3000, age: 65, citizenship: 'CITIZEN', bands });
    expect(r.employee).toBe(0);
    expect(r.basis.employeeSuppressed).toBe(true);
  });

  it('names the scheme in the basis so a payslip stays explicable', () => {
    expect(computeSocso({ wages: 3000, age: 30, citizenship: 'CITIZEN', bands: SOCSO_BANDS })
      .basis.scheme).toBe('INJURY_AND_INVALIDITY');
    expect(computeSocso({ wages: 3000, age: 65, citizenship: 'CITIZEN', bands: SOCSO_BANDS })
      .basis.scheme).toBe('INJURY_ONLY');
  });
});

// ── EIS ──────────────────────────────────────────────────────────────────────

const EIS_BANDS = [{ wageFrom: 0, wageTo: null, employeeAmount: 5, employerAmount: 5 }];

describe('EIS distinguishes "excluded" from "no band"', () => {
  it('excludes age 60+ and foreign workers with a reason', () => {
    expect(exclusionReason({ age: 60, citizenship: 'CITIZEN' })).toBe('AGE_60_OR_ABOVE');
    expect(exclusionReason({ age: 30, citizenship: 'FOREIGNER' })).toBe('FOREIGN_WORKER');
    expect(exclusionReason({ age: 30, citizenship: 'CITIZEN' })).toBeNull();
  });

  it('returns zero WITHOUT consulting the bands when excluded', () => {
    const r = computeEis({ wages: 3000, age: 65, citizenship: 'CITIZEN', bands: [] });
    expect(r.employee).toBe(0);
    expect(r.excluded).toBe('AGE_60_OR_ABOVE');
  });

  /**
   * The distinction that matters: an in-scope employee with no band is a DATA
   * problem the operator must fix, and must not be silently zeroed like a
   * legitimately excluded one.
   */
  it('throws when in scope and no band matches', () => {
    expect(() => computeEis({ wages: 3000, age: 30, citizenship: 'CITIZEN', bands: [] }))
      .toThrow(/No EIS band/);
  });

  it('contributes normally when in scope', () => {
    expect(computeEis({ wages: 3000, age: 30, citizenship: 'CITIZEN', bands: EIS_BANDS }).employee).toBe(5);
  });
});

// ── PCB / MTD ────────────────────────────────────────────────────────────────

const PCB_BANDS = [
  { chargeableFrom: 0,     chargeableTo: 5000,  rate: 0,    cumulativeTax: 0,   category: 1 },
  { chargeableFrom: 5000,  chargeableTo: 20000, rate: 0.01, cumulativeTax: 0,   category: 1 },
  { chargeableFrom: 20000, chargeableTo: null,  rate: 0.03, cumulativeTax: 150, category: 1 },
];

const base = {
  monthlyRemuneration: 5000, monthlyEpf: 550,
  accumulatedRemuneration: 0, accumulatedEpf: 0,
  category: 1, totalReliefs: 9000, bands: PCB_BANDS,
};

describe('PCB uses the LHDN computerised method', () => {
  it('divides by (n + 1), not n — December must not divide by zero', () => {
    const dec = computePcb({ ...base, remainingMonths: 0 });
    expect(dec.basis.divisor).toBe(1);
    expect(Number.isFinite(dec.amount)).toBe(true);
  });

  /**
   * A December run carries eleven months of accumulated pay; the fixture has to
   * say so. Written first with `accumulatedRemuneration: 0` and a naive
   * "December deducts more than January" assertion, which failed — correctly.
   * With nothing accumulated, the projection for December is a single month's
   * pay, which is below the relief threshold, so the right answer is zero tax.
   * The engine was right and the test was wrong.
   */
  it('projects from accumulated pay, so a real December is not a fresh January', () => {
    const jan = computePcb({ ...base, remainingMonths: 11 });
    const dec = computePcb({
      ...base,
      remainingMonths: 0,
      accumulatedRemuneration: 5000 * 11,
      accumulatedEpf: 550 * 11,
    });
    expect(jan.basis.divisor).toBe(12);
    expect(dec.basis.divisor).toBe(1);
    // Both project a similar full-year income...
    expect(Math.abs(dec.basis.projectedChargeableIncome - jan.basis.projectedChargeableIncome))
      .toBeLessThan(1);
    // ...but December's whole remaining liability lands in one month.
    expect(dec.amount).toBeGreaterThan(jan.amount);
  });

  it('deducts nothing when projected income falls below the reliefs', () => {
    const r = computePcb({ ...base, remainingMonths: 0 });
    expect(r.basis.projectedChargeableIncome).toBe(0);
    expect(r.amount).toBe(0);
  });

  /**
   * MTD is not a refund mechanism. When zakat and MTD already paid exceed the
   * year's liability the formula goes negative, and LHDN floors it at zero —
   * returning the negative would credit the employee money never withheld.
   */
  it('floors at zero rather than refunding through payroll', () => {
    const r = computePcb({ ...base, remainingMonths: 6, zakatPaid: 999999 });
    expect(r.amount).toBe(0);
    expect(r.basis.flooredAtZero).toBe(true);
  });

  it('subtracts zakat and MTD already paid', () => {
    const without = computePcb({ ...base, remainingMonths: 6 });
    const with_   = computePcb({ ...base, remainingMonths: 6, zakatPaid: 100 });
    expect(with_.amount).toBeLessThan(without.amount);
  });

  it('rounds to 5 sen, as LHDN expresses MTD', () => {
    expect(roundTo5Sen(10.02)).toBe(10);
    expect(roundTo5Sen(10.03)).toBe(10.05);
  });

  it('rejects a malformed period rather than guessing', () => {
    expect(() => computePcb({ ...base, remainingMonths: -1 })).toThrow(/non-negative/);
  });

  it('throws when no band matches the projected income', () => {
    expect(() => computePcb({ ...base, remainingMonths: 6, category: 99 }))
      .toThrow(/No PCB band/);
  });

  it('records the projection in the basis so the figure stays auditable', () => {
    const r = computePcb({ ...base, remainingMonths: 11 });
    expect(r.basis.method).toBe('LHDN_COMPUTERISED');
    expect(r.basis).toHaveProperty('projectedChargeableIncome');
    expect(r.basis).toHaveProperty('bandFloor');
    expect(r.basis).toHaveProperty('cumulativeTax');
  });
});
