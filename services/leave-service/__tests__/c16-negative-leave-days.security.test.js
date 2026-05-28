'use strict';
/**
 * Security regression test for C-16:
 *   endDate before startDate (negative totalDays) must be rejected with 400,
 *   not silently approved and inflate the employee's leave balance.
 */

let mockUser = { sub: 'u-001', role: 'EMPLOYEE', employeeId: 'e-self' };
const setUser = (u) => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: () => (_req, _res, next) => next(),
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

jest.mock('dotenv', () => ({ config: () => {} }));

const mockLeaveAppCreate = jest.fn();
const mockLeaveTypeFindUnique = jest.fn();
const mockEntFindFirst = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    leaveApplication:  { findMany: jest.fn(), count: jest.fn(), create: mockLeaveAppCreate, findUnique: jest.fn() },
    leaveType:         { findUnique: mockLeaveTypeFindUnique, findMany: jest.fn().mockResolvedValue([]) },
    leaveEntitlement:  { findFirst: mockEntFindFirst, updateMany: jest.fn(), update: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}) },
    publicHoliday:     { findMany: jest.fn().mockResolvedValue([]) },
    leaveApprovalStep: { create: jest.fn() },
  })),
}));

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

const request = require('supertest');
const app = require('../src/index');

const LEAVE_TYPE = {
  id: 'lt-001', code: 'AL', name: 'Annual Leave', isPaid: true, isActive: true,
  annualEntitlement: 14, minServiceMonths: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ role: 'EMPLOYEE', employeeId: 'e-self' });
  mockLeaveTypeFindUnique.mockResolvedValue(LEAVE_TYPE);
  mockEntFindFirst.mockResolvedValue({
    id: 'ent-self', employeeId: 'e-self', leaveTypeId: 'lt-001',
    year: 2026, entitledDays: 14, carryForward: 0, usedDays: 0, pendingDays: 0,
  });
});

test('C16-01 endDate before startDate is rejected (400)', async () => {
  const res = await request(app).post('/leave/applications').send({
    leaveTypeId: 'lt-001',
    startDate: '2026-06-10',
    endDate:   '2026-06-01',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/endDate must be on or after startDate/i);
  expect(mockLeaveAppCreate).not.toHaveBeenCalled();
});

test('C16-02 endDate == startDate (1 day) is accepted', async () => {
  mockLeaveAppCreate.mockImplementation(async (args) => ({ id: 'app-ok', ...args.data }));
  const res = await request(app).post('/leave/applications').send({
    leaveTypeId: 'lt-001',
    startDate: '2026-06-01',
    endDate:   '2026-06-01',
  });
  expect(res.status).toBe(201);
});

test('C16-03 invalid date strings rejected with 400', async () => {
  const res = await request(app).post('/leave/applications').send({
    leaveTypeId: 'lt-001',
    startDate: 'not-a-date',
    endDate:   '2026-06-01',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/valid dates/i);
});
