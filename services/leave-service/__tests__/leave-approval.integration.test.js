'use strict';
/**
 * Integration tests for PUT /leave/applications/:id/approve
 *
 * Supervisor chain enforcement:
 *   A) HR_ADMIN/SUPER_ADMIN bypass supervisor check entirely
 *   B) ANY_ONE flow — designated supervisor can approve
 *   C) ANY_ONE flow — non-supervisor is rejected (403)
 *   D) SEQUENTIAL flow — correct-step supervisor advances the chain
 *   E) SEQUENTIAL flow — out-of-order supervisor is rejected
 *   F) SEQUENTIAL flow — last step triggers final APPROVED
 *   G) No supervisor chain configured — non-admin is rejected
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

let mockCurrentUser = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN', employeeId: null };
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

const mockFindUnique = jest.fn();
const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();

const mockApprovalStepCreate = jest.fn().mockResolvedValue({});

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    leaveApplication: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
    leaveEntitlement: { updateMany: mockUpdateMany },
    leaveType: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    leaveEntitlement: { updateMany: mockUpdateMany, findFirst: mockFindFirst },
    publicHoliday: { findMany: jest.fn().mockResolvedValue([]) },
    leaveApprovalStep: { create: mockApprovalStepCreate },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

// Mock axios for supervisor-check calls
const mockAxiosGet = jest.fn();
jest.mock('axios', () => ({ get: mockAxiosGet }));

const request = require('supertest');
const app = require('../src/index');

const PENDING_APP = {
  id: 'app-001',
  employeeId: 'emp-001',
  leaveTypeId: 'lt-001',
  startDate: new Date('2026-06-01'),
  endDate: new Date('2026-06-03'),
  totalDays: 3,
  status: 'PENDING',
  currentApprovalStep: 1,
  approvalSteps: [],
};

function supervisorCheckResponse(opts = {}) {
  return {
    data: {
      isSupervisor: opts.isSupervisor ?? true,
      flowType: opts.flowType ?? 'ANY_ONE',
      supervisorOrder: opts.supervisorOrder ?? 1,
      totalSupervisors: opts.totalSupervisors ?? 1,
      supervisors: opts.supervisors ?? [{ employeeId: 'emp-sup', order: 1 }],
    },
  };
}

afterEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { sub: 'admin-001', email: 'admin@test.com', role: 'HR_ADMIN', employeeId: null };
});

// ── A) Admin bypass ────────────────────────────────────────────────────────────
describe('A) HR_ADMIN bypasses supervisor check', () => {
  test('200 — HR_ADMIN approves without supervisor chain check', async () => {
    setUser({ sub: 'admin-001', role: 'HR_ADMIN', employeeId: null });
    mockFindUnique.mockResolvedValue(PENDING_APP);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockUpdate.mockResolvedValue({ ...PENDING_APP, status: 'APPROVED' });

    const res = await request(app).put('/leave/applications/app-001/approve');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  test('200 — SUPER_ADMIN bypasses supervisor check', async () => {
    setUser({ sub: 'sa-001', role: 'SUPER_ADMIN', employeeId: null });
    mockFindUnique.mockResolvedValue(PENDING_APP);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockUpdate.mockResolvedValue({ ...PENDING_APP, status: 'APPROVED' });

    const res = await request(app).put('/leave/applications/app-001/approve');

    expect(res.status).toBe(200);
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });
});

// ── B) ANY_ONE flow ─────────────────────────────────────────────────────────────
describe('B) ANY_ONE flow — designated supervisor approves', () => {
  test('200 — any designated supervisor can approve directly', async () => {
    setUser({ sub: 'mgr-001', role: 'LINE_MANAGER', employeeId: 'emp-sup' });
    mockFindUnique.mockResolvedValue(PENDING_APP);
    mockAxiosGet.mockResolvedValue(supervisorCheckResponse({ flowType: 'ANY_ONE', isSupervisor: true }));
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockUpdate.mockResolvedValue({ ...PENDING_APP, status: 'APPROVED' });

    const res = await request(app).put('/leave/applications/app-001/approve');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining('supervisor-check'),
      expect.objectContaining({ params: { checkerEmployeeId: 'emp-sup' } })
    );
  });
});

// ── C) ANY_ONE — non-supervisor rejected ──────────────────────────────────────
describe('C) ANY_ONE flow — non-supervisor rejected', () => {
  test('403 — non-supervisor LINE_MANAGER cannot approve', async () => {
    setUser({ sub: 'mgr-002', role: 'LINE_MANAGER', employeeId: 'emp-other' });
    mockFindUnique.mockResolvedValue(PENDING_APP);
    mockAxiosGet.mockResolvedValue(supervisorCheckResponse({ isSupervisor: false, totalSupervisors: 1 }));

    const res = await request(app).put('/leave/applications/app-001/approve');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a designated supervisor/i);
  });
});

// ── D) SEQUENTIAL flow — correct step advances chain ─────────────────────────
describe('D) SEQUENTIAL flow — correct step advances chain', () => {
  test('200 with message — step 1 approves, application stays PENDING', async () => {
    setUser({ sub: 'mgr-001', role: 'LINE_MANAGER', employeeId: 'emp-sup-1' });
    const seqApp = { ...PENDING_APP, currentApprovalStep: 1 };
    mockFindUnique.mockResolvedValue(seqApp);
    mockAxiosGet.mockResolvedValue(supervisorCheckResponse({
      flowType: 'SEQUENTIAL', isSupervisor: true, supervisorOrder: 1, totalSupervisors: 2,
    }));
    mockApprovalStepCreate.mockResolvedValue({});
    mockUpdate.mockResolvedValue({ ...seqApp, currentApprovalStep: 2 });

    const res = await request(app).put('/leave/applications/app-001/approve');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Step 1 approved/i);
    expect(res.body.currentApprovalStep).toBe(2);
    expect(mockApprovalStepCreate).toHaveBeenCalled();
    // Should NOT call updateMany (balance not moved yet)
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});

// ── E) SEQUENTIAL — out-of-order rejected ─────────────────────────────────────
describe('E) SEQUENTIAL flow — out-of-order supervisor rejected', () => {
  test('403 — step-2 supervisor cannot approve when step 1 is pending', async () => {
    setUser({ sub: 'mgr-002', role: 'LINE_MANAGER', employeeId: 'emp-sup-2' });
    const seqApp = { ...PENDING_APP, currentApprovalStep: 1 };
    mockFindUnique.mockResolvedValue(seqApp);
    mockAxiosGet.mockResolvedValue(supervisorCheckResponse({
      flowType: 'SEQUENTIAL', isSupervisor: true, supervisorOrder: 2, totalSupervisors: 2,
    }));

    const res = await request(app).put('/leave/applications/app-001/approve');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/sequential/i);
  });
});

// ── F) SEQUENTIAL — last step triggers APPROVED ───────────────────────────────
describe('F) SEQUENTIAL flow — last step triggers final APPROVED', () => {
  test('200 APPROVED — last supervisor approval completes the application', async () => {
    setUser({ sub: 'mgr-002', role: 'LINE_MANAGER', employeeId: 'emp-sup-2' });
    const seqApp = { ...PENDING_APP, currentApprovalStep: 2 };
    mockFindUnique.mockResolvedValue(seqApp);
    mockAxiosGet.mockResolvedValue(supervisorCheckResponse({
      flowType: 'SEQUENTIAL', isSupervisor: true, supervisorOrder: 2, totalSupervisors: 2,
    }));
    mockApprovalStepCreate.mockResolvedValue({});
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockUpdate.mockResolvedValue({ ...seqApp, status: 'APPROVED' });

    const res = await request(app).put('/leave/applications/app-001/approve');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(mockApprovalStepCreate).toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalled(); // balance moved
  });
});

// ── G) No supervisor chain ─────────────────────────────────────────────────────
describe('G) No supervisors configured — non-admin cannot approve', () => {
  test('403 — LINE_MANAGER cannot approve when no supervisors configured', async () => {
    setUser({ sub: 'mgr-001', role: 'LINE_MANAGER', employeeId: 'emp-sup' });
    mockFindUnique.mockResolvedValue(PENDING_APP);
    mockAxiosGet.mockResolvedValue(supervisorCheckResponse({ totalSupervisors: 0, isSupervisor: false }));

    const res = await request(app).put('/leave/applications/app-001/approve');

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/No supervisors configured/i);
  });
});

// ── Common cases ───────────────────────────────────────────────────────────────
describe('Common — non-PENDING rejection', () => {
  test('400 — cannot approve already-approved application', async () => {
    setUser({ sub: 'admin-001', role: 'HR_ADMIN', employeeId: null });
    mockFindUnique.mockResolvedValue({ ...PENDING_APP, status: 'APPROVED', approvalSteps: [] });

    const res = await request(app).put('/leave/applications/app-001/approve');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PENDING/i);
  });

  test('404 — application not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await request(app).put('/leave/applications/nonexistent/approve');
    expect(res.status).toBe(404);
  });
});
