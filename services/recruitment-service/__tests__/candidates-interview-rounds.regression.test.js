'use strict';
/**
 * Regression test — GET /recruitment/candidates includes interviewRounds
 *
 * Bug: the candidates list endpoint omitted the interviewRounds relation,
 * causing the Interviews tab to always show empty even when rounds existed.
 *
 * Fix: added `interviewRounds: { orderBy: { scheduledAt: 'asc' } }` to the
 * Prisma include in GET /recruitment/candidates.
 *
 * This test pins that the field is present and correctly ordered so the
 * bug cannot regress silently.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
// /app/shared/auth-middleware is resolved via moduleNameMapper → __mocks__/auth-middleware.js

const mockCandidateFindMany = jest.fn();
const mockCandidateCount    = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    candidate:      { findMany: mockCandidateFindMany, count: mockCandidateCount, create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    jobPosting:     { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    interviewRound: { create: jest.fn(), update: jest.fn() },
    candidateStageEvent: { create: jest.fn() },
    onboardingTask: { createMany: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    workPass:       { findMany: jest.fn() },
  })),
}));

// multer must be mocked before the routes module loads so it doesn't try to
// create the uploads directory on disk during tests.
jest.mock('multer', () => {
  const m = jest.fn(() => ({ single: () => (_req, _res, next) => next() }));
  m.diskStorage = jest.fn(() => ({}));
  return m;
});

const request = require('supertest');
const { app }  = require('../src/index');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROUND_EARLY = {
  id: 'round-1', candidateId: 'cand-1', roundName: 'Technical Screen',
  scheduledAt: '2026-06-01T09:00:00.000Z', interviewerIds: [], notes: null, result: null,
  createdAt: '2026-05-20T08:00:00.000Z',
};
const ROUND_LATE = {
  id: 'round-2', candidateId: 'cand-1', roundName: 'Final Round',
  scheduledAt: '2026-06-10T14:00:00.000Z', interviewerIds: [], notes: 'CEO panel', result: 'PASS',
  createdAt: '2026-05-21T08:00:00.000Z',
};
const CANDIDATE_WITH_ROUNDS = {
  id: 'cand-1', jobId: 'job-1', firstName: 'Zackery', lastName: 'Tan',
  email: 'zackery@example.com', stage: 'INTERVIEW_1',
  isOfferMade: false, isHired: false,
  createdAt: '2026-05-15T00:00:00.000Z',
  job: { title: 'Senior Engineer', department: 'Engineering' },
  interviewRounds: [ROUND_EARLY, ROUND_LATE],
};
const CANDIDATE_NO_ROUNDS = {
  id: 'cand-2', jobId: null, firstName: 'Harish', lastName: 'Kumar',
  email: 'harish@example.com', stage: 'APPLIED',
  isOfferMade: false, isHired: false,
  createdAt: '2026-05-16T00:00:00.000Z',
  job: null,
  interviewRounds: [],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => { jest.clearAllMocks(); });

describe('GET /recruitment/candidates — interviewRounds regression', () => {
  test('response includes interviewRounds array for every candidate', async () => {
    mockCandidateFindMany.mockResolvedValue([CANDIDATE_WITH_ROUNDS, CANDIDATE_NO_ROUNDS]);
    mockCandidateCount.mockResolvedValue(2);

    const res = await request(app).get('/recruitment/candidates');

    expect(res.status).toBe(200);
    const { candidates } = res.body;
    expect(candidates).toHaveLength(2);

    // Every candidate must expose the interviewRounds field
    for (const c of candidates) {
      expect(c).toHaveProperty('interviewRounds');
      expect(Array.isArray(c.interviewRounds)).toBe(true);
    }
  });

  test('interviewRounds are present and contain correct fields', async () => {
    mockCandidateFindMany.mockResolvedValue([CANDIDATE_WITH_ROUNDS]);
    mockCandidateCount.mockResolvedValue(1);

    const res = await request(app).get('/recruitment/candidates');

    expect(res.status).toBe(200);
    const rounds = res.body.candidates[0].interviewRounds;
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toMatchObject({ id: 'round-1', roundName: 'Technical Screen' });
    expect(rounds[1]).toMatchObject({ id: 'round-2', roundName: 'Final Round', result: 'PASS' });
  });

  test('candidate with no scheduled rounds returns empty interviewRounds array', async () => {
    mockCandidateFindMany.mockResolvedValue([CANDIDATE_NO_ROUNDS]);
    mockCandidateCount.mockResolvedValue(1);

    const res = await request(app).get('/recruitment/candidates');

    expect(res.status).toBe(200);
    expect(res.body.candidates[0].interviewRounds).toEqual([]);
  });

  test('Prisma query includes interviewRounds relation with scheduledAt ordering', async () => {
    mockCandidateFindMany.mockResolvedValue([]);
    mockCandidateCount.mockResolvedValue(0);

    await request(app).get('/recruitment/candidates');

    const callArg = mockCandidateFindMany.mock.calls[0][0];
    expect(callArg.include).toHaveProperty('interviewRounds');
    expect(callArg.include.interviewRounds).toEqual({ orderBy: { scheduledAt: 'asc' } });
  });

  test('jobId and stage query filters are forwarded to Prisma where clause', async () => {
    mockCandidateFindMany.mockResolvedValue([]);
    mockCandidateCount.mockResolvedValue(0);

    await request(app).get('/recruitment/candidates?jobId=job-1&stage=interview_1');

    const where = mockCandidateFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ jobId: 'job-1', stage: 'INTERVIEW_1' });
  });

  test('pagination params are forwarded correctly', async () => {
    mockCandidateFindMany.mockResolvedValue([]);
    mockCandidateCount.mockResolvedValue(0);

    await request(app).get('/recruitment/candidates?page=2&limit=10');

    const callArg = mockCandidateFindMany.mock.calls[0][0];
    expect(callArg.skip).toBe(10);
    expect(callArg.take).toBe(10);
  });

  test('response envelope contains total, page, pages', async () => {
    mockCandidateFindMany.mockResolvedValue([CANDIDATE_WITH_ROUNDS]);
    mockCandidateCount.mockResolvedValue(42);

    const res = await request(app).get('/recruitment/candidates?limit=10');

    expect(res.body).toMatchObject({ total: 42, page: 1, pages: 5 });
  });
});
