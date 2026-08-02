'use strict';
/**
 * Staff Movement Engine — pure functions, no Prisma/IO.
 *
 * Domain rules:
 *  • A movement must change at least ONE field (no-op rejected).
 *  • Effective date can be future (scheduled) or today; daily sweep applies them.
 *  • Role changes / promotions can carry an optional salary revision.
 *  • Inter-company transfers require additional approval (HR_MANAGER+).
 *  • Promotion + > 30% salary jump also requires HR_MANAGER approval.
 */

const MOVEMENT_TYPES = [
  'DEPARTMENT_TRANSFER',
  'LOCATION_TRANSFER',
  'INTER_COMPANY_TRANSFER',
  'ROLE_CHANGE',
  'PROMOTION',
  'REPORTING_CHANGE',
  'COST_CENTRE_REALLOC',
];

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'APPLIED'];

const SALARY_REASON_CODES = ['PROMOTION', 'ROLE_CHANGE', 'MARKET_ADJUSTMENT', 'OTHER'];

const APPROVAL_THRESHOLDS = {
  largeSalaryJumpPct: 30, // > 30% increase requires HR_MANAGER+
};

/**
 * validateTransfer — minimum diff check + type sanity.
 *
 * @param {Object} from — current employee state (department/designation/etc.)
 * @param {Object} to   — proposed new state
 * @param {string} type — MovementType
 * @returns {{valid: boolean, reasons: string[], changedFields: string[]}}
 */
function validateTransfer(from, to, type) {
  const reasons = [];
  if (!MOVEMENT_TYPES.includes(type)) reasons.push(`Invalid type: ${type}`);

  const changedFields = [];
  const fields = ['department','designation','costCentre','location','reportingManagerId','company','employmentType'];
  for (const f of fields) {
    const a = (from?.[f] ?? '').toString().trim();
    const b = (to?.[f]   ?? '').toString().trim();
    if (a !== b) changedFields.push(f);
  }
  if (changedFields.length === 0) reasons.push('No fields changed — movement is a no-op');

  // Type-specific checks
  if (type === 'DEPARTMENT_TRANSFER' && !changedFields.includes('department'))
    reasons.push('DEPARTMENT_TRANSFER requires department to change');
  if (type === 'LOCATION_TRANSFER' && !changedFields.includes('location'))
    reasons.push('LOCATION_TRANSFER requires location to change');
  if (type === 'INTER_COMPANY_TRANSFER' && !changedFields.includes('company'))
    reasons.push('INTER_COMPANY_TRANSFER requires company to change');
  if ((type === 'ROLE_CHANGE' || type === 'PROMOTION') && !changedFields.includes('designation'))
    reasons.push(`${type} requires designation to change`);
  if (type === 'REPORTING_CHANGE' && !changedFields.includes('reportingManagerId'))
    reasons.push('REPORTING_CHANGE requires reportingManagerId to change');
  if (type === 'COST_CENTRE_REALLOC' && !changedFields.includes('costCentre'))
    reasons.push('COST_CENTRE_REALLOC requires costCentre to change');

  return { valid: reasons.length === 0, reasons, changedFields };
}

/**
 * computeSalaryDelta — returns absolute and percentage change.
 *
 * @param {Number} fromSalary
 * @param {Number} toSalary
 * @returns {{deltaAmount: Number, deltaPct: Number, direction: 'INCREASE'|'DECREASE'|'NONE'}}
 */
function computeSalaryDelta(fromSalary, toSalary) {
  const a = Number(fromSalary || 0);
  const b = Number(toSalary || 0);
  const delta = b - a;
  const pct = a === 0 ? (b > 0 ? 100 : 0) : (delta / a) * 100;
  const direction = delta > 0 ? 'INCREASE' : delta < 0 ? 'DECREASE' : 'NONE';
  return {
    deltaAmount: round2(delta),
    deltaPct: round2(pct),
    direction,
  };
}

/**
 * isEffectiveToday — true if effectiveDate falls on or before today (UTC date compare).
 *
 * @param {Date|string} effectiveDate
 * @param {Date}        now
 * @returns {boolean}
 */
function isEffectiveToday(effectiveDate, now = new Date()) {
  if (!effectiveDate) return false;
  const eff = new Date(effectiveDate);
  if (isNaN(eff.getTime())) return false;
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const effUTC   = Date.UTC(eff.getUTCFullYear(), eff.getUTCMonth(), eff.getUTCDate());
  return effUTC <= todayUTC;
}

/**
 * buildMovementSummary — counts by status/type, count effective-today (pending application).
 *
 * @param {Array} movements
 * @param {Date}  now
 * @returns {Object}
 */
function buildMovementSummary(movements, now = new Date()) {
  const list = Array.isArray(movements) ? movements : [];
  const summary = {
    total: list.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
    applied: 0,
    byType: {},
    byStatus: {},
    effectiveToday: 0, // APPROVED + effective ≤ today not yet APPLIED
    upcoming30d: 0,    // APPROVED scheduled within next 30 days
  };
  const in30d = new Date(now.getTime() + 30 * 86_400_000);
  for (const m of list) {
    summary.byType[m.type]     = (summary.byType[m.type] || 0) + 1;
    summary.byStatus[m.status] = (summary.byStatus[m.status] || 0) + 1;
    if (m.status === 'PENDING')   summary.pending  += 1;
    if (m.status === 'APPROVED')  summary.approved += 1;
    if (m.status === 'REJECTED')  summary.rejected += 1;
    if (m.status === 'CANCELLED') summary.cancelled+= 1;
    if (m.status === 'APPLIED')   summary.applied  += 1;
    if (m.status === 'APPROVED' && isEffectiveToday(m.effectiveDate, now)) summary.effectiveToday += 1;
    if (m.status === 'APPROVED' && new Date(m.effectiveDate) > now && new Date(m.effectiveDate) <= in30d) summary.upcoming30d += 1;
  }
  return summary;
}

