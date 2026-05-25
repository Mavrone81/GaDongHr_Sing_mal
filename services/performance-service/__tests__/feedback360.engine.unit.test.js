'use strict';

const {
  MIN_RESPONDENTS_FOR_COMMENTS,
  compute360Score,
  blendScores,
  buildReport,
  round2,
} = require('../src/engines/feedback360.engine');

// ─── compute360Score ──────────────────────────────────────────────────────────

describe('compute360Score', () => {
  const ratingQs = [
    { id: 'q1', questionType: 'RATING', weight: 1.0 },
    { id: 'q2', questionType: 'RATING', weight: 2.0 },
  ];
  const textQs = [
    { id: 'qt', questionType: 'TEXT', weight: 1.0 },
  ];

  test('E1 — returns null when no questions', () => {
    expect(compute360Score([], [[{ questionId: 'q1', ratingValue: 4 }]])).toBeNull();
  });

  test('E2 — returns null when no response sets', () => {
    expect(compute360Score(ratingQs, [])).toBeNull();
  });

  test('E3 — returns null when only TEXT questions', () => {
    expect(compute360Score(textQs, [[{ questionId: 'qt', textValue: 'good' }]])).toBeNull();
  });

  test('E4 — single respondent single question', () => {
    const score = compute360Score(
      [{ id: 'q1', questionType: 'RATING', weight: 1 }],
      [[{ questionId: 'q1', ratingValue: 4 }]],
    );
    expect(score).toBe(4);
  });

  test('E5 — simple unweighted average across respondents', () => {
    const qs = [{ id: 'q1', questionType: 'RATING', weight: 1 }];
    const sets = [
      [{ questionId: 'q1', ratingValue: 3 }],
      [{ questionId: 'q1', ratingValue: 5 }],
    ];
    expect(compute360Score(qs, sets)).toBe(4);
  });

  test('E6 — weighted average (q2 has weight 2)', () => {
    // q1 avg=4, q2 avg=2 → (4×1 + 2×2)/3 = 8/3 = 2.67
    const sets = [
      [{ questionId: 'q1', ratingValue: 4 }, { questionId: 'q2', ratingValue: 2 }],
    ];
    const score = compute360Score(ratingQs, sets);
    expect(score).toBe(2.67);
  });

  test('E7 — TEXT responses ignored in score computation', () => {
    const qs = [
      { id: 'q1', questionType: 'RATING', weight: 1 },
      { id: 'qt', questionType: 'TEXT', weight: 1 },
    ];
    const sets = [[{ questionId: 'q1', ratingValue: 3 }, { questionId: 'qt', textValue: 'ok' }]];
    expect(compute360Score(qs, sets)).toBe(3);
  });

  test('E8 — questions with no responses are skipped', () => {
    // Only q1 answered; q2 has no response → score = q1 avg only
    const sets = [[{ questionId: 'q1', ratingValue: 4 }]];
    const score = compute360Score(ratingQs, sets);
    expect(score).toBe(4);
  });

  test('E9 — null ratingValue entries are excluded', () => {
    const qs = [{ id: 'q1', questionType: 'RATING', weight: 1 }];
    const sets = [
      [{ questionId: 'q1', ratingValue: null }],
      [{ questionId: 'q1', ratingValue: 4 }],
    ];
    expect(compute360Score(qs, sets)).toBe(4);
  });

  test('E10 — default weight 1 when weight missing', () => {
    const qs = [{ id: 'q1', questionType: 'RATING' }];
    const sets = [[{ questionId: 'q1', ratingValue: 3.5 }]];
    expect(compute360Score(qs, sets)).toBe(3.5);
  });
});

// ─── blendScores ─────────────────────────────────────────────────────────────

describe('blendScores', () => {
  test('B1 — returns appraisal score when score360 is null', () => {
    expect(blendScores(4.0, null, 0.3)).toBe(4.0);
  });

  test('B2 — returns appraisal score when feedbackWeight is 0', () => {
    expect(blendScores(4.0, 3.0, 0)).toBe(4.0);
  });

  test('B3 — 30% 360 + 70% appraisal', () => {
    // 0.7×4 + 0.3×3 = 2.8 + 0.9 = 3.7
    expect(blendScores(4.0, 3.0, 0.3)).toBe(3.7);
  });

  test('B4 — 100% 360 weight returns score360', () => {
    expect(blendScores(4.0, 3.0, 1.0)).toBe(3.0);
  });

  test('B5 — clamps weight above 1 to 1', () => {
    expect(blendScores(4.0, 3.0, 1.5)).toBe(3.0);
  });

  test('B6 — clamps weight below 0 to 0', () => {
    expect(blendScores(4.0, 3.0, -0.5)).toBe(4.0);
  });

  test('B7 — result rounded to 2 decimal places', () => {
    // 0.7×3.333 + 0.3×4.667 = 2.3331 + 1.4001 = 3.7332 → 3.73
    expect(blendScores(3.333, 4.667, 0.3)).toBe(3.73);
  });
});

// ─── buildReport ─────────────────────────────────────────────────────────────

