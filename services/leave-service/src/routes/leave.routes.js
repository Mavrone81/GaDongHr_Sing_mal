'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();

const EMPLOYEE_URL = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';
const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || '';

const ADMIN_ROLES = new Set([ROLES.SUPER_ADMIN, ROLES.HR_ADMIN]);

// ── File-upload setup for leave attachments ───────────────────────────────────
const UPLOADS_DIR = path.join('/app/uploads/leave');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.heic', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// Batch-fetch employee summaries from employee-service and attach to applications.
// Falls back gracefully if employee-service is unreachable.
async function enrichWithEmployees(apps) {
  if (!apps || apps.length === 0) return apps;
  const ids = [...new Set(apps.map(a => a.employeeId).filter(Boolean))];
  if (ids.length === 0) return apps;
  const lookup = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data } = await axios.get(`${EMPLOYEE_URL}/employees/${id}`, {
        headers: { 'x-internal-service-key': INTERNAL_KEY, Authorization: 'Bearer internal' },
        timeout: 3000,
      });
      lookup[id] = {
        id: data.id,
        fullName: data.fullName,
        employeeCode: data.employeeCode,
        department: data.department,
        designation: data.designation,
        workEmail: data.workEmail,
        profilePhotoUrl: data.profilePhotoUrl ?? null,
      };
    } catch (err) {
      // swallow individual lookup failures — UI shows employeeId as fallback
    }
  }));
  return apps.map(a => ({ ...a, employee: lookup[a.employeeId] ?? null }));
}

