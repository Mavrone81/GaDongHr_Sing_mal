'use strict';
/**
 * Aggregated security regression for auth-service H-tier fixes.
 *
 *   H-08  authenticate() enforces issuer; rejects SSO-pending tokens on
 *         protected endpoints; authorize() filters falsy entries.
 *   H-09  Google + Microsoft callbacks call verifyOidcIdToken() rather than
 *         blindly decoding the id_token payload.
 *   H-10  /users/invite/derive-key returns rawToken without consuming;
 *         /users/consume-invite no longer returns rawToken; expiry shortened
 *         from 30d to 7d.
 *   H-11  Token-exchange error logs are redacted (no full tokenData).
 *   H-12  /auth/refresh uses an atomic updateMany guard on isRevoked=false.
 *   H-20  PUT /users/:id enforces role-hierarchy guard.
 */
const fs = require('fs');
const path = require('path');

const middlewareSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'shared', 'auth-middleware', 'index.js'), 'utf8');
const authSrc       = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.routes.js'), 'utf8');
const userSrc       = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'user.routes.js'), 'utf8');

// ── H-08 ──────────────────────────────────────────────────────────────────────
describe('H-08 shared auth-middleware hardening', () => {
  test('authenticate enforces issuer: vorkhive', () => {
    expect(middlewareSrc).toMatch(/issuer:\s*['"]vorkhive['"]/);
  });
  test('authenticate rejects sso_pending tokens', () => {
    expect(middlewareSrc).toMatch(/sso_pending\s*===\s*true/);
  });
  test('authorize filters falsy from allowed list', () => {
    expect(middlewareSrc).toMatch(/allowed\.filter\(Boolean\)/);
  });
});

// ── H-09 ──────────────────────────────────────────────────────────────────────
describe('H-09 OAuth id_token signature verification', () => {
  test('Google callback calls verifyOidcIdToken (not raw atob/Buffer decode)', () => {
    const startG = authSrc.indexOf("router.post('/sso/google/callback'");
    const sliceG = authSrc.slice(startG, startG + 4000);
    expect(sliceG).toMatch(/verifyOidcIdToken\(\s*\{[\s\S]*jwksUrl:[\s\S]*audience:\s*clientId/);
  });
  test('Microsoft callback calls verifyOidcIdToken', () => {
    const startM = authSrc.indexOf("router.post('/sso/microsoft/callback'");
    const sliceM = authSrc.slice(startM, startM + 4500);
    expect(sliceM).toMatch(/verifyOidcIdToken\(\s*\{[\s\S]*jwksUrl:[\s\S]*audience:\s*clientId/);
  });
});

// ── H-10 ──────────────────────────────────────────────────────────────────────
describe('H-10 invite token consume flow hardening', () => {
  test('/users/invite/derive-key endpoint exists', () => {
    expect(userSrc).toMatch(/router\.post\(['"]\/invite\/derive-key['"]/);
  });
  test('/users/consume-invite no longer returns rawToken', () => {
    const start = userSrc.indexOf("router.post('/consume-invite'");
    const slice = userSrc.slice(start, start + 1500);
    // The response payload must not include rawToken.
    expect(slice).not.toMatch(/res\.json\(\s*\{\s*\.\.\.user,\s*rawToken/);
    expect(slice).toMatch(/res\.json\(\s*\{\s*id:\s*user\.id/);
  });
  test('invite JWT expiry is 7d, not 30d', () => {
    expect(userSrc).toMatch(/expiresIn:\s*['"]7d['"]/);
    expect(userSrc).not.toMatch(/expiresIn:\s*['"]30d['"]/);
  });
});

// ── H-11 ──────────────────────────────────────────────────────────────────────
describe('H-11 OAuth error log redaction', () => {
  test('Google/Microsoft Token exchange failed logs do not echo tokenData verbatim', () => {
    // The error log must include error_description but not pass tokenData.
    const sliceG = authSrc.match(/\[sso\/google\] Token exchange failed[\s\S]+?\}\)/);
    const sliceM = authSrc.match(/\[sso\/microsoft\] Token exchange failed[\s\S]+?\}\)/);
    for (const slice of [sliceG?.[0], sliceM?.[0]]) {
      expect(slice).toBeTruthy();
      expect(slice).toMatch(/error_description/);
      // Must NOT pass `tokenData` directly as second arg.
      expect(slice).not.toMatch(/Token exchange failed[^']*['"]\s*,\s*tokenData\s*\)/);
    }
  });
});

// ── H-12 ──────────────────────────────────────────────────────────────────────
describe('H-12 atomic refresh-token rotation', () => {
  test('refresh handler uses updateMany scoped to isRevoked=false', () => {
    const start = authSrc.indexOf("router.post('/refresh'");
    const slice = authSrc.slice(start, start + 3000);
    expect(slice).toMatch(/updateMany\(\s*\{[\s\S]*isRevoked:\s*false/);
    expect(slice).toMatch(/revokedCount\s*===\s*0[\s\S]+?401/);
  });
});

// ── H-20 ──────────────────────────────────────────────────────────────────────
describe('H-20 role-hierarchy guard on PUT /users/:id', () => {
  test('ROLE_RANK map is defined', () => {
    expect(userSrc).toMatch(/ROLE_RANK\s*=\s*\{[\s\S]*SUPER_ADMIN:\s*100/);
  });
  test('PUT handler rejects when target role rank > actor rank', () => {
    const start = userSrc.indexOf("router.put('/:id'");
    const slice = userSrc.slice(start, start + 3500);
    expect(slice).toMatch(/targetRoleRank\s*>\s*actorRank/);
    expect(slice).toMatch(/Cannot grant a role higher than your own/);
  });
});
