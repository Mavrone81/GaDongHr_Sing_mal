'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();

const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER];

function isPrivileged(role) {
  return [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER].includes(role);
}

// ── GET /training/stats ── admin KPI summary ──────────────────────────────────
router.get('/stats', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const [totalPrograms, published, mandatory, totalEnrollments, completed, inProgress] = await Promise.all([
      prisma.trainingProgram.count(),
      prisma.trainingProgram.count({ where: { status: 'PUBLISHED' } }),
      prisma.trainingProgram.count({ where: { isMandatory: true, status: 'PUBLISHED' } }),
      prisma.trainingEnrollment.count(),
      prisma.trainingEnrollment.count({ where: { status: 'COMPLETED' } }),
      prisma.trainingEnrollment.count({ where: { status: 'IN_PROGRESS' } }),
    ]);

    const byCategory = await prisma.trainingProgram.groupBy({
      by: ['category'],
      _count: { id: true },
    });

    const completionRate = totalEnrollments > 0 ? Math.round((completed / totalEnrollments) * 100) : 0;

    res.json({ totalPrograms, published, mandatory, totalEnrollments, completed, inProgress, completionRate, byCategory });
  } catch (err) { next(err); }
});

// ── GET /training/programs ── list programs ───────────────────────────────────
router.get('/programs', authenticate, async (req, res, next) => {
  try {
    const { status, category, search, mandatory } = req.query;
    const employeeId = req.headers['x-employee-id'];
    const role = req.headers['x-user-role'];

    const where = {};
    // non-admins only see published programs
    if (!isPrivileged(role) && role !== ROLES.MANAGER) {
      where.status = 'PUBLISHED';
    } else {
      if (status) where.status = status;
    }
    if (category) where.category = category;
    if (mandatory === 'true') where.isMandatory = true;
    if (search) where.title = { contains: search, mode: 'insensitive' };

    const programs = await prisma.trainingProgram.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { materials: true, enrollments: true } },
        enrollments: employeeId ? { where: { employeeId }, select: { id: true, status: true, progress: true } } : false,
      },
    });

    res.json(programs);
  } catch (err) { next(err); }
});

// ── GET /training/programs/browse ── published programs employee hasn't enrolled ──
router.get('/programs/browse', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.headers['x-employee-id'];
    const { category } = req.query;
    const where = { status: 'PUBLISHED' };
    if (category) where.category = category;
    if (employeeId) {
      where.enrollments = { none: { employeeId } };
    }

    const programs = await prisma.trainingProgram.findMany({
      where,
      orderBy: [{ isMandatory: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { materials: true, enrollments: true } } },
    });
    res.json(programs);
  } catch (err) { next(err); }
});

// ── GET /training/programs/:id ── program detail with materials ───────────────
router.get('/programs/:id', authenticate, async (req, res, next) => {
  try {
    const program = await prisma.trainingProgram.findUnique({
      where: { id: req.params.id },
      include: {
        materials: { orderBy: { orderIndex: 'asc' } },
        _count: { select: { enrollments: true } },
      },
    });
    if (!program) return res.status(404).json({ error: 'Program not found' });
    res.json(program);
  } catch (err) { next(err); }
});

// ── POST /training/programs ── create program ─────────────────────────────────
router.post('/programs', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { title, description, category, durationMins, passingScore, isMandatory } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const createdBy = req.headers['x-employee-id'] || req.headers['x-user-id'] || 'system';
    const program = await prisma.trainingProgram.create({
      data: {
        id: uuidv4(), title, description, category: category || 'TECHNICAL',
        durationMins: durationMins ? Number(durationMins) : null,
        passingScore: passingScore ? Number(passingScore) : null,
        isMandatory: isMandatory === true || isMandatory === 'true',
        createdBy,
      },
    });
    res.status(201).json(program);
  } catch (err) { next(err); }
});

