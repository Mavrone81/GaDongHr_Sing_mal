'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { compute360Score, blendScores, buildReport } = require('../engines/feedback360.engine');

const prisma = require('../utils/prisma');

const VALID_REVIEWER_TYPES = ['PEER', 'SUBORDINATE', 'SUPERVISOR'];
const VALID_QUESTION_TYPES = ['RATING', 'TEXT'];

// ─── Questions ────────────────────────────────────────────────────────────────

// POST /performance/cycles/:id/360/questions — HR creates questions for the cycle
router.post('/cycles/:id/360/questions',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const cycle = await prisma.reviewCycle.findUnique({ where: { id: req.params.id } });
      if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

      const { questionText, questionType = 'RATING', category, weight = 1.0, displayOrder = 0 } = req.body;
      if (!questionText) return res.status(400).json({ error: 'questionText is required' });
      if (!VALID_QUESTION_TYPES.includes(questionType)) {
        return res.status(400).json({ error: 'questionType must be RATING or TEXT' });
      }

      const question = await prisma.feedbackQuestion.create({
        data: {
          id: uuidv4(),
          cycleId: req.params.id,
          questionText,
          questionType,
          category: category || null,
          weight: parseFloat(weight) || 1.0,
          displayOrder: parseInt(displayOrder, 10) || 0,
        },
      });
      res.status(201).json(question);
    } catch (err) { next(err); }
  }
);

// GET /performance/cycles/:id/360/questions
router.get('/cycles/:id/360/questions',
  authenticate,
  async (req, res, next) => {
    try {
      const questions = await prisma.feedbackQuestion.findMany({
        where: { cycleId: req.params.id },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      });
      res.json(questions);
    } catch (err) { next(err); }
  }
);

// DELETE /performance/cycles/:id/360/questions/:qid
router.delete('/cycles/:id/360/questions/:qid',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const q = await prisma.feedbackQuestion.findFirst({
        where: { id: req.params.qid, cycleId: req.params.id },
      });
      if (!q) return res.status(404).json({ error: 'Question not found' });
      await prisma.feedbackQuestion.delete({ where: { id: req.params.qid } });
      res.json({ message: 'Question deleted' });
    } catch (err) { next(err); }
  }
);

// PUT /performance/cycles/:id/feedback-weight — set 360 weight in overall score
router.put('/cycles/:id/feedback-weight',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const { feedbackWeight } = req.body;
      if (feedbackWeight === undefined) return res.status(400).json({ error: 'feedbackWeight is required (0.0–1.0)' });
      const w = parseFloat(feedbackWeight);
      if (isNaN(w) || w < 0 || w > 1) return res.status(400).json({ error: 'feedbackWeight must be 0.0–1.0' });

      const cycle = await prisma.reviewCycle.update({
        where: { id: req.params.id },
        data: { feedbackWeight: w },
      });
      res.json(cycle);
    } catch (err) {
      if (err.code === 'P2025') return res.status(404).json({ error: 'Cycle not found' });
      next(err);
    }
  }
);

// ─── Nominations ──────────────────────────────────────────────────────────────

// POST /performance/cycles/:id/360/nominations — employee nominates reviewers
router.post('/cycles/:id/360/nominations',
  authenticate,
  async (req, res, next) => {
    try {
      const cycle = await prisma.reviewCycle.findUnique({ where: { id: req.params.id } });
      if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

      const subjectEmployeeId = req.user.employeeId;
      if (!subjectEmployeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });

      const { nominations } = req.body;
      if (!Array.isArray(nominations) || !nominations.length) {
        return res.status(400).json({ error: 'nominations array is required' });
      }

      const created = [];
      const skipped = [];

      for (const nom of nominations) {
        const { reviewerEmployeeId, reviewerType } = nom;
        if (!reviewerEmployeeId || !reviewerType) {
          skipped.push({ ...nom, reason: 'reviewerEmployeeId and reviewerType are required' });
          continue;
        }
        if (!VALID_REVIEWER_TYPES.includes(reviewerType)) {
          skipped.push({ ...nom, reason: `reviewerType must be one of ${VALID_REVIEWER_TYPES.join(', ')}` });
          continue;
        }
        if (reviewerEmployeeId === subjectEmployeeId) {
          skipped.push({ ...nom, reason: 'Cannot nominate yourself' });
          continue;
        }

        const existing = await prisma.feedbackRequest.findUnique({
          where: { cycleId_subjectEmployeeId_reviewerEmployeeId: { cycleId: req.params.id, subjectEmployeeId, reviewerEmployeeId } },
        });
        if (existing) {
          skipped.push({ ...nom, reason: 'Already nominated' });
          continue;
        }

        const req_ = await prisma.feedbackRequest.create({
          data: {
            id: uuidv4(),
            cycleId: req.params.id,
            subjectEmployeeId,
            reviewerEmployeeId,
            reviewerType,
            nominatedBy: subjectEmployeeId,
          },
        });
        created.push(req_);
      }

      res.status(201).json({ created: created.length, skipped: skipped.length, nominations: created, skippedDetails: skipped });
    } catch (err) { next(err); }
  }
);

