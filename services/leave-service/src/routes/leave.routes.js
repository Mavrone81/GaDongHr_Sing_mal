'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');

const prisma = require('../utils/prisma');
const { lazyProvisionFromDefault } = require('/app/shared/tenant-context');

const EMPLOYEE_URL = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';
const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || '';

const ADMIN_ROLES = new Set([ROLES.SUPER_ADMIN, ROLES.HR_ADMIN]);
// Roles allowed to view leave applications across all employees (e.g. via ?employeeId=)
// or to receive the unfiltered list. Includes payroll officers who need full visibility
// for payroll integration, and HR managers for team-wide oversight.
const LEAVE_VIEW_ROLES = new Set([
  ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_OFFICER,
]);
// Roles allowed to submit a leave application on behalf of another employee.
const LEAVE_SUBMIT_FOR_OTHERS = new Set([ROLES.SUPER_ADMIN, ROLES.HR_ADMIN]);

// ── File-upload setup for leave attachments ───────────────────────────────────
// Base dir defaults to the container's /app/uploads but is overridable via
// UPLOADS_DIR. If the base isn't writable (e.g. CI runners can't mkdir under
// /app), fall back to the OS temp dir so importing this module never crashes.
const os = require('os');
function resolveUploadsDir(subdir) {
  const dir = path.join(process.env.UPLOADS_DIR || '/app/uploads', subdir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    const fallback = path.join(os.tmpdir(), 'hrms-uploads', subdir);
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}
const UPLOADS_DIR = resolveUploadsDir('leave');

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
// Forwards the caller's Bearer token so employee-service's JWT auth is satisfied.
// Falls back gracefully if employee-service is unreachable.
async function enrichWithEmployees(apps, authHeader) {
  if (!apps || apps.length === 0) return apps;
  const ids = [...new Set(apps.map(a => a.employeeId).filter(Boolean))];
  if (ids.length === 0) return apps;
  const lookup = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const { data } = await axios.get(`${EMPLOYEE_URL}/employees/${id}`, {
        headers: authHeader ? { Authorization: authHeader } : {},
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
router.get('/types', authenticate, authorize('leave:view'), async (req, res, next) => {
  try {
    // Lazy tenant provisioning: a freshly-registered company gets the Default
    // tenant's leave types cloned on first access.
    await lazyProvisionFromDefault(prisma.leaveType, req.user?.tenantId);
    const all = req.query.all === 'true';
    const types = await prisma.leaveType.findMany({ where: all ? {} : { isActive: true }, orderBy: { name: 'asc' } });
    res.json(types);
  } catch (err) { next(err); }
});

// ── POST /leave/types ─────────────────────────────────────────────────────────
router.post('/types', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { code, name, isPaid, isStatutory, annualEntitlement, maxCarryForward, isGovtPaid, requiresDocument, minNoticeDays, minServiceMonths, msfDailyCap, msfWeeklyCap, msfPeriodCap, msfPeriodWeeks } = req.body;
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
        msfDailyCap:    msfDailyCap   != null ? parseFloat(msfDailyCap)   : null,
        msfWeeklyCap:   msfWeeklyCap  != null ? parseFloat(msfWeeklyCap)  : null,
        msfPeriodCap:   msfPeriodCap  != null ? parseFloat(msfPeriodCap)  : null,
        msfPeriodWeeks: msfPeriodWeeks != null ? parseInt(msfPeriodWeeks) : null,
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
    const { employeeId, status, page = 1, limit = 20, startDateFrom, startDateTo, endDateFrom } = req.query;
    const where = {};
    // Default-deny: only privileged roles see the unfiltered list or filter
    // by an arbitrary employeeId. Everyone else is force-scoped to their own employeeId.
    const isPrivileged = LEAVE_VIEW_ROLES.has(req.user.role);
    if (!isPrivileged) {
      // Non-privileged callers only see their own applications. No linked
      // employee record → none; return empty rather than passing a null
      // employeeId to Prisma (rejected on the non-nullable column → 500).
      if (!req.user.employeeId) {
        return res.json({ applications: [], total: 0, page: Number(page), pages: 0 });
      }
      where.employeeId = req.user.employeeId;
    } else if (employeeId) {
      where.employeeId = employeeId;
    }
    if (status) where.status = status.toUpperCase();
    if (startDateFrom || startDateTo) {
      where.startDate = {};
      if (startDateFrom) where.startDate.gte = new Date(startDateFrom);
      if (startDateTo)   where.startDate.lte = new Date(startDateTo);
    }
    // endDateFrom enables overlap queries: startDate <= X (via startDateTo) AND endDate >= Y (via endDateFrom)
    // Used by payroll service to fetch all leaves that touch a given pay period, including cross-month ones.
    if (endDateFrom) {
      where.endDate = { gte: new Date(endDateFrom) };
    }

    const [apps, total] = await Promise.all([
      prisma.leaveApplication.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit, take: Number(limit),
        include: { leaveType: { select: { code: true, name: true, isPaid: true, isGovtPaid: true } } },
      }),
      prisma.leaveApplication.count({ where }),
    ]);
    const enriched = (await enrichWithEmployees(apps, req.headers.authorization)).map(a => ({ ...a, attachment: attachmentMeta(a) }));
    res.json({ applications: enriched, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// ── POST /leave/applications ──────────────────────────────────────────────────
// Accepts multipart/form-data with optional 'attachment' file (10MB, PDF/img/doc).
router.post('/applications', authenticate, upload.single('attachment'), async (req, res, next) => {
  try {
    const { leaveTypeId, startDate, endDate, reason, isHalfDay, halfDaySlot } = req.body;
    // Only HR admins may submit a leave application on behalf of another employee.
    // Otherwise force the application to the authenticated user's employeeId.
    const canSubmitForOthers = LEAVE_SUBMIT_FOR_OTHERS.has(req.user.role);
    const employeeId = (canSubmitForOthers && req.body.employeeId) ? req.body.employeeId : req.user.employeeId;
    if (!leaveTypeId || !startDate || !endDate) return res.status(400).json({ error: 'leaveTypeId, startDate, endDate required' });

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ error: 'startDate and endDate must be valid dates' });
    }
    const msPerDay = 24 * 60 * 60 * 1000;
    let totalDays = Math.round((end - start) / msPerDay) + 1;
    if (isHalfDay) totalDays = 0.5;
    // Reject zero or negative totalDays. Previously endDate < startDate produced
    // negative totalDays which (a) skipped the `available < totalDays` balance check
    // and (b) on approval *reduced* usedDays via increment(-N), letting employees
    // inflate their leave balance arbitrarily.
    if (totalDays <= 0) {
      return res.status(400).json({ error: 'endDate must be on or after startDate' });
    }

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

    const [enriched] = await enrichWithEmployees([app], req.headers.authorization);
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

// ── GET /leave/internal/on-leave-today — list of employees on approved leave today ─
// Used by attendance-service today-dashboard (TAT-004) to route those employees
// into the ON_LEAVE bucket instead of NOT_CLOCKED_IN.
router.get('/internal/on-leave-today', async (req, res, next) => {
  const key = req.headers['x-internal-service-key'];
  if (!key || key !== INTERNAL_KEY) return res.status(403).json({ error: 'Forbidden' });
  try {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrow = new Date(today); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const apps = await prisma.leaveApplication.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lt: tomorrow },
        endDate:   { gte: today },
      },
      include: { leaveType: { select: { code: true, name: true } } },
    });
    res.json(apps.map(a => ({
      employeeId: a.employeeId,
      leaveTypeCode: a.leaveType?.code,
      leaveTypeName: a.leaveType?.name,
      startDate: a.startDate,
      endDate: a.endDate,
      isHalfDay: a.isHalfDay,
      halfDaySlot: a.halfDaySlot,
    })));
  } catch (err) { next(err); }
});

// ── GET /leave/internal/all-balances?year=YYYY — leave liability source for reporting ─
router.get('/internal/all-balances', async (req, res, next) => {
  const key = req.headers['x-internal-service-key'];
  if (!key || key !== INTERNAL_KEY) return res.status(403).json({ error: 'Forbidden' });
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const entitlements = await prisma.leaveEntitlement.findMany({
      where: { year },
      include: { leaveType: { select: { code: true, name: true, isPaid: true } } },
    });
    // Group by employeeId
    const byEmp = {};
    for (const e of entitlements) {
      if (!byEmp[e.employeeId]) byEmp[e.employeeId] = [];
      byEmp[e.employeeId].push({
        leaveTypeId: e.leaveTypeId,
        code: e.leaveType.code,
        name: e.leaveType.name,
        isPaid: e.leaveType.isPaid,
        entitledDays: e.entitledDays,
        usedDays: e.usedDays,
        pendingDays: e.pendingDays,
        carryForward: e.carryForward,
      });
    }
    const result = Object.entries(byEmp).map(([employeeId, balances]) => ({ employeeId, balances }));
    res.json(result);
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

// ─── LEA-005: MSF cap configuration + govt-paid claim tracking ────────────────

const { computeClaimAmount, validateTransition } = require('../engines/msf-cap.engine');
const PAYROLL_URL = process.env.PAYROLL_SERVICE_URL || 'http://payroll-service:4003';

// PUT /leave/leave-types/:id/msf-config — configure MSF caps on a leave type
router.put('/leave-types/:id/msf-config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const fields = ['msfDailyCap', 'msfWeeklyCap', 'msfPeriodCap'];
    const data = {};
    for (const f of fields) {
      if (req.body[f] === null) { data[f] = null; continue; }
      if (req.body[f] !== undefined) {
        const n = parseFloat(req.body[f]);
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `Invalid value for ${f}` });
        data[f] = n;
      }
    }
    if (req.body.msfPeriodWeeks === null) data.msfPeriodWeeks = null;
    else if (req.body.msfPeriodWeeks !== undefined) {
      const n = parseInt(req.body.msfPeriodWeeks);
      if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'msfPeriodWeeks must be a positive integer' });
      data.msfPeriodWeeks = n;
    }
    if (req.body.isGovtPaid !== undefined) data.isGovtPaid = !!req.body.isGovtPaid;
    const type = await prisma.leaveType.update({ where: { id: req.params.id }, data });
    res.json(type);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Leave type not found' });
    next(err);
  }
});

