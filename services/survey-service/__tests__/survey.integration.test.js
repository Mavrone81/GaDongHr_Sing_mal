'use strict';
/**
 * Integration tests: ENG-001 — Employee Engagement Survey
 *
 * Survey CRUD
 *   SV-01  POST /surveys — HR creates → 201
 *   SV-02  POST /surveys — 400 missing fields
 *   SV-03  POST /surveys — 409 duplicate code
 *   SV-04  GET  /surveys — employee sees ACTIVE only
 *   SV-05  GET  /surveys — HR sees all
 *   SV-06  POST /surveys/:id/publish — DRAFT → ACTIVE
 *   SV-07  POST /surveys/:id/publish — 409 no questions
 *   SV-08  POST /surveys/:id/close — ACTIVE → CLOSED
 *
 * Questions
 *   QU-01  POST /surveys/:id/questions — adds LIKERT_5
 *   QU-02  POST /surveys/:id/questions — 400 MULTI_CHOICE w/o choices
 *
 * Responses
 *   RS-01  POST /surveys/:id/responses — valid submission → 201
 *   RS-02  POST /surveys/:id/responses — 400 invalid Likert
 *   RS-03  POST /surveys/:id/responses — 409 when not ACTIVE
 *   RS-04  POST /surveys/:id/responses — non-anonymous: duplicate blocked
 *   RS-05  GET  /surveys/:id/responses/me — returns submitted=true after submission
 *
 * Dashboard
 *   DB-01  GET  /surveys/:id/dashboard — HR sees aggregates
 *   DB-02  GET  /surveys/:id/dashboard — employee 403
 *
 * Actions
 *   AC-01  POST /surveys/:id/actions — manager creates
 *   AC-02  PUT  /surveys/:id/actions/:aid — status DONE sets closedAt
 *
 * Exit trigger
 *   EX-01  POST /surveys/exit-trigger — returns active EXIT survey
 *   EX-02  POST /surveys/exit-trigger — 404 when no exit survey exists
 */

let mockUser = { sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE', name: 'Alice Tan', department: 'Engineering' };
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
    PAYROLL_OFFICER: 'PAYROLL_OFFICER', FINANCE_ADMIN: 'FINANCE_ADMIN',
  },
}), { virtual: true });

const mockSurveyCreate     = jest.fn();
const mockSurveyFindUnique = jest.fn();
const mockSurveyFindFirst  = jest.fn();
const mockSurveyFindMany   = jest.fn();
const mockSurveyUpdate     = jest.fn();
const mockQuestionCreate   = jest.fn();
const mockQuestionUpdate   = jest.fn();
const mockQuestionDelete   = jest.fn();
const mockResponseCreate   = jest.fn();
const mockResponseFindFirst = jest.fn();
const mockActionCreate     = jest.fn();
const mockActionFindUnique = jest.fn();
const mockActionFindMany   = jest.fn();
const mockActionUpdate     = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    survey: {
      create: mockSurveyCreate, findUnique: mockSurveyFindUnique,
      findFirst: mockSurveyFindFirst, findMany: mockSurveyFindMany,
      update: mockSurveyUpdate,
    },
    surveyQuestion: {
      create: mockQuestionCreate, update: mockQuestionUpdate, delete: mockQuestionDelete,
    },
    surveyResponse: {
      create: mockResponseCreate, findFirst: mockResponseFindFirst,
    },
    surveyAction: {
      create: mockActionCreate, findUnique: mockActionFindUnique,
      findMany: mockActionFindMany, update: mockActionUpdate,
    },
  })),
}));

jest.mock('dotenv', () => ({ config: () => {} }));

const request = require('supertest');
const app     = require('../src/index');

function makeSurvey(o = {}) {
  return {
    id: 's1', code: 'ANNUAL-2026', title: '2026 Engagement',
    description: 'Annual', type: 'ANNUAL', status: 'DRAFT',
    anonymous: true, minResponsesToShow: 3,
    targetDepartment: null, targetMinTenureMonths: null,
    openedAt: null, closedAt: null, dueDate: null,
    createdBy: 'hr-1', createdByName: 'HR',
    createdAt: new Date(), updatedAt: new Date(),
    questions: [],
    responses: [],
    _count: { responses: 0, questions: 0 },
    ...o,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setUser({ sub: 'emp-001', employeeId: 'emp-001', role: 'EMPLOYEE', name: 'Alice Tan', department: 'Engineering' });
});

