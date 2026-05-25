'use strict';
/**
 * Integration tests for LEA-004:
 *   GET /leave/mc-patterns
 *   GET /leave/sick-leave-trends
 *
 * Verifies auth enforcement, query-param validation, and response shapes.
 * All DB and HTTP calls are mocked.
 */

// ── Auth middleware mock ───────────────────────────────────────────────────────

let mockCurrentUser = { sub: 'hr-001', email: 'hr@test.com', role: 'HR_ADMIN', employeeId: null };
const setUser = u => { mockCurrentUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockCurrentUser; next(); },
  authorize:          (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

// ── Prisma mock ────────────────────────────────────────────────────────────────

const mockLeaveTypesFindMany  = jest.fn();
const mockLeaveAppsFindMany   = jest.fn();
const mockLeaveAppFindUnique  = jest.fn();
const mockLeaveEntFindFirst   = jest.fn();
const mockLeaveEntUpdateMany  = jest.fn();
const mockLeaveAppUpdate      = jest.fn();
const mockLeaveAppCreate      = jest.fn();
const mockLeaveEntUpsert      = jest.fn();
const mockPublicHolidayFindMany = jest.fn().mockResolvedValue([]);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    leaveType:        { findMany: mockLeaveTypesFindMany, findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
    leaveApplication: { findMany: mockLeaveAppsFindMany, findUnique: mockLeaveAppFindUnique, update: mockLeaveAppUpdate, create: mockLeaveAppCreate },
    leaveEntitlement: { findMany: jest.fn().mockResolvedValue([]), findFirst: mockLeaveEntFindFirst, updateMany: mockLeaveEntUpdateMany, upsert: mockLeaveEntUpsert },
    publicHoliday:    { findMany: mockPublicHolidayFindMany, create: jest.fn() },
    leaveApprovalStep: { create: jest.fn().mockResolvedValue({}) },
    $executeRaw:      jest.fn().mockResolvedValue(0),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

// ── Axios mock (employee-service lookups) ──────────────────────────────────────

const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({ get: mockAxiosGet }));

// ── App ───────────────────────────────────────────────────────────────────────

const request = require('supertest');
const app     = require('../src/index');

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SICK_TYPE = { id: 'lt-sick', code: 'SICK', name: 'Sick Leave', requiresDocument: false, isActive: true };

// Applications: emp1 always takes Mondays, emp2 mid-week only
const MONDAY_APPS = [
  { employeeId: 'emp1', startDate: new Date('2024-01-08'), endDate: new Date('2024-01-08'), totalDays: 1 }, // Mon
  { employeeId: 'emp1', startDate: new Date('2024-01-15'), endDate: new Date('2024-01-15'), totalDays: 1 }, // Mon
  { employeeId: 'emp1', startDate: new Date('2024-01-22'), endDate: new Date('2024-01-22'), totalDays: 1 }, // Mon
];

const MIDWEEK_APPS = [
  { employeeId: 'emp2', startDate: new Date('2024-01-09'), endDate: new Date('2024-01-11'), totalDays: 3 }, // Tue-Thu
  { employeeId: 'emp2', startDate: new Date('2024-01-16'), endDate: new Date('2024-01-18'), totalDays: 3 },
  { employeeId: 'emp2', startDate: new Date('2024-01-23'), endDate: new Date('2024-01-25'), totalDays: 3 },
];

// ── GET /leave/mc-patterns ─────────────────────────────────────────────────────

describe('GET /leave/mc-patterns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUser({ sub: 'hr-001', role: 'HR_ADMIN', employeeId: null });
    mockLeaveTypesFindMany.mockResolvedValue([SICK_TYPE]);
    mockAxiosGet.mockResolvedValue({ data: { fullName: 'Alice', department: 'Eng', designation: 'SE' } });
  });

  test('403 for EMPLOYEE role', async () => {
    setUser({ sub: 'e1', role: 'EMPLOYEE', employeeId: 'emp1' });
    mockLeaveAppsFindMany.mockResolvedValue([]);
    const res = await request(app).get('/leave/mc-patterns');
    expect(res.status).toBe(403);
  });

  test('200 with flagged array for HR_ADMIN', async () => {
    mockLeaveAppsFindMany.mockResolvedValue(MONDAY_APPS);
    const res = await request(app).get('/leave/mc-patterns');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('flagged');
    expect(Array.isArray(res.body.flagged)).toBe(true);
  });

  test('Monday-pattern employee is in flagged results', async () => {
    mockLeaveAppsFindMany.mockResolvedValue(MONDAY_APPS);
    const res = await request(app).get('/leave/mc-patterns');
    const flagged = res.body.flagged;
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    expect(flagged[0].employeeId).toBe('emp1');
    expect(flagged[0].patternType).toBe('MONDAY_PATTERN');
    expect(flagged[0].severity).toBe('HIGH');
  });

  test('mid-week-only employee is NOT flagged', async () => {
    mockLeaveAppsFindMany.mockResolvedValue(MIDWEEK_APPS);
    const res = await request(app).get('/leave/mc-patterns');
    expect(res.body.flagged).toHaveLength(0);
  });

  test('employee details are enriched from employee-service', async () => {
    mockLeaveAppsFindMany.mockResolvedValue(MONDAY_APPS);
    const res = await request(app).get('/leave/mc-patterns');
    const flagged = res.body.flagged;
    expect(flagged[0].employee).not.toBeNull();
    expect(flagged[0].employee.name).toBe('Alice');
    expect(flagged[0].employee.department).toBe('Eng');
  });

  test('employee enrichment failure returns null (graceful degradation)', async () => {
    mockLeaveAppsFindMany.mockResolvedValue(MONDAY_APPS);
    mockAxiosGet.mockRejectedValue(new Error('employee-service down'));
    const res = await request(app).get('/leave/mc-patterns');
    expect(res.status).toBe(200);
    expect(res.body.flagged[0].employee).toBeNull();
  });

  test('returns empty flagged when no sick leave types defined', async () => {
    mockLeaveTypesFindMany.mockResolvedValue([]);
    const res = await request(app).get('/leave/mc-patterns');
    expect(res.status).toBe(200);
    expect(res.body.flagged).toHaveLength(0);
  });

  test('months query param is forwarded (analysedMonths in response)', async () => {
    mockLeaveAppsFindMany.mockResolvedValue([]);
    const res = await request(app).get('/leave/mc-patterns?months=6');
    expect(res.status).toBe(200);
    expect(res.body.analysedMonths).toBe(6);
  });

  test('months is clamped to max 36', async () => {
    mockLeaveAppsFindMany.mockResolvedValue([]);
    const res = await request(app).get('/leave/mc-patterns?months=100');
    expect(res.body.analysedMonths).toBe(36);
  });

  test('200 for HR_MANAGER role', async () => {
    setUser({ sub: 'mgr-01', role: 'HR_MANAGER', employeeId: null });
    mockLeaveAppsFindMany.mockResolvedValue(MONDAY_APPS);
    const res = await request(app).get('/leave/mc-patterns');
    expect(res.status).toBe(200);
  });
});