// Helper — derive daily rate from payroll service. Falls back to caller-
// supplied dailyRateOverride when payroll-service is unreachable / has no
// published payslip yet for that employee + period.
async function resolveDailyRate(employeeId, refDate, override, authHeader) {
  if (Number.isFinite(Number(override)) && Number(override) > 0) return Number(override);
  try {
    const period = `${refDate.getUTCFullYear()}-${String(refDate.getUTCMonth() + 1).padStart(2, '0')}`;
    const r = await fetch(`${PAYROLL_URL}/payroll/internal/daily-rate/${employeeId}/${period}`, {
      headers: { 'x-internal-service-key': INTERNAL_KEY, Authorization: authHeader || 'Bearer internal' },
    });
    if (r.ok) {
      const data = await r.json();
      if (Number.isFinite(Number(data.dailyRate)) && data.dailyRate > 0) return Number(data.dailyRate);
    }
  } catch (_e) { /* swallow — fall through */ }
  return 0;
}

// POST /leave/govt-claims/generate?period=YYYY-MM
// Iterates all approved govt-paid leave applications whose startDate falls in
// the period and (re-)computes the claim record using the leave-type's MSF
// caps. Idempotent — never resets a SUBMITTED / REIMBURSED claim's status.
router.post('/govt-claims/generate', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const period = req.query.period;
    if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return res.status(400).json({ error: 'period query param (YYYY-MM) is required' });
    }
    const [y, m] = period.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end   = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    const apps = await prisma.leaveApplication.findMany({
      where: { status: 'APPROVED', startDate: { gte: start, lte: end }, leaveType: { isGovtPaid: true } },
      include: { leaveType: true },
    });
    const dailyRateOverrides = req.body?.dailyRateOverrides || {};
    let generated = 0, skipped = 0, untouched = 0;
    const details = [];
    for (const app of apps) {
      // Never touch a row already submitted / reimbursed
      if (app.claimStatus === 'SUBMITTED' || app.claimStatus === 'REIMBURSED') {
        untouched += 1;
        continue;
      }
      const dailyRate = await resolveDailyRate(app.employeeId, app.startDate, dailyRateOverrides[app.employeeId], req.headers.authorization);
      if (dailyRate <= 0) {
        skipped += 1;
        details.push({ applicationId: app.id, employeeId: app.employeeId, skipped: 'no daily rate (no payslip + no override)' });
        continue;
      }
      const computed = computeClaimAmount({ totalDays: app.totalDays, dailyRate, leaveType: app.leaveType });
      await prisma.leaveApplication.update({
        where: { id: app.id },
        data: {
          claimStatus:         'NOT_SUBMITTED',
          claimAmount:         computed.amount,
          claimDailyRate:      computed.dailyRate,
          claimUncappedAmount: computed.uncappedAmount,
          claimCapApplied:     computed.capApplied,
          claimNotes:          computed.notes,
        },
      });
      generated += 1;
      details.push({
        applicationId: app.id, employeeId: app.employeeId,
        leaveTypeCode: app.leaveType.code,
        days: app.totalDays, dailyRate, ...computed,
      });
    }
    res.json({ period, generated, untouched, skipped, total: apps.length, details });
  } catch (err) { next(err); }
});

