'use strict';

jest.mock('/app/shared/auth-middleware', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      sub: req.headers['x-user-id'] || 'user-1',
      role: req.headers['x-user-role'] || 'HR_ADMIN',
    };
    next();
  },
  authorize: () => (req, res, next) => next(),
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', HR_MANAGER: 'HR_MANAGER',
    FINANCE_ADMIN: 'FINANCE_ADMIN', PAYROLL_OFFICER: 'PAYROLL_OFFICER',
    MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE',
  },
}), { virtual: true });

const mockDb = {
  reportTemplate: {
    findMany: jest.fn(), findUnique: jest.fn(),
    create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  },
  reportSchedule: {
    findMany: jest.fn(), findUnique: jest.fn(),
    create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  },
  reportRun: {
    findMany: jest.fn(), create: jest.fn(),
  },
};

jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockDb) }));

jest.mock('axios');
const axios = require('axios');

const request = require('supertest');
const { app } = require('../src/index');

const ADMIN = { 'x-user-role': 'HR_ADMIN', 'x-user-id': 'user-admin', authorization: 'Bearer test' };
const HR_MGR = { 'x-user-role': 'HR_MANAGER', 'x-user-id': 'user-mgr', authorization: 'Bearer test' };

const sampleEmployees = [
  { id: '1', department: 'ENG', isActive: true, basicSalary: 5000 },
  { id: '2', department: 'ENG', isActive: true, basicSalary: 6000 },
  { id: '3', department: 'OPS', isActive: false, basicSalary: 4000 },
];

beforeEach(() => {
  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: { employees: sampleEmployees } });
});

// ── A) Metadata ───────────────────────────────────────────────────────────────
describe('A) Data sources metadata', () => {
  test('A1 GET /reports/data-sources returns the option lists for the builder UI', async () => {
    const res = await request(app).get('/reports/data-sources').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.dataSources).toContain('employees');
    expect(res.body.filterOps).toContain('eq');
    expect(res.body.aggregationOps).toContain('count');
    expect(res.body.frequencies).toEqual(['DAILY', 'WEEKLY', 'MONTHLY']);
  });
});

// ── B) Template CRUD ──────────────────────────────────────────────────────────
describe('B) Template CRUD', () => {
  test('B1 POST 400 without name', async () => {
    const res = await request(app).post('/reports/templates').set(ADMIN)
      .send({ definition: { dataSource: 'employees' } });
    expect(res.status).toBe(400);
  });

  test('B2 POST 400 with invalid definition', async () => {
    const res = await request(app).post('/reports/templates').set(ADMIN)
      .send({ name: 'Bad', definition: { dataSource: 'unicorns' } });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeDefined();
  });

  test('B3 POST creates template', async () => {
    mockDb.reportTemplate.create.mockResolvedValue({ id: 't1', name: 'Headcount', ownerId: 'user-admin' });
    const res = await request(app).post('/reports/templates').set(ADMIN).send({
      name: 'Headcount', description: 'Active headcount by dept',
      definition: {
        dataSource: 'employees',
        filters: [{ field: 'isActive', op: 'eq', value: true }],
        groupBy: 'department',
        aggregations: [{ op: 'count', as: 'headcount' }],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('t1');
  });

  test('B4 GET /templates lists for non-admin includes own + shared', async () => {
    mockDb.reportTemplate.findMany.mockResolvedValue([]);
    await request(app).get('/reports/templates').set(HR_MGR);
    expect(mockDb.reportTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ ownerId: 'user-mgr' }, { isShared: true }],
      }),
    }));
  });

  test('B5 GET /templates for admin omits owner filter', async () => {
    mockDb.reportTemplate.findMany.mockResolvedValue([]);
    await request(app).get('/reports/templates').set(ADMIN);
    expect(mockDb.reportTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
    }));
  });

  test('B6 GET /templates/:id 404 missing', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/reports/templates/missing').set(ADMIN);
    expect(res.status).toBe(404);
  });

  test('B7 GET /templates/:id 403 when not owner + not shared + not admin', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({
      id: 't1', ownerId: 'someone-else', isShared: false, definition: {},
    });
    const res = await request(app).get('/reports/templates/t1').set(HR_MGR);
    expect(res.status).toBe(403);
  });

  test('B8 PUT /templates/:id 403 for non-owner non-admin', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({
      id: 't1', ownerId: 'someone-else', isShared: true, definition: {},
    });
    const res = await request(app).put('/reports/templates/t1').set(HR_MGR).send({ name: 'New' });
    expect(res.status).toBe(403);
  });

  test('B9 DELETE /templates/:id 403 for non-owner non-admin', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({
      id: 't1', ownerId: 'someone-else', isShared: true,
    });
    const res = await request(app).delete('/reports/templates/t1').set(HR_MGR);
    expect(res.status).toBe(403);
  });
});

