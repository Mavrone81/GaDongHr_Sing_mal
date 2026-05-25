'use strict';

const {
  DAILY_CAPS,
  computeClaimableAmount,
  computeNsMakeupAmount,
  computeCpfOnGovtPaid,
  buildClaimRecord,
  groupLeavesByEmployeeAndType,
  isValidTransition,
  round2,
} = require('../src/engines/govt-leave-claims.engine');

// ── DAILY_CAPS constants ───────────────────────────────────────────────────────
describe('DAILY_CAPS', () => {
  test('ML cap is SGD 500/day (10,000 / 4-week / 5-day)', () => {
    expect(DAILY_CAPS.ML).toBe(500);
  });
  test('PL cap is SGD 500/day (2,500/week / 5-day)', () => {
    expect(DAILY_CAPS.PL).toBe(500);
  });
  test('CCL cap is SGD 100/day (500/week / 5-day)', () => {
    expect(DAILY_CAPS.CCL).toBe(100);
  });
  test('SPL cap is SGD 500/day (2,500/week / 5-day)', () => {
    expect(DAILY_CAPS.SPL).toBe(500);
  });
  test('NSL has no cap entry', () => {
    expect(DAILY_CAPS.NSL).toBeUndefined();
  });
});

// ── computeClaimableAmount ─────────────────────────────────────────────────────
describe('computeClaimableAmount', () => {
  test('ML: daily rate below cap → full amount', () => {
    // dailyRate 300 < cap 500, 3 days → 300 × 3 = 900
    expect(computeClaimableAmount('ML', 3, 300)).toBe(900);
  });
  test('ML: daily rate above cap → capped at 500/day', () => {
    // dailyRate 600 > cap 500, 3 days → 500 × 3 = 1500
    expect(computeClaimableAmount('ML', 3, 600)).toBe(1500);
  });
  test('CCL: daily rate 150 > cap 100 → capped at 100/day × 3', () => {
    expect(computeClaimableAmount('CCL', 3, 150)).toBe(300);
  });
  test('PL: daily rate exactly at cap → no change', () => {
    expect(computeClaimableAmount('PL', 2, 500)).toBe(1000);
  });
  test('SPL: daily rate 400 below cap → full amount', () => {
    expect(computeClaimableAmount('SPL', 5, 400)).toBe(2000);
  });
  test('rounds to 2 decimal places', () => {
    expect(computeClaimableAmount('ML', 3, 333.333)).toBe(1000); // capped at 500 × 3
  });
  test('unknown type (no cap): returns full dailyRate × days', () => {
    expect(computeClaimableAmount('UNKNOWN', 2, 400)).toBe(800);
  });
});

// ── computeNsMakeupAmount ─────────────────────────────────────────────────────
describe('computeNsMakeupAmount', () => {
  test('makeup = (civilianRate - nsAllowance) × days', () => {
    // civilian 350/day, NS allowance 120/day, 5 days → (350-120) × 5 = 1150
    expect(computeNsMakeupAmount(5, 350, 120)).toBe(1150);
  });
  test('no NS allowance provided → defaults to 0, claims full civilian rate', () => {
    expect(computeNsMakeupAmount(3, 300)).toBe(900);
  });
  test('NS allowance exceeds civilian rate → clamped to 0', () => {
    expect(computeNsMakeupAmount(2, 100, 200)).toBe(0);
  });
  test('rounds to 2 decimal places', () => {
    // (350.555 - 120.333) × 2 = 460.444 → 460.44
    expect(computeNsMakeupAmount(2, 350.555, 120.333)).toBe(460.44);
  });
});

// ── computeCpfOnGovtPaid ──────────────────────────────────────────────────────
describe('computeCpfOnGovtPaid', () => {
  test('17% employer rate on 1000 = 170', () => {
    expect(computeCpfOnGovtPaid(1000, 0.17)).toBe(170);
  });
  test('zero rate → 0', () => {
    expect(computeCpfOnGovtPaid(1000, 0)).toBe(0);
  });
  test('null/undefined rate → 0', () => {
    expect(computeCpfOnGovtPaid(1000, null)).toBe(0);
    expect(computeCpfOnGovtPaid(1000, undefined)).toBe(0);
  });
  test('rounds to 2 decimal places', () => {
    // 1234.56 × 0.17 = 209.8752 → 209.88
    expect(computeCpfOnGovtPaid(1234.56, 0.17)).toBe(209.88);
  });
});