// GET /leave/govt-claims?period=&status=&leaveTypeCode=&employeeId=
router.get('/govt-claims', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const { period, status, leaveTypeCode, employeeId } = req.query;
    const where = { status: 'APPROVED', leaveType: { isGovtPaid: true } };
    if (status)        where.claimStatus = status;
    if (employeeId)    where.employeeId  = employeeId;
    if (leaveTypeCode) where.leaveType   = { ...(where.leaveType || {}), code: String(leaveTypeCode).toUpperCase() };
    if (period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      const [y, m] = period.split('-').map(Number);
      where.startDate = { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)) };
    }
    const rows = await prisma.leaveApplication.findMany({
      where,
      include: { leaveType: { select: { code: true, name: true, msfDailyCap: true, msfWeeklyCap: true, msfPeriodCap: true } } },
      orderBy: { startDate: 'desc' },
      take: 500,
    });
    const summary = rows.reduce((acc, r) => {
      acc.byStatus[r.claimStatus] = (acc.byStatus[r.claimStatus] || 0) + 1;
      acc.byLeaveType[r.leaveType.code] = (acc.byLeaveType[r.leaveType.code] || 0) + 1;
      acc.totalClaimable += (r.claimAmount || 0);
      acc.totalReimbursed += (r.claimReimbursedAmount || 0);
      return acc;
    }, { byStatus: {}, byLeaveType: {}, totalClaimable: 0, totalReimbursed: 0 });
    summary.totalClaimable  = Math.round(summary.totalClaimable  * 100) / 100;
    summary.totalReimbursed = Math.round(summary.totalReimbursed * 100) / 100;
    res.json({ total: rows.length, summary, claims: rows });
  } catch (err) { next(err); }
});

