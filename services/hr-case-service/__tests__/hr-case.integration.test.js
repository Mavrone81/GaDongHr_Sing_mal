'use strict';
/**
 * Integration tests: HRC-001 — Disciplinary & Grievance Management
 *
 * Cases (open / list / detail / update)
 *   HC-01  POST /hr-cases — HR opens disciplinary case → 201
 *   HC-02  POST /hr-cases — employee files grievance about self → 201
 *   HC-03  POST /hr-cases — employee blocked from opening disciplinary → 403
 *   HC-04  POST /hr-cases — 400 missing title/summary
 *   HC-05  POST /hr-cases — discrimination category auto-flags isTafepReportable
 *   HC-06  GET  /hr-cases — employee sees only own
 *   HC-07  GET  /hr-cases — HR sees all with summary
 *   HC-08  GET  /hr-cases/:id — HR sees full detail
 *   HC-09  GET  /hr-cases/:id — employee blocked from another's
 *   HC-10  PUT  /hr-cases/:id — HR updates severity → recomputes TAFEP flag
 *
 * Incidents
 *   IN-01  POST /hr-cases/:id/incidents — HR logs incident
 *   IN-02  POST /hr-cases/:id/incidents — 400 missing description
 *
 * Actions
 *   AC-01  POST /hr-cases/:id/actions — HR issues VERBAL_WARNING
 *   AC-02  POST /hr-cases/:id/actions — TERMINATION on MINOR/INTAKE blocked (409)
 *   AC-03  POST /hr-cases/:id/actions — TERMINATION on GROSS_MISCONDUCT allowed
 *   AC-04  PUT  /hr-cases/:id/actions/:actId/acknowledge — subject acknowledges
 *   AC-05  GET  /hr-cases/:id/recommend-next-action — returns next ladder rung
 *
 * Escalation
 *   ES-01  POST /hr-cases/:id/escalate — HR escalates to next level
 *   ES-02  POST /hr-cases/:id/escalate — 409 at top level
 *   ES-03  POST /hr-cases/sweep — manual sweep auto-escalates overdue
 *
 * Appeals
 *   AP-01  POST /hr-cases/:id/appeal — subject files on RESOLVED → 201
 *   AP-02  POST /hr-cases/:id/appeal — 409 on non-resolved
 *   AP-03  PUT  /hr-cases/:id/appeals/:aid/decide — HR_MANAGER UPHELD
 *
 * Inquiry
 *   IQ-01  POST /hr-cases/:id/inquiry — HR_MANAGER forms committee
 *   IQ-02  POST /hr-cases/:id/inquiry — 409 duplicate committee
 *
 * Resolution / Closure / Withdraw
 *   RC-01  PUT /hr-cases/:id/resolve — 400 missing resolution
 *   RC-02  PUT /hr-cases/:id/resolve — succeeds → RESOLVED
 *   RC-03  PUT /hr-cases/:id/close   — succeeds
 *   RC-04  PUT /hr-cases/:id/withdraw — opener withdraws
 *
 * Dashboard
 *   DB-01  GET /hr-cases/dashboard — HR sees summary + overdue list
 */

let mockUser = { sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE', name: 'Alice Tan' };
const setUser = u => { mockUser = { ...mockUser, ...u }; };

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
  authorize: (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', FINANCE_ADMIN: 'FINANCE_ADMIN', IT_ADMIN: 'IT_ADMIN',
  },
}), { virtual: true });