// ── buildClaimRecord ─────────────────────────────────────────────────────────
describe('buildClaimRecord', () => {
  const base = { employeeId: 'E001', period: '2026-05', leaveDays: 3, dailyRate: 300, employerCpfRate: 0.17 };

  test('ML claim: claimable = dailyRate × days (below cap), nsMakeupAmount null', () => {
    const r = buildClaimRecord({ ...base, leaveTypeCode: 'ML', leaveTypeName: 'Maternity Leave' });
    expect(r.claimableAmount).toBe(900);    // 300 × 3
    expect(r.nsMakeupAmount).toBeNull();
    expect(r.nsAllowancePerDay).toBeNull();
  });

  test('NSL claim: claimableAmount = nsMakeupAmount, nsAllowancePerDay stored', () => {
    const r = buildClaimRecord({ ...base, leaveTypeCode: 'NSL', leaveTypeName: 'NS Leave', nsAllowancePerDay: 100 });
    expect(r.nsMakeupAmount).toBe(600);       // (300-100) × 3
    expect(r.claimableAmount).toBe(600);      // same as makeup
    expect(r.nsAllowancePerDay).toBe(100);
  });

  test('CPF on govt-paid computed from claimableAmount × cpfRate', () => {
    const r = buildClaimRecord({ ...base, leaveTypeCode: 'ML', leaveTypeName: 'Maternity Leave' });
    expect(r.cpfOnGovtPaid).toBe(153);        // 900 × 0.17
  });

  test('cpfOnGovtPaid is null when cpfRate is 0', () => {
    const r = buildClaimRecord({ ...base, leaveTypeCode: 'ML', leaveTypeName: 'Maternity Leave', employerCpfRate: 0 });
    expect(r.cpfOnGovtPaid).toBeNull();
  });
});

// ── groupLeavesByEmployeeAndType ──────────────────────────────────────────────
describe('groupLeavesByEmployeeAndType', () => {
  test('groups by employeeId and leaveTypeCode, sums days', () => {
    const apps = [
      { employeeId: 'E001', leaveType: { code: 'ML', name: 'Maternity Leave', isGovtPaid: true }, totalDays: 5 },
      { employeeId: 'E001', leaveType: { code: 'ML', name: 'Maternity Leave', isGovtPaid: true }, totalDays: 3 },
      { employeeId: 'E002', leaveType: { code: 'NSL', name: 'NS Leave', isGovtPaid: true }, totalDays: 2 },
    ];
    const groups = groupLeavesByEmployeeAndType(apps);
    expect(groups['E001']['ML'].days).toBe(8);
    expect(groups['E002']['NSL'].days).toBe(2);
  });

  test('excludes non-govt-paid leave', () => {
    const apps = [
      { employeeId: 'E001', leaveType: { code: 'AL', name: 'Annual Leave', isGovtPaid: false }, totalDays: 5 },
      { employeeId: 'E001', leaveType: { code: 'ML', name: 'Maternity Leave', isGovtPaid: true }, totalDays: 3 },
    ];
    const groups = groupLeavesByEmployeeAndType(apps);
    expect(groups['E001']['AL']).toBeUndefined();
    expect(groups['E001']['ML'].days).toBe(3);
  });

  test('returns empty object when no govt-paid leave', () => {
    const apps = [
      { employeeId: 'E001', leaveType: { code: 'AL', name: 'Annual Leave', isGovtPaid: false }, totalDays: 5 },
    ];
    expect(groupLeavesByEmployeeAndType(apps)).toEqual({});
  });

  test('handles missing leaveType gracefully', () => {
    const apps = [
      { employeeId: 'E001', leaveType: null, totalDays: 3 },
      { employeeId: 'E002', leaveType: { code: 'PL', name: 'Paternity Leave', isGovtPaid: true }, totalDays: 2 },
    ];
    const groups = groupLeavesByEmployeeAndType(apps);
    expect(groups['E001']).toBeUndefined();
    expect(groups['E002']['PL'].days).toBe(2);
  });
});

// ── isValidTransition ────────────────────────────────────────────────────────
describe('isValidTransition', () => {
  test('PENDING → SUBMITTED is valid', () => {
    expect(isValidTransition('PENDING', 'SUBMITTED')).toBe(true);
  });
  test('PENDING → REJECTED is valid', () => {
    expect(isValidTransition('PENDING', 'REJECTED')).toBe(true);
  });
  test('SUBMITTED → REIMBURSED is valid', () => {
    expect(isValidTransition('SUBMITTED', 'REIMBURSED')).toBe(true);
  });
  test('SUBMITTED → REJECTED is valid', () => {
    expect(isValidTransition('SUBMITTED', 'REJECTED')).toBe(true);
  });
  test('REIMBURSED → anything is invalid', () => {
    expect(isValidTransition('REIMBURSED', 'PENDING')).toBe(false);
    expect(isValidTransition('REIMBURSED', 'SUBMITTED')).toBe(false);
  });
  test('PENDING → REIMBURSED (skip SUBMITTED) is invalid', () => {
    expect(isValidTransition('PENDING', 'REIMBURSED')).toBe(false);
  });
  test('REJECTED → anything is invalid', () => {
    expect(isValidTransition('REJECTED', 'SUBMITTED')).toBe(false);
    expect(isValidTransition('REJECTED', 'REIMBURSED')).toBe(false);
  });
});

// ── round2 ───────────────────────────────────────────────────────────────────
describe('round2', () => {
  test('rounds 1.005 to 1.01 (symmetric)', () => {
    expect(round2(1.005)).toBeCloseTo(1.01, 1);
  });
  test('leaves integer unchanged', () => {
    expect(round2(100)).toBe(100);
  });
});
