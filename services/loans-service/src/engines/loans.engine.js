'use strict';
/**
 * Loans Engine — pure functions, no Prisma/IO.
 *
 * Domain rules:
 *  • Salary advance cap: 1× monthly salary (Singapore SME convention).
 *  • Staff loans: principal + interest amortised over tenure, deducted monthly via payroll.
 *  • Interest model: simple interest by default (interestRate = annual %).
 *      totalInterest = principal × (rate/100) × (tenureMonths/12)
 *      monthlyInstalment = (principal + totalInterest) / tenureMonths
 *    To switch to flat or reducing-balance, adapt computeMonthlyInstalment.
 *  • Outstanding balance = totalRepayable − sum(PAID/WAIVED amounts).
 *  • Early settlement: outstanding balance as-of today minus any prepayment discount (currently 0%).
 */

const ADVANCE_STATUSES   = ['PENDING','APPROVED','REJECTED','CANCELLED','DEDUCTED'];
const LOAN_STATUSES      = ['PENDING','APPROVED','REJECTED','CANCELLED','ACTIVE','SETTLED','WRITTEN_OFF'];
const REPAYMENT_STATUSES = ['PENDING','PAID','OVERDUE','WAIVED'];

const MAX_ADVANCE_MULTIPLIER = 1.0;     // 1× monthly salary
const MAX_LOAN_TENURE_MONTHS = 60;      // 5-year max
const MAX_INTEREST_RATE      = 10;      // 10% annual cap (SG SME convention)

/**
 * validateAdvanceAmount — checks if amount is within policy.
 *
 * @param {Number} amount
 * @param {Number} monthlySalary
 * @returns {{valid: boolean, reason: string|null, maxAllowed: Number}}
 */
function validateAdvanceAmount(amount, monthlySalary) {
  const a = Number(amount || 0);
  const sal = Number(monthlySalary || 0);
  const maxAllowed = round2(sal * MAX_ADVANCE_MULTIPLIER);
  if (!a || a <= 0) return { valid: false, reason: 'Amount must be positive', maxAllowed };
  if (sal <= 0)     return { valid: false, reason: 'Cannot determine monthly salary', maxAllowed };
  if (a > maxAllowed) {
    return { valid: false, reason: `Amount exceeds 1× monthly salary (max SGD ${maxAllowed})`, maxAllowed };
  }
  return { valid: true, reason: null, maxAllowed };
}

/**
 * validateLoanTerms — sanity-check loan inputs at request time.
 *
 * @param {Object} loan — { principal, interestRate, tenureMonths, monthlySalary }
 * @returns {{valid: boolean, reasons: string[]}}
 */
