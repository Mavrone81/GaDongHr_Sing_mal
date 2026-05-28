'use strict';
/**
 * E-Signature Engine — ESV-003
 *
 * All pure functions — no Prisma, no side effects.
 * Document hashing uses SHA-256 for tamper evidence.
 * 7-year retention requirement per EA s.95A / PDPA record-keeping.
 */

const crypto = require('crypto');

/**
 * HTML-escape a string so it is safe to interpolate into HTML text content
 * or unquoted attribute contexts. The substituted values come from request
 * bodies authored by HR users and are later rendered to the signatory's
 * browser via dangerouslySetInnerHTML in the signing page — so any unescaped
 * value is a stored XSS sink.
 */
function htmlEscape(input) {
  if (input === null || input === undefined) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replace {{key}} placeholders in templateHtml with HTML-escaped values from
 * variables map. Unmatched placeholders are left as-is.
 *
 * The templateHtml itself is HR-authored and is rendered raw — escape ONLY
 * the substituted variable values, which are the user-controlled inputs.
 */
function fillTemplate(templateHtml, variables) {
  return templateHtml.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key)
      ? htmlEscape(variables[key])
      : match;
  });
}

/**
 * SHA-256 hex digest of content string. Used to detect tampering of
 * the template at dispatch time and the personalised copy at sign time.
 */
function computeDocumentHash(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Extract placeholder keys from a template: e.g. {{name}} → ['name'].
 */
function extractPlaceholders(templateHtml) {
  const matches = templateHtml.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

/**
 * Validate that all required placeholders in templateHtml have values.
 * Returns { valid: true } or { valid: false, missing: string[] }.
 */
function validatePlaceholders(templateHtml, variables) {
  const keys    = extractPlaceholders(templateHtml);
  const missing = keys.filter(k => !Object.prototype.hasOwnProperty.call(variables, k));
  return missing.length ? { valid: false, missing } : { valid: true };
}

/**
 * True when a sign request's dueDate has passed.
 */
function isExpired(dueDate, now = new Date()) {
  if (!dueDate) return false;
  return new Date(dueDate).getTime() < new Date(now).getTime();
}

/**
 * Build a compliance summary across a list of ESignRequests.
 * complianceRate = signed / (signed + pending + declined) — excludes expired/revoked.
 */
function buildSigningSummary(requests) {
  const counts = { total: requests.length, pending: 0, signed: 0, declined: 0, expired: 0, revoked: 0 };
  for (const r of requests) {
    const s = r.status.toLowerCase();
    if (counts[s] !== undefined) counts[s]++;
  }
  const denominator = counts.signed + counts.pending + counts.declined;
  const complianceRate = denominator > 0 ? Math.round((counts.signed / denominator) * 100) : 0;
  return { ...counts, complianceRate };
}

/**
 * Build the standard signature statement text stored with the signed record.
 */
function buildSignatureStatement(signatoryName, documentTitle) {
  const dateStr = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' });
  return `I, ${signatoryName}, acknowledge that I have read and agree to the terms of "${documentTitle}" as of ${dateStr}.`;
}

module.exports = {
  fillTemplate,
  htmlEscape,
  computeDocumentHash,
  extractPlaceholders,
  validatePlaceholders,
  isExpired,
  buildSigningSummary,
  buildSignatureStatement,
};
