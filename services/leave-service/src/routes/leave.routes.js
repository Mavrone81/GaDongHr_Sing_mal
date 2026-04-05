'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();

// ── GET /leave/types ──────────────────────────────────────────────────────────
router.get('/types', authenticate, async (req, res, next) => {
  try {
    const types = await prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    res.json(types);
  } catch (err) { next(err); }
});

// ── GET /leave/balances/:employeeId ───────────────────────────────────────────
router.get('/balances/:employeeId', authenticate, authorizeSelfOrRole('employeeId', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER), async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const balances = await prisma.leaveEntitlement.findMany({
      where: { employeeId: req.params.employeeId, year },
      include: { leaveType: { select: { code: true, name: true, isPaid: true } } },
    });
    res.json(balances);
  } catch (err) { next(err); }
});

// ── GET /leave/applications ───────────────────────────────────────────────────
router.get('/applications', authenticate, async (req, res, next) => {
  try {
    const { employeeId, status, page = 1, limit = 20 } = req.query;
    const where = {};
    // Employees see only their own; managers see their team
    if (req.user.role === 'employee') where.employeeId = req.user.employeeId;
    else if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status.toUpperCase();

    const [apps, total] = await Promise.all([
      prisma.leaveApplication.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit, take: Number(limit),
        include: { leaveType: { select: { code: true, name: true, isPaid: true } } },
      }),
      prisma.leaveApplication.count({ where }),
    ]);
    res.json({ applications: apps, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// ── POST /leave/applications ──────────────────────────────────────────────────
router.post('/applications', authenticate, async (req, res, next) => {
  try {
    const { leaveTypeId, startDate, endDate, reason, isHalfDay, halfDaySlot } = req.body;
    const employeeId = req.body.employeeId || req.user.employeeId;
    if (!leaveTypeId || !startDate || !endDate) return res.status(400).json({ error: 'leaveTypeId, startDate, endDate required' });

    const start = new Date(startDate);
    const end = new Date(endDate);
    const msPerDay = 24 * 60 * 60 * 1000;
    let totalDays = Math.round((end - start) / msPerDay) + 1;
    if (isHalfDay) totalDays = 0.5;

    // Check balance
    const year = start.getFullYear();
    const entitlement = await prisma.leaveEntitlement.findFirst({ where: { employeeId, leaveTypeId, year } });
    if (entitlement) {
      const available = entitlement.entitledDays + entitlement.carryForward - entitlement.usedDays - entitlement.pendingDays;
      if (available < totalDays) return res.status(400).json({ error: `Insufficient leave balance. Available: ${available} days` });
      // Deduct pending
      await prisma.leaveEntitlement.update({ where: { id: entitlement.id }, data: { pendingDays: { increment: totalDays } } });
    }

    const app = await prisma.leaveApplication.create({
      data: { id: uuidv4(), employeeId, leaveTypeId, startDate: start, endDate: end, totalDays, reason, isHalfDay: !!isHalfDay, halfDaySlot, status: 'PENDING' },
      include: { leaveType: { select: { code: true, name: true } } },
    });
    res.status(201).json(app);
  } catch (err) { next(err); }
});

// ── PUT /leave/applications/:id/approve ───────────────────────────────────────
router.put('/applications/:id/approve', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER), async (req, res, next) => {
  try {
    const app = await prisma.leaveApplication.findUnique({ where: { id: req.params.id } });
    if (!app) return res.status(404).json({ error: 'Application not found' });
    if (app.status !== 'PENDING') return res.status(400).json({ error: 'Only PENDING applications can be approved' });

    // Move pendingDays → usedDays
    await prisma.leaveEntitlement.updateMany({
      where: { employeeId: app.employeeId, leaveTypeId: app.leaveTypeId, year: app.startDate.getFullYear() },
      data: { usedDays: { increment: app.totalDays }, pendingDays: { decrement: app.totalDays } },
    });

    const updated = await prisma.leaveApplication.update({
      where: { id: app.id },
      data: { status: 'APPROVED', approvedById: req.user.sub, approvedAt: new Date() },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── PUT /leave/applications/:id/reject ────────────────────────────────────────
router.put('/applications/:id/reject', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const app = await prisma.leaveApplication.findUnique({ where: { id: req.params.id } });
    if (!app) return res.status(404).json({ error: 'Application not found' });
    if (!['PENDING'].includes(app.status)) return res.status(400).json({ error: 'Only PENDING applications can be rejected' });

    // Release pending days
    await prisma.leaveEntitlement.updateMany({
      where: { employeeId: app.employeeId, leaveTypeId: app.leaveTypeId, year: app.startDate.getFullYear() },
      data: { pendingDays: { decrement: app.totalDays } },
    });
    const updated = await prisma.leaveApplication.update({
      where: { id: app.id },
      data: { status: 'REJECTED', rejectedReason: reason },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── GET /leave/public-holidays ─────────────────────────────────────────────────
router.get('/public-holidays', authenticate, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const phs = await prisma.publicHoliday.findMany({ where: { year }, orderBy: { date: 'asc' } });
    res.json(phs);
  } catch (err) { next(err); }
});

// ── POST /leave/public-holidays ────────────────────────────────────────────────
router.post('/public-holidays', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { date, name, year } = req.body;
    const ph = await prisma.publicHoliday.create({ data: { id: uuidv4(), date: new Date(date), name, year: parseInt(year) } });
    res.status(201).json(ph);
  } catch (err) { next(err); }
});

module.exports = router;
