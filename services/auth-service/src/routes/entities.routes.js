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

const router = express.Router();

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

module.exports = router;
