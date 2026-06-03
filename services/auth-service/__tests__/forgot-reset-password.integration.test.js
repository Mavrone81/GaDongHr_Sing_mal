'use strict';
/**
 * Integration tests for the self-service password-reset flow:
 *   POST /auth/forgot-password — request a reset link (public, no enumeration)
 *   POST /auth/reset-password  — consume a token and set a new password (public)
 *
 * Prisma, jwt-utils, dotenv and global.fetch are mocked so the suite runs with
 * no DB, no key files and no network — same approach as user-link.integration.
 */
const crypto = require('crypto');

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('dotenv', () => ({ config: () => {} }));

const mockFindUnique    = jest.fn();
const mockUpdate        = jest.fn().mockResolvedValue({});
const mockRefreshUpdate = jest.fn().mockResolvedValue({ count: 1 });
const mockAuditCreate   = jest.fn().mockResolvedValue({});
const mockQueryRaw      = jest.fn().mockResolvedValue([]);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: { findUnique: mockFindUnique, update: mockUpdate, findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    role: { findFirst: jest.fn() },
    refreshToken: { updateMany: mockRefreshUpdate, findUnique: jest.fn(), create: jest.fn() },
    auditLog: { create: mockAuditCreate },
    $queryRaw: mockQueryRaw,
    $executeRaw: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  })),
}));

// Stub jwt-utils so the module loads without real key files.
jest.mock('../src/utils/jwt.utils', () => ({
  generateKeysIfNeeded: jest.fn().mockResolvedValue(undefined),
  signAccessToken: jest.fn().mockReturnValue('access-token'),
  signRefreshToken: jest.fn().mockReturnValue('refresh-token'),
  verifyToken: jest.fn(),
  getPublicKey: jest.fn().mockReturnValue('fake-public-key'),
  getPrivateKey: jest.fn().mockReturnValue('fake-private-key'),
}));

// ── App ───────────────────────────────────────────────────────────────────────
process.env.INTERNAL_SERVICE_KEY = 'test-internal-key-2025';
process.env.INVITE_TOKEN_SECRET  = 'a'.repeat(64);
// The reset endpoints share a 5-req/15min IP limiter; lift it so the suite's
// many requests from 127.0.0.1 aren't throttled to 429.
process.env.RESET_RATELIMIT_MAX  = '1000';

const request = require('supertest');
const app = require('../src/index');

const sha256 = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdate.mockResolvedValue({});
  mockRefreshUpdate.mockResolvedValue({ count: 1 });
  mockAuditCreate.mockResolvedValue({});
  // Mock the notification-service email call.
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

function makeUser(overrides = {}) {
  return {
    id: 'user-001',
    email: 'alice@company.com',
    name: 'Alice Tan',
    isActive: true,
    passwordHash: '$2b$12$existinghash',
    resetTokenHash: null,
    resetTokenExpiry: null,
    ...overrides,
  };
}

