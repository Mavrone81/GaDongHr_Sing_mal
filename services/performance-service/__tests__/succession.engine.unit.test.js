'use strict';

const {
  performanceBand,
  build9BoxEntry,
  computePositionRisk,
  buildRiskReportRow,
  computeRiskReport,
  computeSuccessionDashboard,
  BOX_LABELS,
} = require('../src/engines/succession.engine');

// ── performanceBand ───────────────────────────────────────────────────────────
describe('performanceBand', () => {
  test('null score returns null', () => expect(performanceBand(null)).toBeNull());
  test('undefined returns null', () => expect(performanceBand(undefined)).toBeNull());
  test('score 0 returns 1 (Low)', () => expect(performanceBand(0)).toBe(1));
  test('score 1.99 returns 1 (Low)', () => expect(performanceBand(1.99)).toBe(1));
  test('score 2.0 returns 2 (Medium)', () => expect(performanceBand(2.0)).toBe(2));
  test('score 3.49 returns 2 (Medium)', () => expect(performanceBand(3.49)).toBe(2));
  test('score 3.5 returns 3 (High)', () => expect(performanceBand(3.5)).toBe(3));
  test('score 5.0 returns 3 (High)', () => expect(performanceBand(5.0)).toBe(3));
});

// ── build9BoxEntry ────────────────────────────────────────────────────────────
describe('build9BoxEntry', () => {
  test('null performance score returns null', () => {
    expect(build9BoxEntry(null, 2)).toBeNull();
  });
  test('potentialBand 0 returns null', () => {
    expect(build9BoxEntry(4.0, 0)).toBeNull();
  });
  test('potentialBand 4 returns null', () => {
    expect(build9BoxEntry(4.0, 4)).toBeNull();
  });
  test('High Pot + High Perf = box 3 (Star)', () => {
    const r = build9BoxEntry(4.0, 3);
    expect(r).not.toBeNull();
    expect(r.box).toBe(3);
    expect(r.label).toBe('Star');
    expect(r.performanceBand).toBe(3);
    expect(r.potentialBand).toBe(3);
  });
  test('High Pot + Low Perf = box 1 (Potential Gem)', () => {
    const r = build9BoxEntry(1.5, 3);
    expect(r.box).toBe(1);
    expect(r.label).toBe('Potential Gem');
  });
  test('Low Pot + High Perf = box 9 (Expert)', () => {
    const r = build9BoxEntry(4.5, 1);
    expect(r.box).toBe(9);
    expect(r.label).toBe('Expert');
  });
  test('Low Pot + Low Perf = box 7 (Underperformer)', () => {
    const r = build9BoxEntry(1.0, 1);
    expect(r.box).toBe(7);
    expect(r.label).toBe('Underperformer');
  });
  test('Med Pot + Med Perf = box 5 (Core Employee)', () => {
    const r = build9BoxEntry(3.0, 2);
    expect(r.box).toBe(5);
    expect(r.label).toBe('Core Employee');
  });
  test('box labels cover all 9 boxes', () => {
    expect(Object.keys(BOX_LABELS)).toHaveLength(9);
  });
  test('returns performanceLabel and potentialLabel', () => {
    const r = build9BoxEntry(4.0, 3);
    expect(r.performanceLabel).toBe('High');
    expect(r.potentialLabel).toBe('High');
  });
});

// ── computePositionRisk ───────────────────────────────────────────────────────
describe('computePositionRisk', () => {
  test('empty nominees → HIGH', () => {
    expect(computePositionRisk([])).toBe('HIGH');
  });
  test('null nominees → HIGH', () => {
    expect(computePositionRisk(null)).toBe('HIGH');
  });
  test('TWO_YEARS only → HIGH', () => {
    expect(computePositionRisk([{ readiness: 'TWO_YEARS' }])).toBe('HIGH');
  });
  test('ONE_YEAR (no READY_NOW) → MEDIUM', () => {
    expect(computePositionRisk([
      { readiness: 'TWO_YEARS' },
      { readiness: 'ONE_YEAR' },
    ])).toBe('MEDIUM');
  });
  test('READY_NOW present → LOW', () => {
    expect(computePositionRisk([
      { readiness: 'TWO_YEARS' },
      { readiness: 'READY_NOW' },
    ])).toBe('LOW');
  });
  test('single READY_NOW → LOW', () => {
    expect(computePositionRisk([{ readiness: 'READY_NOW' }])).toBe('LOW');
  });
});

