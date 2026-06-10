'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { encryptFields, decrypt } = require('/app/shared/crypto');
const {
  MOVEMENT_TYPES, STATUSES, SALARY_REASON_CODES,
  validateTransfer, computeSalaryDelta, isEffectiveToday,
  buildMovementSummary, suggestLetterText, requiresAdditionalApproval,
  nextMovementNumber,
} = require('../engines/staff-movement.engine');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4009';

const prisma = require('../utils/prisma');

const HR_ROLES     = [ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.SUPER_ADMIN];
const HR_MGR_ROLES = [ROLES.HR_MANAGER, ROLES.SUPER_ADMIN];

function isHr(role) { return HR_ROLES.includes(role); }
function isHrMgr(role) { return HR_MGR_ROLES.includes(role); }

async function generateMovementNumber() {
  const year = new Date().getFullYear();
  const count = await prisma.staffMovement.count({
    where: { createdAt: { gte: new Date(`${year}-01-01`) } },
  });
  return nextMovementNumber(count, year);
}

function safeDecryptSalary(enc) {
  if (!enc) return null;
  try { return parseFloat(decrypt(enc)); } catch { return null; }
}

// ── List & Dashboard (BEFORE :id) ────────────────────────────────────────────
// GET /movements/summary — HR aggregate
router.get('/summary', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const movements = await prisma.staffMovement.findMany({});
    const summary = buildMovementSummary(movements, new Date());
    res.json({ summary });
  } catch (err) { next(err); }
});

// GET /movements — list. Employees see own movements; HR sees all.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { employeeId, status, type, from, to } = req.query;
    const where = {};
    if (!isHr(req.user.role)) {
      where.employeeId = req.user.employeeId || req.user.sub;
    } else if (employeeId) {
      where.employeeId = employeeId;
    }
    if (status) where.status = status;
    if (type)   where.type   = type;
    if (from || to) {
      where.effectiveDate = {};
      if (from) where.effectiveDate.gte = new Date(from);
      if (to)   where.effectiveDate.lte = new Date(to);
    }
    const movements = await prisma.staffMovement.findMany({
      where, orderBy: { effectiveDate: 'desc' },
    });
    res.json({
      movements,
      total: movements.length,
      summary: isHr(req.user.role) ? buildMovementSummary(movements, new Date()) : undefined,
    });
  } catch (err) { next(err); }
});

