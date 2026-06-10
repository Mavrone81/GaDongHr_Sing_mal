'use strict';
// AST-003 asset maintenance, software licences, and alert sweep.

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { THRESHOLDS, daysUntil, pendingThresholds, classifyUrgency, formatAlertMessage } = require('../engines/alert.engine');

const prisma = require('../utils/prisma');
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN];

// ── ASSET MAINTENANCE ─────────────────────────────────────────────────────────

// POST /assets/:id/maintenance — record completed maintenance
router.post('/assets/:id/maintenance', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { scheduledAt, completedAt, performedBy, type, costAmount, notes } = req.body;
    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    const record = await prisma.assetMaintenance.create({
      data: {
        id: uuidv4(),
        assetId: req.params.id,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
        completedAt: completedAt ? new Date(completedAt) : null,
        performedBy: performedBy || null,
        type: (type || 'PREVENTIVE').toUpperCase(),
        costAmount: parseFloat(costAmount) || 0,
        notes: notes || null,
        createdBy: req.user.sub,
      },
    });

    // If maintenance was completed and asset has an interval, advance next due date
    if (record.completedAt && asset.maintenanceIntervalDays) {
      const next = new Date(record.completedAt);
      next.setDate(next.getDate() + asset.maintenanceIntervalDays);
      await prisma.asset.update({ where: { id: req.params.id }, data: { nextMaintenanceAt: next } });
      // Clear MAINTENANCE alerts for this asset so the next cycle can fire fresh
      await prisma.assetAlert.deleteMany({ where: { entityId: req.params.id, alertType: 'MAINTENANCE' } });
    }

    res.status(201).json(record);
  } catch (err) { next(err); }
});

// GET /assets/:id/maintenance
router.get('/assets/:id/maintenance', authenticate, async (req, res, next) => {
  try {
    const rows = await prisma.assetMaintenance.findMany({
      where: { assetId: req.params.id },
      orderBy: { scheduledAt: 'desc' },
    });
    res.json(rows);
  } catch (err) { next(err); }
});

// ── SOFTWARE LICENCES ─────────────────────────────────────────────────────────

// GET /licences
router.get('/licences', authenticate, async (req, res, next) => {
  try {
    const { active = 'true', expiringWithin } = req.query;
    const where = {};
    if (active === 'true') where.isActive = true;
    if (expiringWithin) {
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + parseInt(expiringWithin, 10));
      where.expiryDate = { not: null, lte: horizon };
    }
    const rows = await prisma.softwareLicence.findMany({ where, orderBy: { expiryDate: 'asc' } });
    res.json(rows.map(l => ({
      ...l,
      seatsRemaining: Math.max(0, (l.seatsTotal || 0) - (l.seatsUsed || 0)),
      daysUntilExpiry: l.expiryDate ? daysUntil(l.expiryDate) : null,
      urgency: classifyUrgency(l.expiryDate ? daysUntil(l.expiryDate) : null),
    })));
  } catch (err) { next(err); }
});

// GET /licences/expiring-soon
router.get('/licences/expiring-soon', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const withinDays = parseInt(req.query.withinDays || 60, 10);
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + withinDays);
    const rows = await prisma.softwareLicence.findMany({
      where: { isActive: true, expiryDate: { not: null, lte: horizon, gte: new Date() } },
      orderBy: { expiryDate: 'asc' },
    });
    res.json(rows.map(l => ({
      ...l, daysUntilExpiry: daysUntil(l.expiryDate), urgency: classifyUrgency(daysUntil(l.expiryDate)),
    })));
  } catch (err) { next(err); }
});

// POST /licences
router.post('/licences', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { name, vendor, licenceKey, seatsTotal, seatsUsed, expiryDate, renewalCost, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const lic = await prisma.softwareLicence.create({
      data: {
        id: uuidv4(),
        name,
        vendor: vendor || null,
        licenceKey: licenceKey || null,
        seatsTotal: parseInt(seatsTotal, 10) || 1,
        seatsUsed: parseInt(seatsUsed, 10) || 0,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        renewalCost: parseFloat(renewalCost) || 0,
        notes: notes || null,
      },
    });
    res.status(201).json(lic);
  } catch (err) { next(err); }
});

