'use strict';
/**
 * AST-002 integration tests — logistics + inventory + purchase requests.
 *
 *   L1  POST /inventory creates item, rejects duplicate SKU
 *   L2  PUT  /inventory/:id updates fields
 *   L3  GET  /inventory/low-stock returns items <= reorderPoint
 *   L4  POST /inventory/:id/transactions RECEIVE → +qty
 *   L5  POST /inventory/:id/transactions ISSUE → −qty
 *   L6  ISSUE that would go negative → 400
 *   L7  ISSUE that crosses below reorderPoint → auto PR created
 *   L8  POST /logistics/requests validates non-empty lines
 *   L9  Approve from PENDING → APPROVED + approvedBy stamp
 *   L10 Approve from non-PENDING → 409
 *   L11 Reject with reason
 *   L12 Fulfill issues stock and writes StockTransaction rows
 *   L13 Fulfill from non-APPROVED → 409
 *   L14 Cancel only allowed while PENDING
 *   L15 POST /purchase-requests/auto-generate scans low-stock items
 *   L16 PUT  /purchase-requests/:id RECEIVED auto-receives stock
 *   L17 PUT  /purchase-requests/:id rejects invalid status
 */

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      sub: req.headers['x-user-id'] || 'admin-1',
      role: req.headers['x-user-role'] || 'HR_ADMIN',
    };
    next();
  },
  authorize: () => (_req, _res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    IT_ADMIN: 'IT_ADMIN', MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const mockDb = {
  asset: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  assetAssignment: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  inventoryItem: {
    findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn(),
  },
  logisticsRequest: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  logisticsRequestLine: { update: jest.fn() },
  stockTransaction: { create: jest.fn(), findMany: jest.fn() },
  purchaseRequest: {
    count: jest.fn(), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(),
  },
  assetAlert: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  assetMaintenance: { create: jest.fn(), findMany: jest.fn() },
  softwareLicence: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(async (ops) => Promise.all(ops)),
};

jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockDb) }));

const request = require('supertest');
const app = require('../src/index');

const H = { 'x-user-id': 'admin-1', 'x-user-role': 'HR_ADMIN', authorization: 'Bearer t' };

beforeEach(() => jest.clearAllMocks());

// ── L1 ────────────────────────────────────────────────────────────────────────
test('L1 — POST /inventory creates item; duplicate SKU → 409', async () => {
  mockDb.inventoryItem.create
    .mockResolvedValueOnce({ id: 'inv-1', sku: 'STA-001', name: 'A4 Paper', category: 'STATIONERY' })
    .mockRejectedValueOnce({ code: 'P2002' });

  const r1 = await request(app)
    .post('/inventory')
    .set(H)
    .send({ sku: 'STA-001', name: 'A4 Paper', category: 'STATIONERY', currentStock: 100, reorderPoint: 20, reorderQty: 50 });
  expect(r1.status).toBe(201);
  expect(r1.body.sku).toBe('STA-001');

  const r2 = await request(app)
    .post('/inventory')
    .set(H)
    .send({ sku: 'STA-001', name: 'A4 Paper', category: 'STATIONERY' });
  expect(r2.status).toBe(409);
});

// ── L2 ────────────────────────────────────────────────────────────────────────
test('L2 — PUT /inventory/:id updates fields', async () => {
  mockDb.inventoryItem.update.mockResolvedValueOnce({ id: 'inv-1', reorderPoint: 30, location: 'Shelf B' });
  const r = await request(app)
    .put('/inventory/inv-1')
    .set(H)
    .send({ reorderPoint: 30, location: 'Shelf B' });
  expect(r.status).toBe(200);
  expect(r.body.reorderPoint).toBe(30);
});

// ── L3 ────────────────────────────────────────────────────────────────────────
test('L3 — GET /inventory/low-stock filters by reorderPoint', async () => {
  mockDb.inventoryItem.findMany.mockResolvedValueOnce([
    { id: 'inv-1', isActive: true, currentStock: 3, reorderPoint: 10, reorderQty: 20 },
    { id: 'inv-2', isActive: true, currentStock: 50, reorderPoint: 10, reorderQty: 0 },
  ]);
  const r = await request(app).get('/inventory/low-stock').set(H);
  expect(r.status).toBe(200);
  expect(r.body).toHaveLength(1);
  expect(r.body[0].id).toBe('inv-1');
  expect(r.body[0].suggestedReorderQty).toBe(20);
});

