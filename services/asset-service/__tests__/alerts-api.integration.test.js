'use strict';
/**
 * AST-003 integration tests — maintenance, licences, alert sweep.
 *
 *   A1  POST /assets/:id/maintenance creates record and advances nextMaintenanceAt
 *   A2  GET  /assets/:id/maintenance lists history
 *   A3  POST /licences creates licence
 *   A4  PUT  /licences/:id rejects seatsUsed > seatsTotal
 *   A5  GET  /licences/expiring-soon filters by horizon
 *   A6  POST /assets/alerts/sweep creates idempotent warranty + maintenance + return + licence alerts
 *   A7  Sweep skips already-fired thresholds (idempotency)
 *   A8  GET  /assets/alerts returns dashboard with summary
 *   A9  Asset CRUD still works (regression for AST-001)
 *   A10 Asset assignment with offboardingDate stored
 */

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => {
    req.user = { sub: 'admin-1', role: 'HR_ADMIN' };
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
  assetMaintenance: { create: jest.fn(), findMany: jest.fn() },
  softwareLicence: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  assetAlert: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  inventoryItem: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  logisticsRequest: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  logisticsRequestLine: { update: jest.fn() },
  stockTransaction: { create: jest.fn(), findMany: jest.fn() },
  purchaseRequest: { count: jest.fn(), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(async (ops) => Promise.all(ops)),
};

jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockDb) }));

const request = require('supertest');
const app = require('../src/index');

const H = { 'x-user-id': 'admin-1', 'x-user-role': 'HR_ADMIN', authorization: 'Bearer t' };
const day = (daysFromNow) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.assetAlert.findMany.mockResolvedValue([]);
});

// ── A1 ────────────────────────────────────────────────────────────────────────
test('A1 — POST /assets/:id/maintenance advances nextMaintenanceAt', async () => {
  mockDb.asset.findUnique.mockResolvedValueOnce({ id: 'a-1', maintenanceIntervalDays: 90 });
  const completedAt = new Date('2026-05-01T00:00:00Z');
  mockDb.assetMaintenance.create.mockResolvedValueOnce({
    id: 'm-1', assetId: 'a-1', type: 'PREVENTIVE', completedAt, costAmount: 100,
  });
  mockDb.asset.update.mockResolvedValueOnce({ id: 'a-1', nextMaintenanceAt: new Date('2026-07-30') });
  mockDb.assetAlert.deleteMany.mockResolvedValueOnce({ count: 0 });

  const r = await request(app)
    .post('/assets/a-1/maintenance')
    .set(H)
    .send({ completedAt: '2026-05-01', type: 'PREVENTIVE', costAmount: 100 });

  expect(r.status).toBe(201);
  expect(mockDb.asset.update).toHaveBeenCalled();
  const updArg = mockDb.asset.update.mock.calls[0][0];
  expect(updArg.data.nextMaintenanceAt).toBeInstanceOf(Date);
  // Clear MAINTENANCE alerts so next cycle can fire
  expect(mockDb.assetAlert.deleteMany).toHaveBeenCalledWith({ where: { entityId: 'a-1', alertType: 'MAINTENANCE' } });
});

// ── A2 ────────────────────────────────────────────────────────────────────────
test('A2 — GET /assets/:id/maintenance returns history', async () => {
  mockDb.assetMaintenance.findMany.mockResolvedValueOnce([
    { id: 'm-1', assetId: 'a-1', scheduledAt: new Date(), type: 'PREVENTIVE' },
  ]);
  const r = await request(app).get('/assets/a-1/maintenance').set(H);
  expect(r.status).toBe(200);
  expect(r.body).toHaveLength(1);
});

// ── A3 ────────────────────────────────────────────────────────────────────────
test('A3 — POST /licences creates licence', async () => {
  mockDb.softwareLicence.create.mockResolvedValueOnce({
    id: 'lic-1', name: 'Office 365', seatsTotal: 50, seatsUsed: 10, expiryDate: day(120),
  });
  const r = await request(app)
    .post('/licences')
    .set(H)
    .send({ name: 'Office 365', vendor: 'Microsoft', seatsTotal: 50, seatsUsed: 10, expiryDate: day(120).toISOString(), renewalCost: 12000 });
  expect(r.status).toBe(201);
  expect(r.body.name).toBe('Office 365');
});

// ── A4 ────────────────────────────────────────────────────────────────────────
test('A4 — PUT /licences/:id rejects seatsUsed > seatsTotal', async () => {
  const r = await request(app)
    .put('/licences/lic-1')
    .set(H)
    .send({ seatsTotal: 10, seatsUsed: 20 });
  expect(r.status).toBe(400);
  expect(r.body.error).toMatch(/seatsUsed cannot exceed/);
});

// ── A5 ────────────────────────────────────────────────────────────────────────
test('A5 — GET /licences/expiring-soon filters by horizon', async () => {
  mockDb.softwareLicence.findMany.mockResolvedValueOnce([
    { id: 'lic-1', name: 'O365', expiryDate: day(25), seatsTotal: 50, seatsUsed: 10 },
  ]);
  const r = await request(app).get('/licences/expiring-soon?withinDays=60').set(H);
  expect(r.status).toBe(200);
  expect(r.body[0].daysUntilExpiry).toBe(25);
  expect(r.body[0].urgency).toBe('WARNING');
});

