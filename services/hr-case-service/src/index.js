'use strict';
require('dotenv').config();
const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const morgan   = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const {
  CASE_TYPES, SEVERITIES, STATUSES, STAGES, ESCALATION_LEVELS, ACTION_TYPES,
  SLA_DAYS_BY_SEVERITY, TAFEP_CATEGORIES,
  nextCaseNumber, progressiveDisciplineNext, requiresEscalation,
  computeMomReportable, buildCaseSummary, validateAppeal,
  computeStageProgress, canIssueAction,
} = require('./engines/hr-case.engine');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4009';

const prisma = require('./utils/prisma');
const app    = express();
const PORT   = process.env.PORT || 4017;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined'));

const { tenantContextMiddleware } = require('/app/shared/tenant-context');
app.use(tenantContextMiddleware);

app.get('/health', (req, res) => res.json({ service: 'hr-case-service', status: 'ok', ts: new Date() }));

const HR_ROLES      = [ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.SUPER_ADMIN];
const HR_MGR_ROLES  = [ROLES.HR_MANAGER, ROLES.SUPER_ADMIN]; // for escalation decisions

function isHr(role) { return HR_ROLES.includes(role); }

// ── Timeline helper ───────────────────────────────────────────────────────────
async function writeTimeline({ caseId, event, actorId, actorName, detail }) {
  try {
    await prisma.caseTimeline.create({
      data: {
        id: uuidv4(), caseId, event,
        actorId: actorId || null, actorName: actorName || null, detail: detail || null,
      },
    });
  } catch (err) { console.error('[hr-case timeline]', err.message); }
}

async function getNextCaseNumber(type) {
  const year = new Date().getFullYear();
  const count = await prisma.hrCase.count({
    where: { type, openedAt: { gte: new Date(`${year}-01-01`) } },
  });
  return nextCaseNumber(type, count, year);
}

// ── Cases ─────────────────────────────────────────────────────────────────────

// POST /hr-cases — open a new case
app.post('/hr-cases', authenticate, async (req, res, next) => {
  try {
    const {
      type, severity, title, summary, subjectEmployeeId, subjectEmployeeName,
      subjectDepartment, respondentId, respondentName, category,
      isUnionised, dueDate, confidential,
    } = req.body;

    if (!type || !CASE_TYPES.includes(type))
      return res.status(400).json({ error: `type must be one of: ${CASE_TYPES.join(', ')}` });
    if (!title || !title.trim())     return res.status(400).json({ error: 'title is required' });
    if (!summary || !summary.trim()) return res.status(400).json({ error: 'summary is required' });

    // Non-HR can only file grievances (about themselves or someone else) — never disciplinary
    if (!isHr(req.user.role) && type === 'DISCIPLINARY') {
      return res.status(403).json({ error: 'Only HR can open disciplinary cases' });
    }

    let resolvedSeverity = severity || 'MINOR';
    if (!SEVERITIES.includes(resolvedSeverity)) {
      return res.status(400).json({ error: `severity must be one of: ${SEVERITIES.join(', ')}` });
    }

    // For grievances filed by an employee, the subject is themselves
    let subjId   = subjectEmployeeId;
    let subjName = subjectEmployeeName;
    if (type === 'GRIEVANCE' && !isHr(req.user.role)) {
      subjId   = req.user.employeeId || req.user.sub;
      subjName = req.user.name || subjName || 'Unknown';
    }
    if (!subjId)   return res.status(400).json({ error: 'subjectEmployeeId is required' });
    if (!subjName) return res.status(400).json({ error: 'subjectEmployeeName is required' });

    const caseNumber = await getNextCaseNumber(type);
    const tafep = computeMomReportable({ category, type, severity: resolvedSeverity });

    const created = await prisma.hrCase.create({
      data: {
        id:                uuidv4(),
        caseNumber,
        type,
        status:            'OPEN',
        severity:          resolvedSeverity,
        subjectEmployeeId: subjId,
        subjectEmployeeName: subjName,
        subjectDepartment: subjectDepartment || null,
        respondentId:      respondentId || null,
        respondentName:    respondentName || null,
        title:             title.trim(),
        summary:           summary.trim(),
        category:          category?.trim() || null,
        isTafepReportable: tafep,
        isUnionised:       Boolean(isUnionised),
        currentStage:      'INTAKE',
        escalationLevel:   'HR_ADMIN',
        openedBy:          req.user.sub,
        openedByName:      req.user.name || null,
        dueDate:           dueDate ? new Date(dueDate) : null,
        confidential:      confidential !== false,
      },
    });

    await writeTimeline({
      caseId: created.id, event: 'CASE_OPENED', actorId: req.user.sub,
      actorName: req.user.name, detail: `${type} case opened: ${title.trim()}`,
    });

    // Notify HR if employee filed a grievance
    if (type === 'GRIEVANCE' && !isHr(req.user.role)) {
      fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientRole: 'HR_ADMIN',
          type: 'GRIEVANCE_FILED',
          title: `New grievance: ${caseNumber}`,
          body:  `${subjName} filed: ${title.trim()}`,
          link:  `/hr-cases/${created.id}`,
        }),
      }).catch(() => {});
    }

    res.status(201).json(created);
  } catch (err) { next(err); }
});