const mockCaseCreate     = jest.fn();
const mockCaseFindUnique = jest.fn();
const mockCaseFindMany   = jest.fn();
const mockCaseUpdate     = jest.fn();
const mockCaseCount      = jest.fn();
const mockIncidentCreate = jest.fn();
const mockActionCreate   = jest.fn();
const mockActionUpdate   = jest.fn();
const mockTimelineCreate = jest.fn();
const mockAppealCreate   = jest.fn();
const mockAppealFindUnique = jest.fn();
const mockAppealUpdate   = jest.fn();
const mockCommitteeCreate     = jest.fn();
const mockCommitteeFindUnique = jest.fn();
const mockCommitteeUpdate     = jest.fn();
const mockAttachCreate   = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    hrCase: {
      create: mockCaseCreate, findUnique: mockCaseFindUnique,
      findMany: mockCaseFindMany, update: mockCaseUpdate, count: mockCaseCount,
    },
    caseIncident: { create: mockIncidentCreate },
    caseAction:   { create: mockActionCreate, update: mockActionUpdate },
    caseTimeline: { create: mockTimelineCreate.mockResolvedValue({}) },
    caseAppeal:   { create: mockAppealCreate, findUnique: mockAppealFindUnique, update: mockAppealUpdate },
    inquiryCommittee: { create: mockCommitteeCreate, findUnique: mockCommitteeFindUnique, update: mockCommitteeUpdate },
    caseAttachment: { create: mockAttachCreate },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));
global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });

const request = require('supertest');
const app     = require('../src/index');

function makeCase(o = {}) {
  return {
    id: 'case-001',
    caseNumber: 'DSC-2026-00001',
    type: 'DISCIPLINARY',
    status: 'OPEN',
    severity: 'MINOR',
    subjectEmployeeId: 'emp-001',
    subjectEmployeeName: 'Alice Tan',
    subjectDepartment: 'Engineering',
    respondentId: null, respondentName: null,
    title: 'Repeated late attendance',
    summary: 'Three weeks of late arrival.',
    category: 'attendance',
    isTafepReportable: false,
    isUnionised: false,
    unionConsulted: false, unionNotes: null,
    currentStage: 'INTAKE',
    escalationLevel: 'HR_ADMIN',
    openedBy: 'hr-1', openedByName: 'HR User',
    openedAt: new Date(), closedAt: null, resolvedAt: null,
    resolution: null, dueDate: null, confidential: true,
    createdAt: new Date(), updatedAt: new Date(),
    appeals: [],
    ...o,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE', name: 'Alice Tan' });
  mockTimelineCreate.mockResolvedValue({});
});

// ──────────────────────────────────────────────────────────────────────────────
// Cases — open / list / detail
// ──────────────────────────────────────────────────────────────────────────────
test('HC-01 HR opens disciplinary case → 201', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'hr-1' });
  mockCaseCount.mockResolvedValueOnce(0);
  mockCaseCreate.mockResolvedValueOnce(makeCase());
  const res = await request(app).post('/hr-cases').send({
    type: 'DISCIPLINARY', title: 'Late attendance',
    summary: 'Three weeks of late arrival', severity: 'MINOR',
    subjectEmployeeId: 'emp-001', subjectEmployeeName: 'Alice Tan',
    category: 'attendance',
  });
  expect(res.status).toBe(201);
  expect(mockCaseCreate.mock.calls[0][0].data.caseNumber).toBe('DSC-2026-00001');
});

test('HC-02 employee files grievance about self → 201', async () => {
  mockCaseCount.mockResolvedValueOnce(0);
  mockCaseCreate.mockResolvedValueOnce(makeCase({ type: 'GRIEVANCE', caseNumber: 'GRV-2026-00001', subjectEmployeeId: 'emp-001' }));
  const res = await request(app).post('/hr-cases').send({
    type: 'GRIEVANCE', title: 'Unfair workload',
    summary: 'Workload disproportionate', severity: 'MODERATE',
  });
  expect(res.status).toBe(201);
  // subject auto-set to filing employee
  expect(mockCaseCreate.mock.calls[0][0].data.subjectEmployeeId).toBe('emp-001');
});

test('HC-03 employee blocked from opening disciplinary → 403', async () => {
  const res = await request(app).post('/hr-cases').send({
    type: 'DISCIPLINARY', title: 'X', summary: 'X', subjectEmployeeId: 'emp-002', subjectEmployeeName: 'Bob',
  });
  expect(res.status).toBe(403);
});

test('HC-04 400 missing title/summary', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).post('/hr-cases').send({
    type: 'DISCIPLINARY', subjectEmployeeId: 'emp-001', subjectEmployeeName: 'Alice',
  });
  expect(res.status).toBe(400);
});

