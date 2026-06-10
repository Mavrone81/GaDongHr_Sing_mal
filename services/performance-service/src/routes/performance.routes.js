'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { DEFAULT_BANDS, validateBands, computeDistribution, hasDeviation, groupByDepartment } = require('../engines/bellcurve.engine');

const prisma = require('../utils/prisma');
const EMPLOYEE_URL_BC = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';

const PHASE_ORDER = ['GOAL_SETTING', 'SELF_ASSESSMENT', 'MANAGER_REVIEW', 'CALIBRATION', 'COMPLETED'];

function nextPhase(current) {
  const idx = PHASE_ORDER.indexOf(current);
  return idx >= 0 && idx < PHASE_ORDER.length - 1 ? PHASE_ORDER[idx + 1] : null;
}

// ── GET /performance/summary ─ KPI aggregates ─────────────────────────────────
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const [activeCycles, totalAppraisals, selfDone, finalised, activePips] = await Promise.all([
      prisma.reviewCycle.count({ where: { status: 'ACTIVE' } }),
      prisma.appraisal.count(),
      prisma.appraisal.count({ where: { status: { in: ['SELF_SUBMITTED', 'MANAGER_SUBMITTED', 'FINALISED'] } } }),
      prisma.appraisal.findMany({ where: { status: 'FINALISED', overallScore: { not: null } }, select: { overallScore: true } }),
      prisma.pipRecord.count({ where: { status: 'ACTIVE' } }),
    ]);

    const avgScore = finalised.length > 0
      ? (finalised.reduce((s, a) => s + (a.overallScore ?? 0), 0) / finalised.length).toFixed(2)
      : null;
    const completionRate = totalAppraisals > 0 ? Math.round((selfDone / totalAppraisals) * 100) : 0;

    res.json({ activeCycles, totalAppraisals, completionRate, avgScore, activePips });
  } catch (err) { next(err); }
});

// ── GET /performance/cycles ─ List cycles ─────────────────────────────────────
router.get('/cycles', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const { status, type } = req.query;
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    const cycles = await prisma.reviewCycle.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { appraisals: true } } },
    });
    res.json(cycles);
  } catch (err) { next(err); }
});

// ── POST /performance/cycles ─ Create cycle ───────────────────────────────────
router.post('/cycles', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { name, type, startDate, endDate, description } = req.body;
    if (!name || !type || !startDate || !endDate) {
      return res.status(400).json({ error: 'name, type, startDate, endDate are required' });
    }
    if (!['ANNUAL', 'MID_YEAR', 'PROBATION', 'CUSTOM'].includes(type)) {
      return res.status(400).json({ error: 'type must be ANNUAL, MID_YEAR, PROBATION, or CUSTOM' });
    }
    const cycle = await prisma.reviewCycle.create({
      data: { id: uuidv4(), name, type, startDate: new Date(startDate), endDate: new Date(endDate), description, createdBy: req.user.sub },
    });
    res.status(201).json(cycle);
  } catch (err) { next(err); }
});

// ── GET /performance/cycles/:id ───────────────────────────────────────────────
router.get('/cycles/:id', authenticate, async (req, res, next) => {
  try {
    const cycle = await prisma.reviewCycle.findUnique({
      where: { id: req.params.id },
      include: { appraisals: true, _count: { select: { appraisals: true } } },
    });
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });
    res.json(cycle);
  } catch (err) { next(err); }
});

// ── PUT /performance/cycles/:id ───────────────────────────────────────────────
router.put('/cycles/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { name, description, startDate, endDate, status } = req.body;
    const cycle = await prisma.reviewCycle.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(status && { status }),
      },
    });
    res.json(cycle);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Cycle not found' });
    next(err);
  }
});

// ── DELETE /performance/cycles/:id ───────────────────────────────────────────
router.delete('/cycles/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    await prisma.appraisal.deleteMany({ where: { cycleId: req.params.id } });
    await prisma.reviewCycle.delete({ where: { id: req.params.id } });
    res.json({ message: 'Cycle deleted' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Cycle not found' });
    next(err);
  }
});