// ── Initiate ─────────────────────────────────────────────────────────────────
// POST /movements — initiate a transfer (employee/manager/HR)
router.post('/', authenticate, async (req, res, next) => {
  try {
    const {
      employeeId, type, toDepartment, toDesignation, toCostCentre,
      toLocation, toReportingManagerId, toCompany, toEmploymentType,
      reason, effectiveDate, hasSalaryRevision, toSalary, salaryReasonCode,
    } = req.body;

    if (!employeeId)                            return res.status(400).json({ error: 'employeeId is required' });
    if (!type || !MOVEMENT_TYPES.includes(type))
      return res.status(400).json({ error: `type must be one of: ${MOVEMENT_TYPES.join(', ')}` });
    if (!reason || !reason.trim())              return res.status(400).json({ error: 'reason is required' });
    if (!effectiveDate)                         return res.status(400).json({ error: 'effectiveDate is required' });

    // Load employee for snapshot
    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    // Permission: employees can initiate only for themselves
    const isOwn = emp.id === (req.user.employeeId || req.user.sub);
    if (!isHr(req.user.role) && req.user.role !== ROLES.LINE_MANAGER && !isOwn) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const from = {
      department: emp.department,
      designation: emp.designation,
      costCentre: emp.costCentre,
      location: null, // no employee.location column; movements track only the change
      reportingManagerId: emp.reportingManagerId,
      company: null,
      employmentType: emp.employmentType,
    };
    const to = {
      department: toDepartment ?? emp.department,
      designation: toDesignation ?? emp.designation,
      costCentre: toCostCentre ?? emp.costCentre,
      location: toLocation ?? null,
      reportingManagerId: toReportingManagerId ?? emp.reportingManagerId,
      company: toCompany ?? null,
      employmentType: toEmploymentType ?? emp.employmentType,
    };

    const v = validateTransfer(from, to, type);
    if (!v.valid) return res.status(400).json({ error: v.reasons.join('; ') });

    // Salary revision (encrypted)
    let fromSalaryEnc = null, toSalaryEnc = null;
    if (hasSalaryRevision) {
      if (toSalary === undefined || isNaN(parseFloat(toSalary)))
        return res.status(400).json({ error: 'toSalary is required when hasSalaryRevision=true' });
      if (salaryReasonCode && !SALARY_REASON_CODES.includes(salaryReasonCode))
        return res.status(400).json({ error: 'Invalid salaryReasonCode' });
      const fromSalaryPlain = safeDecryptSalary(emp.basicSalaryEncrypted);
      const enc = encryptFields(
        { fromSalary: String(fromSalaryPlain ?? 0), toSalary: String(toSalary) },
        ['fromSalary','toSalary']
      );
      fromSalaryEnc = enc.fromSalary;
      toSalaryEnc   = enc.toSalary;

      // Additional-approval gating computed using plain values
      const addl = requiresAdditionalApproval({
        type, hasSalaryRevision: true,
        fromSalary: fromSalaryPlain ?? 0,
        toSalary: parseFloat(toSalary),
      });
      if (addl.required && !isHrMgr(req.user.role) && !isHr(req.user.role)) {
        // employees & line managers may initiate, but HR_MANAGER approval will be required later
      }
    }

    const movementNumber = await generateMovementNumber();
    const created = await prisma.staffMovement.create({
      data: {
        id:                 uuidv4(),
        movementNumber,
        employeeId:         emp.id,
        employeeName:       emp.fullName,
        type,
        status:             'PENDING',
        fromDepartment:     emp.department,
        toDepartment:       to.department,
        fromDesignation:    emp.designation,
        toDesignation:      to.designation,
        fromCostCentre:     emp.costCentre,
        toCostCentre:       to.costCentre,
        fromLocation:       from.location,
        toLocation:         to.location,
        fromReportingManagerId: emp.reportingManagerId,
        toReportingManagerId:   to.reportingManagerId,
        fromCompany:        from.company,
        toCompany:          to.company,
        fromEmploymentType: emp.employmentType,
        toEmploymentType:   to.employmentType,
        hasSalaryRevision:  Boolean(hasSalaryRevision),
        fromSalaryEnc, toSalaryEnc,
        salaryReasonCode:   hasSalaryRevision ? (salaryReasonCode || 'OTHER') : null,
        reason:             reason.trim(),
        effectiveDate:      new Date(effectiveDate),
        initiatedBy:        req.user.sub,
        initiatedByName:    req.user.name || null,
        initiatedByRole:    req.user.role || null,
      },
    });

    // Notify HR
    fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientRole: 'HR_ADMIN',
        type: 'MOVEMENT_REQUESTED',
        title: `Movement requested: ${movementNumber}`,
        body:  `${emp.fullName}: ${type.replace(/_/g, ' ')} — awaiting approval`,
        link:  `/movements/${created.id}`,
      }),
    }).catch(() => {});

    res.status(201).json(created);
  } catch (err) { next(err); }
});

// ── Detail / Letter ──────────────────────────────────────────────────────────
// GET /movements/:id
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const m = await prisma.staffMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: 'Movement not found' });
    // Access control
    if (!isHr(req.user.role)) {
      const myId = req.user.employeeId || req.user.sub;
      if (m.employeeId !== myId && m.initiatedBy !== req.user.sub)
        return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ ...m, additionalApproval: requiresAdditionalApproval({
      type: m.type, hasSalaryRevision: m.hasSalaryRevision,
      fromSalary: safeDecryptSalary(m.fromSalaryEnc) || 0,
      toSalary:   safeDecryptSalary(m.toSalaryEnc) || 0,
    }) });
  } catch (err) { next(err); }
});

