'use strict';
/**
 * Unit tests: WICA Engine (FWA-003)
 *
 * WE-01  isReportableToMom — FATAL is reportable
 * WE-02  isReportableToMom — HOSPITALISATION is reportable
 * WE-03  isReportableToMom — PERMANENT_INCAPACITY is reportable
 * WE-04  isReportableToMom — MEDICAL_LEAVE_ONLY is NOT reportable
 * WD-01  computeMomDeadline — FATAL: deadline is 1 working day after incident
 * WD-02  computeMomDeadline — HOSPITALISATION: deadline is 10 working days after incident
 * WD-03  computeMomDeadline — MEDICAL_LEAVE_ONLY: returns null
 * WD-04  computeMomDeadline — skips weekends correctly
 * WU-01  classifyDeadlineUrgency — null deadline → NOT_REQUIRED
 * WU-02  classifyDeadlineUrgency — past deadline → OVERDUE
 * WU-03  classifyDeadlineUrgency — 0d remaining → CRITICAL
 * WU-04  classifyDeadlineUrgency — 3d remaining → WARNING
 * WU-05  classifyDeadlineUrgency — 7d remaining → OK
 * WO-01  findOverdueIncidents — returns only unreported past-deadline incidents
 * WO-02  findOverdueIncidents — excludes already MOM_REPORTED incidents
 * WO-03  findOverdueIncidents — excludes CLOSED incidents
 * WS-01  buildWicaDashboard — correct totals from mixed incidents
 * WS-02  buildWicaDashboard — counts open claims correctly
 */

const {
  isReportableToMom,
  computeMomDeadline,
  classifyDeadlineUrgency,
  findOverdueIncidents,
  buildWicaDashboard,
} = require('../src/engines/wica.engine');

// ── isReportableToMom ─────────────────────────────────────────────────────────
test('WE-01 FATAL is reportable', () => {
  expect(isReportableToMom('FATAL')).toBe(true);
});

test('WE-02 HOSPITALISATION is reportable', () => {
  expect(isReportableToMom('HOSPITALISATION')).toBe(true);
});

test('WE-03 PERMANENT_INCAPACITY is reportable', () => {
  expect(isReportableToMom('PERMANENT_INCAPACITY')).toBe(true);
});

test('WE-04 MEDICAL_LEAVE_ONLY is not reportable', () => {
  expect(isReportableToMom('MEDICAL_LEAVE_ONLY')).toBe(false);
});

// ── computeMomDeadline ────────────────────────────────────────────────────────
test('WD-01 FATAL deadline is 1 working day after incident (Mon)', () => {
  // Monday 2026-06-01 → deadline Tue 2026-06-02
  const incident = new Date('2026-06-01T00:00:00Z');
  const deadline = computeMomDeadline(incident, 'FATAL');
  expect(deadline.toISOString().slice(0, 10)).toBe('2026-06-02');
});

test('WD-02 HOSPITALISATION deadline is 10 working days', () => {
  // Monday 2026-06-01 → 10 working days = Fri 2026-06-12 (skip Sat/Sun)
  const incident = new Date('2026-06-01T00:00:00Z');
  const deadline = computeMomDeadline(incident, 'HOSPITALISATION');
  // 10 working days from Mon Jun 1:
  // Week 1: Tue(1), Wed(2), Thu(3), Fri(4) = 4, then Sat/Sun skip
  // Week 2: Mon(5), Tue(6), Wed(7), Thu(8), Fri(9) = 5 more = 9 total
  // Mon Jun 15 = 10th
  expect(deadline.toISOString().slice(0, 10)).toBe('2026-06-15');
});

test('WD-03 MEDICAL_LEAVE_ONLY returns null', () => {
  const deadline = computeMomDeadline(new Date('2026-06-01'), 'MEDICAL_LEAVE_ONLY');
  expect(deadline).toBeNull();
});

test('WD-04 FATAL deadline skips weekend correctly (Friday incident)', () => {
  // Friday 2026-05-29 → next working day is Monday 2026-06-01
  const incident = new Date('2026-05-29T00:00:00Z');
  const deadline = computeMomDeadline(incident, 'FATAL');
  expect(deadline.toISOString().slice(0, 10)).toBe('2026-06-01');
});

// ── classifyDeadlineUrgency ───────────────────────────────────────────────────
test('WU-01 null deadline → NOT_REQUIRED', () => {
  expect(classifyDeadlineUrgency(null)).toBe('NOT_REQUIRED');
});