// ── POST /performance/cycles/:id/activate ────────────────────────────────────
router.post('/cycles/:id/activate', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const cycle = await prisma.reviewCycle.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE' },
    });
    res.json(cycle);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Cycle not found' });
    next(err);
  }
});

// ── POST /performance/cycles/:id/advance-phase ────────────────────────────────
router.post('/cycles/:id/advance-phase', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const cycle = await prisma.reviewCycle.findUnique({ where: { id: req.params.id } });
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });
    const next_ = nextPhase(cycle.currentPhase);
    if (!next_) return res.status(400).json({ error: 'Cycle is already in final phase' });
    const updated = await prisma.reviewCycle.update({
      where: { id: req.params.id },
      data: {
        currentPhase: next_,
        ...(next_ === 'COMPLETED' && { status: 'COMPLETED' }),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── POST /performance/cycles/:id/enroll ── bulk enroll employees ──────────────
router.post('/cycles/:id/enroll', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { employeeIds, managerId } = req.body;
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: 'employeeIds array required' });
    }
    const cycle = await prisma.reviewCycle.findUnique({ where: { id: req.params.id } });
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

    let created = 0;
    for (const employeeId of employeeIds) {
      const exists = await prisma.appraisal.findUnique({ where: { cycleId_employeeId: { cycleId: req.params.id, employeeId } } });
      if (!exists) {
        await prisma.appraisal.create({
          data: { id: uuidv4(), cycleId: req.params.id, employeeId, managerId: managerId || null },
        });
        created++;
      }
    }
    res.json({ enrolled: created, skipped: employeeIds.length - created });
  } catch (err) { next(err); }
});

// ── GET /performance/cycles/:id/appraisals ────────────────────────────────────
router.get('/cycles/:id/appraisals', authenticate, async (req, res, next) => {
  try {
    const role = req.user.role;
    const employeeId = req.user.employeeId;
    const where = { cycleId: req.params.id };
    // Non-admins: only see their own appraisal
    if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(role)) {
      where.employeeId = employeeId;
    }
    const appraisals = await prisma.appraisal.findMany({ where, orderBy: { createdAt: 'asc' } });
    res.json(appraisals);
  } catch (err) { next(err); }
});

