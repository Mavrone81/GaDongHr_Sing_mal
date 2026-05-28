'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');
const { encryptFields, decrypt } = require('/app/shared/crypto');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:4000';
const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || '';

function decryptFormPayload(iv, data, rawToken) {
  // IKM: hex string as UTF-8 bytes (matches browser's TextEncoder(rawTokenHex))
  const key = crypto.hkdfSync('sha256', Buffer.from(rawToken, 'utf8'), Buffer.from('vorkhive-onboard-v1'), Buffer.from('form-encryption'), 32);
  const ivBuf = Buffer.from(iv, 'base64');
  const dataBuf = Buffer.from(data, 'base64');
  const authTag = dataBuf.slice(dataBuf.length - 16);
  const ciphertext = dataBuf.slice(0, dataBuf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
  decipher.setAuthTag(authTag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}

const prisma = new PrismaClient();

const ENCRYPTED_FIELDS = ['nricEncrypted', 'homeAddressEncrypted', 'basicSalaryEncrypted', 'bankAccountEncrypted'];

// Resolve employeeId from JWT claim, falling back to a DB lookup by email.
// This makes /me endpoints resilient when a JWT was issued before the account
// was linked (e.g. the account existed before the employee record was created).
async function resolveEmployeeId(user) {
  if (user.employeeId) return user.employeeId;
  if (!user.email) return null;
  const emp = await prisma.employee.findFirst({
    where: { workEmail: { equals: user.email, mode: 'insensitive' } },
    select: { id: true },
  });
  return emp?.id ?? null;
}

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
        select: { id: true, employeeCode: true, fullName: true, preferredName: true, department: true, designation: true, workEmail: true, employmentType: true, startDate: true, isActive: true, citizenshipStatus: true, passType: true, profilePhotoUrl: true },
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
      select: { id: true, employeeCode: true, fullName: true, department: true, citizenshipStatus: true, dateOfBirth: true, startDate: true, endDate: true, basicSalaryEncrypted: true, salaryBasis: true, bankName: true, bankCode: true, bankBranchCode: true, bankAccountEncrypted: true },
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
        startDate: emp.startDate ? emp.startDate.toISOString().slice(0, 10) : null,
        endDate: emp.endDate ? emp.endDate.toISOString().slice(0, 10) : null,
        bankName: emp.bankName || '', bankCode: emp.bankCode || '', bankBranchCode: emp.bankBranchCode || '', bankAccount,
      };
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /me/photo — must be before /:id to avoid shadowing ───────────────────
router.get('/me/photo', authenticate, async (req, res, next) => {
  try {
    const employeeId = await resolveEmployeeId(req.user);
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { profilePhotoUrl: true } });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json({ profilePhotoUrl: emp.profilePhotoUrl || null });
  } catch (err) { next(err); }
});

// ── HR: admin creates pre-filled application (HR fill-on-behalf or template) ──
router.post('/applications/prefill', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const {
      userId, email, fullName, preferredName,
      gender, dateOfBirth, nationality, nricFin,
      personalPhone, homeAddress,
      department, designation, employmentType, startDate,
      bankName, bankAccount, notes,
      basicSalary,
    } = req.body;
    if (!userId || !email || !fullName) return res.status(400).json({ error: 'userId, email, fullName required' });

    const existing = await prisma.employeeApplication.findUnique({ where: { userId } });
    if (existing) {
      // Only overwrite a field if HR actually provided a value — don't blank out data the employee filled
      const patch = {};
      if (fullName)        patch.fullName = fullName;
      if (preferredName !== undefined) patch.preferredName = preferredName || null;
      if (gender)          patch.gender = gender;
      if (dateOfBirth)     patch.dateOfBirth = dateOfBirth;
      if (nationality)     patch.nationality = nationality;
      if (nricFin)         patch.nricFin = nricFin;
      if (personalPhone)   patch.personalPhone = personalPhone;
      if (homeAddress)     patch.homeAddress = homeAddress;
      if (department)      patch.department = department;
      if (designation)     patch.designation = designation;
      if (employmentType)  patch.employmentType = employmentType;
      if (startDate)       patch.startDate = startDate;
      if (bankName)        patch.bankName = bankName;
      if (bankAccount)     patch.bankAccount = bankAccount;
      if (notes || basicSalary) patch.notes = notes || (basicSalary ? `Suggested salary: ${basicSalary}` : existing.notes);
      patch.status = 'PENDING';
      const updated = await prisma.employeeApplication.update({ where: { userId }, data: patch });
      return res.json(updated);
    }

    const app = await prisma.employeeApplication.create({
      data: {
        id: require('crypto').randomUUID(),
        userId, email, fullName,
        preferredName: preferredName || null,
        gender: gender || null, dateOfBirth: dateOfBirth || null,
        nationality: nationality || null, nricFin: nricFin || null,
        personalPhone: personalPhone || null, homeAddress: homeAddress || null,
        department: department || null, designation: designation || null,
        employmentType: employmentType || null, startDate: startDate || null,
        bankName: bankName || null, bankAccount: bankAccount || null,
        notes: notes || (basicSalary ? `Suggested salary: ${basicSalary}` : null),
        status: 'PENDING',
      },
    });
    res.status(201).json(app);
  } catch (err) { next(err); }
});