test('HC-05 discrimination category auto-flags isTafepReportable', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseCount.mockResolvedValueOnce(0);
  mockCaseCreate.mockResolvedValueOnce(makeCase({ isTafepReportable: true }));
  const res = await request(app).post('/hr-cases').send({
    type: 'GRIEVANCE', title: 'Bias in promotion',
    summary: 'Discriminatory promotion practice',
    subjectEmployeeId: 'emp-001', subjectEmployeeName: 'Alice',
    category: 'discrimination', severity: 'SERIOUS',
  });
  expect(res.status).toBe(201);
  expect(mockCaseCreate.mock.calls[0][0].data.isTafepReportable).toBe(true);
});

test('HC-06 employee sees only own cases', async () => {
  mockCaseFindMany.mockResolvedValueOnce([makeCase({ type: 'GRIEVANCE', openedBy: 'emp-001' })]);
  const res = await request(app).get('/hr-cases');
  expect(res.status).toBe(200);
  expect(mockCaseFindMany.mock.calls[0][0].where.OR).toBeDefined();
});

test('HC-07 HR sees all with summary', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindMany.mockResolvedValueOnce([
    makeCase({ status: 'OPEN' }),
    makeCase({ id: 'c2', status: 'RESOLVED', resolvedAt: new Date() }),
  ]);
  const res = await request(app).get('/hr-cases');
  expect(res.status).toBe(200);
  expect(res.body.summary.total).toBe(2);
  expect(res.body.summary.resolved).toBe(1);
});

test('HC-08 HR sees full detail', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({ incidents: [], actions: [], timeline: [], appeals: [], committee: null, attachments: [] }));
  const res = await request(app).get('/hr-cases/case-001');
  expect(res.status).toBe(200);
  expect(res.body.escalation).toBeDefined();
  expect(res.body.progress).toBeDefined();
});

test('HC-09 employee blocked from another\'s', async () => {
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({
    subjectEmployeeId: 'emp-999', openedBy: 'hr-1', type: 'DISCIPLINARY',
    incidents: [], actions: [], timeline: [], appeals: [], committee: null, attachments: [],
  }));
  const res = await request(app).get('/hr-cases/case-001');
  expect(res.status).toBe(403);
});

test('HC-10 HR updates severity → recomputes TAFEP flag', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({ category: 'harassment', type: 'GRIEVANCE', severity: 'MINOR' }));
  mockCaseUpdate.mockResolvedValueOnce(makeCase({ severity: 'GROSS_MISCONDUCT', isTafepReportable: true }));
  const res = await request(app).put('/hr-cases/case-001').send({ severity: 'GROSS_MISCONDUCT' });
  expect(res.status).toBe(200);
  expect(mockCaseUpdate.mock.calls[0][0].data.isTafepReportable).toBe(true);
});

// ──────────────────────────────────────────────────────────────────────────────
// Incidents
// ──────────────────────────────────────────────────────────────────────────────
test('IN-01 HR logs incident', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase());
  mockIncidentCreate.mockResolvedValueOnce({
    id: 'inc-1', caseId: 'case-001', occurredAt: new Date('2026-05-01'),
    description: 'Arrived 2 hours late',
  });
  const res = await request(app).post('/hr-cases/case-001/incidents').send({
    occurredAt: '2026-05-01', description: 'Arrived 2 hours late',
  });
  expect(res.status).toBe(201);
});

test('IN-02 400 missing description', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).post('/hr-cases/case-001/incidents').send({
    occurredAt: '2026-05-01',
  });
  expect(res.status).toBe(400);
});

// ──────────────────────────────────────────────────────────────────────────────
// Actions
// ──────────────────────────────────────────────────────────────────────────────
test('AC-01 HR issues VERBAL_WARNING', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase());
  mockActionCreate.mockResolvedValueOnce({
    id: 'act-1', caseId: 'case-001', actionType: 'VERBAL_WARNING',
  });
  const res = await request(app).post('/hr-cases/case-001/actions').send({
    actionType: 'VERBAL_WARNING', notes: 'First verbal warning',
  });
  expect(res.status).toBe(201);
});

test('AC-02 TERMINATION on MINOR/INTAKE blocked (409)', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({ severity: 'MINOR', currentStage: 'INTAKE' }));
  const res = await request(app).post('/hr-cases/case-001/actions').send({
    actionType: 'TERMINATION_FOR_CAUSE',
  });
  expect(res.status).toBe(409);
});

