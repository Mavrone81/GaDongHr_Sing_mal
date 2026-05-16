'use strict';
/**
 * Integration tests for supervisor endpoints:
 *   GET /employees/:id/supervisors
 *   PUT /employees/:id/supervisors
 *   GET /employees/me/subordinates
 *   GET /employees/:id/supervisor-check
 *
 * Scenarios:
 *   A) GET supervisors — returns supervisor list and flowType
 *   B) PUT supervisors — HR Admin replaces list, enforces uniqueness/self-check
 *   C) GET me/subordinates — returns employees where I am supervisor
 *   D) GET supervisor-check — internal call checks if checker is a supervisor
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockCurrentUser = { sub: 'admin-001', email: 'admin@company.com', role: 'HR_ADMIN', employeeId: null };
const setUser = u => { mockCurrentUser = u; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockCurrentUser; next(); },
  authorize: () => (_req, _res, next) => next(),
  authorizeSelfOrRole: () => (_req, _res, next) => next(),
  ROLES: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER', LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE', PAYROLL_OFFICER: 'PAYROLL_OFFICER' },
}), { virtual: true });

jest.mock('/app/shared/crypto', () => ({ encryptFields: o => o, decrypt: v => v }), { virtual: true });

const mockFindUnique = jest.fn();
const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockCount = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDeleteMany = jest.fn();
const mockTransaction = jest.fn();
const mockAuditCreate = jest.fn().mockResolvedValue({});

const mockEmpSupervisorFindMany = jest.fn();
const mockEmpSupervisorCreate = jest.fn();
const mockEmpSupervisorDeleteMany = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    employee: {
      findUnique: mockFindUnique,
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      count: mockCount,
      create: mockCreate,
      update: mockUpdate,
    },
    employeeSupervisor: {
      findMany: mockEmpSupervisorFindMany,
      create: mockEmpSupervisorCreate,
      deleteMany: mockEmpSupervisorDeleteMany,
    },
    auditLog: { create: mockAuditCreate },
    employeeApplication: { findMany: jest.fn().mockResolvedValue([]) },
    salaryHistory: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: mockTransaction,
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

const request = require('supertest');
const app = require('../src/index');

const INTERNAL_KEY = '***REMOVED***';

afterEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { sub: 'admin-001', email: 'admin@company.com', role: 'HR_ADMIN', employeeId: null };
});

// ── A) GET /employees/:id/supervisors ─────────────────────────────────────────
describe('GET /employees/:id/supervisors', () => {
  test('200 — returns supervisor list with flowType', async () => {
    mockFindUnique.mockResolvedValue({
      approvalFlowType: 'ANY_ONE',
      supervisors: [
        { id: 'sup-rec-001', order: 1, supervisor: { id: 'emp-002', fullName: 'Bob Lee', designation: 'Manager', department: 'Engineering', employeeCode: 'EMP-002' } },
      ],
    });

    const res = await request(app).get('/employees/emp-001/supervisors');

    expect(res.status).toBe(200);
    expect(res.body.flowType).toBe('ANY_ONE');
    expect(res.body.supervisors).toHaveLength(1);
    expect(res.body.supervisors[0].fullName).toBe('Bob Lee');
    expect(res.body.supervisors[0].order).toBe(1);
  });

  test('404 — employee not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/employees/nonexistent/supervisors');
    expect(res.status).toBe(404);
  });

  test('200 — empty list when no supervisors configured', async () => {
    mockFindUnique.mockResolvedValue({ approvalFlowType: 'ANY_ONE', supervisors: [] });
    const res = await request(app).get('/employees/emp-001/supervisors');
    expect(res.status).toBe(200);
    expect(res.body.supervisors).toHaveLength(0);
  });
});

// ── B) PUT /employees/:id/supervisors ─────────────────────────────────────────
describe('PUT /employees/:id/supervisors', () => {
  test('200 — HR Admin can replace supervisor list', async () => {
    // findUnique for existence check
    mockFindUnique
      .mockResolvedValueOnce({ id: 'emp-001' }) // existence check
      .mockResolvedValueOnce({                   // updated list
        approvalFlowType: 'ANY_ONE',
        supervisors: [
          { id: 'sup-rec-001', order: 1, supervisor: { id: 'emp-002', fullName: 'Bob Lee', designation: 'Manager', department: 'Engineering', employeeCode: 'EMP-002' } },
        ],
      });
    mockFindMany.mockResolvedValue([{ id: 'emp-002' }]); // supervisor validation
    mockTransaction.mockResolvedValue([]);

    const res = await request(app)
      .put('/employees/emp-001/supervisors')
      .send({ flowType: 'ANY_ONE', supervisors: [{ employeeId: 'emp-002', order: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.flowType).toBe('ANY_ONE');
    expect(res.body.supervisors).toHaveLength(1);
  });

  test('404 — employee not found when updating', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(app)
      .put('/employees/nonexistent/supervisors')
      .send({ flowType: 'ANY_ONE', supervisors: [] });
    expect(res.status).toBe(404);
  });

  test('400 — rejects invalid supervisor employee IDs', async () => {
    mockFindUnique.mockResolvedValue({ id: 'emp-001' });
    mockFindMany.mockResolvedValue([]); // none found
    const res = await request(app)
      .put('/employees/emp-001/supervisors')
      .send({ flowType: 'ANY_ONE', supervisors: [{ employeeId: 'bad-id', order: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  test('400 — rejects self as supervisor', async () => {
    mockFindUnique.mockResolvedValue({ id: 'emp-001' });
    mockFindMany.mockResolvedValue([{ id: 'emp-001' }]);
    const res = await request(app)
      .put('/employees/emp-001/supervisors')
      .send({ flowType: 'ANY_ONE', supervisors: [{ employeeId: 'emp-001', order: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own supervisor/i);
  });

  test('200 — clears all supervisors with empty array', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ id: 'emp-001' })
      .mockResolvedValueOnce({ approvalFlowType: 'ANY_ONE', supervisors: [] });
    mockTransaction.mockResolvedValue([]);

    const res = await request(app)
      .put('/employees/emp-001/supervisors')
      .send({ flowType: 'ANY_ONE', supervisors: [] });

    expect(res.status).toBe(200);
    expect(res.body.supervisors).toHaveLength(0);
  });
});

// ── C) GET /employees/me/subordinates ─────────────────────────────────────────
describe('GET /employees/me/subordinates', () => {
  test('200 — returns employees where I am supervisor (via JWT employeeId)', async () => {
    setUser({ sub: 'mgr-001', email: 'mgr@company.com', role: 'HR_MANAGER', employeeId: 'emp-mgr' });
    mockEmpSupervisorFindMany.mockResolvedValue([
      { employee: { id: 'emp-001', fullName: 'Alice Tan', designation: 'Engineer', department: 'Engineering', employeeCode: 'EMP-001', isActive: true } },
    ]);

    const res = await request(app).get('/employees/me/subordinates');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].fullName).toBe('Alice Tan');
  });

  test('200 — falls back to email lookup when employeeId absent from JWT', async () => {
    setUser({ sub: 'mgr-001', email: 'mgr@company.com', role: 'HR_MANAGER', employeeId: null });
    mockFindFirst.mockResolvedValue({ id: 'emp-mgr' });
    mockEmpSupervisorFindMany.mockResolvedValue([
      { employee: { id: 'emp-001', fullName: 'Alice Tan', designation: 'Engineer', department: 'Engineering', employeeCode: 'EMP-001', isActive: true } },
    ]);

    const res = await request(app).get('/employees/me/subordinates');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { workEmail: { equals: 'mgr@company.com', mode: 'insensitive' } },
    }));
  });

  test('400 — no employee profile when both employeeId and email absent', async () => {
    setUser({ sub: 'mgr-001', email: null, role: 'HR_MANAGER', employeeId: null });
    const res = await request(app).get('/employees/me/subordinates');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No employee profile linked/i);
  });
});

// ── D) GET /employees/:id/supervisor-check ────────────────────────────────────
describe('GET /employees/:id/supervisor-check', () => {
  test('200 — internal service key returns supervisor status', async () => {
    mockFindUnique.mockResolvedValue({
      approvalFlowType: 'ANY_ONE',
      supervisors: [{ supervisorEmployeeId: 'emp-002', order: 1 }],
    });

    const res = await request(app)
      .get('/employees/emp-001/supervisor-check')
      .set('x-internal-service-key', INTERNAL_KEY)
      .query({ checkerEmployeeId: 'emp-002' });

    expect(res.status).toBe(200);
    expect(res.body.isSupervisor).toBe(true);
    expect(res.body.flowType).toBe('ANY_ONE');
    expect(res.body.supervisorOrder).toBe(1);
    expect(res.body.totalSupervisors).toBe(1);
  });

  test('200 — returns isSupervisor=false for non-supervisors', async () => {
    mockFindUnique.mockResolvedValue({
      approvalFlowType: 'ANY_ONE',
      supervisors: [{ supervisorEmployeeId: 'emp-002', order: 1 }],
    });

    const res = await request(app)
      .get('/employees/emp-001/supervisor-check')
      .set('x-internal-service-key', INTERNAL_KEY)
      .query({ checkerEmployeeId: 'emp-999' });

    expect(res.status).toBe(200);
    expect(res.body.isSupervisor).toBe(false);
    expect(res.body.supervisorOrder).toBeNull();
  });

  test('200 — sequential flow returns correct order', async () => {
    mockFindUnique.mockResolvedValue({
      approvalFlowType: 'SEQUENTIAL',
      supervisors: [
        { supervisorEmployeeId: 'emp-002', order: 1 },
        { supervisorEmployeeId: 'emp-003', order: 2 },
      ],
    });

    const res = await request(app)
      .get('/employees/emp-001/supervisor-check')
      .set('x-internal-service-key', INTERNAL_KEY)
      .query({ checkerEmployeeId: 'emp-003' });

    expect(res.status).toBe(200);
    expect(res.body.isSupervisor).toBe(true);
    expect(res.body.supervisorOrder).toBe(2);
    expect(res.body.totalSupervisors).toBe(2);
    expect(res.body.flowType).toBe('SEQUENTIAL');
  });

  test('400 — missing checkerEmployeeId query param', async () => {
    const res = await request(app)
      .get('/employees/emp-001/supervisor-check')
      .set('x-internal-service-key', INTERNAL_KEY);
    expect(res.status).toBe(400);
  });

  test('404 — employee not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(app)
      .get('/employees/emp-001/supervisor-check')
      .set('x-internal-service-key', INTERNAL_KEY)
      .query({ checkerEmployeeId: 'emp-002' });
    expect(res.status).toBe(404);
  });
});
