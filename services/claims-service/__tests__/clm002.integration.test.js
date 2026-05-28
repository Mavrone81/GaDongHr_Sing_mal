'use strict';
// CLM-002: Approver delegation — period config + approval via delegation

let mockUser = { sub: 'admin-001', email: 'admin@test.com', role: 'FINANCE_ADMIN', employeeId: 'e-admin' };
const setUser = (u) => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...allowed) => (req, res, next) => {
    if (!allowed.length) return next();
    const ok = allowed.some(a => a === req.user?.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', FINANCE_ADMIN: 'FINANCE_ADMIN',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const NOW = new Date('2026-05-28T08:00:00Z');

const mockDb = {
  claim:                  { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
  claimCategory:          { findMany: jest.fn(), findUnique: jest.fn() },
  vendorGstRegistration:  { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  categoryBudget:         { findMany: jest.fn(), upsert: jest.fn() },
  approverDelegation:     { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => mockDb),
}));

const request = require('supertest');
const app = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const DELEGATION = {
  id: 'del-001',
  delegatorId: 'e-mgr',
  delegateeId: 'e-delegate',
  startDate: new Date('2026-05-25T00:00:00Z'),
  endDate:   new Date('2026-06-05T23:59:59Z'),
  categoryIds: [],
  reason: 'Annual Leave',
  isActive: true,
  createdBy: 'admin-001',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const CLAIM = {
  id: 'clm-001', employeeId: 'e-emp', categoryId: 'cat-001',
  title: 'Taxi', status: 'SUBMITTED',
  totalAmount: 25, gstAmount: 0, claimDate: new Date(),
  approvedById: null, approvedAt: null,
  approvedByDelegateeId: null, delegationId: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'admin-001', role: 'FINANCE_ADMIN', employeeId: 'e-admin' });
});

// ── DLG-01 POST /claims/delegations — creates delegation ──────────────────────
test('DLG-01 POST /claims/delegations creates a delegation', async () => {
  mockDb.approverDelegation.create.mockResolvedValue(DELEGATION);

  const res = await request(app).post('/claims/delegations').send({
    delegatorId: 'e-mgr', delegateeId: 'e-delegate',
    startDate: '2026-05-25', endDate: '2026-06-05',
    reason: 'Annual Leave',
  });
  expect(res.status).toBe(201);
  expect(res.body.delegatorId).toBe('e-mgr');
  expect(res.body.isActive).toBe(true);
});

