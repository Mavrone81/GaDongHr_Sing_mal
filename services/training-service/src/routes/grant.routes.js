'use strict';
/**
 * TRN-003 — SSG / SkillsFuture / SFEC / Absentee Payroll routes.
 *
 * Endpoints exposed under /training:
 *   PUT  /programs/:id/grant-config
 *   PUT  /enrollments/:id/training-hours
 *   POST /grants/ap/compute
 *   GET  /grants/ap/export
 *   GET  /grants/ets/report
 *   GET  /sfc/balance/:employeeId
 *   PUT  /sfc/balance/:employeeId
 *   POST /sfc/declarations
 *   GET  /sfec/balance
 *   PUT  /sfec/balance
 *   POST /sfec/claims
 *   GET  /grant-claims
 *   GET  /grant-claims/:id
 *   PUT  /grant-claims/:id
 *   GET  /grants/summary
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const {
  AP_DEFAULT_RATE,
  SFEC_DEFAULT_TOTAL,
  computeApAmount,
  computeEtsGrant,
  computeSfecCoverage,
  validateSfcDeclaration,
  formatSsgApExport,
} = require('../engines/grant.engine');

const prisma = require('../utils/prisma');
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER];
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ── PUT /training/programs/:id/grant-config ──────────────────────────────────
router.put('/programs/:id/grant-config', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { isSsgFunded, ssgCourseCode, etsEligible, sfecEligible, apHourlyRate, courseFee, grantPercentage } = req.body;
    const data = {};
    if (isSsgFunded !== undefined) data.isSsgFunded = !!isSsgFunded;
    if (ssgCourseCode !== undefined) data.ssgCourseCode = ssgCourseCode || null;
    if (etsEligible !== undefined) data.etsEligible = !!etsEligible;
    if (sfecEligible !== undefined) data.sfecEligible = !!sfecEligible;
    if (apHourlyRate !== undefined) {
      const r = parseFloat(apHourlyRate);
      if (!isFinite(r) || r < 0) return res.status(400).json({ error: 'apHourlyRate must be a non-negative number' });
      data.apHourlyRate = r;
    }
    if (courseFee !== undefined) {
      const f = parseFloat(courseFee);
      if (!isFinite(f) || f < 0) return res.status(400).json({ error: 'courseFee must be a non-negative number' });
      data.courseFee = f;
    }
    if (grantPercentage !== undefined) {
      const p = parseFloat(grantPercentage);
      if (!isFinite(p) || p < 0 || p > 1) return res.status(400).json({ error: 'grantPercentage must be between 0 and 1' });
      data.grantPercentage = p;
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'No grant-config fields supplied' });

    const program = await prisma.trainingProgram.update({ where: { id: req.params.id }, data });
    res.json(program);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Program not found' });
    next(err);
  }
});

// ── PUT /training/enrollments/:id/training-hours ──────────────────────────────
// Records actual training hours + attendance date. Recomputes apComputedAmount
// using the program's apHourlyRate (or default).
router.put('/enrollments/:id/training-hours', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { trainingHours, attendanceDate } = req.body;
    const enrollment = await prisma.trainingEnrollment.findUnique({
      where: { id: req.params.id },
      include: { program: true },
    });
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

    const hrs = parseFloat(trainingHours);
    if (!isFinite(hrs) || hrs < 0) return res.status(400).json({ error: 'trainingHours must be a non-negative number' });

    const rate = enrollment.program?.apHourlyRate ?? AP_DEFAULT_RATE;
    const apAmount = enrollment.program?.isSsgFunded ? computeApAmount(hrs, rate) : 0;

    const updated = await prisma.trainingEnrollment.update({
      where: { id: req.params.id },
      data: {
        trainingHours: hrs,
        attendanceDate: attendanceDate ? new Date(attendanceDate) : new Date(),
        apComputedAmount: apAmount,
      },
    });
    res.json({ ...updated, computedApAmount: apAmount, hourlyRateUsed: rate });
  } catch (err) { next(err); }
});

// ── POST /training/grants/ap/compute ──────────────────────────────────────────
// Materialises GrantClaim rows of type AP for all completed SSG-funded
// enrollments in the period that don't already have an AP claim. Idempotent.
router.post('/grants/ap/compute', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const period = req.body?.period || req.query.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' });

    const [y, m] = period.split('-').map(n => parseInt(n, 10));
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end   = new Date(Date.UTC(y, m, 1));

    const candidates = await prisma.trainingEnrollment.findMany({
      where: {
        status: 'COMPLETED',
        trainingHours: { gt: 0 },
        attendanceDate: { gte: start, lt: end },
        program: { isSsgFunded: true },
      },
      include: { program: true },
    });

    const existing = await prisma.grantClaim.findMany({
      where: { claimType: 'AP', enrollmentId: { in: candidates.map(c => c.id) } },
      select: { enrollmentId: true },
    });
    const claimed = new Set(existing.map(e => e.enrollmentId));

    const userId = req.user?.sub || 'system';
    const created = [];
    for (const c of candidates) {
      if (claimed.has(c.id)) continue;
      const rate = c.program?.apHourlyRate ?? AP_DEFAULT_RATE;
      const amt = computeApAmount(c.trainingHours, rate);
      if (amt <= 0) continue;
      const claim = await prisma.grantClaim.create({
        data: {
          id: uuidv4(),
          enrollmentId: c.id,
          programId: c.programId,
          employeeId: c.employeeId,
          claimType: 'AP',
          claimAmount: amt,
          status: 'PENDING',
          notes: `AP: ${c.trainingHours}h × SGD ${rate}/h, period ${period}`,
          createdBy: userId,
        },
      });
      await prisma.trainingEnrollment.update({
        where: { id: c.id },
        data: { apClaimed: true, apComputedAmount: amt },
      });
      created.push(claim);
    }

    res.json({
      period,
      candidatesScanned: candidates.length,
      alreadyClaimed: claimed.size,
      created: created.length,
      totalAmount: round2(created.reduce((s, c) => s + c.claimAmount, 0)),
      claims: created,
    });
  } catch (err) { next(err); }
});

// ── GET /training/grants/ap/export ────────────────────────────────────────────
// SSG-format flat file for Absentee Payroll claim submission.
router.get('/grants/ap/export', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const period = req.query.period;
    if (!period || !/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' });
    const [y, m] = period.split('-').map(n => parseInt(n, 10));
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end   = new Date(Date.UTC(y, m, 0)); // last day of period
    const startStr = start.toISOString().slice(0, 10);
    const endStr   = end.toISOString().slice(0, 10);

    const claims = await prisma.grantClaim.findMany({
      where: { claimType: 'AP', createdAt: { gte: start, lt: new Date(Date.UTC(y, m, 1)) } },
      include: { program: { select: { ssgCourseCode: true, apHourlyRate: true } }, enrollment: true },
    });

    // Caller is expected to provide employee names + NRIC via x-employee-lookup
    // header (JSON map) or to look them up in employee-service downstream. We
    // emit what's known on the training side and let downstream enrich if needed.
    const lookupHeader = req.headers['x-employee-lookup'];
    let lookup = {};
    if (lookupHeader) { try { lookup = JSON.parse(lookupHeader); } catch {} }

    const rows = claims.map(c => ({
      nric: lookup[c.employeeId]?.nric || '',
      employeeName: lookup[c.employeeId]?.fullName || c.employeeId,
      ssgCourseCode: c.program?.ssgCourseCode || '',
      trainingHours: c.enrollment?.trainingHours || 0,
      hourlyRate: c.program?.apHourlyRate ?? AP_DEFAULT_RATE,
    }));

    const flatFile = formatSsgApExport(rows, startStr, endStr);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=SSG-AP-${period}.txt`);
    res.send(flatFile);
  } catch (err) { next(err); }
});

// ── GET /training/grants/ets/report ───────────────────────────────────────────
router.get('/grants/ets/report', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to dates required (YYYY-MM-DD)' });
    const start = new Date(from);
    const end   = new Date(to);
    if (isNaN(start) || isNaN(end)) return res.status(400).json({ error: 'Invalid from/to date' });

    const enrollments = await prisma.trainingEnrollment.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: start, lte: end },
        program: { isSsgFunded: true, etsEligible: true },
      },
      include: { program: true },
    });

    const rows = enrollments.map(e => {
      const fee = e.program?.courseFee || 0;
      const pct = e.program?.grantPercentage || 0;
      const grant = computeEtsGrant(fee, pct);
      return {
        enrollmentId: e.id,
        employeeId: e.employeeId,
        programId: e.programId,
        programTitle: e.program?.title,
        ssgCourseCode: e.program?.ssgCourseCode || null,
        courseFee: round2(fee),
        grantPercentage: pct,
        grantAmount: grant,
        completedAt: e.completedAt,
      };
    });

    res.json({
      from, to,
      generatedAt: new Date().toISOString(),
      total: rows.length,
      totalGrantClaimable: round2(rows.reduce((s, r) => s + r.grantAmount, 0)),
      rows,
    });
  } catch (err) { next(err); }
});

// ── GET /training/sfc/balance/:employeeId ─────────────────────────────────────
router.get('/sfc/balance/:employeeId', authenticate, async (req, res, next) => {
  try {
    const requesterEmpId = req.user.employeeId;
    const role = req.user?.role;
    const isAdmin = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER].includes(role);
    if (!isAdmin && requesterEmpId !== req.params.employeeId) {
      return res.status(403).json({ error: 'Cannot view another employee\'s SFC balance' });
    }
    const bal = await prisma.employeeSfcBalance.findFirst({ where: { employeeId: req.params.employeeId } });
    if (!bal) {
      return res.json({
        employeeId: req.params.employeeId,
        balanceAmount: 0, lifetimeReceived: 0, lifetimeUsed: 0,
        lastDeclaredAt: null,
        note: 'No SFC balance recorded — call PUT /training/sfc/balance/:employeeId to initialise.',
      });
    }
    res.json(bal);
  } catch (err) { next(err); }
});

// ── PUT /training/sfc/balance/:employeeId ─────────────────────────────────────
// Admin sets/updates the employee's SFC balance from MOE statement.
router.put('/sfc/balance/:employeeId', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { balanceAmount, lifetimeReceived } = req.body;
    const bal = parseFloat(balanceAmount);
    if (!isFinite(bal) || bal < 0) return res.status(400).json({ error: 'balanceAmount must be a non-negative number' });
    const lr = lifetimeReceived != null ? parseFloat(lifetimeReceived) : undefined;
    if (lr !== undefined && (!isFinite(lr) || lr < 0)) return res.status(400).json({ error: 'lifetimeReceived must be a non-negative number' });

    const upserted = await prisma.employeeSfcBalance.upsert({
      where: { employeeId: req.params.employeeId },
      update: { balanceAmount: bal, ...(lr !== undefined ? { lifetimeReceived: lr } : {}), updatedBy: req.user.sub },
      create: {
        id: uuidv4(),
        employeeId: req.params.employeeId,
        balanceAmount: bal,
        lifetimeReceived: lr ?? bal,
        lifetimeUsed: 0,
        updatedBy: req.user.sub,
      },
    });
    res.json(upserted);
  } catch (err) { next(err); }
});

// ── POST /training/sfc/declarations ───────────────────────────────────────────
// Employee (or admin on behalf) declares use of SFC for a specific enrollment.
// Decrements the running balance and records the declaration on the enrollment.
router.post('/sfc/declarations', authenticate, async (req, res, next) => {
  try {
    const { employeeId, enrollmentId, amount } = req.body;
    if (!employeeId || !enrollmentId || amount == null) {
      return res.status(400).json({ error: 'employeeId, enrollmentId, amount required' });
    }
    const requesterEmpId = req.user.employeeId;
    const role = req.user?.role;
    const isAdmin = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER].includes(role);
    if (!isAdmin && requesterEmpId !== employeeId) {
      return res.status(403).json({ error: 'Cannot declare SFC for another employee' });
    }

    const enrollment = await prisma.trainingEnrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    if (enrollment.employeeId !== employeeId) return res.status(400).json({ error: 'Enrollment does not belong to employee' });

    const bal = await prisma.employeeSfcBalance.findFirst({ where: { employeeId } });
    const currentBalance = bal?.balanceAmount || 0;
    const check = validateSfcDeclaration(amount, currentBalance);
    if (!check.ok) return res.status(400).json({ error: check.error, available: check.available, requested: check.requested });

    const userId = req.user.sub;
    const requested = round2(parseFloat(amount));
    const remaining = round2(currentBalance - requested);

    const [updatedBal, updatedEnrollment, claim] = await prisma.$transaction([
      prisma.employeeSfcBalance.upsert({
        where: { employeeId },
        update: {
          balanceAmount: remaining,
          lifetimeUsed: (bal?.lifetimeUsed || 0) + requested,
          lastDeclaredAt: new Date(),
          updatedBy: userId,
        },
        create: {
          id: uuidv4(),
          employeeId,
          balanceAmount: 0,
          lifetimeReceived: requested,
          lifetimeUsed: requested,
          lastDeclaredAt: new Date(),
          updatedBy: userId,
        },
      }),
      prisma.trainingEnrollment.update({
        where: { id: enrollmentId },
        data: { sfcDeclaredAmount: (enrollment.sfcDeclaredAmount || 0) + requested },
      }),
      prisma.grantClaim.create({
        data: {
          id: uuidv4(),
          enrollmentId,
          programId: enrollment.programId,
          employeeId,
          claimType: 'SFC',
          claimAmount: requested,
          status: 'APPROVED',
          notes: `Employee SFC declaration: SGD ${requested}`,
          createdBy: userId,
        },
      }),
    ]);

    res.json({
      message: 'SFC declaration recorded.',
      balance: updatedBal,
      enrollment: updatedEnrollment,
      claim,
    });
  } catch (err) { next(err); }
});

// ── GET /training/sfec/balance ────────────────────────────────────────────────
router.get('/sfec/balance', authenticate, authorize(...ADMIN_ROLES), async (_req, res, next) => {
  try {
    const ledger = await prisma.sfecLedger.findUnique({ where: { id: 'singleton' } });
    if (!ledger) {
      return res.json({
        id: 'singleton',
        totalCredit: SFEC_DEFAULT_TOTAL,
        usedAmount: 0,
        remainingAmount: SFEC_DEFAULT_TOTAL,
        initialised: false,
        note: 'SFEC ledger not initialised. Call PUT /training/sfec/balance to set total credit.',
      });
    }
    res.json({
      ...ledger,
      remainingAmount: round2((ledger.totalCredit || 0) - (ledger.usedAmount || 0)),
      initialised: true,
    });
  } catch (err) { next(err); }
});

// ── PUT /training/sfec/balance ────────────────────────────────────────────────
router.put('/sfec/balance', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { totalCredit, notes } = req.body;
    const t = parseFloat(totalCredit);
    if (!isFinite(t) || t < 0) return res.status(400).json({ error: 'totalCredit must be a non-negative number' });

    const ledger = await prisma.sfecLedger.upsert({
      where: { id: 'singleton' },
      update: { totalCredit: t, notes: notes || null, updatedBy: req.user.sub },
      create: { id: 'singleton', totalCredit: t, usedAmount: 0, notes: notes || null, updatedBy: req.user.sub },
    });
    res.json({ ...ledger, remainingAmount: round2(t - (ledger.usedAmount || 0)) });
  } catch (err) { next(err); }
});

// ── POST /training/sfec/claims ────────────────────────────────────────────────
// Records a SFEC claim against company OOP for a SFEC-eligible programme.
// Decrements the company ledger and creates a GrantClaim row.
router.post('/sfec/claims', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { programId, enrollmentId, employeeId, oopAmount, notes } = req.body;
    if (!programId || !employeeId || oopAmount == null) {
      return res.status(400).json({ error: 'programId, employeeId, oopAmount required' });
    }
    const oop = parseFloat(oopAmount);
    if (!isFinite(oop) || oop <= 0) return res.status(400).json({ error: 'oopAmount must be a positive number' });

    const program = await prisma.trainingProgram.findUnique({ where: { id: programId } });
    if (!program) return res.status(404).json({ error: 'Program not found' });
    if (!program.sfecEligible) return res.status(400).json({ error: 'Program is not SFEC-eligible' });

    const ledger = await prisma.sfecLedger.findUnique({ where: { id: 'singleton' } });
    if (!ledger) return res.status(409).json({ error: 'SFEC ledger not initialised. Call PUT /training/sfec/balance first.' });
    const remaining = round2((ledger.totalCredit || 0) - (ledger.usedAmount || 0));
    if (remaining <= 0) return res.status(409).json({ error: 'SFEC balance exhausted', remaining: 0 });

    const coverage = computeSfecCoverage(oop, remaining);
    if (coverage <= 0) return res.status(400).json({ error: 'No claimable coverage' });

    const userId = req.user.sub;
    const [updatedLedger, claim] = await prisma.$transaction([
      prisma.sfecLedger.update({
        where: { id: 'singleton' },
        data: { usedAmount: round2((ledger.usedAmount || 0) + coverage), updatedBy: userId },
      }),
      prisma.grantClaim.create({
        data: {
          id: uuidv4(),
          enrollmentId: enrollmentId || null,
          programId,
          employeeId,
          claimType: 'SFEC',
          claimAmount: coverage,
          status: 'APPROVED',
          notes: notes || `SFEC: 90% of SGD ${oop} OOP = SGD ${coverage}`,
          createdBy: userId,
        },
      }),
    ]);

    res.status(201).json({
      message: 'SFEC claim recorded.',
      claim,
      ledger: { ...updatedLedger, remainingAmount: round2(updatedLedger.totalCredit - updatedLedger.usedAmount) },
    });
  } catch (err) { next(err); }
});

// ── GET /training/grant-claims ────────────────────────────────────────────────
router.get('/grant-claims', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { claimType, status, employeeId, programId } = req.query;
    const where = {};
    if (claimType) where.claimType = claimType.toUpperCase();
    if (status) where.status = status.toUpperCase();
    if (employeeId) where.employeeId = employeeId;
    if (programId) where.programId = programId;

    const claims = await prisma.grantClaim.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { program: { select: { id: true, title: true, ssgCourseCode: true } } },
    });

    const totalsByType = claims.reduce((acc, c) => {
      acc[c.claimType] = round2((acc[c.claimType] || 0) + c.claimAmount);
      return acc;
    }, {});

    res.json({ total: claims.length, totalsByType, claims });
  } catch (err) { next(err); }
});

// ── GET /training/grant-claims/:id ────────────────────────────────────────────
router.get('/grant-claims/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const claim = await prisma.grantClaim.findUnique({
      where: { id: req.params.id },
      include: { program: true, enrollment: true },
    });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    res.json(claim);
  } catch (err) { next(err); }
});

// ── PUT /training/grant-claims/:id ────────────────────────────────────────────
router.put('/grant-claims/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { status, submissionRef, notes } = req.body;
    const data = {};
    if (status) {
      const allowed = ['PENDING', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED'];
      if (!allowed.includes(status.toUpperCase())) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
      data.status = status.toUpperCase();
      if (data.status === 'SUBMITTED') data.submittedAt = new Date();
      if (data.status === 'PAID') data.paidAt = new Date();
    }
    if (submissionRef !== undefined) data.submissionRef = submissionRef || null;
    if (notes !== undefined) data.notes = notes || null;
    if (!Object.keys(data).length) return res.status(400).json({ error: 'No fields to update' });

    const updated = await prisma.grantClaim.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Claim not found' });
    next(err);
  }
});

// ── GET /training/grants/summary ──────────────────────────────────────────────
// Dashboard summary: total claimable + paid by type, SFEC + SFC balances.
router.get('/grants/summary', authenticate, authorize(...ADMIN_ROLES), async (_req, res, next) => {
  try {
    const claims = await prisma.grantClaim.findMany({ select: { claimType: true, claimAmount: true, status: true } });
    const sfec = await prisma.sfecLedger.findUnique({ where: { id: 'singleton' } });

    const totals = { ETS: 0, AP: 0, SFEC: 0, SFC: 0 };
    const paid   = { ETS: 0, AP: 0, SFEC: 0, SFC: 0 };
    for (const c of claims) {
      totals[c.claimType] = round2((totals[c.claimType] || 0) + c.claimAmount);
      if (c.status === 'PAID') paid[c.claimType] = round2((paid[c.claimType] || 0) + c.claimAmount);
    }

    res.json({
      generatedAt: new Date().toISOString(),
      totalClaimsByType: totals,
      paidByType: paid,
      totalClaimable: round2(Object.values(totals).reduce((s, n) => s + n, 0)),
      totalPaid: round2(Object.values(paid).reduce((s, n) => s + n, 0)),
      sfec: sfec
        ? { totalCredit: sfec.totalCredit, usedAmount: sfec.usedAmount, remainingAmount: round2(sfec.totalCredit - sfec.usedAmount) }
        : { totalCredit: SFEC_DEFAULT_TOTAL, usedAmount: 0, remainingAmount: SFEC_DEFAULT_TOTAL, initialised: false },
    });
  } catch (err) { next(err); }
});

module.exports = router;
