'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const {
  computePositionRisk,
  computeRiskReport,
  computeSuccessionDashboard,
  build9BoxEntry,
} = require('../engines/succession.engine');

const prisma = require('../utils/prisma');
const EMPLOYEE_URL = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';

const HR_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER];
const VALID_READINESS = ['READY_NOW', 'ONE_YEAR', 'TWO_YEARS'];
const VALID_DEV_STATUS = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

// helper: enrich nominees with riskLevel derived from the set
function enrichPositionRisk(position) {
  const risk = computePositionRisk(position.nominees || []);
  return { ...position, riskLevel: risk };
}

// helper: fetch employee names from employee-service (fail-soft)
async function fetchEmployeeNames(ids, authHeader) {
  if (!ids || ids.length === 0) return {};
  try {
    const r = await fetch(`${EMPLOYEE_URL}/employees/by-ids`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) return {};
    const data = await r.json();
    const map = {};
    for (const e of (data.employees || data)) map[e.id] = e;
    return map;
  } catch { return {}; }
}

// ── POST /performance/key-positions ──────────────────────────────────────────
router.post('/key-positions', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { jobTitle, department, description, currentHolderId } = req.body;
    if (!jobTitle) return res.status(400).json({ error: 'jobTitle is required' });

    const position = await prisma.keyPosition.create({
      data: {
        id: uuidv4(),
        jobTitle,
        department: department ?? null,
        description: description ?? null,
        currentHolderId: currentHolderId ?? null,
        riskLevel: 'HIGH',
        createdBy: req.user.sub,
      },
      include: { nominees: true },
    });
    res.status(201).json(enrichPositionRisk(position));
  } catch (err) { next(err); }
});

// ── GET /performance/key-positions ────────────────────────────────────────────
router.get('/key-positions', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { department, risk, includeInactive } = req.query;
    const where = {};
    if (!includeInactive) where.isActive = true;
    if (department) where.department = department;

    const positions = await prisma.keyPosition.findMany({
      where,
      orderBy: { jobTitle: 'asc' },
      include: { nominees: true },
    });

    let enriched = positions.map(enrichPositionRisk);
    if (risk) enriched = enriched.filter(p => p.riskLevel === risk.toUpperCase());

    res.json(enriched);
  } catch (err) { next(err); }
});

// ── GET /performance/key-positions/:id ────────────────────────────────────────
router.get('/key-positions/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const position = await prisma.keyPosition.findUnique({
      where: { id: req.params.id },
      include: { nominees: { include: { devPlans: true } } },
    });
    if (!position) return res.status(404).json({ error: 'Key position not found' });

    const employeeIds = [
      ...new Set([
        ...position.nominees.map(n => n.employeeId),
        ...(position.currentHolderId ? [position.currentHolderId] : []),
      ]),
    ];
    const empMap = await fetchEmployeeNames(employeeIds, req.headers.authorization);

    const enrichedNominees = position.nominees.map(n => ({
      ...n,
      _employee: empMap[n.employeeId] || null,
    }));

    res.json({
      ...enrichPositionRisk({ ...position, nominees: position.nominees }),
      nominees: enrichedNominees,
      _currentHolder: empMap[position.currentHolderId] || null,
    });
  } catch (err) { next(err); }
});

// ── PUT /performance/key-positions/:id ────────────────────────────────────────
router.put('/key-positions/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { jobTitle, department, description, currentHolderId, isActive } = req.body;
    const updated = await prisma.keyPosition.update({
      where: { id: req.params.id },
      data: {
        ...(jobTitle !== undefined       ? { jobTitle }        : {}),
        ...(department !== undefined     ? { department }      : {}),
        ...(description !== undefined    ? { description }     : {}),
        ...(currentHolderId !== undefined? { currentHolderId } : {}),
        ...(isActive !== undefined       ? { isActive }        : {}),
        updatedBy: req.user.sub,
      },
      include: { nominees: true },
    });
    res.json(enrichPositionRisk(updated));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Key position not found' });
    next(err);
  }
});

// ── DELETE /performance/key-positions/:id ─────────────────────────────────────
router.delete('/key-positions/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const count = await prisma.successorNominee.count({ where: { positionId: req.params.id } });
    if (count > 0) return res.status(409).json({ error: 'Cannot delete a position with active nominees — deactivate it instead' });

    await prisma.keyPosition.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Key position not found' });
    next(err);
  }
});