// GET /leave/govt-claims/summary?period=YYYY-MM
router.get('/govt-claims/summary', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const period = req.query.period;
    const where = { status: 'APPROVED', leaveType: { isGovtPaid: true } };
    if (period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      const [y, m] = period.split('-').map(Number);
      where.startDate = { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)) };
    }
    const rows = await prisma.leaveApplication.findMany({ where, include: { leaveType: { select: { code: true, name: true } } } });
    const byType = new Map();
    let totalClaimable = 0;
    let totalReimbursed = 0;
    const byStatus = {};
    for (const r of rows) {
      const k = r.leaveType.code;
      const e = byType.get(k) || { code: k, name: r.leaveType.name, totalDays: 0, totalClaimable: 0, totalReimbursed: 0, byStatus: {} };
      e.totalDays += r.totalDays;
      e.totalClaimable += (r.claimAmount || 0);
      e.totalReimbursed += (r.claimReimbursedAmount || 0);
      e.byStatus[r.claimStatus] = (e.byStatus[r.claimStatus] || 0) + 1;
      byType.set(k, e);
      totalClaimable  += (r.claimAmount || 0);
      totalReimbursed += (r.claimReimbursedAmount || 0);
      byStatus[r.claimStatus] = (byStatus[r.claimStatus] || 0) + 1;
    }
    res.json({
      period: period || null,
      totals: {
        applications: rows.length,
        totalClaimable:  Math.round(totalClaimable  * 100) / 100,
        totalReimbursed: Math.round(totalReimbursed * 100) / 100,
        byStatus,
      },
      byLeaveType: Array.from(byType.values()).map(e => ({
        ...e,
        totalClaimable:  Math.round(e.totalClaimable  * 100) / 100,
        totalReimbursed: Math.round(e.totalReimbursed * 100) / 100,
      })),
    });
  } catch (err) { next(err); }
});

