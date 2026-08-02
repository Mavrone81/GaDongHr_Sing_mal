'use strict';
/**
 * ENT-001 — public holidays belong to a legal entity, not a tenant.
 *
 * PublicHoliday's unique key was [tenantId, date], so a tenant could hold only
 * ONE holiday per calendar date. A group tenant with an SG and an MY entity
 * cannot express Labour Day (both observe 1 May) or any date where the two
 * calendars differ — the constraint blocks multi-entity outright.
 *
 * Holiday keys are UTC-anchored YYYY-MM-DD, matching countWorkingDays in
 * shared/payroll-utils and frontend/src/lib/timezone.ts. Local getters here
 * would shift the day for any +08 machine — the defect fixed in 3059057.
 */
const { buildHolidaySet } = require('../src/utils/holiday-scope');

const HOLIDAYS = [
  { date: new Date('2026-05-01T00:00:00Z'), name: 'Labour Day',   legalEntityId: 'ent-sg' },
  { date: new Date('2026-05-01T00:00:00Z'), name: 'Hari Pekerja', legalEntityId: 'ent-my' },
  { date: new Date('2026-08-09T00:00:00Z'), name: 'National Day', legalEntityId: 'ent-sg' },
  { date: new Date('2026-08-31T00:00:00Z'), name: 'Hari Merdeka', legalEntityId: 'ent-my' },
];

describe('buildHolidaySet', () => {
  test('returns only the requested entity holidays', () => {
    const set = buildHolidaySet(HOLIDAYS, 'ent-sg');
    expect(set.has('2026-05-01')).toBe(true);
    expect(set.has('2026-08-09')).toBe(true);
    expect(set.has('2026-08-31')).toBe(false);
  });

  // The old [tenantId, date] key made this row pair impossible to store.
  test('two entities can hold different holidays on the same date', () => {
    expect(buildHolidaySet(HOLIDAYS, 'ent-sg').has('2026-05-01')).toBe(true);
    expect(buildHolidaySet(HOLIDAYS, 'ent-my').has('2026-05-01')).toBe(true);
  });

  test('returns an empty set for an unknown entity', () => {
    expect(buildHolidaySet(HOLIDAYS, 'ent-none').size).toBe(0);
  });

  test('keys dates as UTC YYYY-MM-DD', () => {
    expect([...buildHolidaySet(HOLIDAYS, 'ent-my')].sort())
      .toEqual(['2026-05-01', '2026-08-31']);
  });

  test('an empty holiday list yields an empty set', () => {
    expect(buildHolidaySet([], 'ent-sg').size).toBe(0);
  });

  // Rows predating the backfill carry a null legalEntityId. They must not leak
  // into an entity's holiday set, or a group tenant's MY payroll would silently
  // observe Singapore holidays.
  test('ignores rows with no legalEntityId', () => {
    const withOrphan = [...HOLIDAYS, { date: new Date('2026-12-25T00:00:00Z'), name: 'Orphan', legalEntityId: null }];
    expect(buildHolidaySet(withOrphan, 'ent-sg').has('2026-12-25')).toBe(false);
  });
});
