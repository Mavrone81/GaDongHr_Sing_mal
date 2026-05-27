'use strict';
/**
 * Unit tests: OT Pre-Authorization Engine (FWA-002)
 *
 * OC-01  checkMonthlyCap — hours within cap → canProceed true
 * OC-02  checkMonthlyCap — hours exactly at cap → canProceed true
 * OC-03  checkMonthlyCap — hours exceeding cap → canProceed false, wouldExceed true
 * OC-04  checkMonthlyCap — remainingHours is correct
 * OB-01  checkBudget — within budget → canProceed true
 * OB-02  checkBudget — exactly at budget → canProceed true
 * OB-03  checkBudget — over budget → canProceed false, wouldExceed true
 * OB-04  checkBudget — remainingBudget is correct
 * OE-01  isWithinEmergencyWindow — date just passed → true
 * OE-02  isWithinEmergencyWindow — date more than 24h ago → false
 * OE-03  isWithinEmergencyWindow — future date → false
 * OX-01  computeExpiresAt — standard → expires at planned date
 * OX-02  computeExpiresAt — emergency → expires 24h after planned date
 * OS-01  buildMonthlyOtSummary — empty list → zeros
 * OS-02  buildMonthlyOtSummary — mixed statuses → correct counts and hours
 * OS-03  buildMonthlyOtSummary — byEmployee sorted by approvedHours desc
 * OS-04  buildMonthlyOtSummary — byDepartment aggregated correctly
 * OX-03  findExpiredOtRequests — returns only past-expiresAt entries
 */

const {
  MOM_MONTHLY_CAP_HOURS,
  EMERGENCY_WINDOW_HOURS,
  checkMonthlyCap,
  checkBudget,
  isWithinEmergencyWindow,
  computeExpiresAt,
  buildMonthlyOtSummary,
  findExpiredOtRequests,
} = require('../src/engines/ot-auth.engine');

// ── checkMonthlyCap ───────────────────────────────────────────────────────────
test('OC-01 checkMonthlyCap within cap → canProceed true', () => {
  const result = checkMonthlyCap(40, 20);
  expect(result.canProceed).toBe(true);
  expect(result.wouldExceed).toBe(false);
  expect(result.projectedTotal).toBe(60);
  expect(result.capHours).toBe(72);
});

test('OC-02 checkMonthlyCap exactly at cap → canProceed true', () => {
  const result = checkMonthlyCap(52, 20);
  expect(result.canProceed).toBe(true);
  expect(result.projectedTotal).toBe(72);
  expect(result.wouldExceed).toBe(false);
});

test('OC-03 checkMonthlyCap exceeds cap → canProceed false', () => {
  const result = checkMonthlyCap(60, 20);
  expect(result.canProceed).toBe(false);
  expect(result.wouldExceed).toBe(true);
  expect(result.projectedTotal).toBe(80);
});

test('OC-04 checkMonthlyCap remainingHours is correct', () => {
  const result = checkMonthlyCap(50, 10);
  expect(result.remainingHours).toBe(22);
  expect(result.alreadyApprovedHours).toBe(50);
  expect(result.requestedHours).toBe(10);
});

// ── checkBudget ───────────────────────────────────────────────────────────────
test('OB-01 checkBudget within budget → canProceed true', () => {
  const result = checkBudget(100, 30, 20);
  expect(result.canProceed).toBe(true);
  expect(result.projectedUsed).toBe(50);
});

test('OB-02 checkBudget exactly at budget → canProceed true', () => {
  const result = checkBudget(100, 80, 20);
  expect(result.canProceed).toBe(true);
  expect(result.projectedUsed).toBe(100);
  expect(result.wouldExceed).toBe(false);
});

test('OB-03 checkBudget over budget → canProceed false', () => {
  const result = checkBudget(100, 90, 20);
  expect(result.canProceed).toBe(false);
  expect(result.wouldExceed).toBe(true);
  expect(result.projectedUsed).toBe(110);
});

test('OB-04 checkBudget remainingBudget is correct', () => {
  const result = checkBudget(200, 120, 10);
  expect(result.remainingBudget).toBe(80);
  expect(result.budgetHours).toBe(200);
  expect(result.usedHours).toBe(120);
});

// ── isWithinEmergencyWindow ───────────────────────────────────────────────────
test('OE-01 isWithinEmergencyWindow — OT worked 2h ago → true', () => {
  const planned = new Date(Date.now() - 2 * 3_600_000);
  expect(isWithinEmergencyWindow(planned, new Date())).toBe(true);
});

