'use strict';

jest.mock('/app/shared/auth-middleware', () => ({
  // H-17: training-service now reads employeeId / sub from the verified JWT
  // (req.user) instead of x-employee-id / x-user-id headers. The test
  // suite still uses .set('x-user-role', ...) and similar to drive role
  // selection; mirror those header values into req.user so the existing
  // suite keeps working without rewriting every test.
  authenticate: (req, _res, next) => {
    req.user = {
      sub:        req.headers['x-user-id']     || 'test-user-1',
      // Only set employeeId when the test explicitly provides x-employee-id —
      // this preserves the "missing employee context" 400-error test cases.
      employeeId: req.headers['x-employee-id'] || null,
      role:       req.headers['x-user-role']   || 'EMPLOYEE',
      name:       'Test',
    };
    next();
  },
  authorize: (...roles) => (req, res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    LINE_MANAGER: 'LINE_MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const mockDb = {
  trainingProgram: {
    count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    create: jest.fn(), update: jest.fn(), groupBy: jest.fn(),
  },
  trainingMaterial: {
    findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  },
  trainingEnrollment: {
    count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(),
    create: jest.fn(), update: jest.fn(), upsert: jest.fn(),
  },
  employeeCertification: {
    findMany: jest.fn(), findUnique: jest.fn(),
    create: jest.fn(), update: jest.fn(),
  },
  certReminder: {
    findMany: jest.fn(), create: jest.fn(),
  },
  competency: {
    findMany: jest.fn(), findUnique: jest.fn(),
    create: jest.fn(), update: jest.fn(),
  },
  programCompetency: {
    upsert: jest.fn(), delete: jest.fn(),
  },
  jobFamilyCompetency: {
    findMany: jest.fn(), upsert: jest.fn(), delete: jest.fn(),
  },
  employeeCompetency: {
    findMany: jest.fn(), upsert: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockDb),
}));

const request = require('supertest');
const { app } = require('../src/index');

const ADMIN_HEADERS = { 'x-user-role': 'HR_ADMIN', 'x-employee-id': 'admin-emp-1', 'x-user-id': 'admin-user-1', authorization: 'Bearer test' };
const EMP_HEADERS   = { 'x-user-role': 'EMPLOYEE', 'x-employee-id': 'emp-1', 'x-user-id': 'user-1', authorization: 'Bearer test' };

const mockProgram = {
  id: 'prog-1', title: 'Safety Basics', description: 'Workplace safety', category: 'SAFETY',
  status: 'PUBLISHED', durationMins: 60, passingScore: 70, isMandatory: true, createdBy: 'admin-emp-1',
  createdAt: new Date(), updatedAt: new Date(),
};

const mockMaterial = {
  id: 'mat-1', programId: 'prog-1', title: 'Safety Video', type: 'VIDEO',
  url: 'https://example.com/safety.mp4', orderIndex: 0, durationMins: 20,
  createdAt: new Date(), updatedAt: new Date(),
};

const mockEnrollment = {
  id: 'enr-1', programId: 'prog-1', employeeId: 'emp-1', status: 'ENROLLED',
  progress: 0, score: null, enrolledBy: null, dueDate: null,
  enrolledAt: new Date(), startedAt: null, completedAt: null,
};

beforeEach(() => jest.clearAllMocks());

// ── A) Stats ──────────────────────────────────────────────────────────────────
describe('A) GET /training/stats', () => {
  test('A1 returns KPI summary', async () => {
    mockDb.trainingProgram.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(3);
    mockDb.trainingEnrollment.count
      .mockResolvedValueOnce(50)
      .mockResolvedValueOnce(30)
      .mockResolvedValueOnce(10);
    mockDb.trainingProgram.groupBy.mockResolvedValue([
      { category: 'SAFETY', _count: { id: 3 } },
      { category: 'TECHNICAL', _count: { id: 4 } },
    ]);

    const res = await request(app).get('/training/stats').set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalPrograms: 10, published: 7, mandatory: 3, totalEnrollments: 50, completed: 30, completionRate: 60 });
  });
});

