'use strict';

const MIN_RESPONDENTS_FOR_COMMENTS = 3;

/**
 * Compute a weighted average 360 score from submitted feedback.
 * Only RATING-type questions contribute to the numeric score.
 * Returns null if no rating data is available.
 *
 * @param {Array} questions  [{id, questionType, weight}]
 * @param {Array<Array>} responseSets  one array of FeedbackResponse per submitted request
 */
function compute360Score(questions, responseSets) {
  const ratingQs = questions.filter(q => q.questionType === 'RATING');
  if (!ratingQs.length || !responseSets.length) return null;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const q of ratingQs) {
    const ratings = responseSets
      .map(rs => (rs || []).find(r => r.questionId === q.id))
      .filter(r => r && r.ratingValue != null)
      .map(r => Number(r.ratingValue));

    if (!ratings.length) continue;
    const avg = ratings.reduce((s, v) => s + v, 0) / ratings.length;
    weightedSum += avg * (q.weight || 1);
    totalWeight += (q.weight || 1);
  }

  return totalWeight > 0 ? round2(weightedSum / totalWeight) : null;
}

/**
 * Blend the existing appraisal score with the 360 score.
 * feedbackWeight is 0..1 (e.g., 0.3 means 30% from 360, 70% from appraisal).
 */
function blendScores(appraisalScore, score360, feedbackWeight) {
  if (score360 == null || !feedbackWeight || feedbackWeight <= 0) return appraisalScore;
  const w = Math.min(1, Math.max(0, feedbackWeight));
  return round2((1 - w) * appraisalScore + w * score360);
}

/**
 * Build an anonymised aggregate report for one subject employee.
 * Text comments are only surfaced when respondentCount >= MIN_RESPONDENTS_FOR_COMMENTS
 * to prevent identity inference when few people responded.
 *
 * @param {Array}  questions       FeedbackQuestion rows for the cycle
 * @param {Array}  requests        FeedbackRequest rows (with .responses populated) for the subject
 * @param {number} minRespondents  override anonymity threshold (default 3)
 */
function buildReport(questions, requests, minRespondents) {
  const threshold = minRespondents != null ? minRespondents : MIN_RESPONDENTS_FOR_COMMENTS;
  const submitted = requests.filter(r => r.status === 'SUBMITTED');
  const respondentCount = submitted.length;
  const revealComments = respondentCount >= threshold;

  const byType = {};
  for (const req of submitted) {
    const t = req.reviewerType;
    byType[t] = (byType[t] || 0) + 1;
  }

  const questionStats = questions.map(q => {
    const allResponses = submitted.flatMap(r => r.responses || []).filter(r => r.questionId === q.id);
    const ratings = allResponses.filter(r => r.ratingValue != null).map(r => Number(r.ratingValue));
    const texts   = allResponses.filter(r => r.textValue).map(r => r.textValue);

    return {
      questionId:   q.id,
      questionText: q.questionText,
      questionType: q.questionType,
      category:     q.category || null,
      weight:       q.weight,
      displayOrder: q.displayOrder,
      respondentCount: ratings.length || texts.length,
      avgRating:    ratings.length ? round2(ratings.reduce((s, v) => s + v, 0) / ratings.length) : null,
      minRating:    ratings.length ? Math.min(...ratings) : null,
      maxRating:    ratings.length ? Math.max(...ratings) : null,
      textComments: revealComments ? texts : [],
    };
  });

  const ratingQs = questions.filter(q => q.questionType === 'RATING');
  const overallScore = compute360Score(
    ratingQs,
    submitted.map(r => r.responses || []),
  );

  return {
    respondentCount,
    revealComments,
    respondentsByType: byType,
    overallScore,
    questionStats,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = {
  MIN_RESPONDENTS_FOR_COMMENTS,
  compute360Score,
  blendScores,
  buildReport,
  round2,
};
