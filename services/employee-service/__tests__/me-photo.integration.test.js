'use strict';
/**
 * Integration tests for POST /employees/me/photo and GET /employees/me/photo.
 *
 * Covers two cases for resolveEmployeeId:
 *   A) JWT contains employeeId  — use it directly (normal path)
 *   B) JWT has employeeId=null  — fall back to DB lookup by email (stale-JWT path)
 *   C) Neither resolves         — 400 "No employee profile linked to this account"
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mutable user injected by authenticate — prefix `mock` so Jest hoisting allows it
let mockCurrentUser = { sub: 'user-001', email: 'alice@company.com', role: 'EMPLOYEE', employeeId: 'emp-001' };
const setUser = (u) => { mockCurrentUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockCurrentUser; next(); },
  authorize: () => (_req, _res, next) => next(),
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encryptFields: (obj) => obj,
  decrypt: (val) => val,
}), { virtual: true });

const mockFindUnique  = jest.fn();
const mockFindMany    = jest.fn();
const mockFindFirst   = jest.fn();
const mockCount       = jest.fn();
const mockCreate      = jest.fn();
const mockUpdate      = jest.fn();
const mockAuditCreate = jest.fn().mockResolvedValue({});

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    employee: {
      findUnique: mockFindUnique, findFirst: mockFindUnique,
      findMany:   mockFindMany,
      findFirst:  mockFindFirst,
      count:      mockCount,
      create:     mockCreate,
      update:     mockUpdate,
    },
    auditLog:           { create: mockAuditCreate },
    employeeApplication: { findMany: jest.fn().mockResolvedValue([]) },
    salaryHistory:      { findMany: jest.fn().mockResolvedValue([]) },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

// ── App ───────────────────────────────────────────────────────────────────────
const request = require('supertest');
const app = require('../src/index');

const PHOTO_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABtest';

afterEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { sub: 'user-001', email: 'alice@company.com', role: 'EMPLOYEE', employeeId: 'emp-001' };
});

// ── POST /employees/me/photo ───────────────────────────────────────────────────

describe('POST /employees/me/photo', () => {
  describe('Case A — JWT has employeeId (normal path)', () => {
    test('200 — saves photo when employeeId is in JWT', async () => {
      mockUpdate.mockResolvedValue({ id: 'emp-001', profilePhotoUrl: PHOTO_URL });

      const res = await request(app)
        .post('/employees/me/photo')
        .send({ profilePhotoUrl: PHOTO_URL });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.profilePhotoUrl).toBe(PHOTO_URL);
      expect(mockFindFirst).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'emp-001' }, data: { profilePhotoUrl: PHOTO_URL } })
      );
    });

    test('400 — rejects non-base64 image data', async () => {
      const res = await request(app)
        .post('/employees/me/photo')
        .send({ profilePhotoUrl: 'http://evil.com/photo.jpg' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/base64/i);
    });

    test('200 — writes UPDATE_PHOTO audit log entry', async () => {
      mockUpdate.mockResolvedValue({ id: 'emp-001', employeeCode: 'EMP-001', fullName: 'Alice Tan', profilePhotoUrl: PHOTO_URL });

      const res = await request(app)
        .post('/employees/me/photo')
        .send({ profilePhotoUrl: PHOTO_URL });

      expect(res.status).toBe(200);
      expect(mockAuditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'UPDATE_PHOTO',
            entityId: 'emp-001',
          }),
        })
      );
    });
  });

  describe('Case B — JWT has employeeId=null, falls back to email lookup (stale-JWT path)', () => {
    beforeEach(() => {
      setUser({ sub: 'user-001', email: 'alice@company.com', role: 'EMPLOYEE', employeeId: null });
    });

    test('200 — saves photo after resolving employeeId via email', async () => {
      mockFindFirst.mockResolvedValue({ id: 'emp-001' });
      mockUpdate.mockResolvedValue({ id: 'emp-001', profilePhotoUrl: PHOTO_URL });

      const res = await request(app)
        .post('/employees/me/photo')
        .send({ profilePhotoUrl: PHOTO_URL });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workEmail: { equals: 'alice@company.com', mode: 'insensitive' } },
        })
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'emp-001' } })
      );
    });

    test('400 — returns linked error when email has no matching employee', async () => {
      mockFindFirst.mockResolvedValue(null);

      const res = await request(app)
        .post('/employees/me/photo')
        .send({ profilePhotoUrl: PHOTO_URL });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/No employee profile linked/i);
    });
  });

  describe('Case C — neither employeeId nor email resolves', () => {
    test('400 — no link when both employeeId and email are absent', async () => {
      setUser({ sub: 'user-001', email: null, role: 'EMPLOYEE', employeeId: null });

      const res = await request(app)
        .post('/employees/me/photo')
        .send({ profilePhotoUrl: PHOTO_URL });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/No employee profile linked/i);
    });
  });
});

// ── GET /employees/me/photo ────────────────────────────────────────────────────

describe('GET /employees/me/photo', () => {
  test('200 — returns photo when employeeId is in JWT', async () => {
    mockFindUnique.mockResolvedValue({ profilePhotoUrl: PHOTO_URL });

    const res = await request(app).get('/employees/me/photo');

    expect(res.status).toBe(200);
    expect(res.body.profilePhotoUrl).toBe(PHOTO_URL);
  });

  test('200 — returns photo when JWT has null employeeId but email resolves', async () => {
    setUser({ sub: 'user-001', email: 'alice@company.com', role: 'EMPLOYEE', employeeId: null });
    mockFindFirst.mockResolvedValue({ id: 'emp-001' });
    mockFindUnique.mockResolvedValue({ profilePhotoUrl: PHOTO_URL });

    const res = await request(app).get('/employees/me/photo');

    expect(res.status).toBe(200);
    expect(res.body.profilePhotoUrl).toBe(PHOTO_URL);
  });

  test('200 — returns null when employee has no photo', async () => {
    mockFindUnique.mockResolvedValue({ profilePhotoUrl: null });

    const res = await request(app).get('/employees/me/photo');

    expect(res.status).toBe(200);
    expect(res.body.profilePhotoUrl).toBeNull();
  });

  test('400 — unlinked account returns error', async () => {
    setUser({ sub: 'user-001', email: null, role: 'EMPLOYEE', employeeId: null });

    const res = await request(app).get('/employees/me/photo');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No employee profile linked/i);
  });
});