// ── PUT /training/programs/:id ── update program ──────────────────────────────
router.put('/programs/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { title, description, category, status, durationMins, passingScore, isMandatory } = req.body;
    const existing = await prisma.trainingProgram.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Program not found' });

    const program = await prisma.trainingProgram.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(status !== undefined && { status }),
        ...(durationMins !== undefined && { durationMins: durationMins ? Number(durationMins) : null }),
        ...(passingScore !== undefined && { passingScore: passingScore ? Number(passingScore) : null }),
        ...(isMandatory !== undefined && { isMandatory: isMandatory === true || isMandatory === 'true' }),
      },
    });
    res.json(program);
  } catch (err) { next(err); }
});

// ── DELETE /training/programs/:id ── archive program ─────────────────────────
router.delete('/programs/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.trainingProgram.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Program not found' });
    await prisma.trainingProgram.update({ where: { id: req.params.id }, data: { status: 'ARCHIVED' } });
    res.json({ message: 'Program archived' });
  } catch (err) { next(err); }
});

// ── GET /training/programs/:id/stats ── per-program stats ────────────────────
router.get('/programs/:id/stats', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const enrollments = await prisma.trainingEnrollment.findMany({
      where: { programId: req.params.id },
      select: { status: true, progress: true, score: true },
    });
    const byStatus = { ENROLLED: 0, IN_PROGRESS: 0, COMPLETED: 0, DROPPED: 0 };
    let totalProgress = 0;
    let totalScore = 0; let scoredCount = 0;
    for (const e of enrollments) {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      totalProgress += e.progress;
      if (e.score !== null) { totalScore += e.score; scoredCount++; }
    }
    const avgProgress = enrollments.length ? Math.round(totalProgress / enrollments.length) : 0;
    const avgScore = scoredCount ? Math.round(totalScore / scoredCount) : null;
    const completionRate = enrollments.length ? Math.round((byStatus.COMPLETED / enrollments.length) * 100) : 0;
    res.json({ totalEnrolled: enrollments.length, byStatus, avgProgress, avgScore, completionRate });
  } catch (err) { next(err); }
});

// ── POST /training/programs/:id/materials ── add material ─────────────────────
router.post('/programs/:id/materials', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { title, type, url, content, orderIndex, durationMins } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const program = await prisma.trainingProgram.findUnique({ where: { id: req.params.id } });
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const material = await prisma.trainingMaterial.create({
      data: {
        id: uuidv4(), programId: req.params.id, title,
        type: type || 'DOCUMENT', url, content,
        orderIndex: orderIndex !== undefined ? Number(orderIndex) : 0,
        durationMins: durationMins ? Number(durationMins) : null,
      },
    });
    res.status(201).json(material);
  } catch (err) { next(err); }
});

// ── PUT /training/materials/:id ── update material ────────────────────────────
router.put('/materials/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { title, type, url, content, orderIndex, durationMins } = req.body;
    const existing = await prisma.trainingMaterial.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Material not found' });

    const material = await prisma.trainingMaterial.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(type !== undefined && { type }),
        ...(url !== undefined && { url }),
        ...(content !== undefined && { content }),
        ...(orderIndex !== undefined && { orderIndex: Number(orderIndex) }),
        ...(durationMins !== undefined && { durationMins: durationMins ? Number(durationMins) : null }),
      },
    });
    res.json(material);
  } catch (err) { next(err); }
});

// ── DELETE /training/materials/:id ── delete material ────────────────────────
router.delete('/materials/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.trainingMaterial.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Material not found' });
    await prisma.trainingMaterial.delete({ where: { id: req.params.id } });
    res.json({ message: 'Material deleted' });
  } catch (err) { next(err); }
});

// ── GET /training/enrollments ── admin: all enrollments ───────────────────────
router.get('/enrollments', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { programId, employeeId, status } = req.query;
    const where = {};
    if (programId) where.programId = programId;
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;

    const enrollments = await prisma.trainingEnrollment.findMany({
      where,
      orderBy: { enrolledAt: 'desc' },
      include: { program: { select: { id: true, title: true, category: true } } },
    });
    res.json(enrollments);
  } catch (err) { next(err); }
});

