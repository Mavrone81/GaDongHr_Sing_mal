'use strict';
/**
 * Security regression for loans-service H-tier fixes.
 *   H-16 maker-checker on /loans/advances/:id/approve and /loans/staff-loans/:id/approve.
 *   H-21 reference numbers are produced by a DB SEQUENCE, not prisma.count().
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');

describe('H-16 maker-checker on loan/advance approval', () => {
  test('advance approve rejects when approver employeeId equals advance.employeeId', () => {
    const idx = src.indexOf("/loans/advances/:id/approve'");
    const slice = src.slice(idx, idx + 2000);
    expect(slice).toMatch(/Approver may not approve their own advance/);
  });
  test('loan approve rejects when approver employeeId equals loan.employeeId', () => {
    const idx = src.indexOf("/loans/staff-loans/:id/approve'");
    const slice = src.slice(idx, idx + 2000);
    expect(slice).toMatch(/Approver may not approve their own loan/);
  });
});

describe('H-21 reference numbers use DB SEQUENCE', () => {
  test('ensureRefSequences creates loans_adv_seq and loans_loan_seq', () => {
    expect(src).toMatch(/CREATE SEQUENCE IF NOT EXISTS loans_adv_seq/);
    expect(src).toMatch(/CREATE SEQUENCE IF NOT EXISTS loans_loan_seq/);
  });
  test('generateAdvanceNumber uses nextval not prisma.count', () => {
    const idx = src.indexOf('async function generateAdvanceNumber');
    const slice = src.slice(idx, idx + 500);
    expect(slice).toMatch(/nextval\('loans_adv_seq'\)/);
    expect(slice).not.toMatch(/prisma\.salaryAdvance\.count/);
  });
  test('generateLoanNumber uses nextval not prisma.count', () => {
    const idx = src.indexOf('async function generateLoanNumber');
    const slice = src.slice(idx, idx + 500);
    expect(slice).toMatch(/nextval\('loans_loan_seq'\)/);
    expect(slice).not.toMatch(/prisma\.staffLoan\.count/);
  });
});
