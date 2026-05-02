'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');
const { encryptFields, decrypt } = require('/app/shared/crypto');

const prisma = new PrismaClient();

const ENCRYPTED_FIELDS = ['nricEncrypted', 'homeAddressEncrypted', 'basicSalaryEncrypted', 'bankAccountEncrypted'];

// Fields that are sensitive — we log they changed but never store values in audit trail
const SENSITIVE_AUDIT_FIELDS = new Set(['nricEncrypted', 'homeAddressEncrypted', 'basicSalaryEncrypted', 'bankAccountEncrypted', 'bankCode', 'passNumber']);

// ── Enum normalisation ────────────────────────────────────────────────────────
// Frontend may send human-readable labels ("Male", "Single") or already-correct
// enum values ("MALE", "SINGLE"). Normalise both to what Prisma expects.
const GENDER_MAP = {
  male: 'MALE', female: 'FEMALE',
  'non-binary': 'PREFER_NOT_TO_SAY', 'nonbinary': 'PREFER_NOT_TO_SAY',
  'prefer not to say': 'PREFER_NOT_TO_SAY', 'prefer_not_to_say': 'PREFER_NOT_TO_SAY',
  other: 'PREFER_NOT_TO_SAY',
};
const MARITAL_MAP = {
  single: 'SINGLE', married: 'MARRIED', divorced: 'DIVORCED',
  widowed: 'WIDOWED', separated: 'DIVORCED',
};
const EMPLOYMENT_MAP = {
  full_time: 'FULL_TIME', part_time: 'PART_TIME',
  contract: 'CONTRACT', intern: 'INTERN',
  temp: 'TEMP', temporary: 'TEMP',
};

function normaliseEnums(data) {
  if (data.gender) {
    const k = String(data.gender).toLowerCase().trim();
    data.gender = GENDER_MAP[k] || String(data.gender).toUpperCase().replace(/\s+/g, '_');
  }
  if (data.maritalStatus) {
    const k = String(data.maritalStatus).toLowerCase().trim();
    data.maritalStatus = MARITAL_MAP[k] || String(data.maritalStatus).toUpperCase().replace(/\s+/g, '_');
  }
  if (data.employmentType) {
    const k = String(data.employmentType).toLowerCase().trim();
    data.employmentType = EMPLOYMENT_MAP[k] || String(data.employmentType).toUpperCase().replace(/\s+/g, '_');
  }
  return data;
}

function sanitizeEmployee(emp, user) {
  if (!emp) return emp;
  const permissions = user?.permissions || [];
  const role = (user?.role || '').toLowerCase();
  const canViewSensitive =
    permissions.includes('employee:sensitive') ||
    ['super_admin', 'hr_admin', 'hr_manager', 'payroll_officer'].includes(role);

  const out = { ...emp };
  ENCRYPTED_FIELDS.forEach(f => {
    if (out[f]) {
      if (canViewSensitive) {
        try { out[f] = decrypt(out[f]); } catch { out[f] = '[ERROR]'; }
      } else {
        out[f] = '****';
      }
    }
  });
  return out;
}

// ── Audit helper ──────────────────────────────────────────────────────────────
async function writeAudit({ entityId, entityCode, entityName, action, actor, changedFields, req }) {
  try {
    await prisma.auditLog.create({
      data: {
        id: uuidv4(),
        entityType: 'Employee',
        entityId,
        entityCode: entityCode || null,
        entityName: entityName || null,
        action,
        actorId:    actor?.sub  || actor?.id  || null,
        actorEmail: actor?.email               || null,
        actorRole:  actor?.role               || null,
        changedFields: changedFields           || null,
        ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
      },
    });
  } catch (err) {
    // Audit failures must never crash the main request
    console.error('[AUDIT] write failed:', err.message);
  }
}