// PUT /leave/govt-claims/:applicationId/status
// Body: { status, submissionRef?, reimbursedAmount?, rejectedReason?, notes? }
router.put('/govt-claims/:applicationId/status', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const existing = await prisma.leaveApplication.findUnique({ where: { id: req.params.applicationId }, include: { leaveType: true } });
    if (!existing) return res.status(404).json({ error: 'Leave application not found' });
    if (!existing.leaveType.isGovtPaid) return res.status(400).json({ error: 'Leave type is not govt-paid' });
    const { status, submissionRef, reimbursedAmount, rejectedReason, notes } = req.body;
    const guard = validateTransition(existing.claimStatus || 'NOT_APPLICABLE', status);
    if (!guard.ok) return res.status(409).json({ error: guard.error });
    if (status === 'SUBMITTED' && !submissionRef) {
      return res.status(400).json({ error: 'submissionRef required when transitioning to SUBMITTED' });
    }
    if (status === 'REIMBURSED' && !Number.isFinite(Number(reimbursedAmount))) {
      return res.status(400).json({ error: 'reimbursedAmount required when transitioning to REIMBURSED' });
    }
    if (status === 'REJECTED' && !rejectedReason) {
      return res.status(400).json({ error: 'rejectedReason required when transitioning to REJECTED' });
    }
    const data = { claimStatus: status };
    if (status === 'SUBMITTED') {
      data.claimSubmissionRef = submissionRef;
      data.claimSubmittedAt   = new Date();
    }
    if (status === 'REIMBURSED') {
      data.claimReimbursedAmount = Number(reimbursedAmount);
      data.claimReimbursedAt     = new Date();
    }
    if (status === 'REJECTED') {
      data.claimRejectedReason = rejectedReason;
    }
    if (status === 'NOT_SUBMITTED') {
      // Resubmission after REJECTED — clear rejection breadcrumb
      data.claimRejectedReason = null;
    }
    if (notes != null) data.claimNotes = notes;
    const updated = await prisma.leaveApplication.update({ where: { id: existing.id }, data, include: { leaveType: { select: { code: true, name: true } } } });
    res.json(updated);
  } catch (err) { next(err); }
});

// ─── LEA-004: MC pattern detection & sick-leave trend analytics ───────────────

const { detectPatterns, buildTrends } = require('../engines/mc-pattern.engine');

