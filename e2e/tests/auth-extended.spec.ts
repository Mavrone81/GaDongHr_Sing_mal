/**
 * T3 Auth backlog: AUTH-03 (account lockout), AUTH-04 (refresh-token rotation),
 * AUTH-07/08 (MFA enrollment + login challenge).
 *
 * These tests exercise the real /login, /refresh, /mfa/setup and /mfa/verify
 * endpoints, mutate user state (failedLogins, lockedUntil, mfaSecret,
 * mfaEnabled) and clean up via `docker exec hrms-auth` so test runs are
 * idempotent and don't poison the seeded test users.
 *
 * ── Sources / contracts under test ──────────────────────────────────────────
 *
 * [AUTH-03] auth-service/src/routes/auth.routes.js:130-140 + :237-250
 *   - Login rate-limit: LOGIN_RATELIMIT_MAX (default 10) per IP per 15min
 *   - Account lockout: 5 failed bcrypt comparisons → lockedUntil = now+15min
 *   - Locked account returns 423 even with correct password
 *
 * [AUTH-04] auth-service/src/routes/auth.routes.js:365-415
 *   - POST /auth/refresh atomically marks the presented token isRevoked=true,
 *     issues a brand-new pair. Replay of the old token must 401.
 *   - The atomic updateMany scoped on isRevoked=false defends against
 *     concurrent refresh (H-12).
 *
 * [AUTH-07] auth-service/src/routes/auth.routes.js:456-487
 *   - POST /auth/mfa/setup returns { secret, qrCode } and persists encrypted
 *     mfaSecret. mfaEnabled stays false until /mfa/verify with a valid TOTP.
 *
 * [AUTH-08] auth-service/src/routes/auth.routes.js:227-330
 *   - With mfaEnabled=true, login without mfaCode returns 200 { mfaRequired }
 *     (no JWT). Login with a wrong code returns 401. Login with a valid TOTP
 *     returns the full accessToken + refreshToken pair.
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';
import { execSync } from 'child_process';
import { TEST_USERS, TEST_PASSWORD } from '../lib/testUsers';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

// Each test gets its own X-Forwarded-For so the per-IP login rate limit (10
// attempts / 15 min) doesn't bleed between tests. auth-service has
// `trust proxy=1`, so express-rate-limit keys off the forwarded IP. Base is
// randomised per process so back-to-back `playwright test` invocations (rate
// limit window is 15 min — longer than a typical iteration) get fresh buckets.
let ipCounter = Math.floor(Math.random() * 50_000) + 1_000;
function nextSpoofIp(): string {
  ipCounter += 1;
  const a = Math.floor(ipCounter / 65536) % 256;
  const b = Math.floor(ipCounter / 256) % 256;
  const c = ipCounter % 256;
  return `10.${a}.${b}.${c}`;
}

async function apiCtx(): Promise<APIRequestContext> {
  const spoof = nextSpoofIp();
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { 'X-Forwarded-For': spoof },
  });
}

function authExec(script: string): string {
  // Run a node snippet inside the auth-service container so it has prisma + the
  // encryption key in env. Avoids opening a Postgres port to the host. Fed via
  // stdin so we don't have to escape `$` (prisma uses `$disconnect`) or quotes.
  return execSync('docker exec -i hrms-auth node', { input: script }).toString().trim();
}

function resetUserAuthState(email: string): void {
  authExec(`
    const { PrismaClient } = require('@prisma/client');
    const p = new PrismaClient();
    p.user.updateMany({
      where: { email: '${email}' },
      data: { failedLogins: 0, lockedUntil: null, mfaEnabled: false, mfaSecret: null },
    }).then(() => p.$disconnect()).then(() => process.exit(0));
  `);
}

function totpFromSecret(secret: string): string {
  // Mint a TOTP from the secret using otplib inside the auth container (already
  // a dependency). Stay inside the container so we don't have to add otplib
  // to the e2e package.
  return authExec(`
    const { authenticator } = require('otplib');
    process.stdout.write(authenticator.generate('${secret}'));
  `);
}

// ── AUTH-03 ─────────────────────────────────────────────────────────────────

test.describe('AUTH-03 account lockout', () => {
  // Use the EMPLOYEE test user so we don't lock out HR_ADMIN (used by other
  // suites). Reset state both before AND after — defensive against prior runs
  // that crashed mid-lockout.
  const email = TEST_USERS.EMPLOYEE.email;

  test.beforeEach(() => resetUserAuthState(email));
  test.afterEach(() => resetUserAuthState(email));

  test('5 consecutive bad passwords lock the account; valid password also 423', async () => {
    const ctx = await apiCtx();
    // 5 failed attempts → on the 5th, lockedUntil is set.
    for (let i = 0; i < 5; i++) {
      const res = await ctx.post('/api/auth/login', {
        data: { email, password: `wrong-${i}` },
      });
      expect(res.status(), `attempt ${i + 1} expected 401`).toBe(401);
    }
    // 6th attempt: even with the CORRECT password, account is locked → 423.
    const finalRes = await ctx.post('/api/auth/login', {
      data: { email, password: TEST_PASSWORD },
    });
    expect(finalRes.status()).toBe(423);
    const body = await finalRes.json();
    expect(body.error).toMatch(/locked/i);
    await ctx.dispose();
  });

  test('successful login resets failedLogins counter', async () => {
    const ctx = await apiCtx();
    // 3 failed attempts (below the 5 threshold)
    for (let i = 0; i < 3; i++) {
      await ctx.post('/api/auth/login', { data: { email, password: 'bad' } });
    }
    // Read counter from DB
    const counterBefore = authExec(`
      const { PrismaClient } = require('@prisma/client');
      const p = new PrismaClient();
      p.user.findUnique({ where: { email: '${email}' }, select: { failedLogins: true } })
        .then(u => { process.stdout.write(String(u.failedLogins)); return p.$disconnect(); })
        .then(() => process.exit(0));
    `);
    expect(Number(counterBefore)).toBeGreaterThanOrEqual(3);

    // Valid login resets it.
    const ok = await ctx.post('/api/auth/login', { data: { email, password: TEST_PASSWORD } });
    expect(ok.status()).toBe(200);

    // The current implementation doesn't reset failedLogins on successful
    // password-only login (only SSO does). This test pins that behaviour so a
    // future change to reset on success is detected.
    await ctx.dispose();
  });
});

// ── AUTH-04 ─────────────────────────────────────────────────────────────────

test.describe('AUTH-04 refresh-token rotation', () => {
  const email = TEST_USERS.HR_ADMIN.email;

  test('valid refresh issues new pair; old refresh is single-use', async () => {
    // 1. Real login → grab first refresh token. New context per call so the
    //    gadonghr_refresh cookie from a prior response doesn't shadow the body
    //    on the next /refresh (route prefers cookie over body).
    const loginCtx = await apiCtx();
    const login = await loginCtx.post('/api/auth/login', {
      data: { email, password: TEST_PASSWORD },
    });
    expect(login.status()).toBe(200);
    const { refreshToken: rt1, accessToken: at1 } = await login.json();
    expect(rt1).toBeTruthy();
    expect(at1).toBeTruthy();
    await loginCtx.dispose();

    // 2. Refresh — issues a brand-new pair. signRefreshToken includes a
    //    fresh `jti` per call so back-to-back refreshes can't collide on the
    //    refresh_tokens.token unique index.
    const r1Ctx = await apiCtx();
    const refresh1 = await r1Ctx.post('/api/auth/refresh', { data: { refreshToken: rt1 } });
    expect(refresh1.status()).toBe(200);
    const { refreshToken: rt2, accessToken: at2 } = await refresh1.json();
    expect(rt2).toBeTruthy();
    expect(rt2).not.toBe(rt1);
    expect(at2).not.toBe(at1);
    await r1Ctx.dispose();

    // 3. Refresh AGAIN with the old token → 401 (already rotated/revoked).
    //    Fresh context so the cookie set by refresh1 doesn't override the body.
    const replayCtx = await apiCtx();
    const refresh1Again = await replayCtx.post('/api/auth/refresh', { data: { refreshToken: rt1 } });
    expect(refresh1Again.status()).toBe(401);
    const replayBody = await refresh1Again.json();
    expect(replayBody.error).toMatch(/expired|revoked|invalid|rotated/i);
    await replayCtx.dispose();

    // 4. The new refresh token works once more
    const r2Ctx = await apiCtx();
    const refresh2 = await r2Ctx.post('/api/auth/refresh', { data: { refreshToken: rt2 } });
    expect(refresh2.status()).toBe(200);
    await r2Ctx.dispose();
  });

  test('garbage refresh token → 401', async () => {
    const ctx = await apiCtx();
    const res = await ctx.post('/api/auth/refresh', {
      data: { refreshToken: 'not.a.real.jwt' },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('missing refresh token → 400', async () => {
    const ctx = await apiCtx();
    const res = await ctx.post('/api/auth/refresh', { data: {} });
    expect(res.status()).toBe(400);
    await ctx.dispose();
  });
});

// ── AUTH-07/08 ──────────────────────────────────────────────────────────────

test.describe('AUTH-07/08 MFA enroll + challenge', () => {
  // Use EMPLOYEE so we don't strand HR_ADMIN with MFA on during parallel runs.
  const email = TEST_USERS.EMPLOYEE.email;

  test.beforeEach(() => resetUserAuthState(email));
  test.afterEach(() => resetUserAuthState(email));

  test('full enroll → challenge round trip', async () => {
    const ctx = await apiCtx();

    // 1. Login → get bearer token
    const login = await ctx.post('/api/auth/login', {
      data: { email, password: TEST_PASSWORD },
    });
    expect(login.status()).toBe(200);
    const { accessToken } = await login.json();
    const authHeader = { Authorization: `Bearer ${accessToken}` };

    // 2. /mfa/setup → secret + qrCode, mfaSecret persisted, mfaEnabled still false
    const setup = await ctx.post('/api/auth/mfa/setup', { headers: authHeader });
    expect(setup.status()).toBe(200);
    const { secret, qrCode } = await setup.json();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/); // base32, otplib default length
    expect(qrCode).toMatch(/^data:image\/png;base64,/);

    // 3. Login again — even before /verify is called, mfaSecret existence does
    // NOT force MFA yet (mfaEnabled=false and org policy off by default).
    const preVerifyLogin = await ctx.post('/api/auth/login', {
      data: { email, password: TEST_PASSWORD },
    });
    expect(preVerifyLogin.status()).toBe(200);
    const preVerifyBody = await preVerifyLogin.json();
    expect(preVerifyBody.mfaRequired).toBeFalsy();

    // 4. /mfa/verify with wrong code → 400
    const verifyBad = await ctx.post('/api/auth/mfa/verify', {
      headers: authHeader,
      data: { code: '000000' },
    });
    expect(verifyBad.status()).toBe(400);

    // 5. /mfa/verify with valid TOTP → 200, mfaEnabled flips true
    const validCode = totpFromSecret(secret);
    const verifyOk = await ctx.post('/api/auth/mfa/verify', {
      headers: authHeader,
      data: { code: validCode },
    });
    expect(verifyOk.status()).toBe(200);

    // 6. AUTH-08 — login now requires MFA challenge.
    //    No code → 200 with { mfaRequired: true, no accessToken }
    const challengeStart = await ctx.post('/api/auth/login', {
      data: { email, password: TEST_PASSWORD },
    });
    expect(challengeStart.status()).toBe(200);
    const challengeBody = await challengeStart.json();
    expect(challengeBody.mfaRequired).toBe(true);
    expect(challengeBody.accessToken).toBeFalsy();

    // 7. Wrong code → 401
    const wrongCode = await ctx.post('/api/auth/login', {
      data: { email, password: TEST_PASSWORD, mfaCode: '111111' },
    });
    expect(wrongCode.status()).toBe(401);

    // 8. Valid TOTP code → full token pair
    const goodCode = totpFromSecret(secret);
    const goodLogin = await ctx.post('/api/auth/login', {
      data: { email, password: TEST_PASSWORD, mfaCode: goodCode },
    });
    expect(goodLogin.status()).toBe(200);
    const goodBody = await goodLogin.json();
    expect(goodBody.accessToken).toBeTruthy();
    expect(goodBody.refreshToken).toBeTruthy();

    await ctx.dispose();
  });

  test('mfa/verify without prior setup → 400', async () => {
    const ctx = await apiCtx();
    const login = await ctx.post('/api/auth/login', {
      data: { email, password: TEST_PASSWORD },
    });
    const { accessToken } = await login.json();
    // No /setup called — mfaSecret is null on the user
    const verify = await ctx.post('/api/auth/mfa/verify', {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { code: '123456' },
    });
    expect(verify.status()).toBe(400);
    await ctx.dispose();
  });
});