function validateLoanTerms(loan) {
  const reasons = [];
  const principal = Number(loan?.principal || 0);
  const rate      = Number(loan?.interestRate || 0);
  const tenure    = Number(loan?.tenureMonths || 0);
  const sal       = Number(loan?.monthlySalary || 0);

  if (principal <= 0)                       reasons.push('principal must be positive');
  if (tenure   <= 0)                        reasons.push('tenureMonths must be positive');
  if (tenure   > MAX_LOAN_TENURE_MONTHS)    reasons.push(`tenureMonths exceeds cap of ${MAX_LOAN_TENURE_MONTHS}`);
  if (rate     < 0)                         reasons.push('interestRate cannot be negative');
  if (rate     > MAX_INTEREST_RATE)         reasons.push(`interestRate exceeds cap of ${MAX_INTEREST_RATE}%`);

  // Affordability check: monthly instalment <= 30% of monthly salary (basic guard)
  if (principal > 0 && tenure > 0 && sal > 0) {
    const inst = computeMonthlyInstalment(principal, rate, tenure);
    if (inst > sal * 0.3) {
      reasons.push(`Monthly instalment SGD ${inst} exceeds 30% of monthly salary`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}

/**
 * computeMonthlyInstalment — simple-interest amortisation.
 *
 * @param {Number} principal
 * @param {Number} annualInterestPct
 * @param {Number} tenureMonths
 * @returns {Number} rounded to 2 dp
 */
function computeMonthlyInstalment(principal, annualInterestPct, tenureMonths) {
  const p = Number(principal || 0);
  const r = Number(annualInterestPct || 0);
  const n = Number(tenureMonths || 0);
  if (p <= 0 || n <= 0) return 0;
  const totalInterest = p * (r / 100) * (n / 12);
  return round2((p + totalInterest) / n);
}

/**
 * computeTotalRepayable — principal + total interest over tenure.
 */
function computeTotalRepayable(principal, annualInterestPct, tenureMonths) {
  const p = Number(principal || 0);
  const r = Number(annualInterestPct || 0);
  const n = Number(tenureMonths || 0);
  if (p <= 0 || n <= 0) return 0;
  return round2(p + p * (r / 100) * (n / 12));
}

/**
 * buildRepaymentSchedule — generates the per-month schedule given a start date.
 *
 * @param {Object} loan — { principal, interestRate, tenureMonths }
 * @param {Date|string} startDate — first deduction month start (uses 1st of next month if mid-month)
 * @returns {Array<{paymentNumber:number, scheduledDate:Date, scheduledAmount:number, isLast:boolean}>}
 */
function buildRepaymentSchedule(loan, startDate) {
  const principal = Number(loan?.principal || 0);
  const rate      = Number(loan?.interestRate || 0);
  const tenure    = Number(loan?.tenureMonths || 0);
  if (principal <= 0 || tenure <= 0) return [];

  const monthly = computeMonthlyInstalment(principal, rate, tenure);
  const total   = computeTotalRepayable(principal, rate, tenure);

  const schedule = [];
  const start    = new Date(startDate || new Date());
  // Normalise to first of month
  const firstMonth = new Date(start.getFullYear(), start.getMonth(), 1);

  let runningTotal = 0;
  for (let i = 1; i <= tenure; i++) {
    const d = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + (i - 1), 1);
    const isLast = i === tenure;
    // Last instalment handles rounding remainder
    const amt = isLast ? round2(total - runningTotal) : monthly;
    runningTotal = round2(runningTotal + amt);
    schedule.push({
      paymentNumber: i,
      scheduledDate: d,
      scheduledAmount: amt,
      isLast,
    });
  }
  return schedule;
}

/**
 * computeOutstandingBalance — totalRepayable − sum(PAID/WAIVED amounts).
 *
 * @param {Object} loan      — { totalRepayable }
 * @param {Array}  repayments — list of LoanRepayment { status, paidAmount, scheduledAmount }
 * @returns {Number}
 */
function computeOutstandingBalance(loan, repayments) {
  const total = Number(loan?.totalRepayable || 0);
  const list = Array.isArray(repayments) ? repayments : [];
  const paid = list.reduce((sum, r) => {
    if (r.status === 'PAID')   return sum + Number(r.paidAmount || r.scheduledAmount || 0);
    if (r.status === 'WAIVED') return sum + Number(r.scheduledAmount || 0);
    return sum;
  }, 0);
  return round2(Math.max(0, total - paid));
}

/**
 * computeEarlySettlement — quote payoff figure today.
 *
 * @param {Object} loan        — { totalRepayable }
 * @param {Array}  repayments
 * @returns {{outstanding: Number, settlementAmount: Number, discount: Number}}
 *
 * For now no discount on early settlement.
 */
function computeEarlySettlement(loan, repayments) {
  const outstanding = computeOutstandingBalance(loan, repayments);
  const discount = 0;
  return {
    outstanding,
    settlementAmount: round2(outstanding - discount),
    discount,
  };
}

/**
 * classifyRepaymentUrgency — for dashboards.
 *
 * @param {Object} repayment — { scheduledDate, status }
 * @param {Date}   now
 * @returns {'OVERDUE'|'DUE_THIS_MONTH'|'UPCOMING'|'COMPLETED'}
 */
function classifyRepaymentUrgency(repayment, now = new Date()) {
  if (!repayment || ['PAID','WAIVED'].includes(repayment.status)) return 'COMPLETED';
  const sched = new Date(repayment.scheduledDate);
  const today = new Date(now);
  if (sched < new Date(today.getFullYear(), today.getMonth(), 1)) return 'OVERDUE';
  if (sched.getFullYear() === today.getFullYear() && sched.getMonth() === today.getMonth()) return 'DUE_THIS_MONTH';
  return 'UPCOMING';
}

/**
 * buildLoanDashboard — aggregate stats for HR/Finance.
 *
 * @param {Array} loans — list of StaffLoan
 * @returns {Object}
 */
function buildLoanDashboard(loans) {
  const list = Array.isArray(loans) ? loans : [];
  const summary = {
    total: list.length,
    byStatus: {},
    totalPrincipal: 0,
    totalOutstanding: 0,
    totalRepaid: 0,
    activeCount: 0,
    settledCount: 0,
    pendingCount: 0,
  };
  for (const l of list) {
    summary.byStatus[l.status] = (summary.byStatus[l.status] || 0) + 1;
    summary.totalPrincipal   += Number(l.principal || 0);
    summary.totalOutstanding += Number(l.outstandingBalance || 0);
    summary.totalRepaid      += Number(l.totalRepaid || 0);
    if (l.status === 'ACTIVE')  summary.activeCount  += 1;
    if (l.status === 'SETTLED') summary.settledCount += 1;
    if (l.status === 'PENDING') summary.pendingCount += 1;
  }
  summary.totalPrincipal   = round2(summary.totalPrincipal);
  summary.totalOutstanding = round2(summary.totalOutstanding);
  summary.totalRepaid      = round2(summary.totalRepaid);
  return summary;
}

/**
 * generateLoanAgreement — HTML template for loan agreement.
 *
 * @param {Object} loan
 * @returns {String} HTML
 */
/**
 * HTML-escape so user-controlled strings (employeeName, loanNumber, reason) can be
 * safely interpolated into the generated HTML, which is later rendered to FINANCE/HR
 * users via dangerouslySetInnerHTML on the loan-detail page. Without this any
 * employee submitting a loan with an XSS payload in their name/reason would execute
 * code in the approver's session.
 */
function escapeHtml(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateLoanAgreement(loan) {
  if (!loan) return '';
  const today    = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' });
  const startStr = loan.startDate       ? new Date(loan.startDate      ).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }) : '(to be set)';
  const endStr   = loan.expectedEndDate ? new Date(loan.expectedEndDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }) : '(to be computed)';
  const employeeName = escapeHtml(loan.employeeName || '—');
  const loanNumber   = escapeHtml(loan.loanNumber   || '—');
  return `
<div class="loan-agreement">
  <h2>Staff Loan Agreement</h2>
  <p>Date: <strong>${today}</strong></p>
  <p>Loan Reference: <strong>${loanNumber}</strong></p>
  <p>This agreement is made between the Company and <strong>${employeeName}</strong> (the Borrower) under the following terms:</p>
  <table style="width:100%; border-collapse:collapse; margin:1rem 0;">
    <tr><td style="padding:6px 10px;"><strong>Principal Amount</strong></td><td style="padding:6px 10px;">SGD ${Number(loan.principal || 0).toLocaleString()}</td></tr>
    <tr><td style="padding:6px 10px;"><strong>Interest Rate</strong></td><td style="padding:6px 10px;">${Number(loan.interestRate || 0)}% per annum (simple interest)</td></tr>
    <tr><td style="padding:6px 10px;"><strong>Tenure</strong></td><td style="padding:6px 10px;">${loan.tenureMonths || 0} months</td></tr>
    <tr><td style="padding:6px 10px;"><strong>Monthly Instalment</strong></td><td style="padding:6px 10px;">SGD ${Number(loan.monthlyInstalment || 0).toLocaleString()}</td></tr>
    <tr><td style="padding:6px 10px;"><strong>Total Repayable</strong></td><td style="padding:6px 10px;">SGD ${Number(loan.totalRepayable || 0).toLocaleString()}</td></tr>
    <tr><td style="padding:6px 10px;"><strong>First Deduction</strong></td><td style="padding:6px 10px;">${startStr}</td></tr>
    <tr><td style="padding:6px 10px;"><strong>Final Deduction</strong></td><td style="padding:6px 10px;">${endStr}</td></tr>
  </table>
  <p>Repayments will be deducted monthly from the Borrower's payroll. Upon resignation or termination, any outstanding balance becomes immediately payable from the Borrower's final settlement.</p>
  <p>Early settlement is permitted at any time without penalty.</p>
  <p>By signing below, the Borrower agrees to the above terms.</p>
  <p style="margin-top:2rem;">__________________________<br>Signature of Borrower (${employeeName})</p>
</div>`.trim();
}

/**
 * nextAdvanceNumber / nextLoanNumber — ADV-YYYY-NNNNN / LN-YYYY-NNNNN
 */
function nextAdvanceNumber(count, year) {
  const y = year || new Date().getFullYear();
  return `ADV-${y}-${String((count || 0) + 1).padStart(5, '0')}`;
}
function nextLoanNumber(count, year) {
  const y = year || new Date().getFullYear();
  return `LN-${y}-${String((count || 0) + 1).padStart(5, '0')}`;
}

function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

module.exports = {
  ADVANCE_STATUSES,
  LOAN_STATUSES,
  REPAYMENT_STATUSES,
  MAX_ADVANCE_MULTIPLIER,
  MAX_LOAN_TENURE_MONTHS,
  MAX_INTEREST_RATE,
  escapeHtml,
  validateAdvanceAmount,
  validateLoanTerms,
  computeMonthlyInstalment,
  computeTotalRepayable,
  buildRepaymentSchedule,
  computeOutstandingBalance,
  computeEarlySettlement,
  classifyRepaymentUrgency,
  buildLoanDashboard,
  generateLoanAgreement,
  nextAdvanceNumber,
  nextLoanNumber,
};
