'use strict';
/**
 * Survey Engine — pure functions, no Prisma/IO.
 *
 * Domain rules:
 *  • eNPS (employee Net Promoter Score) — recommend likelihood 0-10:
 *      Promoters  = score 9-10
 *      Passives   = score 7-8
 *      Detractors = score 0-6
 *      eNPS = %promoters − %detractors (range −100 to +100)
 *  • Low-sample suppression: if responses < minResponsesToShow, aggregates
 *    for that segment are returned as null (protects anonymity).
 *  • Likert 5 default labels: 1=Strongly Disagree … 5=Strongly Agree.
 */

const SURVEY_TYPES   = ['ANNUAL','PULSE','EXIT','CUSTOM'];
const SURVEY_STATUSES = ['DRAFT','ACTIVE','CLOSED'];
const QUESTION_TYPES = ['LIKERT_5','NPS','TEXT','MULTI_CHOICE'];
const ACTION_STATUSES = ['OPEN','IN_PROGRESS','DONE','DISMISSED'];

const DEFAULT_LIKERT_LABELS = [
  'Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree',
];

/**
 * computeENPS — given numeric NPS scores (0-10), compute eNPS index.
 *
 * @param {Array<Number>} scores
 * @returns {{score:Number, promoters:Number, passives:Number, detractors:Number, total:Number}}
 */
function computeENPS(scores) {
  const list = (Array.isArray(scores) ? scores : []).filter(s => typeof s === 'number' && s >= 0 && s <= 10);
  const total = list.length;
  if (total === 0) return { score: 0, promoters: 0, passives: 0, detractors: 0, total: 0 };
  let p = 0, ps = 0, d = 0;
  for (const s of list) {
    if (s >= 9) p += 1;
    else if (s >= 7) ps += 1;
    else d += 1;
  }
  const score = Math.round((p / total - d / total) * 100);
  return { score, promoters: p, passives: ps, detractors: d, total };
}

/**
 * computeLikertStats — average score and per-rung distribution.
 *
 * @param {Array<Number>} scores — 1..5
 * @returns {{average:Number, total:Number, distribution:{1:Number,2:Number,3:Number,4:Number,5:Number}, positivePct:Number}}
 *   positivePct = % of scores ≥ 4
 */
function computeLikertStats(scores) {
  const list = (Array.isArray(scores) ? scores : []).filter(s => typeof s === 'number' && s >= 1 && s <= 5);
  const total = list.length;
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  if (total === 0) return { average: 0, total: 0, distribution: dist, positivePct: 0 };
  let sum = 0, positive = 0;
  for (const s of list) {
    const k = Math.round(s);
    dist[k] = (dist[k] || 0) + 1;
    sum += s;
    if (s >= 4) positive += 1;
  }
  return {
    average: round2(sum / total),
    total,
    distribution: dist,
    positivePct: Math.round((positive / total) * 100),
  };
}

/**
 * computeMultiChoiceStats — vote counts per option index.
 *
 * @param {Array<Number>} indices — selected option index per response
 * @param {Number} numChoices
 * @returns {{total:Number, counts:Array<Number>, percentages:Array<Number>}}
 */
function computeMultiChoiceStats(indices, numChoices) {
  const list = Array.isArray(indices) ? indices : [];
  const total = list.length;
  const counts = new Array(numChoices).fill(0);
  for (const i of list) {
    const k = parseInt(i);
    if (!isNaN(k) && k >= 0 && k < numChoices) counts[k] += 1;
  }
  const percentages = counts.map(c => total === 0 ? 0 : Math.round((c / total) * 100));
  return { total, counts, percentages };
}

/**
 * aggregateBySegment — group responses by a field (department/tenure bucket) and compute size.
 *
 * @param {Array} responses — each with respondentDepartment, respondentTenureMonths
 * @param {String} segment   — 'department' | 'tenure' | 'employmentType'
 * @returns {Object} { [segmentKey]: Number }
 */
function aggregateBySegment(responses, segment = 'department') {
  const list = Array.isArray(responses) ? responses : [];
  const buckets = {};
  for (const r of list) {
    let key;
    if (segment === 'department') key = r.respondentDepartment || 'Unknown';
    else if (segment === 'tenure') {
      const m = r.respondentTenureMonths || 0;
      if (m < 12) key = '<1y';
      else if (m < 36) key = '1-3y';
      else if (m < 60) key = '3-5y';
      else key = '5y+';
    } else if (segment === 'employmentType') key = r.respondentEmploymentType || 'Unknown';
    else key = 'All';
    buckets[key] = (buckets[key] || 0) + 1;
  }
  return buckets;
}

/**
 * suppressLowSample — wipe aggregates when sample size < threshold.
 *
 * @param {Object} aggregate — any stats object with .total
 * @param {Number} minN
 * @returns {Object} — original object OR a "suppressed" marker
 */
