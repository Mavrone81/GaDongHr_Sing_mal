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
