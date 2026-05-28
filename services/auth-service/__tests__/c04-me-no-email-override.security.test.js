'use strict';
/**
 * Security regression test for C-04:
 *   The /auth/me endpoint must NOT override the DB-assigned role based on
 *   the user's email address. The prior backdoor forced
 *     email === 'admin@vorkhive.sg' || 'admin@hrms.com'  →  role: 'SUPER_ADMIN'
 *   regardless of what the DB said. That is now removed.
 *
 * These tests pin the new behaviour to prevent regression.
 */

let mockUser = { sub: 'user-001', role: 'EMPLOYEE', email: 'admin@vorkhive.sg' };
const setUser = (u) => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

jest.mock('dotenv', () => ({ config: () => {} }));

const mockUserFindUnique = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: { findUnique: mockUserFindUnique, findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn() },
    role: { findFirst: jest.fn() },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  })),
}));

jest.mock('../src/utils/jwt.utils', () => ({
  generateKeysIfNeeded: jest.fn().mockResolvedValue(undefined),
  getPublicKey:  jest.fn().mockReturnValue('fake-public-key'),
  getPrivateKey: jest.fn().mockReturnValue('fake-private-key'),
}));

process.env.INTERNAL_SERVICE_KEY = 'test-internal-key-2025';
process.env.INVITE_TOKEN_SECRET  = 'a'.repeat(64);

const request = require('supertest');
const app = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'user-001', role: 'EMPLOYEE', email: 'admin@vorkhive.sg' });
});

function dbUser(email, roleName) {
  return {
    id: 'user-001',
    email,
    name: 'Test User',
    employeeId: 'emp-001',
    isActive: true,
    role: { id: 'role-001', name: roleName, permissions: [] },
  };
}

// ── C04-01 ──────────────────────────────────────────────────────────────────
test('C04-01 GET /auth/me returns DB role EMPLOYEE even when email is admin@vorkhive.sg', async () => {
  setUser({ email: 'admin@vorkhive.sg' });
  mockUserFindUnique.mockResolvedValue(dbUser('admin@vorkhive.sg', 'EMPLOYEE'));

  const res = await request(app).get('/auth/me');
  expect(res.status).toBe(200);
  expect(res.body.role).toBe('EMPLOYEE');
  expect(res.body.role).not.toBe('SUPER_ADMIN');
});

// ── C04-02 ──────────────────────────────────────────────────────────────────
test('C04-02 GET /auth/me returns DB role EMPLOYEE even when email is admin@hrms.com', async () => {
  setUser({ email: 'admin@hrms.com' });
  mockUserFindUnique.mockResolvedValue(dbUser('admin@hrms.com', 'EMPLOYEE'));

  const res = await request(app).get('/auth/me');
  expect(res.status).toBe(200);
  expect(res.body.role).toBe('EMPLOYEE');
});

// ── C04-03 ──────────────────────────────────────────────────────────────────
test('C04-03 GET /auth/me honours legitimate SUPER_ADMIN role from DB', async () => {
  setUser({ email: 'real-admin@company.sg' });
  mockUserFindUnique.mockResolvedValue(dbUser('real-admin@company.sg', 'SUPER_ADMIN'));

  const res = await request(app).get('/auth/me');
  expect(res.status).toBe(200);
  expect(res.body.role).toBe('SUPER_ADMIN');
});

// ── C04-04 ──────────────────────────────────────────────────────────────────
test('C04-04 GET /auth/me falls back to EMPLOYEE when DB role is missing', async () => {
  setUser({ email: 'foo@company.sg' });
  mockUserFindUnique.mockResolvedValue({
    id: 'user-001', email: 'foo@company.sg', name: 'Foo',
    employeeId: null, isActive: true, role: null,
  });

  const res = await request(app).get('/auth/me');
  expect(res.status).toBe(200);
  expect(res.body.role).toBe('EMPLOYEE');
});

// ── C04-05 ──────────────────────────────────────────────────────────────────
test('C04-05 GET /auth/me returns 404 when user record absent', async () => {
  mockUserFindUnique.mockResolvedValue(null);

  const res = await request(app).get('/auth/me');
  expect(res.status).toBe(404);
});