// GET /movements/:id/letter — generate or fetch existing transfer letter
router.get('/:id/letter', authenticate, async (req, res, next) => {
  try {
    const m = await prisma.staffMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: 'Movement not found' });
    if (!isHr(req.user.role) && m.employeeId !== (req.user.employeeId || req.user.sub))
      return res.status(403).json({ error: 'Forbidden' });

    let html = m.letterHtml;
    if (!html) {
      html = suggestLetterText(m);
      await prisma.staffMovement.update({
        where: { id: m.id }, data: { letterHtml: html, letterGeneratedAt: new Date() },
      });
    }
    res.json({ id: m.id, html });
  } catch (err) { next(err); }
});

// ── Approve / Reject / Cancel ────────────────────────────────────────────────
// PUT /movements/:id/approve — HR approves
router.put('/:id/approve', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const m = await prisma.staffMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: 'Movement not found' });
    if (m.status !== 'PENDING') return res.status(409).json({ error: `Cannot approve movement in status ${m.status}` });

    // Gate: additional approval (HR_MANAGER) for inter-co / large salary jump / decrease
    const fromSalary = safeDecryptSalary(m.fromSalaryEnc) || 0;
    const toSalary   = safeDecryptSalary(m.toSalaryEnc) || 0;
    const addl = requiresAdditionalApproval({
      type: m.type, hasSalaryRevision: m.hasSalaryRevision,
      fromSalary, toSalary,
    });
    if (addl.required && !isHrMgr(req.user.role)) {
      return res.status(403).json({ error: `Requires HR_MANAGER approval: ${addl.reasons.join('; ')}` });
    }

    const updated = await prisma.staffMovement.update({
      where: { id: m.id },
      data: {
        status: 'APPROVED',
        approvedBy: req.user.sub,
        approvedByName: req.user.name || null,
        approvedAt: new Date(),
      },
    });

    // Generate letter at approval time
    if (!updated.letterHtml) {
      const html = suggestLetterText(updated);
      await prisma.staffMovement.update({
        where: { id: m.id }, data: { letterHtml: html, letterGeneratedAt: new Date() },
      });
    }

    // Notify employee + downstream stakeholders
    fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientId: m.employeeId,
        type: 'MOVEMENT_APPROVED',
        title: `Your transfer is approved`,
        body:  `${m.type.replace(/_/g, ' ')} effective ${new Date(m.effectiveDate).toLocaleDateString('en-SG')}`,
        link:  `/movements/${m.id}`,
      }),
    }).catch(() => {});

    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /movements/:id/reject
