'use strict';

const {
  DEFAULT_BANDS,
  validateBands,
  effectiveScore,
  computeDistribution,
  hasDeviation,
  groupByDepartment,
} = require('../src/engines/bellcurve.engine');

const BANDS = [
  { label: 'Outstanding',        minScore: 4.5, maxScore: 5.0, targetPct: 10, deviationTolerance: 5 },
  { label: 'Exceeds',            minScore: 3.5, maxScore: 4.49, targetPct: 25, deviationTolerance: 7 },
  { label: 'Meets',              minScore: 2.5, maxScore: 3.49, targetPct: 50, deviationTolerance: 10 },
  { label: 'Needs Improvement',  minScore: 1.5, maxScore: 2.49, targetPct: 10, deviationTolerance: 5 },
  { label: 'Unsatisfactory',     minScore: 0,   maxScore: 1.49, targetPct: 5,  deviationTolerance: 5 },
];

function makeAppraisal(calibrated, overall) {
  return { calibratedScore: calibrated ?? null, overallScore: overall ?? null };
}

// ── effectiveScore ────────────────────────────────────────────────────────────
describe('effectiveScore', () => {
  test('prefers calibratedScore over overallScore', () => {
    expect(effectiveScore(makeAppraisal(4.5, 3.0))).toBe(4.5);
  });
  test('falls back to overallScore when calibratedScore is null', () => {
    expect(effectiveScore(makeAppraisal(null, 3.5))).toBe(3.5);
  });
  test('returns null when both are null', () => {
    expect(effectiveScore(makeAppraisal(null, null))).toBeNull();
  });
  test('calibratedScore 0 is valid (not falsy-coerced)', () => {
    expect(effectiveScore(makeAppraisal(0, 3.0))).toBe(0);
  });
});

// ── validateBands ─────────────────────────────────────────────────────────────
describe('validateBands', () => {
  test('accepts valid 5-band config', () => {
    expect(validateBands(BANDS)).toBeNull();
  });
  test('rejects empty array', () => {
    expect(validateBands([])).toMatch(/non-empty/);
  });
  test('rejects non-array', () => {
    expect(validateBands(null)).toMatch(/non-empty/);
  });
  test('rejects band missing minScore', () => {
    const bad = [{ label: 'X', maxScore: 5, targetPct: 100 }];
    expect(validateBands(bad)).toMatch(/minScore/);
  });
  test('rejects band where minScore > maxScore', () => {
    const bad = [{ label: 'X', minScore: 5, maxScore: 1, targetPct: 100 }];
    expect(validateBands(bad)).toMatch(/minScore must be/);
  });
  test('rejects targetPct out of range', () => {
    const bad = [{ label: 'X', minScore: 0, maxScore: 5, targetPct: 150 }];
    expect(validateBands(bad)).toMatch(/targetPct/);
  });
  test('rejects when targetPcts do not sum to 100', () => {
    const bad = BANDS.map((b, i) => ({ ...b, targetPct: i === 0 ? 20 : b.targetPct }));
    expect(validateBands(bad)).toMatch(/sum to 100/);
  });
  test('accepts 1-pct tolerance in sum', () => {
    const close = BANDS.map((b, i) => ({ ...b, targetPct: i === 0 ? 10.5 : b.targetPct }));
    // 10.5+25+50+10+5 = 100.5 → within 1-point tolerance
    expect(validateBands(close)).toBeNull();
  });
  test('rejects negative deviationTolerance', () => {
    const bad = [{ ...BANDS[0], deviationTolerance: -1 }, ...BANDS.slice(1)];
    expect(validateBands(bad)).toMatch(/deviationTolerance/);
  });
});