// GET /hr-cases — list. Employee sees own (subject=self OR opener=self for grievances they filed).
app.get('/hr-cases', authenticate, async (req, res, next) => {
  try {
    const { type, status, severity, escalationLevel } = req.query;
    const where = {};
    if (!isHr(req.user.role)) {
      const myId = req.user.employeeId || req.user.sub;
      where.OR = [
        { subjectEmployeeId: myId, type: 'GRIEVANCE' },
        { openedBy: req.user.sub },
      ];
    }
    if (type)            where.type = type;
    if (status)          where.status = status;
    if (severity)        where.severity = severity;
    if (escalationLevel) where.escalationLevel = escalationLevel;

    const cases = await prisma.hrCase.findMany({
      where,
      orderBy: { openedAt: 'desc' },
    });
    const enriched = cases.map(c => ({
      ...c,
      escalation: requiresEscalation(c, new Date()),
      progress:   computeStageProgress(c),
    }));
    const summary = buildCaseSummary(cases);
    res.json({ cases: enriched, total: cases.length, summary });
  } catch (err) { next(err); }
});

// GET /hr-cases/dashboard — defined BEFORE /:id so the literal path matches first
app.get('/hr-cases/dashboard', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const cases = await prisma.hrCase.findMany({});
    const summary = buildCaseSummary(cases);
    const overdueList = cases
      .filter(c => requiresEscalation(c, new Date()).shouldEscalate)
      .slice(0, 20)
      .map(c => ({ id: c.id, caseNumber: c.caseNumber, title: c.title, severity: c.severity, daysOpen: requiresEscalation(c, new Date()).daysOpen }));
    res.json({
      summary,
      overdueEscalation: overdueList,
      slaWindows: SLA_DAYS_BY_SEVERITY,
    });
  } catch (err) { next(err); }
});