test('AC-03 TERMINATION on GROSS_MISCONDUCT allowed', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({ severity: 'GROSS_MISCONDUCT' }));
  mockActionCreate.mockResolvedValueOnce({ id: 'act-1', actionType: 'TERMINATION_FOR_CAUSE' });
  mockCaseUpdate.mockResolvedValueOnce(makeCase({ currentStage: 'CLOSED' }));
  const res = await request(app).post('/hr-cases/case-001/actions').send({
    actionType: 'TERMINATION_FOR_CAUSE',
  });
  expect(res.status).toBe(201);
});

test('AC-04 subject acknowledges action', async () => {
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({ subjectEmployeeId: 'emp-001' }));
  mockActionUpdate.mockResolvedValueOnce({
    id: 'act-1', actionType: 'WRITTEN_WARNING', acknowledged: true,
  });
  const res = await request(app).put('/hr-cases/case-001/actions/act-1/acknowledge').send({});
  expect(res.status).toBe(200);
  expect(res.body.acknowledged).toBe(true);
});

test('AC-05 recommend-next-action returns next ladder rung', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce({
    ...makeCase(), actions: [{ actionType: 'VERBAL_WARNING' }],
  });
  const res = await request(app).get('/hr-cases/case-001/recommend-next-action');
  expect(res.status).toBe(200);
  expect(res.body.recommended).toBe('WRITTEN_WARNING');
});

// ──────────────────────────────────────────────────────────────────────────────
// Escalation
// ──────────────────────────────────────────────────────────────────────────────
test('ES-01 HR escalates to next level', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({ escalationLevel: 'HR_ADMIN' }));
  mockCaseUpdate.mockResolvedValueOnce(makeCase({ escalationLevel: 'HR_MANAGER' }));
  const res = await request(app).post('/hr-cases/case-001/escalate').send({ reason: 'Stalled review' });
  expect(res.status).toBe(200);
  expect(res.body.escalationLevel).toBe('HR_MANAGER');
});

test('ES-02 409 at top level', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({ escalationLevel: 'BOARD' }));
  const res = await request(app).post('/hr-cases/case-001/escalate').send({ reason: 'X' });
  expect(res.status).toBe(409);
});

test('ES-03 manual sweep auto-escalates overdue', async () => {
  setUser({ role: 'HR_ADMIN' });
  const oldOpened = new Date(Date.now() - 100 * 86_400_000);
  mockCaseFindMany.mockResolvedValueOnce([
    makeCase({ openedAt: oldOpened, status: 'OPEN' }),
    makeCase({ id: 'c2', openedAt: new Date(), status: 'OPEN' }),
  ]);
  mockCaseUpdate.mockResolvedValue({});
  const res = await request(app).post('/hr-cases/sweep').send({});
  expect(res.status).toBe(200);
  expect(res.body.escalated).toBe(1);
});

// ──────────────────────────────────────────────────────────────────────────────
// Appeals
// ──────────────────────────────────────────────────────────────────────────────
test('AP-01 subject files appeal on RESOLVED → 201', async () => {
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({
    status: 'RESOLVED', subjectEmployeeId: 'emp-001', appeals: [],
  }));
  mockAppealCreate.mockResolvedValueOnce({
    id: 'ap-1', caseId: 'case-001', filedBy: 'emp-001', status: 'PENDING',
    groundsForAppeal: 'Decision overlooks evidence',
  });
  mockCaseUpdate.mockResolvedValueOnce(makeCase({ status: 'PENDING_DECISION', currentStage: 'APPEAL' }));
  const res = await request(app).post('/hr-cases/case-001/appeal').send({
    groundsForAppeal: 'Decision overlooks evidence',
  });
  expect(res.status).toBe(201);
});

test('AP-02 409 on non-resolved case', async () => {
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({ status: 'OPEN', subjectEmployeeId: 'emp-001', appeals: [] }));
  const res = await request(app).post('/hr-cases/case-001/appeal').send({
    groundsForAppeal: 'X',
  });
  expect(res.status).toBe(409);
});