// ── B) Programs ───────────────────────────────────────────────────────────────
describe('B) Programs CRUD', () => {
  test('B1 GET /training/programs returns list with enrollments for employee', async () => {
    mockDb.trainingProgram.findMany.mockResolvedValue([{ ...mockProgram, _count: { materials: 2, enrollments: 5 }, enrollments: [{ id: 'enr-1', status: 'ENROLLED', progress: 0 }] }]);
    const res = await request(app).get('/training/programs').set(EMP_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('B2 GET /training/programs/browse excludes already-enrolled', async () => {
    mockDb.trainingProgram.findMany.mockResolvedValue([{ ...mockProgram, _count: { materials: 2, enrollments: 5 } }]);
    const res = await request(app).get('/training/programs/browse').set(EMP_HEADERS);
    expect(res.status).toBe(200);
    expect(mockDb.trainingProgram.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'PUBLISHED', enrollments: { none: { employeeId: 'emp-1' } } }),
    }));
  });

  test('B3 GET /training/programs/:id returns detail with materials', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue({ ...mockProgram, materials: [mockMaterial], _count: { enrollments: 5 } });
    const res = await request(app).get('/training/programs/prog-1').set(EMP_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.materials).toHaveLength(1);
  });

  test('B4 GET /training/programs/:id 404 when not found', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/training/programs/missing').set(EMP_HEADERS);
    expect(res.status).toBe(404);
  });

  test('B5 POST /training/programs creates program', async () => {
    mockDb.trainingProgram.create.mockResolvedValue({ ...mockProgram, id: 'new-prog' });
    const res = await request(app).post('/training/programs').set(ADMIN_HEADERS)
      .send({ title: 'Safety Basics', category: 'SAFETY', isMandatory: true, durationMins: 60 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('new-prog');
  });

  test('B6 POST /training/programs 400 without title', async () => {
    const res = await request(app).post('/training/programs').set(ADMIN_HEADERS).send({ category: 'SAFETY' });
    expect(res.status).toBe(400);
  });

  test('B7 PUT /training/programs/:id updates status', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue(mockProgram);
    mockDb.trainingProgram.update.mockResolvedValue({ ...mockProgram, status: 'ARCHIVED' });
    const res = await request(app).put('/training/programs/prog-1').set(ADMIN_HEADERS).send({ status: 'ARCHIVED' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ARCHIVED');
  });

  test('B8 PUT /training/programs/:id 404 when not found', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue(null);
    const res = await request(app).put('/training/programs/missing').set(ADMIN_HEADERS).send({ title: 'X' });
    expect(res.status).toBe(404);
  });

  test('B9 DELETE /training/programs/:id archives program', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue(mockProgram);
    mockDb.trainingProgram.update.mockResolvedValue({ ...mockProgram, status: 'ARCHIVED' });
    const res = await request(app).delete('/training/programs/prog-1').set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Program archived');
  });
});

