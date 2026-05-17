'use strict';

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, res, next) => next(),
  authorize: (...roles) => (req, res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE',
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
