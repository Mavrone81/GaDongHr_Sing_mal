'use strict';
/**
 * Aggregated source-level regression for M-tier auth-service fixes.
 *   M-03 access cookie window narrowed.
 *   M-04 error handler scrubs in production.
 *   M-12 Microsoft SSO no longer uses dot-stripped gmail fallback.
 */
const fs = require('fs');
const path = require('path');

const authIndexSrc  = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
const authRoutesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.routes.js'), 'utf8');

describe('M-03 access cookie TTL', () => {
  test('ACCESS_TTL_SECONDS is 1h, not 8h', () => {
    expect(authRoutesSrc).toMatch(/ACCESS_TTL_SECONDS\s*=\s*60 \* 60/);
    expect(authRoutesSrc).not.toMatch(/ACCESS_TTL_SECONDS\s*=\s*8 \* 60 \* 60/);
  });
});

describe('M-04 production error scrub', () => {
  test('error handler scrubs 5xx error messages in NODE_ENV=production', () => {
    expect(authIndexSrc).toMatch(/process\.env\.NODE_ENV === 'production'/);
    expect(authIndexSrc).toMatch(/'Internal server error'/);
  });
});

describe('M-12 Microsoft SSO fuzzy email fallback removed', () => {
  test('no @gmail.com dot-stripped lookup remains', () => {
    expect(authRoutesSrc).not.toMatch(/email\.endsWith\(['"]@gmail\.com['"]\)/);
    expect(authRoutesSrc).not.toMatch(/\.replace\(\/\\\.\/g,\s*''\)\s*\+\s*['"]@gmail\.com['"]/);
  });
  test('exact email lookup is the only Microsoft email lookup', () => {
    const start = authRoutesSrc.indexOf("router.post('/sso/microsoft/callback'");
    const slice = authRoutesSrc.slice(start, start + 5000);
    // Multi-tenant: email is per-tenant unique, so the exact lookup is now
    // findFirst({ where: { email } }) instead of findUnique — still an exact
    // match with no dot-stripped fuzzy fallback. Exactly one email-keyed lookup.
    const lookups = (slice.match(/find(First|Unique)\(\{\s*where:\s*\{\s*email\b/g) || []).length;
    expect(lookups).toBe(1);
  });
});
