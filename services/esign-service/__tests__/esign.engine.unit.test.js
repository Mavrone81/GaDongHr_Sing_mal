'use strict';
/**
 * Unit tests: E-Signature Engine (ESV-003)
 *
 * FT-01  fillTemplate — replaces all {{key}} placeholders
 * FT-02  fillTemplate — leaves unmatched placeholders intact
 * FT-03  fillTemplate — handles empty variables map
 * CH-01  computeDocumentHash — same content produces same hash
 * CH-02  computeDocumentHash — different content produces different hash
 * EP-01  extractPlaceholders — returns unique list of keys
 * EP-02  extractPlaceholders — returns empty array when no placeholders
 * VP-01  validatePlaceholders — all keys provided → valid true
 * VP-02  validatePlaceholders — missing keys → valid false with missing list
 * VP-03  validatePlaceholders — no placeholders → always valid
 * IE-01  isExpired — past dueDate → true
 * IE-02  isExpired — future dueDate → false
 * IE-03  isExpired — null dueDate → false (no expiry)
 * BS-01  buildSigningSummary — correct counts from mixed statuses
 * BS-02  buildSigningSummary — complianceRate is 100 when all signed
 * BS-03  buildSigningSummary — complianceRate is 0 when all pending
 * SS-01  buildSignatureStatement — contains signatory name and document title
 */

const {
  fillTemplate,
  computeDocumentHash,
  extractPlaceholders,
  validatePlaceholders,
  isExpired,
  buildSigningSummary,
  buildSignatureStatement,
} = require('../src/engines/esign.engine');

// ── fillTemplate ──────────────────────────────────────────────────────────────
test('FT-01 fillTemplate replaces all placeholders', () => {
  const tpl    = '<p>Dear {{name}}, your start date is {{start_date}}.</p>';
  const result = fillTemplate(tpl, { name: 'Alice Tan', start_date: '1 Jun 2026' });
  expect(result).toBe('<p>Dear Alice Tan, your start date is 1 Jun 2026.</p>');
});

test('FT-02 fillTemplate leaves unmatched placeholders intact', () => {
  const tpl    = '<p>Dear {{name}}, {{unresolved}} remains.</p>';
  const result = fillTemplate(tpl, { name: 'Bob' });
  expect(result).toContain('{{unresolved}}');
  expect(result).toContain('Bob');
});

test('FT-03 fillTemplate with empty variables returns template unchanged', () => {
  const tpl = '<p>Hello {{name}}</p>';
  expect(fillTemplate(tpl, {})).toBe(tpl);
});

// ── computeDocumentHash ───────────────────────────────────────────────────────
test('CH-01 computeDocumentHash same content → same hash', () => {
  const content = '<h1>Employment Contract</h1><p>Terms...</p>';
  expect(computeDocumentHash(content)).toBe(computeDocumentHash(content));
});

test('CH-02 computeDocumentHash different content → different hash', () => {
  expect(computeDocumentHash('Hello')).not.toBe(computeDocumentHash('World'));
});

// ── extractPlaceholders ───────────────────────────────────────────────────────
test('EP-01 extractPlaceholders returns unique keys', () => {
  const tpl  = '{{name}} {{start_date}} {{name}}';
  const keys = extractPlaceholders(tpl);
  expect(keys).toHaveLength(2);
  expect(keys).toContain('name');
  expect(keys).toContain('start_date');
});

test('EP-02 extractPlaceholders returns empty array when no placeholders', () => {
  expect(extractPlaceholders('<p>No placeholders here</p>')).toHaveLength(0);
});

// ── validatePlaceholders ──────────────────────────────────────────────────────
test('VP-01 validatePlaceholders all provided → valid true', () => {
  const result = validatePlaceholders('{{name}} — {{role}}', { name: 'Alice', role: 'Engineer' });
  expect(result.valid).toBe(true);
});

test('VP-02 validatePlaceholders missing keys → valid false', () => {
  const result = validatePlaceholders('{{name}} — {{role}}', { name: 'Alice' });
  expect(result.valid).toBe(false);
  expect(result.missing).toContain('role');
});

test('VP-03 validatePlaceholders no placeholders → always valid', () => {
  expect(validatePlaceholders('<p>Static document</p>', {}).valid).toBe(true);
});

// ── isExpired ─────────────────────────────────────────────────────────────────
test('IE-01 isExpired past dueDate → true', () => {
  const past = new Date(Date.now() - 86_400_000);
  expect(isExpired(past, new Date())).toBe(true);
});

test('IE-02 isExpired future dueDate → false', () => {
  const future = new Date(Date.now() + 86_400_000);
  expect(isExpired(future, new Date())).toBe(false);
});

test('IE-03 isExpired null dueDate → false', () => {
  expect(isExpired(null, new Date())).toBe(false);
});

// ── buildSigningSummary ───────────────────────────────────────────────────────
test('BS-01 buildSigningSummary correct counts', () => {
  const requests = [
    { status: 'SIGNED' },
    { status: 'SIGNED' },
    { status: 'PENDING' },
    { status: 'DECLINED' },
    { status: 'EXPIRED' },
  ];
  const result = buildSigningSummary(requests);
  expect(result.total).toBe(5);
  expect(result.signed).toBe(2);
  expect(result.pending).toBe(1);
  expect(result.declined).toBe(1);
  expect(result.expired).toBe(1);
});

test('BS-02 buildSigningSummary all signed → complianceRate 100', () => {
  const requests = [{ status: 'SIGNED' }, { status: 'SIGNED' }];
  expect(buildSigningSummary(requests).complianceRate).toBe(100);
});

test('BS-03 buildSigningSummary all pending → complianceRate 0', () => {
  const requests = [{ status: 'PENDING' }, { status: 'PENDING' }];
  expect(buildSigningSummary(requests).complianceRate).toBe(0);
});

// ── buildSignatureStatement ───────────────────────────────────────────────────
test('SS-01 buildSignatureStatement includes name and document title', () => {
  const stmt = buildSignatureStatement('Alice Tan', 'Employee Handbook');
  expect(stmt).toContain('Alice Tan');
  expect(stmt).toContain('Employee Handbook');
});
