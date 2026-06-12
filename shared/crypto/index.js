'use strict';

/**
 * AES-256-GCM Field-Level Encryption
 * Used for encrypting sensitive fields: NRIC, salary, bank account, etc.
 *
 * Storage format (JSON string): { v: keyVersion, iv: hex, tag: hex, data: hex }
 *
 * Key versioning: each ciphertext is stamped with the key version (`v`) that
 * encrypted it. Decrypt resolves the matching key, so keys can be rotated
 * without re-encrypting everything at once. Ciphertext written before
 * versioning existed has no `v` and is treated as v1 (the original
 * ENCRYPTION_KEY) — fully backward compatible.
 *
 * To rotate: set ENCRYPTION_KEY_VERSION=2 + ENCRYPTION_KEY_V2=<new 64-hex key>,
 * keep ENCRYPTION_KEY (v1) available so old rows still decrypt, then lazily
 * re-encrypt on write (or run a background re-encrypt job).
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;
const CURRENT_KEY_VERSION = process.env.ENCRYPTION_KEY_VERSION || '1';

// Resolve the 32-byte key for a given version. v1 falls back to the original
// ENCRYPTION_KEY var so pre-versioning ciphertext keeps working.
function keyForVersion(version) {
  const v = String(version || '1');
  const hexKey = process.env[`ENCRYPTION_KEY_V${v}`] || (v === '1' ? process.env.ENCRYPTION_KEY : undefined);
  if (!hexKey || hexKey.length !== 64) {
    throw new Error(`ENCRYPTION_KEY_V${v} (or ENCRYPTION_KEY for v1) must be a 64-character hex string (32 bytes)`);
  }
  return Buffer.from(hexKey, 'hex');
}

/**
 * Encrypt plaintext string → JSON cipher string
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const text = String(plaintext);
  const key = keyForVersion(CURRENT_KEY_VERSION);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    v: CURRENT_KEY_VERSION,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

/**
 * Decrypt JSON cipher string → plaintext
 */
function decrypt(cipherJson) {
  if (!cipherJson) return null;
  try {
    const { v, iv, tag, data } = JSON.parse(cipherJson);
    const key = keyForVersion(v); // missing v → v1 (pre-versioning ciphertext)
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'hex'),
      { authTagLength: TAG_LENGTH }
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(data, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error(`Decryption failed: ${err.message}`);
  }
}

/**
 * Encrypt a numeric value (stored as string cipher)
 */
function encryptNumber(value) {
  if (value === null || value === undefined) return null;
  return encrypt(String(value));
}

/**
 * Decrypt and return as float
 */
function decryptNumber(cipherJson) {
  const str = decrypt(cipherJson);
  return str !== null ? parseFloat(str) : null;
}

/**
 * Encrypt selected fields in an object
 * @param {object} obj - plain object
 * @param {string[]} fields - field names to encrypt
 */
function encryptFields(obj, fields) {
  const result = { ...obj };
  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = encrypt(String(result[field]));
    }
  }
  return result;
}

/**
 * Decrypt selected fields in an object
 */
function decryptFields(obj, fields) {
  if (!obj) return obj;
  const result = { ...obj };
  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null) {
      try {
        result[field] = decrypt(result[field]);
      } catch {
        result[field] = '[ENCRYPTED]';
      }
    }
  }
  return result;
}

/**
 * Generate a secure random encryption key for initial setup
 */
function generateKey() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  encrypt,
  decrypt,
  encryptNumber,
  decryptNumber,
  encryptFields,
  decryptFields,
  generateKey,
};
