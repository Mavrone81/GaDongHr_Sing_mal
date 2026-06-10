'use strict';
/**
 * Benefits-in-Kind & Stock Option routes (IRAS Appendix 8A & 8B).
 *
 * Endpoints:
 *   BIK items (Appendix 8A):
 *     POST   /bik-items                       create/upsert BIK item
 *     GET    /bik-items?year=YYYY&employeeId  list
 *     GET    /bik-items/:id                   detail
 *     PUT    /bik-items/:id                   update (recomputes annualValue)
 *     DELETE /bik-items/:id                   delete
 *
 *   Stock options (Appendix 8B):
 *     POST   /stock-options                   create grant
 *     GET    /stock-options?employeeId        list grants (with exercises)
 *     PUT    /stock-options/:id               update grant
 *     DELETE /stock-options/:id               delete grant (cascades exercises)
 *     POST   /stock-options/:id/exercises     record an exercise event
 *     DELETE /stock-options/:grantId/exercises/:exId  delete an exercise
 *
 *   Annual aggregations:
 *     GET    /appendix-8a/:year               JSON per-employee BIK totals
 *     GET    /appendix-8a-file/:year          IRAS-format flat-file
 *     GET    /appendix-8b/:year               JSON per-employee stock-option gains
 *     GET    /appendix-8b-file/:year          IRAS-format flat-file
 */
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { encrypt, decrypt } = require('/app/shared/crypto');
const { computeBikAnnualValue, computeStockOptionGain } = require('../engines/bik.engine');

const prisma = require('../utils/prisma');

const decSafe = (enc) => { try { return enc ? parseFloat(decrypt(enc)) || 0 : 0; } catch { return 0; } };
const BIK_TYPES = ['COMPANY_CAR', 'HOUSING', 'CLUB_MEMBERSHIP', 'GROUP_INSURANCE', 'OTHER'];
const WRITE_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER];
const READ_ROLES  = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER];

// ───── BIK Items (Appendix 8A) ─────────────────────────────────────────────────

router.post('/bik-items', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    const { employeeId, year, bikType, description } = req.body || {};
    if (!employeeId || !year || !bikType) {
      return res.status(400).json({ error: 'employeeId, year, bikType are required' });
    }
    if (!BIK_TYPES.includes(bikType)) {
      return res.status(400).json({ error: `bikType must be one of: ${BIK_TYPES.join(', ')}` });
    }

    const computationMethod = req.body.computationMethod || 'IRAS_FORMULA';
    const annualValue = computationMethod === 'MANUAL'
      ? Number(req.body.annualValue) || 0
      : computeBikAnnualValue({
          bikType,
          engineCapacity: Number(req.body.engineCapacity) || 0,
          carPurchaseCost: Number(req.body.carPurchaseCost) || 0,
          employerProvidesFuel: !!req.body.employerProvidesFuel,
          runningCost: Number(req.body.runningCost) || 0,
          housingAnnualValue: Number(req.body.housingAnnualValue) || 0,
          employeeContribution: Number(req.body.employeeContribution) || 0,
          annualValue: Number(req.body.annualValue) || 0,
        });

    const data = {
      employeeId, year: parseInt(year, 10), bikType, description: description || null,
      engineCapacity: req.body.engineCapacity ? parseInt(req.body.engineCapacity, 10) : null,
      carPurchaseCost: req.body.carPurchaseCost != null ? Number(req.body.carPurchaseCost) : null,
      employerProvidesFuel: !!req.body.employerProvidesFuel,
      runningCost: req.body.runningCost != null ? Number(req.body.runningCost) : null,
      housingAnnualValue: req.body.housingAnnualValue != null ? Number(req.body.housingAnnualValue) : null,
      annualValueEnc: encrypt(String(annualValue)),
      computationMethod,
      notes: req.body.notes || null,
    };

    const existing = await prisma.bikItem.findUnique({
      where: { employeeId_year_bikType: { employeeId, year: data.year, bikType } },
    });
    const item = existing
      ? await prisma.bikItem.update({ where: { id: existing.id }, data })
      : await prisma.bikItem.create({ data });

    res.status(existing ? 200 : 201).json({ ...item, annualValue });
  } catch (err) { next(err); }
});

router.get('/bik-items', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.year) where.year = parseInt(req.query.year, 10);
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.bikType) where.bikType = req.query.bikType;

    const items = await prisma.bikItem.findMany({ where, orderBy: [{ year: 'desc' }, { employeeId: 'asc' }] });
    const out = items.map(i => ({ ...i, annualValue: decSafe(i.annualValueEnc) }));
    res.json({ count: out.length, items: out });
  } catch (err) { next(err); }
});

router.get('/bik-items/:id', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const item = await prisma.bikItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ ...item, annualValue: decSafe(item.annualValueEnc) });
  } catch (err) { next(err); }
});