// ──────────────────────────────────────────────────────────────────────────────
// Survey CRUD
// ──────────────────────────────────────────────────────────────────────────────
test('SV-01 HR creates → 201', async () => {
  setUser({ role: 'HR_ADMIN', sub: 'hr-1' });
  mockSurveyCreate.mockResolvedValueOnce(makeSurvey());
  const res = await request(app).post('/surveys').send({
    code: 'annual-2026', title: '2026 Engagement', type: 'ANNUAL',
  });
  expect(res.status).toBe(201);
  expect(mockSurveyCreate.mock.calls[0][0].data.code).toBe('ANNUAL-2026');
});

test('SV-02 400 missing fields', async () => {
  setUser({ role: 'HR_ADMIN' });
  const res = await request(app).post('/surveys').send({ title: 'X' });
  expect(res.status).toBe(400);
});

test('SV-03 409 duplicate code', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockSurveyCreate.mockRejectedValueOnce({ code: 'P2002' });
  const res = await request(app).post('/surveys').send({
    code: 'ANNUAL-2026', title: 'X', type: 'ANNUAL',
  });
  expect(res.status).toBe(409);
});

test('SV-04 employee sees ACTIVE only', async () => {
  mockSurveyFindMany.mockResolvedValueOnce([makeSurvey({ status: 'ACTIVE' })]);
  const res = await request(app).get('/surveys');
  expect(res.status).toBe(200);
  expect(mockSurveyFindMany.mock.calls[0][0].where.status).toBe('ACTIVE');
});

test('SV-05 HR sees all', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockSurveyFindMany.mockResolvedValueOnce([makeSurvey(), makeSurvey({ id: 's2', status: 'CLOSED' })]);
  const res = await request(app).get('/surveys');
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(2);
});

test('SV-06 publish DRAFT → ACTIVE', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey({
    status: 'DRAFT', questions: [{ id: 'q1', type: 'LIKERT_5', text: 'x' }],
  }));
  mockSurveyUpdate.mockResolvedValueOnce(makeSurvey({ status: 'ACTIVE', openedAt: new Date() }));
  const res = await request(app).post('/surveys/s1/publish').send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ACTIVE');
});

test('SV-07 publish 409 no questions', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey({ status: 'DRAFT', questions: [] }));
  const res = await request(app).post('/surveys/s1/publish').send({});
  expect(res.status).toBe(409);
});

test('SV-08 close ACTIVE → CLOSED', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey({ status: 'ACTIVE' }));
  mockSurveyUpdate.mockResolvedValueOnce(makeSurvey({ status: 'CLOSED', closedAt: new Date() }));
  const res = await request(app).post('/surveys/s1/close').send({});
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('CLOSED');
});

// ──────────────────────────────────────────────────────────────────────────────
// Questions
// ──────────────────────────────────────────────────────────────────────────────
test('QU-01 adds LIKERT_5', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey());
  mockQuestionCreate.mockResolvedValueOnce({
    id: 'q1', surveyId: 's1', type: 'LIKERT_5', text: 'I am engaged at work', required: true,
  });
  const res = await request(app).post('/surveys/s1/questions').send({
    type: 'LIKERT_5', text: 'I am engaged at work',
  });
  expect(res.status).toBe(201);
});

test('QU-02 400 MULTI_CHOICE w/o choices', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey());
  const res = await request(app).post('/surveys/s1/questions').send({
    type: 'MULTI_CHOICE', text: 'Pick one', choices: ['A'],
  });
  expect(res.status).toBe(400);
});

// ──────────────────────────────────────────────────────────────────────────────
// Responses
// ──────────────────────────────────────────────────────────────────────────────
test('RS-01 valid submission → 201', async () => {
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey({
    status: 'ACTIVE', anonymous: true,
    questions: [
      { id: 'q1', type: 'LIKERT_5', text: 'engaged?', required: true },
      { id: 'q2', type: 'NPS', text: 'recommend?', required: true },
    ],
  }));
  mockResponseCreate.mockResolvedValueOnce({
    id: 'resp1', surveyId: 's1', submittedAt: new Date(), answers: [],
  });
  const res = await request(app).post('/surveys/s1/responses').send({
    answers: [
      { questionId: 'q1', numericValue: 5 },
      { questionId: 'q2', numericValue: 9 },
    ],
  });
  expect(res.status).toBe(201);
});