// ── HR: list pending applications ─────────────────────────────────────────────
router.get('/applications', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const { status = 'PENDING' } = req.query;
    const applications = await prisma.employeeApplication.findMany({
      where: { status: status.toUpperCase() },
      orderBy: { createdAt: 'desc' },
    });
    res.json(applications);
  } catch (err) { next(err); }
});

// ── HR: approve application → create employee record ─────────────────────────
router.post('/applications/:id/approve', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const app = await prisma.employeeApplication.findUnique({ where: { id: req.params.id } });
    if (!app) return res.status(404).json({ error: 'Application not found' });
    if (app.status !== 'PENDING') return res.status(400).json({ error: 'Application already processed' });

    const count = await prisma.employee.count();
    const employeeCode = `EMP-${String(count + 1).padStart(4, '0')}`;

    const encFields = encryptFields({
      nricEncrypted: app.nricFin || '',
      homeAddressEncrypted: app.homeAddress || '',
      basicSalaryEncrypted: '',
      bankAccountEncrypted: app.bankAccount || '',
    }, ['nricEncrypted', 'homeAddressEncrypted', 'basicSalaryEncrypted', 'bankAccountEncrypted']);

    const employee = await prisma.employee.create({
      data: {
        id: uuidv4(), employeeCode, fullName: app.fullName, preferredName: app.preferredName,
        nricEncrypted: encFields.nricEncrypted,
        nationality: app.nationality || 'Singaporean',
        dateOfBirth: app.dateOfBirth ? new Date(app.dateOfBirth) : new Date('1990-01-01'),
        gender: app.gender?.toUpperCase() === 'FEMALE' ? 'FEMALE' : app.gender?.toUpperCase() === 'PREFER_NOT_TO_SAY' ? 'PREFER_NOT_TO_SAY' : 'MALE',
        department: app.department || 'General',
        designation: app.designation || 'Employee',
        employmentType: app.employmentType?.toUpperCase() === 'PART_TIME' ? 'PART_TIME' : app.employmentType?.toUpperCase() === 'CONTRACT' ? 'CONTRACT' : 'FULL_TIME',
        startDate: app.startDate ? new Date(app.startDate) : new Date(),
        workEmail: app.email, personalPhone: app.personalPhone,
        homeAddressEncrypted: encFields.homeAddressEncrypted,
        basicSalaryEncrypted: encFields.basicSalaryEncrypted,
        bankName: app.bankName, bankAccountEncrypted: encFields.bankAccountEncrypted,
      },
    });

    try {
      await fetch(`${AUTH_SERVICE_URL}/users/${app.userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-internal-service-key': INTERNAL_KEY },
        body: JSON.stringify({ employeeId: employee.id }),
      });
    } catch (linkErr) { console.error('[approve] user link failed:', linkErr.message); }

    await prisma.employeeApplication.update({
      where: { id: app.id },
      data: { status: 'APPROVED', reviewedBy: req.user?.sub, reviewedAt: new Date() },
    });

    await writeAudit({
      entityId:   employee.id,
      entityCode: employee.employeeCode,
      entityName: employee.fullName,
      action:     'CREATE',
      actor:      req.user,
      changedFields: null,
      req,
    });

    res.json({ message: 'Application approved. Employee record created.', employee });
  } catch (err) { next(err); }
});

// ── HR: reject application ────────────────────────────────────────────────────
router.patch('/applications/:id/reject', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const app = await prisma.employeeApplication.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', reviewedBy: req.user?.sub, reviewedAt: new Date() },
    });
    res.json(app);
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
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        startDate:   data.startDate ? new Date(data.startDate) : new Date(),
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

    // Salary change → also record in salary history (auto-approved direct edit)
    if (data.basicSalary !== undefined) {
      const prevEnc = before.basicSalaryEncrypted || '';
      const { newSalaryEnc: newEnc } = encryptFields({ newSalaryEnc: String(data.basicSalary) }, ['newSalaryEnc']);
      const reasonCode = data.salaryChangeReason && VALID_REASON_CODES.includes(data.salaryChangeReason) ? data.salaryChangeReason : 'CORRECTION';
      await prisma.salaryHistory.create({
        data: {
          id: uuidv4(),
          employeeId:        req.params.id,
          effectiveDate:     new Date(),
          basicSalaryEnc:    prevEnc,
          previousSalaryEnc: prevEnc,
          newSalaryEnc:      newEnc,
          changeReason:      data.salaryChangeReason || null,
          reasonCode,
          changedByUserId:   req.user?.sub,
          approvedBy:        req.user?.sub,
          approvedAt:        new Date(),
          status:            'APPROVED',
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

// ── POST /me/photo — employee uploads their own profile photo ────────────────
router.post('/me/photo', authenticate, async (req, res, next) => {
  try {
    const employeeId = await resolveEmployeeId(req.user);
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
      select: { id: true, employeeCode: true, fullName: true, profilePhotoUrl: true },
    });

    await writeAudit({
      entityId:   emp.id,
      entityCode: emp.employeeCode,
      entityName: emp.fullName,
      action:     'UPDATE_PHOTO',
      actor:      req.user,
      changedFields: { profilePhotoUrl: { from: null, to: '[photo set]' } },
      req,
    });

    res.json({ success: true, profilePhotoUrl: emp.profilePhotoUrl });
  } catch (err) { next(err); }
});

// ── POST /me/verify-face — server-side face recognition via InsightFace ──────
router.post('/me/verify-face', authenticate, async (req, res, next) => {
  try {
    const employeeId = await resolveEmployeeId(req.user);
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });

    const { capturedPhoto } = req.body;
    if (!capturedPhoto || !capturedPhoto.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid captured photo. Must be a base64 data URL.' });
    }

    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { profilePhotoUrl: true },
    });

    if (!emp?.profilePhotoUrl) {
      return res.status(400).json({ error: 'no_profile_photo' });
    }

    const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://face-service:5010';
    const faceRes = await fetch(`${FACE_SERVICE_URL}/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: emp.profilePhotoUrl, target: capturedPhoto }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!faceRes.ok) {
      return res.status(502).json({ error: 'Face service error' });
    }

    const result = await faceRes.json();
    res.json(result);
  } catch (err) { next(err); }
});

