'use strict';
/**
 * The JWT issuer must match between the signer and every verifier.
 *
 * Asserted at source level because getting this half-right breaks every login
 * instantly and silently: tokens are signed with one issuer and rejected by
 * verifiers expecting another, which presents as "all users logged out" rather
 * than as a build failure.
 *
 * The rebrand spec's own first draft made exactly this mistake — it listed the
 * verifiers and omitted services/auth-service/src/utils/jwt.utils.js, which is
 * where tokens are signed. This test exists so that cannot recur.
 */
const fs = require('fs');
const path = require('path');

const SIGN_SITES = [
  ['auth-service (SIGNS access + refresh)', '../src/utils/jwt.utils.js'],
  ['admin-service (SIGNS platform)',        '../../admin-service/src/utils/jwt.js'],
];
const VERIFY_SITES = [
  ['shared/auth-middleware (every service)', '../../../shared/auth-middleware/index.js'],
  ['api-gateway',                            '../../api-gateway/src/index.js'],
];

describe('JWT issuer is gadonghr everywhere', () => {
  test.each([...SIGN_SITES, ...VERIFY_SITES])('%s uses gadonghr', (_label, rel) => {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    expect(src).toMatch(/issuer:\s*'gadonghr'/);
    expect(src).not.toMatch(/issuer:\s*'vorkhive'/);
  });
});