// ── GET /training/my-programs ── employee: own enrollments with material progress ──
router.get('/my-programs', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.headers['x-employee-id'];
    if (!employeeId) return res.status(400).json({ error: 'No employee context' });

    const enrollments = await prisma.trainingEnrollment.findMany({
      where: { employeeId, status: { not: 'DROPPED' } },
      orderBy: [{ status: 'asc' }, { enrolledAt: 'desc' }],
      include: {
        program: {
          include: { materials: { orderBy: { orderIndex: 'asc' } }, _count: { select: { materials: true } } },
        },
        materialProgress: true,
      },
    });
    res.json(enrollments);
  } catch (err) { next(err); }
});

// ── POST /training/enrollments/:id/materials/:materialId/complete ── mark material done ──
router.post('/enrollments/:id/materials/:materialId/complete', authenticate, async (req, res, next) => {
  try {
    const { id: enrollmentId, materialId } = req.params;
    const { quizAnswers } = req.body;
    const employeeId = req.headers['x-employee-id'];
    const role = req.headers['x-user-role'];

    const enrollment = await prisma.trainingEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { program: { include: { materials: { orderBy: { orderIndex: 'asc' } } } } },
    });
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    if (!isPrivileged(role) && enrollment.employeeId !== employeeId) return res.status(403).json({ error: 'Forbidden' });
    if (enrollment.status === 'DROPPED') return res.status(400).json({ error: 'Enrollment is dropped' });

    const material = enrollment.program.materials.find(m => m.id === materialId);
    if (!material) return res.status(404).json({ error: 'Material not in this program' });

    // Score quiz materials
    let quizScore = null;
    if (material.type === 'QUIZ' && material.content && quizAnswers) {
      try {
        const raw = JSON.parse(material.content);
        const questions = Array.isArray(raw) ? raw : (raw.questions || []);
        const correct = questions.filter(q => quizAnswers[q.id] === q.correct).length;
        quizScore = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 100;
      } catch { quizScore = 100; }
    }

    await prisma.trainingMaterialProgress.upsert({
      where: { enrollmentId_materialId: { enrollmentId, materialId } },
      create: { id: uuidv4(), enrollmentId, materialId, score: quizScore },
      update: { completedAt: new Date(), score: quizScore },
    });

    // Recalculate overall progress
    const completedCount = await prisma.trainingMaterialProgress.count({ where: { enrollmentId } });
    const totalCount = enrollment.program.materials.length;
    const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100;

    const now = new Date();
    let status = enrollment.status;
    let startedAt = enrollment.startedAt;
    let completedAt = enrollment.completedAt;
    let finalScore = enrollment.score;

    if (status === 'ENROLLED') { status = 'IN_PROGRESS'; startedAt = now; }

    if (progress === 100) {
      const passingScore = enrollment.program.passingScore || 70;
      const quizMaterials = enrollment.program.materials.filter(m => m.type === 'QUIZ');
      if (quizMaterials.length > 0) {
        const quizRows = await prisma.trainingMaterialProgress.findMany({
          where: { enrollmentId, materialId: { in: quizMaterials.map(m => m.id) } },
        });
        const avg = quizRows.length > 0
          ? Math.round(quizRows.reduce((s, r) => s + (r.score ?? 0), 0) / quizRows.length)
          : 0;
        finalScore = avg;
        if (avg >= passingScore) { status = 'COMPLETED'; completedAt = now; }
      } else {
        status = 'COMPLETED'; completedAt = now;
      }
    }

    const updated = await prisma.trainingEnrollment.update({
      where: { id: enrollmentId },
      data: { progress, status, startedAt, completedAt, score: finalScore },
    });

    res.json({ enrollment: updated, materialScore: quizScore, progress, completedCount, totalCount });
  } catch (err) { next(err); }
});