router.put('/:id/reject', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { rejectionReason } = req.body;
    if (!rejectionReason || !rejectionReason.trim())
      return res.status(400).json({ error: 'rejectionReason is required' });
    const m = await prisma.staffMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: 'Movement not found' });
    if (m.status !== 'PENDING') return res.status(409).json({ error: `Cannot reject movement in status ${m.status}` });

    const updated = await prisma.staffMovement.update({
      where: { id: m.id },
      data: {
        status: 'REJECTED',
        rejectedBy: req.user.sub, rejectedAt: new Date(),
        rejectionReason: rejectionReason.trim(),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /movements/:id/cancel — initiator or HR can cancel a PENDING/APPROVED movement
router.put('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const m = await prisma.staffMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: 'Movement not found' });
    if (m.initiatedBy !== req.user.sub && !isHr(req.user.role))
      return res.status(403).json({ error: 'Only the initiator or HR can cancel' });
    if (!['PENDING','APPROVED'].includes(m.status))
      return res.status(409).json({ error: `Cannot cancel movement in status ${m.status}` });
    const updated = await prisma.staffMovement.update({
      where: { id: m.id }, data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Apply (effective-date sweep) ─────────────────────────────────────────────
async function applyMovement(m) {
  // Update employee record with the new snapshot fields
  const data = {
    department:           m.toDepartment,
    designation:          m.toDesignation,
    costCentre:           m.toCostCentre,
    reportingManagerId:   m.toReportingManagerId,
  };
  if (m.toEmploymentType) data.employmentType = m.toEmploymentType;
  if (m.hasSalaryRevision && m.toSalaryEnc) {
    data.basicSalaryEncrypted = m.toSalaryEnc;
  }

  await prisma.employee.update({ where: { id: m.employeeId }, data });

  // Write salary history if salary changed
  if (m.hasSalaryRevision && m.fromSalaryEnc && m.toSalaryEnc) {
    await prisma.salaryHistory.create({
      data: {
        id: uuidv4(),
        employeeId: m.employeeId,
        effectiveDate: m.effectiveDate,
        basicSalaryEnc: m.toSalaryEnc,
        previousSalaryEnc: m.fromSalaryEnc,
        newSalaryEnc: m.toSalaryEnc,
        reasonCode: m.salaryReasonCode || 'ROLE_CHANGE',
        changeReason: `Staff movement ${m.movementNumber}`,
        status: 'APPROVED',
      },
    });
  }

  // Mark applied
  await prisma.staffMovement.update({
    where: { id: m.id },
    data: { status: 'APPLIED', appliedAt: new Date(), applyError: null },
  });
}

// POST /movements/:id/apply — manual apply (HR only)
router.post('/:id/apply', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const m = await prisma.staffMovement.findUnique({ where: { id: req.params.id } });
    if (!m) return res.status(404).json({ error: 'Movement not found' });
    if (m.status !== 'APPROVED') return res.status(409).json({ error: `Only APPROVED movements can be applied (current: ${m.status})` });
    if (!isEffectiveToday(m.effectiveDate, new Date())) {
      return res.status(409).json({ error: `Effective date ${new Date(m.effectiveDate).toLocaleDateString('en-SG')} not yet reached` });
    }
    await applyMovement(m);
    const updated = await prisma.staffMovement.findUnique({ where: { id: m.id } });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /movements/sweep — daily/manual: applies all APPROVED movements whose effectiveDate ≤ today
async function runMovementSweep() {
  console.log('[movement-sweep] start');
  const now = new Date();
  const due = await prisma.staffMovement.findMany({
    where: { status: 'APPROVED', effectiveDate: { lte: now } },
  });
  let applied = 0, failed = 0;
  for (const m of due) {
    try {
      await applyMovement(m);
      applied += 1;
    } catch (err) {
      failed += 1;
      try {
        await prisma.staffMovement.update({
          where: { id: m.id }, data: { applyError: (err.message || 'unknown').slice(0, 500) },
        });
      } catch (_) { /* swallow */ }
      console.error('[movement-sweep] failed for', m.movementNumber, err.message);
    }
  }
  console.log(`[movement-sweep] applied=${applied} failed=${failed} due=${due.length}`);
  return { due: due.length, applied, failed };
}

router.post('/sweep', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const result = await runMovementSweep();
    res.json(result);
  } catch (err) { next(err); }
});

function scheduleMovementSweep() {
  if (process.env.NODE_ENV === 'test') return;
  const now    = new Date();
  const sgtNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const target = new Date(sgtNow);
  target.setHours(2, 0, 0, 0); // 02:00 SGT
  if (target <= sgtNow) target.setDate(target.getDate() + 1);
  const delayMs = target.getTime() - sgtNow.getTime();
  setTimeout(() => {
    runMovementSweep().catch(() => {});
    setInterval(() => runMovementSweep().catch(() => {}), 86_400_000);
  }, delayMs);
  console.log(`[movement-sweep] next run in ${Math.round(delayMs/3600000)}h`);
}

if (process.env.NODE_ENV !== 'test') {
  scheduleMovementSweep();
}

module.exports = router;
module.exports.runMovementSweep = runMovementSweep;
