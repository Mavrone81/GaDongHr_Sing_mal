'use strict';
/**
 * Integration tests for clock-in and clock-out endpoints.
 *
 * Prisma client and auth middleware are mocked so no database or JWT service
 * is needed. Tests verify HTTP status codes, response shapes, and business
 * rules (geofence blocking, no-clock-in guard, OT calculation).
 */

// ── Mocks must be hoisted before app require ──────────────────────────────────

const EMPLOYEE_ID = 'test-employee-uuid-001';

// Mock auth-middleware via the absolute path the app imports.
// moduleNameMapper in package.json redirects this to __mocks__/auth-middleware.js
// but jest.mock() here overrides that stub with a version that sets req.user.
jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      sub: 'user-001',
      email: 'emp@test.com',
      role: 'EMPLOYEE',
      employeeId: EMPLOYEE_ID,
    };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    HR_ADMIN: 'HR_ADMIN',
    HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER',
    LINE_MANAGER: 'LINE_MANAGER',
    EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

// Mock PrismaClient — individual methods replaced per-test.
const mockUpsert     = jest.fn();
const mockFindFirst  = jest.fn();
const mockUpdate     = jest.fn();
const mockFindMany   = jest.fn();
const mockCreate     = jest.fn();
const mockEWLFindMany = jest.fn().mockResolvedValue([]); // no geofence by default

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    attendanceRecord:     { upsert: mockUpsert, findFirst: mockFindFirst, update: mockUpdate, findMany: mockFindMany },
    auditLog:             { create: mockCreate },
    employeeWorkLocation: { findMany: mockEWLFindMany },
    shiftTemplate:        { findMany: jest.fn().mockResolvedValue([]) },
    workingShift:         { findMany: jest.fn().mockResolvedValue([]) },
    rosterEntry:          { findMany: jest.fn().mockResolvedValue([]) },
    workLocation:         { findMany: jest.fn().mockResolvedValue([]) },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

// ── Supertest setup ───────────────────────────────────────────────────────────
const request = require('supertest');
const app = require('../src/index');

afterEach(() => jest.clearAllMocks());

// ── Helpers ────────────────────────────────────────────────────────────────────
function makeRecord(overrides = {}) {
  return {
    id: 'rec-001',
    employeeId: EMPLOYEE_ID,
    date: new Date().toISOString(),
    clockIn: new Date('2026-05-16T01:00:00Z').toISOString(), // 09:00 SGT
    clockOut: null,
    hoursWorked: null,
    otHours: 0,
    status: 'PRESENT',
    withinGeofence: null,
    locationName: null,
    ...overrides,
  };
}

// ── Health check ──────────────────────────────────────────────────────────────
describe('GET /health', () => {
  test('returns 200 and ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('attendance-service');
  });
});

// ── Clock-in ──────────────────────────────────────────────────────────────────
describe('POST /attendance/clock-in', () => {
  test('200 — creates/updates record and returns it', async () => {
    const record = makeRecord();
    mockUpsert.mockResolvedValue(record);

    const res = await request(app)
      .post('/attendance/clock-in')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.employeeId).toBe(EMPLOYEE_ID);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  test('upsert is called with correct employeeId from JWT', async () => {
    mockUpsert.mockResolvedValue(makeRecord());

    await request(app)
      .post('/attendance/clock-in')
      .set('Authorization', 'Bearer test-token')
      .send({});

    const call = mockUpsert.mock.calls[0][0];
    expect(call.where.employeeId_date.employeeId).toBe(EMPLOYEE_ID);
  });

  test('403 — blocked when employee is outside all assigned geofences', async () => {
    // Return one active geofence near Raffles Place
    mockEWLFindMany.mockResolvedValueOnce([{
      workLocation: {
        id: 'loc-1',
        name: 'HQ',
        latitude: 1.2841,
        longitude: 103.8514,
        radiusMetres: 50,
        isActive: true,
      },
    }]);

    // Employee sends KL coordinates — far outside the 50m geofence
    const res = await request(app)
      .post('/attendance/clock-in')
      .set('Authorization', 'Bearer test-token')
      .send({ latitude: 3.1390, longitude: 101.6869 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/outside/i);
  });

  test('200 — no geofence assigned → clock-in allowed regardless of coordinates', async () => {
    // Default mockEWLFindMany returns [] meaning no location restriction
    mockUpsert.mockResolvedValue(makeRecord());

    const res = await request(app)
      .post('/attendance/clock-in')
      .set('Authorization', 'Bearer test-token')
      .send({ latitude: 99.0, longitude: 99.0 }); // arbitrary coords

    expect(res.status).toBe(200);
  });
});

// ── Clock-out ──────────────────────────────────────────────────────────────────
describe('POST /attendance/clock-out', () => {
  test('400 — no prior clock-in record returns error', async () => {
    mockFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .post('/attendance/clock-out')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no clock-in/i);
  });

  test('400 — record exists but clockIn is null returns error', async () => {
    mockFindFirst.mockResolvedValue(makeRecord({ clockIn: null }));

    const res = await request(app)
      .post('/attendance/clock-out')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(400);
  });

  test('200 — returns updated record with hoursWorked and otHours', async () => {
    const clockIn = new Date('2026-05-16T01:00:00Z'); // 09:00 SGT
    mockFindFirst.mockResolvedValue(makeRecord({ clockIn }));

    // Clock out at 10:00 UTC = 18:00 SGT → 9h worked, 1h OT
    mockUpdate.mockResolvedValue({
      ...makeRecord({ clockIn }),
      clockOut: new Date('2026-05-16T10:00:00Z').toISOString(),
      hoursWorked: 9.00,
      otHours: 1.00,
    });

    const res = await request(app)
      .post('/attendance/clock-out')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.hoursWorked).toBe(9.00);
    expect(res.body.otHours).toBe(1.00);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('update called with correct record id', async () => {
    const clockIn = new Date('2026-05-16T01:00:00Z');
    mockFindFirst.mockResolvedValue(makeRecord({ id: 'rec-unique-99', clockIn }));
    mockUpdate.mockResolvedValue(makeRecord({ id: 'rec-unique-99', clockIn }));

    await request(app)
      .post('/attendance/clock-out')
      .set('Authorization', 'Bearer test-token')
      .send({});

    expect(mockUpdate.mock.calls[0][0].where.id).toBe('rec-unique-99');
  });
});