// ── POST /training/programs/:id/enroll ── admin enroll employee(s) ────────────
router.post('/programs/:id/enroll', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { employeeIds, dueDate } = req.body;
    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ error: 'employeeIds array is required' });
    }
    const program = await prisma.trainingProgram.findUnique({ where: { id: req.params.id } });
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const enrolledBy = req.headers['x-employee-id'] || req.headers['x-user-id'] || 'admin';
    const results = [];
    for (const eid of employeeIds) {
      try {
        const enrollment = await prisma.trainingEnrollment.upsert({
          where: { programId_employeeId: { programId: req.params.id, employeeId: eid } },
          create: {
            id: uuidv4(), programId: req.params.id, employeeId: eid, enrolledBy,
            dueDate: dueDate ? new Date(dueDate) : null,
          },
          update: {
            status: 'ENROLLED', progress: 0, enrolledBy,
            dueDate: dueDate ? new Date(dueDate) : undefined,
          },
        });
        results.push({ employeeId: eid, enrollmentId: enrollment.id, status: 'enrolled' });
      } catch {
        results.push({ employeeId: eid, status: 'failed' });
      }
    }
    res.status(201).json({ enrolled: results.filter(r => r.status === 'enrolled').length, results });
  } catch (err) { next(err); }
});

// ── POST /training/programs/:id/self-enroll ── employee self-enroll ───────────
router.post('/programs/:id/self-enroll', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.headers['x-employee-id'];
    if (!employeeId) return res.status(400).json({ error: 'No employee context' });

    const program = await prisma.trainingProgram.findUnique({ where: { id: req.params.id } });
    if (!program) return res.status(404).json({ error: 'Program not found' });
    if (program.status !== 'PUBLISHED') return res.status(400).json({ error: 'Program is not available for enrollment' });

    const existing = await prisma.trainingEnrollment.findUnique({
      where: { programId_employeeId: { programId: req.params.id, employeeId } },
    });
    if (existing && existing.status !== 'DROPPED') {
      return res.status(409).json({ error: 'Already enrolled in this program' });
    }

    const enrollment = await prisma.trainingEnrollment.upsert({
      where: { programId_employeeId: { programId: req.params.id, employeeId } },
      create: { id: uuidv4(), programId: req.params.id, employeeId, status: 'ENROLLED' },
      update: { status: 'ENROLLED', progress: 0, startedAt: null, completedAt: null },
    });
    res.status(201).json(enrollment);
  } catch (err) { next(err); }
});

// ── PUT /training/enrollments/:id/progress ── update progress ─────────────────
router.put('/enrollments/:id/progress', authenticate, async (req, res, next) => {
  try {
    const { progress, score } = req.body;
    const employeeId = req.headers['x-employee-id'];
    const role = req.headers['x-user-role'];

    const enrollment = await prisma.trainingEnrollment.findUnique({ where: { id: req.params.id } });
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

    // employees can only update their own enrollment
    if (!isPrivileged(role) && enrollment.employeeId !== employeeId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const pct = Math.min(100, Math.max(0, Number(progress ?? enrollment.progress)));
    let status = enrollment.status;
    const now = new Date();
    const updates = { progress: pct };

    if (status === 'ENROLLED' && pct > 0) { updates.status = 'IN_PROGRESS'; updates.startedAt = enrollment.startedAt || now; status = 'IN_PROGRESS'; }
    if (pct === 100) { updates.status = 'COMPLETED'; updates.completedAt = now; }
    if (score !== undefined) updates.score = Math.min(100, Math.max(0, Number(score)));

    const updated = await prisma.trainingEnrollment.update({ where: { id: req.params.id }, data: updates });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── DELETE /training/enrollments/:id ── drop enrollment ──────────────────────
router.delete('/enrollments/:id', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.headers['x-employee-id'];
    const role = req.headers['x-user-role'];

    const enrollment = await prisma.trainingEnrollment.findUnique({ where: { id: req.params.id } });
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

    if (!isPrivileged(role) && enrollment.employeeId !== employeeId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (enrollment.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Cannot drop a completed enrollment' });
    }

    await prisma.trainingEnrollment.update({ where: { id: req.params.id }, data: { status: 'DROPPED' } });
    res.json({ message: 'Enrollment dropped' });
  } catch (err) { next(err); }
});

module.exports = router;