// ── C) Run + preview ──────────────────────────────────────────────────────────
describe('C) Run + preview', () => {
  test('C1 POST /templates/:id/run executes and records run', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({
      id: 't1', ownerId: 'user-admin', name: 'Headcount',
      definition: {
        dataSource: 'employees',
        filters: [{ field: 'isActive', op: 'eq', value: true }],
        groupBy: 'department',
        aggregations: [{ op: 'count', as: 'headcount' }],
      },
    });
    mockDb.reportRun.create.mockResolvedValue({});
    const res = await request(app).post('/reports/templates/t1/run').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({ department: 'ENG', headcount: 2 });
    expect(mockDb.reportRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SUCCESS' }),
    }));
  });

  test('C2 POST /templates/:id/run records ERROR when downstream fails', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({
      id: 't1', ownerId: 'user-admin', definition: { dataSource: 'employees' },
    });
    axios.get.mockRejectedValue(new Error('upstream 500'));
    mockDb.reportRun.create.mockResolvedValue({});
    const res = await request(app).post('/reports/templates/t1/run').set(ADMIN);
    expect(res.status).toBe(500);
    expect(mockDb.reportRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ERROR' }),
    }));
  });

  test('C3 POST /preview runs ad-hoc definition for admin', async () => {
    const res = await request(app).post('/reports/preview').set(ADMIN).send({
      definition: { dataSource: 'employees', fields: [{ key: 'department' }] },
    });
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(3);
  });

  test('C4 POST /preview 400 invalid definition', async () => {
    const res = await request(app).post('/reports/preview').set(ADMIN).send({
      definition: { dataSource: 'banana' },
    });
    expect(res.status).toBe(400);
  });
});

// ── D) Exports ────────────────────────────────────────────────────────────────
describe('D) Exports', () => {
  test('D1 GET /templates/:id/export.csv returns CSV', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({
      id: 't1', name: 'Headcount', ownerId: 'user-admin',
      definition: {
        dataSource: 'employees',
        groupBy: 'department',
        aggregations: [{ op: 'count', as: 'headcount' }],
      },
    });
    mockDb.reportRun.create.mockResolvedValue({});
    const res = await request(app).get('/reports/templates/t1/export.csv').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment.*\.csv/);
    expect(res.text).toContain('department,headcount,rowCount');
    expect(res.text).toContain('ENG,2,2');
  });

  test('D2 GET /templates/:id/export.xlsx returns XLSX bytes', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({
      id: 't1', name: 'Headcount', ownerId: 'user-admin',
      definition: { dataSource: 'employees', fields: [{ key: 'department' }] },
    });
    mockDb.reportRun.create.mockResolvedValue({});
    const res = await request(app)
      .get('/reports/templates/t1/export.xlsx')
      .set(ADMIN)
      .buffer(true).parse((res, cb) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    // XLSX is a zip — magic bytes are PK
    expect(res.body[0]).toBe(0x50);
    expect(res.body[1]).toBe(0x4b);
  });
});