// Identify sick-leave type IDs from the DB (code contains SICK/MC/MEDICAL, or requiresDocument).
async function getSickLeaveTypeIds() {
  const types = await prisma.leaveType.findMany({ where: { isActive: true } });
  const sick = types.filter(t =>
    /\b(SICK|MC|MEDICAL)\b/i.test(t.code) || t.requiresDocument
  );
  return sick.map(t => t.id);
}

// GET /leave/mc-patterns?months=N&minOccurrences=N&minRatio=F
// Returns Mon/Fri MC abuse suspects, enriched with employee name/dept.
router.get('/mc-patterns', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const months = Math.min(Math.max(parseInt(req.query.months) || 12, 1), 36);
    const minOccurrences = parseInt(req.query.minOccurrences) || 3;
    const minRatio = parseFloat(req.query.minRatio) || 0.5;

    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - months);
    since.setUTCHours(0, 0, 0, 0);

    const sickTypeIds = await getSickLeaveTypeIds();
    if (!sickTypeIds.length) return res.json({ flagged: [], analysedMonths: months, sickLeaveTypes: [] });

    const apps = await prisma.leaveApplication.findMany({
      where: { leaveTypeId: { in: sickTypeIds }, status: 'APPROVED', startDate: { gte: since } },
      select: { employeeId: true, startDate: true, endDate: true },
    });

    const flagged = detectPatterns(apps, { minOccurrences, minRatio });

    // Enrich with employee details
    const uniqueIds = [...new Set(flagged.map(f => f.employeeId))];
    const empLookup = {};
    await Promise.allSettled(uniqueIds.map(async id => {
      try {
        const { data } = await axios.get(`${EMPLOYEE_URL}/employees/${id}`, {
          headers: { 'x-internal-service-key': INTERNAL_KEY },
          timeout: 3000,
        });
        empLookup[id] = { name: data.fullName, department: data.department, designation: data.designation };
      } catch (_) {}
    }));

    const enriched = flagged.map(f => ({ ...f, employee: empLookup[f.employeeId] ?? null }));

    res.json({ flagged: enriched, analysedMonths: months, totalApplications: apps.length });
  } catch (err) { next(err); }
});

// GET /leave/sick-leave-trends?months=N
// Returns sick leave days by employee (top 20) and by department.
router.get('/sick-leave-trends', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const months = Math.min(Math.max(parseInt(req.query.months) || 12, 1), 36);

    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - months);
    since.setUTCHours(0, 0, 0, 0);

    const sickTypeIds = await getSickLeaveTypeIds();
    if (!sickTypeIds.length) return res.json({ byEmployee: [], byDepartment: [], analysedMonths: months });

    const apps = await prisma.leaveApplication.findMany({
      where: { leaveTypeId: { in: sickTypeIds }, status: 'APPROVED', startDate: { gte: since } },
      select: { employeeId: true, startDate: true, endDate: true, totalDays: true },
    });

    // Fetch all unique employees
    const uniqueIds = [...new Set(apps.map(a => a.employeeId))];
    const empMap = new Map();
    await Promise.allSettled(uniqueIds.map(async id => {
      try {
        const { data } = await axios.get(`${EMPLOYEE_URL}/employees/${id}`, {
          headers: { 'x-internal-service-key': INTERNAL_KEY },
          timeout: 3000,
        });
        empMap.set(id, { name: data.fullName, department: data.department });
      } catch (_) {}
    }));

    const { byEmployee, byDepartment } = buildTrends(apps, empMap);

    res.json({
      byEmployee: byEmployee.slice(0, 20),
      byDepartment,
      analysedMonths: months,
      totalApplications: apps.length,
    });
  } catch (err) { next(err); }
});

// ─── CCL / UICL / ECL — Child record workflow ────────────────────────────────
const { computeEmployeeEntitlements, ageBracketLabel, LEAVE_TYPE_SEEDS } = require('../engines/ccl.engine');

// Ensure a LeaveType row exists for the given code; create with defaults if missing.
async function ensureLeaveType(code) {
  let lt = await prisma.leaveType.findFirst({ where: { code } });
  if (!lt) {
    const seed = LEAVE_TYPE_SEEDS[code];
    if (!seed) throw new Error(`No seed data for leave type code: ${code}`);
    lt = await prisma.leaveType.create({ data: seed });
  }
  return lt;
}