// ── DLG-02 POST — 400 missing required fields ─────────────────────────────────
test('DLG-02 POST /claims/delegations 400 when required fields missing', async () => {
  const res = await request(app).post('/claims/delegations').send({ delegatorId: 'e-mgr' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/required/);
});

// ── DLG-03 POST — 400 same delegator and delegatee ────────────────────────────
test('DLG-03 POST /claims/delegations 400 when delegator = delegatee', async () => {
  const res = await request(app).post('/claims/delegations').send({
    delegatorId: 'e-mgr', delegateeId: 'e-mgr',
    startDate: '2026-05-25', endDate: '2026-06-05',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/different/);
});

// ── DLG-04 POST — 400 endDate before startDate ───────────────────────────────
test('DLG-04 POST /claims/delegations 400 when endDate <= startDate', async () => {
  const res = await request(app).post('/claims/delegations').send({
    delegatorId: 'e-mgr', delegateeId: 'e-delegate',
    startDate: '2026-06-05', endDate: '2026-05-25',
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/endDate/);
});

// ── DLG-05 GET /claims/delegations — lists all ────────────────────────────────
test('DLG-05 GET /claims/delegations returns list', async () => {
  mockDb.approverDelegation.findMany.mockResolvedValue([DELEGATION]);

  const res = await request(app).get('/claims/delegations');
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
});

// ── DLG-06 GET /claims/delegations?active=true — filters active ──────────────
test('DLG-06 GET /claims/delegations?active=true passes date filter to DB', async () => {
  mockDb.approverDelegation.findMany.mockResolvedValue([DELEGATION]);

  const res = await request(app).get('/claims/delegations?active=true');
  expect(res.status).toBe(200);
  const call = mockDb.approverDelegation.findMany.mock.calls[0][0];
  expect(call.where.isActive).toBe(true);
  expect(call.where.startDate).toBeDefined();
  expect(call.where.endDate).toBeDefined();
});

// ── DLG-07 GET /claims/delegations/active — returns delegatee's active ────────
test('DLG-07 GET /claims/delegations/active returns current user active delegations', async () => {
  setUser({ sub: 'e-delegate', role: 'FINANCE_ADMIN', employeeId: 'e-delegate' });
  mockDb.approverDelegation.findMany.mockResolvedValue([DELEGATION]);

  const res = await request(app).get('/claims/delegations/active');
  expect(res.status).toBe(200);
  expect(res.body.activeDelegations).toHaveLength(1);
  expect(res.body.delegateeId).toBe('e-delegate');
});

// ── DLG-08 GET /claims/delegations/:id — returns single ──────────────────────
test('DLG-08 GET /claims/delegations/:id returns delegation', async () => {
  mockDb.approverDelegation.findUnique.mockResolvedValue(DELEGATION);

  const res = await request(app).get('/claims/delegations/del-001');
  expect(res.status).toBe(200);
  expect(res.body.id).toBe('del-001');
});

// ── DLG-09 GET /claims/delegations/:id — 404 on unknown ──────────────────────
test('DLG-09 GET /claims/delegations/:id returns 404 for unknown', async () => {
  mockDb.approverDelegation.findUnique.mockResolvedValue(null);

  const res = await request(app).get('/claims/delegations/unknown');
  expect(res.status).toBe(404);
});

// ── DLG-10 PUT /claims/delegations/:id — deactivates delegation ──────────────
test('DLG-10 PUT /claims/delegations/:id deactivates a delegation', async () => {
  mockDb.approverDelegation.update.mockResolvedValue({ ...DELEGATION, isActive: false });

  const res = await request(app).put('/claims/delegations/del-001').send({ isActive: false });
  expect(res.status).toBe(200);
  expect(res.body.isActive).toBe(false);
});

// ── DLG-11 PUT /claims/delegations/:id — 404 on unknown ──────────────────────
test('DLG-11 PUT /claims/delegations/:id returns 404 for unknown', async () => {
  mockDb.approverDelegation.update.mockRejectedValue({ code: 'P2025' });

  const res = await request(app).put('/claims/delegations/unknown').send({ isActive: false });
  expect(res.status).toBe(404);
});

// ── DLG-12 DELETE /claims/delegations/:id — deletes ──────────────────────────
test('DLG-12 DELETE /claims/delegations/:id removes delegation', async () => {
  mockDb.approverDelegation.delete.mockResolvedValue({});

  const res = await request(app).delete('/claims/delegations/del-001');
  expect(res.status).toBe(204);
});

// ── DLG-13 PUT /claims/:id/approve with valid delegationId ───────────────────
test('DLG-13 approve claim via delegation records delegateeId and delegationId', async () => {
  setUser({ sub: 'e-delegate', role: 'FINANCE_ADMIN', employeeId: 'e-delegate' });
  mockDb.claim.findUnique.mockResolvedValue(CLAIM);
  mockDb.approverDelegation.findUnique.mockResolvedValue(DELEGATION);
  const approvedClaim = {
    ...CLAIM, status: 'APPROVED',
    approvedById: 'e-mgr',
    approvedByDelegateeId: 'e-delegate',
    delegationId: 'del-001',
  };
  mockDb.claim.update.mockResolvedValue(approvedClaim);

  const res = await request(app).put('/claims/clm-001/approve').send({ delegationId: 'del-001' });
  expect(res.status).toBe(200);
  expect(res.body.approvedById).toBe('e-mgr');
  expect(res.body.approvedByDelegateeId).toBe('e-delegate');
  expect(res.body.delegationId).toBe('del-001');
});

// ── DLG-14 approve with inactive delegation → 400 ────────────────────────────
test('DLG-14 approve returns 400 when delegation is inactive', async () => {
  setUser({ sub: 'e-delegate', role: 'FINANCE_ADMIN', employeeId: 'e-delegate' });
  mockDb.claim.findUnique.mockResolvedValue(CLAIM);
  mockDb.approverDelegation.findUnique.mockResolvedValue({ ...DELEGATION, isActive: false });

  const res = await request(app).put('/claims/clm-001/approve').send({ delegationId: 'del-001' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/inactive/);
});

// ── DLG-15 approve — wrong delegatee → 403 ────────────────────────────────────
test('DLG-15 approve returns 403 when user is not the delegatee', async () => {
  setUser({ sub: 'e-other', role: 'FINANCE_ADMIN', employeeId: 'e-other' });
  mockDb.claim.findUnique.mockResolvedValue(CLAIM);
  mockDb.approverDelegation.findUnique.mockResolvedValue(DELEGATION);

  const res = await request(app).put('/claims/clm-001/approve').send({ delegationId: 'del-001' });
  expect(res.status).toBe(403);
});

// ── DLG-16 approve — outside delegation period → 400 ─────────────────────────
test('DLG-16 approve returns 400 when outside delegation period', async () => {
  setUser({ sub: 'e-delegate', role: 'FINANCE_ADMIN', employeeId: 'e-delegate' });
  mockDb.claim.findUnique.mockResolvedValue(CLAIM);
  // Delegation ended in the past
  mockDb.approverDelegation.findUnique.mockResolvedValue({
    ...DELEGATION,
    startDate: new Date('2026-01-01'),
    endDate:   new Date('2026-01-31'),
  });

  const res = await request(app).put('/claims/clm-001/approve').send({ delegationId: 'del-001' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/period/);
});

// ── DLG-17 approve — category not covered → 400 ──────────────────────────────
test('DLG-17 approve returns 400 when claim category not in delegation scope', async () => {
  setUser({ sub: 'e-delegate', role: 'FINANCE_ADMIN', employeeId: 'e-delegate' });
  mockDb.claim.findUnique.mockResolvedValue(CLAIM); // categoryId = 'cat-001'
  mockDb.approverDelegation.findUnique.mockResolvedValue({
    ...DELEGATION,
    categoryIds: ['cat-999'], // different category
  });

  const res = await request(app).put('/claims/clm-001/approve').send({ delegationId: 'del-001' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/category/);
});

// ── DLG-18 approve without delegationId — regular approval still works ────────
test('DLG-18 approve without delegationId uses approver as approvedById directly', async () => {
  mockDb.claim.findUnique.mockResolvedValue(CLAIM);
  mockDb.claim.update.mockResolvedValue({ ...CLAIM, status: 'APPROVED', approvedById: 'admin-001' });

  const res = await request(app).put('/claims/clm-001/approve').send({});
  expect(res.status).toBe(200);
  expect(res.body.approvedById).toBe('admin-001');
});