// ── E) Schedules ──────────────────────────────────────────────────────────────
describe('E) Schedules', () => {
  test('E1 POST 400 without required fields', async () => {
    const res = await request(app).post('/reports/schedules').set(ADMIN).send({});
    expect(res.status).toBe(400);
  });

  test('E2 POST 400 with bad frequency', async () => {
    const res = await request(app).post('/reports/schedules').set(ADMIN)
      .send({ templateId: 't1', frequency: 'YEARLY', recipients: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  test('E3 POST creates schedule, sets nextRunAt forward', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({ id: 't1', ownerId: 'user-admin' });
    mockDb.reportSchedule.create.mockImplementation(({ data }) => Promise.resolve({ id: 's1', ...data }));
    const res = await request(app).post('/reports/schedules').set(ADMIN).send({
      templateId: 't1', frequency: 'WEEKLY', format: 'XLSX',
      recipients: ['hr@example.com', 'finance@example.com'],
    });
    expect(res.status).toBe(201);
    expect(res.body.recipients).toBe('hr@example.com,finance@example.com');
    expect(res.body.format).toBe('XLSX');
    expect(new Date(res.body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('E4 PUT /schedules/:id 403 for non-creator non-admin', async () => {
    mockDb.reportSchedule.findUnique.mockResolvedValue({ id: 's1', createdBy: 'someone-else' });
    const res = await request(app).put('/reports/schedules/s1').set(HR_MGR)
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });

  test('E5 GET /schedules lists with template info', async () => {
    mockDb.reportSchedule.findMany.mockResolvedValue([
      { id: 's1', frequency: 'DAILY', template: { id: 't1', name: 'Headcount' } },
    ]);
    const res = await request(app).get('/reports/schedules').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body[0].template.name).toBe('Headcount');
  });
});

// ── F) Run history ────────────────────────────────────────────────────────────
describe('F) Run history', () => {
  test('F1 GET /templates/:id/runs returns history', async () => {
    mockDb.reportRun.findMany.mockResolvedValue([
      { id: 'r1', templateId: 't1', status: 'SUCCESS', rowCount: 42 },
    ]);
    const res = await request(app).get('/reports/templates/t1/runs').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

// ── G) Phase 2 — PDF export ───────────────────────────────────────────────────
describe('G) PDF export', () => {
  test('G1 GET /templates/:id/export.pdf returns PDF bytes with correct headers', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({
      id: 't1', name: 'Headcount', ownerId: 'user-admin',
      definition: {
        dataSource: 'employees',
        groupBy: 'department',
        aggregations: [{ op: 'count', as: 'headcount' }],
      },
    });
    mockDb.reportRun.create.mockResolvedValue({});
    const res = await request(app)
      .get('/reports/templates/t1/export.pdf')
      .set(ADMIN)
      .buffer(true)
      .parse((r, cb) => { const c = []; r.on('data', d => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/attachment.*\.pdf/);
    // PDF magic bytes %PDF
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('G2 GET /templates/:id/export.pdf 404 for missing template', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/reports/templates/missing/export.pdf').set(ADMIN);
    expect(res.status).toBe(404);
  });

  test('G3 GET /templates/:id/export.pdf 403 for non-owner non-shared non-admin', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({
      id: 't1', ownerId: 'someone-else', isShared: false,
      definition: { dataSource: 'employees' },
    });
    const res = await request(app).get('/reports/templates/t1/export.pdf').set(HR_MGR);
    expect(res.status).toBe(403);
  });
});

// ── H) Phase 2 — field catalog in data-sources ────────────────────────────────
describe('H) Field catalog', () => {
  test('H1 GET /reports/data-sources includes fieldCatalog for all 5 sources', async () => {
    const res = await request(app).get('/reports/data-sources').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.fieldCatalog).toBeDefined();
    ['employees', 'payrollRuns', 'leaveApplications', 'attendance', 'claims'].forEach(src => {
      expect(Array.isArray(res.body.fieldCatalog[src])).toBe(true);
      expect(res.body.fieldCatalog[src].length).toBeGreaterThan(0);
    });
  });

  test('H2 each field entry has key, label, and type', async () => {
    const res = await request(app).get('/reports/data-sources').set(ADMIN);
    for (const fields of Object.values(res.body.fieldCatalog)) {
      for (const f of fields) {
        expect(f.key).toBeTruthy();
        expect(f.label).toBeTruthy();
        expect(['string', 'number', 'boolean', 'date']).toContain(f.type);
      }
    }
  });
});

// ── I) Phase 2 — seed-templates endpoint ────────────────────────────────────
describe('I) Seed templates endpoint', () => {
  test('I1 POST /reports/seed-templates 200 when all templates already exist', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({ id: 'exists' });
    const res = await request(app).post('/reports/seed-templates').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.seeded).toBe(0);
  });

  test('I2 POST /reports/seed-templates seeds 4 templates on first run', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue(null);
    mockDb.reportTemplate.create.mockResolvedValue({ id: 'new' });
    const res = await request(app).post('/reports/seed-templates').set(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.seeded).toBe(4);
  });
});

// ── J) Phase 2 — schedule with PDF format ───────────────────────────────────
describe('J) Schedule PDF format', () => {
  test('J1 POST /schedules accepts PDF as format', async () => {
    mockDb.reportTemplate.findUnique.mockResolvedValue({ id: 't1', ownerId: 'user-admin' });
    mockDb.reportSchedule.create.mockImplementation(({ data }) => Promise.resolve({ id: 's-pdf', ...data }));
    const res = await request(app).post('/reports/schedules').set(ADMIN).send({
      templateId: 't1', frequency: 'MONTHLY', format: 'PDF',
      recipients: ['exec@example.com'],
    });
    expect(res.status).toBe(201);
    expect(res.body.format).toBe('PDF');
  });
});