router.put('/bik-items/:id', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.bikItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const computationMethod = req.body.computationMethod || existing.computationMethod;
    const annualValue = computationMethod === 'MANUAL'
      ? (req.body.annualValue != null ? Number(req.body.annualValue) : decSafe(existing.annualValueEnc))
      : computeBikAnnualValue({
          bikType: req.body.bikType || existing.bikType,
          engineCapacity: req.body.engineCapacity != null ? Number(req.body.engineCapacity) : existing.engineCapacity,
          carPurchaseCost: req.body.carPurchaseCost != null ? Number(req.body.carPurchaseCost) : existing.carPurchaseCost,
          employerProvidesFuel: req.body.employerProvidesFuel != null ? !!req.body.employerProvidesFuel : existing.employerProvidesFuel,
          runningCost: req.body.runningCost != null ? Number(req.body.runningCost) : existing.runningCost,
          housingAnnualValue: req.body.housingAnnualValue != null ? Number(req.body.housingAnnualValue) : existing.housingAnnualValue,
          employeeContribution: Number(req.body.employeeContribution) || 0,
          annualValue: req.body.annualValue != null ? Number(req.body.annualValue) : 0,
        });

    const data = {
      description: req.body.description ?? existing.description,
      engineCapacity: req.body.engineCapacity != null ? parseInt(req.body.engineCapacity, 10) : existing.engineCapacity,
      carPurchaseCost: req.body.carPurchaseCost != null ? Number(req.body.carPurchaseCost) : existing.carPurchaseCost,
      employerProvidesFuel: req.body.employerProvidesFuel != null ? !!req.body.employerProvidesFuel : existing.employerProvidesFuel,
      runningCost: req.body.runningCost != null ? Number(req.body.runningCost) : existing.runningCost,
      housingAnnualValue: req.body.housingAnnualValue != null ? Number(req.body.housingAnnualValue) : existing.housingAnnualValue,
      annualValueEnc: encrypt(String(annualValue)),
      computationMethod,
      notes: req.body.notes ?? existing.notes,
    };
    const updated = await prisma.bikItem.update({ where: { id: existing.id }, data });
    res.json({ ...updated, annualValue });
  } catch (err) { next(err); }
});

router.delete('/bik-items/:id', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    await prisma.bikItem.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

// ───── Stock Options (Appendix 8B) ────────────────────────────────────────────

router.post('/stock-options', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    const { employeeId, grantDate, totalShares, optionPrice, scheme, notes } = req.body || {};
    if (!employeeId || !grantDate || totalShares == null || optionPrice == null) {
      return res.status(400).json({ error: 'employeeId, grantDate, totalShares, optionPrice are required' });
    }
    const grant = await prisma.stockOptionGrant.create({
      data: {
        employeeId,
        grantDate: new Date(grantDate),
        totalShares: parseInt(totalShares, 10),
        optionPrice: Number(optionPrice),
        scheme: scheme || 'ESOP',
        notes: notes || null,
      },
    });
    res.status(201).json(grant);
  } catch (err) { next(err); }
});

router.get('/stock-options', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    const grants = await prisma.stockOptionGrant.findMany({
      where,
      include: { exercises: { orderBy: { exerciseDate: 'asc' } } },
      orderBy: { grantDate: 'desc' },
    });
    const out = grants.map(g => ({
      ...g,
      exercises: g.exercises.map(e => ({ ...e, taxableGain: decSafe(e.taxableGainEnc) })),
    }));
    res.json({ count: out.length, grants: out });
  } catch (err) { next(err); }
});

router.put('/stock-options/:id', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    const data = {};
    if (req.body.totalShares != null) data.totalShares = parseInt(req.body.totalShares, 10);
    if (req.body.optionPrice != null) data.optionPrice = Number(req.body.optionPrice);
    if (req.body.scheme) data.scheme = req.body.scheme;
    if (req.body.grantDate) data.grantDate = new Date(req.body.grantDate);
    if (req.body.notes !== undefined) data.notes = req.body.notes;
    const grant = await prisma.stockOptionGrant.update({ where: { id: req.params.id }, data });
    res.json(grant);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

router.delete('/stock-options/:id', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    await prisma.stockOptionGrant.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

router.post('/stock-options/:id/exercises', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    const grant = await prisma.stockOptionGrant.findUnique({ where: { id: req.params.id } });
    if (!grant) return res.status(404).json({ error: 'Grant not found' });

    const { exerciseDate, sharesExercised, marketValueAtExercise, notes } = req.body || {};
    if (!exerciseDate || sharesExercised == null || marketValueAtExercise == null) {
      return res.status(400).json({ error: 'exerciseDate, sharesExercised, marketValueAtExercise are required' });
    }

    const taxableGain = computeStockOptionGain({
      marketValueAtExercise: Number(marketValueAtExercise),
      optionPrice: grant.optionPrice,
      sharesExercised: parseInt(sharesExercised, 10),
    });

    const ex = await prisma.stockOptionExercise.create({
      data: {
        grantId: grant.id,
        exerciseDate: new Date(exerciseDate),
        sharesExercised: parseInt(sharesExercised, 10),
        marketValueAtExercise: Number(marketValueAtExercise),
        taxableGainEnc: encrypt(String(taxableGain)),
        notes: notes || null,
      },
    });
    res.status(201).json({ ...ex, taxableGain });
  } catch (err) { next(err); }
});