// ── A6 ────────────────────────────────────────────────────────────────────────
test('A6 — POST /assets/alerts/sweep creates alerts for all 4 types', async () => {
  // WARRANTY: asset expiring in 25 days → triggers 60-day and 30-day thresholds
  mockDb.asset.findMany
    .mockResolvedValueOnce([{ id: 'a-1', assetCode: 'AST-001', name: 'Laptop', warrantyExpiry: day(25), status: 'ASSIGNED' }])
    .mockResolvedValueOnce([{ id: 'a-2', assetCode: 'AST-002', name: 'Printer', nextMaintenanceAt: day(20), status: 'AVAILABLE' }]);
  // RETURN: assignment with offboardingDate in 10 days → triggers 14-day threshold
  mockDb.assetAssignment.findMany.mockResolvedValueOnce([
    { id: 'as-1', assetId: 'a-3', employeeId: 'emp-1', offboardingDate: day(10), asset: { assetCode: 'AST-003', name: 'Phone' } },
  ]);
  // LICENCE: expiring in 5 days → triggers 60, 30, 7
  mockDb.softwareLicence.findMany.mockResolvedValueOnce([
    { id: 'lic-1', name: 'O365', expiryDate: day(5), seatsTotal: 50, seatsUsed: 10 },
  ]);
  // No previously fired alerts
  mockDb.assetAlert.findMany.mockResolvedValue([]);
  mockDb.assetAlert.create.mockImplementation(({ data }) => Promise.resolve({ ...data, id: `al-${data.threshold}` }));

  const r = await request(app).post('/assets/alerts/sweep').set(H);
  expect(r.status).toBe(200);
  // WARRANTY 25 days → 60 + 30 thresholds = 2
  expect(r.body.warranty).toBe(2);
  // MAINTENANCE 20 days against [30,14,7] → only 30 crosses (20 > 14) → 1
  expect(r.body.maintenance).toBe(1);
  // RETURN 10 days → 14 + 7 = 2  (no, 10 ≤ 14 yes; 10 ≤ 7 no → only 14)
  expect(r.body.return).toBe(1);
  // LICENCE 5 days → 60 + 30 + 7 = 3
  expect(r.body.licence).toBe(3);
});

// ── A7 ────────────────────────────────────────────────────────────────────────
test('A7 — sweep skips already-fired thresholds (idempotency)', async () => {
  mockDb.asset.findMany
    .mockResolvedValueOnce([{ id: 'a-1', assetCode: 'AST-001', name: 'Laptop', warrantyExpiry: day(5), status: 'ASSIGNED' }])
    .mockResolvedValueOnce([]);
  mockDb.assetAssignment.findMany.mockResolvedValueOnce([]);
  mockDb.softwareLicence.findMany.mockResolvedValueOnce([]);
  // 60-day and 30-day already fired; only 7-day pending
  mockDb.assetAlert.findMany.mockResolvedValueOnce([{ threshold: 60 }, { threshold: 30 }]);
  mockDb.assetAlert.create.mockImplementation(({ data }) => Promise.resolve({ ...data, id: `al-${data.threshold}` }));

  const r = await request(app).post('/assets/alerts/sweep').set(H);
  expect(r.status).toBe(200);
  expect(r.body.warranty).toBe(1);
  const calls = mockDb.assetAlert.create.mock.calls;
  expect(calls[0][0].data.threshold).toBe(7);
});

// ── A8 ────────────────────────────────────────────────────────────────────────
test('A8 — GET /assets/alerts returns dashboard with summary', async () => {
  mockDb.assetAlert.findMany.mockResolvedValueOnce([
    { id: 'al-1', alertType: 'WARRANTY', entityId: 'a-1', threshold: 30, daysUntil: 20, message: 'X', firedAt: new Date() },
    { id: 'al-2', alertType: 'LICENCE',  entityId: 'l-1', threshold: 60, daysUntil: 50, message: 'Y', firedAt: new Date() },
    { id: 'al-3', alertType: 'WARRANTY', entityId: 'a-2', threshold: 60, daysUntil: 55, message: 'Z', firedAt: new Date() },
  ]);
  const r = await request(app).get('/assets/alerts').set(H);
  expect(r.status).toBe(200);
  expect(r.body.total).toBe(3);
  expect(r.body.summary.WARRANTY).toBe(2);
  expect(r.body.summary.LICENCE).toBe(1);
});

// ── A9 ────────────────────────────────────────────────────────────────────────
test('A9 — regression: GET /assets/:id returns asset', async () => {
  mockDb.asset.findMany.mockResolvedValueOnce([{ id: 'a-1', assetCode: 'AST-001', name: 'Laptop' }]);
  mockDb.asset.count.mockResolvedValueOnce(1);
  const r = await request(app).get('/assets?status=ASSIGNED').set(H);
  expect(r.status).toBe(200);
  expect(r.body.assets).toHaveLength(1);
});

// ── A10 ───────────────────────────────────────────────────────────────────────
test('A10 — POST /assets/:id/assign stores offboardingDate', async () => {
  mockDb.asset.findUnique.mockResolvedValueOnce({ id: 'a-1', status: 'AVAILABLE' });
  mockDb.assetAssignment.create.mockImplementationOnce(({ data }) => Promise.resolve({ id: 'as-1', ...data }));
  mockDb.asset.update.mockResolvedValueOnce({ id: 'a-1', status: 'ASSIGNED' });

  const r = await request(app)
    .post('/assets/a-1/assign')
    .set(H)
    .send({ employeeId: 'emp-1', offboardingDate: day(20).toISOString() });
  expect(r.status).toBe(201);
  expect(r.body.offboardingDate).toBeDefined();
});