// Diff two employee objects, returning only changed fields.
// Sensitive fields are flagged but values are never stored.
function diffEmployee(before, after) {
  const SKIP = new Set(['updatedAt', 'createdAt', 'id']);
  const changes = {};
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of allKeys) {
    if (SKIP.has(key)) continue;
    const oldVal = before?.[key];
    const newVal = after?.[key];
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;
    if (SENSITIVE_AUDIT_FIELDS.has(key)) {
      changes[key] = { changed: true, sensitive: true };
    } else {
      changes[key] = { from: oldVal ?? null, to: newVal ?? null };
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

async function nextEmployeeCode() {
  const last = await prisma.employee.findFirst({ orderBy: { createdAt: 'desc' }, select: { employeeCode: true } });
  if (!last) return 'EMP-0001';
  const num = parseInt(last.employeeCode.replace('EMP-', '')) + 1;
  return `EMP-${String(num).padStart(4, '0')}`;
}

const checkInternal = (req, res, next) => {
  const key = req.headers['x-internal-service-key'];
  if (key && process.env.INTERNAL_SERVICE_KEY && key === process.env.INTERNAL_SERVICE_KEY) {
    req.isInternal = true;
  }
  next();
};

// ── GET /audit-logs ───────────────────────────────────────────────────────────
router.get('/audit-logs', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const {
      page = 1, limit = 50,
      employeeId, action, actorEmail,
      from, to, search,
    } = req.query;

    const where = { entityType: 'Employee' };
    if (employeeId) where.entityId = employeeId;
    if (action)     where.action   = action;
    if (actorEmail) where.actorEmail = { contains: actorEmail, mode: 'insensitive' };
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }
    if (search) {
      where.OR = [
        { entityName:  { contains: search, mode: 'insensitive' } },
        { entityCode:  { contains: search, mode: 'insensitive' } },
        { actorEmail:  { contains: search, mode: 'insensitive' } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:  (Number(page) - 1) * Number(limit),
        take:  Number(limit),
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
});

// ── GET /employees ────────────────────────────────────────────────────────────
router.get('/', checkInternal, (req, res, next) => {
  if (req.isInternal) return next();
  authenticate(req, res, () => {
    authorize('employee:view', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.LINE_MANAGER)(req, res, next);
  });
}, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, department, isActive, search, startDateFrom, startDateTo } = req.query;
    const where = {};
    if (department) where.department = department;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (startDateFrom || startDateTo) {
      where.startDate = {};
      if (startDateFrom) where.startDate.gte = new Date(startDateFrom);
      if (startDateTo)   where.startDate.lte = new Date(startDateTo);
    }
    if (search) where.OR = [
      { fullName:     { contains: search, mode: 'insensitive' } },
      { workEmail:    { contains: search, mode: 'insensitive' } },
      { employeeCode: { contains: search, mode: 'insensitive' } },
    ];
    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        orderBy: { employeeCode: 'asc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        select: { id: true, employeeCode: true, fullName: true, preferredName: true, department: true, designation: true, workEmail: true, employmentType: true, startDate: true, isActive: true, citizenshipStatus: true, passType: true },
      }),
      prisma.employee.count({ where }),
    ]);
    res.json({ employees, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
});

// ── GET /org-chart ────────────────────────────────────────────────────────────
router.get('/org-chart', authenticate, async (req, res, next) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, designation: true, department: true, reportingManagerId: true },
    });
    res.json(employees);
  } catch (err) { next(err); }
});

// ── GET /code/:code ───────────────────────────────────────────────────────────
router.get('/code/:code', authenticate, authorize('employee:view', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const emp = await prisma.employee.findUnique({
      where: { employeeCode: req.params.code },
      include: { emergencyContacts: true, documents: { select: { id: true, docType: true, fileName: true, createdAt: true, expiryDate: true } } },
    });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json(sanitizeEmployee(emp, req.user));
  } catch (err) { next(err); }
});

// ── GET /payroll-data ─ Returns salary + CPF + bank fields for all active employees ──
router.get('/payroll-data', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true, employeeCode: true, fullName: true, department: true, citizenshipStatus: true, dateOfBirth: true, basicSalaryEncrypted: true, salaryBasis: true, bankName: true, bankCode: true, bankBranchCode: true, bankAccountEncrypted: true },
      orderBy: { employeeCode: 'asc' },
    });
    const result = employees.map(emp => {
      let basicSalary = 0;
      try { if (emp.basicSalaryEncrypted) basicSalary = parseFloat(decrypt(emp.basicSalaryEncrypted)) || 0; } catch {}
      let bankAccount = '';
      try { if (emp.bankAccountEncrypted) bankAccount = decrypt(emp.bankAccountEncrypted) || ''; } catch {}
      const age = emp.dateOfBirth ? Math.floor((Date.now() - new Date(emp.dateOfBirth).getTime()) / (1000 * 60 * 60 * 24 * 365.25)) : 35;
      return {
        employeeId: emp.id, employeeCode: emp.employeeCode, fullName: emp.fullName, department: emp.department,
        citizenStatus: emp.citizenshipStatus || 'SC', age, ow: basicSalary, grossPay: basicSalary,
        bankName: emp.bankName || '', bankCode: emp.bankCode || '', bankBranchCode: emp.bankBranchCode || '', bankAccount,
      };
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get('/:id', authenticate, authorizeSelfOrRole('id', 'employee:view', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: { emergencyContacts: true, documents: { select: { id: true, docType: true, fileName: true, createdAt: true, expiryDate: true } } },
    });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json(sanitizeEmployee(emp, req.user));
  } catch (err) { next(err); }
});

