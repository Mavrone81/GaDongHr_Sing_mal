'use strict';
/**
 * Competency framework (TRN-004).
 *
 *   /competencies                                 — list/create skills
 *   /competencies/:id                             — read/update/delete
 *   /programs/:programId/competencies             — link/unlink a program teaches a competency at a given level
 *   /job-families/:family/competencies            — list/set the required level per competency for a job family
 *   /employees/:employeeId/competencies           — assessed levels for one employee
 *   /employees/:employeeId/competencies/gap       — gap vs the given job family's required levels
 */

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = require('../utils/prisma');
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER];

function clampLevel(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return null;
  return Math.max(1, Math.min(5, Math.round(v)));
}

// ── Competencies CRUD ─────────────────────────────────────────────────────────
router.get('/competencies', authenticate, async (req, res, next) => {
  try {
    const { category, isActive } = req.query;
    const where = {};
    if (category) where.category = category;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    const comps = await prisma.competency.findMany({ where, orderBy: { name: 'asc' } });
    res.json(comps);
  } catch (err) { next(err); }
});

router.post('/competencies', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { name, description, category } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const comp = await prisma.competency.create({
      data: { id: uuidv4(), name, description, category },
    });
    res.status(201).json(comp);
  } catch (err) { next(err); }
});

router.get('/competencies/:id', authenticate, async (req, res, next) => {
  try {
    const comp = await prisma.competency.findUnique({
      where: { id: req.params.id },
      include: {
        programs: { include: { program: { select: { id: true, title: true, status: true } } } },
        jobFamilyRequirements: true,
      },
    });
    if (!comp) return res.status(404).json({ error: 'Competency not found' });
    res.json(comp);
  } catch (err) { next(err); }
});

router.put('/competencies/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { name, description, category, isActive } = req.body;
    const comp = await prisma.competency.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(isActive !== undefined && { isActive: !!isActive }),
      },
    });
    res.json(comp);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Competency not found' });
    next(err);
  }
});

router.delete('/competencies/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    await prisma.competency.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Competency deactivated' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Competency not found' });
    next(err);
  }
});

// ── Program ↔ Competency mapping ──────────────────────────────────────────────
router.post(
  '/programs/:programId/competencies',
  authenticate, authorize(...ADMIN_ROLES),
  async (req, res, next) => {
    try {
      const { competencyId, taughtLevel } = req.body;
      const level = clampLevel(taughtLevel);
      if (!competencyId || !level) {
        return res.status(400).json({ error: 'competencyId and taughtLevel (1-5) are required' });
      }
      const link = await prisma.programCompetency.upsert({
        where: { programId_competencyId: { programId: req.params.programId, competencyId } },
        create: { id: uuidv4(), programId: req.params.programId, competencyId, taughtLevel: level },
        update: { taughtLevel: level },
      });
      res.status(201).json(link);
    } catch (err) { next(err); }
  },
);

router.delete(
  '/programs/:programId/competencies/:competencyId',
  authenticate, authorize(...ADMIN_ROLES),
  async (req, res, next) => {
    try {
      await prisma.programCompetency.delete({
        where: {
          programId_competencyId: {
            programId: req.params.programId,
            competencyId: req.params.competencyId,
          },
        },
      });
      res.json({ message: 'Program-competency mapping removed' });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Mapping not found' });
      next(err);
    }
  },
);

// ── Job family required competencies ──────────────────────────────────────────
router.get(
  '/job-families/:family/competencies',
  authenticate, authorize(...ADMIN_ROLES),
  async (req, res, next) => {
    try {
      const reqs = await prisma.jobFamilyCompetency.findMany({
        where: { jobFamily: req.params.family },
        include: { competency: true },
        orderBy: { requiredLevel: 'desc' },
      });
      res.json(reqs);
    } catch (err) { next(err); }
  },
);