// ── Salary revision helpers ───────────────────────────────────────────────────
const VALID_REASON_CODES = ['PROMOTION', 'ANNUAL_INCREMENT', 'MARKET_ADJUSTMENT', 'ROLE_CHANGE', 'CORRECTION', 'OTHER'];

function decryptSalary(enc) {
  try { return enc ? parseFloat(decrypt(enc)) || 0 : 0; } catch { return 0; }
}

// Compute months elapsed from effectiveDate to start of current month (for back-pay)
function monthsElapsed(effectiveDate) {
  const eff = new Date(effectiveDate);
  const now = new Date();
  const months = (now.getFullYear() - eff.getFullYear()) * 12 + (now.getMonth() - eff.getMonth());
  return Math.max(0, months);
}

// ── GET /:id/salary-history ───────────────────────────────────────────────────
router.get('/:id/salary-history', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const history = await prisma.salaryHistory.findMany({
      where: { employeeId: req.params.id },
      orderBy: { effectiveDate: 'desc' },
    });
    const decrypted = history.map(h => {
      const prevSalary = decryptSalary(h.previousSalaryEnc || h.basicSalaryEnc);
      const newSalary  = decryptSalary(h.newSalaryEnc);
      const incrementPct = prevSalary > 0 && newSalary > 0
        ? Math.round(((newSalary - prevSalary) / prevSalary) * 10000) / 100
        : null;
      return {
        ...h,
        basicSalaryEnc: undefined,
        previousSalaryEnc: undefined,
        newSalaryEnc: undefined,
        basicSalary: prevSalary || null,  // legacy
        previousSalary: prevSalary || null,
        newSalary: newSalary || null,
        incrementPct,
      };
    });
    res.json(decrypted);
  } catch (err) { next(err); }
});

