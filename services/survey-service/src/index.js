'use strict';
require('dotenv').config();
const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const morgan   = require('morgan');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const {
  SURVEY_TYPES, SURVEY_STATUSES, QUESTION_TYPES, ACTION_STATUSES,
  computeENPS, computeLikertStats, computeMultiChoiceStats,
  buildSurveyDashboard, validateAnswers,
} = require('./engines/survey.engine');

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.PORT || 4019;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '256kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'survey-service', status: 'ok', ts: new Date() }));

const HR_ROLES = [ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.SUPER_ADMIN];
const MGR_ROLES = [ROLES.LINE_MANAGER, ...HR_ROLES];
function isHr(role) { return HR_ROLES.includes(role); }

function ipHashFor(req) {
  const ip = req.headers['x-forwarded-for'] || req.ip || '';
  return crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 32);
}

// ── Survey CRUD ──────────────────────────────────────────────────────────────

// POST /surveys — HR creates
app.post('/surveys', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const {
      code, title, description, type, anonymous, minResponsesToShow,
      targetDepartment, targetMinTenureMonths, dueDate,
    } = req.body;
    if (!code || !code.trim())                  return res.status(400).json({ error: 'code is required' });
    if (!title || !title.trim())                return res.status(400).json({ error: 'title is required' });
    if (!type || !SURVEY_TYPES.includes(type))  return res.status(400).json({ error: `type must be one of: ${SURVEY_TYPES.join(', ')}` });

    const survey = await prisma.survey.create({
      data: {
        id: uuidv4(),
        code: code.trim().toUpperCase(),
        title: title.trim(),
        description: description?.trim() || null,
        type,
        anonymous: anonymous === false ? false : true,
        minResponsesToShow: minResponsesToShow !== undefined ? Math.max(1, parseInt(minResponsesToShow)) : 3,
        targetDepartment: targetDepartment?.trim() || null,
        targetMinTenureMonths: targetMinTenureMonths !== undefined ? parseInt(targetMinTenureMonths) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        createdBy: req.user.sub,
        createdByName: req.user.name || null,
      },
    });
    res.status(201).json(survey);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A survey with this code already exists' });
    next(err);
  }
});

// GET /surveys — list. Employees see ACTIVE only (and matching their target filters in practice).
app.get('/surveys', authenticate, async (req, res, next) => {
  try {
    const { status, type } = req.query;
    const where = {};
    if (!isHr(req.user.role)) {
      where.status = 'ACTIVE';
    } else if (status) {
      where.status = status;
    }
    if (type) where.type = type;
    const surveys = await prisma.survey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { responses: true, questions: true } } },
    });
    res.json({ surveys, total: surveys.length });
  } catch (err) { next(err); }
});