// ── POST /auth/forgot-password ─────────────────────────────────────────────────
describe('POST /auth/forgot-password', () => {
  test('400 when email is missing', async () => {
    const res = await request(app).post('/auth/forgot-password').send({});
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('200 generic message for an unknown email — no enumeration, no token minted', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(app).post('/auth/forgot-password').send({ email: 'nobody@company.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/if that email is registered/i);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('200 generic message for an inactive account — no token minted', async () => {
    mockFindUnique.mockResolvedValue(makeUser({ isActive: false }));
    const res = await request(app).post('/auth/forgot-password').send({ email: 'alice@company.com' });
    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('active user: mints a token, stores only its HASH (+1h expiry), and emails a link', async () => {
    mockFindUnique.mockResolvedValue(makeUser());
    const res = await request(app).post('/auth/forgot-password').send({ email: 'Alice@Company.com' });
    expect(res.status).toBe(200);

    // Email lookup is lowercased.
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { email: 'alice@company.com' } });

    // A reset token hash + future expiry was persisted.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.resetTokenHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    expect(new Date(data.resetTokenExpiry).getTime()).toBeGreaterThan(Date.now());

    // The raw token is emailed, and only its hash is stored.
    const emailBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    const rawToken = emailBody.text.match(/token=([a-f0-9]+)/)[1];
    expect(sha256(rawToken)).toBe(data.resetTokenHash);
    expect(data.resetTokenHash).not.toBe(rawToken);

    // Email goes via the internal-service-key, not a forged JWT.
    expect(global.fetch.mock.calls[0][1].headers['x-internal-service-key']).toBe('test-internal-key-2025');
    expect(mockAuditCreate).toHaveBeenCalled();
  });

  test('still returns 200 even if the email send throws', async () => {
    mockFindUnique.mockResolvedValue(makeUser());
    global.fetch = jest.fn().mockRejectedValue(new Error('smtp down'));
    const res = await request(app).post('/auth/forgot-password').send({ email: 'alice@company.com' });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled(); // token still persisted
  });

  test('logs a failure when notification-service responds non-2xx (regression: silent swallow)', async () => {
    // fetch() resolves (no network error) but the response is a 401 — the case
    // that hid a broken reset flow in prod, where a bad INTERNAL_SERVICE_KEY
    // returned "link sent" while nothing was actually emailed.
    mockFindUnique.mockResolvedValue(makeUser());
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app).post('/auth/forgot-password').send({ email: 'alice@company.com' });

    expect(res.status).toBe(200);            // still non-blocking / no enumeration
    expect(mockUpdate).toHaveBeenCalled();   // token still persisted
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/email send failed.*401/i));
    errSpy.mockRestore();
  });
});

// ── POST /auth/reset-password ──────────────────────────────────────────────────
describe('POST /auth/reset-password', () => {
  test('400 when token or password missing', async () => {
    expect((await request(app).post('/auth/reset-password').send({ newPassword: 'longenough' })).status).toBe(400);
    expect((await request(app).post('/auth/reset-password').send({ token: 'abc' })).status).toBe(400);
  });

  test('400 when password shorter than 8 chars', async () => {
    const res = await request(app).post('/auth/reset-password').send({ token: 'abc', newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('400 for an unknown/invalid token', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(app).post('/auth/reset-password').send({ token: 'deadbeef', newPassword: 'newpassword1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('400 for an expired token', async () => {
    mockFindUnique.mockResolvedValue(makeUser({
      resetTokenHash: sha256('rawtoken'),
      resetTokenExpiry: new Date(Date.now() - 1000), // already expired
    }));
    const res = await request(app).post('/auth/reset-password').send({ token: 'rawtoken', newPassword: 'newpassword1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid or expired/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('looks the user up by the HASH of the supplied token (not the raw token)', async () => {
    mockFindUnique.mockResolvedValue(makeUser({
      resetTokenHash: sha256('rawtoken'),
      resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    }));
    await request(app).post('/auth/reset-password').send({ token: 'rawtoken', newPassword: 'newpassword1' });
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { resetTokenHash: sha256('rawtoken') } });
  });

  test('valid token: sets a new hash, clears the reset token, and revokes all sessions', async () => {
    mockFindUnique.mockResolvedValue(makeUser({
      resetTokenHash: sha256('rawtoken'),
      resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    }));
    const res = await request(app).post('/auth/reset-password').send({ token: 'rawtoken', newPassword: 'newpassword1' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/successful/i);

    const data = mockUpdate.mock.calls[0][0].data;
    expect(data.passwordHash).toEqual(expect.any(String));
    expect(data.passwordHash).not.toBe('newpassword1'); // hashed, not plaintext
    expect(data.resetTokenHash).toBeNull();
    expect(data.resetTokenExpiry).toBeNull();
    expect(data.failedLogins).toBe(0);
    expect(data.lockedUntil).toBeNull();

    // All active sessions invalidated.
    expect(mockRefreshUpdate).toHaveBeenCalledWith({ where: { userId: 'user-001' }, data: { isRevoked: true } });
    expect(mockAuditCreate).toHaveBeenCalled();
  });
});
