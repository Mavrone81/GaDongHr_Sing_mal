'use strict';
/**
 * Unit tests: Staff Movement Engine (ESV-001)
 *
 * VT-01  validateTransfer — no-op rejected
 * VT-02  validateTransfer — DEPARTMENT_TRANSFER requires dept change
 * VT-03  validateTransfer — ROLE_CHANGE requires designation change
 * VT-04  validateTransfer — INTER_COMPANY requires company change
 * VT-05  validateTransfer — valid REPORTING_CHANGE → valid with changedFields
 * VT-06  validateTransfer — invalid type → rejected
 *
 * CS-01  computeSalaryDelta — increase
 * CS-02  computeSalaryDelta — decrease
 * CS-03  computeSalaryDelta — zero from-salary handled
 * CS-04  computeSalaryDelta — no change
 *
 * IE-01  isEffectiveToday — past date → true
 * IE-02  isEffectiveToday — today → true
 * IE-03  isEffectiveToday — future date → false
 * IE-04  isEffectiveToday — null → false
 *
 * BS-01  buildMovementSummary — counts by status
 * BS-02  buildMovementSummary — effectiveToday count
 * BS-03  buildMovementSummary — upcoming30d
 * BS-04  buildMovementSummary — empty list zeros
 *
 * SL-01  suggestLetterText — includes employeeName + effective date
 * SL-02  suggestLetterText — empty movement returns empty
 *
 * RA-01  requiresAdditionalApproval — inter-company → required
 * RA-02  requiresAdditionalApproval — > 30% salary jump → required
 * RA-03  requiresAdditionalApproval — salary decrease → required
 * RA-04  requiresAdditionalApproval — small increase → not required
 *
 * NM-01  nextMovementNumber — pads with 5 digits
 */

const {
  MOVEMENT_TYPES, validateTransfer, computeSalaryDelta, isEffectiveToday,
  buildMovementSummary, suggestLetterText, requiresAdditionalApproval, nextMovementNumber,
} = require('../src/engines/staff-movement.engine');

// ── validateTransfer ─────────────────────────────────────────────────────────
test('VT-01 no-op rejected', () => {
  const r = validateTransfer(
    { department: 'Eng', designation: 'Engineer' },
    { department: 'Eng', designation: 'Engineer' },
    'DEPARTMENT_TRANSFER'
  );
  expect(r.valid).toBe(false);
  expect(r.reasons.join(' ')).toMatch(/no-op/i);
});

test('VT-02 DEPARTMENT_TRANSFER requires dept change', () => {
  const r = validateTransfer(
    { department: 'Eng', designation: 'Engineer' },
    { department: 'Eng', designation: 'Senior Engineer' },
    'DEPARTMENT_TRANSFER'
  );
  expect(r.valid).toBe(false);
  expect(r.reasons.join(' ')).toMatch(/department to change/);
});

test('VT-03 ROLE_CHANGE requires designation change', () => {
  const r = validateTransfer(
    { department: 'Eng', designation: 'Engineer' },
    { department: 'Sales', designation: 'Engineer' },
    'ROLE_CHANGE'
  );
  expect(r.valid).toBe(false);
});

test('VT-04 INTER_COMPANY requires company change', () => {
  const r = validateTransfer(
    { department: 'Eng', company: 'Co A' },
    { department: 'Eng2', company: 'Co A' },
    'INTER_COMPANY_TRANSFER'
  );
  expect(r.valid).toBe(false);
});

test('VT-05 valid REPORTING_CHANGE → valid with changedFields', () => {
  const r = validateTransfer(
    { department: 'Eng', reportingManagerId: 'm1' },
    { department: 'Eng', reportingManagerId: 'm2' },
    'REPORTING_CHANGE'
  );
  expect(r.valid).toBe(true);
  expect(r.changedFields).toContain('reportingManagerId');
});

test('VT-06 invalid type → rejected', () => {
  const r = validateTransfer({ department: 'A' }, { department: 'B' }, 'BOGUS');
  expect(r.valid).toBe(false);
});

// ── computeSalaryDelta ───────────────────────────────────────────────────────
test('CS-01 increase', () => {
  const r = computeSalaryDelta(5000, 6000);
  expect(r.deltaAmount).toBe(1000);
  expect(r.deltaPct).toBe(20);
  expect(r.direction).toBe('INCREASE');
});

test('CS-02 decrease', () => {
  const r = computeSalaryDelta(5000, 4500);
  expect(r.direction).toBe('DECREASE');
  expect(r.deltaAmount).toBe(-500);
});