// ── POST /performance/key-positions/:id/nominees ──────────────────────────────
router.post('/key-positions/:id/nominees', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { employeeId, readiness, potentialBand, notes } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });
    if (!VALID_READINESS.includes(readiness)) {
      return res.status(400).json({ error: `readiness must be one of ${VALID_READINESS.join(', ')}` });
    }
    if (!potentialBand || potentialBand < 1 || potentialBand > 3) {
      return res.status(400).json({ error: 'potentialBand must be 1, 2, or 3' });
    }

    const position = await prisma.keyPosition.findUnique({ where: { id: req.params.id } });
    if (!position) return res.status(404).json({ error: 'Key position not found' });

    const nominee = await prisma.successorNominee.create({
      data: {
        id: uuidv4(),
        positionId: req.params.id,
        employeeId,
        readiness,
        potentialBand: parseInt(potentialBand),
        notes: notes ?? null,
        nominatedBy: req.user.sub,
      },
      include: { devPlans: true },
    });

    // recompute position risk after new nominee
    const allNominees = await prisma.successorNominee.findMany({ where: { positionId: req.params.id } });
    await prisma.keyPosition.update({
      where: { id: req.params.id },
      data: { riskLevel: computePositionRisk(allNominees), updatedBy: req.user.sub },
    });

    res.status(201).json(nominee);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'This employee is already nominated for this position' });
    next(err);
  }
});

// ── GET /performance/key-positions/:id/nominees ───────────────────────────────
router.get('/key-positions/:id/nominees', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const position = await prisma.keyPosition.findUnique({ where: { id: req.params.id } });
    if (!position) return res.status(404).json({ error: 'Key position not found' });

    const nominees = await prisma.successorNominee.findMany({
      where: { positionId: req.params.id },
      include: { devPlans: true },
      orderBy: { nominatedAt: 'asc' },
    });

    const empMap = await fetchEmployeeNames(nominees.map(n => n.employeeId), req.headers.authorization);
    res.json(nominees.map(n => ({ ...n, _employee: empMap[n.employeeId] || null })));
  } catch (err) { next(err); }
});

// ── PUT /performance/nominees/:id ─────────────────────────────────────────────
router.put('/nominees/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { readiness, potentialBand, notes } = req.body;
    if (readiness && !VALID_READINESS.includes(readiness)) {
      return res.status(400).json({ error: `readiness must be one of ${VALID_READINESS.join(', ')}` });
    }
    if (potentialBand !== undefined && (potentialBand < 1 || potentialBand > 3)) {
      return res.status(400).json({ error: 'potentialBand must be 1, 2, or 3' });
    }

    const updated = await prisma.successorNominee.update({
      where: { id: req.params.id },
      data: {
        ...(readiness !== undefined     ? { readiness }                       : {}),
        ...(potentialBand !== undefined ? { potentialBand: parseInt(potentialBand) } : {}),
        ...(notes !== undefined         ? { notes }                           : {}),
        updatedBy: req.user.sub,
      },
    });

    // recompute position risk
    const allNominees = await prisma.successorNominee.findMany({ where: { positionId: updated.positionId } });
    await prisma.keyPosition.update({
      where: { id: updated.positionId },
      data: { riskLevel: computePositionRisk(allNominees), updatedBy: req.user.sub },
    });

    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Nominee not found' });
    next(err);
  }
});

// ── DELETE /performance/nominees/:id ──────────────────────────────────────────
router.delete('/nominees/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const nominee = await prisma.successorNominee.findUnique({ where: { id: req.params.id } });
    if (!nominee) return res.status(404).json({ error: 'Nominee not found' });

    await prisma.successionDevPlan.deleteMany({ where: { nomineeId: req.params.id } });
    await prisma.successorNominee.delete({ where: { id: req.params.id } });

    // recompute position risk
    const allNominees = await prisma.successorNominee.findMany({ where: { positionId: nominee.positionId } });
    await prisma.keyPosition.update({
      where: { id: nominee.positionId },
      data: { riskLevel: computePositionRisk(allNominees), updatedBy: req.user.sub },
    });

    res.status(204).send();
  } catch (err) { next(err); }
});