// ── L4 ────────────────────────────────────────────────────────────────────────
test('L4 — POST /inventory/:id/transactions RECEIVE adds quantity', async () => {
  mockDb.inventoryItem.findUnique.mockResolvedValueOnce({ id: 'inv-1', currentStock: 10, reorderPoint: 5, isActive: true });
  mockDb.stockTransaction.create.mockImplementationOnce(({ data }) => Promise.resolve({ ...data, id: 'tx-1' }));
  mockDb.inventoryItem.update.mockResolvedValueOnce({ id: 'inv-1', currentStock: 15 });

  const r = await request(app)
    .post('/inventory/inv-1/transactions')
    .set(H)
    .send({ txType: 'RECEIVE', quantity: 5, reference: 'PR-0001' });
  expect(r.status).toBe(201);
  expect(r.body.currentStock).toBe(15);
});

// ── L5 ────────────────────────────────────────────────────────────────────────
test('L5 — POST /inventory/:id/transactions ISSUE subtracts', async () => {
  mockDb.inventoryItem.findUnique.mockResolvedValueOnce({ id: 'inv-1', currentStock: 10, reorderPoint: 5, isActive: true });
  mockDb.stockTransaction.create.mockImplementationOnce(({ data }) => Promise.resolve({ ...data, id: 'tx-2' }));
  mockDb.inventoryItem.update.mockResolvedValueOnce({ id: 'inv-1', currentStock: 7 });

  const r = await request(app)
    .post('/inventory/inv-1/transactions')
    .set(H)
    .send({ txType: 'ISSUE', quantity: 3 });
  expect(r.status).toBe(201);
  expect(r.body.currentStock).toBe(7);
});

// ── L6 ────────────────────────────────────────────────────────────────────────
test('L6 — ISSUE would go negative → 400', async () => {
  mockDb.inventoryItem.findUnique.mockResolvedValueOnce({ id: 'inv-1', currentStock: 2 });
  const r = await request(app)
    .post('/inventory/inv-1/transactions')
    .set(H)
    .send({ txType: 'ISSUE', quantity: 10 });
  expect(r.status).toBe(400);
  expect(r.body.error).toMatch(/negative/);
});

// ── L7 ────────────────────────────────────────────────────────────────────────
test('L7 — ISSUE crossing reorderPoint triggers auto PR', async () => {
  mockDb.inventoryItem.findUnique
    .mockResolvedValueOnce({ id: 'inv-1', currentStock: 10, reorderPoint: 5, reorderQty: 20, isActive: true })   // initial fetch
    .mockResolvedValueOnce({ id: 'inv-1', currentStock: 4, reorderPoint: 5, reorderQty: 20, isActive: true });   // inside maybeAutoCreatePr
  mockDb.stockTransaction.create.mockImplementationOnce(({ data }) => Promise.resolve({ ...data, id: 'tx-3' }));
  mockDb.inventoryItem.update.mockResolvedValueOnce({ id: 'inv-1', currentStock: 4, reorderPoint: 5, isActive: true });
  mockDb.purchaseRequest.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
  mockDb.purchaseRequest.create.mockResolvedValueOnce({ id: 'pr-1', prNumber: 'PR-0001', quantitySuggested: 20, status: 'DRAFT' });

  const r = await request(app)
    .post('/inventory/inv-1/transactions')
    .set(H)
    .send({ txType: 'ISSUE', quantity: 6 });
  expect(r.status).toBe(201);
  expect(r.body.autoPr).not.toBeNull();
  expect(r.body.autoPr.prNumber).toBe('PR-0001');
});

// ── L8 ────────────────────────────────────────────────────────────────────────
test('L8 — POST /logistics/requests rejects empty lines', async () => {
  const r = await request(app)
    .post('/logistics/requests')
    .set(H)
    .send({ requesterEmployeeId: 'emp-1', lines: [] });
  expect(r.status).toBe(400);
});

// ── L9 ────────────────────────────────────────────────────────────────────────
test('L9 — approve PENDING request → APPROVED with stamps', async () => {
  mockDb.logisticsRequest.findUnique.mockResolvedValueOnce({ id: 'req-1', status: 'PENDING_APPROVAL' });
  mockDb.logisticsRequest.update.mockImplementationOnce(({ data }) => Promise.resolve({ id: 'req-1', ...data }));
  const r = await request(app).put('/logistics/requests/req-1/approve').set(H);
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('APPROVED');
  expect(r.body.approvedBy).toBe('admin-1');
});

// ── L10 ───────────────────────────────────────────────────────────────────────
test('L10 — approve from non-PENDING returns 409', async () => {
  mockDb.logisticsRequest.findUnique.mockResolvedValueOnce({ id: 'req-1', status: 'APPROVED' });
  const r = await request(app).put('/logistics/requests/req-1/approve').set(H);
  expect(r.status).toBe(409);
});

// ── L11 ───────────────────────────────────────────────────────────────────────
test('L11 — reject records reason', async () => {
  mockDb.logisticsRequest.findUnique.mockResolvedValueOnce({ id: 'req-1', status: 'PENDING_APPROVAL' });
  mockDb.logisticsRequest.update.mockImplementationOnce(({ data }) => Promise.resolve({ id: 'req-1', ...data }));
  const r = await request(app)
    .put('/logistics/requests/req-1/reject')
    .set(H)
    .send({ reason: 'Out of budget' });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('REJECTED');
  expect(r.body.rejectedReason).toBe('Out of budget');
});