router.post(
  '/job-families/:family/competencies',
  authenticate, authorize(...ADMIN_ROLES),
  async (req, res, next) => {
    try {
      const { competencyId, requiredLevel } = req.body;
      const level = clampLevel(requiredLevel);
      if (!competencyId || !level) {
        return res.status(400).json({ error: 'competencyId and requiredLevel (1-5) are required' });
      }
      const row = await prisma.jobFamilyCompetency.upsert({
        where: { jobFamily_competencyId: { jobFamily: req.params.family, competencyId } },
        create: { id: uuidv4(), jobFamily: req.params.family, competencyId, requiredLevel: level },
        update: { requiredLevel: level },
      });
      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

router.delete(
  '/job-families/:family/competencies/:competencyId',
  authenticate, authorize(...ADMIN_ROLES),
  async (req, res, next) => {
    try {
      await prisma.jobFamilyCompetency.delete({
        where: {
          jobFamily_competencyId: {
            jobFamily: req.params.family,
            competencyId: req.params.competencyId,
          },
        },
      });
      res.json({ message: 'Required competency removed from job family' });
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Mapping not found' });
      next(err);
    }
  },
);

// ── Employee assessments ──────────────────────────────────────────────────────
router.get(
  '/employees/:employeeId/competencies',
  authenticate,
  async (req, res, next) => {
    try {
      const employeeId = req.params.employeeId;
      const role = req.headers['x-user-role'];
      const self = req.headers['x-employee-id'];
      // Employees may read their own assessments. Managers+admins may read any.
      const isAdmin = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER].includes(role);
      if (!isAdmin && self !== employeeId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const assessments = await prisma.employeeCompetency.findMany({
        where: { employeeId },
        include: { competency: true },
        orderBy: { assessedAt: 'desc' },
      });
      res.json(assessments);
    } catch (err) { next(err); }
  },
);

router.put(
  '/employees/:employeeId/competencies/:competencyId',
  authenticate, authorize(...ADMIN_ROLES, ROLES.LINE_MANAGER),
  async (req, res, next) => {
    try {
      const { assessedLevel, notes } = req.body;
      const level = clampLevel(assessedLevel);
      if (!level) return res.status(400).json({ error: 'assessedLevel (1-5) is required' });
      const assessedBy = req.headers['x-employee-id'] || req.headers['x-user-id'] || 'system';
      const row = await prisma.employeeCompetency.upsert({
        where: {
          employeeId_competencyId: {
            employeeId: req.params.employeeId,
            competencyId: req.params.competencyId,
          },
        },
        create: {
          id: uuidv4(),
          employeeId: req.params.employeeId,
          competencyId: req.params.competencyId,
          assessedLevel: level, notes: notes || null, assessedBy,
        },
        update: { assessedLevel: level, notes: notes || null, assessedBy, assessedAt: new Date() },
      });
      res.json(row);
    } catch (err) { next(err); }
  },
);

// ── Gap analysis: required (per job family) vs assessed (for the employee) ────
// Returns each required competency with assessedLevel, requiredLevel, gap, and
// recommended programs (those mapped to the competency at taughtLevel ≥ gap).
router.get(
  '/employees/:employeeId/competencies/gap',
  authenticate,
  async (req, res, next) => {
    try {
      const { jobFamily } = req.query;
      if (!jobFamily) return res.status(400).json({ error: 'jobFamily query param is required' });

      const employeeId = req.params.employeeId;
      const role = req.headers['x-user-role'];
      const self = req.headers['x-employee-id'];
      const isAdmin = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER].includes(role);
      if (!isAdmin && self !== employeeId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const requirements = await prisma.jobFamilyCompetency.findMany({
        where: { jobFamily },
        include: {
          competency: {
            include: { programs: { include: { program: { select: { id: true, title: true, status: true } } } } },
          },
        },
      });

      const assessments = await prisma.employeeCompetency.findMany({
        where: { employeeId, competencyId: { in: requirements.map(r => r.competencyId) } },
      });
      const byCompId = Object.fromEntries(assessments.map(a => [a.competencyId, a.assessedLevel]));

      const gaps = requirements.map(r => {
        const assessed = byCompId[r.competencyId] ?? 0;
        const gap = Math.max(0, r.requiredLevel - assessed);
        const recommendedPrograms = gap > 0
          ? r.competency.programs
              .filter(pc => pc.taughtLevel >= r.requiredLevel && pc.program?.status === 'PUBLISHED')
              .map(pc => ({ programId: pc.program.id, title: pc.program.title, taughtLevel: pc.taughtLevel }))
          : [];
        return {
          competencyId: r.competencyId,
          competencyName: r.competency.name,
          requiredLevel: r.requiredLevel,
          assessedLevel: assessed,
          gap,
          recommendedPrograms,
        };
      });

      res.json({ employeeId, jobFamily, requirements: gaps });
    } catch (err) { next(err); }
  },
);

module.exports = router;
module.exports.clampLevel = clampLevel;