// PUT /licences/:id
router.put('/licences/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const b = req.body;
    const data = {};
    if (b.name !== undefined) data.name = b.name;
    if (b.vendor !== undefined) data.vendor = b.vendor || null;
    if (b.licenceKey !== undefined) data.licenceKey = b.licenceKey || null;
    if (b.seatsTotal !== undefined) data.seatsTotal = parseInt(b.seatsTotal, 10) || 0;
    if (b.seatsUsed !== undefined) data.seatsUsed = parseInt(b.seatsUsed, 10) || 0;
    if (b.expiryDate !== undefined) data.expiryDate = b.expiryDate ? new Date(b.expiryDate) : null;
    if (b.renewalCost !== undefined) data.renewalCost = parseFloat(b.renewalCost) || 0;
    if (b.notes !== undefined) data.notes = b.notes || null;
    if (b.isActive !== undefined) data.isActive = !!b.isActive;

    if (data.seatsTotal != null && data.seatsUsed != null && data.seatsUsed > data.seatsTotal) {
      return res.status(400).json({ error: 'seatsUsed cannot exceed seatsTotal' });
    }
    const updated = await prisma.softwareLicence.update({ where: { id: req.params.id }, data });
    if (updated.expiryDate) {
      await prisma.assetAlert.deleteMany({ where: { entityId: updated.id, alertType: 'LICENCE' } });
    }
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Licence not found' });
    next(err);
  }
});

// DELETE /licences/:id
router.delete('/licences/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    await prisma.softwareLicence.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Licence deactivated' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Licence not found' });
    next(err);
  }
});

// ── ALERT SWEEP & DASHBOARD ───────────────────────────────────────────────────

/**
 * Single sweep iteration. Idempotent — AssetAlert table dedupes via the
 * (entityId, alertType, threshold) unique constraint.
 */
