'use strict';
/**
 * Unit tests: HR Case Engine (HRC-001)
 *
 * NC-01  nextCaseNumber — DISCIPLINARY → DSC-2026-00001
 * NC-02  nextCaseNumber — GRIEVANCE    → GRV-2026-00001
 * NC-03  nextCaseNumber — count > 0 increments
 *
 * PD-01  progressiveDisciplineNext — no prior → VERBAL_WARNING
 * PD-02  progressiveDisciplineNext — verbal issued → WRITTEN_WARNING
 * PD-03  progressiveDisciplineNext — written issued → FINAL_WARNING
 * PD-04  progressiveDisciplineNext — final issued → TERMINATION_FOR_CAUSE
 * PD-05  progressiveDisciplineNext — already at top → stays at TERMINATION
 * PD-06  progressiveDisciplineNext — GROSS_MISCONDUCT skips ladder → TERMINATION
 * PD-07  progressiveDisciplineNext — ignores non-ladder actions
 *
 * ES-01  requiresEscalation — past SLA → true with nextLevel
 * ES-02  requiresEscalation — within SLA → false
 * ES-03  requiresEscalation — at top level (BOARD) → false
 * ES-04  requiresEscalation — CLOSED case → false
 * ES-05  requiresEscalation — gross misconduct has 3-day SLA
 *
 * MOM-01 computeMomReportable — discrimination category → true
 * MOM-02 computeMomReportable — harassment grievance + gross misconduct → true
 * MOM-03 computeMomReportable — regular attendance issue → false
 *
 * CS-01  buildCaseSummary — totals by type/status/severity
 * CS-02  buildCaseSummary — counts momReportable
 * CS-03  buildCaseSummary — empty list zeros
 *
 * VA-01  validateAppeal — RESOLVED case → valid
 * VA-02  validateAppeal — OPEN case → invalid
 * VA-03  validateAppeal — existing pending appeal → invalid
 *
 * SP-01  computeStageProgress — INTAKE → 1/6
 * SP-02  computeStageProgress — CLOSED → 6/6
 *
 * CIA-01 canIssueAction — TERMINATION at INTAKE on MINOR → blocked
 * CIA-02 canIssueAction — TERMINATION on GROSS_MISCONDUCT at INTAKE → allowed
 * CIA-03 canIssueAction — VERBAL_WARNING at INTAKE → allowed
 * CIA-04 canIssueAction — CLOSED case → blocked
 */

const {
  nextCaseNumber, progressiveDisciplineNext, requiresEscalation,
  computeMomReportable, buildCaseSummary, validateAppeal,
  computeStageProgress, canIssueAction,
} = require('../src/engines/hr-case.engine');

// ── nextCaseNumber ────────────────────────────────────────────────────────────
test('NC-01 DISCIPLINARY → DSC-2026-00001', () => {
  expect(nextCaseNumber('DISCIPLINARY', 0, 2026)).toBe('DSC-2026-00001');
});
test('NC-02 GRIEVANCE → GRV-2026-00001', () => {
  expect(nextCaseNumber('GRIEVANCE', 0, 2026)).toBe('GRV-2026-00001');
});
test('NC-03 count > 0 increments', () => {
  expect(nextCaseNumber('DISCIPLINARY', 42, 2026)).toBe('DSC-2026-00043');
});