// ── GET /leave/sick-leave-trends ───────────────────────────────────────────────

describe('GET /leave/sick-leave-trends', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUser({ sub: 'hr-001', role: 'HR_ADMIN', employeeId: null });
    mockLeaveTypesFindMany.mockResolvedValue([SICK_TYPE]);
    mockAxiosGet.mockResolvedValue({ data: { fullName: 'Alice', department: 'Engineering' } });
  });

  test('403 for EMPLOYEE role', async () => {
    setUser({ sub: 'e1', role: 'EMPLOYEE', employeeId: 'emp1' });
    mockLeaveAppsFindMany.mockResolvedValue([]);
    const res = await request(app).get('/leave/sick-leave-trends');
    expect(res.status).toBe(403);
  });

  test('200 with byEmployee and byDepartment arrays', async () => {
    mockLeaveAppsFindMany.mockResolvedValue([...MONDAY_APPS, ...MIDWEEK_APPS]);
    const res = await request(app).get('/leave/sick-leave-trends');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.byEmployee)).toBe(true);
    expect(Array.isArray(res.body.byDepartment)).toBe(true);
  });

  test('byEmployee sorted by totalDays descending', async () => {
    // emp2 has more total sick days
    mockLeaveAppsFindMany.mockResolvedValue([...MONDAY_APPS, ...MIDWEEK_APPS]);
    const res = await request(app).get('/leave/sick-leave-trends');
    const { byEmployee } = res.body;
    for (let i = 0; i < byEmployee.length - 1; i++) {
      expect(byEmployee[i].totalDays).toBeGreaterThanOrEqual(byEmployee[i + 1].totalDays);
    }
  });

  test('byEmployee capped at 20 results', async () => {
    // Create 25 unique employees each with 1 sick day
    const manyApps = Array.from({ length: 25 }, (_, i) => ({
      employeeId: `emp${i}`,
      startDate: new Date('2024-03-04'),
      endDate: new Date('2024-03-04'),
      totalDays: 1,
    }));
    mockLeaveAppsFindMany.mockResolvedValue(manyApps);
    const res = await request(app).get('/leave/sick-leave-trends');
    expect(res.body.byEmployee.length).toBeLessThanOrEqual(20);
  });

  test('returns analysedMonths in response', async () => {
    mockLeaveAppsFindMany.mockResolvedValue([]);
    const res = await request(app).get('/leave/sick-leave-trends?months=3');
    expect(res.body.analysedMonths).toBe(3);
  });

  test('empty response when no sick leave types', async () => {
    mockLeaveTypesFindMany.mockResolvedValue([]);
    const res = await request(app).get('/leave/sick-leave-trends');
    expect(res.status).toBe(200);
    expect(res.body.byEmployee).toHaveLength(0);
    expect(res.body.byDepartment).toHaveLength(0);
  });

  test('totalApplications count in response', async () => {
    mockLeaveAppsFindMany.mockResolvedValue(MONDAY_APPS);
    const res = await request(app).get('/leave/sick-leave-trends');
    expect(res.body.totalApplications).toBe(3);
  });

  test('200 for SUPER_ADMIN role', async () => {
    setUser({ sub: 'sa-01', role: 'SUPER_ADMIN', employeeId: null });
    mockLeaveAppsFindMany.mockResolvedValue([]);
    const res = await request(app).get('/leave/sick-leave-trends');
    expect(res.status).toBe(200);
  });
});