// ── C) Materials ──────────────────────────────────────────────────────────────
describe('C) Materials', () => {
  test('C1 POST /training/programs/:id/materials adds material', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue(mockProgram);
    mockDb.trainingMaterial.create.mockResolvedValue({ ...mockMaterial, id: 'new-mat' });
    const res = await request(app).post('/training/programs/prog-1/materials').set(ADMIN_HEADERS)
      .send({ title: 'Safety Video', type: 'VIDEO', url: 'https://example.com/v.mp4', orderIndex: 0 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('new-mat');
  });

  test('C2 POST materials 400 without title', async () => {
    const res = await request(app).post('/training/programs/prog-1/materials').set(ADMIN_HEADERS).send({ type: 'VIDEO' });
    expect(res.status).toBe(400);
  });

  test('C3 POST materials 404 for missing program', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/training/programs/missing/materials').set(ADMIN_HEADERS)
      .send({ title: 'Doc', type: 'DOCUMENT' });
    expect(res.status).toBe(404);
  });

  test('C4 PUT /training/materials/:id updates material', async () => {
    mockDb.trainingMaterial.findUnique.mockResolvedValue(mockMaterial);
    mockDb.trainingMaterial.update.mockResolvedValue({ ...mockMaterial, title: 'Updated Video' });
    const res = await request(app).put('/training/materials/mat-1').set(ADMIN_HEADERS).send({ title: 'Updated Video' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Video');
  });

  test('C5 DELETE /training/materials/:id deletes material', async () => {
    mockDb.trainingMaterial.findUnique.mockResolvedValue(mockMaterial);
    mockDb.trainingMaterial.delete.mockResolvedValue({});
    const res = await request(app).delete('/training/materials/mat-1').set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Material deleted');
  });
});

// ── D) Enrollments (admin) ────────────────────────────────────────────────────
describe('D) Admin Enrollments', () => {
  test('D1 GET /training/enrollments returns all enrollments', async () => {
    mockDb.trainingEnrollment.findMany.mockResolvedValue([{ ...mockEnrollment, program: { id: 'prog-1', title: 'Safety Basics', category: 'SAFETY' } }]);
    const res = await request(app).get('/training/enrollments').set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('D2 POST /training/programs/:id/enroll enrolls multiple employees', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue(mockProgram);
    mockDb.trainingEnrollment.upsert
      .mockResolvedValueOnce({ ...mockEnrollment, id: 'enr-A', employeeId: 'emp-A' })
      .mockResolvedValueOnce({ ...mockEnrollment, id: 'enr-B', employeeId: 'emp-B' });
    const res = await request(app).post('/training/programs/prog-1/enroll').set(ADMIN_HEADERS)
      .send({ employeeIds: ['emp-A', 'emp-B'], dueDate: '2026-06-30' });
    expect(res.status).toBe(201);
    expect(res.body.enrolled).toBe(2);
  });

  test('D3 POST enroll 400 without employeeIds', async () => {
    const res = await request(app).post('/training/programs/prog-1/enroll').set(ADMIN_HEADERS).send({});
    expect(res.status).toBe(400);
  });

  test('D4 POST enroll 404 for missing program', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue(null);
    const res = await request(app).post('/training/programs/missing/enroll').set(ADMIN_HEADERS)
      .send({ employeeIds: ['emp-1'] });
    expect(res.status).toBe(404);
  });
});

// ── E) Employee self-service ──────────────────────────────────────────────────
describe('E) Employee self-service', () => {
  test('E1 GET /training/my-programs returns own enrollments', async () => {
    mockDb.trainingEnrollment.findMany.mockResolvedValue([{
      ...mockEnrollment, program: { ...mockProgram, materials: [mockMaterial], _count: { materials: 1 } },
    }]);
    const res = await request(app).get('/training/my-programs').set(EMP_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body[0].program.title).toBe('Safety Basics');
  });

  test('E2 GET /training/my-programs 400 without employee context', async () => {
    const res = await request(app).get('/training/my-programs')
      .set({ 'x-user-role': 'EMPLOYEE', authorization: 'Bearer test' });
    expect(res.status).toBe(400);
  });

  test('E3 POST self-enroll creates enrollment', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue(mockProgram);
    mockDb.trainingEnrollment.findUnique.mockResolvedValue(null);
    mockDb.trainingEnrollment.upsert.mockResolvedValue({ ...mockEnrollment, id: 'new-enr' });
    const res = await request(app).post('/training/programs/prog-1/self-enroll').set(EMP_HEADERS);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('new-enr');
  });

  test('E4 POST self-enroll 409 when already enrolled', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue(mockProgram);
    mockDb.trainingEnrollment.findUnique.mockResolvedValue({ ...mockEnrollment, status: 'IN_PROGRESS' });
    const res = await request(app).post('/training/programs/prog-1/self-enroll').set(EMP_HEADERS);
    expect(res.status).toBe(409);
  });

  test('E5 POST self-enroll 400 for non-published program', async () => {
    mockDb.trainingProgram.findUnique.mockResolvedValue({ ...mockProgram, status: 'DRAFT' });
    const res = await request(app).post('/training/programs/prog-1/self-enroll').set(EMP_HEADERS);
    expect(res.status).toBe(400);
  });

  test('E6 PUT progress updates enrollment to IN_PROGRESS', async () => {
    mockDb.trainingEnrollment.findUnique.mockResolvedValue(mockEnrollment);
    mockDb.trainingEnrollment.update.mockResolvedValue({ ...mockEnrollment, progress: 50, status: 'IN_PROGRESS' });
    const res = await request(app).put('/training/enrollments/enr-1/progress').set(EMP_HEADERS).send({ progress: 50 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_PROGRESS');
  });

  test('E7 PUT progress=100 marks COMPLETED', async () => {
    mockDb.trainingEnrollment.findUnique.mockResolvedValue({ ...mockEnrollment, status: 'IN_PROGRESS' });
    mockDb.trainingEnrollment.update.mockResolvedValue({ ...mockEnrollment, progress: 100, status: 'COMPLETED', score: 85 });
    const res = await request(app).put('/training/enrollments/enr-1/progress').set(EMP_HEADERS).send({ progress: 100, score: 85 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
  });

  test('E8 PUT progress 403 for other employee enrollment', async () => {
    mockDb.trainingEnrollment.findUnique.mockResolvedValue({ ...mockEnrollment, employeeId: 'other-emp' });
    const res = await request(app).put('/training/enrollments/enr-1/progress').set(EMP_HEADERS).send({ progress: 50 });
    expect(res.status).toBe(403);
  });

  test('E9 DELETE /training/enrollments/:id drops enrollment', async () => {
    mockDb.trainingEnrollment.findUnique.mockResolvedValue(mockEnrollment);
    mockDb.trainingEnrollment.update.mockResolvedValue({ ...mockEnrollment, status: 'DROPPED' });
    const res = await request(app).delete('/training/enrollments/enr-1').set(EMP_HEADERS);
    expect(res.status).toBe(200);
  });

  test('E10 DELETE enrollment 400 for completed enrollment', async () => {
    mockDb.trainingEnrollment.findUnique.mockResolvedValue({ ...mockEnrollment, status: 'COMPLETED' });
    const res = await request(app).delete('/training/enrollments/enr-1').set(EMP_HEADERS);
    expect(res.status).toBe(400);
  });
});

// ── F) Per-program stats ───────────────────────────────────────────────────────
describe('F) Program stats', () => {
  test('F1 GET /training/programs/:id/stats returns aggregated stats', async () => {
    mockDb.trainingEnrollment.findMany.mockResolvedValue([
      { status: 'COMPLETED', progress: 100, score: 80 },
      { status: 'COMPLETED', progress: 100, score: 90 },
      { status: 'IN_PROGRESS', progress: 50, score: null },
    ]);
    const res = await request(app).get('/training/programs/prog-1/stats').set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalEnrolled: 3, completionRate: 67, avgScore: 85 });
  });

  test('F2 returns zero stats for empty program', async () => {
    mockDb.trainingEnrollment.findMany.mockResolvedValue([]);
    const res = await request(app).get('/training/programs/prog-1/stats').set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalEnrolled: 0, completionRate: 0, avgScore: null });
  });
});

