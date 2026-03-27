'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRIVATE_KEY_PATH = process.env.JWT_PRIVATE_KEY_PATH || path.join(__dirname, '../../../certs/private.pem');
const PUBLIC_KEY_PATH = process.env.JWT_PUBLIC_KEY_PATH || path.join(__dirname, '../../../certs/public.pem');
const CERTS_DIR = path.dirname(PRIVATE_KEY_PATH);

/**
 * Generate RSA keypair if it doesn't already exist
 */
async function generateKeysIfNeeded() {
  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    console.log('[jwt] Using existing RSA keypair');
    return;
  }
  console.log('[jwt] Generating RSA-2048 keypair...');
  fs.mkdirSync(CERTS_DIR, { recursive: true });

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });
  console.log('[jwt] RSA keypair generated');
}

function getPrivateKey() {
  return fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
}

function getPublicKey() {
  return fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
}

/**
 * Sign an access JWT (RS256, 15m)
 */
function signAccessToken(payload) {
  return jwt.sign(payload, getPrivateKey(), {
    algorithm: 'RS256',
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
    issuer: 'ezyhRM',
  });
}

/**
 * Sign a refresh JWT (RS256, 7d)
 */
function signRefreshToken(payload) {
  return jwt.sign(payload, getPrivateKey(), {
    algorithm: 'RS256',
    expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
    issuer: 'ezyhRM',
  });
}

/**
 * Verify any JWT with public key
 */
function verifyToken(token) {
  return jwt.verify(token, getPublicKey(), { algorithms: ['RS256'], issuer: 'ezyhRM' });
}

module.exports = { generateKeysIfNeeded, signAccessToken, signRefreshToken, verifyToken };
