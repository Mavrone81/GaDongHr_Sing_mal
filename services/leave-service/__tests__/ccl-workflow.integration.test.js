'use strict';
/**
 * Integration tests: CCL/UICL/ECL child-record workflow
 *
 * CCL-01  POST /leave/children — employee registers child (201 PENDING)
 * CCL-02  POST /leave/children — missing fields returns 400
 * CCL-03  POST /leave/children — invalid citizenship returns 400
 * CCL-04  POST /leave/children — future DOB returns 400
 * CCL-05  GET  /leave/children — employee sees own children only
 * CCL-06  GET  /leave/children — HR admin sees all (or by employeeId filter)
 * CCL-07  GET  /leave/children/pending — HR only: returns PENDING records
 * CCL-08  GET  /leave/children/pending — EMPLOYEE role gets 403
 * CCL-09  GET  /leave/children/:id — owner can read own record
 * CCL-10  GET  /leave/children/:id — non-owner employee gets 403
 * CCL-11  PUT  /leave/children/:id/verify — VERIFIED auto-upserts entitlements
 * CCL-12  PUT  /leave/children/:id/verify — REJECTED requires rejectedReason
 * CCL-13  PUT  /leave/children/:id/verify — already VERIFIED returns 409
 * CCL-14  PUT  /leave/children/:id/verify — unknown id returns 404
 * CCL-15  GET  /leave/children/:employeeId/entitlement-preview — returns preview
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
let mockCurrentUser = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN', employeeId: 'hr-emp-001' };
const setUser = u => { mockCurrentUser = { ...mockCurrentUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockCurrentUser; next(); },
  authorize: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
  },
}), { virtual: true });

const mockChildCreate    = jest.fn();
const mockChildFindMany  = jest.fn().mockResolvedValue([]);
const mockChildFindUnique = jest.fn();
const mockChildUpdate    = jest.fn();

const mockLtFindFirst = jest.fn();
const mockLtCreate    = jest.fn();
const mockEntFindFirst = jest.fn();
const mockEntCreate   = jest.fn();
const mockEntUpdate   = jest.fn();
const mockEntFindMany = jest.fn().mockResolvedValue([]);

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    childRecord: {
      create:    mockChildCreate,
      findMany:  mockChildFindMany,
      findUnique: mockChildFindUnique,
      update:    mockChildUpdate,
    },
    leaveType: {
      findFirst:  mockLtFindFirst,
      findMany:   jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create:     mockLtCreate,
    },
    leaveEntitlement: {
      findFirst:  mockEntFindFirst,
      findMany:   mockEntFindMany,
      create:     mockEntCreate,
      update:     mockEntUpdate,
      updateMany: jest.fn(),
    },
    leaveApplication: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    leaveApprovalStep: { create: jest.fn() },
    publicHoliday: { findMany: jest.fn().mockResolvedValue([]) },
    $disconnect: jest.fn(),
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
jest.mock('axios', () => ({ get: jest.fn().mockRejectedValue(new Error('no axios')) }));

const request = require('supertest');
const app = require('../src/index');

const CHILD_PENDING = {
  id: 'ch-001', employeeId: 'emp-001', fullName: 'Baby Tan',
  dateOfBirth: new Date('2025-01-01'), citizenship: 'SC',
  verificationStatus: 'PENDING', verifiedBy: null, verifiedAt: null,
  rejectedReason: null, notes: null, createdAt: new Date(), updatedAt: new Date(),
};

const CHILD_VERIFIED = { ...CHILD_PENDING, id: 'ch-002', verificationStatus: 'VERIFIED', verifiedBy: 'admin-001', verifiedAt: new Date() };

const LEAVE_TYPE_CCL  = { id: 'lt-ccl',  code: 'CCL',  name: 'Childcare Leave',          isPaid: true  };
const LEAVE_TYPE_UICL = { id: 'lt-uicl', code: 'UICL', name: 'Unpaid Infant Care Leave',  isPaid: false };

beforeEach(() => {
  jest.clearAllMocks();
  mockChildFindMany.mockResolvedValue([]);
  mockEntFindMany.mockResolvedValue([]);
  mockLtFindFirst.mockResolvedValue(null);
  mockLtCreate.mockImplementation(({ data }) => Promise.resolve({ id: `lt-${data.code}`, ...data }));
  mockEntFindFirst.mockResolvedValue(null);
  mockEntCreate.mockResolvedValue({});
  mockEntUpdate.mockResolvedValue({});
});

// ── CCL-01 ────────────────────────────────────────────────────────────────────
test('CCL-01 POST /children employee registers child returns 201 PENDING', async () => {
  mockChildCreate.mockResolvedValue(CHILD_PENDING);

  const res = await request(app)
    .post('/leave/children')
    .set('Authorization', 'Bearer test')
    .send({ fullName: 'Baby Tan', dateOfBirth: '2025-01-01', citizenship: 'SC' });

  expect(res.status).toBe(201);
  expect(res.body.verificationStatus).toBe('PENDING');
  expect(res.body.fullName).toBe('Baby Tan');
});

// ── CCL-02 ────────────────────────────────────────────────────────────────────
test('CCL-02 POST /children missing fields returns 400', async () => {
  const res = await request(app)
    .post('/leave/children')
    .set('Authorization', 'Bearer test')
    .send({ fullName: 'Baby Tan' }); // missing dateOfBirth + citizenship

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/citizenship/);
});

// ── CCL-03 ────────────────────────────────────────────────────────────────────
test('CCL-03 POST /children invalid citizenship returns 400', async () => {
  const res = await request(app)
    .post('/leave/children')
    .set('Authorization', 'Bearer test')
    .send({ fullName: 'X', dateOfBirth: '2025-01-01', citizenship: 'EXPAT' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/citizenship/);
});

// ── CCL-04 ────────────────────────────────────────────────────────────────────
test('CCL-04 POST /children future DOB returns 400', async () => {
  const res = await request(app)
    .post('/leave/children')
    .set('Authorization', 'Bearer test')
    .send({ fullName: 'Future Child', dateOfBirth: '2030-01-01', citizenship: 'SC' });

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/future/i);
});

// ── CCL-05 ────────────────────────────────────────────────────────────────────
test('CCL-05 GET /children employee sees only own records', async () => {
  setUser({ role: 'EMPLOYEE', sub: 'emp-001', employeeId: 'emp-001' });
  mockChildFindMany.mockResolvedValue([CHILD_PENDING]);

  const res = await request(app)
    .get('/leave/children')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
  // verify query included employeeId filter (not testing Prisma directly, but confirm response shape)
  expect(res.body.children[0].employeeId).toBe('emp-001');
});

// ── CCL-06 ────────────────────────────────────────────────────────────────────
test('CCL-06 GET /children HR admin can filter by employeeId', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'admin-001', employeeId: 'hr-emp-001' });
  mockChildFindMany.mockResolvedValue([CHILD_PENDING]);

  const res = await request(app)
    .get('/leave/children?employeeId=emp-001')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
});

// ── CCL-07 ────────────────────────────────────────────────────────────────────
test('CCL-07 GET /children/pending HR admin gets PENDING queue', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockChildFindMany.mockResolvedValue([CHILD_PENDING]);

  const res = await request(app)
    .get('/leave/children/pending')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body.total).toBe(1);
  expect(res.body.children[0].verificationStatus).toBe('PENDING');
});

// ── CCL-08 ────────────────────────────────────────────────────────────────────
test('CCL-08 GET /children/pending EMPLOYEE role gets 403', async () => {
  setUser({ role: 'EMPLOYEE' });

  const res = await request(app)
    .get('/leave/children/pending')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(403);
});

// ── CCL-09 ────────────────────────────────────────────────────────────────────
test('CCL-09 GET /children/:id owner can read own record', async () => {
  setUser({ role: 'EMPLOYEE', sub: 'emp-001', employeeId: 'emp-001' });
  mockChildFindUnique.mockResolvedValue(CHILD_PENDING);

  const res = await request(app)
    .get('/leave/children/ch-001')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body.id).toBe('ch-001');
});

// ── CCL-10 ────────────────────────────────────────────────────────────────────
test('CCL-10 GET /children/:id non-owner employee gets 403', async () => {
  setUser({ role: 'EMPLOYEE', sub: 'emp-999', employeeId: 'emp-999' });
  mockChildFindUnique.mockResolvedValue(CHILD_PENDING); // belongs to emp-001

  const res = await request(app)
    .get('/leave/children/ch-001')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(403);
});

// ── CCL-11 ────────────────────────────────────────────────────────────────────
test('CCL-11 PUT /children/:id/verify VERIFIED auto-upserts CCL+UICL entitlements for SC infant', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'admin-001' });
  mockChildFindUnique.mockResolvedValue(CHILD_PENDING);
  const updatedChild = { ...CHILD_PENDING, verificationStatus: 'VERIFIED', verifiedBy: 'admin-001', verifiedAt: new Date() };
  mockChildUpdate.mockResolvedValue(updatedChild);
  // All verified children for the employee (just this one after update)
  mockChildFindMany.mockResolvedValue([updatedChild]);
  // LeaveType not found → will be created
  mockLtFindFirst.mockResolvedValue(null);
  // No existing entitlements
  mockEntFindFirst.mockResolvedValue(null);

  const res = await request(app)
    .put('/leave/children/ch-001/verify')
    .set('Authorization', 'Bearer test')
    .send({ status: 'VERIFIED' });

  expect(res.status).toBe(200);
  expect(res.body.child.verificationStatus).toBe('VERIFIED');
  expect(res.body.entitlementResult).toBeDefined();
  // SC infant < 2 → CCL + UICL
  const applied = res.body.entitlementResult.applied;
  const codes = applied.map(a => a.code);
  expect(codes).toContain('CCL');
  expect(codes).toContain('UICL');
  // entitlements were created
  expect(mockEntCreate).toHaveBeenCalledTimes(2);
});

// ── CCL-12 ────────────────────────────────────────────────────────────────────
test('CCL-12 PUT /children/:id/verify REJECTED requires rejectedReason', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockChildFindUnique.mockResolvedValue(CHILD_PENDING);

  const res = await request(app)
    .put('/leave/children/ch-001/verify')
    .set('Authorization', 'Bearer test')
    .send({ status: 'REJECTED' }); // no reason

  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/rejectedReason/);
});

// ── CCL-13 ────────────────────────────────────────────────────────────────────
test('CCL-13 PUT /children/:id/verify already VERIFIED returns 409', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockChildFindUnique.mockResolvedValue(CHILD_VERIFIED);

  const res = await request(app)
    .put('/leave/children/ch-002/verify')
    .set('Authorization', 'Bearer test')
    .send({ status: 'VERIFIED' });

  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/already verified/i);
});

// ── CCL-14 ────────────────────────────────────────────────────────────────────
test('CCL-14 PUT /children/:id/verify unknown id returns 404', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockChildFindUnique.mockResolvedValue(null);

  const res = await request(app)
    .put('/leave/children/no-such-id/verify')
    .set('Authorization', 'Bearer test')
    .send({ status: 'VERIFIED' });

  expect(res.status).toBe(404);
});

// ── CCL-15 ────────────────────────────────────────────────────────────────────
test('CCL-15 GET /children/:employeeId/entitlement-preview returns computed entitlements', async () => {
  setUser({ role: 'HR_ADMIN' });
  const scChild7yr = { ...CHILD_VERIFIED, dateOfBirth: new Date('2019-01-01'), citizenship: 'SC' }; // age 7 → ECL
  mockChildFindMany
    .mockResolvedValueOnce([scChild7yr])  // verified children
    .mockResolvedValueOnce([scChild7yr]); // all children
  mockEntFindMany.mockResolvedValue([]);

  const res = await request(app)
    .get('/leave/children/emp-001/entitlement-preview')
    .set('Authorization', 'Bearer test');

  expect(res.status).toBe(200);
  expect(res.body.employeeId).toBe('emp-001');
  expect(res.body.computedEntitlements).toEqual([{ code: 'ECL', days: 2 }]);
  expect(res.body.youngestVerifiedChild.ageBracket).toBe('7 to 12 years');
});
