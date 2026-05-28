'use strict';
/**
 * Security regression tests for C-02 and C-03 (leave-service).
 *
 * C-02 — GET /leave/applications org-wide IDOR fix:
 *   Same lowercase 'employee' role bug as C-01 in claims-service.
 *   Fix: default-deny based on LEAVE_VIEW_ROLES.
 *
 * C-03 — POST /leave/applications body.employeeId mass-assignment fix:
 *   Only HR admins (LEAVE_SUBMIT_FOR_OTHERS) may pass employeeId in the body.
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

const mockLeaveAppFindMany   = jest.fn().mockResolvedValue([]);
const mockLeaveAppCount      = jest.fn().mockResolvedValue(0);
const mockLeaveAppCreate     = jest.fn();
const mockLeaveTypeFindUnique = jest.fn();
const mockLeaveEntitlementFindFirst = jest.fn();
const mockLeaveEntitlementUpdate    = jest.fn().mockResolvedValue({});
const mockLeaveEntitlementCreate    = jest.fn().mockResolvedValue({});

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    leaveApplication:  { findMany: mockLeaveAppFindMany, count: mockLeaveAppCount, create: mockLeaveAppCreate, findUnique: jest.fn() },
    leaveType:         { findUnique: mockLeaveTypeFindUnique, findMany: jest.fn().mockResolvedValue([]) },
    leaveEntitlement:  { findFirst: mockLeaveEntitlementFindFirst, updateMany: jest.fn(), update: mockLeaveEntitlementUpdate, create: mockLeaveEntitlementCreate },
    publicHoliday:     { findMany: jest.fn().mockResolvedValue([]) },
    leaveApprovalStep: { create: jest.fn() },
  })),
}));

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

const request = require('supertest');
const app = require('../src/index');

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'u-001', role: 'EMPLOYEE', employeeId: 'e-self' });
});

// ── C-02 GET /leave/applications IDOR ─────────────────────────────────────────

test('C02-01 EMPLOYEE is force-scoped to own employeeId', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'e-victim' });

  const res = await request(app).get('/leave/applications');
  expect(res.status).toBe(200);
  expect(mockLeaveAppFindMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ employeeId: 'e-victim' }),
  }));
});

test('C02-02 EMPLOYEE cannot use ?employeeId= to scope to another employee', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'e-attacker' });

  await request(app).get('/leave/applications?employeeId=e-target');
  const where = mockLeaveAppFindMany.mock.calls[0][0].where;
  expect(where.employeeId).toBe('e-attacker'); // forced, not e-target
});

test('C02-03 LINE_MANAGER (not in LEAVE_VIEW_ROLES) is scoped to own employeeId', async () => {
  setUser({ role: 'LINE_MANAGER', employeeId: 'e-mgr' });

  await request(app).get('/leave/applications?employeeId=e-other');
  const where = mockLeaveAppFindMany.mock.calls[0][0].where;
  expect(where.employeeId).toBe('e-mgr');
});

test('C02-04 HR_ADMIN gets unfiltered list when no employeeId param', async () => {
  setUser({ role: 'HR_ADMIN', employeeId: 'e-hr' });

  await request(app).get('/leave/applications');
  const where = mockLeaveAppFindMany.mock.calls[0][0].where;
  expect(where.employeeId).toBeUndefined();
});

test('C02-05 HR_ADMIN can filter by ?employeeId= to view a specific employee', async () => {
  setUser({ role: 'HR_ADMIN', employeeId: 'e-hr' });

  await request(app).get('/leave/applications?employeeId=e-target');
  const where = mockLeaveAppFindMany.mock.calls[0][0].where;
  expect(where.employeeId).toBe('e-target');
});

test('C02-06 SUPER_ADMIN, HR_MANAGER, PAYROLL_OFFICER are all privileged', async () => {
  for (const role of ['SUPER_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER']) {
    jest.clearAllMocks();
    setUser({ role, employeeId: 'e-' + role });
    await request(app).get('/leave/applications');
    const where = mockLeaveAppFindMany.mock.calls[0][0].where;
    expect(where.employeeId).toBeUndefined();
  }
});

// ── C-03 POST /leave/applications body.employeeId ─────────────────────────────

const LEAVE_TYPE = {
  id: 'lt-001', code: 'AL', name: 'Annual Leave', isPaid: true, isActive: true,
  annualEntitlement: 14, minServiceMonths: 0,
};

test('C03-leave-01 EMPLOYEE cannot pass body.employeeId — forced to req.user.employeeId', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'e-attacker' });
  mockLeaveTypeFindUnique.mockResolvedValue(LEAVE_TYPE);
  mockLeaveEntitlementFindFirst.mockResolvedValue({
    id: 'ent-attacker', employeeId: 'e-attacker', leaveTypeId: 'lt-001',
    year: 2026, entitledDays: 14, carryForward: 0, usedDays: 0, pendingDays: 0,
  });
  mockLeaveAppCreate.mockImplementation(async (args) => ({ id: 'app-1', ...args.data }));

  const res = await request(app).post('/leave/applications').send({
    leaveTypeId: 'lt-001',
    startDate: '2026-06-01', endDate: '2026-06-02',
    employeeId: 'e-victim',
  });
  expect(res.status).toBe(201);
  expect(mockLeaveAppCreate).toHaveBeenCalled();
  const data = mockLeaveAppCreate.mock.calls[0][0].data;
  expect(data.employeeId).toBe('e-attacker'); // attacker's own, not victim's
  expect(data.employeeId).not.toBe('e-victim');
});

test('C03-leave-02 LINE_MANAGER also cannot pass body.employeeId', async () => {
  setUser({ role: 'LINE_MANAGER', employeeId: 'e-mgr' });
  mockLeaveTypeFindUnique.mockResolvedValue(LEAVE_TYPE);
  mockLeaveEntitlementFindFirst.mockResolvedValue({
    id: 'ent-mgr', employeeId: 'e-mgr', leaveTypeId: 'lt-001',
    year: 2026, entitledDays: 14, carryForward: 0, usedDays: 0, pendingDays: 0,
  });
  mockLeaveAppCreate.mockImplementation(async (args) => ({ id: 'app-2', ...args.data }));

  await request(app).post('/leave/applications').send({
    leaveTypeId: 'lt-001', startDate: '2026-06-01', endDate: '2026-06-02',
    employeeId: 'e-subordinate',
  });
  const data = mockLeaveAppCreate.mock.calls[0][0].data;
  expect(data.employeeId).toBe('e-mgr');
});

test('C03-leave-03 HR_ADMIN may submit on behalf via body.employeeId', async () => {
  setUser({ role: 'HR_ADMIN', employeeId: 'e-hr' });
  mockLeaveTypeFindUnique.mockResolvedValue(LEAVE_TYPE);
  mockLeaveEntitlementFindFirst.mockResolvedValue({
    id: 'ent-target', employeeId: 'e-target', leaveTypeId: 'lt-001',
    year: 2026, entitledDays: 14, carryForward: 0, usedDays: 0, pendingDays: 0,
  });
  mockLeaveAppCreate.mockImplementation(async (args) => ({ id: 'app-3', ...args.data }));

  const res = await request(app).post('/leave/applications').send({
    leaveTypeId: 'lt-001', startDate: '2026-06-01', endDate: '2026-06-02',
    employeeId: 'e-target',
  });
  expect(res.status).toBe(201);
  const data = mockLeaveAppCreate.mock.calls[0][0].data;
  expect(data.employeeId).toBe('e-target');
});

test('C03-leave-04 EMPLOYEE submitting without body.employeeId uses own employeeId (regression)', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'e-self' });
  mockLeaveTypeFindUnique.mockResolvedValue(LEAVE_TYPE);
  mockLeaveEntitlementFindFirst.mockResolvedValue({
    id: 'ent-self', employeeId: 'e-self', leaveTypeId: 'lt-001',
    year: 2026, entitledDays: 14, carryForward: 0, usedDays: 0, pendingDays: 0,
  });
  mockLeaveAppCreate.mockImplementation(async (args) => ({ id: 'app-4', ...args.data }));

  const res = await request(app).post('/leave/applications').send({
    leaveTypeId: 'lt-001', startDate: '2026-06-01', endDate: '2026-06-02',
  });
  expect(res.status).toBe(201);
  expect(mockLeaveAppCreate.mock.calls[0][0].data.employeeId).toBe('e-self');
});

test('C03-leave-05 PAYROLL_OFFICER cannot submit on behalf (not in LEAVE_SUBMIT_FOR_OTHERS)', async () => {
  setUser({ role: 'PAYROLL_OFFICER', employeeId: 'e-payroll' });
  mockLeaveTypeFindUnique.mockResolvedValue(LEAVE_TYPE);
  mockLeaveEntitlementFindFirst.mockResolvedValue({
    id: 'ent-payroll', employeeId: 'e-payroll', leaveTypeId: 'lt-001',
    year: 2026, entitledDays: 14, carryForward: 0, usedDays: 0, pendingDays: 0,
  });
  mockLeaveAppCreate.mockImplementation(async (args) => ({ id: 'app-5', ...args.data }));

  await request(app).post('/leave/applications').send({
    leaveTypeId: 'lt-001', startDate: '2026-06-01', endDate: '2026-06-02',
    employeeId: 'e-someone-else',
  });
  const data = mockLeaveAppCreate.mock.calls[0][0].data;
  // PAYROLL_OFFICER may view all, but only HR_ADMIN/SUPER_ADMIN may submit-for-others.
  expect(data.employeeId).toBe('e-payroll');
});
