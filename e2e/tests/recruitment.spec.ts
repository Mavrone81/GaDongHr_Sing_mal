/**
 * T3 REC-01..07 — Recruitment + ATS pipeline E2E.
 *
 * Walks the ATS happy path against real API surfaces:
 *   REC-01  Create a job posting (DRAFT) → 201
 *   REC-02  Record MCF FCF compliance → 14-day window starts; job goes OPEN
 *   REC-03  Add a candidate, linked to job, stage=APPLIED + initial stage event
 *   REC-04  Stage transition APPLIED → SCREENED → INTERVIEWED → OFFERED → HIRED
 *           (using PUT /:id/stage, not the approve flow — keeps test fast)
 *   REC-05  GET /candidates filter by jobId returns the just-added candidate
 *   REC-06  FCF-status endpoint returns NOT_POSTED before MCF, IN_PERIOD after
 *   REC-07  RBAC: EMPLOYEE role cannot list candidates (403)
 *
 * Each test creates its own job/candidate fixtures so reruns are clean.
 */

import { test, expect, request, APIRequestContext } from '@playwright/test';
import { TEST_USERS } from '../lib/testUsers';
import { signJwt } from '../lib/jwt';

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:4000';

async function adminCtx(): Promise<APIRequestContext> {
  const token = signJwt(TEST_USERS.SUPER_ADMIN, 'SUPER_ADMIN');
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

async function employeeCtx(): Promise<APIRequestContext> {
  const token = signJwt(TEST_USERS.EMPLOYEE, 'EMPLOYEE');
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

async function newJob(ctx: APIRequestContext, extras: Record<string, unknown> = {}) {
  const res = await ctx.post('/api/recruitment/jobs', {
    data: {
      title: `T3 Test Job ${stamp()}`,
      department: 'Engineering',
      jobDescription: 'Pinned by e2e tests',
      headcount: 1,
      jobType: 'FULL_TIME',
      location: 'Singapore',
      ...extras,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

async function newCandidate(ctx: APIRequestContext, jobId: string | null = null) {
  const res = await ctx.post('/api/recruitment/candidates', {
    data: {
      jobId,
      firstName: 'Test',
      lastName: `Candidate-${stamp()}`,
      email: `candidate-${stamp()}@example.com`,
      currentTitle: 'QA Specialist',
      noticePeriod: 30,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

// ── REC-01 ─────────────────────────────────────────────────────────────────

test('REC-01 create job posting → DRAFT', async () => {
  const ctx = await adminCtx();
  const job = await newJob(ctx);
  expect(job.id).toBeTruthy();
  expect(job.status).toBe('DRAFT');
  expect(job.title).toMatch(/T3 Test Job/);
  await ctx.dispose();
});

test('REC-01 POST /jobs missing required field → 400', async () => {
  const ctx = await adminCtx();
  const res = await ctx.post('/api/recruitment/jobs', { data: { title: 'incomplete' } });
  expect(res.status()).toBe(400);
  await ctx.dispose();
});

// ── REC-02 ─────────────────────────────────────────────────────────────────

test('REC-02 record MCF compliance → status flips to OPEN, expiry stamped', async () => {
  const ctx = await adminCtx();
  const job = await newJob(ctx);
  const mcfPostedAt = '2026-05-01T00:00:00Z';
  const res = await ctx.post(`/api/recruitment/jobs/${job.id}/fcf-compliance`, {
    data: { mcfJobId: `MCF-${stamp()}`, mcfPostedAt, fcfNotes: 'pinned by e2e' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.job.status).toBe('OPEN');
  expect(body.job.mcfExpiredAt).toBeTruthy();
  // Expiry must be 14 days after the posted date.
  const expiry = new Date(body.job.mcfExpiredAt);
  const expected = new Date(mcfPostedAt);
  expected.setDate(expected.getDate() + 14);
  expect(expiry.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
  await ctx.dispose();
});

// ── REC-03 ─────────────────────────────────────────────────────────────────

test('REC-03 add candidate → stage APPLIED + stage event recorded', async () => {
  const ctx = await adminCtx();
  const job = await newJob(ctx);
  await ctx.post(`/api/recruitment/jobs/${job.id}/fcf-compliance`, {
    data: { mcfJobId: `MCF-${stamp()}`, mcfPostedAt: '2025-01-01T00:00:00Z' }, // expired
  });
  const cand = await newCandidate(ctx, job.id);
  expect(cand.stage).toBe('APPLIED');
  expect(cand.firstName).toBe('Test');

  // Stage event timeline includes the initial entry.
  const detail = await ctx.get(`/api/recruitment/candidates/${cand.id}`);
  expect(detail.status()).toBe(200);
  const detailBody = await detail.json();
  expect(detailBody.stageEvents?.length).toBeGreaterThanOrEqual(1);
  expect(detailBody.stageEvents[0].toStage).toBe('APPLIED');
  await ctx.dispose();
});

test('REC-03 candidate rejected for in-FCF-window job', async () => {
  const ctx = await adminCtx();
  const job = await newJob(ctx);
  // Today-stamped MCF posting → still within the 14-day window
  await ctx.post(`/api/recruitment/jobs/${job.id}/fcf-compliance`, {
    data: { mcfJobId: `MCF-${stamp()}`, mcfPostedAt: new Date().toISOString() },
  });
  const res = await ctx.post('/api/recruitment/candidates', {
    data: {
      jobId: job.id,
      firstName: 'Premature',
      lastName: `Shortlist-${stamp()}`,
      email: `prem-${stamp()}@example.com`,
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.error).toMatch(/FCF|14-day/i);
  await ctx.dispose();
});

// ── REC-04 ─────────────────────────────────────────────────────────────────

test('REC-04 stage walk APPLIED → SCREENING → INTERVIEW_1 → OFFER → HIRED', async () => {
  const ctx = await adminCtx();
  const job = await newJob(ctx);
  // Old MCF date so FCF gate doesn't block candidate creation
  await ctx.post(`/api/recruitment/jobs/${job.id}/fcf-compliance`, {
    data: { mcfJobId: `MCF-${stamp()}`, mcfPostedAt: '2025-01-01T00:00:00Z' },
  });
  const cand = await newCandidate(ctx, job.id);

  // Stages per PipelineStage enum in recruitment-service prisma schema.
  for (const stage of ['SCREENING', 'INTERVIEW_1', 'OFFER', 'HIRED']) {
    const res = await ctx.put(`/api/recruitment/candidates/${cand.id}/stage`, {
      data: { stage, note: `Moved to ${stage}` },
    });
    expect(res.status(), `transition to ${stage}: ${await res.text()}`).toBe(200);
    const body = await res.json();
    expect(body.stage).toBe(stage);
  }

  // Verify stageEvents reflect the full chain (initial APPLIED + 4 transitions).
  const detail = await ctx.get(`/api/recruitment/candidates/${cand.id}`);
  const detailBody = await detail.json();
  const stages = (detailBody.stageEvents || []).map((e: any) => e.toStage);
  expect(stages).toEqual(expect.arrayContaining(['APPLIED', 'SCREENING', 'INTERVIEW_1', 'OFFER', 'HIRED']));
  await ctx.dispose();
});

// ── REC-05 ─────────────────────────────────────────────────────────────────

test('REC-05 GET /candidates?jobId=... filters to the right pool', async () => {
  const ctx = await adminCtx();
  const job = await newJob(ctx);
  await ctx.post(`/api/recruitment/jobs/${job.id}/fcf-compliance`, {
    data: { mcfJobId: `MCF-${stamp()}`, mcfPostedAt: '2025-01-01T00:00:00Z' },
  });
  const c1 = await newCandidate(ctx, job.id);
  const c2 = await newCandidate(ctx, job.id);

  const list = await ctx.get(`/api/recruitment/candidates?jobId=${job.id}&limit=200`);
  expect(list.status()).toBe(200);
  const body = await list.json();
  const ids = body.candidates.map((c: any) => c.id);
  expect(ids).toContain(c1.id);
  expect(ids).toContain(c2.id);
  // None of the candidates from this filtered list should belong to a different job
  expect(body.candidates.every((c: any) => c.jobId === job.id)).toBe(true);
  await ctx.dispose();
});

// ── REC-06 ─────────────────────────────────────────────────────────────────

test('REC-06 fcf-status: NOT_POSTED before MCF; IN_PERIOD inside window', async () => {
  const ctx = await adminCtx();
  const job = await newJob(ctx);

  // Pre-MCF: NOT_POSTED
  const pre = await ctx.get(`/api/recruitment/jobs/${job.id}/fcf-status`);
  expect(pre.status()).toBe(200);
  const preBody = await pre.json();
  expect(preBody.status).toBe('NOT_POSTED');
  expect(preBody.blocksHire).toBe(true);

  // Post today → IN_PERIOD (still inside the 14-day window)
  await ctx.post(`/api/recruitment/jobs/${job.id}/fcf-compliance`, {
    data: { mcfJobId: `MCF-${stamp()}`, mcfPostedAt: new Date().toISOString() },
  });
  const post = await ctx.get(`/api/recruitment/jobs/${job.id}/fcf-status`);
  expect(post.status()).toBe(200);
  const postBody = await post.json();
  expect(postBody.status).toBe('IN_PERIOD');
  expect(postBody.blocksHire).toBe(true);
  expect(postBody.daysRemaining).toBeGreaterThan(0);
  expect(postBody.daysRemaining).toBeLessThanOrEqual(14);

  await ctx.dispose();
});

// ── REC-07 ─────────────────────────────────────────────────────────────────

test('REC-07 RBAC: EMPLOYEE cannot list candidates (403)', async () => {
  const ctx = await employeeCtx();
  const res = await ctx.get('/api/recruitment/candidates?limit=5');
  expect(res.status()).toBe(403);
  await ctx.dispose();
});
