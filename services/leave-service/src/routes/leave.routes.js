'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();

// ── GET /leave/types ──────────────────────────────────────────────────────────
router.get('/types', authenticate, async (req, res, next) => {
  try {
    const all = req.query.all === 'true';
    const types = await prisma.leaveType.findMany({ where: all ? {} : { isActive: true }, orderBy: { name: 'asc' } });
    res.json(types);
  } catch (err) { next(err); }
});

// ── POST /leave/types ─────────────────────────────────────────────────────────
router.post('/types', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { code, name, isPaid, isStatutory, annualEntitlement, maxCarryForward, isGovtPaid, requiresDocument, minNoticeDays } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
    const type = await prisma.leaveType.create({
      data: {
        id: uuidv4(), code: code.toUpperCase().trim(), name: name.trim(),
        isPaid: isPaid ?? true, isStatutory: isStatutory ?? false,
        annualEntitlement: parseFloat(annualEntitlement) || 0,
        maxCarryForward: parseFloat(maxCarryForward) || 0,
        isGovtPaid: isGovtPaid ?? false,
        requiresDocument: requiresDocument ?? false,
        minNoticeDays: parseInt(minNoticeDays) || 0,
      },
    });
    res.status(201).json(type);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A leave type with this code already exists' });
    next(err);
  }
});

// ── PUT /leave/types/:id ──────────────────────────────────────────────────────
router.put('/types/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { name, isPaid, isStatutory, annualEntitlement, maxCarryForward, isGovtPaid, requiresDocument, minNoticeDays, isActive } = req.body;
    const type = await prisma.leaveType.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(isPaid !== undefined && { isPaid }),
        ...(isStatutory !== undefined && { isStatutory }),
        ...(annualEntitlement !== undefined && { annualEntitlement: parseFloat(annualEntitlement) }),
        ...(maxCarryForward !== undefined && { maxCarryForward: parseFloat(maxCarryForward) }),
        ...(isGovtPaid !== undefined && { isGovtPaid }),
        ...(requiresDocument !== undefined && { requiresDocument }),
        ...(minNoticeDays !== undefined && { minNoticeDays: parseInt(minNoticeDays) }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json(type);
  } catch (err) { next(err); }
});

// ── DELETE /leave/types/:id — soft delete ─────────────────────────────────────
router.delete('/types/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    await prisma.leaveType.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Leave type deactivated' });
  } catch (err) { next(err); }
});

// ── GET /leave/entitlements/:employeeId ───────────────────────────────────────
router.get('/entitlements/:employeeId', authenticate, authorizeSelfOrRole('employeeId', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER), async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const [types, entitlements] = await Promise.all([
      prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      prisma.leaveEntitlement.findMany({
        where: { employeeId: req.params.employeeId, year },
        include: { leaveType: { select: { code: true, name: true, isPaid: true } } },
      }),
    ]);
    // Merge: return all active types with their entitlement data (or nulls)
    const map = Object.fromEntries(entitlements.map(e => [e.leaveTypeId, e]));
    const result = types.map(t => ({
      leaveTypeId: t.id, code: t.code, name: t.name, isPaid: t.isPaid,
      annualEntitlement: t.annualEntitlement,
      entitledDays: map[t.id]?.entitledDays ?? t.annualEntitlement,
      usedDays: map[t.id]?.usedDays ?? 0,
      pendingDays: map[t.id]?.pendingDays ?? 0,
      carryForward: map[t.id]?.carryForward ?? 0,
      entitlementId: map[t.id]?.id ?? null,
    }));
    res.json(result);
  } catch (err) { next(err); }
});

// ── PUT /leave/entitlements/:employeeId ───────────────────────────────────────
router.put('/entitlements/:employeeId', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const year = parseInt(req.body.year) || new Date().getFullYear();
    const { entitlements } = req.body; // [{ leaveTypeId, entitledDays, carryForward }]
    if (!Array.isArray(entitlements)) return res.status(400).json({ error: 'entitlements array required' });

    const results = await Promise.all(entitlements.map(e =>
      prisma.leaveEntitlement.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: e.leaveTypeId, year } },
        create: { id: uuidv4(), employeeId, leaveTypeId: e.leaveTypeId, year, entitledDays: parseFloat(e.entitledDays) || 0, carryForward: parseFloat(e.carryForward) || 0 },
        update: { entitledDays: parseFloat(e.entitledDays) || 0, carryForward: parseFloat(e.carryForward) || 0 },
      })
    ));
    res.json(results);
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

// POST /leave/purge — PDPA data retention purge (internal, SUPER_ADMIN only)
router.post('/purge', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const retentionYears = parseInt(req.body.retentionYears) || 3;
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - retentionYears);

    // Purge leave applications where endDate + retentionYears <= today
    const purged = await prisma.$executeRaw`
      DELETE FROM leave_applications WHERE "endDate" <= ${cutoff}
    `;
    await prisma.$executeRawUnsafe('VACUUM ANALYZE leave_applications').catch(() => {});

    res.json({ purged: Number(purged), cutoff: cutoff.toISOString().slice(0, 10) });
  } catch (err) { next(err); }
});

module.exports = router;
