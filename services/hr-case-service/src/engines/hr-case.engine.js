'use strict';
/**
 * HR Case Engine — pure functions, no Prisma/IO.
 *
 * Domain rules:
 *  • Progressive discipline (SG practice): VERBAL → WRITTEN → FINAL → TERMINATION.
 *    Gross misconduct can skip stages (MOM EA s.14(1) allows summary dismissal).
 *  • Escalation: cases unresolved past SLA escalate by level (HR_ADMIN → HR_MANAGER → DIRECTOR → BOARD).
 *  • TAFEP/MOM reporting: discrimination cases auto-flag for TAFEP referral.
 *  • Appeals: only allowed once a case is RESOLVED (decision rendered).
 */

const CASE_TYPES        = ['DISCIPLINARY', 'GRIEVANCE'];
const SEVERITIES        = ['MINOR', 'MODERATE', 'SERIOUS', 'GROSS_MISCONDUCT'];
const STATUSES          = ['OPEN', 'UNDER_INVESTIGATION', 'PENDING_DECISION', 'RESOLVED', 'CLOSED', 'WITHDRAWN'];
const STAGES            = ['INTAKE', 'INVESTIGATION', 'HEARING', 'DECISION', 'APPEAL', 'CLOSED'];
const ESCALATION_LEVELS = ['HR_ADMIN', 'HR_MANAGER', 'DIRECTOR', 'BOARD'];
const ACTION_TYPES      = [
  'VERBAL_WARNING','WRITTEN_WARNING','FINAL_WARNING','SHOW_CAUSE',
  'SUSPENSION','TRANSFER','DEMOTION','TERMINATION_FOR_CAUSE',
  'COUNSELLING','MEDIATION','TRAINING_ORDER','APOLOGY',
  'COMPENSATION','POLICY_CLARIFICATION','NO_ACTION',
];

// SLA in days by severity — escalation timer
const SLA_DAYS_BY_SEVERITY = {
  MINOR:            30,
  MODERATE:         14,
  SERIOUS:          7,
  GROSS_MISCONDUCT: 3,
};

// Categories that trigger TAFEP referral
const TAFEP_CATEGORIES = ['discrimination', 'harassment', 'workplace_bullying', 'unfair_dismissal'];

// Progressive discipline ladder
const PROGRESSIVE_LADDER = [
  'VERBAL_WARNING',
  'WRITTEN_WARNING',
  'FINAL_WARNING',
  'TERMINATION_FOR_CAUSE',
];

/**
 * nextCaseNumber — DSC-YYYY-NNNNN / GRV-YYYY-NNNNN
 *
 * @param {string} type   — 'DISCIPLINARY' | 'GRIEVANCE'
 * @param {number} count  — count of cases of this type for the year
 * @param {number} year   — calendar year
 */
function nextCaseNumber(type, count, year) {
  const prefix = type === 'DISCIPLINARY' ? 'DSC' : 'GRV';
  const y = year || new Date().getFullYear();
  const n = String((count || 0) + 1).padStart(5, '0');
  return `${prefix}-${y}-${n}`;
}

/**
 * progressiveDisciplineNext — next disciplinary action given prior history.
 *
 * @param {Array<string>}  priorActions — list of ActionType strings already issued
 * @param {string}         severity     — case severity
 * @returns {string}                    — next action type (a ladder rung)
 *
 * Gross misconduct: jumps straight to TERMINATION_FOR_CAUSE (EA s.14(1)).
 */
function progressiveDisciplineNext(priorActions, severity = 'MINOR') {
  if (severity === 'GROSS_MISCONDUCT') return 'TERMINATION_FOR_CAUSE';
  const prior = (priorActions || []).filter(a => PROGRESSIVE_LADDER.includes(a));
  if (prior.length === 0) return PROGRESSIVE_LADDER[0]; // VERBAL_WARNING

  // Find the highest rung already issued, then return the next one (clamped)
  let highestIdx = -1;
  for (const a of prior) {
    const idx = PROGRESSIVE_LADDER.indexOf(a);
    if (idx > highestIdx) highestIdx = idx;
  }
  const nextIdx = Math.min(highestIdx + 1, PROGRESSIVE_LADDER.length - 1);
  return PROGRESSIVE_LADDER[nextIdx];
}

/**
 * requiresEscalation — has the case sat too long at its current level?
 *
 * @param {Object} caseRecord — { openedAt, severity, escalationLevel, status }
 * @param {Date}   now        — reference date
 * @returns {{shouldEscalate: boolean, daysOpen: number, slaDays: number, nextLevel: string|null}}
 */
function requiresEscalation(caseRecord, now = new Date()) {
  if (!caseRecord || ['RESOLVED','CLOSED','WITHDRAWN'].includes(caseRecord.status)) {
    return { shouldEscalate: false, daysOpen: 0, slaDays: 0, nextLevel: null };
  }
  const opened = new Date(caseRecord.openedAt);
  const days   = Math.floor((now.getTime() - opened.getTime()) / 86_400_000);
  const sla    = SLA_DAYS_BY_SEVERITY[caseRecord.severity] || SLA_DAYS_BY_SEVERITY.MINOR;
  const currentLevelIdx = ESCALATION_LEVELS.indexOf(caseRecord.escalationLevel);
  const isAtTop = currentLevelIdx >= ESCALATION_LEVELS.length - 1;
  const nextLevel = isAtTop ? null : ESCALATION_LEVELS[currentLevelIdx + 1];
  return {
    shouldEscalate: days >= sla && !isAtTop,
    daysOpen: days,
    slaDays: sla,
    nextLevel,
  };
}

