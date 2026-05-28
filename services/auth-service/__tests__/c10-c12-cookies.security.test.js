'use strict';
/**
 * Security regression tests for C-10 (INVITE_TOKEN_SECRET) and C-12 (HttpOnly cookies).
 */
const fs = require('fs');
const path = require('path');

const userRoutesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'user.routes.js'), 'utf8');
const authRoutesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.routes.js'), 'utf8');

// ── C-10 ──────────────────────────────────────────────────────────────────────
describe('C-10 INVITE_TOKEN_SECRET separation', () => {
  test('user.routes uses dedicated INVITE_TOKEN_SECRET env, not ENCRYPTION_KEY', () => {
    expect(userRoutesSrc).toMatch(/process\.env\.INVITE_TOKEN_SECRET/);
    // The INVITE_SECRET variable must not fall back to ENCRYPTION_KEY any longer.
    expect(userRoutesSrc).not.toMatch(/INVITE_SECRET\s*=\s*process\.env\.ENCRYPTION_KEY/);
  });
  test('throws when INVITE_TOKEN_SECRET is missing or too short', () => {
    expect(userRoutesSrc).toMatch(/INVITE_TOKEN_SECRET env var is required/);
    expect(userRoutesSrc).toMatch(/INVITE_SECRET\.length\s*<\s*32/);
  });
});

// ── C-12 ──────────────────────────────────────────────────────────────────────
describe('C-12 HttpOnly auth cookies', () => {
  test('auth.routes defines a setAuthCookies helper that sets HttpOnly+Secure+SameSite=Strict', () => {
    expect(authRoutesSrc).toMatch(/function cookieFlags\(secure\)/);
    expect(authRoutesSrc).toMatch(/httpOnly:\s*true/);
    expect(authRoutesSrc).toMatch(/sameSite:\s*['"]strict['"]/);
  });
  test('login response emits Set-Cookie via setAuthCookies', () => {
    // The login handler must invoke setAuthCookies before res.json.
    const loginHandler = authRoutesSrc.match(/router\.post\(['"]\/login['"][\s\S]+?\n\}\);/);
    expect(loginHandler).not.toBeNull();
    expect(loginHandler[0]).toMatch(/setAuthCookies\(res,\s*\{\s*accessToken,\s*refreshToken:\s*refreshTokenStr\s*\}\)/);
  });
  test('refresh handler accepts cookie token AND emits new cookies', () => {
    const refreshSection = authRoutesSrc.match(/router\.post\(['"]\/refresh['"][\s\S]+?setAuthCookies\(res,\s*\{\s*accessToken:\s*newAccessToken,\s*refreshToken:\s*newRefreshToken\s*\}\)/);
    expect(refreshSection).not.toBeNull();
    expect(authRoutesSrc).toMatch(/req\.cookies\?\.\[REFRESH_TOKEN_COOKIE\]/);
  });
  test('logout handler clears auth cookies', () => {
    const logoutSection = authRoutesSrc.match(/router\.post\(['"]\/logout['"][\s\S]+?clearAuthCookies\(res\)/);
    expect(logoutSection).not.toBeNull();
  });
});