// ── L12 ───────────────────────────────────────────────────────────────────────
test('L12 — fulfill issues stock and writes transactions', async () => {
  mockDb.logisticsRequest.findUnique
    .mockResolvedValueOnce({
      id: 'req-1', status: 'APPROVED', requesterEmployeeId: 'emp-1',
      lines: [
        { id: 'l-1', quantityRequested: 5, quantityFulfilled: 0, inventoryItem: { id: 'inv-1', currentStock: 10, reorderPoint: 3, isActive: true, sku: 'STA-001' } },
      ],
    })
    .mockResolvedValueOnce({
      id: 'req-1', status: 'FULFILLED', requesterEmployeeId: 'emp-1', fulfilledAt: new Date(),
      lines: [{ id: 'l-1', quantityFulfilled: 5, inventoryItem: { id: 'inv-1', currentStock: 5 } }],
    });
  mockDb.purchaseRequest.count.mockResolvedValue(0);

  const r = await request(app)
    .put('/logistics/requests/req-1/fulfill')
    .set(H)
    .send({ lines: [{ id: 'l-1', quantityFulfilled: 5 }] });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('FULFILLED');
  expect(mockDb.stockTransaction.create).toHaveBeenCalled();
});

// ── L13 ───────────────────────────────────────────────────────────────────────
test('L13 — fulfill from non-APPROVED returns 409', async () => {
  mockDb.logisticsRequest.findUnique.mockResolvedValueOnce({ id: 'req-1', status: 'PENDING_APPROVAL', lines: [] });
  const r = await request(app).put('/logistics/requests/req-1/fulfill').set(H).send({ lines: [] });
  expect(r.status).toBe(409);
});

// ── L14 ───────────────────────────────────────────────────────────────────────
test('L14 — cancel only allowed while PENDING', async () => {
  mockDb.logisticsRequest.findUnique.mockResolvedValueOnce({ id: 'req-1', status: 'APPROVED', requesterEmployeeId: 'emp-1' });
  const r = await request(app).delete('/logistics/requests/req-1').set(H);
  expect(r.status).toBe(409);
});

// ── L15 ───────────────────────────────────────────────────────────────────────
test('L15 — POST /purchase-requests/auto-generate creates PRs for low-stock', async () => {
  mockDb.inventoryItem.findMany.mockResolvedValueOnce([
    { id: 'inv-1', isActive: true, currentStock: 2, reorderPoint: 5, reorderQty: 20 },
    { id: 'inv-2', isActive: true, currentStock: 50, reorderPoint: 5, reorderQty: 20 },
  ]);
  // maybeAutoCreatePr: findUnique → ok, count → 0, then create
  mockDb.inventoryItem.findUnique.mockResolvedValue({ id: 'inv-1', isActive: true, currentStock: 2, reorderPoint: 5, reorderQty: 20 });
  mockDb.purchaseRequest.count.mockResolvedValue(0);
  mockDb.purchaseRequest.create.mockResolvedValueOnce({ id: 'pr-1', prNumber: 'PR-0001', status: 'DRAFT' });

  const r = await request(app).post('/purchase-requests/auto-generate').set(H);
  expect(r.status).toBe(200);
  expect(r.body.created).toBe(1);
});

// ── L16 ───────────────────────────────────────────────────────────────────────
test('L16 — PUT /purchase-requests/:id RECEIVED auto-receives stock', async () => {
  mockDb.purchaseRequest.findUnique.mockResolvedValueOnce({
    id: 'pr-1', prNumber: 'PR-0001', status: 'ORDERED', quantitySuggested: 30,
    inventoryItem: { id: 'inv-1', currentStock: 5, reorderPoint: 5 },
  });
  mockDb.purchaseRequest.findUnique.mockResolvedValueOnce({
    id: 'pr-1', prNumber: 'PR-0001', status: 'RECEIVED', quantitySuggested: 30,
    inventoryItem: { id: 'inv-1', currentStock: 35 },
  });

  const r = await request(app)
    .put('/purchase-requests/pr-1')
    .set(H)
    .send({ status: 'RECEIVED' });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('RECEIVED');
  // Verify a RECEIVE StockTransaction was attempted
  const created = mockDb.stockTransaction.create;
  expect(created).toHaveBeenCalled();
});

// ── L17 ───────────────────────────────────────────────────────────────────────
test('L17 — PUT /purchase-requests/:id rejects invalid status', async () => {
  // No findUnique needed — validation happens before fetch
  const r = await request(app).put('/purchase-requests/pr-1').set(H).send({ status: 'FAKE_STATUS' });
  expect(r.status).toBe(400);
});
