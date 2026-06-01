'use strict';

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRIVATE_KEY_PATH = process.env.JWT_PRIVATE_KEY_PATH || path.join(__dirname, '../../../certs/private.pem');
const PUBLIC_KEY_PATH = process.env.JWT_PUBLIC_KEY_PATH || path.join(__dirname, '../../../certs/public.pem');

/**
 * Generate RSA keys if they don't exist
 */
async function generateKeysIfNeeded() {
  const dir = path.dirname(PRIVATE_KEY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(PRIVATE_KEY_PATH) || !fs.existsSync(PUBLIC_KEY_PATH)) {
    console.log('[AuthService] Generating new RSA key pair...');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey);
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey);
  }
}

function signAccessToken(payload) {
  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
  // jwtid forces a unique `jti` per call so back-to-back signings (e.g.
  // login + immediate refresh inside the same second) produce different
  // tokens. Lets clients distinguish issued tokens and supports per-token
  // revocation if/when introduced.
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
    issuer: 'vorkhive',
    jwtid: crypto.randomUUID(),
  });
}

function signRefreshToken(payload) {
  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
  // jwtid forces a unique `jti` claim per call. Without it, two refreshes
  // for the same user inside the same second sign byte-identical JWTs
  // (payload = {sub}, iat at second precision) and collide on the
  // refresh_tokens.token unique index.
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
    issuer: 'vorkhive',
    jwtid: crypto.randomUUID(),
  });
}

function verifyToken(token) {
  const publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] });
}

module.exports = {
  generateKeysIfNeeded,
  signAccessToken,
  signRefreshToken,
  verifyToken
};