// ── progressiveDisciplineNext ─────────────────────────────────────────────────
test('PD-01 no prior → VERBAL_WARNING', () => {
  expect(progressiveDisciplineNext([], 'MINOR')).toBe('VERBAL_WARNING');
});
test('PD-02 verbal → WRITTEN_WARNING', () => {
  expect(progressiveDisciplineNext(['VERBAL_WARNING'], 'MINOR')).toBe('WRITTEN_WARNING');
});
test('PD-03 written → FINAL_WARNING', () => {
  expect(progressiveDisciplineNext(['VERBAL_WARNING','WRITTEN_WARNING'], 'MINOR')).toBe('FINAL_WARNING');
});
test('PD-04 final → TERMINATION_FOR_CAUSE', () => {
  expect(progressiveDisciplineNext(['FINAL_WARNING'], 'MINOR')).toBe('TERMINATION_FOR_CAUSE');
});
test('PD-05 already terminated → stays at TERMINATION', () => {
  expect(progressiveDisciplineNext(['TERMINATION_FOR_CAUSE'], 'MINOR')).toBe('TERMINATION_FOR_CAUSE');
});
test('PD-06 GROSS_MISCONDUCT skips ladder', () => {
  expect(progressiveDisciplineNext([], 'GROSS_MISCONDUCT')).toBe('TERMINATION_FOR_CAUSE');
});
test('PD-07 ignores non-ladder actions', () => {
  expect(progressiveDisciplineNext(['COUNSELLING','MEDIATION','VERBAL_WARNING'], 'MINOR')).toBe('WRITTEN_WARNING');
});

// ── requiresEscalation ────────────────────────────────────────────────────────
test('ES-01 past SLA → true', () => {
  const opened = new Date(Date.now() - 40 * 86_400_000);
  const r = requiresEscalation({ openedAt: opened, severity: 'MINOR', escalationLevel: 'HR_ADMIN', status: 'OPEN' });
  expect(r.shouldEscalate).toBe(true);
  expect(r.nextLevel).toBe('HR_MANAGER');
});
test('ES-02 within SLA → false', () => {
  const opened = new Date(Date.now() - 5 * 86_400_000);
  const r = requiresEscalation({ openedAt: opened, severity: 'MINOR', escalationLevel: 'HR_ADMIN', status: 'OPEN' });
  expect(r.shouldEscalate).toBe(false);
});
test('ES-03 at top level → false', () => {
  const opened = new Date(Date.now() - 100 * 86_400_000);
  const r = requiresEscalation({ openedAt: opened, severity: 'MINOR', escalationLevel: 'BOARD', status: 'OPEN' });
  expect(r.shouldEscalate).toBe(false);
  expect(r.nextLevel).toBe(null);
});
test('ES-04 CLOSED case → false', () => {
  const r = requiresEscalation({ openedAt: new Date(0), severity: 'MINOR', escalationLevel: 'HR_ADMIN', status: 'CLOSED' });
  expect(r.shouldEscalate).toBe(false);
});
test('ES-05 GROSS_MISCONDUCT has 3-day SLA', () => {
  const opened = new Date(Date.now() - 4 * 86_400_000);
  const r = requiresEscalation({ openedAt: opened, severity: 'GROSS_MISCONDUCT', escalationLevel: 'HR_ADMIN', status: 'OPEN' });
  expect(r.shouldEscalate).toBe(true);
  expect(r.slaDays).toBe(3);
});

// ── computeMomReportable ──────────────────────────────────────────────────────
test('MOM-01 discrimination category → true', () => {
  expect(computeMomReportable({ category: 'discrimination', type: 'GRIEVANCE', severity: 'MINOR' })).toBe(true);
});
test('MOM-02 harassment grievance + gross misconduct → true', () => {
  expect(computeMomReportable({ category: 'harassment', type: 'GRIEVANCE', severity: 'GROSS_MISCONDUCT' })).toBe(true);
});
test('MOM-03 regular attendance issue → false', () => {
  expect(computeMomReportable({ category: 'attendance', type: 'DISCIPLINARY', severity: 'MINOR' })).toBe(false);
});

