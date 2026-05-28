'use strict';
/**
 * M-01 — computeDocumentHash uses HMAC-SHA-256 when a key is configured,
 * so an attacker with DB write access cannot regenerate the hash after
 * tampering with personalisedHtml.
 */
const crypto = require('crypto');
const { computeDocumentHash } = require('../src/engines/esign.engine');

describe('M-01 computeDocumentHash', () => {
  const content = '<html>signed contract body</html>';

  beforeEach(() => {
    delete process.env.ESIGN_HMAC_KEY;
    delete process.env.ENCRYPTION_KEY;
  });

  test('uses HMAC when ESIGN_HMAC_KEY is set', () => {
    process.env.ESIGN_HMAC_KEY = 'a'.repeat(64);
    const out = computeDocumentHash(content);
    const expected = crypto.createHmac('sha256', 'a'.repeat(64)).update(content, 'utf8').digest('hex');
    expect(out).toBe(expected);
  });

  test('falls back to ENCRYPTION_KEY when ESIGN_HMAC_KEY missing', () => {
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    const out = computeDocumentHash(content);
    const expected = crypto.createHmac('sha256', 'b'.repeat(64)).update(content, 'utf8').digest('hex');
    expect(out).toBe(expected);
  });

  test('different keys produce different digests (HMAC is keyed)', () => {
    process.env.ESIGN_HMAC_KEY = 'k1';
    const out1 = computeDocumentHash(content);
    process.env.ESIGN_HMAC_KEY = 'k2';
    const out2 = computeDocumentHash(content);
    expect(out1).not.toBe(out2);
  });

  test('degrades to bare SHA-256 only when no key at all is set', () => {
    const out = computeDocumentHash(content);
    const expected = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    expect(out).toBe(expected);
  });
});
