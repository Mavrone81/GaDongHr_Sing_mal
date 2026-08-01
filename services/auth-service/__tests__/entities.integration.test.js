'use strict';
/**
 * ENT-001 / ENT-002 — LegalEntity resolution.
 *
 * The internal endpoint is how every downstream service learns which country an
 * entity is in. It is service-to-service only: a tenant-facing caller must never
 * be able to read another tenant's entity, and the key check must fail closed
 * when INTERNAL_SERVICE_KEY is unset (VAPT C-07).
 */
const request = require('supertest');

const mockPrisma = { legalEntity: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() } };
jest.mock('../src/utils/prisma', () => mockPrisma);

process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';

const express = require('express');
const entitiesRoutes = require('../src/routes/entities.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/tenants', entitiesRoutes);
  return app;
}

const ENTITY = {
  id: 'ent-1', tenantId: 'ten-1', name: 'Acme Pte Ltd', code: 'ACME-SG',
  country: 'SG', currency: 'SGD', timezone: 'Asia/Singapore', state: null,
  registrationNo: '201812345A', statutoryIds: { cpfSubmissionNumber: 'CSN-1' },
  isPrimary: true, isActive: true,
};

describe('GET /tenants/internal/entities/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the entity when the internal key is valid', async () => {
    mockPrisma.legalEntity.findUnique.mockResolvedValue(ENTITY);
    const res = await request(buildApp())
      .get('/tenants/internal/entities/ent-1')
      .set('x-internal-service-key', 'test-internal-key');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'ent-1', tenantId: 'ten-1', name: 'Acme Pte Ltd', code: 'ACME-SG',
      country: 'SG', currency: 'SGD', timezone: 'Asia/Singapore', state: null,
      registrationNo: '201812345A', statutoryIds: { cpfSubmissionNumber: 'CSN-1' },
    });
  });

  test('rejects a missing internal key with 401', async () => {
    const res = await request(buildApp()).get('/tenants/internal/entities/ent-1');
    expect(res.status).toBe(401);
    expect(mockPrisma.legalEntity.findUnique).not.toHaveBeenCalled();
  });

  test('rejects a wrong internal key with 401', async () => {
    const res = await request(buildApp())
      .get('/tenants/internal/entities/ent-1')
      .set('x-internal-service-key', 'wrong');
    expect(res.status).toBe(401);
  });

  test('returns 404 for an unknown entity', async () => {
    mockPrisma.legalEntity.findUnique.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/tenants/internal/entities/nope')
      .set('x-internal-service-key', 'test-internal-key');
    expect(res.status).toBe(404);
  });

  test('does not leak inactive entities', async () => {
    mockPrisma.legalEntity.findUnique.mockResolvedValue({ ...ENTITY, isActive: false });
    const res = await request(buildApp())
      .get('/tenants/internal/entities/ent-1')
      .set('x-internal-service-key', 'test-internal-key');
    expect(res.status).toBe(404);
  });
});

describe('entity CRUD', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists entities for a tenant', async () => {
    mockPrisma.legalEntity.findMany.mockResolvedValue([ENTITY]);
    const res = await request(buildApp()).get('/tenants/ten-1/entities');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].code).toBe('ACME-SG');
  });

  test('creates an entity with a supported country', async () => {
    mockPrisma.legalEntity.create.mockResolvedValue({ ...ENTITY, id: 'ent-2', code: 'ACME-MY' });
    const res = await request(buildApp())
      .post('/tenants/ten-1/entities')
      .send({ name: 'Acme Sdn Bhd', code: 'ACME-MY', country: 'MY' });

    expect(res.status).toBe(201);
    // Currency and timezone are derived from country, never client-supplied.
    expect(mockPrisma.legalEntity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: 'ten-1', country: 'MY', currency: 'MYR', timezone: 'Asia/Kuala_Lumpur',
      }),
    }));
  });

  test('derives SGD / Asia/Singapore for an SG entity', async () => {
    mockPrisma.legalEntity.create.mockResolvedValue(ENTITY);
    await request(buildApp())
      .post('/tenants/ten-1/entities')
      .send({ name: 'Acme Pte Ltd', code: 'ACME-SG', country: 'SG' });

    expect(mockPrisma.legalEntity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: 'SGD', timezone: 'Asia/Singapore' }),
    }));
  });

  // Adding a country without a statutory service behind it would let a tenant
  // create entities whose payroll cannot compute (PRD §A1.2).
  test('rejects an unsupported country', async () => {
    const res = await request(buildApp())
      .post('/tenants/ten-1/entities')
      .send({ name: 'Acme KK', code: 'ACME-HK', country: 'HK' });
    expect(res.status).toBe(400);
    expect(mockPrisma.legalEntity.create).not.toHaveBeenCalled();
  });

  test('ignores a client-supplied currency (ENT-002)', async () => {
    mockPrisma.legalEntity.create.mockResolvedValue(ENTITY);
    await request(buildApp())
      .post('/tenants/ten-1/entities')
      .send({ name: 'Acme', code: 'A1', country: 'SG', currency: 'USD' });

    expect(mockPrisma.legalEntity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currency: 'SGD' }),
    }));
  });

  test('rejects a missing name or code', async () => {
    const res = await request(buildApp())
      .post('/tenants/ten-1/entities').send({ country: 'SG' });
    expect(res.status).toBe(400);
  });

  test('maps a duplicate code to 409', async () => {
    mockPrisma.legalEntity.create.mockRejectedValue({ code: 'P2002' });
    const res = await request(buildApp())
      .post('/tenants/ten-1/entities')
      .send({ name: 'Acme', code: 'ACME-SG', country: 'SG' });
    expect(res.status).toBe(409);
  });
});

/**
 * Cross-tenant scoping. Not specified in the plan, added because without it
 * these routes are an IDOR of the same class as VAPT C-01/C-02 — a caller in
 * one tenant could enumerate or create legal entities in another. Follows the
 * convention already used at tenants.routes.js:186 (mock JWT is tenant ten-1).
 */
describe('entity routes are tenant-scoped', () => {
  beforeEach(() => jest.clearAllMocks());

  test('listing another tenant\'s entities is 403', async () => {
    const res = await request(buildApp()).get('/tenants/ten-OTHER/entities');
    expect(res.status).toBe(403);
    expect(mockPrisma.legalEntity.findMany).not.toHaveBeenCalled();
  });

  test('creating in another tenant is 403', async () => {
    const res = await request(buildApp())
      .post('/tenants/ten-OTHER/entities')
      .send({ name: 'Evil Sdn Bhd', code: 'EVIL', country: 'MY' });
    expect(res.status).toBe(403);
    expect(mockPrisma.legalEntity.create).not.toHaveBeenCalled();
  });

  test('"me" resolves to the caller\'s own tenant', async () => {
    mockPrisma.legalEntity.findMany.mockResolvedValue([ENTITY]);
    const res = await request(buildApp()).get('/tenants/me/entities');
    expect(res.status).toBe(200);
    expect(mockPrisma.legalEntity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'ten-1' } }),
    );
  });

  test('create always stamps the caller\'s tenantId, never the path value', async () => {
    mockPrisma.legalEntity.create.mockResolvedValue(ENTITY);
    await request(buildApp())
      .post('/tenants/me/entities')
      .send({ name: 'Acme', code: 'A2', country: 'SG' });

    expect(mockPrisma.legalEntity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'ten-1' }),
    }));
  });
});