// ── POST /:id/salary-revisions — create a pending revision request ─────────────
router.post('/:id/salary-revisions', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const emp = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { id: true, basicSalaryEncrypted: true, fullName: true, employeeCode: true } });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const { newSalary, effectiveDate, reasonCode, recommendedBy, notes } = req.body;
    if (!newSalary || isNaN(parseFloat(newSalary))) return res.status(400).json({ error: 'newSalary (numeric) is required' });
    if (!effectiveDate) return res.status(400).json({ error: 'effectiveDate is required' });
    const code = reasonCode && VALID_REASON_CODES.includes(reasonCode) ? reasonCode : 'OTHER';

    const prevSalEnc = emp.basicSalaryEncrypted || '';
    const { newSalaryEnc: newEnc } = encryptFields({ newSalaryEnc: String(newSalary) }, ['newSalaryEnc']);

    const revision = await prisma.salaryHistory.create({
      data: {
        id: uuidv4(),
        employeeId: req.params.id,
        effectiveDate: new Date(effectiveDate),
        basicSalaryEnc: prevSalEnc,      // legacy field = old salary
        previousSalaryEnc: prevSalEnc,
        newSalaryEnc: newEnc,
        reasonCode: code,
        recommendedBy: recommendedBy || null,
        notes: notes || null,
        changedByUserId: req.user?.sub,
        status: 'PENDING',
      },
    });

    await writeAudit({
      entityId: req.params.id,
      entityCode: emp.employeeCode,
      entityName: emp.fullName,
      action: 'SALARY_REVISION_REQUESTED',
      actor: req.user,
      changedFields: { reasonCode: { to: code }, effectiveDate: { to: effectiveDate } },
      req,
    });

    const prevSalary = decryptSalary(prevSalEnc);
    const newSalaryNum = parseFloat(newSalary);
    const incrementPct = prevSalary > 0 ? Math.round(((newSalaryNum - prevSalary) / prevSalary) * 10000) / 100 : null;

    res.status(201).json({
      ...revision,
      basicSalaryEnc: undefined,
      previousSalaryEnc: undefined,
      newSalaryEnc: undefined,
      previousSalary: prevSalary || null,
      newSalary: newSalaryNum,
      incrementPct,
    });
  } catch (err) { next(err); }
});

// ── PUT /:id/salary-revisions/:revId/approve ──────────────────────────────────
router.put('/:id/salary-revisions/:revId/approve', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const revision = await prisma.salaryHistory.findFirst({ where: { id: req.params.revId, employeeId: req.params.id } });
    if (!revision) return res.status(404).json({ error: 'Revision not found' });
    if (revision.status !== 'PENDING') return res.status(400).json({ error: `Revision is already ${revision.status}` });

    const now = new Date();
    const effDate = new Date(revision.effectiveDate);
    const elapsed = monthsElapsed(effDate);
    const newSalary = decryptSalary(revision.newSalaryEnc);
    const prevSalary = decryptSalary(revision.previousSalaryEnc || revision.basicSalaryEnc);
    const catchUpAmount = elapsed > 0 && newSalary > prevSalary ? Math.round((newSalary - prevSalary) * elapsed * 100) / 100 : 0;

    const updates = {
      status: 'APPROVED',
      approvedBy: req.user?.sub,
      approvedAt: now,
      catchUpAmount: catchUpAmount || null,
    };

    // Apply salary to employee if effective date has arrived
    if (effDate <= now && revision.newSalaryEnc) {
      const emp = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { id: true, fullName: true, employeeCode: true } });
      await prisma.employee.update({
        where: { id: req.params.id },
        data: { basicSalaryEncrypted: revision.newSalaryEnc },
      });
      await writeAudit({
        entityId: req.params.id,
        entityCode: emp?.employeeCode,
        entityName: emp?.fullName,
        action: 'SALARY_REVISION_APPLIED',
        actor: req.user,
        changedFields: { basicSalaryEncrypted: { changed: true, sensitive: true } },
        req,
      });
    }

    const updated = await prisma.salaryHistory.update({
      where: { id: req.params.revId },
      data: updates,
    });

    res.json({
      ...updated,
      basicSalaryEnc: undefined,
      previousSalaryEnc: undefined,
      newSalaryEnc: undefined,
      previousSalary: prevSalary || null,
      newSalary: newSalary || null,
      incrementPct: prevSalary > 0 ? Math.round(((newSalary - prevSalary) / prevSalary) * 10000) / 100 : null,
      catchUpAmount: catchUpAmount || null,
      salaryApplied: effDate <= now,
    });
  } catch (err) { next(err); }
});