test('CS-03 zero from-salary handled', () => {
  const r = computeSalaryDelta(0, 5000);
  expect(r.deltaPct).toBe(100);
});

test('CS-04 no change', () => {
  const r = computeSalaryDelta(5000, 5000);
  expect(r.direction).toBe('NONE');
  expect(r.deltaAmount).toBe(0);
});

// ── isEffectiveToday ─────────────────────────────────────────────────────────
test('IE-01 past date → true', () => {
  expect(isEffectiveToday(new Date(Date.now() - 86_400_000))).toBe(true);
});

test('IE-02 today → true', () => {
  expect(isEffectiveToday(new Date())).toBe(true);
});

test('IE-03 future date → false', () => {
  expect(isEffectiveToday(new Date(Date.now() + 7 * 86_400_000))).toBe(false);
});

test('IE-04 null → false', () => {
  expect(isEffectiveToday(null)).toBe(false);
});

// ── buildMovementSummary ─────────────────────────────────────────────────────
test('BS-01 counts by status', () => {
  const r = buildMovementSummary([
    { status: 'PENDING',  type: 'ROLE_CHANGE',         effectiveDate: new Date() },
    { status: 'APPROVED', type: 'DEPARTMENT_TRANSFER', effectiveDate: new Date() },
    { status: 'APPLIED',  type: 'PROMOTION',           effectiveDate: new Date() },
  ]);
  expect(r.total).toBe(3);
  expect(r.pending).toBe(1);
  expect(r.approved).toBe(1);
  expect(r.applied).toBe(1);
});

test('BS-02 effectiveToday count', () => {
  const r = buildMovementSummary([
    { status: 'APPROVED', type: 'ROLE_CHANGE', effectiveDate: new Date(Date.now() - 86_400_000) },
    { status: 'APPROVED', type: 'ROLE_CHANGE', effectiveDate: new Date(Date.now() + 7 * 86_400_000) },
  ]);
  expect(r.effectiveToday).toBe(1);
});

test('BS-03 upcoming30d', () => {
  const r = buildMovementSummary([
    { status: 'APPROVED', type: 'ROLE_CHANGE', effectiveDate: new Date(Date.now() + 10 * 86_400_000) },
    { status: 'APPROVED', type: 'ROLE_CHANGE', effectiveDate: new Date(Date.now() + 60 * 86_400_000) },
  ]);
  expect(r.upcoming30d).toBe(1);
});

test('BS-04 empty list zeros', () => {
  const r = buildMovementSummary([]);
  expect(r.total).toBe(0);
});

// ── suggestLetterText ────────────────────────────────────────────────────────
test('SL-01 includes employeeName + effective date', () => {
  const html = suggestLetterText({
    employeeName: 'Alice Tan', type: 'DEPARTMENT_TRANSFER',
    fromDepartment: 'Eng', toDepartment: 'Product',
    fromDesignation: 'Engineer', toDesignation: 'Engineer',
    effectiveDate: '2026-07-01', reason: 'Better skill fit',
  });
  expect(html).toContain('Alice Tan');
  expect(html).toContain('1 July 2026');
  expect(html).toContain('Eng');
  expect(html).toContain('Product');
});

test('SL-02 empty movement returns empty', () => {
  expect(suggestLetterText(null)).toBe('');
});

// ── requiresAdditionalApproval ───────────────────────────────────────────────
test('RA-01 inter-company → required', () => {
  expect(requiresAdditionalApproval({ type: 'INTER_COMPANY_TRANSFER' }).required).toBe(true);
});

test('RA-02 > 30% salary jump → required', () => {
  const r = requiresAdditionalApproval({
    type: 'PROMOTION', hasSalaryRevision: true, fromSalary: 5000, toSalary: 7000,
  });
  expect(r.required).toBe(true);
});

test('RA-03 salary decrease → required', () => {
  const r = requiresAdditionalApproval({
    type: 'ROLE_CHANGE', hasSalaryRevision: true, fromSalary: 5000, toSalary: 4500,
  });
  expect(r.required).toBe(true);
});

test('RA-04 small increase → not required', () => {
  const r = requiresAdditionalApproval({
    type: 'PROMOTION', hasSalaryRevision: true, fromSalary: 5000, toSalary: 5500,
  });
  expect(r.required).toBe(false);
});

// ── nextMovementNumber ───────────────────────────────────────────────────────
test('NM-01 pads with 5 digits', () => {
  expect(nextMovementNumber(0, 2026)).toBe('MOV-2026-00001');
  expect(nextMovementNumber(42, 2026)).toBe('MOV-2026-00043');
});