// Apply computed entitlements to LeaveEntitlement rows for the current year.
async function applyEntitlements(employeeId, entitlements, year) {
  const results = [];
  for (const { code, days } of entitlements) {
    const lt = await ensureLeaveType(code);
    const existing = await prisma.leaveEntitlement.findFirst({
      where: { employeeId, leaveTypeId: lt.id, year },
    });
    if (existing) {
      // Only update if the new entitlement is different
      if (existing.entitledDays !== days) {
        await prisma.leaveEntitlement.update({
          where: { id: existing.id },
          data: { entitledDays: days },
        });
        results.push({ code, days, action: 'updated', leaveTypeId: lt.id });
      } else {
        results.push({ code, days, action: 'unchanged', leaveTypeId: lt.id });
      }
    } else {
      await prisma.leaveEntitlement.create({
        data: { id: uuidv4(), employeeId, leaveTypeId: lt.id, year, entitledDays: days },
      });
      results.push({ code, days, action: 'created', leaveTypeId: lt.id });
    }
  }
  return results;
}

// POST /leave/children — register a child record (employee or HR)
router.post('/children', authenticate, async (req, res, next) => {
  try {
    const { fullName, dateOfBirth, citizenship, notes } = req.body;
    if (!fullName || !dateOfBirth || !citizenship) {
      return res.status(400).json({ error: 'fullName, dateOfBirth and citizenship are required' });
    }
    const VALID_CITIZENSHIP = ['SC', 'PR', 'FOREIGNER'];
    if (!VALID_CITIZENSHIP.includes(citizenship)) {
      return res.status(400).json({ error: `citizenship must be one of: ${VALID_CITIZENSHIP.join(', ')}` });
    }
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) return res.status(400).json({ error: 'Invalid dateOfBirth' });
    if (dob > new Date()) return res.status(400).json({ error: 'dateOfBirth cannot be in the future' });

    // HR/Admin can supply employeeId; employees use their own
    const isAdmin = ADMIN_ROLES.has(req.user.role) || req.user.role === ROLES.HR_MANAGER;
    const employeeId = isAdmin && req.body.employeeId ? req.body.employeeId : req.user.employeeId || req.user.sub;

    const child = await prisma.childRecord.create({
      data: {
        id: uuidv4(),
        employeeId,
        fullName: fullName.trim(),
        dateOfBirth: dob,
        citizenship,
        notes: notes || null,
        verificationStatus: 'PENDING',
      },
    });
    res.status(201).json(child);
  } catch (err) { next(err); }
});

// GET /leave/children — list children (own if employee; all if HR with ?employeeId filter)
router.get('/children', authenticate, async (req, res, next) => {
  try {
    const isAdmin = ADMIN_ROLES.has(req.user.role) || req.user.role === ROLES.HR_MANAGER;
    const where = {};
    if (!isAdmin) {
      where.employeeId = req.user.employeeId || req.user.sub;
    } else if (req.query.employeeId) {
      where.employeeId = req.query.employeeId;
    }
    if (req.query.status) where.verificationStatus = req.query.status;

    const children = await prisma.childRecord.findMany({
      where,
      orderBy: { dateOfBirth: 'asc' },
    });
    res.json({ total: children.length, children });
  } catch (err) { next(err); }
});

// GET /leave/children/pending — HR only: verification queue
router.get('/children/pending', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const children = await prisma.childRecord.findMany({
      where: { verificationStatus: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ total: children.length, children });
  } catch (err) { next(err); }
});

