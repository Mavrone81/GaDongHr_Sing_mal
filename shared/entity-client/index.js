'use strict';

/**
 * ENT-002 — resolves a LegalEntity to the context a downstream service needs in
 * order to select a country's statutory rules.
 *
 * FAIL-CLOSED BY DESIGN. The api-gateway's entitlement cache fails OPEN, and
 * correctly so: a control-plane hiccup must not take down every tenant's app.
 * This module does the opposite. If we cannot establish which country an entity
 * is in, we must not guess — computing Singapore CPF for a Malaysian employee is
 * a compliance failure that surfaces months later, whereas an unavailable
 * payroll run surfaces immediately. Every failure path throws.
 *
 * Country is resolved from the entity recorded server-side, never from a request
 * header, body, or JWT claim: a group HR administrator legitimately operates
 * across countries within one session, so a token-level country would be wrong
 * by construction.
 */

class EntityResolutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EntityResolutionError';
    // 503 rather than 500: the caller should surface this as retryable and
    // leave the payroll run in DRAFT.
    this.status = 503;
  }
}

const _cache = new Map();
const TTL_MS = Number(process.env.ENTITY_CACHE_TTL_MS || 30000);

function clearEntityCache() { _cache.clear(); }

async function resolveEntity(legalEntityId) {
  if (!legalEntityId) throw new EntityResolutionError('legalEntityId is required');

  const cached = _cache.get(legalEntityId);
  if (cached && (Date.now() - cached.at) < TTL_MS) return cached.entity;

  const key = process.env.INTERNAL_SERVICE_KEY;
  // No hardcoded development fallback — the VAPT C-07 defect class.
  if (!key) throw new EntityResolutionError('INTERNAL_SERVICE_KEY is not configured');

  const base = process.env.AUTH_SERVICE_URL || 'http://auth-service:4001';

  let res;
  try {
    res = await fetch(`${base}/tenants/internal/entities/${legalEntityId}`, {
      headers: { 'x-internal-service-key': key },
    });
  } catch (err) {
    throw new EntityResolutionError(`Entity resolution failed: ${err.message}`);
  }

  if (!res.ok) {
    throw new EntityResolutionError(`Entity resolution returned ${res.status} for ${legalEntityId}`);
  }

  const entity = await res.json();
  // Only successes are cached. Caching a failure would turn a transient blip
  // into a TTL-long outage, and worse, could mask a genuinely missing entity.
  _cache.set(legalEntityId, { at: Date.now(), entity });
  return entity;
}

module.exports = { resolveEntity, clearEntityCache, EntityResolutionError };
