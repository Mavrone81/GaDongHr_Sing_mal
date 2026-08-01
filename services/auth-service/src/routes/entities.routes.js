'use strict';
/**
 * ENT-001 — LegalEntity routes.
 *
 * The internal resolution endpoint is the seam that makes the platform
 * multi-country: every downstream service asks this for an entity's country
 * rather than deriving it from the tenant or (worse) trusting the client.
 */
const express = require('express');
const prisma = require('../utils/prisma');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const router = express.Router();

/**
 * v1 supports Singapore and Peninsular Malaysia only.
 *
 * Currency and timezone are DERIVED from country here rather than accepted from
 * the request (ENT-002) — they are properties of the jurisdiction, not user
 * preferences, and a mismatched pair would silently produce payslips in the
 * wrong currency.
 *
 * Do not add a country to this map before its statutory service exists: a
 * tenant could then create entities whose payroll cannot compute at all
 * (PRD §A1.2). Malaysia is listed because statutory-my-service is planned for
 * P2; until it ships, an MY entity can be created but its payroll will fail
 * closed rather than compute something wrong.
 */
const COUNTRY_DEFAULTS = {
  SG: { currency: 'SGD', timezone: 'Asia/Singapore' },
  MY: { currency: 'MYR', timezone: 'Asia/Kuala_Lumpur' },
};

/**
 * Service-to-service only.
 *
 * Fails closed when INTERNAL_SERVICE_KEY is unset rather than falling back to a
 * hardcoded development default — the class of defect VAPT C-07 recorded, where
 * three services accepted a well-known literal key.
 */
function requireInternalKey(req, res, next) {
  const expected = process.env.INTERNAL_SERVICE_KEY;
  if (!expected) return res.status(401).json({ error: 'Internal key not configured' });
  if (req.headers['x-internal-service-key'] !== expected) {
    return res.status(401).json({ error: 'Invalid internal service key' });
  }
  next();
}

/**
 * Resolution endpoint consumed by shared/entity-client.
 *
 * Returns only what a downstream service needs to select a country's statutory
 * rules — never the audit columns. An inactive entity is reported as 404 rather
 * than returned with a flag, so a caller cannot accidentally compute payroll
 * against a decommissioned entity by ignoring a boolean.
 */
router.get('/internal/entities/:id', requireInternalKey, async (req, res, next) => {
  try {
    const e = await prisma.legalEntity.findUnique({ where: { id: req.params.id } });
    if (!e || !e.isActive) return res.status(404).json({ error: 'Legal entity not found' });
    res.json({
      id: e.id, tenantId: e.tenantId, name: e.name, code: e.code,
      country: e.country, currency: e.currency, timezone: e.timezone,
      state: e.state, registrationNo: e.registrationNo,
      statutoryIds: e.statutoryIds,
    });
  } catch (err) { next(err); }
});

/**
 * Resolves the tenant a request may act on, or null if it may not.
 *
 * Without this, these routes are an IDOR of the same class as VAPT C-01/C-02 —
 * the path segment is attacker-controlled, so a caller in one tenant could
 * enumerate or create legal entities in another. The authoritative tenant is
 * always the one in the verified JWT; the path value is only ever allowed to
 * *match* it. Mirrors the convention at tenants.routes.js:186.
 */
function resolveScopedTenantId(req) {
  const tokenTenantId = req.user && req.user.tenantId;
  if (!tokenTenantId) return null;
  const requested = req.params.tenantId;
  if (requested === 'me' || requested === tokenTenantId) return tokenTenantId;
  return null;
}

/** Entities belonging to a tenant. Primary first, then by code. */
router.get('/:tenantId/entities', authenticate, async (req, res, next) => {
  try {
    const tenantId = resolveScopedTenantId(req);
    if (!tenantId) return res.status(403).json({ error: 'You can only access your own tenant' });

    const rows = await prisma.legalEntity.findMany({
      where: { tenantId },
      orderBy: [{ isPrimary: 'desc' }, { code: 'asc' }],
    });
    res.json(rows.map(e => ({
      id: e.id, name: e.name, code: e.code, country: e.country,
      currency: e.currency, state: e.state, isPrimary: e.isPrimary, isActive: e.isActive,
    })));
  } catch (err) { next(err); }
});

router.post('/:tenantId/entities', authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
    try {
      const tenantId = resolveScopedTenantId(req);
      if (!tenantId) return res.status(403).json({ error: 'You can only access your own tenant' });

      const { name, code, country, state, registrationNo, statutoryIds } = req.body || {};
      if (!name || !code) return res.status(400).json({ error: 'name and code are required' });

      const ctry = String(country || 'SG').toUpperCase();
      const defaults = COUNTRY_DEFAULTS[ctry];
      if (!defaults) {
        return res.status(400).json({
          error: `country must be one of ${Object.keys(COUNTRY_DEFAULTS).join(', ')}`,
        });
      }

      const entity = await prisma.legalEntity.create({
        data: {
          // From the verified token, never the path segment.
          tenantId,
          name, code, country: ctry,
          // Derived, not client-supplied — see COUNTRY_DEFAULTS above.
          currency: defaults.currency,
          timezone: defaults.timezone,
          // State is meaningful only for MY (it selects the state holiday set);
          // carrying one on an SG entity would be misleading data.
          state: ctry === 'MY' ? (state || null) : null,
          registrationNo: registrationNo || null,
          statutoryIds: statutoryIds || null,
          isPrimary: false,
        },
      });
      res.status(201).json(entity);
    } catch (err) {
      if (err.code === 'P2002') {
        return res.status(409).json({ error: 'An entity with this code already exists for the tenant' });
      }
      next(err);
    }
  });

module.exports = router;