test('WU-02 past deadline → OVERDUE', () => {
  const past = new Date(Date.now() - 2 * 86_400_000);
  expect(classifyDeadlineUrgency(past)).toBe('OVERDUE');
});

test('WU-03 same day deadline → CRITICAL', () => {
  const sameDay = new Date(Date.now() + 12 * 3_600_000); // 12h from now, same day
  expect(classifyDeadlineUrgency(sameDay)).toBe('CRITICAL');
});

test('WU-04 3d remaining → WARNING', () => {
  const threeDays = new Date(Date.now() + 3 * 86_400_000);
  expect(classifyDeadlineUrgency(threeDays)).toBe('WARNING');
});

test('WU-05 7d remaining → OK', () => {
  const sevenDays = new Date(Date.now() + 7 * 86_400_000);
  expect(classifyDeadlineUrgency(sevenDays)).toBe('OK');
});

// ── findOverdueIncidents ──────────────────────────────────────────────────────
test('WO-01 findOverdueIncidents — returns only unreported past-deadline incidents', () => {
  const now = new Date();
  const past = new Date(now.getTime() - 2 * 86_400_000);
  const future = new Date(now.getTime() + 2 * 86_400_000);
  const incidents = [
    { id: '1', momReportDeadline: past,   momReportedAt: null, status: 'REPORTED' },    // overdue
    { id: '2', momReportDeadline: future, momReportedAt: null, status: 'REPORTED' },    // not yet due
    { id: '3', momReportDeadline: past,   momReportedAt: null, status: 'UNDER_REVIEW' },// overdue
  ];
  const result = findOverdueIncidents(incidents, now);
  expect(result).toHaveLength(2);
  expect(result.map(i => i.id)).toEqual(expect.arrayContaining(['1', '3']));
});

test('WO-02 findOverdueIncidents — excludes already MOM_REPORTED incidents', () => {
  const now  = new Date();
  const past = new Date(now.getTime() - 2 * 86_400_000);
  const incidents = [
    { id: '1', momReportDeadline: past, momReportedAt: null,    status: 'REPORTED' },     // overdue
    { id: '2', momReportDeadline: past, momReportedAt: new Date(), status: 'MOM_REPORTED' }, // already done
  ];
  const result = findOverdueIncidents(incidents, now);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe('1');
});

test('WO-03 findOverdueIncidents — excludes CLOSED incidents', () => {
  const now  = new Date();
  const past = new Date(now.getTime() - 86_400_000);
  const incidents = [
    { id: '1', momReportDeadline: past, momReportedAt: null, status: 'CLOSED' },
  ];
  expect(findOverdueIncidents(incidents, now)).toHaveLength(0);
});

// ── buildWicaDashboard ────────────────────────────────────────────────────────
test('WS-01 buildWicaDashboard correct totals from mixed incidents', () => {
  const now  = new Date();
  const past = new Date(now.getTime() - 86_400_000);
  const future = new Date(now.getTime() + 5 * 86_400_000);
  const incidents = [
    { id: '1', category: 'FATAL',            status: 'REPORTED',     momReportDeadline: past,   momReportedAt: null },
    { id: '2', category: 'HOSPITALISATION',  status: 'MOM_REPORTED', momReportDeadline: future, momReportedAt: new Date() },
    { id: '3', category: 'MEDICAL_LEAVE_ONLY', status: 'CLOSED',     momReportDeadline: null,   momReportedAt: null },
  ];
  const summary = buildWicaDashboard(incidents, [], now);
  expect(summary.totalIncidents).toBe(3);
  expect(summary.byCategory.FATAL).toBe(1);
  expect(summary.byCategory.HOSPITALISATION).toBe(1);
  expect(summary.byCategory.MEDICAL_LEAVE_ONLY).toBe(1);
  expect(summary.momOverdue).toBe(1);    // incident 1 is overdue
  expect(summary.momReportingDue).toBe(0); // incident 2 already reported, incident 3 not required
});

test('WS-02 buildWicaDashboard counts open claims correctly', () => {
  const claims = [
    { status: 'PENDING' },
    { status: 'INSURER_NOTIFIED' },
    { status: 'PAID' },
    { status: 'REJECTED' },
  ];
  const summary = buildWicaDashboard([], claims, new Date());
  expect(summary.openClaims).toBe(2);         // PENDING + INSURER_NOTIFIED
  expect(summary.claimsByStatus.PAID).toBe(1);
  expect(summary.claimsByStatus.REJECTED).toBe(1);
});