// ── POST /performance/nominees/:id/dev-plans ──────────────────────────────────
router.post('/nominees/:id/dev-plans', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { competencyGap, action, trainingProgramId, targetDate, notes } = req.body;
    if (!competencyGap || !action) {
      return res.status(400).json({ error: 'competencyGap and action are required' });
    }

    const nominee = await prisma.successorNominee.findUnique({ where: { id: req.params.id } });
    if (!nominee) return res.status(404).json({ error: 'Nominee not found' });

    const plan = await prisma.successionDevPlan.create({
      data: {
        id: uuidv4(),
        nomineeId: req.params.id,
        competencyGap,
        action,
        trainingProgramId: trainingProgramId ?? null,
        targetDate: targetDate ? new Date(targetDate) : null,
        notes: notes ?? null,
        createdBy: req.user.sub,
      },
    });
    res.status(201).json(plan);
  } catch (err) { next(err); }
});

// ── GET /performance/nominees/:id/dev-plans ───────────────────────────────────
router.get('/nominees/:id/dev-plans', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const nominee = await prisma.successorNominee.findUnique({ where: { id: req.params.id } });
    if (!nominee) return res.status(404).json({ error: 'Nominee not found' });

    const plans = await prisma.successionDevPlan.findMany({
      where: { nomineeId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json(plans);
  } catch (err) { next(err); }
});

// ── PUT /performance/dev-plans/:id ────────────────────────────────────────────
router.put('/dev-plans/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { competencyGap, action, trainingProgramId, targetDate, status, notes } = req.body;
    if (status && !VALID_DEV_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${VALID_DEV_STATUS.join(', ')}` });
    }

    const updated = await prisma.successionDevPlan.update({
      where: { id: req.params.id },
      data: {
        ...(competencyGap !== undefined     ? { competencyGap }                           : {}),
        ...(action !== undefined            ? { action }                                  : {}),
        ...(trainingProgramId !== undefined ? { trainingProgramId }                       : {}),
        ...(targetDate !== undefined        ? { targetDate: targetDate ? new Date(targetDate) : null } : {}),
        ...(status !== undefined            ? { status, completedAt: status === 'COMPLETED' ? new Date() : undefined } : {}),
        ...(notes !== undefined             ? { notes }                                   : {}),
        updatedBy: req.user.sub,
      },
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Dev plan not found' });
    next(err);
  }
});

// ── DELETE /performance/dev-plans/:id ─────────────────────────────────────────
router.delete('/dev-plans/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    await prisma.successionDevPlan.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Dev plan not found' });
    next(err);
  }
});

// ── GET /performance/nine-box ──────────────────────────────────────────────────
// Returns all nominees placed on the 9-box grid, optionally filtered by cycleId
// Performance score comes from the most recent FINALISED appraisal
router.get('/nine-box', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { cycleId } = req.query;

    const nominees = await prisma.successorNominee.findMany({
      orderBy: { nominatedAt: 'asc' },
    });
    if (!nominees.length) return res.json({ grid: [], unplaced: [] });

    // fetch appraisals for each unique employeeId
    const employeeIds = [...new Set(nominees.map(n => n.employeeId))];
    const appraisalWhere = { employeeId: { in: employeeIds }, status: 'FINALISED' };
    if (cycleId) appraisalWhere.cycleId = cycleId;

    const appraisals = await prisma.appraisal.findMany({
      where: appraisalWhere,
      orderBy: { finalisedAt: 'desc' },
    });

    // best appraisal per employee (most recent finalised, prefer calibrated)
    const bestByEmployee = {};
    for (const a of appraisals) {
      if (!bestByEmployee[a.employeeId]) bestByEmployee[a.employeeId] = a;
    }

    const empMap = await fetchEmployeeNames(employeeIds, req.headers.authorization);

    const grid = [];
    const unplaced = [];

    for (const nominee of nominees) {
      const appraisal = bestByEmployee[nominee.employeeId];
      const perfScore = appraisal ? (appraisal.calibratedScore ?? appraisal.overallScore) : null;
      const entry = build9BoxEntry(perfScore, nominee.potentialBand);

      const base = {
        nomineeId: nominee.id,
        employeeId: nominee.employeeId,
        _employee: empMap[nominee.employeeId] || null,
        readiness: nominee.readiness,
        potentialBand: nominee.potentialBand,
        performanceScore: perfScore,
      };

      if (entry) {
        grid.push({ ...base, ...entry });
      } else {
        unplaced.push({ ...base, reason: perfScore === null ? 'No finalised appraisal' : 'Invalid potential band' });
      }
    }

    // group grid by box number for convenience
    const byBox = {};
    for (const item of grid) {
      if (!byBox[item.box]) byBox[item.box] = [];
      byBox[item.box].push(item);
    }

    res.json({ grid, byBox, unplaced });
  } catch (err) { next(err); }
});

// ── GET /performance/succession/risk-report ───────────────────────────────────
router.get('/succession/risk-report', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { department } = req.query;
    const where = { isActive: true };
    if (department) where.department = department;

    const positions = await prisma.keyPosition.findMany({
      where,
      include: { nominees: true },
      orderBy: { jobTitle: 'asc' },
    });

    const nomineesByPosition = {};
    for (const p of positions) nomineesByPosition[p.id] = p.nominees;

    const report = computeRiskReport(positions, nomineesByPosition);

    const empIds = [...new Set(positions.flatMap(p => p.currentHolderId ? [p.currentHolderId] : []))];
    const empMap = await fetchEmployeeNames(empIds, req.headers.authorization);
    report.rows = report.rows.map(r => ({ ...r, _currentHolder: empMap[r.currentHolderId] || null }));

    res.json(report);
  } catch (err) { next(err); }
});

// ── GET /performance/succession/dashboard ─────────────────────────────────────
router.get('/succession/dashboard', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const [positions, nominees] = await Promise.all([
      prisma.keyPosition.findMany({ where: { isActive: true } }),
      prisma.successorNominee.findMany(),
    ]);

    const dashboard = computeSuccessionDashboard(positions, nominees);

    // top high-risk positions (no READY_NOW)
    const nomineesByPosition = {};
    for (const n of nominees) {
      if (!nomineesByPosition[n.positionId]) nomineesByPosition[n.positionId] = [];
      nomineesByPosition[n.positionId].push(n);
    }
    const highRiskPositions = positions
      .filter(p => computePositionRisk(nomineesByPosition[p.id] || []) === 'HIGH')
      .map(p => ({ id: p.id, jobTitle: p.jobTitle, department: p.department, nomineeCount: (nomineesByPosition[p.id] || []).length }));

    res.json({ ...dashboard, highRiskPositions });
  } catch (err) { next(err); }
});

// ── GET /performance/succession/my-team ───────────────────────────────────────
// Manager sees which of their direct reports are nominated as successors + readiness
router.get('/succession/my-team', authenticate, async (req, res, next) => {
  try {
    const managerId = req.user.employeeId || req.user.sub;
    const authHeader = req.headers.authorization;

    // fetch subordinates from employee-service
    let subordinateIds = [];
    try {
      const r = await fetch(`${EMPLOYEE_URL}/employees/me/subordinates`, {
        headers: { Authorization: authHeader },
      });
      if (r.ok) {
        const data = await r.json();
        subordinateIds = (data.subordinates || data).map(e => e.id || e.employeeId);
      }
    } catch {}

    if (!subordinateIds.length) return res.json({ managerId, teamMembers: [] });

    // find nominees that are subordinates
    const nominees = await prisma.successorNominee.findMany({
      where: { employeeId: { in: subordinateIds } },
      include: { position: true },
    });

    const empMap = await fetchEmployeeNames(subordinateIds, authHeader);

    // group by employee
    const byEmployee = {};
    for (const n of nominees) {
      if (!byEmployee[n.employeeId]) {
        byEmployee[n.employeeId] = {
          employeeId: n.employeeId,
          _employee: empMap[n.employeeId] || null,
          nominations: [],
        };
      }
      byEmployee[n.employeeId].nominations.push({
        nomineeId: n.id,
        positionId: n.positionId,
        jobTitle: n.position.jobTitle,
        department: n.position.department,
        readiness: n.readiness,
        potentialBand: n.potentialBand,
      });
    }

    res.json({ managerId, teamMembers: Object.values(byEmployee) });
  } catch (err) { next(err); }
});

module.exports = router;
