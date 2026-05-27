'use strict';
/**
 * Unit tests: Loans Engine (ESV-002)
 *
 * VA-01  validateAdvanceAmount — within 1× → valid
 * VA-02  validateAdvanceAmount — exceeds 1× → invalid
 * VA-03  validateAdvanceAmount — negative amount → invalid
 * VA-04  validateAdvanceAmount — zero salary → invalid
 *
 * VL-01  validateLoanTerms — sensible loan → valid
 * VL-02  validateLoanTerms — zero principal → invalid
 * VL-03  validateLoanTerms — tenure > 60 → invalid
 * VL-04  validateLoanTerms — interest > 10% → invalid
 * VL-05  validateLoanTerms — instalment > 30% salary → invalid (affordability)
 *
 * CI-01  computeMonthlyInstalment — zero-interest splits evenly
 * CI-02  computeMonthlyInstalment — with simple interest
 * CI-03  computeMonthlyInstalment — zero principal returns 0
 *
 * CR-01  computeTotalRepayable — 0% interest = principal
 * CR-02  computeTotalRepayable — adds simple interest correctly
 *
 * BS-01  buildRepaymentSchedule — generates correct number of rows
 * BS-02  buildRepaymentSchedule — last row absorbs rounding remainder
 * BS-03  buildRepaymentSchedule — empty loan returns []
 *
 * CO-01  computeOutstandingBalance — no payments → totalRepayable
 * CO-02  computeOutstandingBalance — partial payments deducted
 * CO-03  computeOutstandingBalance — WAIVED treated as deduction
 *
 * ES-01  computeEarlySettlement — returns outstanding as settlement
 * ES-02  computeEarlySettlement — fully repaid returns 0
 *
 * BD-01  buildLoanDashboard — counts by status
 * BD-02  buildLoanDashboard — sums totals
 * BD-03  buildLoanDashboard — empty list zeros
 *
 * AG-01  generateLoanAgreement — includes employeeName and amount
 *
 * NM-01  nextAdvanceNumber/nextLoanNumber — pad with 5 digits
 */

const {
  validateAdvanceAmount, validateLoanTerms,
  computeMonthlyInstalment, computeTotalRepayable,
  buildRepaymentSchedule, computeOutstandingBalance, computeEarlySettlement,
  buildLoanDashboard, generateLoanAgreement,
  nextAdvanceNumber, nextLoanNumber,
} = require('../src/engines/loans.engine');

// ── validateAdvanceAmount ────────────────────────────────────────────────────
test('VA-01 within 1× → valid', () => {
  expect(validateAdvanceAmount(3000, 5000).valid).toBe(true);
});
test('VA-02 exceeds 1× → invalid', () => {
  const r = validateAdvanceAmount(6000, 5000);
  expect(r.valid).toBe(false);
  expect(r.maxAllowed).toBe(5000);
});
test('VA-03 negative amount → invalid', () => {
  expect(validateAdvanceAmount(-100, 5000).valid).toBe(false);
});
test('VA-04 zero salary → invalid', () => {
  expect(validateAdvanceAmount(100, 0).valid).toBe(false);
});

// ── validateLoanTerms ────────────────────────────────────────────────────────
test('VL-01 sensible loan → valid', () => {
  const r = validateLoanTerms({ principal: 5000, interestRate: 5, tenureMonths: 12, monthlySalary: 5000 });
  expect(r.valid).toBe(true);
});
test('VL-02 zero principal → invalid', () => {
  expect(validateLoanTerms({ principal: 0, tenureMonths: 12, monthlySalary: 5000 }).valid).toBe(false);
});
test('VL-03 tenure > 60 → invalid', () => {
  expect(validateLoanTerms({ principal: 5000, tenureMonths: 72, monthlySalary: 5000 }).valid).toBe(false);
});
test('VL-04 interest > 10% → invalid', () => {
  expect(validateLoanTerms({ principal: 5000, interestRate: 15, tenureMonths: 12, monthlySalary: 5000 }).valid).toBe(false);
});
test('VL-05 instalment > 30% salary → invalid (affordability)', () => {
  // Principal 30k over 12 months at 0% = 2500/m vs salary 5000 → 50% → invalid
  const r = validateLoanTerms({ principal: 30000, tenureMonths: 12, monthlySalary: 5000 });
  expect(r.valid).toBe(false);
  expect(r.reasons.join(' ')).toMatch(/30%/);
});

// ── computeMonthlyInstalment ─────────────────────────────────────────────────
test('CI-01 zero-interest splits evenly', () => {
  expect(computeMonthlyInstalment(12000, 0, 12)).toBe(1000);
});
test('CI-02 with simple interest', () => {
  // 10000 × 6% × 1y = 600 interest; total 10600 / 12 = 883.33
  expect(computeMonthlyInstalment(10000, 6, 12)).toBe(883.33);
});
test('CI-03 zero principal returns 0', () => {
  expect(computeMonthlyInstalment(0, 5, 12)).toBe(0);
});