async function runAlertSweep(now = new Date()) {
  const stats = { warranty: 0, maintenance: 0, return: 0, licence: 0, scanned: 0 };

  // 1) WARRANTY — active assets with warrantyExpiry within max threshold
  const maxWarranty = Math.max(...THRESHOLDS.WARRANTY);
  const wHorizon = new Date(now.getTime() + maxWarranty * 86400000);
  const warrantyCandidates = await prisma.asset.findMany({
    where: { status: { not: 'RETIRED' }, warrantyExpiry: { not: null, lte: wHorizon } },
  });
  for (const a of warrantyCandidates) {
    stats.scanned++;
    const d = daysUntil(a.warrantyExpiry, now);
    if (d == null || d < -7) continue;
    const fired = await prisma.assetAlert.findMany({
      where: { entityId: a.id, alertType: 'WARRANTY' }, select: { threshold: true },
    });
    const due = pendingThresholds(d, 'WARRANTY', fired.map(f => f.threshold));
    for (const t of due) {
      try {
        await prisma.assetAlert.create({
          data: {
            id: uuidv4(), tenantId: a.tenantId, entityId: a.id, alertType: 'WARRANTY', threshold: t,
            daysUntil: d, message: formatAlertMessage('WARRANTY', `${a.assetCode} ${a.name}`, d),
          },
        });
        stats.warranty++;
      } catch (e) { if (e.code !== 'P2002') throw e; }
    }
  }

  // 2) MAINTENANCE
  const maxMaint = Math.max(...THRESHOLDS.MAINTENANCE);
  const mHorizon = new Date(now.getTime() + maxMaint * 86400000);
  const maintCandidates = await prisma.asset.findMany({
    where: { status: { not: 'RETIRED' }, nextMaintenanceAt: { not: null, lte: mHorizon } },
  });
  for (const a of maintCandidates) {
    stats.scanned++;
    const d = daysUntil(a.nextMaintenanceAt, now);
    if (d == null || d < -7) continue;
    const fired = await prisma.assetAlert.findMany({
      where: { entityId: a.id, alertType: 'MAINTENANCE' }, select: { threshold: true },
    });
    const due = pendingThresholds(d, 'MAINTENANCE', fired.map(f => f.threshold));
    for (const t of due) {
      try {
        await prisma.assetAlert.create({
          data: {
            id: uuidv4(), tenantId: a.tenantId, entityId: a.id, alertType: 'MAINTENANCE', threshold: t,
            daysUntil: d, message: formatAlertMessage('MAINTENANCE', `${a.assetCode} ${a.name}`, d),
          },
        });
        stats.maintenance++;
      } catch (e) { if (e.code !== 'P2002') throw e; }
    }
  }

  // 3) RETURN — active assignments with offboardingDate OR asset.contractEndDate
  const maxReturn = Math.max(...THRESHOLDS.RETURN);
  const rHorizon = new Date(now.getTime() + maxReturn * 86400000);
  const activeAssignments = await prisma.assetAssignment.findMany({
    where: { isActive: true, offboardingDate: { not: null, lte: rHorizon } },
    include: { asset: true },
  });
  for (const a of activeAssignments) {
    stats.scanned++;
    const d = daysUntil(a.offboardingDate, now);
    if (d == null || d < -7) continue;
    const fired = await prisma.assetAlert.findMany({
      where: { entityId: a.id, alertType: 'RETURN' }, select: { threshold: true },
    });
    const due = pendingThresholds(d, 'RETURN', fired.map(f => f.threshold));
    for (const t of due) {
      try {
        await prisma.assetAlert.create({
          data: {
            id: uuidv4(), tenantId: a.tenantId, entityId: a.id, alertType: 'RETURN', threshold: t,
            daysUntil: d, message: formatAlertMessage('RETURN', `${a.asset?.assetCode || ''} (emp ${a.employeeId})`, d),
          },
        });
        stats.return++;
      } catch (e) { if (e.code !== 'P2002') throw e; }
    }
  }

  // 4) LICENCE
  const maxLic = Math.max(...THRESHOLDS.LICENCE);
  const lHorizon = new Date(now.getTime() + maxLic * 86400000);
  const licences = await prisma.softwareLicence.findMany({
    where: { isActive: true, expiryDate: { not: null, lte: lHorizon } },
  });
  for (const l of licences) {
    stats.scanned++;
    const d = daysUntil(l.expiryDate, now);
    if (d == null || d < -7) continue;
    const fired = await prisma.assetAlert.findMany({
      where: { entityId: l.id, alertType: 'LICENCE' }, select: { threshold: true },
    });
    const due = pendingThresholds(d, 'LICENCE', fired.map(f => f.threshold));
    for (const t of due) {
      try {
        await prisma.assetAlert.create({
          data: {
            id: uuidv4(), tenantId: l.tenantId, entityId: l.id, alertType: 'LICENCE', threshold: t,
            daysUntil: d, message: formatAlertMessage('LICENCE', `${l.name} (${l.seatsUsed}/${l.seatsTotal})`, d),
          },
        });
        stats.licence++;
      } catch (e) { if (e.code !== 'P2002') throw e; }
    }
  }

  return { sweptAt: now.toISOString(), ...stats };
}

// POST /assets/alerts/sweep — manual trigger
router.post('/assets/alerts/sweep', authenticate, authorize(...ADMIN_ROLES), async (_req, res, next) => {
  try {
    const result = await runAlertSweep(new Date());
    res.json(result);
  } catch (err) { next(err); }
});

// GET /assets/alerts — dashboard list
router.get('/assets/alerts', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { alertType, sinceDays } = req.query;
    const where = {};
    if (alertType) where.alertType = alertType.toUpperCase();
    if (sinceDays) {
      const since = new Date();
      since.setDate(since.getDate() - parseInt(sinceDays, 10));
      where.firedAt = { gte: since };
    }
    const rows = await prisma.assetAlert.findMany({ where, orderBy: [{ firedAt: 'desc' }] });
    const summary = rows.reduce((acc, a) => {
      acc[a.alertType] = (acc[a.alertType] || 0) + 1;
      return acc;
    }, {});
    res.json({ total: rows.length, summary, alerts: rows });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.runAlertSweep = runAlertSweep;