// GET /performance/cycles/:id/360/nominations — list nominations
// HR sees all; employee sees only their own (as subject)
router.get('/cycles/:id/360/nominations',
  authenticate,
  async (req, res, next) => {
    try {
      const role = req.user.role;
      const empId = req.user.employeeId;
      const { status, subjectEmployeeId } = req.query;

      const where = { cycleId: req.params.id };
      if (status) where.status = status;

      if (['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'].includes(role)) {
        if (subjectEmployeeId) where.subjectEmployeeId = subjectEmployeeId;
      } else {
        where.subjectEmployeeId = empId;
      }

      const nominations = await prisma.feedbackRequest.findMany({
        where,
        orderBy: { nominatedAt: 'desc' },
      });
      res.json(nominations);
    } catch (err) { next(err); }
  }
);

// PUT /performance/cycles/:id/360/nominations/:nomId/approve
router.put('/cycles/:id/360/nominations/:nomId/approve',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const nom = await prisma.feedbackRequest.findFirst({
        where: { id: req.params.nomId, cycleId: req.params.id },
      });
      if (!nom) return res.status(404).json({ error: 'Nomination not found' });
      if (nom.status !== 'PENDING_APPROVAL') {
        return res.status(409).json({ error: `Cannot approve from status ${nom.status}` });
      }

      const updated = await prisma.feedbackRequest.update({
        where: { id: req.params.nomId },
        data: { status: 'APPROVED', approvedBy: req.user.sub, approvedAt: new Date() },
      });
      res.json(updated);
    } catch (err) { next(err); }
  }
);

// PUT /performance/cycles/:id/360/nominations/:nomId/decline
router.put('/cycles/:id/360/nominations/:nomId/decline',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const nom = await prisma.feedbackRequest.findFirst({
        where: { id: req.params.nomId, cycleId: req.params.id },
      });
      if (!nom) return res.status(404).json({ error: 'Nomination not found' });
      if (!['PENDING_APPROVAL', 'APPROVED'].includes(nom.status)) {
        return res.status(409).json({ error: `Cannot decline from status ${nom.status}` });
      }

      const { reason } = req.body;
      const updated = await prisma.feedbackRequest.update({
        where: { id: req.params.nomId },
        data: { status: 'DECLINED', declinedReason: reason || null },
      });
      res.json(updated);
    } catch (err) { next(err); }
  }
);

// ─── Review submission (anonymous) ───────────────────────────────────────────

// GET /performance/cycles/:id/360/my-reviews — reviewer sees their approved requests
router.get('/cycles/:id/360/my-reviews',
  authenticate,
  async (req, res, next) => {
    try {
      const reviewerEmployeeId = req.user.employeeId;
      if (!reviewerEmployeeId) return res.status(400).json({ error: 'No employee profile linked' });

      const requests = await prisma.feedbackRequest.findMany({
        where: { cycleId: req.params.id, reviewerEmployeeId, status: { in: ['APPROVED', 'SUBMITTED'] } },
        // Do NOT include subjectEmployeeId in response to preserve anonymity direction
        // (reviewer can see who they are reviewing — they nominated themselves or were approved)
        orderBy: { approvedAt: 'desc' },
      });

      const questions = await prisma.feedbackQuestion.findMany({
        where: { cycleId: req.params.id },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      });

      res.json({ requests, questions });
    } catch (err) { next(err); }
  }
);