// ── POST / ────────────────────────────────────────────────────────────────────
router.post('/', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const data = normaliseEnums({ ...req.body });
    const fieldsToEncrypt = {};
    if (data.nric)        { fieldsToEncrypt.nricEncrypted        = data.nric;        delete data.nric; }
    if (data.homeAddress) { fieldsToEncrypt.homeAddressEncrypted = data.homeAddress; delete data.homeAddress; }
    if (data.basicSalary) { fieldsToEncrypt.basicSalaryEncrypted = data.basicSalary; delete data.basicSalary; }
    if (data.bankAccount) { fieldsToEncrypt.bankAccountEncrypted = data.bankAccount; delete data.bankAccount; }

    const encrypted = encryptFields(fieldsToEncrypt, Object.keys(fieldsToEncrypt));
    const employeeCode = await nextEmployeeCode();

    const emp = await prisma.employee.create({
      data: {
        id: uuidv4(),
        employeeCode,
        ...data,
        ...encrypted,
        dateOfBirth: new Date(data.dateOfBirth),
        startDate:   new Date(data.startDate),
      },
    });

    await writeAudit({
      entityId:   emp.id,
      entityCode: emp.employeeCode,
      entityName: emp.fullName,
      action:     'CREATE',
      actor:      req.user,
      changedFields: null,
      req,
    });

    // Auto-provision user account
    const { createAuthUser } = require('../utils/auth-client');
    createAuthUser(emp);

    res.status(201).json(sanitizeEmployee(emp, req.user));
  } catch (err) { next(err); }
});

// ── POST /employees/bulk-import ───────────────────────────────────────────────
router.post('/bulk-import', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body) ? req.body : req.body?.employees;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'Request body must be a non-empty array of employee records' });
    if (rows.length > 500) return res.status(400).json({ error: 'Maximum 500 records per import' });

    const created = [], failed = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const data = normaliseEnums({ ...rows[i] });
        if (!data.fullName || !data.email || !data.dateOfBirth || !data.startDate) {
          failed.push({ row: i + 1, name: data.fullName || '?', error: 'Missing required field: fullName, email, dateOfBirth, or startDate' });
          continue;
        }
        const fieldsToEncrypt = {};
        if (data.nric)        { fieldsToEncrypt.nricEncrypted        = data.nric;        delete data.nric; }
        if (data.homeAddress) { fieldsToEncrypt.homeAddressEncrypted = data.homeAddress; delete data.homeAddress; }
        if (data.basicSalary) { fieldsToEncrypt.basicSalaryEncrypted = String(data.basicSalary); delete data.basicSalary; }
        if (data.bankAccount) { fieldsToEncrypt.bankAccountEncrypted = data.bankAccount; delete data.bankAccount; }
        const encrypted = encryptFields(fieldsToEncrypt, Object.keys(fieldsToEncrypt));
        const employeeCode = await nextEmployeeCode();
        const emp = await prisma.employee.create({
          data: { id: uuidv4(), employeeCode, ...data, ...encrypted, dateOfBirth: new Date(data.dateOfBirth), startDate: new Date(data.startDate) },
        });
        await writeAudit({ entityId: emp.id, entityCode: emp.employeeCode, entityName: emp.fullName, action: 'BULK_IMPORT', actor: req.user, changedFields: null, req });
        const { createAuthUser } = require('../utils/auth-client');
        createAuthUser(emp);
        created.push({ row: i + 1, employeeCode: emp.employeeCode, name: emp.fullName });
      } catch (rowErr) {
        const msg = rowErr.code === 'P2002' ? `Duplicate value on unique field` : rowErr.message;
        failed.push({ row: i + 1, name: rows[i]?.fullName || '?', error: msg });
      }
    }

    const status = failed.length === 0 ? 201 : created.length === 0 ? 400 : 207;
    res.status(status).json({ total: rows.length, created: created.length, failed: failed.length, results: { created, failed } });
  } catch (err) { next(err); }
});

