'use strict';
/**
 * Security regression test for C-14:
 *   generateLoanAgreement HTML-escapes employeeName / loanNumber / reason
 *   before interpolation. The generated HTML is later rendered via
 *   dangerouslySetInnerHTML on the loan-detail page in the FINANCE_ADMIN /
 *   HR session, so any unescaped XSS payload would be a privilege-escalation
 *   path from an employee filing a loan with a hostile name.
 */
const { generateLoanAgreement, escapeHtml } = require('../src/engines/loans.engine');

describe('C-14 escapeHtml', () => {
  test('escapes the five HTML metacharacters', () => {
    expect(escapeHtml('<b>"&\'')).toBe('&lt;b&gt;&quot;&amp;&#39;');
  });
  test('handles null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('C-14 generateLoanAgreement', () => {
  const baseLoan = {
    loanNumber: 'LN-2026-00001',
    employeeName: 'Alice',
    principal: 10000, interestRate: 0, tenureMonths: 12,
    monthlyInstalment: 833.33, totalRepayable: 10000,
    startDate: '2026-06-01', expectedEndDate: '2027-05-01',
  };

  test('escapes XSS payload in employeeName', () => {
    const out = generateLoanAgreement({ ...baseLoan, employeeName: '<script>fetch("//atk")</script>' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  test('escapes XSS in loanNumber', () => {
    const out = generateLoanAgreement({ ...baseLoan, loanNumber: 'LN<img src=x onerror=1>' });
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });

  test('does NOT escape the static template HTML (table/h2/etc remain)', () => {
    const out = generateLoanAgreement(baseLoan);
    expect(out).toContain('<h2>Staff Loan Agreement</h2>');
    expect(out).toContain('<table');
  });

  test('null/undefined loan returns empty string', () => {
    expect(generateLoanAgreement(null)).toBe('');
    expect(generateLoanAgreement(undefined)).toBe('');
  });

  test('uses the static template for fields that are not interpolated from user input', () => {
    const out = generateLoanAgreement(baseLoan);
    expect(out).toContain('SGD 10,000');                  // principal still rendered as-is
    expect(out).toContain('12 months');                   // tenureMonths
  });
});