/**
 * computeMomReportable — is this case TAFEP/MOM-reportable?
 *
 * @param {Object} caseRecord — { category, type, severity }
 * @returns {boolean}
 */
function computeMomReportable(caseRecord) {
  if (!caseRecord) return false;
  const cat = (caseRecord.category || '').toLowerCase();
  if (TAFEP_CATEGORIES.includes(cat)) return true;
  // Gross misconduct grievance involving harassment is always reportable
  if (caseRecord.type === 'GRIEVANCE' && caseRecord.severity === 'GROSS_MISCONDUCT') return true;
  return false;
}

/**
 * buildCaseSummary — aggregate cases by type/status/severity.
 *
 * @param {Array} cases
 * @returns {Object}
 */
function buildCaseSummary(cases) {
  const list = Array.isArray(cases) ? cases : [];
  const summary = {
    total: list.length,
    open: 0,
    resolved: 0,
    closed: 0,
    byType: {},
    byStatus: {},
    bySeverity: {},
    byStage: {},
    momReportable: 0,
    overdueEscalation: 0,
  };
  const now = new Date();
  for (const c of list) {
    summary.byType[c.type]         = (summary.byType[c.type] || 0) + 1;
    summary.byStatus[c.status]     = (summary.byStatus[c.status] || 0) + 1;
    summary.bySeverity[c.severity] = (summary.bySeverity[c.severity] || 0) + 1;
    summary.byStage[c.currentStage]= (summary.byStage[c.currentStage] || 0) + 1;
    if (['OPEN','UNDER_INVESTIGATION','PENDING_DECISION'].includes(c.status)) summary.open += 1;
    if (c.status === 'RESOLVED') summary.resolved += 1;
    if (c.status === 'CLOSED') summary.closed += 1;
    if (computeMomReportable(c)) summary.momReportable += 1;
    if (requiresEscalation(c, now).shouldEscalate) summary.overdueEscalation += 1;
  }
  return summary;
}

/**
 * validateAppeal — can an appeal be filed on this case?
 *
 * @param {Object} caseRecord — { status, appeals }
 * @returns {{valid: boolean, reason: string|null}}
 */
function validateAppeal(caseRecord) {
  if (!caseRecord) return { valid: false, reason: 'Case not found' };
  if (caseRecord.status !== 'RESOLVED') {
    return { valid: false, reason: 'Appeals can only be filed on RESOLVED cases' };
  }
  // Block multiple pending appeals
  const pending = (caseRecord.appeals || []).find(a => a.status === 'PENDING');
  if (pending) return { valid: false, reason: 'A pending appeal already exists' };
  return { valid: true, reason: null };
}

/**
 * computeStageProgress — % complete through workflow (intake → closed).
 *
 * @param {Object} caseRecord — { currentStage }
 * @returns {{stage: string, percent: number, position: number, total: number}}
 */
function computeStageProgress(caseRecord) {
  const idx = STAGES.indexOf(caseRecord?.currentStage || 'INTAKE');
  const total = STAGES.length;
  const position = idx < 0 ? 0 : idx + 1;
  return {
    stage: caseRecord?.currentStage || 'INTAKE',
    position,
    total,
    percent: Math.round((position / total) * 100),
  };
}

/**
 * canIssueAction — gate certain actions to certain stages/severities.
 *
 * @param {Object} caseRecord — { severity, currentStage, status }
 * @param {string} actionType
 * @returns {{allowed: boolean, reason: string|null}}
 */
function canIssueAction(caseRecord, actionType) {
  if (!caseRecord) return { allowed: false, reason: 'Case not found' };
  if (!ACTION_TYPES.includes(actionType)) return { allowed: false, reason: 'Invalid action type' };
  if (['CLOSED','WITHDRAWN'].includes(caseRecord.status)) {
    return { allowed: false, reason: `Cannot issue actions on ${caseRecord.status} case` };
  }
  // Termination requires the case to have reached DECISION/HEARING stage or be GROSS_MISCONDUCT
  if (actionType === 'TERMINATION_FOR_CAUSE') {
    const okStage = ['HEARING','DECISION'].includes(caseRecord.currentStage);
    const okSeverity = caseRecord.severity === 'GROSS_MISCONDUCT';
    if (!okStage && !okSeverity) {
      return { allowed: false, reason: 'Termination requires hearing/decision stage or gross misconduct' };
    }
  }
  return { allowed: true, reason: null };
}

module.exports = {
  CASE_TYPES,
  SEVERITIES,
  STATUSES,
  STAGES,
  ESCALATION_LEVELS,
  ACTION_TYPES,
  SLA_DAYS_BY_SEVERITY,
  TAFEP_CATEGORIES,
  PROGRESSIVE_LADDER,
  nextCaseNumber,
  progressiveDisciplineNext,
  requiresEscalation,
  computeMomReportable,
  buildCaseSummary,
  validateAppeal,
  computeStageProgress,
  canIssueAction,
};