// ── buildCaseSummary ──────────────────────────────────────────────────────────
test('CS-01 totals by type/status/severity', () => {
  const cases = [
    { type: 'DISCIPLINARY', status: 'OPEN',     severity: 'MINOR',           currentStage: 'INTAKE',         openedAt: new Date(), escalationLevel: 'HR_ADMIN' },
    { type: 'GRIEVANCE',    status: 'RESOLVED', severity: 'MODERATE',        currentStage: 'DECISION',       openedAt: new Date(), escalationLevel: 'HR_ADMIN' },
    { type: 'GRIEVANCE',    status: 'CLOSED',   severity: 'MINOR',           currentStage: 'CLOSED',         openedAt: new Date(), escalationLevel: 'HR_ADMIN' },
  ];
  const s = buildCaseSummary(cases);
  expect(s.total).toBe(3);
  expect(s.open).toBe(1);
  expect(s.resolved).toBe(1);
  expect(s.closed).toBe(1);
  expect(s.byType.DISCIPLINARY).toBe(1);
  expect(s.byType.GRIEVANCE).toBe(2);
  expect(s.bySeverity.MINOR).toBe(2);
});

test('CS-02 counts momReportable', () => {
  const cases = [
    { type: 'GRIEVANCE', status: 'OPEN', severity: 'MINOR', category: 'discrimination', currentStage: 'INTAKE', openedAt: new Date(), escalationLevel: 'HR_ADMIN' },
    { type: 'DISCIPLINARY', status: 'OPEN', severity: 'MINOR', category: 'attendance', currentStage: 'INTAKE', openedAt: new Date(), escalationLevel: 'HR_ADMIN' },
  ];
  const s = buildCaseSummary(cases);
  expect(s.momReportable).toBe(1);
});

test('CS-03 empty list zeros', () => {
  const s = buildCaseSummary([]);
  expect(s.total).toBe(0);
  expect(s.open).toBe(0);
  expect(s.momReportable).toBe(0);
});

// ── validateAppeal ────────────────────────────────────────────────────────────
test('VA-01 RESOLVED case → valid', () => {
  expect(validateAppeal({ status: 'RESOLVED', appeals: [] })).toEqual({ valid: true, reason: null });
});
test('VA-02 OPEN case → invalid', () => {
  const r = validateAppeal({ status: 'OPEN', appeals: [] });
  expect(r.valid).toBe(false);
  expect(r.reason).toMatch(/RESOLVED/);
});
test('VA-03 existing pending appeal → invalid', () => {
  const r = validateAppeal({ status: 'RESOLVED', appeals: [{ status: 'PENDING' }] });
  expect(r.valid).toBe(false);
  expect(r.reason).toMatch(/pending appeal/);
});

// ── computeStageProgress ──────────────────────────────────────────────────────
test('SP-01 INTAKE → 1/6', () => {
  const p = computeStageProgress({ currentStage: 'INTAKE' });
  expect(p.position).toBe(1);
  expect(p.total).toBe(6);
  expect(p.percent).toBeGreaterThan(15);
  expect(p.percent).toBeLessThan(18);
});
test('SP-02 CLOSED → 6/6', () => {
  const p = computeStageProgress({ currentStage: 'CLOSED' });
  expect(p.position).toBe(6);
  expect(p.percent).toBe(100);
});

// ── canIssueAction ────────────────────────────────────────────────────────────
test('CIA-01 TERMINATION at INTAKE on MINOR → blocked', () => {
  const r = canIssueAction({ status: 'OPEN', currentStage: 'INTAKE', severity: 'MINOR' }, 'TERMINATION_FOR_CAUSE');
  expect(r.allowed).toBe(false);
});
test('CIA-02 TERMINATION on GROSS_MISCONDUCT at INTAKE → allowed', () => {
  const r = canIssueAction({ status: 'OPEN', currentStage: 'INTAKE', severity: 'GROSS_MISCONDUCT' }, 'TERMINATION_FOR_CAUSE');
  expect(r.allowed).toBe(true);
});
test('CIA-03 VERBAL_WARNING at INTAKE → allowed', () => {
  const r = canIssueAction({ status: 'OPEN', currentStage: 'INTAKE', severity: 'MINOR' }, 'VERBAL_WARNING');
  expect(r.allowed).toBe(true);
});
test('CIA-04 CLOSED case → blocked', () => {
  const r = canIssueAction({ status: 'CLOSED', currentStage: 'CLOSED', severity: 'MINOR' }, 'VERBAL_WARNING');
  expect(r.allowed).toBe(false);
});
