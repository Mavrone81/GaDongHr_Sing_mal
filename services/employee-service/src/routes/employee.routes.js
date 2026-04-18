'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');
const { encryptFields, decryptFields } = require('/app/shared/crypto');

const prisma = new PrismaClient();

const ENCRYPTED_FIELDS = ['nricEncrypted', 'homeAddressEncrypted', 'basicSalaryEncrypted', 'bankAccountEncrypted'];
const SENSITIVE_OUT = ['nricEncrypted', 'homeAddressEncrypted', 'basicSalaryEncrypted', 'bankAccountEncrypted'];

function sanitizeEmployee(emp, user) {
  if (!emp) return emp;
  const permissions = user.permissions || [];
  const role = user.role || '';
  
  // Backward compatibility for system roles during migration
  const canViewSensitive = 
    permissions.includes('employee:sensitive') || 
    ['super_admin', 'hr_admin', 'hr_manager', 'payroll_officer'].includes(role.toLowerCase());

  const out = { ...emp };
  if (canViewSensitive) {
    // Decrypt sensitive fields for privileged users
    SENSITIVE_OUT.forEach(f => {
      if (out[f]) {
        try { out[f] = require('/app/shared/crypto').decrypt(out[f]); } catch { out[f] = '[ERROR]'; }
      }
    });
  } else {
    // Mask sensitive fields for non-privileged users
    SENSITIVE_OUT.forEach(f => { if (out[f]) out[f] = '****'; });
  }
  return out;
}

// Generate next employee code
async function nextEmployeeCode() {
  const last = await prisma.employee.findFirst({ orderBy: { createdAt: 'desc' }, select: { employeeCode: true } });
  if (!last) return 'EMP-0001';
  const num = parseInt(last.employeeCode.replace('EMP-', '')) + 1;
  return `EMP-${String(num).padStart(4, '0')}`;
}

// Internal check middleware
const checkInternal = (req, res, next) => {
  const incoming = req.headers['x-internal-service-key'];
  const internalKey = process.env.INTERNAL_SERVICE_KEY;
  if (incoming && internalKey && incoming === internalKey) {
    req.isInternal = true;
    return next();
  }
  next();
};

// GET /employees - Fetch many
router.get('/', checkInternal, (req, res, next) => {
  if (req.isInternal) return next();
  authenticate(req, res, () => {
    authorize('employee:view', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.LINE_MANAGER)(req, res, next);
  });
}, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, department, isActive, search } = req.query;
    const where = {};
    if (department) where.department = department;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) where.OR = [{ fullName: { contains: search, mode: 'insensitive' } }, { workEmail: { contains: search, mode: 'insensitive' } }, { employeeCode: { contains: search, mode: 'insensitive' } }];

    const [employees, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        orderBy: { employeeCode: 'asc' },
        skip: (page - 1) * limit,
        take: Number(limit),
        select: { id: true, employeeCode: true, fullName: true, preferredName: true, department: true, designation: true, workEmail: true, employmentType: true, startDate: true, isActive: true, citizenshipStatus: true, passType: true },
      }),
      prisma.employee.count({ where }),
    ]);
    res.json({ employees, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// GET /employees/org-chart
router.get('/org-chart', authenticate, async (req, res, next) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, designation: true, department: true, reportingManagerId: true },
    });
    res.json(employees);
  } catch (err) { next(err); }
});

// GET /employees/code/:code
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

// GET /employees/:id
router.get('/:id', authenticate, authorizeSelfOrRole('id', 'employee:view', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: { emergencyContacts: true, documents: { select: { id: true, docType: true, fileName: true, createdAt: true, expiryDate: true } } },
    });
    res.json(sanitizeEmployee(emp, req.user));
  } catch (err) { next(err); }
});

// POST /employees
router.post('/', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const data = req.body;
    const fieldsToEncrypt = {};
    if (data.nric) { fieldsToEncrypt.nricEncrypted = data.nric; delete data.nric; }
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
        startDate: new Date(data.startDate),
      },
    });

    // Automatically create user account in auth-service
    const { createAuthUser } = require('../utils/auth-client');
    createAuthUser(emp);

    res.status(201).json(sanitizeEmployee(emp, req.user));
  } catch (err) { next(err); }
});

// PUT /employees/:id
router.put('/:id', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const data = req.body;
    const fieldsToEncrypt = {};
    if (data.nric) { fieldsToEncrypt.nricEncrypted = data.nric; delete data.nric; }
    if (data.homeAddress) { fieldsToEncrypt.homeAddressEncrypted = data.homeAddress; delete data.homeAddress; }
    if (data.basicSalary !== undefined) {
      // Log salary change to history
      const old = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { basicSalaryEncrypted: true } });
      await prisma.salaryHistory.create({
        data: { id: uuidv4(), employeeId: req.params.id, effectiveDate: new Date(), basicSalaryEnc: old?.basicSalaryEncrypted || '', changeReason: data.salaryChangeReason, changedByUserId: req.user.sub },
      });
      fieldsToEncrypt.basicSalaryEncrypted = data.basicSalary;
      delete data.basicSalary;
      delete data.salaryChangeReason;
    }
    if (data.bankAccount) { fieldsToEncrypt.bankAccountEncrypted = data.bankAccount; delete data.bankAccount; }
    const encrypted = encryptFields(fieldsToEncrypt, Object.keys(fieldsToEncrypt));
    const emp = await prisma.employee.update({ where: { id: req.params.id }, data: { ...data, ...encrypted } });
    res.json(sanitizeEmployee(emp, req.user));
  } catch (err) { next(err); }
});

// DELETE /employees/:id (soft delete)
router.delete('/:id', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    await prisma.employee.update({ where: { id: req.params.id }, data: { isActive: false, endDate: new Date() } });
    res.json({ message: 'Employee deactivated' });
  } catch (err) { next(err); }
});

// GET /employees/:id/salary-history
router.get('/:id/salary-history', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const history = await prisma.salaryHistory.findMany({
      where: { employeeId: req.params.id },
      orderBy: { effectiveDate: 'desc' },
    });
    const decrypted = history.map(h => ({
      ...h,
      basicSalary: (() => { try { return require('/app/shared/crypto').decrypt(h.basicSalaryEnc); } catch { return null; } })(),
    }));
    res.json(decrypted);
  } catch (err) { next(err); }
});

module.exports = router;
