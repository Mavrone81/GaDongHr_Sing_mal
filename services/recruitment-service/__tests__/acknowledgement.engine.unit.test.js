'use strict';
/**
 * Unit tests: Acknowledgement engine (REC-004)
 *
 * AE-01  REQUIRED_DOCS has 4 entries, each with code + title + description
 * AE-02  computeAckSummary — all PENDING → allComplete false, pending = total
 * AE-03  computeAckSummary — all ACKNOWLEDGED → allComplete true, pending = 0
 * AE-04  computeAckSummary — mixed → correct done / pending counts
 * AE-05  computeAckSummary — empty array → total 0, allComplete false
 */

const { REQUIRED_DOCS, computeAckSummary } = require('../src/engines/acknowledgement.engine');

// ── AE-01 ─────────────────────────────────────────────────────────────────────
test('AE-01 REQUIRED_DOCS has 4 entries with code, title, description', () => {
  expect(REQUIRED_DOCS).toHaveLength(4);
  const codes = REQUIRED_DOCS.map(d => d.code);
  expect(codes).toContain('HANDBOOK');
  expect(codes).toContain('HARASSMENT_POLICY');
  expect(codes).toContain('PDPA_CONSENT');
  expect(codes).toContain('IT_ACCEPTABLE_USE');
  for (const doc of REQUIRED_DOCS) {
    expect(typeof doc.code).toBe('string');
    expect(typeof doc.title).toBe('string');
    expect(typeof doc.description).toBe('string');
  }
});

// ── AE-02 ─────────────────────────────────────────────────────────────────────
test('AE-02 computeAckSummary all PENDING → allComplete false', () => {
  const acks = [
    { status: 'PENDING' },
    { status: 'PENDING' },
    { status: 'PENDING' },
  ];
  const result = computeAckSummary(acks);
  expect(result.total).toBe(3);
  expect(result.done).toBe(0);
  expect(result.pending).toBe(3);
  expect(result.allComplete).toBe(false);
});

// ── AE-03 ─────────────────────────────────────────────────────────────────────
test('AE-03 computeAckSummary all ACKNOWLEDGED → allComplete true', () => {
  const acks = [
    { status: 'ACKNOWLEDGED' },
    { status: 'ACKNOWLEDGED' },
    { status: 'ACKNOWLEDGED' },
    { status: 'ACKNOWLEDGED' },
  ];
  const result = computeAckSummary(acks);
  expect(result.total).toBe(4);
  expect(result.done).toBe(4);
  expect(result.pending).toBe(0);
  expect(result.allComplete).toBe(true);
});

// ── AE-04 ─────────────────────────────────────────────────────────────────────
test('AE-04 computeAckSummary mixed → correct done and pending counts', () => {
  const acks = [
    { status: 'ACKNOWLEDGED' },
    { status: 'PENDING' },
    { status: 'ACKNOWLEDGED' },
    { status: 'PENDING' },
  ];
  const result = computeAckSummary(acks);
  expect(result.total).toBe(4);
  expect(result.done).toBe(2);
  expect(result.pending).toBe(2);
  expect(result.allComplete).toBe(false);
});

// ── AE-05 ─────────────────────────────────────────────────────────────────────
test('AE-05 computeAckSummary empty array → total 0, allComplete false', () => {
  const result = computeAckSummary([]);
  expect(result.total).toBe(0);
  expect(result.done).toBe(0);
  expect(result.pending).toBe(0);
  expect(result.allComplete).toBe(false);
});