// GET /hr-cases/:id — case detail with all related records
app.get('/hr-cases/:id', authenticate, async (req, res, next) => {
  try {
    const c = await prisma.hrCase.findUnique({
      where: { id: req.params.id },
      include: {
        incidents:   { orderBy: { occurredAt: 'desc' } },
        actions:     { orderBy: { actionDate: 'desc' } },
        timeline:    { orderBy: { createdAt: 'desc' } },
        appeals:     { orderBy: { filedAt: 'desc' } },
        committee:   true,
        attachments: { orderBy: { uploadedAt: 'desc' } },
      },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    // Access control: HR sees all; employee sees their own
    if (!isHr(req.user.role)) {
      const myId = req.user.employeeId || req.user.sub;
      const allowed = c.openedBy === req.user.sub || (c.subjectEmployeeId === myId && c.type === 'GRIEVANCE');
      if (!allowed) return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({
      ...c,
      escalation: requiresEscalation(c, new Date()),
      progress:   computeStageProgress(c),
      momReportable: computeMomReportable(c),
    });
  } catch (err) { next(err); }
});

// PUT /hr-cases/:id — HR updates summary/severity/category/stage/status
app.put('/hr-cases/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const f = req.body;
    const data = {};
    if (f.title !== undefined)         data.title = f.title.trim();
    if (f.summary !== undefined)       data.summary = f.summary.trim();
    if (f.severity !== undefined) {
      if (!SEVERITIES.includes(f.severity)) return res.status(400).json({ error: 'Invalid severity' });
      data.severity = f.severity;
    }
    if (f.status !== undefined) {
      if (!STATUSES.includes(f.status)) return res.status(400).json({ error: 'Invalid status' });
      data.status = f.status;
      if (f.status === 'CLOSED')   data.closedAt = new Date();
      if (f.status === 'RESOLVED') data.resolvedAt = new Date();
    }
    if (f.currentStage !== undefined) {
      if (!STAGES.includes(f.currentStage)) return res.status(400).json({ error: 'Invalid stage' });
      data.currentStage = f.currentStage;
    }
    if (f.category !== undefined)      data.category = f.category?.trim() || null;
    if (f.respondentId !== undefined)  data.respondentId = f.respondentId || null;
    if (f.respondentName !== undefined) data.respondentName = f.respondentName || null;
    if (f.dueDate !== undefined)       data.dueDate = f.dueDate ? new Date(f.dueDate) : null;
    if (f.unionConsulted !== undefined) data.unionConsulted = Boolean(f.unionConsulted);
    if (f.unionNotes !== undefined)    data.unionNotes = f.unionNotes?.trim() || null;
    if (f.resolution !== undefined)    data.resolution = f.resolution?.trim() || null;

    // Recompute TAFEP flag if category/severity changed
    if (f.category !== undefined || f.severity !== undefined) {
      const existing = await prisma.hrCase.findUnique({ where: { id: req.params.id } });
      if (existing) {
        data.isTafepReportable = computeMomReportable({
          category: f.category ?? existing.category,
          type: existing.type,
          severity: f.severity ?? existing.severity,
        });
      }
    }

    const updated = await prisma.hrCase.update({ where: { id: req.params.id }, data });

    if (data.status) {
      await writeTimeline({
        caseId: req.params.id, event: `STATUS_CHANGED:${data.status}`,
        actorId: req.user.sub, actorName: req.user.name,
      });
    }
    if (data.currentStage) {
      await writeTimeline({
        caseId: req.params.id, event: `STAGE_CHANGED:${data.currentStage}`,
        actorId: req.user.sub, actorName: req.user.name,
      });
    }

    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Case not found' });
    next(err);
  }
});

// ── Incidents ────────────────────────────────────────────────────────────────
// POST /hr-cases/:id/incidents
app.post('/hr-cases/:id/incidents', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { occurredAt, location, description, witnesses, evidenceUrls } = req.body;
    if (!occurredAt)   return res.status(400).json({ error: 'occurredAt is required' });
    if (!description || !description.trim())
      return res.status(400).json({ error: 'description is required' });

    const c = await prisma.hrCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const inc = await prisma.caseIncident.create({
      data: {
        id: uuidv4(),
        caseId: req.params.id,
        occurredAt: new Date(occurredAt),
        location:   location?.trim() || null,
        description: description.trim(),
        witnesses:   Array.isArray(witnesses) ? witnesses : [],
        evidenceUrls: Array.isArray(evidenceUrls) ? evidenceUrls : [],
        loggedBy: req.user.sub,
        loggedByName: req.user.name || null,
      },
    });
    await writeTimeline({
      caseId: req.params.id, event: 'INCIDENT_LOGGED',
      actorId: req.user.sub, actorName: req.user.name,
      detail: description.trim().slice(0, 200),
    });
    res.status(201).json(inc);
  } catch (err) { next(err); }
});

