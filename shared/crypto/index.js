'use strict';

/**
 * AES-256-GCM Field-Level Encryption
 * Used for encrypting sensitive fields: NRIC, salary, bank account, etc.
 *
 * Storage format (JSON string): { iv: hex, tag: hex, data: hex }
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16;

function getKey() {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hexKey, 'hex');
}

/**
 * Encrypt plaintext string → JSON cipher string
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined) return null;
  const text = String(plaintext);
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
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
    const { iv, tag, data } = JSON.parse(cipherJson);
    const key = getKey();
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