test('OE-02 isWithinEmergencyWindow — OT worked 25h ago → false', () => {
  const planned = new Date(Date.now() - 25 * 3_600_000);
  expect(isWithinEmergencyWindow(planned, new Date())).toBe(false);
});

test('OE-03 isWithinEmergencyWindow — future planned date → false', () => {
  const planned = new Date(Date.now() + 3_600_000);
  expect(isWithinEmergencyWindow(planned, new Date())).toBe(false);
});

// ── computeExpiresAt ──────────────────────────────────────────────────────────
test('OX-01 computeExpiresAt standard → expires at planned date', () => {
  const planned = new Date('2026-06-15T00:00:00.000Z');
  const expires = computeExpiresAt(planned, false);
  expect(expires.getTime()).toBe(planned.getTime());
});

test('OX-02 computeExpiresAt emergency → expires 24h after planned date', () => {
  const planned = new Date('2026-06-15T00:00:00.000Z');
  const expires = computeExpiresAt(planned, true);
  expect(expires.getTime()).toBe(planned.getTime() + EMERGENCY_WINDOW_HOURS * 3_600_000);
});

// ── buildMonthlyOtSummary ─────────────────────────────────────────────────────
test('OS-01 buildMonthlyOtSummary empty list → all zeros', () => {
  const result = buildMonthlyOtSummary([], '2026-06');
  expect(result.total).toBe(0);
  expect(result.approved).toBe(0);
  expect(result.totalApprovedHours).toBe(0);
  expect(result.byEmployee).toHaveLength(0);
  expect(result.byDepartment).toHaveLength(0);
  expect(result.period).toBe('2026-06');
});

test('OS-02 buildMonthlyOtSummary mixed statuses → correct counts', () => {
  const auths = [
    { employeeId: 'e1', departmentId: 'd1', status: 'APPROVED', requestedHours: 10 },
    { employeeId: 'e1', departmentId: 'd1', status: 'APPROVED', requestedHours: 5 },
    { employeeId: 'e2', departmentId: 'd1', status: 'PENDING',  requestedHours: 8 },
    { employeeId: 'e3', departmentId: 'd2', status: 'REJECTED', requestedHours: 4 },
  ];
  const result = buildMonthlyOtSummary(auths, '2026-06');
  expect(result.total).toBe(4);
  expect(result.approved).toBe(2);
  expect(result.pending).toBe(1);
  expect(result.rejected).toBe(1);
  expect(result.totalApprovedHours).toBe(15);
});

test('OS-03 buildMonthlyOtSummary byEmployee sorted by approvedHours desc', () => {
  const auths = [
    { employeeId: 'e1', departmentId: null, status: 'APPROVED', requestedHours: 5 },
    { employeeId: 'e2', departmentId: null, status: 'APPROVED', requestedHours: 20 },
    { employeeId: 'e1', departmentId: null, status: 'APPROVED', requestedHours: 8 },
  ];
  const result = buildMonthlyOtSummary(auths, '2026-06');
  expect(result.byEmployee[0].employeeId).toBe('e2');
  expect(result.byEmployee[0].approvedHours).toBe(20);
  expect(result.byEmployee[1].employeeId).toBe('e1');
  expect(result.byEmployee[1].approvedHours).toBe(13);
});

test('OS-04 buildMonthlyOtSummary byDepartment aggregated correctly', () => {
  const auths = [
    { employeeId: 'e1', departmentId: 'eng',  status: 'APPROVED', requestedHours: 10 },
    { employeeId: 'e2', departmentId: 'eng',  status: 'APPROVED', requestedHours: 15 },
    { employeeId: 'e3', departmentId: 'sales', status: 'APPROVED', requestedHours: 5 },
  ];
  const result = buildMonthlyOtSummary(auths, '2026-06');
  expect(result.byDepartment).toHaveLength(2);
  const eng = result.byDepartment.find(d => d.departmentId === 'eng');
  expect(eng.approvedHours).toBe(25);
  expect(eng.requestCount).toBe(2);
});

// ── findExpiredOtRequests ─────────────────────────────────────────────────────
test('OX-03 findExpiredOtRequests — returns only past-expiresAt entries', () => {
  const now = new Date();
  const pending = [
    { id: '1', expiresAt: new Date(now.getTime() - 1000) },   // past → expired
    { id: '2', expiresAt: new Date(now.getTime() + 100000) }, // future → not expired
    { id: '3', expiresAt: new Date(now.getTime() - 5000) },   // past → expired
  ];
  const expired = findExpiredOtRequests(pending, now);
  expect(expired).toHaveLength(2);
  expect(expired.map(e => e.id)).toEqual(expect.arrayContaining(['1', '3']));
});
