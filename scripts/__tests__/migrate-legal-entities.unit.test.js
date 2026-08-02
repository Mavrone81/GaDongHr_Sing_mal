'use strict';
/**
 * ENT-003 — every existing tenant gets exactly one primary LegalEntity.
 *
 * Only the pure helpers are unit-tested here; the DB traversal is exercised by
 * the dry-run in the task's verification steps. The helpers are where the
 * judgement calls live, so they are the part worth pinning.
 */
const { buildEntityFromTenant, deriveEntityCode } = require('../migrate-legal-entities');

describe('deriveEntityCode', () => {
  test('upper-cases the slug', () => {
    expect(deriveEntityCode('acme')).toBe('ACME');
  });
  test('strips characters outside A-Z0-9 and hyphen', () => {
    expect(deriveEntityCode('acme co. (sg)!')).toBe('ACME-CO-SG');
  });
  test('collapses repeated separators', () => {
    expect(deriveEntityCode('a   b')).toBe('A-B');
  });
  test('truncates to 32 characters', () => {
    expect(deriveEntityCode('x'.repeat(50))).toHaveLength(32);
  });
  test('falls back to ENTITY for an empty slug', () => {
    expect(deriveEntityCode('')).toBe('ENTITY');
  });
});

describe('buildEntityFromTenant', () => {
  const tenant = { id: 'ten-1', name: 'Acme Pte Ltd', slug: 'acme', country: 'SG' };

  test('derives an SG entity from tenant + profile', () => {
    const profile = { legalName: 'Acme Private Limited', registrationNo: '201812345A' };
    expect(buildEntityFromTenant(tenant, profile)).toEqual({
      tenantId: 'ten-1',
      name: 'Acme Private Limited',
      code: 'ACME',
      country: 'SG',
      currency: 'SGD',
      timezone: 'Asia/Singapore',
      registrationNo: '201812345A',
      isPrimary: true,
    });
  });

  test('falls back to the tenant name when there is no profile', () => {
    const e = buildEntityFromTenant(tenant, null);
    expect(e.name).toBe('Acme Pte Ltd');
    expect(e.registrationNo).toBeNull();
  });

  // ENT-003: every existing tenant migrates as Singapore regardless of the
  // inert `country` captured at signup — no live tenant has ever computed
  // anything but SG payroll, so honouring that field would silently change
  // behaviour for anyone who picked another country on the signup form.
  test('forces SG even when the tenant row says otherwise', () => {
    const e = buildEntityFromTenant({ ...tenant, country: 'MY' }, null);
    expect(e.country).toBe('SG');
    expect(e.currency).toBe('SGD');
  });
});