router.delete('/stock-options/:grantId/exercises/:exId', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    await prisma.stockOptionExercise.delete({ where: { id: req.params.exId } });
    res.json({ deleted: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

// ───── Appendix 8A — annual BIK aggregation ──────────────────────────────────

router.get('/appendix-8a/:year', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const year = parseInt(req.params.year, 10);
    const items = await prisma.bikItem.findMany({ where: { year } });

    const byEmp = {};
    for (const it of items) {
      const amt = decSafe(it.annualValueEnc);
      const e = byEmp[it.employeeId] ||= { employeeId: it.employeeId, totalBik: 0, byType: {} };
      e.byType[it.bikType] = (e.byType[it.bikType] || 0) + amt;
      e.totalBik = Math.round((e.totalBik + amt) * 100) / 100;
    }
    const records = Object.values(byEmp);
    res.json({ year, generatedAt: new Date().toISOString(), count: records.length, records });
  } catch (err) { next(err); }
});

router.get('/appendix-8a-file/:year', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const year = parseInt(req.params.year, 10);
    const UEN = process.env.COMPANY_UEN || 'UNKNOWN';
    const items = await prisma.bikItem.findMany({ where: { year }, orderBy: { employeeId: 'asc' } });

    const lines = [`APPENDIX_8A|${year}|${UEN}`];
    for (const it of items) {
      const amt = Math.round(decSafe(it.annualValueEnc) * 100) / 100;
      lines.push([it.employeeId, it.bikType, amt, (it.description || '').replace(/\|/g, ' ')].join('|'));
    }
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=Appendix-8A-${year}.txt`);
    res.send(lines.join('\n'));
  } catch (err) { next(err); }
});

// ───── Appendix 8B — annual stock option gains ────────────────────────────────

router.get('/appendix-8b/:year', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const year = parseInt(req.params.year, 10);
    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end   = new Date(`${year + 1}-01-01T00:00:00Z`);
    const exercises = await prisma.stockOptionExercise.findMany({
      where: { exerciseDate: { gte: start, lt: end } },
      include: { grant: true },
    });

    const byEmp = {};
    const records = [];
    for (const e of exercises) {
      const gain = decSafe(e.taxableGainEnc);
      records.push({
        employeeId: e.grant.employeeId,
        grantDate: e.grant.grantDate,
        exerciseDate: e.exerciseDate,
        sharesExercised: e.sharesExercised,
        optionPrice: e.grant.optionPrice,
        marketValueAtExercise: e.marketValueAtExercise,
        taxableGain: gain,
        scheme: e.grant.scheme,
      });
      byEmp[e.grant.employeeId] = (byEmp[e.grant.employeeId] || 0) + gain;
    }
    const totals = Object.entries(byEmp).map(([employeeId, totalGain]) => ({
      employeeId, totalGain: Math.round(totalGain * 100) / 100,
    }));
    res.json({ year, generatedAt: new Date().toISOString(), exercises: records, totals });
  } catch (err) { next(err); }
});

router.get('/appendix-8b-file/:year', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const year = parseInt(req.params.year, 10);
    const UEN = process.env.COMPANY_UEN || 'UNKNOWN';
    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end   = new Date(`${year + 1}-01-01T00:00:00Z`);
    const exercises = await prisma.stockOptionExercise.findMany({
      where: { exerciseDate: { gte: start, lt: end } },
      include: { grant: true },
      orderBy: [{ grant: { employeeId: 'asc' } }, { exerciseDate: 'asc' }],
    });

    const lines = [`APPENDIX_8B|${year}|${UEN}`];
    for (const e of exercises) {
      const gain = Math.round(decSafe(e.taxableGainEnc) * 100) / 100;
      lines.push([
        e.grant.employeeId,
        e.grant.grantDate.toISOString().slice(0, 10),
        e.exerciseDate.toISOString().slice(0, 10),
        e.sharesExercised,
        e.grant.optionPrice,
        e.marketValueAtExercise,
        gain,
        e.grant.scheme,
      ].join('|'));
    }
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=Appendix-8B-${year}.txt`);
    res.send(lines.join('\n'));
  } catch (err) { next(err); }
});

module.exports = router;
