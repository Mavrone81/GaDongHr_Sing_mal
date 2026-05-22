/**
 * T1 Training course player happy path + RBAC probes.
 *
 * Covers the course-player flow shipped with TrainingMaterialProgress:
 *   1. Admin creates a program with DOCUMENT, VIDEO, and QUIZ materials
 *   2. Admin publishes and enrolls a real employee
 *   3. Employee completes materials one by one — progress recalculates,
 *      status transitions ENROLLED → IN_PROGRESS → COMPLETED
 *   4. Quiz scoring uses the JSON content schema (`{id, text, options, correct}`)
 *   5. Final enrollment.score is the average of quiz scores
 *
 * Plus two RBAC probes:
 *   - EMPLOYEE creating a program → 403
 *   - Foreign employee completing someone else's enrollment → 403
 *
 * API-level (no UI) because:
 *   - admin and employee live in different sessions; switching contexts
 *     mid-spec is cheaper through the gateway
 *   - the UI flow is covered by smoke (sidebar) + manual verification.
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

async function employeeCtx(employeeId: string): Promise<APIRequestContext> {
  // Forge a JWT that carries the given employeeId so the gateway propagates it
  // as the `x-employee-id` header into the training-service.
  const token = signJwt({ ...TEST_USERS.EMPLOYEE, employeeId }, 'EMPLOYEE');
  return request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

test('training: admin creates program → employee completes materials → enrollment auto-completes', async () => {
  const admin = await adminCtx();

  // 1. Find a real employee to enroll
  const empResp = await admin.get('/api/employees?limit=1&isActive=true');
  expect(empResp.ok(), 'employee list').toBe(true);
  const empBody = await empResp.json();
  const learner = (empBody.employees || empBody || [])[0];
  expect(learner, 'should have at least one employee').toBeTruthy();

  // 2. Create a program
  const createProg = await admin.post('/api/training/programs', {
    data: {
      title: `E2E Course ${Date.now()}`,
      description: 'E2E test program',
      category: 'TECHNICAL',
      passingScore: 70,
    },
  });
  expect(createProg.status(), 'create program').toBeLessThan(400);
  const program = await createProg.json();

  // 3. Add 3 materials: DOCUMENT, VIDEO, QUIZ
  const docMat = await admin.post(`/api/training/programs/${program.id}/materials`, {
    data: { title: 'Read the policy', type: 'DOCUMENT', url: 'https://example.com/policy.pdf', orderIndex: 0 },
  });
  expect(docMat.status(), 'add document material').toBeLessThan(400);
  const doc = await docMat.json();

  const videoMat = await admin.post(`/api/training/programs/${program.id}/materials`, {
    data: { title: 'Watch the intro', type: 'VIDEO', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', orderIndex: 1 },
  });
  expect(videoMat.status(), 'add video material').toBeLessThan(400);
  const video = await videoMat.json();

  // Quiz content matches the schema the route parses: array of {id,text,options,correct}
  const quizQuestions = [
    { id: 'q1', text: 'What is 2+2?', options: ['3', '4', '5'], correct: 1 },
    { id: 'q2', text: 'What is the capital of Singapore?', options: ['KL', 'Singapore', 'Bangkok'], correct: 1 },
  ];
  const quizMat = await admin.post(`/api/training/programs/${program.id}/materials`, {
    data: { title: 'Final quiz', type: 'QUIZ', content: JSON.stringify(quizQuestions), orderIndex: 2 },
  });
  expect(quizMat.status(), 'add quiz material').toBeLessThan(400);
  const quiz = await quizMat.json();

  // 4. Publish the program
  const publish = await admin.put(`/api/training/programs/${program.id}`, {
    data: { status: 'PUBLISHED' },
  });
  expect(publish.ok(), 'publish program').toBe(true);

  // 5. Admin enrolls the employee
  const enroll = await admin.post(`/api/training/programs/${program.id}/enroll`, {
    data: { employeeIds: [learner.id] },
  });
  expect(enroll.status(), 'enroll employee').toBeLessThan(400);
  const enrollBody = await enroll.json();
  expect(enrollBody.enrolled, 'one enrollment created').toBe(1);

  // 6. Employee fetches /my-programs to find the enrollment id
  const learnerCtx = await employeeCtx(learner.id);
  const mine = await learnerCtx.get('/api/training/my-programs');
  expect(mine.ok(), 'fetch my-programs').toBe(true);
  const myList: any[] = await mine.json();
  const enrollment = myList.find(e => e.programId === program.id);
  expect(enrollment, 'employee should see their enrollment').toBeTruthy();
  expect(enrollment.status, 'starts as ENROLLED').toBe('ENROLLED');
  expect(enrollment.progress, 'starts at 0%').toBe(0);

  // 7. Complete DOCUMENT — progress should be 33%, status IN_PROGRESS
  const step1 = await learnerCtx.post(
    `/api/training/enrollments/${enrollment.id}/materials/${doc.id}/complete`,
    { data: {} }
  );
  expect(step1.ok(), 'complete document').toBe(true);
  const s1 = await step1.json();
  expect(s1.progress, '1 of 3 done = 33%').toBe(33);
  expect(s1.enrollment.status, 'should advance to IN_PROGRESS').toBe('IN_PROGRESS');
  expect(s1.enrollment.startedAt, 'startedAt should be set').toBeTruthy();

  // 8. Complete VIDEO — progress 67%
  const step2 = await learnerCtx.post(
    `/api/training/enrollments/${enrollment.id}/materials/${video.id}/complete`,
    { data: {} }
  );
  expect(step2.ok(), 'complete video').toBe(true);
  const s2 = await step2.json();
  expect(s2.progress, '2 of 3 done = 67%').toBe(67);
  expect(s2.enrollment.status, 'still IN_PROGRESS').toBe('IN_PROGRESS');

  // 9. Submit QUIZ with both correct answers (100%) — enrollment should complete
  const step3 = await learnerCtx.post(
    `/api/training/enrollments/${enrollment.id}/materials/${quiz.id}/complete`,
    { data: { quizAnswers: { q1: 1, q2: 1 } } }
  );
  expect(step3.ok(), 'complete quiz').toBe(true);
  const s3 = await step3.json();
  expect(s3.progress, '3 of 3 = 100%').toBe(100);
  expect(s3.materialScore, 'quiz scored 100').toBe(100);
  expect(s3.enrollment.status, 'should COMPLETE on 100% above passingScore').toBe('COMPLETED');
  expect(s3.enrollment.score, 'final score = quiz avg').toBe(100);
  expect(s3.enrollment.completedAt, 'completedAt should be set').toBeTruthy();

  // 10. Cleanup — archive the program (DELETE soft-archives it)
  await admin.delete(`/api/training/programs/${program.id}`);

  await learnerCtx.dispose();
  await admin.dispose();
});

test('training: QUIZ below passing score keeps enrollment IN_PROGRESS, not COMPLETED', async () => {
  const admin = await adminCtx();

  // Create a tiny single-quiz program, enroll a real employee
  const emp = ((await (await admin.get('/api/employees?limit=1&isActive=true')).json()).employees || [])[0];

  const program = await (await admin.post('/api/training/programs', {
    data: { title: `E2E Quiz Fail ${Date.now()}`, category: 'COMPLIANCE', passingScore: 70 },
  })).json();

  const quizContent = JSON.stringify([
    { id: 'q1', text: '?', options: ['a', 'b'], correct: 0 },
    { id: 'q2', text: '?', options: ['a', 'b'], correct: 0 },
  ]);
  const quiz = await (await admin.post(`/api/training/programs/${program.id}/materials`, {
    data: { title: 'One quiz', type: 'QUIZ', content: quizContent, orderIndex: 0 },
  })).json();

  await admin.put(`/api/training/programs/${program.id}`, { data: { status: 'PUBLISHED' } });
  await admin.post(`/api/training/programs/${program.id}/enroll`, { data: { employeeIds: [emp.id] } });

  const learnerCtx = await employeeCtx(emp.id);
  const myList: any[] = await (await learnerCtx.get('/api/training/my-programs')).json();
  const enrollment = myList.find(e => e.programId === program.id);

  // Submit one correct, one wrong → 50% < passingScore 70
  const res = await learnerCtx.post(
    `/api/training/enrollments/${enrollment.id}/materials/${quiz.id}/complete`,
    { data: { quizAnswers: { q1: 0, q2: 1 } } }
  );
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.materialScore, 'quiz scored 50').toBe(50);
  expect(body.progress, 'progress is 100 (all materials done)').toBe(100);
  expect(body.enrollment.status, 'must NOT auto-complete below passing score').toBe('IN_PROGRESS');
  expect(body.enrollment.score, 'score recorded even on fail').toBe(50);
  expect(body.enrollment.completedAt, 'completedAt should remain null').toBeFalsy();

  await admin.delete(`/api/training/programs/${program.id}`);
  await learnerCtx.dispose();
  await admin.dispose();
});

test('training: EMPLOYEE cannot create a program (RBAC 403)', async () => {
  const empToken = signJwt(TEST_USERS.EMPLOYEE, 'EMPLOYEE');
  const ctx = await request.newContext({
    baseURL: API_BASE,
    extraHTTPHeaders: { Authorization: `Bearer ${empToken}` },
  });
  const res = await ctx.post('/api/training/programs', {
    data: { title: 'Should be denied', category: 'TECHNICAL' },
  });
  expect(res.status(), 'employee should be denied').toBe(403);
  await ctx.dispose();
});

test('training: employee cannot complete another employee’s enrollment (403)', async () => {
  // Admin sets up a program + enrolls employee A
  const admin = await adminCtx();
  const emps: any[] = ((await (await admin.get('/api/employees?limit=2&isActive=true')).json()).employees || []);
  expect(emps.length, 'need at least one employee for the enrollment').toBeGreaterThanOrEqual(1);
  const empA = emps[0];

  const program = await (await admin.post('/api/training/programs', {
    data: { title: `E2E Cross-Emp ${Date.now()}`, category: 'TECHNICAL' },
  })).json();
  const mat = await (await admin.post(`/api/training/programs/${program.id}/materials`, {
    data: { title: 'm', type: 'DOCUMENT', url: 'https://example.com', orderIndex: 0 },
  })).json();
  await admin.put(`/api/training/programs/${program.id}`, { data: { status: 'PUBLISHED' } });
  await admin.post(`/api/training/programs/${program.id}/enroll`, { data: { employeeIds: [empA.id] } });

  const aCtx = await employeeCtx(empA.id);
  const myList: any[] = await (await aCtx.get('/api/training/my-programs')).json();
  const enrollment = myList.find(e => e.programId === program.id);
  await aCtx.dispose();

  // Foreign employee tries to complete A's enrollment
  const foreignCtx = await employeeCtx('not-the-owner-' + Date.now());
  const res = await foreignCtx.post(
    `/api/training/enrollments/${enrollment.id}/materials/${mat.id}/complete`,
    { data: {} }
  );
  expect(res.status(), 'foreign employee should be denied').toBe(403);
  await foreignCtx.dispose();

  await admin.delete(`/api/training/programs/${program.id}`);
  await admin.dispose();
});
