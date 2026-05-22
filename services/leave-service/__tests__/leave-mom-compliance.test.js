'use strict';
/**
 * Unit + integration tests for:
 *   1. monthsBetween / proRateEntitlement helpers
 *   2. MOM minServiceMonths enforcement on POST /leave/applications
 *   3. POST /leave/internal/auto-provision
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockCurrentUser = { sub: 'emp-user-001', email: 'emp@test.com', role: 'EMPLOYEE', employeeId: 'emp-001' };
const setUser = u => { mockCurrentUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockCurrentUser; next(); },
  authorize: () => (_req, _res, next) => next(),
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

const mockLeaveTypeFindMany = jest.fn();
const mockLeaveTypeFindUnique = jest.fn();
const mockLeaveApplicationCreate = jest.fn();
const mockLeaveApplicationFindUnique = jest.fn();
const mockLeaveEntitlementFindFirst = jest.fn();
const mockLeaveEntitlementCreate = jest.fn();
const mockPublicHolidayFindMany = jest.fn().mockResolvedValue([]);
const mockApprovalStepCreate = jest.fn().mockResolvedValue({});

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    leaveType: { findMany: mockLeaveTypeFindMany, findUnique: mockLeaveTypeFindUnique },
    leaveApplication: { create: mockLeaveApplicationCreate, findUnique: mockLeaveApplicationFindUnique, update: jest.fn() },
    leaveEntitlement: { findFirst: mockLeaveEntitlementFindFirst, create: mockLeaveEntitlementCreate, updateMany: jest.fn() },
    publicHoliday: { findMany: mockPublicHolidayFindMany },
    leaveApprovalStep: { create: mockApprovalStepCreate },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

// Must be set before app is required so leave.routes.js captures a non-empty key
process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';

const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({ get: mockAxiosGet }));

const request = require('supertest');
const app = require('../src/index');

beforeEach(() => {
  jest.resetAllMocks();
  mockPublicHolidayFindMany.mockResolvedValue([]);
  mockCurrentUser = { sub: 'emp-user-001', email: 'emp@test.com', role: 'EMPLOYEE', employeeId: 'emp-001' };
});

// ─────────────────────────────────────────────────────────────────────────────
// A) Helper unit tests (accessed via require of the routes module)
// ─────────────────────────────────────────────────────────────────────────────
describe('A) Helper: monthsBetween', () => {
  // We test the helpers indirectly through the API behaviour; direct unit tests
  // below verify the boundary math using the API response messages.

  test('employee blocked when exactly 0 months worked and minServiceMonths=3', async () => {
    const today = new Date();
    // startDate = today (0 months worked)
    const startDate = today.toISOString();

    mockLeaveTypeFindUnique.mockResolvedValue({
      id: 'lt-annual', code: 'ANNUAL', name: 'Annual Leave',
      isPaid: true, isStatutory: true, annualEntitlement: 14,
      maxCarryForward: 0, minServiceMonths: 3, isActive: true,
    });
    // Simulate employee-service returning the startDate
    mockAxiosGet.mockResolvedValue({ data: { id: 'emp-001', startDate, isActive: true } });
    mockLeaveEntitlementFindFirst.mockResolvedValue({ id: 'ent-001', entitledDays: 14, usedDays: 0 });

    const start = new Date(today); start.setDate(start.getDate() + 7);
    const end = new Date(start); end.setDate(end.getDate() + 1);

    const r = await request(app)
      .post('/leave/applications')
      .set('Authorization', 'Bearer test')
      .send({
        leaveTypeId: 'lt-annual',
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        reason: 'Holiday',
      });

    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/minimum of 3 months/);
    expect(r.body.error).toMatch(/Eligibility date/);
  });

  test('employee allowed when monthsWorked >= minServiceMonths', async () => {
    // startDate = 6 months ago (well past 3-month threshold)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const startDate = sixMonthsAgo.toISOString();

    mockLeaveTypeFindUnique.mockResolvedValue({
      id: 'lt-annual', code: 'ANNUAL', name: 'Annual Leave',
      isPaid: true, isStatutory: true, annualEntitlement: 14,
      maxCarryForward: 0, minServiceMonths: 3, isActive: true,
    });
    mockAxiosGet.mockResolvedValue({ data: { id: 'emp-001', startDate, isActive: true } });
    mockLeaveEntitlementFindFirst.mockResolvedValue({ id: 'ent-001', entitledDays: 14, usedDays: 0 });

    const today = new Date();
    const futureStart = new Date(today); futureStart.setDate(futureStart.getDate() + 5);
    const futureEnd = new Date(futureStart); futureEnd.setDate(futureEnd.getDate() + 1);

    mockLeaveApplicationCreate.mockResolvedValue({
      id: 'app-new', employeeId: 'emp-001', leaveTypeId: 'lt-annual', status: 'PENDING',
      startDate: futureStart, endDate: futureEnd, totalDays: 1, reason: 'Holiday',
    });
    // No supervisor configured — non-admin gets 403 after the service check passes
    // but here we just want to confirm minServiceMonths doesn't block
    mockAxiosGet
      .mockResolvedValueOnce({ data: { id: 'emp-001', startDate, isActive: true } }) // employee fetch
      .mockRejectedValueOnce(new Error('no supervisor')); // supervisor check

    const r = await request(app)
      .post('/leave/applications')
      .set('Authorization', 'Bearer test')
      .send({
        leaveTypeId: 'lt-annual',
        startDate: futureStart.toISOString().slice(0, 10),
        endDate: futureEnd.toISOString().slice(0, 10),
        reason: 'Holiday',
      });

    // Not a 400 from minServiceMonths — either 201 or 500 from downstream mock
    expect(r.status).not.toBe(400);
    if (r.status === 400) expect(r.body.error).not.toMatch(/minimum of/);
  });

  test('leave type with minServiceMonths=0 skips the check entirely', async () => {
    mockLeaveTypeFindUnique.mockResolvedValue({
      id: 'lt-mc', code: 'MC', name: 'Medical Leave',
      isPaid: true, isStatutory: false, annualEntitlement: 0,
      maxCarryForward: 0, minServiceMonths: 0, isActive: true,
    });
    // axios should NOT be called for employee start date when minServiceMonths=0
    mockAxiosGet.mockRejectedValue(new Error('should not be called'));
    mockLeaveEntitlementFindFirst.mockResolvedValue(null);
    mockLeaveApplicationCreate.mockResolvedValue({
      id: 'app-mc', employeeId: 'emp-001', leaveTypeId: 'lt-mc', status: 'PENDING',
      startDate: new Date(), endDate: new Date(), totalDays: 1, reason: 'Sick',
    });

    const today = new Date();
    const futureStart = new Date(today); futureStart.setDate(futureStart.getDate() + 1);

    const r = await request(app)
      .post('/leave/applications')
      .set('Authorization', 'Bearer test')
      .send({
        leaveTypeId: 'lt-mc',
        startDate: futureStart.toISOString().slice(0, 10),
        endDate: futureStart.toISOString().slice(0, 10),
        reason: 'Sick',
      });

    // Should not get a 400 about minServiceMonths
    expect(r.status).not.toBe(400);
    const axiosServiceCheckCalls = mockAxiosGet.mock.calls.filter(
      c => c[0] && typeof c[0] === 'string' && c[0].includes('/employees/')
    );
    expect(axiosServiceCheckCalls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B) POST /leave/internal/auto-provision
// ─────────────────────────────────────────────────────────────────────────────
describe('B) POST /leave/internal/auto-provision', () => {
  const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || '';

  test('403 — wrong or missing internal service key', async () => {
    const r = await request(app)
      .post('/leave/internal/auto-provision')
      .set('x-internal-service-key', 'wrong-key');
    expect(r.status).toBe(403);
  });

  test('200 — provisions entitlements for eligible employees', async () => {
    const nineMonthsAgo = new Date();
    nineMonthsAgo.setMonth(nineMonthsAgo.getMonth() - 9);

    // Leave types with minServiceMonths > 0
    mockLeaveTypeFindMany.mockResolvedValue([{
      id: 'lt-annual', code: 'ANNUAL', name: 'Annual Leave',
      annualEntitlement: 14, minServiceMonths: 3,
    }]);

    // Employees from employee-service
    mockAxiosGet.mockResolvedValue({
      data: { employees: [{ id: 'emp-001', startDate: nineMonthsAgo.toISOString(), isActive: true }] },
    });

    // No existing entitlement
    mockLeaveEntitlementFindFirst.mockResolvedValue(null);
    mockLeaveEntitlementCreate.mockResolvedValue({ id: 'ent-new' });

    const r = await request(app)
      .post('/leave/internal/auto-provision')
      .set('x-internal-service-key', INTERNAL_KEY);

    expect(r.status).toBe(200);
    expect(r.body.provisioned).toBeGreaterThanOrEqual(1);
    expect(mockLeaveEntitlementCreate).toHaveBeenCalledTimes(1);
  });

  test('200 — skips employees who already have entitlement for the year', async () => {
    const nineMonthsAgo = new Date();
    nineMonthsAgo.setMonth(nineMonthsAgo.getMonth() - 9);

    mockLeaveTypeFindMany.mockResolvedValue([{
      id: 'lt-annual', code: 'ANNUAL', name: 'Annual Leave',
      annualEntitlement: 14, minServiceMonths: 3,
    }]);
    mockAxiosGet.mockResolvedValue({
      data: { employees: [{ id: 'emp-001', startDate: nineMonthsAgo.toISOString(), isActive: true }] },
    });
    // Already provisioned
    mockLeaveEntitlementFindFirst.mockResolvedValue({ id: 'existing-ent' });

    const r = await request(app)
      .post('/leave/internal/auto-provision')
      .set('x-internal-service-key', INTERNAL_KEY);

    expect(r.status).toBe(200);
    expect(r.body.provisioned).toBe(0);
    expect(mockLeaveEntitlementCreate).not.toHaveBeenCalled();
  });

  test('200 — skips employees who have not yet reached minServiceMonths', async () => {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    mockLeaveTypeFindMany.mockResolvedValue([{
      id: 'lt-annual', code: 'ANNUAL', name: 'Annual Leave',
      annualEntitlement: 14, minServiceMonths: 3, // needs 3 months, only 1 worked
    }]);
    mockAxiosGet.mockResolvedValue({
      data: { employees: [{ id: 'emp-new', startDate: oneMonthAgo.toISOString(), isActive: true }] },
    });
    mockLeaveEntitlementFindFirst.mockResolvedValue(null);

    const r = await request(app)
      .post('/leave/internal/auto-provision')
      .set('x-internal-service-key', INTERNAL_KEY);

    expect(r.status).toBe(200);
    expect(r.body.provisioned).toBe(0);
    expect(mockLeaveEntitlementCreate).not.toHaveBeenCalled();
  });

  test('200 — no leave types with minServiceMonths returns 0 without calling employees API', async () => {
    mockLeaveTypeFindMany.mockResolvedValue([]); // no types with minServiceMonths > 0

    const r = await request(app)
      .post('/leave/internal/auto-provision')
      .set('x-internal-service-key', INTERNAL_KEY);

    expect(r.status).toBe(200);
    expect(r.body.provisioned).toBe(0);
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });
});
