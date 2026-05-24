'use strict';
/**
 * Year-end carry-forward + expiry routes (LEA-007).
 *
 * Endpoints:
 *   POST /year-end/preview       — preview without committing
 *   POST /year-end/process       — run year-end carry-forward (writes)
 *   POST /year-end/expire        — manually trigger expiry sweep (writes)
 *   GET  /year-end/expiring      — list entitlements expiring soon
 */

const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const {
  computeCarryForward, resolveExpiry, evaluateExpiry, defaultExpiryFor,
} = require('../engines/year-end.engine');

const prisma = new PrismaClient();

const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN];

/**
 * Core year-end runner. Used by both /preview (commit=false) and /process (commit=true).
 * Returns { year, targetYear, processed, totals, items }.
 */
async function runYearEnd({ year, targetYear, leaveTypeCodes, expiryDate, commit }) {
  // Resolve leave types — only those with carry-forward enabled (maxCarryForward != 0) by default.
  // Caller may pass an explicit subset by code.
  const ltWhere = { isActive: true };
  if (Array.isArray(leaveTypeCodes) && leaveTypeCodes.length > 0) {
    ltWhere.code = { in: leaveTypeCodes };
  }
  const leaveTypes = await prisma.leaveType.findMany({ where: ltWhere });
  if (leaveTypes.length === 0) {
    return { year, targetYear, processed: 0, items: [], totals: { carriedForward: 0, forfeited: 0 }, leaveTypes: 0 };
  }
  const ltById = Object.fromEntries(leaveTypes.map(lt => [lt.id, lt]));

  const prevEntitlements = await prisma.leaveEntitlement.findMany({
    where: { year, leaveTypeId: { in: leaveTypes.map(lt => lt.id) } },
  });

  const items = [];
  let totalCarried = 0, totalForfeited = 0;

  for (const prev of prevEntitlements) {
    const lt = ltById[prev.leaveTypeId];
    if (!lt) continue;
    const result = computeCarryForward(prev, lt);
    const expiry = resolveExpiry(targetYear, expiryDate);

    items.push({
      employeeId: prev.employeeId,
      leaveTypeId: prev.leaveTypeId,
      leaveTypeCode: lt.code,
      sourceYear: year,
      targetYear,
      unusedBalance: result.unusedBalance,
      carriedForward: result.carriedForward,
      forfeited: result.forfeited,
      expiryDate: expiry,
    });
    totalCarried += result.carriedForward;
    totalForfeited += result.forfeited;
  }

  if (commit) {
    // Upsert next-year entitlements with carry-forward.
    // Default entitledDays for next year is leaveType.annualEntitlement; HR can
    // override later via the entitlement set endpoint.
    const ops = items.map(it => prisma.leaveEntitlement.upsert({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: it.employeeId,
          leaveTypeId: it.leaveTypeId,
          year: it.targetYear,
        },
      },
      create: {
        employeeId: it.employeeId,
        leaveTypeId: it.leaveTypeId,
        year: it.targetYear,
        entitledDays: (ltById[it.leaveTypeId]?.annualEntitlement || 0),
        carryForward: it.carriedForward,
        carryForwardExpiry: it.expiryDate,
      },
      update: {
        carryForward: it.carriedForward,
        carryForwardExpiry: it.expiryDate,
      },
    }));
    if (ops.length > 0) await prisma.$transaction(ops);
  }

  return {
    year, targetYear,
    processed: items.length,
    items,
    totals: {
      carriedForward: Math.round(totalCarried * 100) / 100,
      forfeited: Math.round(totalForfeited * 100) / 100,
    },
    leaveTypes: leaveTypes.length,
    committed: !!commit,
  };
}

router.post('/year-end/preview', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const year = parseInt(req.body.year, 10);
    if (!year) return res.status(400).json({ error: 'year is required (the source year, e.g. 2026)' });
    const targetYear = parseInt(req.body.targetYear || (year + 1), 10);
    const out = await runYearEnd({
      year, targetYear,
      leaveTypeCodes: req.body.leaveTypeCodes,
      expiryDate: req.body.expiryDate,
      commit: false,
    });
    res.json(out);
  } catch (err) { next(err); }
});

router.post('/year-end/process', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const year = parseInt(req.body.year, 10);
    if (!year) return res.status(400).json({ error: 'year is required (the source year, e.g. 2026)' });
    const targetYear = parseInt(req.body.targetYear || (year + 1), 10);
    const out = await runYearEnd({
      year, targetYear,
      leaveTypeCodes: req.body.leaveTypeCodes,
      expiryDate: req.body.expiryDate,
      commit: true,
    });
    res.json(out);
  } catch (err) { next(err); }
});

/**
 * Core expiry sweep. Used by /expire endpoint and by the daily scheduler.
 * Returns { swept, totalExpired, items }.
 */
async function runExpirySweep(now = new Date()) {
  const dueEntitlements = await prisma.leaveEntitlement.findMany({
    where: {
      carryForward: { gt: 0 },
      carryForwardExpiry: { lte: now, not: null },
    },
  });
  const items = [];
  let totalExpired = 0;
  const ops = [];
  for (const e of dueEntitlements) {
    const ev = evaluateExpiry(e, now);
    if (!ev.shouldExpire) continue;
    items.push({
      entitlementId: e.id,
      employeeId: e.employeeId,
      leaveTypeId: e.leaveTypeId,
      year: e.year,
      expiredAmount: ev.expiredAmount,
      carryForwardExpiry: e.carryForwardExpiry,
    });
    totalExpired += ev.expiredAmount;
    ops.push(prisma.leaveEntitlement.update({
      where: { id: e.id },
      data: {
        carryForward: 0,
        expiredDays: ev.newExpiredDays,
      },
    }));
  }
  if (ops.length > 0) await prisma.$transaction(ops);
  return {
    sweptAt: now.toISOString(),
    swept: items.length,
    totalExpired: Math.round(totalExpired * 100) / 100,
    items,
  };
}

router.post('/year-end/expire', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const out = await runExpirySweep(new Date());
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/year-end/expiring', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const withinDays = Math.max(1, Math.min(365, parseInt(req.query.withinDays, 10) || 30));
    const now = new Date();
    const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
    const entitlements = await prisma.leaveEntitlement.findMany({
      where: {
        carryForward: { gt: 0 },
        carryForwardExpiry: { not: null, lte: horizon, gte: now },
      },
      include: { leaveType: true },
      orderBy: { carryForwardExpiry: 'asc' },
    });
    res.json({
      withinDays,
      count: entitlements.length,
      entitlements: entitlements.map(e => ({
        id: e.id, employeeId: e.employeeId,
        leaveTypeCode: e.leaveType.code, leaveTypeName: e.leaveType.name,
        year: e.year, carryForward: e.carryForward, carryForwardExpiry: e.carryForwardExpiry,
        daysUntilExpiry: Math.ceil((new Date(e.carryForwardExpiry) - now) / (24 * 60 * 60 * 1000)),
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.runExpirySweep = runExpirySweep;
module.exports.defaultExpiryFor = defaultExpiryFor;