// Build an attachment metadata blob for response payloads
function attachmentMeta(app) {
  if (!app?.documentPath) return null;
  const fileName = path.basename(app.documentPath);
  const ext = path.extname(fileName).toLowerCase();
  const mimeMap = {
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.heic': 'image/heic',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return {
    fileName,
    mimeType: mimeMap[ext] ?? 'application/octet-stream',
    downloadUrl: `/leave/applications/${app.id}/attachment`,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Complete months between two dates (floor)
function monthsBetween(start, end) {
  let m = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) m -= 1;
  return m;
}

// Pro-rate annual entitlement for partial year starting at eligibilityDate
function proRateEntitlement(annualDays, eligibilityDate, targetYear) {
  if (eligibilityDate.getFullYear() < targetYear) return annualDays; // full year
  const remainingMonths = 12 - eligibilityDate.getMonth(); // 0-indexed: April=3 → 9 months left
  return Math.ceil((annualDays / 12) * remainingMonths * 10) / 10;
}

async function getEmployeeStartDate(employeeId) {
  try {
    const { data } = await axios.get(`${EMPLOYEE_URL}/employees/${employeeId}`, {
      headers: { 'x-internal-service-key': INTERNAL_KEY, Authorization: 'Bearer internal' },
      timeout: 5000,
    });
    return data.startDate ? new Date(data.startDate) : null;
  } catch (err) {
    console.warn('[leave-service] getEmployeeStartDate failed:', err.message);
    return null;
  }
}

async function getActiveEmployees() {
  try {
    const { data } = await axios.get(`${EMPLOYEE_URL}/employees?limit=2000&isActive=true`, {
      headers: { 'x-internal-service-key': INTERNAL_KEY },
      timeout: 15000,
    });
    return data.employees || (Array.isArray(data) ? data : []);
  } catch (err) {
    console.warn('[leave-service] getActiveEmployees failed:', err.message);
    return [];
  }
}

// Auto-provision MOM-compliant entitlements for employees who have completed minServiceMonths
async function runAutoProvision() {
  const today = new Date();
  const year = today.getFullYear();
  console.log(`[leave-service] Auto-provision run: ${today.toISOString()}`);

  const leaveTypes = await prisma.leaveType.findMany({
    where: { isActive: true, minServiceMonths: { gt: 0 } },
  });
  if (!leaveTypes.length) return { provisioned: 0 };

  const employees = await getActiveEmployees();
  let provisioned = 0;

  for (const emp of employees) {
    if (!emp.startDate) continue;
    const startDate = new Date(emp.startDate);
    const monthsWorked = monthsBetween(startDate, today);

    for (const lt of leaveTypes) {
      if (monthsWorked < lt.minServiceMonths) continue;

      const existing = await prisma.leaveEntitlement.findFirst({
        where: { employeeId: emp.id, leaveTypeId: lt.id, year },
      });
      if (existing) continue;

      const eligibilityDate = new Date(startDate);
      eligibilityDate.setMonth(eligibilityDate.getMonth() + lt.minServiceMonths);

      const entitledDays = proRateEntitlement(lt.annualEntitlement, eligibilityDate, year);

      await prisma.leaveEntitlement.create({
        data: { id: uuidv4(), employeeId: emp.id, leaveTypeId: lt.id, year, entitledDays },
      });
      provisioned++;
      console.log(`[leave-service] Provisioned ${lt.code} for ${emp.id}: ${entitledDays} days`);
    }
  }

  console.log(`[leave-service] Auto-provision done. Provisioned: ${provisioned}`);
  return { provisioned };
}

// Fetch supervisor info from employee-service (returns null on any error)
async function getSupervisorCheck(employeeId, checkerEmployeeId) {
  if (!employeeId || !checkerEmployeeId) return null;
  try {
    const { data } = await axios.get(
      `${EMPLOYEE_URL}/employees/${employeeId}/supervisor-check`,
      {
        params: { checkerEmployeeId },
        headers: { 'x-internal-service-key': INTERNAL_KEY, Authorization: 'Bearer internal' },
        timeout: 3000,
      }
    );
    return data;
  } catch (err) {
    console.warn('[leave-service] supervisor-check failed:', err.message);
    return null;
  }
}

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
    const { code, name, isPaid, isStatutory, annualEntitlement, maxCarryForward, isGovtPaid, requiresDocument, minNoticeDays, minServiceMonths } = req.body;
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
        minServiceMonths: parseInt(minServiceMonths) || 0,
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
    const { name, isPaid, isStatutory, annualEntitlement, maxCarryForward, isGovtPaid, requiresDocument, minNoticeDays, minServiceMonths, isActive } = req.body;
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
        ...(minServiceMonths !== undefined && { minServiceMonths: parseInt(minServiceMonths) }),
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
    const result = types.map(t => {
      const isUnlimited = !t.isPaid || t.annualEntitlement === 0;
      return {
        leaveTypeId: t.id, code: t.code, name: t.name, isPaid: t.isPaid,
        annualEntitlement: t.annualEntitlement,
        isUnlimited,
        entitledDays: isUnlimited ? null : (map[t.id]?.entitledDays ?? t.annualEntitlement),
        usedDays: map[t.id]?.usedDays ?? 0,
        pendingDays: map[t.id]?.pendingDays ?? 0,
        carryForward: isUnlimited ? 0 : (map[t.id]?.carryForward ?? 0),
        entitlementId: map[t.id]?.id ?? null,
      };
    });
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

    // Load leave types for statutory minimum enforcement
    const typeIds = [...new Set(entitlements.map(e => e.leaveTypeId))];
    const types = await prisma.leaveType.findMany({ where: { id: { in: typeIds } } });
    const typeMap = Object.fromEntries(types.map(t => [t.id, t]));

    // Enforce statutory minimums — block if entitledDays is below the type's annualEntitlement
    const violations = entitlements
      .filter(e => {
        const t = typeMap[e.leaveTypeId];
        return t?.isStatutory && t.annualEntitlement > 0 && (parseFloat(e.entitledDays) || 0) < t.annualEntitlement;
      })
      .map(e => `${typeMap[e.leaveTypeId].name}: minimum is ${typeMap[e.leaveTypeId].annualEntitlement} days`);

    if (violations.length) {
      return res.status(400).json({ error: 'Statutory minimum violation', violations });
    }

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
    const { employeeId, status, page = 1, limit = 20, startDateFrom, startDateTo } = req.query;
    const where = {};
    // Employees see only their own; managers see their team
    if (req.user.role === 'employee') where.employeeId = req.user.employeeId;
    else if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status.toUpperCase();
    if (startDateFrom || startDateTo) {
      where.startDate = {};
      if (startDateFrom) where.startDate.gte = new Date(startDateFrom);
      if (startDateTo)   where.startDate.lte = new Date(startDateTo);
    }

    const [apps, total] = await Promise.all([
      prisma.leaveApplication.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit, take: Number(limit),
        include: { leaveType: { select: { code: true, name: true, isPaid: true } } },
      }),
      prisma.leaveApplication.count({ where }),
    ]);
    const enriched = (await enrichWithEmployees(apps)).map(a => ({ ...a, attachment: attachmentMeta(a) }));
    res.json({ applications: enriched, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// ── POST /leave/applications ──────────────────────────────────────────────────
// Accepts multipart/form-data with optional 'attachment' file (10MB, PDF/img/doc).
router.post('/applications', authenticate, upload.single('attachment'), async (req, res, next) => {
  try {
    const { leaveTypeId, startDate, endDate, reason, isHalfDay, halfDaySlot } = req.body;
    const employeeId = req.body.employeeId || req.user.employeeId;
    if (!leaveTypeId || !startDate || !endDate) return res.status(400).json({ error: 'leaveTypeId, startDate, endDate required' });

    const start = new Date(startDate);
    const end = new Date(endDate);
    const msPerDay = 24 * 60 * 60 * 1000;
    let totalDays = Math.round((end - start) / msPerDay) + 1;
    if (isHalfDay) totalDays = 0.5;

    // Fetch leave type to determine if balance check applies
    const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType) return res.status(404).json({ error: 'Leave type not found' });
    if (!leaveType.isActive) return res.status(400).json({ error: 'This leave type is no longer active' });

    // MOM minimum service check
    if (leaveType.minServiceMonths > 0) {
      const empStartDate = await getEmployeeStartDate(employeeId);
      if (empStartDate) {
        const monthsWorked = monthsBetween(empStartDate, new Date());
        if (monthsWorked < leaveType.minServiceMonths) {
          return res.status(400).json({
            error: `${leaveType.name} requires a minimum of ${leaveType.minServiceMonths} months of service. You have completed ${monthsWorked} month(s). Eligibility date: ${new Date(empStartDate.getFullYear(), empStartDate.getMonth() + leaveType.minServiceMonths, empStartDate.getDate()).toISOString().slice(0, 10)}.`,
          });
        }
      }
    }

    const year = start.getFullYear();
    // Unpaid leave (isPaid=false) and open-ended types (annualEntitlement=0) have no balance ceiling.
    // Still track usage via entitlement record, but skip the "available < requested" gate.
    const isUnlimited = !leaveType.isPaid || leaveType.annualEntitlement === 0;

    const entitlement = await prisma.leaveEntitlement.findFirst({ where: { employeeId, leaveTypeId, year } });

    if (!isUnlimited) {
      if (entitlement) {
        const available = entitlement.entitledDays + entitlement.carryForward - entitlement.usedDays - entitlement.pendingDays;
        if (available < totalDays) return res.status(400).json({ error: `Insufficient leave balance. Available: ${available} days` });
      }
      // No entitlement record means HR hasn't allocated this type yet — block it for paid/capped types
      if (!entitlement) return res.status(400).json({ error: `No ${leaveType.name} entitlement allocated for ${year}. Please contact HR.` });
    }

    // Track pending days (for both capped and unlimited types — useful for NPL reporting / payroll)
    if (entitlement) {
      await prisma.leaveEntitlement.update({ where: { id: entitlement.id }, data: { pendingDays: { increment: totalDays } } });
    } else {
      // Auto-create a tracking record for unlimited/unpaid types (entitledDays=0 = no ceiling)
      await prisma.leaveEntitlement.create({
        data: { id: uuidv4(), employeeId, leaveTypeId, year, entitledDays: 0, pendingDays: totalDays },
      });
    }

    const documentPath = req.file ? req.file.filename : null;
    const app = await prisma.leaveApplication.create({
      data: { id: uuidv4(), employeeId, leaveTypeId, startDate: start, endDate: end, totalDays, reason, isHalfDay: !!isHalfDay, halfDaySlot, status: 'PENDING', documentPath },
      include: { leaveType: { select: { code: true, name: true } } },
    });
    res.status(201).json({ ...app, attachment: attachmentMeta(app) });
  } catch (err) { next(err); }
});

// ── GET /leave/applications/:id ───────────────────────────────────────────────
router.get('/applications/:id', authenticate, async (req, res, next) => {
  try {
    const app = await prisma.leaveApplication.findUnique({
      where: { id: req.params.id },
      include: {
        leaveType: { select: { code: true, name: true, isPaid: true, requiresDocument: true } },
        approvalSteps: { orderBy: { step: 'asc' } },
      },
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    // Authorize: applicant, or HR / supervisor roles
    const role = req.user.role?.toUpperCase();
    const isSelf = req.user.employeeId && req.user.employeeId === app.employeeId;
    const isPrivileged = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER, ROLES.PAYROLL_OFFICER].includes(role);
    if (!isSelf && !isPrivileged) return res.status(403).json({ error: 'Forbidden' });

    const [enriched] = await enrichWithEmployees([app]);
    res.json({ ...enriched, attachment: attachmentMeta(app) });
  } catch (err) { next(err); }
});

// ── GET /leave/applications/:id/attachment — stream the uploaded file ─────────
router.get('/applications/:id/attachment', authenticate, async (req, res, next) => {
  try {
    const app = await prisma.leaveApplication.findUnique({ where: { id: req.params.id } });
    if (!app) return res.status(404).json({ error: 'Application not found' });
    if (!app.documentPath) return res.status(404).json({ error: 'No attachment on this application' });

    const role = req.user.role?.toUpperCase();
    const isSelf = req.user.employeeId && req.user.employeeId === app.employeeId;
    const isPrivileged = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER, ROLES.PAYROLL_OFFICER].includes(role);
    if (!isSelf && !isPrivileged) return res.status(403).json({ error: 'Forbidden' });

    const filePath = path.join(UPLOADS_DIR, path.basename(app.documentPath));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    const meta = attachmentMeta(app);
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${meta.fileName}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
});

// ── PUT /leave/applications/:id/approve ───────────────────────────────────────
router.put('/applications/:id/approve', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.LINE_MANAGER), async (req, res, next) => {
  try {
    const app = await prisma.leaveApplication.findUnique({
      where: { id: req.params.id },
      include: { approvalSteps: { orderBy: { step: 'asc' } } },
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });
    if (app.status !== 'PENDING') return res.status(400).json({ error: 'Only PENDING applications can be approved' });

    const approverRole = req.user.role?.toUpperCase();
    const approverEmpId = req.user.employeeId;

    // HR_ADMIN / SUPER_ADMIN bypass supervisor chain entirely
    if (!ADMIN_ROLES.has(approverRole)) {
      const check = await getSupervisorCheck(app.employeeId, approverEmpId);

      if (check && check.totalSupervisors > 0) {
        // Supervisor chain is configured — enforce it
        if (!check.isSupervisor) {
          return res.status(403).json({ error: 'You are not a designated supervisor for this employee' });
        }

        if (check.flowType === 'SEQUENTIAL') {
          const expectedStep = app.currentApprovalStep;
          if (check.supervisorOrder !== expectedStep) {
            return res.status(403).json({
              error: `Sequential approval required. Waiting for supervisor at step ${expectedStep}.`,
            });
          }

          // Record this step
          await prisma.leaveApprovalStep.create({
            data: { id: uuidv4(), applicationId: app.id, step: expectedStep, approvedByEmpId: approverEmpId },
          });

          const isLastStep = expectedStep >= check.totalSupervisors;
          if (!isLastStep) {
            // Advance to next step — application stays PENDING
            const advanced = await prisma.leaveApplication.update({
              where: { id: app.id },
              data: { currentApprovalStep: expectedStep + 1 },
            });
            return res.json({ ...advanced, message: `Step ${expectedStep} approved. Awaiting step ${expectedStep + 1}.` });
          }
          // Last step — fall through to final approval below
        }
        // ANY_ONE flow: any supervisor can approve immediately — fall through
      }
      // No supervisors configured — only HR_ADMIN / SUPER_ADMIN would reach here
      // (they are already excluded above). For other roles without a supervisor chain,
      // we deny to prevent unintended approvals.
      else if (check && check.totalSupervisors === 0) {
        return res.status(403).json({ error: 'No supervisors configured for this employee. Contact HR Admin.' });
      }
    }

    // Final approval: move pendingDays → usedDays and mark APPROVED
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

// ── POST /leave/internal/auto-provision — trigger MOM entitlement provisioning ─
router.post('/internal/auto-provision', async (req, res, next) => {
  const key = req.headers['x-internal-service-key'];
  if (!key || key !== INTERNAL_KEY) return res.status(403).json({ error: 'Forbidden' });
  try {
    const result = await runAutoProvision();
    res.json(result);
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
module.exports.runAutoProvision = runAutoProvision;