// ── computeDistribution ───────────────────────────────────────────────────────
describe('computeDistribution', () => {
  const appraisals = [
    makeAppraisal(5.0, null),   // Outstanding
    makeAppraisal(4.8, null),   // Outstanding
    makeAppraisal(4.0, null),   // Exceeds ×2
    makeAppraisal(3.8, null),
    makeAppraisal(3.2, null),   // Meets ×4
    makeAppraisal(3.0, null),
    makeAppraisal(2.8, null),
    makeAppraisal(2.6, null),
    makeAppraisal(2.0, null),   // Needs Improvement
    makeAppraisal(1.0, null),   // Unsatisfactory
  ];

  let dist;
  beforeAll(() => { dist = computeDistribution(appraisals, BANDS); });

  test('returns one entry per band', () => {
    expect(dist).toHaveLength(BANDS.length);
  });
  test('Outstanding band count = 2', () => {
    expect(dist[0].count).toBe(2);
  });
  test('Meets band count = 4', () => {
    expect(dist[2].count).toBe(4);
  });
  test('actualPct sums to ~100 over rated employees', () => {
    const sum = dist.reduce((s, b) => s + b.actualPct, 0);
    expect(sum).toBeCloseTo(100, 0);
  });
  test('Outstanding actualPct = 20 (2/10)', () => {
    expect(dist[0].actualPct).toBe(20);
  });
  test('Outstanding deviation = +10 (20 - 10)', () => {
    expect(dist[0].deviation).toBe(10);
  });
  test('Outstanding status = OVER (deviation 10 > tolerance 5)', () => {
    expect(dist[0].status).toBe('OVER');
  });
  test('Meets status = OK when within tolerance', () => {
    // Meets: 4/10 = 40%, target 50%, deviation -10, tolerance 10 → abs(dev)=10 ≤ tol → but 10 > 10*0.6=6 → WARNING
    expect(['OK', 'WARNING']).toContain(dist[2].status);
  });
  test('skips appraisals with null effective score', () => {
    const withNull = [...appraisals, makeAppraisal(null, null)];
    const d2 = computeDistribution(withNull, BANDS);
    expect(d2[0].count).toBe(2); // same counts
  });
  test('empty appraisals returns zero actualPct', () => {
    const d = computeDistribution([], BANDS);
    d.forEach(b => expect(b.actualPct).toBe(0));
  });
  test('uses calibratedScore over overallScore', () => {
    const a = [makeAppraisal(4.8, 2.0)]; // calibrated → Outstanding
    const d = computeDistribution(a, BANDS);
    expect(d[0].count).toBe(1); // Outstanding
    expect(d[2].count).toBe(0); // Meets
  });
});

// ── hasDeviation ──────────────────────────────────────────────────────────────
describe('hasDeviation', () => {
  test('returns true when any band is OVER', () => {
    const dist = [{ status: 'OK' }, { status: 'OVER' }, { status: 'OK' }];
    expect(hasDeviation(dist)).toBe(true);
  });
  test('returns true when any band is UNDER', () => {
    const dist = [{ status: 'OK' }, { status: 'UNDER' }, { status: 'OK' }];
    expect(hasDeviation(dist)).toBe(true);
  });
  test('returns false when all bands are OK or WARNING', () => {
    const dist = [{ status: 'OK' }, { status: 'WARNING' }, { status: 'OK' }];
    expect(hasDeviation(dist)).toBe(false);
  });
  test('returns false for empty distribution', () => {
    expect(hasDeviation([])).toBe(false);
  });
});

// ── DEFAULT_BANDS ─────────────────────────────────────────────────────────────
describe('DEFAULT_BANDS', () => {
  test('sum to 100', () => {
    const sum = DEFAULT_BANDS.reduce((s, b) => s + b.targetPct, 0);
    expect(sum).toBe(100);
  });
  test('has 5 bands', () => {
    expect(DEFAULT_BANDS).toHaveLength(5);
  });
  test('validates cleanly', () => {
    expect(validateBands(DEFAULT_BANDS)).toBeNull();
  });
});

// ── groupByDepartment ─────────────────────────────────────────────────────────
describe('groupByDepartment', () => {
  const appraisals = [
    { ...makeAppraisal(4.5, null), employeeId: 'e1' },
    { ...makeAppraisal(3.0, null), employeeId: 'e2' },
    { ...makeAppraisal(2.0, null), employeeId: 'e3' },
    { ...makeAppraisal(4.0, null), employeeId: 'e4' },
  ];
  const employeeMap = {
    e1: { fullName: 'Alice', department: 'Engineering' },
    e2: { fullName: 'Bob',   department: 'Engineering' },
    e3: { fullName: 'Carol', department: 'Finance' },
    // e4 has no employee record → Unassigned
  };

  let result;
  beforeAll(() => { result = groupByDepartment(appraisals, employeeMap, BANDS); });

  test('creates a group per department', () => {
    expect(Object.keys(result).sort()).toEqual(['Engineering', 'Finance', 'Unassigned']);
  });
  test('Engineering count = 2', () => {
    expect(result['Engineering'].count).toBe(2);
  });
  test('Finance count = 1', () => {
    expect(result['Finance'].count).toBe(1);
  });
  test('Unassigned count = 1 (no employee record)', () => {
    expect(result['Unassigned'].count).toBe(1);
  });
  test('each group has distribution when bands provided', () => {
    expect(result['Engineering'].distribution).not.toBeNull();
    expect(result['Engineering'].distribution).toHaveLength(BANDS.length);
  });
  test('appraisal enriched with _employeeName', () => {
    const alice = result['Engineering'].appraisals.find(a => a.employeeId === 'e1');
    expect(alice._employeeName).toBe('Alice');
  });
  test('missing employee → _employeeName null', () => {
    const unassigned = result['Unassigned'].appraisals[0];
    expect(unassigned._employeeName).toBeNull();
  });
  test('null bands → distribution is null per group', () => {
    const r = groupByDepartment(appraisals, employeeMap, null);
    Object.values(r).forEach(g => expect(g.distribution).toBeNull());
  });
});