// ── PUT /:id/salary-revisions/:revId/reject ───────────────────────────────────
router.put('/:id/salary-revisions/:revId/reject', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const revision = await prisma.salaryHistory.findFirst({ where: { id: req.params.revId, employeeId: req.params.id } });
    if (!revision) return res.status(404).json({ error: 'Revision not found' });
    if (revision.status !== 'PENDING') return res.status(400).json({ error: `Revision is already ${revision.status}` });

    const updated = await prisma.salaryHistory.update({
      where: { id: req.params.revId },
      data: { status: 'REJECTED', approvedBy: req.user?.sub, approvedAt: new Date() },
    });

    const prevSalary = decryptSalary(updated.previousSalaryEnc || updated.basicSalaryEnc);
    const newSalary  = decryptSalary(updated.newSalaryEnc);
    res.json({
      ...updated,
      basicSalaryEnc: undefined,
      previousSalaryEnc: undefined,
      newSalaryEnc: undefined,
      previousSalary: prevSalary || null,
      newSalary: newSalary || null,
    });
  } catch (err) { next(err); }
});

// ── GET /salary-revisions/pending — all pending revisions (HR Admin / HR Manager) ──
// Must be defined BEFORE /:id to avoid route shadowing
router.get('/salary-revisions/pending', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const pending = await prisma.salaryHistory.findMany({
      where: { status: 'PENDING' },
      orderBy: { effectiveDate: 'asc' },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true, department: true, designation: true } } },
    });
    const result = pending.map(h => {
      const prevSalary = decryptSalary(h.previousSalaryEnc || h.basicSalaryEnc);
      const newSalary  = decryptSalary(h.newSalaryEnc);
      return {
        ...h,
        basicSalaryEnc: undefined,
        previousSalaryEnc: undefined,
        newSalaryEnc: undefined,
        previousSalary: prevSalary || null,
        newSalary: newSalary || null,
        incrementPct: prevSalary > 0 && newSalary > 0 ? Math.round(((newSalary - prevSalary) / prevSalary) * 10000) / 100 : null,
        annualCostDelta: newSalary > 0 && prevSalary > 0 ? Math.round((newSalary - prevSalary) * 12 * 100) / 100 : null,
      };
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /salary-revisions/budget-envelope — annual cost summary ───────────────
router.get('/salary-revisions/budget-envelope', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const from = new Date(`${year}-01-01`);
    const to   = new Date(`${year + 1}-01-01`);

    const approved = await prisma.salaryHistory.findMany({
      where: { status: 'APPROVED', effectiveDate: { gte: from, lt: to }, newSalaryEnc: { not: null } },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true, department: true } } },
    });

    let totalAnnualDelta = 0;
    const breakdown = approved.map(h => {
      const prevSalary = decryptSalary(h.previousSalaryEnc || h.basicSalaryEnc);
      const newSalary  = decryptSalary(h.newSalaryEnc);
      const annualDelta = Math.round((newSalary - prevSalary) * 12 * 100) / 100;
      totalAnnualDelta += annualDelta;
      return {
        employeeId: h.employeeId,
        employee: h.employee,
        effectiveDate: h.effectiveDate,
        reasonCode: h.reasonCode,
        previousSalary: prevSalary || null,
        newSalary: newSalary || null,
        incrementPct: prevSalary > 0 ? Math.round(((newSalary - prevSalary) / prevSalary) * 10000) / 100 : null,
        annualCostDelta: annualDelta,
      };
    });

    res.json({
      year,
      totalRevisions: approved.length,
      totalAnnualDelta: Math.round(totalAnnualDelta * 100) / 100,
      breakdown,
    });
  } catch (err) { next(err); }
});

