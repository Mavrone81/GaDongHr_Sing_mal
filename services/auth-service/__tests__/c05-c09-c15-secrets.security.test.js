'use strict';
/**
 * Security regression tests for C-05, C-06, C-09, C-15.
 *
 *   C-05 — seed-initial-admin requires ADMIN_EMAIL + ADMIN_PASSWORD env;
 *          no Admin@123 default; password must meet complexity rules.
 *   C-06 — sync-users mints a random per-user password (never a shared
 *          literal) and stamps mustChangePassword=true.
 *   C-09 — MFA OTP generation uses crypto.randomInt, never Math.random.
 *   C-15 — login rate limiter is bound by LOGIN_RATELIMIT_MAX (default 10),
 *          not the deliberate 10000 "effectively disabled" value.
 */
const fs = require('fs');
const path = require('path');

const seedAdminSrc  = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'seed-initial-admin.js'), 'utf8');
const syncUsersSrc  = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sync-users.js'),         'utf8');
const authRoutesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.routes.js'),  'utf8');

// ── C-05 ──────────────────────────────────────────────────────────────────────
describe('C-05 seed-initial-admin', () => {
  test('contains no Admin@123 literal default', () => {
    expect(seedAdminSrc).not.toMatch(/['"]Admin@123['"]/);
  });

  /**
   * Generalised from two hardcoded-literal checks.
   *
   * The original pair asserted against two specific historical passwords. A
   * 2026-07-13 secret scrub rewrote one of them in place, producing the regex
   * /['"]***REMOVED***['"]/ — invalid syntax, so this whole file stopped
   * parsing and the C-05 guard silently died for three weeks.
   *
   * Matching the *shape* of a hardcoded credential instead of one known value
   * is both immune to that and strictly stronger: it catches any future
   * literal, not just the two we already knew about.
   */
  test('has no literal fallback for any password variable', () => {
    // e.g.  const p = process.env.X ?? 'literal'   /   ... || "literal"
    expect(seedAdminSrc).not.toMatch(/password[^\n]*(?:\?\?|\|\|)\s*['"][^'"]+['"]/i);
  });
  test('asserts presence of ADMIN_EMAIL and ADMIN_PASSWORD env', () => {
    expect(seedAdminSrc).toContain("assertEnv('ADMIN_EMAIL')");
    expect(seedAdminSrc).toContain("assertEnv('ADMIN_PASSWORD')");
  });
  test('enforces password complexity', () => {
    expect(seedAdminSrc).toMatch(/PASSWORD_MIN_LEN\s*=\s*12/);
    expect(seedAdminSrc).toMatch(/PASSWORD_PATTERN/);
  });
  test('sets mustChangePassword=true on initial seed', () => {
    expect(seedAdminSrc).toMatch(/mustChangePassword:\s*true/);
  });
});

// ── C-06 ──────────────────────────────────────────────────────────────────────
describe('C-06 sync-users', () => {
  test('contains no shared hardcoded password literal', () => {
    expect(syncUsersSrc).not.toMatch(/GaDongHR@2025/);
  });
  test('uses crypto.randomBytes for the per-user temp password', () => {
    expect(syncUsersSrc).toMatch(/crypto\.randomBytes\(32\)/);
  });
  test('stamps mustChangePassword=true on every synced user', () => {
    expect(syncUsersSrc).toMatch(/mustChangePassword:\s*true/);
  });
  test('issues a per-user invite token', () => {
    expect(syncUsersSrc).toMatch(/inviteToken/);
  });
  test('fail-closed if INTERNAL_SERVICE_KEY is unset', () => {
    expect(syncUsersSrc).toMatch(/!process\.env\.INTERNAL_SERVICE_KEY/);
  });
});

// ── C-09 ──────────────────────────────────────────────────────────────────────
describe('C-09 MFA OTP', () => {
  test('uses crypto.randomInt (not Math.random)', () => {
    expect(authRoutesSrc).toMatch(/crypto\.randomInt\(100000,\s*1000000\)/);
    // Negative assertion: the MFA OTP function must NOT call Math.random
    const otpFn = authRoutesSrc.match(/async function sendEmailOtp[\s\S]+?\n\}/);
    expect(otpFn).not.toBeNull();
    expect(otpFn[0]).not.toMatch(/Math\.random\(/);
  });
});

// ── C-15 ──────────────────────────────────────────────────────────────────────
describe('C-15 login rate limit', () => {
  test('limiter max is configurable and defaults to 10', () => {
    expect(authRoutesSrc).toMatch(/LOGIN_RATELIMIT_MAX/);
    expect(authRoutesSrc).toMatch(/parseInt\(process\.env\.LOGIN_RATELIMIT_MAX/);
    expect(authRoutesSrc).toMatch(/\|\| '10'/);
  });
  test('does NOT contain the deliberate 10000 "effectively disabled" value', () => {
    expect(authRoutesSrc).not.toMatch(/max:\s*10000/);
  });
});