// POST /performance/360/submit/:requestId — reviewer submits responses (anonymous)
router.post('/360/submit/:requestId',
  authenticate,
  async (req, res, next) => {
    try {
      const reviewerEmployeeId = req.user.employeeId;
      const request = await prisma.feedbackRequest.findUnique({
        where: { id: req.params.requestId },
        include: { responses: true },
      });

      if (!request) return res.status(404).json({ error: 'Feedback request not found' });
      if (request.reviewerEmployeeId !== reviewerEmployeeId) {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (request.status === 'SUBMITTED') {
        return res.status(409).json({ error: 'Feedback already submitted' });
      }
      if (request.status !== 'APPROVED') {
        return res.status(409).json({ error: `Cannot submit feedback — request status is ${request.status}` });
      }

      const { responses } = req.body;
      if (!Array.isArray(responses) || !responses.length) {
        return res.status(400).json({ error: 'responses array is required' });
      }

      // Validate question IDs belong to the cycle
      const questions = await prisma.feedbackQuestion.findMany({
        where: { cycleId: request.cycleId },
        select: { id: true, questionType: true },
      });
      const validIds = new Set(questions.map(q => q.id));

      const toCreate = [];
      for (const r of responses) {
        if (!r.questionId) continue;
        if (!validIds.has(r.questionId)) continue;
        const q = questions.find(q => q.id === r.questionId);
        if (q.questionType === 'RATING' && r.ratingValue != null) {
          const v = parseFloat(r.ratingValue);
          if (isNaN(v) || v < 1 || v > 5) {
            return res.status(400).json({ error: `ratingValue for question ${r.questionId} must be 1–5` });
          }
        }
        const existing = request.responses.find(e => e.questionId === r.questionId);
        if (!existing) {
          toCreate.push({
            id: uuidv4(),
            requestId: request.id,
            questionId: r.questionId,
            ratingValue: r.ratingValue != null ? parseFloat(r.ratingValue) : null,
            textValue: r.textValue || null,
          });
        }
      }

      await prisma.$transaction([
        ...toCreate.map(d => prisma.feedbackResponse.create({ data: d })),
        prisma.feedbackRequest.update({
          where: { id: request.id },
          data: { status: 'SUBMITTED', submittedAt: new Date() },
        }),
      ]);

      // Return without reviewer identity information
      res.json({ submitted: true, requestId: request.id, responsesRecorded: toCreate.length });
    } catch (err) { next(err); }
  }
);

// ─── Report (anonymous aggregate) ────────────────────────────────────────────

// GET /performance/cycles/:id/360/report/:employeeId — aggregated 360 report
// HR Admin, HR Manager, and the subject employee's assigned manager can view.
router.get('/cycles/:id/360/report/:employeeId',
  authenticate,
  async (req, res, next) => {
    try {
      const role = req.user.role;
      const empId = req.user.employeeId;

      // Employees can only see their own report
      if (!['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'MANAGER'].includes(role)) {
        if (req.params.employeeId !== empId) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      const [questions, requests] = await Promise.all([
        prisma.feedbackQuestion.findMany({
          where: { cycleId: req.params.id },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        prisma.feedbackRequest.findMany({
          where: { cycleId: req.params.id, subjectEmployeeId: req.params.employeeId },
          include: { responses: true },
        }),
      ]);

      const report = buildReport(questions, requests);

      res.json({
        cycleId: req.params.id,
        subjectEmployeeId: req.params.employeeId,
        ...report,
      });
    } catch (err) { next(err); }
  }
);

// ─── Apply 360 scores to appraisals ──────────────────────────────────────────

// POST /performance/cycles/:id/360/apply — compute score360 + blend into overallScore
router.post('/cycles/:id/360/apply',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const cycle = await prisma.reviewCycle.findUnique({
        where: { id: req.params.id },
        select: { id: true, feedbackWeight: true },
      });
      if (!cycle) return res.status(404).json({ error: 'Cycle not found' });

      const feedbackWeight = cycle.feedbackWeight || 0;

      const [appraisals, questions] = await Promise.all([
        prisma.appraisal.findMany({ where: { cycleId: req.params.id } }),
        prisma.feedbackQuestion.findMany({ where: { cycleId: req.params.id } }),
      ]);

      let updated = 0;
      let skipped = 0;
      const results = [];

      for (const ap of appraisals) {
        const requests = await prisma.feedbackRequest.findMany({
          where: { cycleId: req.params.id, subjectEmployeeId: ap.employeeId, status: 'SUBMITTED' },
          include: { responses: true },
        });

        const responseSets = requests.map(r => r.responses);
        const score360 = compute360Score(questions, responseSets);

        if (score360 == null) { skipped++; continue; }

        const baseScore = ap.calibratedScore ?? ap.overallScore ?? 0;
        const blended = blendScores(baseScore, score360, feedbackWeight);

        await prisma.appraisal.update({
          where: { id: ap.id },
          data: {
            score360,
            ...(feedbackWeight > 0 && baseScore > 0 ? { overallScore: blended } : {}),
          },
        });

        updated++;
        results.push({ employeeId: ap.employeeId, score360, blendedOverallScore: feedbackWeight > 0 ? blended : null });
      }

      res.json({
        cycleId: req.params.id,
        feedbackWeight,
        updated,
        skipped,
        results,
      });
    } catch (err) { next(err); }
  }
);

module.exports = router;
