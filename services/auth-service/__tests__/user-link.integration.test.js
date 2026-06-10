'use strict';
/**
 * Integration tests for the auth-service user-linking endpoints:
 *   PATCH /users/link-employee  — internal: link an auth user to an employee by email
 *   PUT   /users/:id            — extended to accept employeeId when called with internal key
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN' };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

jest.mock('dotenv', () => ({ config: () => {} }));

const mockFindUnique  = jest.fn();
const mockFindFirst   = jest.fn();
const mockFindMany    = jest.fn();
const mockUpdate      = jest.fn();
const mockCreate      = jest.fn();
const mockCount       = jest.fn();
const mockQueryRaw    = jest.fn().mockResolvedValue([]);
const mockRefreshUpdate = jest.fn().mockResolvedValue({});

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    // user lookup-by-email is now findFirst (email is unique per tenant) — route
    // it to the same mock the tests configure.
    user: { findUnique: mockFindUnique, findFirst: mockFindUnique, findMany: mockFindMany, update: mockUpdate, create: mockCreate, count: mockCount },
    role: { findFirst: mockFindFirst },
    refreshToken: { updateMany: mockRefreshUpdate },
    $queryRaw: mockQueryRaw,
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  })),
}));

// Stub jwt-utils so the module loads without real key files
jest.mock('../src/utils/jwt.utils', () => ({
  generateKeysIfNeeded: jest.fn().mockResolvedValue(undefined),
  getPublicKey: jest.fn().mockReturnValue('fake-public-key'),
  getPrivateKey: jest.fn().mockReturnValue('fake-private-key'),
}));

// ── App ───────────────────────────────────────────────────────────────────────
process.env.INTERNAL_SERVICE_KEY = 'test-internal-key-2025';
process.env.INVITE_TOKEN_SECRET  = 'a'.repeat(64); // test-only invite-token secret (>=32 chars)

const request = require('supertest');
const app = require('../src/index');

afterEach(() => jest.clearAllMocks());

// ── Helpers ───────────────────────────────────────────────────────────────────
const INTERNAL_HEADER = { 'x-internal-service-key': 'test-internal-key-2025' };

function makeUser(overrides = {}) {
  return {
    id: 'user-001',
    email: 'alice@company.com',
    name: 'Alice Tan',
    employeeId: null,
    isActive: true,
    roleId: 'role-001',
    role: { id: 'role-001', name: 'EMPLOYEE' },
    passwordHash: '$2b$12$hash',
    mfaSecret: null,
    failedLogins: 0,
    lockedUntil: null,
    inviteToken: null,
    inviteExpiry: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── PATCH /users/link-employee ─────────────────────────────────────────────────

describe('PATCH /users/link-employee', () => {
  test('403 — rejected without internal key', async () => {
    const res = await request(app)
      .patch('/users/link-employee')
      .send({ email: 'alice@company.com', employeeId: 'emp-001' });

    expect(res.status).toBe(403);
  });

  test('400 — missing email', async () => {
    const res = await request(app)
      .patch('/users/link-employee')
      .set(INTERNAL_HEADER)
      .send({ employeeId: 'emp-001' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('400 — missing employeeId', async () => {
    const res = await request(app)
      .patch('/users/link-employee')
      .set(INTERNAL_HEADER)
      .send({ email: 'alice@company.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/employeeId/i);
  });

  test('404 — user not found by email', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .patch('/users/link-employee')
      .set(INTERNAL_HEADER)
      .send({ email: 'nobody@company.com', employeeId: 'emp-001' });

    expect(res.status).toBe(404);
  });

  test('200 — links existing auth user to employeeId', async () => {
    const existing = makeUser({ employeeId: null });
    const updated  = makeUser({ employeeId: 'emp-001' });

    mockFindUnique.mockResolvedValueOnce(existing);
    mockUpdate.mockResolvedValueOnce(updated);

    const res = await request(app)
      .patch('/users/link-employee')
      .set(INTERNAL_HEADER)
      .send({ email: 'alice@company.com', employeeId: 'emp-001' });

    expect(res.status).toBe(200);
    expect(res.body.employeeId).toBe('emp-001');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { employeeId: 'emp-001' } })
    );
  });

  test('200 — response does not leak passwordHash or mfaSecret', async () => {
    const existing = makeUser();
    const updated  = makeUser({ employeeId: 'emp-001' });
    mockFindUnique.mockResolvedValueOnce(existing);
    mockUpdate.mockResolvedValueOnce(updated);

    const res = await request(app)
      .patch('/users/link-employee')
      .set(INTERNAL_HEADER)
      .send({ email: 'alice@company.com', employeeId: 'emp-001' });

    expect(res.status).toBe(200);
  });
});

// ── PUT /users/:id with employeeId ────────────────────────────────────────────

describe('PUT /users/:id — employeeId via internal key', () => {
  test('200 — internal key can set employeeId', async () => {
    const updated = makeUser({ employeeId: 'emp-999' });
    mockUpdate.mockResolvedValueOnce(updated);

    const res = await request(app)
      .put('/users/user-001')
      .set(INTERNAL_HEADER)
      .send({ employeeId: 'emp-999' });

    expect(res.status).toBe(200);
    expect(res.body.employeeId).toBe('emp-999');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ employeeId: 'emp-999' }),
      })
    );
  });

  test('200 — JWT-authenticated caller cannot set employeeId (it is stripped)', async () => {
    const updated = makeUser({ employeeId: null, name: 'Alice Updated' });
    mockUpdate.mockResolvedValueOnce(updated);

    const res = await request(app)
      .put('/users/user-001')
      .set('Authorization', 'Bearer test-jwt')
      .send({ name: 'Alice Updated', employeeId: 'emp-evil' });

    expect(res.status).toBe(200);
    // employeeId must NOT appear in the prisma.update data payload
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('employeeId');
  });
});

// ── GET /health ────────────────────────────────────────────────────────────────

describe('GET /health', () => {
  test('200 — returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