// ── GET /performance/appraisals/me ── employee's own appraisals ───────────────
router.get('/appraisals/me', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user.employeeId;
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    const appraisals = await prisma.appraisal.findMany({
      where: { employeeId },
      include: { cycle: { select: { id: true, name: true, type: true, currentPhase: true, status: true, startDate: true, endDate: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(appraisals);
  } catch (err) { next(err); }
});

// ── GET /performance/appraisals/team ── manager's team appraisals ─────────────
router.get('/appraisals/team', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user.employeeId;
    const { cycleId } = req.query;
    const where = { managerId: employeeId };
    if (cycleId) where.cycleId = cycleId;
    const appraisals = await prisma.appraisal.findMany({
      where,
      include: { cycle: { select: { id: true, name: true, type: true, currentPhase: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(appraisals);
  } catch (err) { next(err); }
});

// ── GET /performance/appraisals/:id ───────────────────────────────────────────
router.get('/appraisals/:id', authenticate, async (req, res, next) => {
  try {
    const appraisal = await prisma.appraisal.findUnique({
      where: { id: req.params.id },
      include: { cycle: true },
    });
    if (!appraisal) return res.status(404).json({ error: 'Appraisal not found' });
    // Access: own appraisal, assigned manager, or admin
    const role = req.user.role;
    const empId = req.user.employeeId;
    if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(role) && appraisal.employeeId !== empId && appraisal.managerId !== empId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(appraisal);
  } catch (err) { next(err); }
});

// ── POST /performance/appraisals/:id/self-submit ─ Employee submits self-assessment
router.post('/appraisals/:id/self-submit', authenticate, async (req, res, next) => {
  try {
    const { selfScore, selfComments, strengths, improvements } = req.body;
    if (selfScore === undefined || selfScore === null) {
      return res.status(400).json({ error: 'selfScore is required' });
    }
    if (selfScore < 1 || selfScore > 5) {
      return res.status(400).json({ error: 'selfScore must be between 1 and 5' });
    }
    const appraisal = await prisma.appraisal.findUnique({ where: { id: req.params.id } });
    if (!appraisal) return res.status(404).json({ error: 'Appraisal not found' });

    const empId = req.user.employeeId;
    const role = req.user.role;
    if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(role) && appraisal.employeeId !== empId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (appraisal.status !== 'PENDING' && appraisal.status !== 'SELF_SUBMITTED') {
      return res.status(400).json({ error: `Cannot submit self-assessment — status is ${appraisal.status}` });
    }
    const updated = await prisma.appraisal.update({
      where: { id: req.params.id },
      data: {
        selfScore, selfComments: selfComments || null,
        strengths: strengths || null, improvements: improvements || null,
        status: 'SELF_SUBMITTED', selfSubmittedAt: new Date(),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── POST /performance/appraisals/:id/manager-submit ─ Manager submits review ──
router.post('/appraisals/:id/manager-submit', authenticate, async (req, res, next) => {
  try {
    const { managerScore, managerComments, overallScore } = req.body;
    if (managerScore === undefined || managerScore === null) {
      return res.status(400).json({ error: 'managerScore is required' });
    }
    if (managerScore < 1 || managerScore > 5) {
      return res.status(400).json({ error: 'managerScore must be between 1 and 5' });
    }
    const appraisal = await prisma.appraisal.findUnique({ where: { id: req.params.id } });
    if (!appraisal) return res.status(404).json({ error: 'Appraisal not found' });

    const empId = req.user.employeeId;
    const role = req.user.role;
    if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(role) && appraisal.managerId !== empId) {
      return res.status(403).json({ error: 'Only the assigned manager can submit a manager review' });
    }
    if (appraisal.status === 'PENDING') {
      return res.status(400).json({ error: 'Employee must submit self-assessment first' });
    }
    const computed = overallScore ?? ((appraisal.selfScore ?? managerScore) + managerScore) / 2;
    const updated = await prisma.appraisal.update({
      where: { id: req.params.id },
      data: {
        managerScore, managerComments: managerComments || null,
        overallScore: computed,
        status: 'MANAGER_SUBMITTED', managerSubmittedAt: new Date(),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── POST /performance/appraisals/:id/finalise ─────────────────────────────────
router.post('/appraisals/:id/finalise', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { overallScore } = req.body;
    const appraisal = await prisma.appraisal.findUnique({ where: { id: req.params.id } });
    if (!appraisal) return res.status(404).json({ error: 'Appraisal not found' });
    const updated = await prisma.appraisal.update({
      where: { id: req.params.id },
      data: {
        ...(overallScore !== undefined && { overallScore }),
        status: 'FINALISED', finalisedAt: new Date(),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Goals ─────────────────────────────────────────────────────────────────────

// GET /performance/goals ─ list goals (own, or admin sees all)
router.get('/goals', authenticate, async (req, res, next) => {
  try {
    const role = req.user.role;
    const empId = req.user.employeeId;
    const { employeeId, cycleId, status } = req.query;
    const where = {};
    if (status) where.status = status;
    if (cycleId) where.cycleId = cycleId;
    if (['SUPER_ADMIN', 'HR_ADMIN'].includes(role)) {
      if (employeeId) where.employeeId = employeeId;
    } else {
      where.employeeId = empId;
    }
    const goals = await prisma.goal.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json(goals);
  } catch (err) { next(err); }
});

// POST /performance/goals ─ create goal
router.post('/goals', authenticate, async (req, res, next) => {
  try {
    const { title, description, targetDate, category, cycleId } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const empId = req.user.employeeId;
    const role = req.user.role;
    const targetEmployeeId = (req.body.employeeId && ['SUPER_ADMIN', 'HR_ADMIN'].includes(role))
      ? req.body.employeeId : empId;

    const goal = await prisma.goal.create({
      data: {
        id: uuidv4(), employeeId: targetEmployeeId, title, description: description || null,
        targetDate: targetDate ? new Date(targetDate) : null,
        category: category || 'PERFORMANCE', cycleId: cycleId || null,
      },
    });
    res.status(201).json(goal);
  } catch (err) { next(err); }
});

// PUT /performance/goals/:id
router.put('/goals/:id', authenticate, async (req, res, next) => {
  try {
    const goal = await prisma.goal.findUnique({ where: { id: req.params.id } });
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    const empId = req.user.employeeId;
    const role = req.user.role;
    if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(role) && goal.employeeId !== empId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { title, description, targetDate, category, progress, status } = req.body;
    const updated = await prisma.goal.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(targetDate !== undefined && { targetDate: targetDate ? new Date(targetDate) : null }),
        ...(category && { category }),
        ...(progress !== undefined && { progress: Math.min(100, Math.max(0, Number(progress))) }),
        ...(status && { status }),
      },
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Goal not found' });
    next(err);
  }
});

// DELETE /performance/goals/:id
router.delete('/goals/:id', authenticate, async (req, res, next) => {
  try {
    const goal = await prisma.goal.findUnique({ where: { id: req.params.id } });
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    const empId = req.user.employeeId;
    const role = req.user.role;
    if (!['SUPER_ADMIN', 'HR_ADMIN'].includes(role) && goal.employeeId !== empId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await prisma.goal.delete({ where: { id: req.params.id } });
    res.json({ message: 'Goal deleted' });
  } catch (err) { next(err); }
});

// ── PIPs ──────────────────────────────────────────────────────────────────────

// GET /performance/pips
router.get('/pips', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.LINE_MANAGER), async (req, res, next) => {
  try {
    const { status, employeeId } = req.query;
    const role = req.user.role;
    const empId = req.user.employeeId;
    const where = {};
    if (status) where.status = status;
    if (['SUPER_ADMIN', 'HR_ADMIN'].includes(role)) {
      if (employeeId) where.employeeId = employeeId;
    } else {
      // Managers: only their own managed PIPs
      where.managerId = empId;
    }
    const pips = await prisma.pipRecord.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json(pips);
  } catch (err) { next(err); }
});

// POST /performance/pips
router.post('/pips', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.LINE_MANAGER), async (req, res, next) => {
  try {
    const { employeeId, startDate, endDate, objectives } = req.body;
    if (!employeeId || !startDate || !endDate || !objectives) {
      return res.status(400).json({ error: 'employeeId, startDate, endDate, objectives are required' });
    }
    const managerId = req.user.employeeId || req.user.sub;
    const pip = await prisma.pipRecord.create({
      data: { id: uuidv4(), employeeId, managerId, startDate: new Date(startDate), endDate: new Date(endDate), objectives },
    });
    res.status(201).json(pip);
  } catch (err) { next(err); }
});

// GET /performance/pips/:id
router.get('/pips/:id', authenticate, async (req, res, next) => {
  try {
    const pip = await prisma.pipRecord.findUnique({ where: { id: req.params.id } });
    if (!pip) return res.status(404).json({ error: 'PIP not found' });
    res.json(pip);
  } catch (err) { next(err); }
});

// PUT /performance/pips/:id
router.put('/pips/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.LINE_MANAGER), async (req, res, next) => {
  try {
    const { progressNotes, status, endDate, objectives } = req.body;
    const pip = await prisma.pipRecord.update({
      where: { id: req.params.id },
      data: {
        ...(progressNotes !== undefined && { progressNotes }),
        ...(status && { status }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(objectives && { objectives }),
      },
    });
    res.json(pip);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'PIP not found' });
    next(err);
  }
});

// ── GET /performance/cycles/:id/calibration ──────────────────────────────────
// Query params: groupBy=department
router.get('/cycles/:id/calibration', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const cycle = await prisma.reviewCycle.findUnique({
      where: { id: req.params.id },
      include: { bellCurveConfig: true },
    });
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

    const appraisals = await prisma.appraisal.findMany({
      where: { cycleId: req.params.id, status: 'FINALISED' },
      orderBy: { overallScore: 'desc' },
      include: { incrementProposal: true },
    });

    const bands = cycle.bellCurveConfig?.bands || DEFAULT_BANDS;
    const distribution = computeDistribution(appraisals, bands);
    const bellCurve = {
      config: cycle.bellCurveConfig || { bands: DEFAULT_BANDS, isDefault: true },
      distribution,
      hasDeviation: hasDeviation(distribution),
      totalRated: appraisals.filter(a => (a.calibratedScore ?? a.overallScore) !== null).length,
    };

    let byDepartment = null;
    if (req.query.groupBy === 'department') {
      let employeeMap = {};
      try {
        const empRes = await fetch(`${EMPLOYEE_URL_BC}/employees?limit=2000`, {
          headers: { Authorization: req.headers.authorization },
        });
        if (empRes.ok) {
          const data = await empRes.json();
          for (const e of (data.employees || [])) employeeMap[e.id] = e;
        }
      } catch {}
      byDepartment = groupByDepartment(appraisals, employeeMap, bands);
    }

    res.json({ cycle, appraisals, locked: !!cycle.calibrationLockedAt, bellCurve, byDepartment });
  } catch (err) { next(err); }
});

// ── GET /performance/cycles/:id/bell-curve-config ─────────────────────────────
router.get('/cycles/:id/bell-curve-config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const cycle = await prisma.reviewCycle.findUnique({ where: { id: req.params.id } });
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });
    const config = await prisma.bellCurveConfig.findUnique({ where: { cycleId: req.params.id } });
    res.json(config || { bands: DEFAULT_BANDS, isDefault: true });
  } catch (err) { next(err); }
});

// ── PUT /performance/cycles/:id/bell-curve-config ─────────────────────────────
router.put('/cycles/:id/bell-curve-config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const cycle = await prisma.reviewCycle.findUnique({ where: { id: req.params.id } });
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

    const { bands } = req.body;
    const err = validateBands(bands);
    if (err) return res.status(400).json({ error: err });

    const existing = await prisma.bellCurveConfig.findUnique({ where: { cycleId: req.params.id } });
    const config = existing
      ? await prisma.bellCurveConfig.update({
          where: { cycleId: req.params.id },
          data: { bands, updatedBy: req.user.sub },
        })
      : await prisma.bellCurveConfig.create({
          data: { id: uuidv4(), cycleId: req.params.id, bands, createdBy: req.user.sub },
        });
    res.json(config);
  } catch (err) { next(err); }
});

// ── PUT /performance/cycles/:id/appraisals/:appraisalId/calibrate ─────────────
router.put('/cycles/:id/appraisals/:appraisalId/calibrate', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const cycle = await prisma.reviewCycle.findUnique({ where: { id: req.params.id } });
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });
    if (cycle.calibrationLockedAt) return res.status(400).json({ error: 'Calibration is locked for this cycle' });

    const { calibratedScore } = req.body;
    if (calibratedScore === undefined) return res.status(400).json({ error: 'calibratedScore is required' });

    const updated = await prisma.appraisal.update({
      where: { id: req.params.appraisalId },
      data: { calibratedScore: parseFloat(calibratedScore), calibratedAt: new Date(), calibratedBy: req.user.sub },
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Appraisal not found' });
    next(err);
  }
});

// ── POST /performance/cycles/:id/lock-calibration ─────────────────────────────
router.post('/cycles/:id/lock-calibration', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const cycle = await prisma.reviewCycle.findUnique({ where: { id: req.params.id } });
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });
    if (cycle.calibrationLockedAt) return res.status(409).json({ error: 'Already locked' });

    const updated = await prisma.reviewCycle.update({
      where: { id: req.params.id },
      data: { calibrationLockedAt: new Date() },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── POST /performance/cycles/:id/increment-proposals ─────────────────────────
router.post('/cycles/:id/increment-proposals', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { incrementMatrix } = req.body;
    if (!Array.isArray(incrementMatrix) || incrementMatrix.length === 0) {
      return res.status(400).json({ error: 'incrementMatrix array is required (e.g. [{minScore,maxScore,pct}])' });
    }

    const appraisals = await prisma.appraisal.findMany({
      where: { cycleId: req.params.id, status: 'FINALISED', calibratedScore: { not: null } },
    });
    if (!appraisals.length) return res.status(400).json({ error: 'No finalised appraisals with calibrated scores found' });

    const EMPLOYEE_URL = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';
    const authHeader = req.headers.authorization;

    const results = [];
    for (const ap of appraisals) {
      const score = ap.calibratedScore ?? ap.overallScore ?? 0;
      const tier = incrementMatrix.find(t => score >= t.minScore && score <= t.maxScore);
      const proposedPct = tier ? tier.pct : 0;

      let proposedAmount = null;
      try {
        const empRes = await fetch(`${EMPLOYEE_URL}/employees/${ap.employeeId}`, { headers: { Authorization: authHeader } });
        if (empRes.ok) {
          const emp = await empRes.json();
          if (emp.basicSalary) proposedAmount = Math.round(emp.basicSalary * (1 + proposedPct / 100) * 100) / 100;
        }
      } catch {}

      const proposal = await prisma.incrementProposal.upsert({
        where: { appraisalId: ap.id },
        create: { id: require('crypto').randomUUID(), cycleId: req.params.id, appraisalId: ap.id, employeeId: ap.employeeId, proposedPct, proposedAmount },
        update: { proposedPct, proposedAmount, status: 'DRAFT', approvedBy: null, approvedAt: null },
      });
      results.push(proposal);
    }
    res.status(201).json({ created: results.length, proposals: results });
  } catch (err) { next(err); }
});

// ── GET /performance/cycles/:id/increment-proposals ──────────────────────────
router.get('/cycles/:id/increment-proposals', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const proposals = await prisma.incrementProposal.findMany({
      where: { cycleId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(proposals);
  } catch (err) { next(err); }
});

// ── PUT /performance/cycles/:id/increment-proposals/:pid ─────────────────────
router.put('/cycles/:id/increment-proposals/:pid', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'status must be APPROVED or REJECTED' });

    const updated = await prisma.incrementProposal.update({
      where: { id: req.params.pid },
      data: {
        status,
        notes: notes ?? undefined,
        ...(status === 'APPROVED' ? { approvedBy: req.user.sub, approvedAt: new Date() } : {}),
      },
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Proposal not found' });
    next(err);
  }
});

// ── POST /performance/cycles/:id/apply-increments ────────────────────────────
router.post('/cycles/:id/apply-increments', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const cycle = await prisma.reviewCycle.findUnique({ where: { id: req.params.id } });
    if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

    const proposals = await prisma.incrementProposal.findMany({
      where: { cycleId: req.params.id, status: 'APPROVED' },
    });
    if (!proposals.length) return res.status(400).json({ error: 'No approved proposals found' });

    const EMPLOYEE_URL = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';
    const authHeader = req.headers.authorization;
    let applied = 0; let skipped = 0;

    for (const p of proposals) {
      if (!p.proposedAmount) { skipped++; continue; }
      try {
        const r = await fetch(`${EMPLOYEE_URL}/employees/${p.employeeId}`, {
          method: 'PATCH',
          headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
          body: JSON.stringify({ basicSalary: p.proposedAmount, salaryChangeReason: `Performance increment — ${cycle.name}` }),
        });
        if (r.ok) applied++;
        else skipped++;
      } catch { skipped++; }
    }
    res.json({ applied, skipped, total: proposals.length });
  } catch (err) { next(err); }
});

module.exports = router;