test('RS-02 400 invalid Likert', async () => {
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey({
    status: 'ACTIVE',
    questions: [{ id: 'q1', type: 'LIKERT_5', text: 'x', required: true }],
  }));
  const res = await request(app).post('/surveys/s1/responses').send({
    answers: [{ questionId: 'q1', numericValue: 9 }],
  });
  expect(res.status).toBe(400);
});

test('RS-03 409 when not ACTIVE', async () => {
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey({ status: 'CLOSED' }));
  const res = await request(app).post('/surveys/s1/responses').send({ answers: [] });
  expect(res.status).toBe(409);
});

test('RS-04 non-anonymous duplicate blocked', async () => {
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey({
    status: 'ACTIVE', anonymous: false,
    questions: [{ id: 'q1', type: 'LIKERT_5', text: 'x', required: true }],
  }));
  mockResponseFindFirst.mockResolvedValueOnce({ id: 'prev', surveyId: 's1' });
  const res = await request(app).post('/surveys/s1/responses').send({
    answers: [{ questionId: 'q1', numericValue: 4 }],
  });
  expect(res.status).toBe(409);
});

test('RS-05 GET /responses/me returns submitted', async () => {
  mockResponseFindFirst.mockResolvedValueOnce({ id: 'r1', submittedAt: new Date() });
  const res = await request(app).get('/surveys/s1/responses/me');
  expect(res.status).toBe(200);
  expect(res.body.submitted).toBe(true);
});

// ──────────────────────────────────────────────────────────────────────────────
// Dashboard
// ──────────────────────────────────────────────────────────────────────────────
test('DB-01 HR sees aggregates', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey({
    minResponsesToShow: 1,
    questions: [
      { id: 'q1', type: 'LIKERT_5', text: 'engaged?', required: true, displayOrder: 0 },
    ],
    responses: [
      { id: 'r1', respondentDepartment: 'Eng', answers: [{ questionId: 'q1', numericValue: 5 }] },
      { id: 'r2', respondentDepartment: 'Eng', answers: [{ questionId: 'q1', numericValue: 4 }] },
    ],
  }));
  const res = await request(app).get('/surveys/s1/dashboard');
  expect(res.status).toBe(200);
  expect(res.body.totalResponses).toBe(2);
  expect(res.body.perQuestion[0].stats.average).toBe(4.5);
});

test('DB-02 employee 403', async () => {
  const res = await request(app).get('/surveys/s1/dashboard');
  expect(res.status).toBe(403);
});

// ──────────────────────────────────────────────────────────────────────────────
// Actions
// ──────────────────────────────────────────────────────────────────────────────
test('AC-01 manager creates action', async () => {
  setUser({ role: 'LINE_MANAGER' });
  mockSurveyFindUnique.mockResolvedValueOnce(makeSurvey());
  mockActionCreate.mockResolvedValueOnce({
    id: 'a1', surveyId: 's1', title: 'Team townhall', status: 'OPEN', managerId: 'emp-001',
  });
  const res = await request(app).post('/surveys/s1/actions').send({
    title: 'Team townhall', description: 'Address culture concerns',
  });
  expect(res.status).toBe(201);
});

test('AC-02 status DONE sets closedAt', async () => {
  setUser({ role: 'LINE_MANAGER' });
  mockActionFindUnique.mockResolvedValueOnce({ id: 'a1', managerId: 'emp-001', status: 'OPEN' });
  mockActionUpdate.mockResolvedValueOnce({ id: 'a1', status: 'DONE', closedAt: new Date() });
  const res = await request(app).put('/surveys/s1/actions/a1').send({ status: 'DONE' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('DONE');
});

// ──────────────────────────────────────────────────────────────────────────────
// Exit trigger
// ──────────────────────────────────────────────────────────────────────────────
test('EX-01 returns active EXIT survey', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockSurveyFindFirst.mockResolvedValueOnce(makeSurvey({ type: 'EXIT', status: 'ACTIVE', title: 'Exit 2026' }));
  const res = await request(app).post('/surveys/exit-trigger').send({
    employeeId: 'emp-001', employeeName: 'Alice',
  });
  expect(res.status).toBe(200);
  expect(res.body.surveyTitle).toBe('Exit 2026');
});

test('EX-02 404 when no exit survey', async () => {
  setUser({ role: 'HR_ADMIN' });
  mockSurveyFindFirst.mockResolvedValueOnce(null);
  const res = await request(app).post('/surveys/exit-trigger').send({ employeeId: 'emp-001' });
  expect(res.status).toBe(404);
});