function suppressLowSample(aggregate, minN = 3) {
  if (!aggregate || typeof aggregate.total !== 'number') return aggregate;
  if (aggregate.total < minN) {
    return { suppressed: true, total: aggregate.total, reason: `Only ${aggregate.total} responses (min ${minN})` };
  }
  return aggregate;
}

/**
 * buildSurveyDashboard — full aggregate for a survey, with per-question stats and per-segment counts.
 *
 * @param {Object} survey      — { id, minResponsesToShow, ... }
 * @param {Array}  questions   — survey questions
 * @param {Array}  responses   — { id, respondentDepartment, ... , answers: [{questionId, numericValue, textValue}] }
 * @returns {Object} dashboard with overall + per-question + segments
 */
function buildSurveyDashboard(survey, questions, responses) {
  const list = Array.isArray(responses) ? responses : [];
  const minN = survey?.minResponsesToShow ?? 3;

  const perQuestion = (questions || []).map(q => {
    const answers = list.flatMap(r => (r.answers || []).filter(a => a.questionId === q.id));
    if (q.type === 'LIKERT_5') {
      const stats = computeLikertStats(answers.map(a => a.numericValue));
      return { questionId: q.id, type: q.type, text: q.text, stats: suppressLowSample(stats, minN) };
    }
    if (q.type === 'NPS') {
      const enps = computeENPS(answers.map(a => a.numericValue));
      return { questionId: q.id, type: q.type, text: q.text, stats: suppressLowSample(enps, minN) };
    }
    if (q.type === 'MULTI_CHOICE') {
      const mc = computeMultiChoiceStats(answers.map(a => a.numericValue), (q.choices || []).length);
      return { questionId: q.id, type: q.type, text: q.text, choices: q.choices, stats: suppressLowSample(mc, minN) };
    }
    // TEXT — return raw comments only if anonymous-OK and we have enough; suppress otherwise
    const comments = answers.map(a => a.textValue).filter(Boolean);
    return {
      questionId: q.id, type: q.type, text: q.text,
      stats: comments.length >= minN
        ? { total: comments.length, comments }
        : { suppressed: true, total: comments.length, reason: `Only ${comments.length} comments (min ${minN})` },
    };
  });

  const byDept = aggregateBySegment(list, 'department');
  const byTenure = aggregateBySegment(list, 'tenure');
  const byEmpType = aggregateBySegment(list, 'employmentType');

  // Apply suppression on segment counts as well — only show buckets with ≥ minN
  const filterMap = (m) => Object.fromEntries(Object.entries(m).filter(([_, n]) => n >= minN));

  return {
    surveyId: survey?.id,
    totalResponses: list.length,
    minN,
    suppressed: list.length < minN,
    perQuestion,
    segments: {
      byDepartment: filterMap(byDept),
      byTenure:     filterMap(byTenure),
      byEmploymentType: filterMap(byEmpType),
    },
    rawSegmentCounts: { byDepartment: byDept, byTenure: byTenure, byEmploymentType: byEmpType },
  };
}

/**
 * validateAnswers — given questions and a submitted set of answers, check required + type-correctness.
 *
 * @param {Array} questions
 * @param {Array} answers — [{ questionId, numericValue?, textValue? }]
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateAnswers(questions, answers) {
  const errors = [];
  const byQid = new Map((Array.isArray(answers) ? answers : []).map(a => [a.questionId, a]));
  for (const q of (questions || [])) {
    const a = byQid.get(q.id);
    if (q.required && !a) {
      errors.push(`Missing required answer for question "${q.text}"`);
      continue;
    }
    if (!a) continue;
    if (q.type === 'LIKERT_5') {
      const v = Number(a.numericValue);
      if (isNaN(v) || v < 1 || v > 5) errors.push(`Likert answer must be 1-5 (${q.text})`);
    } else if (q.type === 'NPS') {
      const v = Number(a.numericValue);
      if (isNaN(v) || v < 0 || v > 10) errors.push(`NPS answer must be 0-10 (${q.text})`);
    } else if (q.type === 'MULTI_CHOICE') {
      const v = Number(a.numericValue);
      const max = (q.choices || []).length - 1;
      if (isNaN(v) || v < 0 || v > max) errors.push(`Choice index out of range (${q.text})`);
    } else if (q.type === 'TEXT') {
      if (q.required && (!a.textValue || !String(a.textValue).trim())) {
        errors.push(`Comment required for "${q.text}"`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

module.exports = {
  SURVEY_TYPES, SURVEY_STATUSES, QUESTION_TYPES, ACTION_STATUSES,
  DEFAULT_LIKERT_LABELS,
  computeENPS,
  computeLikertStats,
  computeMultiChoiceStats,
  aggregateBySegment,
  suppressLowSample,
  buildSurveyDashboard,
  validateAnswers,
};