// GET /leave/children/:id — get a single child record
router.get('/children/:id', authenticate, async (req, res, next) => {
  try {
    const child = await prisma.childRecord.findUnique({ where: { id: req.params.id } });
    if (!child) return res.status(404).json({ error: 'Child record not found' });
    const isAdmin = ADMIN_ROLES.has(req.user.role) || req.user.role === ROLES.HR_MANAGER;
    const selfId = req.user.employeeId || req.user.sub;
    if (!isAdmin && child.employeeId !== selfId) return res.status(403).json({ error: 'Forbidden' });
    res.json(child);
  } catch (err) { next(err); }
});

// PUT /leave/children/:id/verify — HR Admin: verify or reject a child record
// Body: { status: 'VERIFIED'|'REJECTED', rejectedReason?: string, notes?: string }
// On VERIFIED: auto-upserts CCL/UICL/ECL entitlements for the current year.
router.put('/children/:id/verify', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { status, rejectedReason, notes } = req.body;
    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'status must be VERIFIED or REJECTED' });
    }
    if (status === 'REJECTED' && !rejectedReason) {
      return res.status(400).json({ error: 'rejectedReason is required when rejecting' });
    }

    const child = await prisma.childRecord.findUnique({ where: { id: req.params.id } });
    if (!child) return res.status(404).json({ error: 'Child record not found' });
    if (child.verificationStatus === 'VERIFIED' && status === 'VERIFIED') {
      return res.status(409).json({ error: 'Child record is already verified' });
    }

    const updated = await prisma.childRecord.update({
      where: { id: req.params.id },
      data: {
        verificationStatus: status,
        verifiedBy: req.user.sub,
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
        rejectedReason: status === 'REJECTED' ? (rejectedReason || null) : null,
        notes: notes !== undefined ? notes : child.notes,
      },
    });

    let entitlementResult = null;
    if (status === 'VERIFIED') {
      // Recompute based on all verified children for this employee
      const verifiedChildren = await prisma.childRecord.findMany({
        where: { employeeId: child.employeeId, verificationStatus: 'VERIFIED' },
      });
      const year = new Date().getFullYear();
      const { youngest, entitlements, ageYears: age } = computeEmployeeEntitlements(verifiedChildren);
      const applied = await applyEntitlements(child.employeeId, entitlements, year);
      entitlementResult = {
        youngestChildId: youngest ? youngest.id : null,
        ageBracket: ageBracketLabel(age),
        year,
        applied,
      };
    }

    res.json({ child: updated, entitlementResult });
  } catch (err) { next(err); }
});

// GET /leave/children/:employeeId/entitlement-preview
// HR: preview what CCL/UICL/ECL entitlements would be computed for an employee
// based on their verified children (no DB write).
router.get('/children/:employeeId/entitlement-preview', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const verifiedChildren = await prisma.childRecord.findMany({
      where: { employeeId, verificationStatus: 'VERIFIED' },
      orderBy: { dateOfBirth: 'asc' },
    });
    const allChildren = await prisma.childRecord.findMany({
      where: { employeeId },
      orderBy: { dateOfBirth: 'asc' },
    });
    const { youngest, entitlements, ageYears: age } = computeEmployeeEntitlements(verifiedChildren);
    const year = new Date().getFullYear();
    const existing = await prisma.leaveEntitlement.findMany({
      where: { employeeId, year },
      include: { leaveType: { select: { code: true, name: true } } },
    });

    res.json({
      employeeId,
      year,
      allChildren: allChildren.map(c => ({
        id: c.id, fullName: c.fullName, dateOfBirth: c.dateOfBirth,
        citizenship: c.citizenship, verificationStatus: c.verificationStatus,
      })),
      youngestVerifiedChild: youngest ? {
        id: youngest.id, fullName: youngest.fullName,
        dateOfBirth: youngest.dateOfBirth, citizenship: youngest.citizenship,
        ageBracket: ageBracketLabel(age),
      } : null,
      computedEntitlements: entitlements,
      existingEntitlements: existing.map(e => ({
        code: e.leaveType.code, name: e.leaveType.name,
        entitledDays: e.entitledDays, usedDays: e.usedDays,
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.runAutoProvision = runAutoProvision;