// ── Shared update handler (PUT + PATCH both use this) ─────────────────────────
async function handleUpdate(req, res, next) {
  try {
    const data = normaliseEnums({ ...req.body });

    // Fetch current record for diff
    const before = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!before) return res.status(404).json({ error: 'Employee not found' });

    const fieldsToEncrypt = {};
    if (data.nric)        { fieldsToEncrypt.nricEncrypted        = data.nric;        delete data.nric; }
    if (data.homeAddress) { fieldsToEncrypt.homeAddressEncrypted = data.homeAddress; delete data.homeAddress; }

    // Salary change → also record in salary history
    if (data.basicSalary !== undefined) {
      await prisma.salaryHistory.create({
        data: {
          id: uuidv4(),
          employeeId:      req.params.id,
          effectiveDate:   new Date(),
          basicSalaryEnc:  before.basicSalaryEncrypted || '',
          changeReason:    data.salaryChangeReason,
          changedByUserId: req.user?.sub,
        },
      });
      fieldsToEncrypt.basicSalaryEncrypted = data.basicSalary;
      delete data.basicSalary;
      delete data.salaryChangeReason;
    }
    if (data.bankAccount) { fieldsToEncrypt.bankAccountEncrypted = data.bankAccount; delete data.bankAccount; }

    // Strip encrypted field pass-throughs from body (avoid overwriting with raw ciphertext)
    ['nricEncrypted', 'homeAddressEncrypted', 'basicSalaryEncrypted', 'bankAccountEncrypted'].forEach(f => {
      if (data[f] && !fieldsToEncrypt[f]) {
        // User sent encrypted field directly (e.g. unmasked value) — re-encrypt it
        fieldsToEncrypt[f] = data[f];
        delete data[f];
      }
    });

    const encrypted = encryptFields(fieldsToEncrypt, Object.keys(fieldsToEncrypt));

    // Strip fields Prisma cannot accept on a plain update
    const STRIP = ['id', 'employeeCode', 'createdAt', 'updatedAt',
                   'emergencyContacts', 'documents', 'salaryHistory'];
    STRIP.forEach(f => delete data[f]);

    // Coerce date strings
    if (data.dateOfBirth)     data.dateOfBirth     = new Date(data.dateOfBirth);
    if (data.startDate)       data.startDate       = new Date(data.startDate);
    if (data.endDate)         data.endDate         = new Date(data.endDate);
    if (data.probationEndDate)data.probationEndDate= new Date(data.probationEndDate);
    if (data.confirmationDate)data.confirmationDate= new Date(data.confirmationDate);
    if (data.passExpiryDate)  data.passExpiryDate  = new Date(data.passExpiryDate);

    const after = await prisma.employee.update({
      where: { id: req.params.id },
      data: { ...data, ...encrypted },
    });

    // Build diff for audit (compare plain text where possible)
    const changedFields = diffEmployee(before, after);

    await writeAudit({
      entityId:     after.id,
      entityCode:   after.employeeCode,
      entityName:   after.fullName,
      action:       'UPDATE',
      actor:        req.user,
      changedFields,
      req,
    });

    res.json(sanitizeEmployee(after, req.user));
  } catch (err) { next(err); }
}

// ── PUT /:id ──────────────────────────────────────────────────────────────────
router.put('/:id', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), handleUpdate);

// ── PATCH /:id ────────────────────────────────────────────────────────────────
router.patch('/:id', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), handleUpdate);

// ── DELETE /:id (soft delete) ─────────────────────────────────────────────────
router.delete('/:id', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const before = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { fullName: true, employeeCode: true } });
    await prisma.employee.update({ where: { id: req.params.id }, data: { isActive: false, endDate: new Date() } });

    await writeAudit({
      entityId:   req.params.id,
      entityCode: before?.employeeCode,
      entityName: before?.fullName,
      action:     'DELETE',
      actor:      req.user,
      changedFields: { isActive: { from: true, to: false } },
      req,
    });

    res.json({ message: 'Employee deactivated' });
  } catch (err) { next(err); }
});

// ── GET /me/photo — employee fetches their own profile photo ─────────────────
router.get('/me/photo', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user.employeeId;
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { profilePhotoUrl: true } });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json({ profilePhotoUrl: emp.profilePhotoUrl || null });
  } catch (err) { next(err); }
});

// ── POST /me/photo — employee uploads their own profile photo ────────────────
router.post('/me/photo', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user.employeeId;
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    const { profilePhotoUrl } = req.body;
    if (!profilePhotoUrl || !profilePhotoUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid image data. Must be a base64 data URL.' });
    }
    if (profilePhotoUrl.length > 2_800_000) {
      return res.status(400).json({ error: 'Image too large. Maximum 2MB.' });
    }
    const emp = await prisma.employee.update({
      where: { id: employeeId },
      data: { profilePhotoUrl },
      select: { id: true, profilePhotoUrl: true },
    });
    res.json({ success: true, profilePhotoUrl: emp.profilePhotoUrl });
  } catch (err) { next(err); }
});

// ── GET /:id/salary-history ───────────────────────────────────────────────────
router.get('/:id/salary-history', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const history = await prisma.salaryHistory.findMany({
      where: { employeeId: req.params.id },
      orderBy: { effectiveDate: 'desc' },
    });
    const decrypted = history.map(h => ({
      ...h,
      basicSalary: (() => { try { return decrypt(h.basicSalaryEnc); } catch { return null; } })(),
    }));
    res.json(decrypted);
  } catch (err) { next(err); }
});

module.exports = router;