// ── G) Certification reminder sweep (TRN-004) ─────────────────────────────────
describe('G) Cert reminder sweep', () => {
  function makeCert(over = {}) {
    return {
      id: 'cert-1', employeeId: 'emp-1', certName: 'CPR',
      issuingBody: null, certNumber: null, issuedAt: null,
      expiresAt: new Date(Date.now() + 20 * 86400000),
      status: 'ACTIVE', documentUrl: null, notes: null,
      renewalProgramId: null, competencyId: null,
      createdBy: 'admin-emp-1',
      createdAt: new Date(), updatedAt: new Date(),
      reminders: [],
      ...over,
    };
  }

  test('G1 sweep with no certs returns zero counters', async () => {
    mockDb.employeeCertification.findMany.mockResolvedValue([]);
    const res = await request(app)
      .post('/training/certifications/sweep-reminders')
      .set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ certsScanned: 0, remindersCreated: 0, nominated: 0 });
  });

  test('G2 sweep fires 90/60/30 for a cert 20 days out, no prior reminders', async () => {
    mockDb.employeeCertification.findMany.mockResolvedValue([makeCert()]);
    mockDb.certReminder.create.mockResolvedValue({});
    const res = await request(app)
      .post('/training/certifications/sweep-reminders')
      .set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.remindersCreated).toBe(3);
    expect(mockDb.certReminder.create).toHaveBeenCalledTimes(3);
  });

  test('G3 sweep skips thresholds already recorded (idempotent)', async () => {
    mockDb.employeeCertification.findMany.mockResolvedValue([
      makeCert({ reminders: [{ threshold: 90 }, { threshold: 60 }] }),
    ]);
    mockDb.certReminder.create.mockResolvedValue({});
    const res = await request(app)
      .post('/training/certifications/sweep-reminders')
      .set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.remindersCreated).toBe(1); // only 30 fires
    expect(mockDb.certReminder.create).toHaveBeenCalledTimes(1);
  });

  test('G4 sweep tolerates P2002 (race / concurrent insert) and still counts the others', async () => {
    mockDb.employeeCertification.findMany.mockResolvedValue([makeCert()]);
    let calls = 0;
    mockDb.certReminder.create.mockImplementation(() => {
      calls++;
      if (calls === 2) {
        const err = new Error('Unique constraint');
        err.code = 'P2002';
        return Promise.reject(err);
      }
      return Promise.resolve({});
    });
    const res = await request(app)
      .post('/training/certifications/sweep-reminders')
      .set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.remindersCreated).toBe(2); // 2 succeeded, 1 was P2002
  });

  test('G5 sweep auto-nominates when 60-day fires and renewalProgramId is set', async () => {
    mockDb.employeeCertification.findMany.mockResolvedValue([
      makeCert({
        expiresAt: new Date(Date.now() + 55 * 86400000),
        renewalProgramId: 'prog-renewal',
      }),
    ]);
    mockDb.certReminder.create.mockResolvedValue({});
    mockDb.trainingEnrollment.findUnique.mockResolvedValue(null);
    mockDb.trainingEnrollment.create.mockResolvedValue({ id: 'enr-new' });
    const res = await request(app)
      .post('/training/certifications/sweep-reminders')
      .set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.nominated).toBe(1);
    expect(mockDb.trainingEnrollment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        programId: 'prog-renewal', employeeId: 'emp-1', status: 'ENROLLED',
      }),
    }));
  });

  test('G6 sweep does NOT re-nominate when employee already has an enrollment', async () => {
    mockDb.employeeCertification.findMany.mockResolvedValue([
      makeCert({
        expiresAt: new Date(Date.now() + 55 * 86400000),
        renewalProgramId: 'prog-renewal',
      }),
    ]);
    mockDb.certReminder.create.mockResolvedValue({});
    mockDb.trainingEnrollment.findUnique.mockResolvedValue({ id: 'existing-enr', status: 'IN_PROGRESS' });
    const res = await request(app)
      .post('/training/certifications/sweep-reminders')
      .set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.nominated).toBe(0);
    expect(mockDb.trainingEnrollment.create).not.toHaveBeenCalled();
  });

  test('G7 GET /certifications/:id/reminders returns history', async () => {
    mockDb.certReminder.findMany.mockResolvedValue([
      { id: 'r1', certId: 'cert-1', threshold: 90, daysUntil: 85, sentAt: new Date() },
      { id: 'r2', certId: 'cert-1', threshold: 60, daysUntil: 55, sentAt: new Date() },
    ]);
    const res = await request(app)
      .get('/training/certifications/cert-1/reminders')
      .set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ── H) Competency framework (TRN-004) ─────────────────────────────────────────
describe('H) Competencies', () => {
  test('H1 GET /competencies lists', async () => {
    mockDb.competency.findMany.mockResolvedValue([
      { id: 'c1', name: 'First Aid', isActive: true },
    ]);
    const res = await request(app).get('/training/competencies').set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('H2 POST /competencies 400 without name', async () => {
    const res = await request(app).post('/training/competencies').set(ADMIN_HEADERS).send({});
    expect(res.status).toBe(400);
  });

  test('H3 POST /competencies creates', async () => {
    mockDb.competency.create.mockResolvedValue({ id: 'c1', name: 'First Aid', isActive: true });
    const res = await request(app).post('/training/competencies').set(ADMIN_HEADERS)
      .send({ name: 'First Aid' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('First Aid');
  });

  test('H4 POST program-competency link clamps level to 1-5', async () => {
    mockDb.programCompetency.upsert.mockResolvedValue({ id: 'pc1', taughtLevel: 5 });
    const res = await request(app)
      .post('/training/programs/prog-1/competencies')
      .set(ADMIN_HEADERS)
      .send({ competencyId: 'c1', taughtLevel: 99 });
    expect(res.status).toBe(201);
    expect(mockDb.programCompetency.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ taughtLevel: 5 }),
      update: expect.objectContaining({ taughtLevel: 5 }),
    }));
  });

  test('H5 POST program-competency 400 without competencyId or level', async () => {
    const res = await request(app)
      .post('/training/programs/prog-1/competencies')
      .set(ADMIN_HEADERS).send({});
    expect(res.status).toBe(400);
  });

  test('H6 POST job-family competency sets required level', async () => {
    mockDb.jobFamilyCompetency.upsert.mockResolvedValue({ id: 'jfc1', requiredLevel: 3 });
    const res = await request(app)
      .post('/training/job-families/ENGINEERING/competencies')
      .set(ADMIN_HEADERS)
      .send({ competencyId: 'c1', requiredLevel: 3 });
    expect(res.status).toBe(201);
    expect(res.body.requiredLevel).toBe(3);
  });

  test('H7 PUT employee assessment upserts', async () => {
    mockDb.employeeCompetency.upsert.mockResolvedValue({
      id: 'ec1', employeeId: 'emp-1', competencyId: 'c1', assessedLevel: 4,
    });
    const res = await request(app)
      .put('/training/employees/emp-1/competencies/c1')
      .set(ADMIN_HEADERS)
      .send({ assessedLevel: 4 });
    expect(res.status).toBe(200);
    expect(res.body.assessedLevel).toBe(4);
  });

  test('H8 GET /employees/:id/competencies forbids other employee for non-admin', async () => {
    const res = await request(app)
      .get('/training/employees/other-emp/competencies')
      .set(EMP_HEADERS);
    expect(res.status).toBe(403);
  });

  test('H9 GET gap analysis flags missing assessments as 0 and recommends published programs', async () => {
    mockDb.jobFamilyCompetency.findMany.mockResolvedValue([
      {
        id: 'jfc1', jobFamily: 'ENGINEERING', competencyId: 'c1', requiredLevel: 3,
        competency: {
          id: 'c1', name: 'First Aid',
          programs: [
            { programId: 'prog-1', taughtLevel: 4, program: { id: 'prog-1', title: 'Advanced First Aid', status: 'PUBLISHED' } },
            { programId: 'prog-2', taughtLevel: 2, program: { id: 'prog-2', title: 'Basic First Aid', status: 'PUBLISHED' } },
            { programId: 'prog-3', taughtLevel: 5, program: { id: 'prog-3', title: 'Draft Program',     status: 'DRAFT' } },
          ],
        },
      },
    ]);
    mockDb.employeeCompetency.findMany.mockResolvedValue([]); // no prior assessment
    const res = await request(app)
      .get('/training/employees/emp-1/competencies/gap?jobFamily=ENGINEERING')
      .set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.requirements).toHaveLength(1);
    const gap = res.body.requirements[0];
    expect(gap.assessedLevel).toBe(0);
    expect(gap.gap).toBe(3);
    // Only published programs that teach AT or ABOVE the required level
    expect(gap.recommendedPrograms.map(p => p.programId)).toEqual(['prog-1']);
  });

  test('H10 GET gap shows zero gap and no recommendations when assessed meets required', async () => {
    mockDb.jobFamilyCompetency.findMany.mockResolvedValue([
      {
        id: 'jfc1', jobFamily: 'ENGINEERING', competencyId: 'c1', requiredLevel: 3,
        competency: {
          id: 'c1', name: 'First Aid',
          programs: [{ programId: 'prog-1', taughtLevel: 4, program: { id: 'prog-1', title: 'Adv', status: 'PUBLISHED' } }],
        },
      },
    ]);
    mockDb.employeeCompetency.findMany.mockResolvedValue([
      { competencyId: 'c1', assessedLevel: 3 },
    ]);
    const res = await request(app)
      .get('/training/employees/emp-1/competencies/gap?jobFamily=ENGINEERING')
      .set(ADMIN_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.requirements[0].gap).toBe(0);
    expect(res.body.requirements[0].recommendedPrograms).toEqual([]);
  });

  test('H11 GET gap 400 without jobFamily', async () => {
    const res = await request(app)
      .get('/training/employees/emp-1/competencies/gap')
      .set(ADMIN_HEADERS);
    expect(res.status).toBe(400);
  });
});