// GET /surveys/:id
app.get('/surveys/:id', authenticate, async (req, res, next) => {
  try {
    const s = await prisma.survey.findUnique({
      where: { id: req.params.id },
      include: { questions: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!s) return res.status(404).json({ error: 'Survey not found' });
    // Non-HR can only fetch ACTIVE surveys
    if (!isHr(req.user.role) && s.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(s);
  } catch (err) { next(err); }
});

// PUT /surveys/:id — HR updates (only meta + while DRAFT/ACTIVE)
app.put('/surveys/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.survey.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Survey not found' });

    const f = req.body, data = {};
    if (f.title !== undefined)             data.title = f.title.trim();
    if (f.description !== undefined)       data.description = f.description?.trim() || null;
    if (f.minResponsesToShow !== undefined) data.minResponsesToShow = Math.max(1, parseInt(f.minResponsesToShow));
    if (f.targetDepartment !== undefined)  data.targetDepartment = f.targetDepartment?.trim() || null;
    if (f.dueDate !== undefined)           data.dueDate = f.dueDate ? new Date(f.dueDate) : null;
    const updated = await prisma.survey.update({ where: { id: existing.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /surveys/:id/publish — DRAFT → ACTIVE
app.post('/surveys/:id/publish', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const s = await prisma.survey.findUnique({ where: { id: req.params.id }, include: { questions: true } });
    if (!s) return res.status(404).json({ error: 'Survey not found' });
    if (s.status !== 'DRAFT') return res.status(409).json({ error: `Cannot publish survey in status ${s.status}` });
    if (!s.questions.length)  return res.status(409).json({ error: 'Survey has no questions' });
    const updated = await prisma.survey.update({
      where: { id: s.id },
      data: { status: 'ACTIVE', openedAt: new Date() },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /surveys/:id/close — ACTIVE → CLOSED
app.post('/surveys/:id/close', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const s = await prisma.survey.findUnique({ where: { id: req.params.id } });
    if (!s) return res.status(404).json({ error: 'Survey not found' });
    if (s.status === 'CLOSED') return res.status(409).json({ error: 'Survey already closed' });
    const updated = await prisma.survey.update({
      where: { id: s.id }, data: { status: 'CLOSED', closedAt: new Date() },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Questions ────────────────────────────────────────────────────────────────

// POST /surveys/:id/questions
app.post('/surveys/:id/questions', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const survey = await prisma.survey.findUnique({ where: { id: req.params.id } });
    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    if (survey.status === 'CLOSED') return res.status(409).json({ error: 'Cannot add questions to a closed survey' });

    const { type, text, required, displayOrder, choices, scaleLabels, category } = req.body;
    if (!type || !QUESTION_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${QUESTION_TYPES.join(', ')}` });
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });
    if (type === 'MULTI_CHOICE' && (!Array.isArray(choices) || choices.length < 2)) {
      return res.status(400).json({ error: 'MULTI_CHOICE requires at least 2 choices' });
    }

    const q = await prisma.surveyQuestion.create({
      data: {
        id: uuidv4(),
        surveyId: survey.id, type,
        text: text.trim(),
        required: required !== false,
        displayOrder: displayOrder !== undefined ? parseInt(displayOrder) : 0,
        choices: Array.isArray(choices) ? choices : [],
        scaleLabels: Array.isArray(scaleLabels) ? scaleLabels : [],
        category: category?.trim() || null,
      },
    });
    res.status(201).json(q);
  } catch (err) { next(err); }
});

// PUT /surveys/:sid/questions/:qid
app.put('/surveys/:sid/questions/:qid', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const data = {};
    const f = req.body;
    if (f.text !== undefined)        data.text = f.text.trim();
    if (f.required !== undefined)    data.required = Boolean(f.required);
    if (f.displayOrder !== undefined) data.displayOrder = parseInt(f.displayOrder);
    if (f.choices !== undefined)     data.choices = Array.isArray(f.choices) ? f.choices : [];
    if (f.category !== undefined)    data.category = f.category?.trim() || null;
    const q = await prisma.surveyQuestion.update({ where: { id: req.params.qid }, data });
    res.json(q);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Question not found' });
    next(err);
  }
});

// DELETE /surveys/:sid/questions/:qid
app.delete('/surveys/:sid/questions/:qid', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    await prisma.surveyQuestion.delete({ where: { id: req.params.qid } });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Question not found' });
    next(err);
  }
});

// ── Responses ────────────────────────────────────────────────────────────────

// POST /surveys/:id/responses — employee submits
app.post('/surveys/:id/responses', authenticate, async (req, res, next) => {
  try {
    const survey = await prisma.survey.findUnique({
      where: { id: req.params.id },
      include: { questions: true },
    });
    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    if (survey.status !== 'ACTIVE') return res.status(409).json({ error: 'Survey is not accepting responses' });

    const { answers, department, tenureMonths, employmentType } = req.body;
    if (!Array.isArray(answers)) return res.status(400).json({ error: 'answers must be an array' });

    const v = validateAnswers(survey.questions, answers);
    if (!v.valid) return res.status(400).json({ error: v.errors.join('; '), errors: v.errors });

    // De-dup: anonymous → ipHash + surveyId; identified → employeeId + surveyId
    const myId = req.user.employeeId || req.user.sub;
    if (!survey.anonymous) {
      const existing = await prisma.surveyResponse.findFirst({
        where: { surveyId: survey.id, respondentEmployeeId: myId },
      });
      if (existing) return res.status(409).json({ error: 'You have already responded to this survey' });
    }

    const created = await prisma.surveyResponse.create({
      data: {
        id: uuidv4(),
        surveyId: survey.id,
        respondentEmployeeId: survey.anonymous ? null : myId,
        respondentDepartment: department || req.user.department || null,
        respondentTenureMonths: tenureMonths !== undefined ? parseInt(tenureMonths) : null,
        respondentEmploymentType: employmentType || null,
        ipHash: ipHashFor(req),
        answers: {
          create: answers.map(a => ({
            id: uuidv4(),
            questionId: a.questionId,
            numericValue: a.numericValue !== undefined ? Number(a.numericValue) : null,
            textValue: a.textValue || null,
          })),
        },
      },
      include: { answers: true },
    });
    res.status(201).json({
      id: created.id,
      submittedAt: created.submittedAt,
      message: 'Response recorded. Thank you.',
    });
  } catch (err) { next(err); }
});

// GET /surveys/:id/responses/me — has the current user responded?
app.get('/surveys/:id/responses/me', authenticate, async (req, res, next) => {
  try {
    const myId = req.user.employeeId || req.user.sub;
    const r = await prisma.surveyResponse.findFirst({
      where: { surveyId: req.params.id, respondentEmployeeId: myId },
    });
    res.json({ submitted: !!r, submittedAt: r?.submittedAt || null });
  } catch (err) { next(err); }
});

// GET /surveys/:id/dashboard — HR aggregate
app.get('/surveys/:id/dashboard', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const survey = await prisma.survey.findUnique({
      where: { id: req.params.id },
      include: {
        questions: { orderBy: { displayOrder: 'asc' } },
        responses: { include: { answers: true } },
      },
    });
    if (!survey) return res.status(404).json({ error: 'Survey not found' });
    const dashboard = buildSurveyDashboard(survey, survey.questions, survey.responses);
    res.json({
      survey: {
        id: survey.id, code: survey.code, title: survey.title, type: survey.type,
        status: survey.status, anonymous: survey.anonymous,
        openedAt: survey.openedAt, closedAt: survey.closedAt,
      },
      ...dashboard,
    });
  } catch (err) { next(err); }
});

// ── Action items ─────────────────────────────────────────────────────────────

// POST /surveys/:id/actions — manager creates action item
app.post('/surveys/:id/actions', authenticate, authorize(...MGR_ROLES), async (req, res, next) => {
  try {
    const { title, description, department, dueDate } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
    const survey = await prisma.survey.findUnique({ where: { id: req.params.id } });
    if (!survey) return res.status(404).json({ error: 'Survey not found' });

    const action = await prisma.surveyAction.create({
      data: {
        id: uuidv4(),
        surveyId: survey.id,
        managerId: req.user.sub,
        managerName: req.user.name || null,
        department: department || req.user.department || null,
        title: title.trim(),
        description: description?.trim() || null,
        dueDate: dueDate ? new Date(dueDate) : null,
      },
    });
    res.status(201).json(action);
  } catch (err) { next(err); }
});

// GET /surveys/:id/actions
app.get('/surveys/:id/actions', authenticate, async (req, res, next) => {
  try {
    const where = { surveyId: req.params.id };
    if (!isHr(req.user.role)) where.managerId = req.user.sub;
    const actions = await prisma.surveyAction.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ actions, total: actions.length });
  } catch (err) { next(err); }
});

// PUT /surveys/:id/actions/:actionId
app.put('/surveys/:id/actions/:actionId', authenticate, async (req, res, next) => {
  try {
    const a = await prisma.surveyAction.findUnique({ where: { id: req.params.actionId } });
    if (!a) return res.status(404).json({ error: 'Action not found' });
    if (a.managerId !== req.user.sub && !isHr(req.user.role)) return res.status(403).json({ error: 'Forbidden' });

    const f = req.body, data = {};
    if (f.title !== undefined)       data.title = f.title.trim();
    if (f.description !== undefined) data.description = f.description?.trim() || null;
    if (f.status !== undefined) {
      if (!ACTION_STATUSES.includes(f.status)) return res.status(400).json({ error: 'Invalid status' });
      data.status = f.status;
      if (['DONE','DISMISSED'].includes(f.status)) data.closedAt = new Date();
    }
    if (f.dueDate !== undefined) data.dueDate = f.dueDate ? new Date(f.dueDate) : null;
    const updated = await prisma.surveyAction.update({ where: { id: a.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Exit-survey integration hook ─────────────────────────────────────────────
// POST /surveys/exit-trigger — offboarding-service calls this when a case opens.
// Body: { employeeId, employeeName, department }
app.post('/surveys/exit-trigger', authenticate, authorize(...HR_ROLES, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { employeeId, employeeName, department } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });

    // Find latest ACTIVE EXIT survey
    const exitSurvey = await prisma.survey.findFirst({
      where: { type: 'EXIT', status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    if (!exitSurvey) return res.status(404).json({ error: 'No active EXIT survey configured' });

    // We just return the survey URL/id; the employee responds via the normal flow.
    res.json({
      surveyId: exitSurvey.id,
      surveyTitle: exitSurvey.title,
      link: `/surveys/${exitSurvey.id}`,
      message: `Exit survey "${exitSurvey.title}" assigned to ${employeeName || employeeId}`,
    });
  } catch (err) { next(err); }
});

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[survey-service] Running on port ${PORT}`));
}

module.exports = app;
