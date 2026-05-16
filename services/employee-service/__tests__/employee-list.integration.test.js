'use strict';
/**
 * Integration tests for GET /employees — verifies the employee list endpoint
 * returns profilePhotoUrl alongside other employee fields so the directory
 * table can display profile photos.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN' };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER', LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER' },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({
  encryptFields: (obj) => obj,
  decrypt: (val) => val,
}), { virtual: true });

const mockFindMany  = jest.fn();
const mockCount     = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate    = jest.fn();
const mockUpdate    = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    employee:           { findMany: mockFindMany, count: mockCount, findUnique: mockFindUnique, create: mockCreate, update: mockUpdate },
    auditLog:           { create: jest.fn().mockResolvedValue({}) },
    employeeApplication: { findMany: jest.fn().mockResolvedValue([]) },
    salaryHistory:      { findMany: jest.fn().mockResolvedValue([]) },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

// ── App ───────────────────────────────────────────────────────────────────────
const request = require('supertest');
const app = require('../src/index');

afterEach(() => jest.clearAllMocks());

// ── Helpers ───────────────────────────────────────────────────────────────────
const PHOTO_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD/test';

function makeEmployee(overrides = {}) {
  return {
    id: 'emp-001',
    employeeCode: 'EMP-001',
    fullName: 'Alice Tan',
    preferredName: 'Alice',
    department: 'Engineering',
    designation: 'Software Engineer',
    workEmail: 'alice@company.com',
    employmentType: 'FULL_TIME',
    startDate: new Date('2025-01-01').toISOString(),
    isActive: true,
    citizenshipStatus: 'SC',
    passType: null,
    profilePhotoUrl: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /employees', () => {
  test('200 — returns employees array with profilePhotoUrl field', async () => {
    mockFindMany.mockResolvedValue([makeEmployee()]);
    mockCount.mockResolvedValue(1);

    const res = await request(app)
      .get('/employees')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('employees');
    expect(Array.isArray(res.body.employees)).toBe(true);
    expect(res.body.employees[0]).toHaveProperty('profilePhotoUrl');
  });

  test('profilePhotoUrl is null when employee has no photo', async () => {
    mockFindMany.mockResolvedValue([makeEmployee({ profilePhotoUrl: null })]);
    mockCount.mockResolvedValue(1);

    const res = await request(app)
      .get('/employees')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.employees[0].profilePhotoUrl).toBeNull();
  });

  test('profilePhotoUrl is included when employee has a photo', async () => {
    mockFindMany.mockResolvedValue([makeEmployee({ profilePhotoUrl: PHOTO_URL })]);
    mockCount.mockResolvedValue(1);

    const res = await request(app)
      .get('/employees')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.employees[0].profilePhotoUrl).toBe(PHOTO_URL);
  });

  test('response includes expected employee fields alongside profilePhotoUrl', async () => {
    mockFindMany.mockResolvedValue([makeEmployee({ profilePhotoUrl: PHOTO_URL })]);
    mockCount.mockResolvedValue(1);

    const res = await request(app)
      .get('/employees')
      .set('Authorization', 'Bearer test-token');

    const emp = res.body.employees[0];
    expect(emp).toMatchObject({
      id:             'emp-001',
      employeeCode:   'EMP-001',
      fullName:       'Alice Tan',
      department:     'Engineering',
      designation:    'Software Engineer',
      employmentType: 'FULL_TIME',
      isActive:       true,
      profilePhotoUrl: PHOTO_URL,
    });
  });

  test('returns total and pagination metadata', async () => {
    mockFindMany.mockResolvedValue([makeEmployee()]);
    mockCount.mockResolvedValue(42);

    const res = await request(app)
      .get('/employees?page=1&limit=20')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(42);
    expect(res.body.pages).toBe(Math.ceil(42 / 20));
    expect(res.body.page).toBe(1);
  });

  test('multiple employees — all have profilePhotoUrl field', async () => {
    mockFindMany.mockResolvedValue([
      makeEmployee({ id: 'emp-001', profilePhotoUrl: PHOTO_URL }),
      makeEmployee({ id: 'emp-002', profilePhotoUrl: null }),
      makeEmployee({ id: 'emp-003', profilePhotoUrl: PHOTO_URL }),
    ]);
    mockCount.mockResolvedValue(3);

    const res = await request(app)
      .get('/employees')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body.employees).toHaveLength(3);
    res.body.employees.forEach((emp) => {
      expect(emp).toHaveProperty('profilePhotoUrl');
    });
    expect(res.body.employees[0].profilePhotoUrl).toBe(PHOTO_URL);
    expect(res.body.employees[1].profilePhotoUrl).toBeNull();
  });
});

describe('GET /health', () => {
  test('200 — service health ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