// ── Actions ──────────────────────────────────────────────────────────────────
// POST /hr-cases/:id/actions
app.post('/hr-cases/:id/actions', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { actionType, notes, effectiveFrom, effectiveTo, suspensionPaid, showCauseDeadline } = req.body;
    if (!actionType || !ACTION_TYPES.includes(actionType))
      return res.status(400).json({ error: `actionType must be one of: ${ACTION_TYPES.join(', ')}` });

    const c = await prisma.hrCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const gate = canIssueAction(c, actionType);
    if (!gate.allowed) return res.status(409).json({ error: gate.reason });

    const action = await prisma.caseAction.create({
      data: {
        id: uuidv4(),
        caseId: req.params.id,
        actionType,
        actionDate: new Date(),
        performedBy: req.user.sub,
        performedByName: req.user.name || null,
        notes: notes?.trim() || null,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : null,
        effectiveTo:   effectiveTo   ? new Date(effectiveTo)   : null,
        suspensionPaid: actionType === 'SUSPENSION' ? Boolean(suspensionPaid) : null,
        showCauseDeadline: actionType === 'SHOW_CAUSE' && showCauseDeadline ? new Date(showCauseDeadline) : null,
      },
    });

    // Auto-advance stage on certain actions
    let stageUpdate = null;
    if (['SHOW_CAUSE','SUSPENSION'].includes(actionType) && c.currentStage === 'INTAKE') {
      stageUpdate = 'INVESTIGATION';
    } else if (actionType === 'TERMINATION_FOR_CAUSE') {
      stageUpdate = 'CLOSED';
    } else if (['VERBAL_WARNING','WRITTEN_WARNING','FINAL_WARNING'].includes(actionType) && c.currentStage === 'HEARING') {
      stageUpdate = 'DECISION';
    }
    if (stageUpdate) {
      await prisma.hrCase.update({ where: { id: c.id }, data: { currentStage: stageUpdate } });
    }

    await writeTimeline({
      caseId: req.params.id, event: `ACTION_ISSUED:${actionType}`,
      actorId: req.user.sub, actorName: req.user.name,
      detail: notes?.trim() || null,
    });

    // Notify subject
    fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientId: c.subjectEmployeeId,
        type: 'DISCIPLINARY_ACTION',
        title: `Action issued on case ${c.caseNumber}`,
        body:  `${actionType.replace(/_/g, ' ').toLowerCase()} — see case for details.`,
        link:  `/hr-cases/${c.id}`,
      }),
    }).catch(() => {});

    res.status(201).json(action);
  } catch (err) { next(err); }
});

