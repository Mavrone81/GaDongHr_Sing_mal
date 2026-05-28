'use strict';
/**
 * Security regression test for C-19:
 *   GET /assets/employee/:employeeId is no longer open to every authenticated
 *   user. Only the owner of that employeeId, or SUPER_ADMIN/HR_ADMIN/IT_ADMIN,
 *   may view another employee's assigned assets.
 */

let mockUser = { sub: 'user-1', role: 'EMPLOYEE', employeeId: 'e-self' };
const setUser = (u) => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    IT_ADMIN: 'IT_ADMIN', MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const mockDb = {
  asset: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  assetAssignment: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
  assetMaintenance: { create: jest.fn(), findMany: jest.fn() },
  softwareLicence: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  assetAlert: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  inventoryItem: { findMany: jest.fn(), findUnique: jest.fn() },
  logisticsRequest: { findUnique: jest.fn(), findMany: jest.fn() },
  logisticsRequestLine: { update: jest.fn() },
  stockTransaction: { create: jest.fn(), findMany: jest.fn() },
  purchaseRequest: { count: jest.fn() },
  $transaction: jest.fn(async (ops) => Promise.all(ops)),
};

jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn().mockImplementation(() => mockDb) }));

const request = require('supertest');
const app = require('../src/index');

beforeEach(() => { jest.clearAllMocks(); });

test('C19-01 EMPLOYEE viewing OWN assets is allowed', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'e-self' });
  const res = await request(app).get('/assets/employee/e-self');
  expect(res.status).toBe(200);
});

test('C19-02 EMPLOYEE viewing ANOTHER employee\'s assets is 403', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'e-self' });
  const res = await request(app).get('/assets/employee/e-victim');
  expect(res.status).toBe(403);
  expect(mockDb.assetAssignment.findMany).not.toHaveBeenCalled();
});

test('C19-03 LINE_MANAGER (no admin role) also cannot view another employee', async () => {
  setUser({ role: 'LINE_MANAGER', employeeId: 'e-mgr' });
  const res = await request(app).get('/assets/employee/e-subordinate');
  expect(res.status).toBe(403);
});

test('C19-04 HR_ADMIN can view any employee\'s assets', async () => {
  setUser({ role: 'HR_ADMIN', employeeId: null });
  const res = await request(app).get('/assets/employee/e-anyone');
  expect(res.status).toBe(200);
});

test('C19-05 SUPER_ADMIN and IT_ADMIN also allowed', async () => {
  for (const role of ['SUPER_ADMIN', 'IT_ADMIN']) {
    setUser({ role, employeeId: null });
    const res = await request(app).get('/assets/employee/e-anyone');
    expect(res.status).toBe(200);
  }
});

test('C19-06 Asset history /:id/history is admin-only (403 for EMPLOYEE)', async () => {
  setUser({ role: 'EMPLOYEE', employeeId: 'e-self' });
  const res = await request(app).get('/assets/some-asset-id/history');
  expect(res.status).toBe(403);
});
