'use strict';
/**
 * Unit tests: Survey Engine (ENG-001)
 *
 * NPS-01  computeENPS — all promoters → +100
 * NPS-02  computeENPS — all detractors → -100
 * NPS-03  computeENPS — mixed → correct score
 * NPS-04  computeENPS — empty → 0
 * NPS-05  computeENPS — out-of-range filtered out
 *
 * LK-01  computeLikertStats — average + distribution
 * LK-02  computeLikertStats — positivePct (≥4)
 * LK-03  computeLikertStats — empty returns zeros
 *
 * MC-01  computeMultiChoiceStats — counts + percentages
 * MC-02  computeMultiChoiceStats — invalid indices ignored
 *
 * SUP-01 suppressLowSample — below minN suppresses
 * SUP-02 suppressLowSample — at minN returns original
 *
 * DB-01  buildSurveyDashboard — per-question stats
 * DB-02  buildSurveyDashboard — segments below minN are filtered
 * DB-03  buildSurveyDashboard — text comments suppressed below minN
 *
 * VA-01  validateAnswers — required missing → invalid
 * VA-02  validateAnswers — Likert out-of-range → invalid
 * VA-03  validateAnswers — NPS out-of-range → invalid
 * VA-04  validateAnswers — valid input → valid
 */

const {
  computeENPS, computeLikertStats, computeMultiChoiceStats,
  suppressLowSample, buildSurveyDashboard, validateAnswers,
} = require('../src/engines/survey.engine');

// ── computeENPS ──────────────────────────────────────────────────────────────
test('NPS-01 all promoters → +100', () => {
  const r = computeENPS([10, 9, 10]);
  expect(r.score).toBe(100);
});
test('NPS-02 all detractors → -100', () => {
  const r = computeENPS([0, 5, 6]);
  expect(r.score).toBe(-100);
});
test('NPS-03 mixed → correct score', () => {
  // 2 promoters, 1 passive, 1 detractor → 2/4 - 1/4 = 25%
  const r = computeENPS([10, 9, 8, 5]);
  expect(r.score).toBe(25);
  expect(r.promoters).toBe(2);
  expect(r.passives).toBe(1);
  expect(r.detractors).toBe(1);
});
test('NPS-04 empty → 0', () => {
  expect(computeENPS([]).score).toBe(0);
});
test('NPS-05 out-of-range filtered out', () => {
  // 15 and -3 are dropped, only [9] remains
  const r = computeENPS([15, 9, -3]);
  expect(r.total).toBe(1);
  expect(r.promoters).toBe(1);
});

// ── computeLikertStats ───────────────────────────────────────────────────────
test('LK-01 average + distribution', () => {
  const r = computeLikertStats([5, 5, 4, 3, 2, 1]);
  expect(r.total).toBe(6);
  expect(r.average).toBe(3.33);
  expect(r.distribution[5]).toBe(2);
  expect(r.distribution[1]).toBe(1);
});
test('LK-02 positivePct (≥4)', () => {
  const r = computeLikertStats([5, 4, 3, 2, 1]);
  expect(r.positivePct).toBe(40); // 2/5
});
test('LK-03 empty returns zeros', () => {
  expect(computeLikertStats([]).total).toBe(0);
});

// ── computeMultiChoiceStats ──────────────────────────────────────────────────
test('MC-01 counts + percentages', () => {
  const r = computeMultiChoiceStats([0, 0, 1, 2], 3);
  expect(r.counts).toEqual([2, 1, 1]);
  expect(r.percentages).toEqual([50, 25, 25]);
});
test('MC-02 invalid indices ignored', () => {
  const r = computeMultiChoiceStats([0, 5, -1, 1], 2);
  expect(r.counts).toEqual([1, 1]);
});

// ── suppressLowSample ────────────────────────────────────────────────────────
test('SUP-01 below minN suppresses', () => {
  const out = suppressLowSample({ total: 2 }, 3);
  expect(out.suppressed).toBe(true);
});
test('SUP-02 at minN returns original', () => {
  const orig = { total: 3, score: 50 };
  expect(suppressLowSample(orig, 3)).toBe(orig);
});