// ── computeTotalRepayable ────────────────────────────────────────────────────
test('CR-01 0% interest = principal', () => {
  expect(computeTotalRepayable(5000, 0, 12)).toBe(5000);
});
test('CR-02 adds simple interest correctly', () => {
  // 10000 × 6% × 2y = 1200; total 11200
  expect(computeTotalRepayable(10000, 6, 24)).toBe(11200);
});

// ── buildRepaymentSchedule ───────────────────────────────────────────────────
test('BS-01 generates correct number of rows', () => {
  const sched = buildRepaymentSchedule({ principal: 12000, interestRate: 0, tenureMonths: 12 }, '2026-06-01');
  expect(sched.length).toBe(12);
  expect(sched[0].scheduledAmount).toBe(1000);
});
test('BS-02 last row absorbs rounding remainder', () => {
  // 10000 / 3 = 3333.33; last row should pick up rounding
  const sched = buildRepaymentSchedule({ principal: 10000, interestRate: 0, tenureMonths: 3 }, '2026-06-01');
  const sum = sched.reduce((s, r) => s + r.scheduledAmount, 0);
  expect(Math.round(sum * 100) / 100).toBe(10000);
  expect(sched[sched.length - 1].isLast).toBe(true);
});
test('BS-03 empty loan returns []', () => {
  expect(buildRepaymentSchedule({ principal: 0, tenureMonths: 0 }, new Date())).toEqual([]);
});

// ── computeOutstandingBalance ────────────────────────────────────────────────
test('CO-01 no payments → totalRepayable', () => {
  expect(computeOutstandingBalance({ totalRepayable: 12000 }, [])).toBe(12000);
});
test('CO-02 partial payments deducted', () => {
  const out = computeOutstandingBalance({ totalRepayable: 12000 }, [
    { status: 'PAID', paidAmount: 1000 },
    { status: 'PAID', paidAmount: 1000 },
  ]);
  expect(out).toBe(10000);
});
test('CO-03 WAIVED treated as deduction', () => {
  const out = computeOutstandingBalance({ totalRepayable: 12000 }, [
    { status: 'PAID',   paidAmount: 1000 },
    { status: 'WAIVED', scheduledAmount: 1000 },
  ]);
  expect(out).toBe(10000);
});

// ── computeEarlySettlement ───────────────────────────────────────────────────
test('ES-01 returns outstanding as settlement', () => {
  const r = computeEarlySettlement({ totalRepayable: 12000 }, [{ status: 'PAID', paidAmount: 4000 }]);
  expect(r.outstanding).toBe(8000);
  expect(r.settlementAmount).toBe(8000);
});
test('ES-02 fully repaid returns 0', () => {
  const r = computeEarlySettlement({ totalRepayable: 12000 }, [{ status: 'PAID', paidAmount: 12000 }]);
  expect(r.outstanding).toBe(0);
});

// ── buildLoanDashboard ───────────────────────────────────────────────────────
test('BD-01 counts by status', () => {
  const r = buildLoanDashboard([
    { status: 'ACTIVE',  principal: 5000, outstandingBalance: 4000, totalRepaid: 1000 },
    { status: 'SETTLED', principal: 3000, outstandingBalance: 0,    totalRepaid: 3000 },
    { status: 'PENDING', principal: 2000, outstandingBalance: 2000, totalRepaid: 0 },
  ]);
  expect(r.activeCount).toBe(1);
  expect(r.settledCount).toBe(1);
  expect(r.pendingCount).toBe(1);
});
test('BD-02 sums totals', () => {
  const r = buildLoanDashboard([
    { status: 'ACTIVE', principal: 5000, outstandingBalance: 4000, totalRepaid: 1000 },
    { status: 'ACTIVE', principal: 3000, outstandingBalance: 2000, totalRepaid: 1000 },
  ]);
  expect(r.totalPrincipal).toBe(8000);
  expect(r.totalOutstanding).toBe(6000);
  expect(r.totalRepaid).toBe(2000);
});
test('BD-03 empty list zeros', () => {
  expect(buildLoanDashboard([]).total).toBe(0);
});

// ── generateLoanAgreement ────────────────────────────────────────────────────
test('AG-01 includes employeeName and amount', () => {
  const html = generateLoanAgreement({
    loanNumber: 'LN-2026-00001', employeeName: 'Alice Tan',
    principal: 10000, interestRate: 5, tenureMonths: 12,
    monthlyInstalment: 883.33, totalRepayable: 10600,
    startDate: '2026-07-01', expectedEndDate: '2027-06-01',
  });
  expect(html).toContain('Alice Tan');
  expect(html).toContain('LN-2026-00001');
  expect(html).toContain('10,000');
});

// ── number generators ────────────────────────────────────────────────────────
test('NM-01 pads with 5 digits', () => {
  expect(nextAdvanceNumber(0, 2026)).toBe('ADV-2026-00001');
  expect(nextLoanNumber(42, 2026)).toBe('LN-2026-00043');
});
