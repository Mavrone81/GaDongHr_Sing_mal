'use strict';
/**
 * RPT-003 Phase 1 — hand-rolled CSV writer.
 * Quotes any cell containing comma, double-quote, CR, or LF.
 * Returns the full CSV as a string — fine for the ~5k row default cap.
 */

function escapeCell(v) {
  if (v == null) return '';
  if (v instanceof Date) v = v.toISOString();
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(columns, rows) {
  const header = columns.map(c => escapeCell(c.label || c.key)).join(',');
  const body = rows.map(r => columns.map(c => escapeCell(r[c.key])).join(',')).join('\n');
  return rows.length === 0 ? header + '\n' : header + '\n' + body + '\n';
}

module.exports = { escapeCell, toCsv };
