'use strict';
/**
 * PAY-007 IRAS / CPF submission tracking routes.
 *
 * Records every CPF e-Submit / IR8A / Appendix 8A / Appendix 8B / IR21
 * filing, captures the IRAS / CPF Board reference number, tracks the status
 * machine (DRAFT → SUBMITTED → ACKNOWLEDGED / REJECTED), and surfaces a
 * deadline dashboard with urgency banding.
 */

const router = require('express').Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const {
  KINDS,
  computeDeadline,
  classifyUrgency,
  validateTransition,
  buildTransitionPatch,
} = require('../engines/iras-submission.engine');

const prisma = require('../utils/prisma');

const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER];
const VIEW_ROLES  = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER];

function validateScope(kind, body) {
  if (kind === 'CPF_E_SUBMIT') {
    if (!body.period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period)) {
      return 'period (YYYY-MM) required for CPF_E_SUBMIT';
    }
    return null;
  }
  if (kind === 'IR8A' || kind === 'APPENDIX_8A' || kind === 'APPENDIX_8B') {
    if (!Number.isFinite(Number(body.year))) return `year required for ${kind}`;
    return null;
  }
  if (kind === 'IR21') {
    if (!body.employeeId) return 'employeeId required for IR21';
    return null;
  }
  return `Unknown kind ${kind}`;
}

/**
 * Find an existing submission by its natural scope (kind + scope fields).
 * Lets POST be idempotent — re-recording the same filing updates the row.
 */
async function findExistingByScope(kind, body) {
  const where = { kind };
  if (kind === 'CPF_E_SUBMIT') where.period     = body.period;
  if (['IR8A', 'APPENDIX_8A', 'APPENDIX_8B'].includes(kind)) where.year = Number(body.year);
  if (kind === 'IR21')         where.employeeId = body.employeeId;
  return prisma.irasSubmission.findFirst({ where });
}