// ── buildSurveyDashboard ─────────────────────────────────────────────────────
test('DB-01 per-question stats', () => {
  const questions = [
    { id: 'q1', type: 'LIKERT_5', text: 'Engaged?', required: true },
    { id: 'q2', type: 'NPS',      text: 'Recommend?', required: true },
  ];
  const responses = [
    { id: 'r1', respondentDepartment: 'Eng', answers: [
      { questionId: 'q1', numericValue: 5 },
      { questionId: 'q2', numericValue: 9 },
    ]},
    { id: 'r2', respondentDepartment: 'Eng', answers: [
      { questionId: 'q1', numericValue: 4 },
      { questionId: 'q2', numericValue: 8 },
    ]},
    { id: 'r3', respondentDepartment: 'Sales', answers: [
      { questionId: 'q1', numericValue: 3 },
      { questionId: 'q2', numericValue: 6 },
    ]},
  ];
  const survey = { id: 's1', minResponsesToShow: 3 };
  const d = buildSurveyDashboard(survey, questions, responses);
  expect(d.totalResponses).toBe(3);
  const q1stats = d.perQuestion[0].stats;
  expect(q1stats.average).toBe(4);
  const q2stats = d.perQuestion[1].stats;
  // 1 promoter (9), 1 passive (8), 1 detractor (6) → 0%
  expect(q2stats.score).toBe(0);
});
test('DB-02 segments below minN are filtered', () => {
  const questions = [{ id: 'q1', type: 'LIKERT_5', text: 'x' }];
  const responses = [
    { id: 'r1', respondentDepartment: 'Eng',   answers: [{ questionId: 'q1', numericValue: 5 }] },
    { id: 'r2', respondentDepartment: 'Eng',   answers: [{ questionId: 'q1', numericValue: 4 }] },
    { id: 'r3', respondentDepartment: 'Eng',   answers: [{ questionId: 'q1', numericValue: 4 }] },
    { id: 'r4', respondentDepartment: 'Sales', answers: [{ questionId: 'q1', numericValue: 5 }] },
  ];
  const d = buildSurveyDashboard({ id: 's1', minResponsesToShow: 3 }, questions, responses);
  expect(d.segments.byDepartment.Eng).toBe(3);
  expect(d.segments.byDepartment.Sales).toBeUndefined(); // suppressed (1 < 3)
});
test('DB-03 text comments suppressed below minN', () => {
  const questions = [{ id: 'q1', type: 'TEXT', text: 'Comments?' }];
  const responses = [
    { id: 'r1', answers: [{ questionId: 'q1', textValue: 'great' }] },
    { id: 'r2', answers: [{ questionId: 'q1', textValue: 'good' }] },
  ];
  const d = buildSurveyDashboard({ id: 's1', minResponsesToShow: 3 }, questions, responses);
  expect(d.perQuestion[0].stats.suppressed).toBe(true);
});

// ── validateAnswers ──────────────────────────────────────────────────────────
test('VA-01 required missing → invalid', () => {
  const questions = [{ id: 'q1', type: 'LIKERT_5', text: 'x', required: true }];
  const r = validateAnswers(questions, []);
  expect(r.valid).toBe(false);
});
test('VA-02 Likert out-of-range → invalid', () => {
  const questions = [{ id: 'q1', type: 'LIKERT_5', text: 'x', required: true }];
  const r = validateAnswers(questions, [{ questionId: 'q1', numericValue: 7 }]);
  expect(r.valid).toBe(false);
});
test('VA-03 NPS out-of-range → invalid', () => {
  const questions = [{ id: 'q1', type: 'NPS', text: 'x', required: true }];
  const r = validateAnswers(questions, [{ questionId: 'q1', numericValue: 12 }]);
  expect(r.valid).toBe(false);
});
test('VA-04 valid input → valid', () => {
  const questions = [
    { id: 'q1', type: 'LIKERT_5', text: 'x', required: true },
    { id: 'q2', type: 'NPS', text: 'y', required: true },
  ];
  const r = validateAnswers(questions, [
    { questionId: 'q1', numericValue: 4 },
    { questionId: 'q2', numericValue: 9 },
  ]);
  expect(r.valid).toBe(true);
});