describe('buildReport', () => {
  const questions = [
    { id: 'q1', questionText: 'Leadership', questionType: 'RATING', category: 'Leadership', weight: 1, displayOrder: 0 },
    { id: 'q2', questionText: 'Collaboration', questionType: 'RATING', category: 'Teamwork', weight: 1, displayOrder: 1 },
    { id: 'qt', questionText: 'Strengths', questionType: 'TEXT', category: null, weight: 1, displayOrder: 2 },
  ];

  function makeRequest(id, reviewerType, status, responseData) {
    return {
      id,
      reviewerType,
      status,
      responses: responseData,
    };
  }

  test('R1 — respondentCount is count of SUBMITTED requests', () => {
    const reqs = [
      makeRequest('r1', 'PEER', 'SUBMITTED', []),
      makeRequest('r2', 'PEER', 'APPROVED', []),
    ];
    const report = buildReport(questions, reqs);
    expect(report.respondentCount).toBe(1);
  });

  test('R2 — respondentsByType breakdown', () => {
    const reqs = [
      makeRequest('r1', 'PEER', 'SUBMITTED', []),
      makeRequest('r2', 'PEER', 'SUBMITTED', []),
      makeRequest('r3', 'SUPERVISOR', 'SUBMITTED', []),
    ];
    const report = buildReport(questions, reqs);
    expect(report.respondentsByType).toEqual({ PEER: 2, SUPERVISOR: 1 });
  });

  test('R3 — avgRating computed correctly', () => {
    const reqs = [
      makeRequest('r1', 'PEER', 'SUBMITTED', [
        { questionId: 'q1', ratingValue: 4 },
        { questionId: 'q2', ratingValue: 3 },
      ]),
      makeRequest('r2', 'PEER', 'SUBMITTED', [
        { questionId: 'q1', ratingValue: 2 },
        { questionId: 'q2', ratingValue: 5 },
      ]),
    ];
    const report = buildReport(questions, reqs);
    const q1stat = report.questionStats.find(q => q.questionId === 'q1');
    const q2stat = report.questionStats.find(q => q.questionId === 'q2');
    expect(q1stat.avgRating).toBe(3);
    expect(q2stat.avgRating).toBe(4);
  });

  test('R4 — minRating and maxRating', () => {
    const reqs = [
      makeRequest('r1', 'PEER', 'SUBMITTED', [{ questionId: 'q1', ratingValue: 2 }]),
      makeRequest('r2', 'PEER', 'SUBMITTED', [{ questionId: 'q1', ratingValue: 5 }]),
      makeRequest('r3', 'PEER', 'SUBMITTED', [{ questionId: 'q1', ratingValue: 3 }]),
    ];
    const report = buildReport(questions, reqs);
    const q1stat = report.questionStats.find(q => q.questionId === 'q1');
    expect(q1stat.minRating).toBe(2);
    expect(q1stat.maxRating).toBe(5);
  });

  test('R5 — text comments hidden when respondentCount < threshold', () => {
    const reqs = [
      makeRequest('r1', 'PEER', 'SUBMITTED', [
        { questionId: 'qt', textValue: 'great communicator' },
      ]),
      makeRequest('r2', 'PEER', 'SUBMITTED', [
        { questionId: 'qt', textValue: 'team player' },
      ]),
    ];
    // 2 respondents < default MIN_RESPONDENTS_FOR_COMMENTS=3
    const report = buildReport(questions, reqs);
    expect(report.revealComments).toBe(false);
    const qtstat = report.questionStats.find(q => q.questionId === 'qt');
    expect(qtstat.textComments).toEqual([]);
  });

  test('R6 — text comments revealed when respondentCount >= threshold', () => {
    const reqs = [
      makeRequest('r1', 'PEER', 'SUBMITTED', [{ questionId: 'qt', textValue: 'great' }]),
      makeRequest('r2', 'PEER', 'SUBMITTED', [{ questionId: 'qt', textValue: 'good' }]),
      makeRequest('r3', 'PEER', 'SUBMITTED', [{ questionId: 'qt', textValue: 'solid' }]),
    ];
    const report = buildReport(questions, reqs);
    expect(report.revealComments).toBe(true);
    const qtstat = report.questionStats.find(q => q.questionId === 'qt');
    expect(qtstat.textComments).toHaveLength(3);
  });

  test('R7 — overallScore computed from rating questions only', () => {
    const reqs = [
      makeRequest('r1', 'PEER', 'SUBMITTED', [
        { questionId: 'q1', ratingValue: 4 },
        { questionId: 'q2', ratingValue: 4 },
        { questionId: 'qt', textValue: 'ok' },
      ]),
    ];
    const report = buildReport(questions, reqs);
    expect(report.overallScore).toBe(4);
  });

  test('R8 — overallScore null when no rating responses', () => {
    const reqs = [
      makeRequest('r1', 'PEER', 'SUBMITTED', [{ questionId: 'qt', textValue: 'ok' }]),
    ];
    const report = buildReport(questions, reqs);
    expect(report.overallScore).toBeNull();
  });

  test('R9 — custom minRespondents threshold respected', () => {
    const reqs = [
      makeRequest('r1', 'PEER', 'SUBMITTED', [{ questionId: 'qt', textValue: 'x' }]),
    ];
    // threshold=1 → should reveal
    const report = buildReport(questions, reqs, 1);
    expect(report.revealComments).toBe(true);
  });

  test('R10 — non-SUBMITTED requests excluded from report', () => {
    const reqs = [
      makeRequest('r1', 'PEER', 'APPROVED', [{ questionId: 'q1', ratingValue: 5 }]),
      makeRequest('r2', 'PEER', 'PENDING_APPROVAL', [{ questionId: 'q1', ratingValue: 1 }]),
    ];
    const report = buildReport(questions, reqs);
    expect(report.respondentCount).toBe(0);
    const q1stat = report.questionStats.find(q => q.questionId === 'q1');
    expect(q1stat.avgRating).toBeNull();
  });

  test('R11 — MIN_RESPONDENTS_FOR_COMMENTS exported constant is 3', () => {
    expect(MIN_RESPONDENTS_FOR_COMMENTS).toBe(3);
  });
});
