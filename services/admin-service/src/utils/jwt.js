'use strict';
const jwt = require('jsonwebtoken');
const fs = require('fs');
const crypto = require('crypto');

const PRIVATE = process.env.JWT_PRIVATE_KEY_PATH || '/app/certs/private.pem';
const PUBLIC  = process.env.JWT_PUBLIC_KEY_PATH  || '/app/certs/public.pem';

// Platform tokens carry scope:"platform" — the gateway accepts them ONLY on
// /api/platform/* and rejects them on every tenant app route (and vice versa).
function signPlatformToken(payload) {
  return jwt.sign({ ...payload, scope: 'platform' }, fs.readFileSync(PRIVATE, 'utf8'), {
    algorithm: 'RS256',
    expiresIn: process.env.PLATFORM_JWT_EXPIRES || '8h',
    issuer: 'vorkhive',
    jwtid: crypto.randomUUID(),
  });
}
function verifyToken(token) {
  return jwt.verify(token, fs.readFileSync(PUBLIC, 'utf8'), { algorithms: ['RS256'], issuer: 'vorkhive' });
}
module.exports = { signPlatformToken, verifyToken };