/**
 * suggestLetterText — generates HTML transfer-letter content from movement data.
 *
 * @param {Object} m — movement with employeeName, type, fromDepartment, toDepartment, etc.
 * @returns {string} HTML
 */
// SECURITY (H-01): escape every user-controlled value before interpolating into
// the transfer-letter HTML, which is later rendered to HR colleagues via
// dangerouslySetInnerHTML on the movement-detail page.
function escapeHtml(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function suggestLetterText(m) {
  if (!m) return '';
  // timeZone: 'UTC' is required, not cosmetic. effectiveDate is a date-only
  // business value stored UTC-anchored; without it toLocaleDateString formats
  // in the SERVER's zone and renders the previous day west of UTC — a transfer
  // letter stating the wrong effective date. Matches formatCivil in
  // frontend/src/lib/timezone.ts, which formats with timeZone:'UTC' for the
  // same reason.
  const eff = m.effectiveDate ? new Date(m.effectiveDate).toLocaleDateString('en-SG', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  const todayStr = new Date().toLocaleDateString('en-SG', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
  const typeLabel = escapeHtml((m.type || '').replace(/_/g, ' ').toLowerCase());
  const employeeName = escapeHtml(m.employeeName || 'Colleague');
  const reason = escapeHtml((m.reason || '').trim());
  const fromDept = escapeHtml(m.fromDepartment), toDept = escapeHtml(m.toDepartment);
  const fromDesg = escapeHtml(m.fromDesignation), toDesg = escapeHtml(m.toDesignation);
  const fromCC = escapeHtml(m.fromCostCentre || '—'), toCC = escapeHtml(m.toCostCentre || '—');
  const fromLoc = escapeHtml(m.fromLocation || '—'), toLoc = escapeHtml(m.toLocation || '—');
  const fromCo = escapeHtml(m.fromCompany || '—'),  toCo = escapeHtml(m.toCompany || '—');

  const changes = [];
  if (m.fromDepartment   !== m.toDepartment)                 changes.push(`<li>Department: <strong>${fromDept}</strong> → <strong>${toDept}</strong></li>`);
  if (m.fromDesignation  !== m.toDesignation)                changes.push(`<li>Designation: <strong>${fromDesg}</strong> → <strong>${toDesg}</strong></li>`);
  if ((m.fromCostCentre || '') !== (m.toCostCentre || ''))   changes.push(`<li>Cost centre: <strong>${fromCC}</strong> → <strong>${toCC}</strong></li>`);
  if ((m.fromLocation   || '') !== (m.toLocation   || ''))   changes.push(`<li>Location: <strong>${fromLoc}</strong> → <strong>${toLoc}</strong></li>`);
  if ((m.fromCompany    || '') !== (m.toCompany    || ''))   changes.push(`<li>Company: <strong>${fromCo}</strong> → <strong>${toCo}</strong></li>`);
  return `
<div class="transfer-letter">
  <p><strong>${todayStr}</strong></p>
  <p>Dear ${employeeName},</p>
  <h3>Internal ${typeLabel}</h3>
  <p>We are pleased to confirm your ${typeLabel}, effective <strong>${eff}</strong>:</p>
  <ul>${changes.join('') || '<li>(no field-level changes recorded)</li>'}</ul>
  ${m.hasSalaryRevision ? '<p>This movement is accompanied by a salary revision. Your updated payslip will reflect the change from the effective date.</p>' : ''}
  <p>${reason}</p>
  <p>Please reach out to HR if you have any questions.</p>
  <p>Best regards,<br>Human Resources</p>
</div>`.trim();
}

/**
 * requiresAdditionalApproval — does this movement need HR_MANAGER+ sign-off?
 *
 * @param {Object} m — movement with type, hasSalaryRevision, fromSalary, toSalary
 * @returns {{required: boolean, reasons: string[]}}
 */
function requiresAdditionalApproval(m) {
  const reasons = [];
  if (m?.type === 'INTER_COMPANY_TRANSFER') reasons.push('Inter-company transfer requires HR_MANAGER approval');
  if (m?.hasSalaryRevision && m?.fromSalary !== undefined && m?.toSalary !== undefined) {
    const delta = computeSalaryDelta(m.fromSalary, m.toSalary);
    if (delta.direction === 'INCREASE' && delta.deltaPct > APPROVAL_THRESHOLDS.largeSalaryJumpPct) {
      reasons.push(`Salary increase ${delta.deltaPct}% exceeds ${APPROVAL_THRESHOLDS.largeSalaryJumpPct}% threshold`);
    }
    if (delta.direction === 'DECREASE') {
      reasons.push('Salary decrease requires HR_MANAGER approval');
    }
  }
  return { required: reasons.length > 0, reasons };
}

/**
 * nextMovementNumber — MOV-YYYY-NNNNN
 */
function nextMovementNumber(count, year) {
  const y = year || new Date().getFullYear();
  return `MOV-${y}-${String((count || 0) + 1).padStart(5, '0')}`;
}

function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

module.exports = {
  MOVEMENT_TYPES,
  STATUSES,
  SALARY_REASON_CODES,
  APPROVAL_THRESHOLDS,
  validateTransfer,
  computeSalaryDelta,
  isEffectiveToday,
  buildMovementSummary,
  suggestLetterText,
  escapeHtml,
  requiresAdditionalApproval,
  nextMovementNumber,
};
