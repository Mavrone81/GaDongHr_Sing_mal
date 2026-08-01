'use strict';
/**
 * ENT-002 — entity resolution must fail CLOSED.
 *
 * The gateway's entitlement cache fails OPEN on purpose, so a control-plane
 * hiccup can't take down every tenant's app. This module is the opposite: if we
 * cannot establish which country an entity is in, guessing would compute
 * Singapore CPF for a Malaysian employee. An outage is the better failure.
 */
const { resolveEntity, clearEntityCache, EntityResolutionError } = require('../index');

const ENTITY = {
  id: 'ent-1', tenantId: 'ten-1', name: 'Acme Pte Ltd', code: 'ACME-SG',
  country: 'SG', currency: 'SGD', timezone: 'Asia/Singapore', state: null,
  registrationNo: '201812345A', statutoryIds: {},
};

describe('resolveEntity', () => {
  beforeEach(() => {
    clearEntityCache();
    process.env.AUTH_SERVICE_URL = 'http://auth-service:4001';
    process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
    global.fetch = jest.fn();
  });

  test('returns the entity context on success', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ENTITY });
    await expect(resolveEntity('ent-1')).resolves.toEqual(ENTITY);
  });

  test('sends the internal service key', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ENTITY });
    await resolveEntity('ent-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://auth-service:4001/tenants/internal/entities/ent-1',
      { headers: { 'x-internal-service-key': 'test-internal-key' } },
    );
  });

  test('caches within the TTL — one fetch for two calls', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ENTITY });
    await resolveEntity('ent-1');
    await resolveEntity('ent-1');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('throws EntityResolutionError when the network fails', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(resolveEntity('ent-1')).rejects.toBeInstanceOf(EntityResolutionError);
  });

  test('throws when auth-service returns non-ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(resolveEntity('ent-1')).rejects.toBeInstanceOf(EntityResolutionError);
  });

  test('never caches a failure', async () => {
    global.fetch.mockRejectedValueOnce(new Error('boom'));
    await expect(resolveEntity('ent-1')).rejects.toThrow();
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ENTITY });
    await expect(resolveEntity('ent-1')).resolves.toEqual(ENTITY);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('throws when INTERNAL_SERVICE_KEY is unset', async () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    await expect(resolveEntity('ent-1')).rejects.toBeInstanceOf(EntityResolutionError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('error carries status 503 so callers surface a retryable failure', async () => {
    global.fetch.mockRejectedValue(new Error('boom'));
    await expect(resolveEntity('ent-1')).rejects.toMatchObject({ status: 503 });
  });
});