// PUT /hr-cases/:id/actions/:actionId/acknowledge — subject acknowledges via e-sign
app.put('/hr-cases/:id/actions/:actionId/acknowledge', authenticate, async (req, res, next) => {
  try {
    const c = await prisma.hrCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    const myId = req.user.employeeId || req.user.sub;
    if (myId !== c.subjectEmployeeId && !isHr(req.user.role))
      return res.status(403).json({ error: 'Only the subject employee can acknowledge' });

    const updated = await prisma.caseAction.update({
      where: { id: req.params.actionId },
      data: { acknowledged: true, acknowledgedAt: new Date(), esignRequestId: req.body.esignRequestId || null },
    });
    await writeTimeline({
      caseId: req.params.id, event: 'ACTION_ACKNOWLEDGED',
      actorId: req.user.sub, actorName: req.user.name,
      detail: `Action ${updated.actionType} acknowledged`,
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Action not found' });
    next(err);
  }
});

// GET /hr-cases/:id/recommend-next-action — engine suggestion
app.get('/hr-cases/:id/recommend-next-action', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const c = await prisma.hrCase.findUnique({
      where: { id: req.params.id },
      include: { actions: true },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    if (c.type !== 'DISCIPLINARY') return res.status(409).json({ error: 'Only disciplinary cases have a progressive ladder' });
    const priorActions = c.actions.map(a => a.actionType);
    res.json({
      recommended: progressiveDisciplineNext(priorActions, c.severity),
      severity: c.severity,
      priorActions,
    });
  } catch (err) { next(err); }
});

// ── Escalation ───────────────────────────────────────────────────────────────
// POST /hr-cases/:id/escalate
app.post('/hr-cases/:id/escalate', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'reason is required' });
    const c = await prisma.hrCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const currentIdx = ESCALATION_LEVELS.indexOf(c.escalationLevel);
    if (currentIdx >= ESCALATION_LEVELS.length - 1)
      return res.status(409).json({ error: 'Already at top escalation level' });

    const nextLevel = ESCALATION_LEVELS[currentIdx + 1];
    const updated = await prisma.hrCase.update({
      where: { id: c.id }, data: { escalationLevel: nextLevel },
    });
    await writeTimeline({
      caseId: c.id, event: `ESCALATED:${nextLevel}`,
      actorId: req.user.sub, actorName: req.user.name,
      detail: reason.trim(),
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Appeals ──────────────────────────────────────────────────────────────────
// POST /hr-cases/:id/appeal — subject employee files appeal
app.post('/hr-cases/:id/appeal', authenticate, async (req, res, next) => {
  try {
    const { groundsForAppeal } = req.body;
    if (!groundsForAppeal || !groundsForAppeal.trim())
      return res.status(400).json({ error: 'groundsForAppeal is required' });

    const c = await prisma.hrCase.findUnique({
      where: { id: req.params.id },
      include: { appeals: true },
    });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const myId = req.user.employeeId || req.user.sub;
    if (myId !== c.subjectEmployeeId && !isHr(req.user.role))
      return res.status(403).json({ error: 'Only the subject employee can file an appeal' });

    const gate = validateAppeal(c);
    if (!gate.valid) return res.status(409).json({ error: gate.reason });

    const appeal = await prisma.caseAppeal.create({
      data: {
        id: uuidv4(),
        caseId: c.id,
        filedBy: req.user.sub,
        filedByName: req.user.name || null,
        groundsForAppeal: groundsForAppeal.trim(),
        status: 'PENDING',
      },
    });

    await prisma.hrCase.update({
      where: { id: c.id }, data: { currentStage: 'APPEAL', status: 'PENDING_DECISION' },
    });
    await writeTimeline({
      caseId: c.id, event: 'APPEAL_FILED',
      actorId: req.user.sub, actorName: req.user.name,
      detail: groundsForAppeal.trim().slice(0, 200),
    });
    res.status(201).json(appeal);
  } catch (err) { next(err); }
});

// PUT /hr-cases/:id/appeals/:appealId/decide
app.put('/hr-cases/:id/appeals/:appealId/decide', authenticate, authorize(...HR_MGR_ROLES), async (req, res, next) => {
  try {
    const { outcome, outcomeNotes, status } = req.body;
    const validOutcomes = ['UPHELD','PARTIALLY_UPHELD','REJECTED','WITHDRAWN'];
    if (!status || !validOutcomes.includes(status))
      return res.status(400).json({ error: `status must be one of: ${validOutcomes.join(', ')}` });

    const existing = await prisma.caseAppeal.findUnique({ where: { id: req.params.appealId } });
    if (!existing) return res.status(404).json({ error: 'Appeal not found' });
    if (existing.status !== 'PENDING')
      return res.status(409).json({ error: 'Appeal is no longer pending' });

    const appeal = await prisma.caseAppeal.update({
      where: { id: req.params.appealId },
      data: {
        status,
        outcome: outcome || null,
        outcomeNotes: outcomeNotes?.trim() || null,
        decidedBy: req.user.sub,
        decidedByName: req.user.name || null,
        decidedAt: new Date(),
      },
    });
    await writeTimeline({
      caseId: req.params.id, event: `APPEAL_DECIDED:${status}`,
      actorId: req.user.sub, actorName: req.user.name,
      detail: outcomeNotes?.trim() || null,
    });
    res.json(appeal);
  } catch (err) { next(err); }
});

// ── Inquiry Committee ────────────────────────────────────────────────────────
// POST /hr-cases/:id/inquiry — form a committee
app.post('/hr-cases/:id/inquiry', authenticate, authorize(...HR_MGR_ROLES), async (req, res, next) => {
  try {
    const { chairId, chairName, members, memberNames, scope, hearingDate } = req.body;
    if (!chairId   || !chairName)   return res.status(400).json({ error: 'chairId and chairName are required' });
    if (!scope     || !scope.trim()) return res.status(400).json({ error: 'scope is required' });

    const c = await prisma.hrCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    // Upsert: one committee per case
    const existing = await prisma.inquiryCommittee.findUnique({ where: { caseId: c.id } });
    if (existing) return res.status(409).json({ error: 'Inquiry committee already formed for this case' });

    const committee = await prisma.inquiryCommittee.create({
      data: {
        id: uuidv4(),
        caseId: c.id,
        formedBy: req.user.sub,
        chairId, chairName,
        members:     Array.isArray(members) ? members : [],
        memberNames: Array.isArray(memberNames) ? memberNames : [],
        scope: scope.trim(),
        hearingDate: hearingDate ? new Date(hearingDate) : null,
      },
    });
    await prisma.hrCase.update({
      where: { id: c.id }, data: { currentStage: 'INVESTIGATION', status: 'UNDER_INVESTIGATION' },
    });
    await writeTimeline({
      caseId: c.id, event: 'INQUIRY_COMMITTEE_FORMED',
      actorId: req.user.sub, actorName: req.user.name,
      detail: `Chair: ${chairName}; members: ${(memberNames || []).join(', ')}`,
    });
    res.status(201).json(committee);
  } catch (err) { next(err); }
});

// PUT /hr-cases/:id/inquiry — update report
app.put('/hr-cases/:id/inquiry', authenticate, authorize(...HR_MGR_ROLES), async (req, res, next) => {
  try {
    const { reportSummary, recommendation, hearingDate } = req.body;
    const data = {};
    if (reportSummary !== undefined) {
      data.reportSummary = reportSummary?.trim() || null;
      data.reportSubmittedAt = new Date();
    }
    if (recommendation !== undefined) data.recommendation = recommendation?.trim() || null;
    if (hearingDate !== undefined)    data.hearingDate = hearingDate ? new Date(hearingDate) : null;

    const updated = await prisma.inquiryCommittee.update({
      where: { caseId: req.params.id }, data,
    });
    if (data.reportSummary) {
      await prisma.hrCase.update({
        where: { id: req.params.id },
        data: { currentStage: 'HEARING' },
      });
      await writeTimeline({
        caseId: req.params.id, event: 'INQUIRY_REPORT_SUBMITTED',
        actorId: req.user.sub, actorName: req.user.name,
      });
    }
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Inquiry committee not found' });
    next(err);
  }
});

// ── Attachments ──────────────────────────────────────────────────────────────
// POST /hr-cases/:id/attachments — record uploaded file metadata
app.post('/hr-cases/:id/attachments', authenticate, async (req, res, next) => {
  try {
    const { fileName, fileUrl, fileSize, mimeType } = req.body;
    if (!fileName || !fileUrl)
      return res.status(400).json({ error: 'fileName and fileUrl are required' });

    const c = await prisma.hrCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    // Access control: subject employee or HR
    const myId = req.user.employeeId || req.user.sub;
    if (!isHr(req.user.role) && myId !== c.subjectEmployeeId && req.user.sub !== c.openedBy) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const att = await prisma.caseAttachment.create({
      data: {
        id: uuidv4(),
        caseId: c.id,
        fileName: fileName.trim(),
        fileUrl:  fileUrl.trim(),
        fileSize: fileSize ? parseInt(fileSize) : null,
        mimeType: mimeType?.trim() || null,
        uploadedBy: req.user.sub,
      },
    });
    await writeTimeline({
      caseId: c.id, event: 'ATTACHMENT_UPLOADED',
      actorId: req.user.sub, actorName: req.user.name, detail: fileName.trim(),
    });
    res.status(201).json(att);
  } catch (err) { next(err); }
});

// ── Resolution & Closure ─────────────────────────────────────────────────────
// PUT /hr-cases/:id/resolve
app.put('/hr-cases/:id/resolve', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { resolution } = req.body;
    if (!resolution || !resolution.trim())
      return res.status(400).json({ error: 'resolution is required' });

    const c = await prisma.hrCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    if (['CLOSED','WITHDRAWN','RESOLVED'].includes(c.status))
      return res.status(409).json({ error: `Case is already ${c.status}` });

    const updated = await prisma.hrCase.update({
      where: { id: c.id },
      data: {
        status: 'RESOLVED',
        currentStage: 'DECISION',
        resolution: resolution.trim(),
        resolvedAt: new Date(),
      },
    });
    await writeTimeline({
      caseId: c.id, event: 'CASE_RESOLVED',
      actorId: req.user.sub, actorName: req.user.name,
      detail: resolution.trim().slice(0, 200),
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /hr-cases/:id/close — closes a case (after appeal window or resolution accepted)
app.put('/hr-cases/:id/close', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const c = await prisma.hrCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    if (c.status === 'CLOSED') return res.status(409).json({ error: 'Case is already CLOSED' });

    const updated = await prisma.hrCase.update({
      where: { id: c.id },
      data: { status: 'CLOSED', currentStage: 'CLOSED', closedAt: new Date() },
    });
    await writeTimeline({
      caseId: c.id, event: 'CASE_CLOSED',
      actorId: req.user.sub, actorName: req.user.name,
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /hr-cases/:id/withdraw — grievant withdraws their own case
app.put('/hr-cases/:id/withdraw', authenticate, async (req, res, next) => {
  try {
    const c = await prisma.hrCase.findUnique({ where: { id: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    if (c.openedBy !== req.user.sub && !isHr(req.user.role))
      return res.status(403).json({ error: 'Only the case opener can withdraw it' });
    if (['CLOSED','RESOLVED','WITHDRAWN'].includes(c.status))
      return res.status(409).json({ error: `Case is already ${c.status}` });

    const updated = await prisma.hrCase.update({
      where: { id: c.id },
      data: { status: 'WITHDRAWN', closedAt: new Date() },
    });
    await writeTimeline({
      caseId: c.id, event: 'CASE_WITHDRAWN',
      actorId: req.user.sub, actorName: req.user.name,
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Daily escalation sweep ────────────────────────────────────────────────────
async function runEscalationSweep() {
  console.log('[hr-case sweep] start');
  try {
    const cases = await prisma.hrCase.findMany({
      where: { status: { in: ['OPEN','UNDER_INVESTIGATION','PENDING_DECISION'] } },
    });
    const now = new Date();
    let escalated = 0;
    for (const c of cases) {
      const r = requiresEscalation(c, now);
      if (r.shouldEscalate && r.nextLevel) {
        await prisma.hrCase.update({ where: { id: c.id }, data: { escalationLevel: r.nextLevel } });
        await writeTimeline({
          caseId: c.id, event: `AUTO_ESCALATED:${r.nextLevel}`,
          actorName: 'SYSTEM',
          detail: `Auto-escalated after ${r.daysOpen}d (SLA ${r.slaDays}d)`,
        });
        escalated += 1;
      }
    }
    console.log(`[hr-case sweep] escalated ${escalated} of ${cases.length} cases`);
    return { checked: cases.length, escalated };
  } catch (err) {
    console.error('[hr-case sweep] failed:', err.message);
    throw err;
  }
}

// POST /hr-cases/sweep — manual trigger
app.post('/hr-cases/sweep', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const result = await runEscalationSweep();
    res.json(result);
  } catch (err) { next(err); }
});

function scheduleEscalationSweep() {
  if (process.env.NODE_ENV === 'test') return;
  const now      = new Date();
  const sgtNow   = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const target   = new Date(sgtNow);
  target.setHours(1, 30, 0, 0); // 01:30 SGT
  if (target <= sgtNow) target.setDate(target.getDate() + 1);
  const delayMs  = target.getTime() - sgtNow.getTime();
  setTimeout(() => {
    runEscalationSweep().catch(() => {});
    setInterval(() => runEscalationSweep().catch(() => {}), 86_400_000);
  }, delayMs);
  console.log(`[hr-case] next sweep in ${Math.round(delayMs/3600000)}h`);
}

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[hr-case-service] Running on port ${PORT}`));
  scheduleEscalationSweep();
}

module.exports = app;
module.exports.runEscalationSweep = runEscalationSweep;