// ── POST /payroll/iras-submissions — record a new (or refresh existing) submission
router.post('/iras-submissions', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { kind } = req.body;
    if (!KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${KINDS.join('|')}` });
    const scopeErr = validateScope(kind, req.body);
    if (scopeErr) return res.status(400).json({ error: scopeErr });

    // Auto-hash if file content supplied (caller may pass either the file
    // bytes as base64, or a precomputed hash).
    let fileHash = req.body.fileHash || null;
    let fileSize = req.body.fileSize ?? null;
    if (!fileHash && req.body.fileContentBase64) {
      const buf = Buffer.from(req.body.fileContentBase64, 'base64');
      fileHash = crypto.createHash('sha256').update(buf).digest('hex');
      fileSize = buf.length;
    }

    const deadline = computeDeadline(kind, {
      period: req.body.period,
      year:   req.body.year,
      lastWorkingDate: req.body.lastWorkingDate,
    });

    const existing = await findExistingByScope(kind, req.body);
    const data = {
      kind,
      period:     req.body.period     || null,
      year:       req.body.year != null ? Number(req.body.year) : null,
      employeeId: req.body.employeeId || null,
      runId:      req.body.runId      || null,
      fileName:   req.body.fileName   || null,
      fileHash, fileSize,
      deadline,
      notes:      req.body.notes      || null,
    };
    if (existing) {
      // Only update file metadata + deadline; never clobber the status or
      // referenceNumber that a downstream Finance user has set.
      const updated = await prisma.irasSubmission.update({
        where: { id: existing.id },
        data:  {
          fileName: data.fileName ?? existing.fileName,
          fileHash: data.fileHash ?? existing.fileHash,
          fileSize: data.fileSize ?? existing.fileSize,
          runId:    data.runId    ?? existing.runId,
          deadline: data.deadline ?? existing.deadline,
          notes:    data.notes    ?? existing.notes,
        },
      });
      return res.json({ created: false, submission: updated });
    }
    const row = await prisma.irasSubmission.create({
      data: { id: uuidv4(), createdBy: req.user?.sub || null, ...data },
    });
    res.status(201).json({ created: true, submission: row });
  } catch (err) { next(err); }
});

// ── GET /payroll/iras-submissions — filtered list with summary
router.get('/iras-submissions', authenticate, authorize(...VIEW_ROLES), async (req, res, next) => {
  try {
    const { kind, status, period, year, employeeId } = req.query;
    const where = {};
    if (kind && KINDS.includes(kind)) where.kind = kind;
    if (status)                       where.status = status;
    if (period)                       where.period = period;
    if (year)                         where.year   = Number(year);
    if (employeeId)                   where.employeeId = employeeId;
    const rows = await prisma.irasSubmission.findMany({ where, orderBy: [{ deadline: 'asc' }, { createdAt: 'desc' }], take: 500 });
    const now = new Date();
    const enriched = rows.map(r => ({ ...r, ...classifyUrgency(r.deadline, now) }));
    const summary = enriched.reduce((acc, r) => {
      acc.byStatus[r.status]   = (acc.byStatus[r.status]   || 0) + 1;
      acc.byKind[r.kind]       = (acc.byKind[r.kind]       || 0) + 1;
      acc.byUrgency[r.urgency] = (acc.byUrgency[r.urgency] || 0) + 1;
      return acc;
    }, { byStatus: {}, byKind: {}, byUrgency: {} });
    res.json({ total: rows.length, summary, submissions: enriched });
  } catch (err) { next(err); }
});

// ── GET /payroll/iras-submissions/deadlines — dashboard for upcoming + overdue
router.get('/iras-submissions/deadlines', authenticate, authorize(...VIEW_ROLES), async (req, res, next) => {
  try {
    const withinDays = Number(req.query.withinDays) || 60;
    const now = new Date();
    // Pull anything not ACKNOWLEDGED yet
    const rows = await prisma.irasSubmission.findMany({
      where: { status: { in: ['DRAFT', 'SUBMITTED', 'REJECTED'] }, deadline: { not: null } },
      orderBy: { deadline: 'asc' },
    });
    const enriched = rows
      .map(r => ({ ...r, ...classifyUrgency(r.deadline, now) }))
      .filter(r => r.urgency === 'OVERDUE' || (r.daysUntilDeadline != null && r.daysUntilDeadline <= withinDays));
    const summary = enriched.reduce((acc, r) => {
      acc.byUrgency[r.urgency] = (acc.byUrgency[r.urgency] || 0) + 1;
      acc.byKind[r.kind]       = (acc.byKind[r.kind]       || 0) + 1;
      return acc;
    }, { byUrgency: {}, byKind: {} });
    res.json({ withinDays, total: enriched.length, summary, submissions: enriched });
  } catch (err) { next(err); }
});

// ── GET /payroll/iras-submissions/:id
router.get('/iras-submissions/:id', authenticate, authorize(...VIEW_ROLES), async (req, res, next) => {
  try {
    const row = await prisma.irasSubmission.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Submission not found' });
    res.json({ ...row, ...classifyUrgency(row.deadline) });
  } catch (err) { next(err); }
});

// ── PUT /payroll/iras-submissions/:id — transition status + capture reference
// Body: { status: 'SUBMITTED'|'ACKNOWLEDGED'|'REJECTED'|'DRAFT',
//         referenceNumber?, rejectedReason?, notes? }
router.put('/iras-submissions/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.irasSubmission.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Submission not found' });
    const { status, referenceNumber, rejectedReason, notes } = req.body;
    let updated = existing;
    if (status && status !== existing.status) {
      const guard = validateTransition(existing.status, status);
      if (!guard.ok) return res.status(409).json({ error: guard.error });
      if (status === 'SUBMITTED' && !referenceNumber) {
        return res.status(400).json({ error: 'referenceNumber required when transitioning to SUBMITTED' });
      }
      if (status === 'REJECTED' && !rejectedReason) {
        return res.status(400).json({ error: 'rejectedReason required when transitioning to REJECTED' });
      }
      const patch = buildTransitionPatch(status, req.user?.sub, { referenceNumber, rejectedReason });
      if (notes != null) patch.notes = notes;
      updated = await prisma.irasSubmission.update({ where: { id: existing.id }, data: patch });
    } else if (referenceNumber != null || notes != null) {
      const data = {};
      if (referenceNumber != null) data.referenceNumber = referenceNumber;
      if (notes           != null) data.notes = notes;
      updated = await prisma.irasSubmission.update({ where: { id: existing.id }, data });
    }
    res.json({ ...updated, ...classifyUrgency(updated.deadline) });
  } catch (err) { next(err); }
});

// ── DELETE /payroll/iras-submissions/:id — only allowed while DRAFT
router.delete('/iras-submissions/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.irasSubmission.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Submission not found' });
    if (existing.status !== 'DRAFT') {
      return res.status(409).json({ error: `Cannot delete a submission in status ${existing.status}` });
    }
    await prisma.irasSubmission.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/**
 * Daily deadline sweep — logs overdue / critical / warning counts. No side
 * effects on the DB; this is purely a notification trigger point. Wire to a
 * notification-service fan-out later if needed.
 */
async function runDeadlineSweep({ now = new Date() } = {}) {
  const open = await prisma.irasSubmission.findMany({
    where: { status: { in: ['DRAFT', 'SUBMITTED', 'REJECTED'] }, deadline: { not: null } },
  });
  const buckets = { OVERDUE: 0, CRITICAL: 0, WARNING: 0, NOTICE: 0, OK: 0 };
  for (const r of open) {
    const u = classifyUrgency(r.deadline, now);
    buckets[u.urgency] = (buckets[u.urgency] || 0) + 1;
  }
  return { scanned: open.length, buckets };
}

router.post('/iras-submissions/sweep', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const result = await runDeadlineSweep();
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.runDeadlineSweep = runDeadlineSweep;