// ── buildRiskReportRow ────────────────────────────────────────────────────────
describe('buildRiskReportRow', () => {
  const pos = { id: 'p1', jobTitle: 'CEO', department: 'Executive', currentHolderId: 'e1' };

  test('no nominees: HIGH risk, readyCounts all zero', () => {
    const row = buildRiskReportRow(pos, []);
    expect(row.riskLevel).toBe('HIGH');
    expect(row.totalNominees).toBe(0);
    expect(row.readyCounts.READY_NOW).toBe(0);
  });

  test('mixed nominees: counts correct', () => {
    const nominees = [
      { readiness: 'READY_NOW' },
      { readiness: 'ONE_YEAR' },
      { readiness: 'ONE_YEAR' },
      { readiness: 'TWO_YEARS' },
    ];
    const row = buildRiskReportRow(pos, nominees);
    expect(row.riskLevel).toBe('LOW');
    expect(row.totalNominees).toBe(4);
    expect(row.readyCounts.READY_NOW).toBe(1);
    expect(row.readyCounts.ONE_YEAR).toBe(2);
    expect(row.readyCounts.TWO_YEARS).toBe(1);
  });
});

// ── computeRiskReport ─────────────────────────────────────────────────────────
describe('computeRiskReport', () => {
  test('summary counts HIGH / MEDIUM / LOW correctly', () => {
    const positions = [
      { id: 'a', jobTitle: 'CEO', department: null, currentHolderId: null },
      { id: 'b', jobTitle: 'CFO', department: null, currentHolderId: null },
      { id: 'c', jobTitle: 'CTO', department: null, currentHolderId: null },
    ];
    const nomineesByPosition = {
      a: [],
      b: [{ readiness: 'ONE_YEAR' }],
      c: [{ readiness: 'READY_NOW' }],
    };
    const report = computeRiskReport(positions, nomineesByPosition);
    expect(report.summary.high).toBe(1);
    expect(report.summary.medium).toBe(1);
    expect(report.summary.low).toBe(1);
    expect(report.summary.total).toBe(3);
    expect(report.rows).toHaveLength(3);
  });
});

// ── computeSuccessionDashboard ────────────────────────────────────────────────
describe('computeSuccessionDashboard', () => {
  test('empty state: zeros', () => {
    const d = computeSuccessionDashboard([], []);
    expect(d.totalPositions).toBe(0);
    expect(d.totalNominees).toBe(0);
    expect(d.coverageRate).toBe(0);
    expect(d.byRisk.high).toBe(0);
  });

  test('coverageRate = % positions with READY_NOW nominee', () => {
    const positions = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
    ];
    const nominees = [
      { positionId: 'a', readiness: 'READY_NOW' },
      { positionId: 'b', readiness: 'ONE_YEAR' },
      { positionId: 'c', readiness: 'READY_NOW' },
    ];
    const d = computeSuccessionDashboard(positions, nominees);
    expect(d.coverageRate).toBe(50); // 2 out of 4 have LOW risk
    expect(d.byReadiness.readyNow).toBe(2);
    expect(d.byReadiness.oneYear).toBe(1);
    expect(d.byReadiness.twoYears).toBe(0);
    expect(d.byRisk.high).toBe(1);   // only d has no nominees → HIGH; b has ONE_YEAR → MEDIUM
  });

  test('byRisk tallies match position risks', () => {
    const positions = [{ id: 'x' }];
    const nominees  = [{ positionId: 'x', readiness: 'READY_NOW' }];
    const d = computeSuccessionDashboard(positions, nominees);
    expect(d.byRisk.low).toBe(1);
    expect(d.byRisk.medium).toBe(0);
    expect(d.byRisk.high).toBe(0);
  });
});