// POST /employees/purge — PDPA data retention purge (internal, SUPER_ADMIN only)
// Deletes terminated employees whose endDate + retentionYears <= today (exact-day precision)
router.post('/purge', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const retentionYears = parseInt(req.body.retentionYears) || 7;

    // cutoff = today - retentionYears (midnight UTC, exact)
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - retentionYears);

    // Find terminated employees whose retention window has closed (endDate <= cutoff)
    const targets = await prisma.$queryRaw`
      SELECT id FROM employees
      WHERE "endDate" IS NOT NULL
        AND "isActive" = false
        AND "endDate" <= ${cutoff}
    `;

    if (targets.length === 0) {
      return res.json({ purged: 0, cutoff: cutoff.toISOString().slice(0, 10) });
    }

    const ids = targets.map(t => t.id);

    // Delete children first, then the employee record (hard DELETE — non-recoverable)
    await prisma.$executeRaw`DELETE FROM emergency_contacts WHERE "employeeId" = ANY(${ids}::uuid[])`;
    await prisma.$executeRaw`DELETE FROM documents WHERE "employeeId" = ANY(${ids}::uuid[])`;
    await prisma.$executeRaw`DELETE FROM salary_history WHERE "employeeId" = ANY(${ids}::uuid[])`;
    const purged = await prisma.$executeRaw`DELETE FROM employees WHERE id = ANY(${ids}::uuid[])`;

    // VACUUM removes dead tuples from heap pages — prevents recovery at storage level
    for (const tbl of ['employees', 'salary_history', 'documents', 'emergency_contacts']) {
      await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${tbl}`).catch(() => {});
    }

    res.json({ purged: Number(purged), cutoff: cutoff.toISOString().slice(0, 10) });
  } catch (err) { next(err); }
});

// ── Employee self-service application (public, invite-token gated) ─────────────
router.post('/apply', async (req, res, next) => {
  try {
    const { inviteToken, encrypted, iv, data: encData } = req.body;
    if (!inviteToken) return res.status(400).json({ error: 'inviteToken is required' });

    // Step 1: Verify token (non-destructive) to get user info.
    const verifyRes = await fetch(`${AUTH_SERVICE_URL}/users/invite/${encodeURIComponent(inviteToken)}`);
    if (!verifyRes.ok) {
      return res.status(400).json({ error: 'Invalid or expired invite link — please contact HR for a new invite.' });
    }
    const { id: userId, email } = await verifyRes.json();

    // Step 2 (H-10 / H-23): obtain the HKDF rawToken from auth-service via
    // a signature-verifying internal endpoint, instead of locally decoding
    // the JWT body (which previously accepted any forged token whose jti
    // matched a stolen rawToken). Failure here → 400, no key derivation.
    let rawToken;
    try {
      const r = await fetch(`${AUTH_SERVICE_URL}/users/invite/derive-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-service-key': INTERNAL_KEY },
        body: JSON.stringify({ token: inviteToken }),
      });
      if (!r.ok) throw new Error('derive-key rejected');
      const body = await r.json();
      rawToken = body.rawToken;
      if (!rawToken) throw new Error('no rawToken returned');
    } catch {
      return res.status(400).json({ error: 'Invite token validation failed — please request a new invite.' });
    }

    // Step 3: Decrypt before consuming the token (so failures don't burn the token)
    let fields;
    if (encrypted && iv && encData) {
      try {
        fields = decryptFormPayload(iv, encData, rawToken);
      } catch {
        return res.status(400).json({ error: 'Failed to decrypt your submission — please try again or request a new invite link.' });
      }
    } else {
      const { fullName, preferredName, gender, dateOfBirth, nationality, nricFin,
        personalPhone, homeAddress, department, designation, employmentType, startDate, bankName, bankAccount, notes } = req.body;
      fields = { fullName, preferredName, gender, dateOfBirth, nationality, nricFin, personalPhone, homeAddress, department, designation, employmentType, startDate, bankName, bankAccount, notes };
    }

    if (!fields.fullName) return res.status(400).json({ error: 'fullName is required' });

    const existing = await prisma.employeeApplication.findUnique({ where: { userId } });

    // Step 4: Consume token (marks invite as used so it can't be replayed)
    // Only consume if the token is still valid — for prefill-created applications the
    // token hasn't been consumed yet, so we still need to consume it here.
    const consumeRes = await fetch(`${AUTH_SERVICE_URL}/users/consume-invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-service-key': INTERNAL_KEY },
      body: JSON.stringify({ token: inviteToken }),
    });
    // Ignore 404/gone — means token was already consumed (re-submission guard on auth side)
    if (!consumeRes.ok) {
      const err = await consumeRes.json().catch(() => ({}));
      // If the token is gone but application already exists, let it through (idempotent)
      if (!existing) return res.status(400).json({ error: err.error || 'Invalid or expired invite link' });
    }

    // Step 5: Save or update application — employee data always wins over HR prefill
    const appData = {
      fullName: fields.fullName, preferredName: fields.preferredName || null,
      gender: fields.gender || null, dateOfBirth: fields.dateOfBirth || null,
      nationality: fields.nationality || null, nricFin: fields.nricFin || null,
      personalPhone: fields.personalPhone || null, homeAddress: fields.homeAddress || null,
      department: fields.department || null, designation: fields.designation || null,
      employmentType: fields.employmentType || null, startDate: fields.startDate || null,
      bankName: fields.bankName || null, bankAccount: fields.bankAccount || null,
      notes: fields.notes || null, status: 'PENDING',
    };

    let application;
    if (existing) {
      // Merge: employee-submitted values override prefill, but keep HR-set fields if employee left them blank
      application = await prisma.employeeApplication.update({
        where: { userId },
        data: {
          fullName: appData.fullName,
          preferredName: appData.preferredName ?? existing.preferredName,
          gender: appData.gender ?? existing.gender,
          dateOfBirth: appData.dateOfBirth ?? existing.dateOfBirth,
          nationality: appData.nationality ?? existing.nationality,
          nricFin: appData.nricFin ?? existing.nricFin,
          personalPhone: appData.personalPhone ?? existing.personalPhone,
          homeAddress: appData.homeAddress ?? existing.homeAddress,
          department: appData.department ?? existing.department,
          designation: appData.designation ?? existing.designation,
          employmentType: appData.employmentType ?? existing.employmentType,
          startDate: appData.startDate ?? existing.startDate,
          bankName: appData.bankName ?? existing.bankName,
          bankAccount: appData.bankAccount ?? existing.bankAccount,
          notes: appData.notes ?? existing.notes,
          status: 'PENDING',
        },
      });
    } else {
      application = await prisma.employeeApplication.create({
        data: { id: uuidv4(), userId, email, ...appData },
      });
    }
    res.status(201).json({ message: 'Application submitted. HR will review and activate your profile soon.', applicationId: application.id });
  } catch (err) { next(err); }
});

// ── GET /employees/:id/supervisors ────────────────────────────────────────────
router.get('/:id/supervisors', authenticate, authorizeSelfOrRole('id', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: req.params.id },
      select: {
        approvalFlowType: true,
        supervisors: {
          orderBy: { order: 'asc' },
          select: {
            id: true, order: true,
            supervisor: { select: { id: true, fullName: true, designation: true, department: true, employeeCode: true } },
          },
        },
      },
    });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    res.json({
      flowType: emp.approvalFlowType,
      supervisors: emp.supervisors.map(s => ({
        id: s.id, order: s.order,
        employeeId: s.supervisor.id,
        fullName: s.supervisor.fullName,
        designation: s.supervisor.designation,
        department: s.supervisor.department,
        employeeCode: s.supervisor.employeeCode,
      })),
    });
  } catch (err) { next(err); }
});

// ── PUT /employees/:id/supervisors ─── HR Admin only, replaces full list ──────
router.put('/:id/supervisors', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { flowType, supervisors } = req.body; // supervisors: [{ employeeId, order }]

    const emp = await prisma.employee.findUnique({ where: { id }, select: { id: true } });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    // Validate supervisor employeeIds exist
    if (Array.isArray(supervisors) && supervisors.length > 0) {
      const ids = supervisors.map(s => s.employeeId);
      const found = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (found.length !== ids.length) return res.status(400).json({ error: 'One or more supervisor employee IDs not found' });
      if (ids.includes(id)) return res.status(400).json({ error: 'Employee cannot be their own supervisor' });
    }

    // Replace all supervisors atomically
    await prisma.$transaction([
      prisma.employeeSupervisor.deleteMany({ where: { employeeId: id } }),
      ...(Array.isArray(supervisors) ? supervisors.map((s, idx) =>
        prisma.employeeSupervisor.create({
          data: { id: uuidv4(), employeeId: id, supervisorEmployeeId: s.employeeId, order: s.order ?? idx + 1 },
        })
      ) : []),
      ...(flowType ? [prisma.employee.update({ where: { id }, data: { approvalFlowType: flowType } })] : []),
    ]);

    // Return updated list
    const updated = await prisma.employee.findUnique({
      where: { id },
      select: {
        approvalFlowType: true,
        supervisors: {
          orderBy: { order: 'asc' },
          select: {
            id: true, order: true,
            supervisor: { select: { id: true, fullName: true, designation: true, department: true, employeeCode: true } },
          },
        },
      },
    });
    res.json({
      flowType: updated.approvalFlowType,
      supervisors: updated.supervisors.map(s => ({
        id: s.id, order: s.order,
        employeeId: s.supervisor.id,
        fullName: s.supervisor.fullName,
        designation: s.supervisor.designation,
        department: s.supervisor.department,
        employeeCode: s.supervisor.employeeCode,
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /employees/me/subordinates — employees where I am a supervisor ─────────
router.get('/me/subordinates', authenticate, async (req, res, next) => {
  try {
    const empId = await resolveEmployeeId(req.user);
    if (!empId) return res.status(400).json({ error: 'No employee profile linked to this account' });

    const supervised = await prisma.employeeSupervisor.findMany({
      where: { supervisorEmployeeId: empId },
      include: {
        employee: {
          select: { id: true, fullName: true, designation: true, department: true, employeeCode: true, isActive: true },
        },
      },
    });

    res.json(supervised.map(s => s.employee));
  } catch (err) { next(err); }
});

// ── GET /employees/:id/supervisor-check — check if user is supervisor (for leave-service) ──
// Accepts either internal service key OR a valid JWT.
const checkInternalOrAuth = (req, res, next) => {
  const internalKey = req.headers['x-internal-service-key'];
  if (internalKey && internalKey === INTERNAL_KEY) { req.isInternal = true; return next(); }
  return authenticate(req, res, next);
};

// ── GET /employees/:id/internal/monthly-salary ─ for loans-service ────────────
// Returns the decrypted basicSalary for a single employee. Gated strictly on
// the internal service key — never accept a JWT here, since the caller is
// always a backend service (loans-service computes affordability against
// the canonical, server-side salary instead of trusting body input).
function checkInternalOnly(req, res, next) {
  const key = req.headers['x-internal-service-key'];
  if (!key || !INTERNAL_KEY || key !== INTERNAL_KEY) {
    return res.status(403).json({ error: 'Internal service key required' });
  }
  next();
}
router.get('/:id/internal/monthly-salary', checkInternalOnly, async (req, res, next) => {
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: req.params.id },
      select: { id: true, isActive: true, basicSalaryEncrypted: true, salaryBasis: true },
    });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });
    let monthlySalary = 0;
    try {
      if (emp.basicSalaryEncrypted) monthlySalary = parseFloat(decrypt(emp.basicSalaryEncrypted)) || 0;
    } catch { monthlySalary = 0; }
    res.json({ employeeId: emp.id, monthlySalary, salaryBasis: emp.salaryBasis || 'MONTHLY', isActive: emp.isActive });
  } catch (err) { next(err); }
});

router.get('/:id/supervisor-check', checkInternalOrAuth, async (req, res, next) => {
  try {
    const { checkerEmployeeId } = req.query;
    if (!checkerEmployeeId) return res.status(400).json({ error: 'checkerEmployeeId query param required' });

    const emp = await prisma.employee.findUnique({
      where: { id: req.params.id },
      select: {
        approvalFlowType: true,
        supervisors: { orderBy: { order: 'asc' }, select: { supervisorEmployeeId: true, order: true } },
      },
    });
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const isSupervisor = emp.supervisors.some(s => s.supervisorEmployeeId === checkerEmployeeId);
    const supervisorEntry = emp.supervisors.find(s => s.supervisorEmployeeId === checkerEmployeeId);

    res.json({
      isSupervisor,
      flowType: emp.approvalFlowType,
      supervisorOrder: supervisorEntry?.order ?? null,
      totalSupervisors: emp.supervisors.length,
      supervisors: emp.supervisors.map(s => ({ employeeId: s.supervisorEmployeeId, order: s.order })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
