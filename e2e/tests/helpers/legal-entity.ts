import type { APIRequestContext } from '@playwright/test';

/**
 * Resolve the tenant's primary legal entity.
 *
 * ENT-001 made a payroll run belong to exactly one legal entity — that entity
 * fixes the country, currency and statutory rule set for the whole compute — so
 * POST /payroll/runs now requires `legalEntityId`. The e2e suite predates that
 * and created runs without one, which is why every payroll and GIRO spec failed
 * with:
 *
 *     {"error":"legalEntityId is required to create a payroll run"}
 *
 * The requirement is deliberately NOT relaxed to "default to the only entity".
 * It is right for a single-entity tenant and wrong the moment a tenant has both
 * a Singapore and a Malaysian entity: guessing would silently compute one
 * country's statutory rules against the other's employees, and the payslips
 * would look entirely plausible. Making the caller name the entity is the point
 * of ENT-001, so the tests are what changes.
 *
 * Cached per worker: every payroll spec needs it and it never changes mid-run.
 */
let cached: string | undefined;

export async function primaryLegalEntityId(admin: APIRequestContext): Promise<string> {
  if (cached) return cached;

  // 'me' resolves to the caller's own tenant, so no tenant id is needed here.
  const res = await admin.get('/api/tenants/me/entities');
  if (!res.ok()) {
    throw new Error(
      `Could not list legal entities (${res.status()}): ${await res.text()}. ` +
      'Payroll specs cannot create a run without one.');
  }

  const entities = await res.json();
  const list = Array.isArray(entities) ? entities : (entities.entities ?? []);
  if (list.length === 0) {
    throw new Error(
      'Tenant has no legal entity. seed:default-tenant should create one — ' +
      'without it no payroll run can be created at all.');
  }

  // The endpoint already orders primary-first, but be explicit rather than
  // relying on the ordering of someone else's query.
  const primary = list.find((e: any) => e.isPrimary) ?? list[0];
  cached = primary.id as string;
  return cached;
}

/** Reset between workers/files that want a clean resolve. */
export function clearEntityCache(): void {
  cached = undefined;
}
