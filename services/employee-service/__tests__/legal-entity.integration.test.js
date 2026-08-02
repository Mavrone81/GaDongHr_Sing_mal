'use strict';
/**
 * ENT-001 — an employee must belong to a legal entity of their own tenant.
 *
 * Enforced at assignment time rather than at payroll time (spec §3.4): a bad
 * link must never reach the compute path, where it would silently produce
 * payslips under another country's statutory rules.
 */
const { assertEntityMatchesTenant } = require('../src/utils/entity-guard');

describe('assertEntityMatchesTenant', () => {
  const entity = { id: 'ent-1', tenantId: 'ten-1', country: 'SG' };

  test('passes when the entity belongs to the tenant', () => {
    expect(() => assertEntityMatchesTenant(entity, 'ten-1')).not.toThrow();
  });

  // Without this guard a caller could attach an employee to another tenant's
  // entity and have their payroll computed under that tenant's country.
  test('throws when the entity belongs to a different tenant', () => {
    expect(() => assertEntityMatchesTenant(entity, 'ten-2'))
      .toThrow('Legal entity does not belong to this tenant');
  });

  test('throws when the entity is missing', () => {
    expect(() => assertEntityMatchesTenant(null, 'ten-1'))
      .toThrow('Legal entity not found');
  });

  test('the thrown error carries status 400', () => {
    expect.assertions(1);
    try {
      assertEntityMatchesTenant(entity, 'ten-2');
    } catch (err) {
      expect(err.status).toBe(400);
    }
  });

  // A caller with no tenant context must not slip through by matching
  // undefined against undefined.
  test('throws when the caller has no tenantId', () => {
    expect(() => assertEntityMatchesTenant({ id: 'e', tenantId: undefined }, undefined))
      .toThrow('Legal entity does not belong to this tenant');
  });
});
