'use strict';
/**
 * Regression guard for a live cross-tenant defect.
 *
 * PayrollRun's unique key was [period, runType, periodHalf] with no tenant
 * dimension, so the second tenant to create a 2026-01 MONTHLY run received a
 * Prisma P2002 — surfaced by payroll.routes.js as "A payroll run for this
 * period already exists", which reads like a duplicate rather than a
 * cross-tenant collision.
 *
 * legalEntityId joins the key too: a group tenant legitimately runs January
 * payroll once per entity.
 */
const { buildRunUniqueWhere, toStoredPeriodHalf } = require('../src/utils/run-scope');

describe('buildRunUniqueWhere', () => {
  test('includes tenantId and legalEntityId in the key', () => {
    expect(buildRunUniqueWhere({
      tenantId: 'ten-1', legalEntityId: 'ent-1',
      period: '2026-01', runType: 'MONTHLY', periodHalf: null,
    })).toEqual({
      tenantId_legalEntityId_period_runType_periodHalf: {
        tenantId: 'ten-1', legalEntityId: 'ent-1',
        // null is stored as the NONE sentinel — see the sentinel describe below.
        period: '2026-01', runType: 'MONTHLY', periodHalf: 'NONE',
      },
    });
  });

  test('two tenants with the same period produce different keys', () => {
    const a = buildRunUniqueWhere({ tenantId: 'ten-1', legalEntityId: 'ent-1', period: '2026-01', runType: 'MONTHLY', periodHalf: null });
    const b = buildRunUniqueWhere({ tenantId: 'ten-2', legalEntityId: 'ent-2', period: '2026-01', runType: 'MONTHLY', periodHalf: null });
    expect(a).not.toEqual(b);
  });

  // A group tenant's SG and MY entities both run January — must not collide.
  test('two entities of one tenant produce different keys', () => {
    const sg = buildRunUniqueWhere({ tenantId: 'ten-1', legalEntityId: 'ent-sg', period: '2026-01', runType: 'MONTHLY', periodHalf: null });
    const my = buildRunUniqueWhere({ tenantId: 'ten-1', legalEntityId: 'ent-my', period: '2026-01', runType: 'MONTHLY', periodHalf: null });
    expect(sg).not.toEqual(my);
  });

  test('defaults periodHalf to the NONE sentinel when omitted', () => {
    expect(buildRunUniqueWhere({
      tenantId: 'ten-1', legalEntityId: 'ent-1', period: '2026-01', runType: 'MONTHLY',
    }).tenantId_legalEntityId_period_runType_periodHalf.periodHalf).toBe('NONE');
  });

  test('throws when legalEntityId is absent', () => {
    expect(() => buildRunUniqueWhere({ tenantId: 'ten-1', period: '2026-01', runType: 'MONTHLY', periodHalf: null }))
      .toThrow('legalEntityId is required');
  });

  test('throws when tenantId is absent', () => {
    expect(() => buildRunUniqueWhere({ legalEntityId: 'ent-1', period: '2026-01', runType: 'MONTHLY', periodHalf: null }))
      .toThrow('tenantId is required');
  });
});

/**
 * NULL periodHalf made the unique key inert for MONTHLY/ADHOC runs: Postgres
 * treats every NULL as distinct from every other NULL, so two identical monthly
 * runs did not collide and duplicate finalised payroll was possible. NONE is a
 * real value, so the key constrains again.
 *
 * The API contract is unchanged — callers still omit periodHalf for
 * non-bimonthly runs. NONE is a storage detail applied server-side.
 */
describe('periodHalf sentinel', () => {
  test('null, undefined and empty string all normalise to NONE', () => {
    expect(toStoredPeriodHalf(null)).toBe('NONE');
    expect(toStoredPeriodHalf(undefined)).toBe('NONE');
    expect(toStoredPeriodHalf('')).toBe('NONE');
  });

  test('FIRST and SECOND pass through unchanged', () => {
    expect(toStoredPeriodHalf('FIRST')).toBe('FIRST');
    expect(toStoredPeriodHalf('SECOND')).toBe('SECOND');
  });

  test('an explicit null is coerced to the sentinel in the key', () => {
    const key = buildRunUniqueWhere({
      tenantId: 'ten-1', legalEntityId: 'ent-1', period: '2026-01',
      runType: 'MONTHLY', periodHalf: null,
    }).tenantId_legalEntityId_period_runType_periodHalf;
    expect(key.periodHalf).toBe('NONE');
  });

  // Two monthly runs for one entity+period must now produce an IDENTICAL key,
  // so the database rejects the second. Under NULL they were distinct.
  test('two identical monthly runs produce the same key', () => {
    const args = { tenantId: 'ten-1', legalEntityId: 'ent-1', period: '2026-01', runType: 'MONTHLY' };
    expect(buildRunUniqueWhere(args)).toEqual(buildRunUniqueWhere({ ...args, periodHalf: null }));
  });
});