test('AP-03 HR_MANAGER decides appeal UPHELD', async () => {
  setUser({ role: 'HR_MANAGER' });
  mockAppealFindUnique.mockResolvedValueOnce({ id: 'ap-1', status: 'PENDING' });
  mockAppealUpdate.mockResolvedValueOnce({ id: 'ap-1', status: 'UPHELD' });
  const res = await request(app).put('/hr-cases/case-001/appeals/ap-1/decide').send({
    status: 'UPHELD', outcome: 'Action overturned',
  });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('UPHELD');
});

// ──────────────────────────────────────────────────────────────────────────────
// Inquiry committee
// ──────────────────────────────────────────────────────────────────────────────
test('IQ-01 HR_MANAGER forms committee', async () => {
  setUser({ role: 'HR_MANAGER' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase());
  mockCommitteeFindUnique.mockResolvedValueOnce(null);
  mockCommitteeCreate.mockResolvedValueOnce({ id: 'com-1', caseId: 'case-001', chairId: 'hr-2', chairName: 'Chair' });
  mockCaseUpdate.mockResolvedValueOnce(makeCase({ currentStage: 'INVESTIGATION', status: 'UNDER_INVESTIGATION' }));
  const res = await request(app).post('/hr-cases/case-001/inquiry').send({
    chairId: 'hr-2', chairName: 'Chair', scope: 'Investigate the conduct alleged',
    members: ['hr-3', 'mgr-1'], memberNames: ['Member A', 'Member B'],
  });
  expect(res.status).toBe(201);
});

test('IQ-02 409 duplicate committee', async () => {
  setUser({ role: 'HR_MANAGER' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase());
  mockCommitteeFindUnique.mockResolvedValueOnce({ id: 'com-1' });
  const res = await request(app).post('/hr-cases/case-001/inquiry').send({
    chairId: 'x', chairName: 'X', scope: 'X',
  });
  expect(res.status).toBe(409);
});

// ──────────────────────────────────────────────────────────────────────────────
// Resolution / Closure / Withdraw
// ──────────────────────────────────────────────────────────────────────────────
test('RC-01 400 missing resolution', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).put('/hr-cases/case-001/resolve').send({});
  expect(res.status).toBe(400);
});

test('RC-02 resolve → RESOLVED', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase());
  mockCaseUpdate.mockResolvedValueOnce(makeCase({ status: 'RESOLVED', resolvedAt: new Date() }));
  const res = await request(app).put('/hr-cases/case-001/resolve').send({
    resolution: 'Written warning issued; case resolved',
  });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('RESOLVED');
});

test('RC-03 close succeeds', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({ status: 'RESOLVED' }));
  mockCaseUpdate.mockResolvedValueOnce(makeCase({ status: 'CLOSED', closedAt: new Date() }));
  const res = await request(app).put('/hr-cases/case-001/close').send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('CLOSED');
});

test('RC-04 opener withdraws', async () => {
  setUser({ sub: 'emp-001', employeeId: 'emp-001' });
  mockCaseFindUnique.mockResolvedValueOnce(makeCase({ openedBy: 'emp-001', status: 'OPEN' }));
  mockCaseUpdate.mockResolvedValueOnce(makeCase({ status: 'WITHDRAWN' }));
  const res = await request(app).put('/hr-cases/case-001/withdraw').send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('WITHDRAWN');
});

// ──────────────────────────────────────────────────────────────────────────────
// Dashboard
// ──────────────────────────────────────────────────────────────────────────────
test('DB-01 HR sees summary + overdue list', async () => {
  setUser({ role: 'HR_ADMIN' });
  const oldOpened = new Date(Date.now() - 100 * 86_400_000);
  mockCaseFindMany.mockResolvedValueOnce([
    makeCase({ openedAt: oldOpened, status: 'OPEN' }),
    makeCase({ id: 'c2', openedAt: new Date(), status: 'OPEN' }),
  ]);
  const res = await request(app).get('/hr-cases/dashboard');
  expect(res.status).toBe(200);
  expect(res.body.summary.total).toBe(2);
  expect(res.body.overdueEscalation.length).toBe(1);
});
