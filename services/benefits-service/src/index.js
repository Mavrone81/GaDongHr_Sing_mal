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
  PLAN_TYPES,
  computeBikValue,
  computeEnrollmentEligibility,
  buildEnrollmentSummary,
  isInOpenEnrollmentPeriod,
  computeAnnualPremium,
  buildClaimsSummary,
  computeReconciliation,
} = require('./engines/benefits.engine');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4009';
const EMPLOYEE_SERVICE_URL     = process.env.EMPLOYEE_SERVICE_URL     || 'http://employee-service:4002';

const prisma = require('./utils/prisma');
const app    = express();
const PORT   = process.env.PORT || 4016;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined'));

const { tenantContextMiddleware } = require('/app/shared/tenant-context');
app.use(tenantContextMiddleware);

app.get('/health', (req, res) => res.json({ service: 'benefits-service', status: 'ok', ts: new Date() }));

const HR_ROLES      = [ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.SUPER_ADMIN];
const FINANCE_ROLES = [ROLES.FINANCE_ADMIN, ROLES.SUPER_ADMIN];
const RELATIONSHIPS = ['SPOUSE', 'CHILD', 'PARENT', 'OTHER'];

function isHr(role) { return HR_ROLES.includes(role); }

// ── Plan Master ───────────────────────────────────────────────────────────────

// POST /benefits/plans — HR creates plan
app.post('/benefits/plans', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const {
      code, name, type, insurerName, insurerContact, policyNumber,
      coverageAmount, premiumEmployer, premiumEmployee, premiumDependent,
      bikTaxable, eligibilityGrades, minTenureMonths, coversDependents,
      effectiveFrom, effectiveTo, description,
    } = req.body;

    if (!code || !code.trim())           return res.status(400).json({ error: 'code is required' });
    if (!name || !name.trim())           return res.status(400).json({ error: 'name is required' });
    if (!type || !PLAN_TYPES.includes(type))
      return res.status(400).json({ error: `type must be one of: ${PLAN_TYPES.join(', ')}` });
    if (!insurerName || !insurerName.trim()) return res.status(400).json({ error: 'insurerName is required' });
    if (coverageAmount === undefined || isNaN(parseFloat(coverageAmount)))
      return res.status(400).json({ error: 'coverageAmount must be a number' });
    if (premiumEmployer === undefined || isNaN(parseFloat(premiumEmployer)))
      return res.status(400).json({ error: 'premiumEmployer must be a number' });
    if (!effectiveFrom) return res.status(400).json({ error: 'effectiveFrom is required' });

    const plan = await prisma.insurancePlan.create({
      data: {
        id:                uuidv4(),
        code:              code.trim().toUpperCase(),
        name:              name.trim(),
        type,
        insurerName:       insurerName.trim(),
        insurerContact:    insurerContact?.trim() || null,
        policyNumber:      policyNumber?.trim()   || null,
        coverageAmount:    parseFloat(coverageAmount),
        premiumEmployer:   parseFloat(premiumEmployer),
        premiumEmployee:   premiumEmployee  !== undefined ? parseFloat(premiumEmployee)  : 0,
        premiumDependent:  premiumDependent !== undefined ? parseFloat(premiumDependent) : 0,
        bikTaxable:        Boolean(bikTaxable),
        eligibilityGrades: Array.isArray(eligibilityGrades) ? eligibilityGrades : [],
        minTenureMonths:   minTenureMonths ? parseInt(minTenureMonths) : 0,
        coversDependents:  Boolean(coversDependents),
        effectiveFrom:     new Date(effectiveFrom),
        effectiveTo:       effectiveTo ? new Date(effectiveTo) : null,
        description:       description?.trim() || null,
        createdBy:         req.user.sub,
      },
    });
    res.status(201).json(plan);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A plan with this code already exists' });
    next(err);
  }
});

// GET /benefits/plans — list plans (employees see active only)
app.get('/benefits/plans', authenticate, async (req, res, next) => {
  try {
    const { type, includeInactive } = req.query;
    const where = {};
    if (type) where.type = type;
    if (!isHr(req.user.role) || !includeInactive) where.isActive = true;
    const plans = await prisma.insurancePlan.findMany({
      where,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
    res.json({ plans, total: plans.length });
  } catch (err) { next(err); }
});

// GET /benefits/plans/:id
app.get('/benefits/plans/:id', authenticate, async (req, res, next) => {
  try {
    const plan = await prisma.insurancePlan.findUnique({ where: { id: req.params.id } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json(plan);
  } catch (err) { next(err); }
});

// PUT /benefits/plans/:id — HR updates
app.put('/benefits/plans/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const data = {};
    const f = req.body;
    if (f.name !== undefined)              data.name = f.name.trim();
    if (f.insurerName !== undefined)       data.insurerName = f.insurerName.trim();
    if (f.insurerContact !== undefined)    data.insurerContact = f.insurerContact?.trim() || null;
    if (f.policyNumber !== undefined)      data.policyNumber  = f.policyNumber?.trim()  || null;
    if (f.coverageAmount !== undefined)    data.coverageAmount = parseFloat(f.coverageAmount);
    if (f.premiumEmployer !== undefined)   data.premiumEmployer = parseFloat(f.premiumEmployer);
    if (f.premiumEmployee !== undefined)   data.premiumEmployee = parseFloat(f.premiumEmployee);
    if (f.premiumDependent !== undefined)  data.premiumDependent = parseFloat(f.premiumDependent);
    if (f.bikTaxable !== undefined)        data.bikTaxable = Boolean(f.bikTaxable);
    if (f.eligibilityGrades !== undefined) data.eligibilityGrades = Array.isArray(f.eligibilityGrades) ? f.eligibilityGrades : [];
    if (f.minTenureMonths !== undefined)   data.minTenureMonths = parseInt(f.minTenureMonths);
    if (f.coversDependents !== undefined)  data.coversDependents = Boolean(f.coversDependents);
    if (f.effectiveTo !== undefined)       data.effectiveTo = f.effectiveTo ? new Date(f.effectiveTo) : null;
    if (f.isActive !== undefined)          data.isActive = Boolean(f.isActive);
    if (f.description !== undefined)       data.description = f.description?.trim() || null;
    data.updatedBy = req.user.sub;

    const plan = await prisma.insurancePlan.update({ where: { id: req.params.id }, data });
    res.json(plan);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Plan not found' });
    next(err);
  }
});

// DELETE /benefits/plans/:id — soft delete (set inactive). Blocked if ACTIVE enrollments exist.
app.delete('/benefits/plans/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const activeCount = await prisma.employeeEnrollment.count({
      where: { planId: req.params.id, status: 'ACTIVE' },
    });
    if (activeCount > 0) {
      return res.status(409).json({ error: `Cannot deactivate plan with ${activeCount} active enrollments` });
    }
    const plan = await prisma.insurancePlan.update({
      where: { id: req.params.id },
      data: { isActive: false, updatedBy: req.user.sub },
    });
    res.json(plan);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Plan not found' });
    next(err);
  }
});

// ── Eligibility check ─────────────────────────────────────────────────────────
// GET /benefits/plans/:id/eligibility?employeeId=...
app.get('/benefits/plans/:id/eligibility', authenticate, async (req, res, next) => {
  try {
    const targetEmployeeId = req.query.employeeId || req.user.employeeId || req.user.sub;
    if (!isHr(req.user.role) && targetEmployeeId !== (req.user.employeeId || req.user.sub)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const plan = await prisma.insurancePlan.findUnique({ where: { id: req.params.id } });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    let employee = null;
    try {
      const resp = await fetch(`${EMPLOYEE_SERVICE_URL}/employees/${targetEmployeeId}`, {
        headers: { authorization: req.headers.authorization || '' },
      });
      if (resp.ok) employee = await resp.json();
    } catch (_) { /* employee service down — caller can still see plan rules */ }

    const result = computeEnrollmentEligibility(employee || { grade: req.user.grade, joinedAt: req.user.joinedAt }, plan);
    res.json({ plan: { id: plan.id, code: plan.code, name: plan.name }, ...result });
  } catch (err) { next(err); }
});

// ── Enrollments ───────────────────────────────────────────────────────────────

// POST /benefits/enrollments — HR enrolls an employee (or self-enroll within open period)
app.post('/benefits/enrollments', authenticate, async (req, res, next) => {
  try {
    const {
      employeeId, employeeName, employeeGrade, planId,
      enrollmentSource, effectiveFrom, dependentIds, policyMemberNumber,
    } = req.body;

    if (!planId)         return res.status(400).json({ error: 'planId is required' });
    if (!effectiveFrom)  return res.status(400).json({ error: 'effectiveFrom is required' });

    const targetEmpId = employeeId || req.user.employeeId || req.user.sub;
    const targetEmpName = employeeName || req.user.name || 'Unknown';

    // Non-HR can only self-enroll, and only during an active open enrollment period
    if (!isHr(req.user.role)) {
      if (targetEmpId !== (req.user.employeeId || req.user.sub)) {
        return res.status(403).json({ error: 'Employees may only enroll themselves' });
      }
      const active = await prisma.openEnrollmentPeriod.findFirst({
        where: { status: 'ACTIVE', startDate: { lte: new Date() }, endDate: { gte: new Date() } },
      });
      if (!active) return res.status(409).json({ error: 'Self-enrollment only allowed during an active open enrollment period' });
      if (Array.isArray(active.planIds) && active.planIds.length > 0 && !active.planIds.includes(planId)) {
        return res.status(409).json({ error: 'This plan is not part of the current open enrollment' });
      }
    }

    const plan = await prisma.insurancePlan.findUnique({ where: { id: planId } });
    if (!plan)          return res.status(404).json({ error: 'Plan not found' });
    if (!plan.isActive) return res.status(409).json({ error: 'Plan is inactive' });

    // Check duplicate active enrollment
    const existing = await prisma.employeeEnrollment.findFirst({
      where: { employeeId: targetEmpId, planId, status: 'ACTIVE' },
    });
    if (existing) return res.status(409).json({ error: 'Active enrollment already exists for this plan' });

    const depIds = Array.isArray(dependentIds) ? dependentIds : [];
    const premium = computeAnnualPremium(plan, depIds.length);

    const enrollment = await prisma.employeeEnrollment.create({
      data: {
        id:               uuidv4(),
        employeeId:       targetEmpId,
        employeeName:     targetEmpName,
        employeeGrade:    employeeGrade || null,
        planId,
        status:           'ACTIVE',
        enrollmentSource: enrollmentSource && ['ONBOARDING','OPEN_ENROLLMENT','MANUAL'].includes(enrollmentSource) ? enrollmentSource : 'MANUAL',
        policyMemberNumber: policyMemberNumber || null,
        effectiveFrom:    new Date(effectiveFrom),
        enrolledDependentIds: depIds,
        annualPremiumEmployer: premium.employer,
        annualPremiumEmployee: premium.employee,
        createdBy:        req.user.sub,
      },
      include: { plan: true },
    });

    // Fire-and-forget notification to employee
    fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientId: targetEmpId,
        type: 'BENEFITS_ENROLLED',
        title: `Enrolled in ${plan.name}`,
        body:  `Your enrollment in ${plan.name} is active effective ${new Date(effectiveFrom).toLocaleDateString('en-SG')}.`,
        link:  '/benefits',
      }),
    }).catch(() => {});

    res.status(201).json(enrollment);
  } catch (err) { next(err); }
});

// GET /benefits/enrollments — list (employee sees own; HR sees all)
app.get('/benefits/enrollments', authenticate, async (req, res, next) => {
  try {
    const { employeeId, planId, status } = req.query;
    const where = {};
    if (!isHr(req.user.role)) {
      where.employeeId = req.user.employeeId || req.user.sub;
    } else {
      if (employeeId) where.employeeId = employeeId;
      if (planId)     where.planId     = planId;
    }
    if (status) where.status = status;

    const enrollments = await prisma.employeeEnrollment.findMany({
      where,
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    const summary = buildEnrollmentSummary(enrollments);
    res.json({ enrollments, total: enrollments.length, summary });
  } catch (err) { next(err); }
});

// GET /benefits/enrollments/me — convenience for current user
app.get('/benefits/enrollments/me', authenticate, async (req, res, next) => {
  try {
    const empId = req.user.employeeId || req.user.sub;
    const enrollments = await prisma.employeeEnrollment.findMany({
      where: { employeeId: empId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ enrollments, total: enrollments.length });
  } catch (err) { next(err); }
});

// PUT /benefits/enrollments/:id/cancel
app.put('/benefits/enrollments/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const e = await prisma.employeeEnrollment.findUnique({ where: { id: req.params.id } });
    if (!e) return res.status(404).json({ error: 'Enrollment not found' });

    const isOwn = e.employeeId === (req.user.employeeId || req.user.sub);
    if (!isHr(req.user.role) && !isOwn) return res.status(403).json({ error: 'Forbidden' });
    if (e.status !== 'ACTIVE') return res.status(409).json({ error: `Cannot cancel enrollment in status ${e.status}` });

    const { cancelReason } = req.body;
    if (!cancelReason || !cancelReason.trim()) return res.status(400).json({ error: 'cancelReason is required' });

    const updated = await prisma.employeeEnrollment.update({
      where: { id: req.params.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: cancelReason.trim(),
        effectiveTo: new Date(),
      },
      include: { plan: true },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Dependents ────────────────────────────────────────────────────────────────

// POST /benefits/dependents — employee adds their own dependent (HR can add for anyone)
app.post('/benefits/dependents', authenticate, async (req, res, next) => {
  try {
    const { employeeId, fullName, relationship, dateOfBirth, nric, gender, notes } = req.body;
    const targetEmpId = (isHr(req.user.role) && employeeId) ? employeeId : (req.user.employeeId || req.user.sub);

    if (!fullName || !fullName.trim()) return res.status(400).json({ error: 'fullName is required' });
    if (!relationship || !RELATIONSHIPS.includes(relationship))
      return res.status(400).json({ error: `relationship must be one of: ${RELATIONSHIPS.join(', ')}` });
    if (!dateOfBirth) return res.status(400).json({ error: 'dateOfBirth is required' });

    const dep = await prisma.dependent.create({
      data: {
        id:           uuidv4(),
        employeeId:   targetEmpId,
        fullName:     fullName.trim(),
        relationship,
        dateOfBirth:  new Date(dateOfBirth),
        nric:         nric?.trim() ? nric.trim().slice(-4) : null,
        gender:       gender?.trim() || null,
        notes:        notes?.trim()  || null,
      },
    });
    res.status(201).json(dep);
  } catch (err) { next(err); }
});

// GET /benefits/dependents — employee sees own; HR sees all (filter by employeeId)
app.get('/benefits/dependents', authenticate, async (req, res, next) => {
  try {
    const where = { isActive: true };
    if (!isHr(req.user.role)) where.employeeId = req.user.employeeId || req.user.sub;
    else if (req.query.employeeId) where.employeeId = req.query.employeeId;

    const dependents = await prisma.dependent.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ dependents, total: dependents.length });
  } catch (err) { next(err); }
});

// DELETE /benefits/dependents/:id — soft delete (mark inactive)
app.delete('/benefits/dependents/:id', authenticate, async (req, res, next) => {
  try {
    const dep = await prisma.dependent.findUnique({ where: { id: req.params.id } });
    if (!dep) return res.status(404).json({ error: 'Dependent not found' });
    const isOwn = dep.employeeId === (req.user.employeeId || req.user.sub);
    if (!isHr(req.user.role) && !isOwn) return res.status(403).json({ error: 'Forbidden' });
    const updated = await prisma.dependent.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Claims ────────────────────────────────────────────────────────────────────

// H-21: DB sequence — race-safe alternative to prisma.count()+1.
let _benefitsSeqInit = null;
async function ensureBenefitsSequences() {
  if (_benefitsSeqInit) return _benefitsSeqInit;
  _benefitsSeqInit = Promise.all([
    prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS benefits_clm_seq START 1`),
    prisma.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS benefits_flx_seq START 1`),
  ]);
  return _benefitsSeqInit;
}
ensureBenefitsSequences().catch(err => console.error('[benefits-service] sequence init failed', err.message));

async function nextClaimNumber() {
  await ensureBenefitsSequences();
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRawUnsafe(`SELECT nextval('benefits_clm_seq') AS n`);
  return `CLM-${year}-${String(Number(rows[0].n)).padStart(5, '0')}`;
}

// POST /benefits/claims — employee submits claim against an active enrollment
app.post('/benefits/claims', authenticate, async (req, res, next) => {
  try {
    const {
      enrollmentId, patientName, patientDependentId, treatmentDate,
      treatmentType, hospitalProvider, diagnosis, claimAmount, attachments,
    } = req.body;

    if (!enrollmentId)         return res.status(400).json({ error: 'enrollmentId is required' });
    if (!treatmentDate)        return res.status(400).json({ error: 'treatmentDate is required' });
    if (!treatmentType)        return res.status(400).json({ error: 'treatmentType is required' });
    if (claimAmount === undefined || isNaN(parseFloat(claimAmount)) || parseFloat(claimAmount) <= 0)
      return res.status(400).json({ error: 'claimAmount must be a positive number' });

    const enrollment = await prisma.employeeEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { plan: true },
    });
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });

    const isOwn = enrollment.employeeId === (req.user.employeeId || req.user.sub);
    if (!isHr(req.user.role) && !isOwn) return res.status(403).json({ error: 'Forbidden' });
    if (enrollment.status !== 'ACTIVE') return res.status(409).json({ error: 'Enrollment is not active' });

    if (parseFloat(claimAmount) > enrollment.plan.coverageAmount) {
      return res.status(409).json({ error: `Claim exceeds plan coverage of SGD ${enrollment.plan.coverageAmount}` });
    }

    const claim = await prisma.insuranceClaim.create({
      data: {
        id:                uuidv4(),
        claimNumber:       await nextClaimNumber(),
        enrollmentId,
        planId:            enrollment.planId,
        employeeId:        enrollment.employeeId,
        employeeName:      enrollment.employeeName,
        patientName:       patientName || enrollment.employeeName,
        patientDependentId: patientDependentId || null,
        treatmentDate:     new Date(treatmentDate),
        treatmentType,
        hospitalProvider:  hospitalProvider?.trim() || null,
        diagnosis:         diagnosis?.trim() || null,
        claimAmount:       parseFloat(claimAmount),
        attachments:       Array.isArray(attachments) ? attachments : [],
        status:            'SUBMITTED',
      },
    });

    res.status(201).json(claim);
  } catch (err) { next(err); }
});

// GET /benefits/claims — employee sees own; HR sees all
app.get('/benefits/claims', authenticate, async (req, res, next) => {
  try {
    const where = {};
    if (!isHr(req.user.role)) where.employeeId = req.user.employeeId || req.user.sub;
    else if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.planId) where.planId = req.query.planId;

    const claims = await prisma.insuranceClaim.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
    });
    const summary = buildClaimsSummary(claims);
    res.json({ claims, total: claims.length, summary });
  } catch (err) { next(err); }
});

// PUT /benefits/claims/:id/approve — HR approves
app.put('/benefits/claims/:id/approve', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { approvedAmount, insurerRefNumber } = req.body;
    const amt = approvedAmount !== undefined ? parseFloat(approvedAmount) : null;
    if (amt !== null && (isNaN(amt) || amt < 0))
      return res.status(400).json({ error: 'approvedAmount must be a non-negative number' });

    const existing = await prisma.insuranceClaim.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Claim not found' });
    if (!['SUBMITTED','UNDER_REVIEW'].includes(existing.status))
      return res.status(409).json({ error: `Cannot approve claim in status ${existing.status}` });

    const claim = await prisma.insuranceClaim.update({
      where: { id: req.params.id },
      data: {
        status:           'APPROVED',
        approvedAmount:   amt !== null ? amt : existing.claimAmount,
        insurerRefNumber: insurerRefNumber || existing.insurerRefNumber,
        reviewedAt:       new Date(),
        reviewedBy:       req.user.sub,
      },
    });

    fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientId: claim.employeeId,
        type: 'CLAIM_APPROVED',
        title: `Claim ${claim.claimNumber} approved`,
        body:  `SGD ${claim.approvedAmount} approved for ${claim.treatmentType}.`,
        link:  '/benefits',
      }),
    }).catch(() => {});

    res.json(claim);
  } catch (err) { next(err); }
});

// PUT /benefits/claims/:id/reject
app.put('/benefits/claims/:id/reject', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { rejectedReason } = req.body;
    if (!rejectedReason || !rejectedReason.trim())
      return res.status(400).json({ error: 'rejectedReason is required' });

    const existing = await prisma.insuranceClaim.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Claim not found' });
    if (!['SUBMITTED','UNDER_REVIEW'].includes(existing.status))
      return res.status(409).json({ error: `Cannot reject claim in status ${existing.status}` });

    const claim = await prisma.insuranceClaim.update({
      where: { id: req.params.id },
      data: {
        status:         'REJECTED',
        rejectedReason: rejectedReason.trim(),
        reviewedAt:     new Date(),
        reviewedBy:     req.user.sub,
      },
    });
    res.json(claim);
  } catch (err) { next(err); }
});

// PUT /benefits/claims/:id/reimburse — Finance marks paid out
app.put('/benefits/claims/:id/reimburse', authenticate, authorize(...FINANCE_ROLES, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const existing = await prisma.insuranceClaim.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Claim not found' });
    if (existing.status !== 'APPROVED')
      return res.status(409).json({ error: 'Only APPROVED claims can be reimbursed' });
    const claim = await prisma.insuranceClaim.update({
      where: { id: req.params.id },
      data: { status: 'REIMBURSED', reimbursedAt: new Date() },
    });
    res.json(claim);
  } catch (err) { next(err); }
});

// ── Open Enrollment ───────────────────────────────────────────────────────────

// POST /benefits/open-enrollment — HR opens a window
app.post('/benefits/open-enrollment', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { name, year, startDate, endDate, planIds, defaultPlanIds } = req.body;
    if (!name || !year || !startDate || !endDate)
      return res.status(400).json({ error: 'name, year, startDate, endDate are required' });
    if (new Date(startDate) > new Date(endDate))
      return res.status(400).json({ error: 'startDate must be before endDate' });

    const status = new Date() >= new Date(startDate) && new Date() <= new Date(endDate) ? 'ACTIVE' : 'SCHEDULED';

    const period = await prisma.openEnrollmentPeriod.create({
      data: {
        id:             uuidv4(),
        name:           name.trim(),
        year:           parseInt(year),
        startDate:      new Date(startDate),
        endDate:        new Date(endDate),
        status,
        planIds:        Array.isArray(planIds)        ? planIds        : [],
        defaultPlanIds: Array.isArray(defaultPlanIds) ? defaultPlanIds : [],
        createdBy:      req.user.sub,
      },
    });
    res.status(201).json(period);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A period with this year and name already exists' });
    next(err);
  }
});

// GET /benefits/open-enrollment/current — anyone can see current window
app.get('/benefits/open-enrollment/current', authenticate, async (req, res, next) => {
  try {
    const now = new Date();
    const period = await prisma.openEnrollmentPeriod.findFirst({
      where: { status: 'ACTIVE', startDate: { lte: now }, endDate: { gte: now } },
      orderBy: { startDate: 'desc' },
    });
    if (!period) return res.json({ active: false, period: null });
    res.json({ active: isInOpenEnrollmentPeriod(now, period), period });
  } catch (err) { next(err); }
});

// GET /benefits/open-enrollment — HR lists all
app.get('/benefits/open-enrollment', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const periods = await prisma.openEnrollmentPeriod.findMany({ orderBy: { startDate: 'desc' } });
    res.json({ periods, total: periods.length });
  } catch (err) { next(err); }
});

// PUT /benefits/open-enrollment/:id/close — HR closes a window
app.put('/benefits/open-enrollment/:id/close', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const period = await prisma.openEnrollmentPeriod.update({
      where: { id: req.params.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    res.json(period);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Period not found' });
    next(err);
  }
});

// ── Dashboard & Reconciliation ────────────────────────────────────────────────

// GET /benefits/dashboard — HR aggregate view
app.get('/benefits/dashboard', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const [enrollments, claims, plans, activePeriod] = await Promise.all([
      prisma.employeeEnrollment.findMany({ include: { plan: true } }),
      prisma.insuranceClaim.findMany(),
      prisma.insurancePlan.findMany({ where: { isActive: true } }),
      prisma.openEnrollmentPeriod.findFirst({
        where: { status: 'ACTIVE', startDate: { lte: new Date() }, endDate: { gte: new Date() } },
      }),
    ]);

    const enrollmentSummary = buildEnrollmentSummary(enrollments);
    const claimsSummary     = buildClaimsSummary(claims);

    const bikByPlan = plans.map(p => {
      const planEnrollments = enrollments.filter(e => e.planId === p.id && e.status === 'ACTIVE');
      const totalDependents = planEnrollments.reduce((s, e) => s + (e.enrolledDependentIds?.length || 0), 0);
      return {
        planId: p.id,
        planCode: p.code,
        planName: p.name,
        type: p.type,
        activeEnrollments: planEnrollments.length,
        totalBik: computeBikValue(p, totalDependents / Math.max(planEnrollments.length, 1)),
        annualPremiumExpected: planEnrollments.reduce((s, e) => s + Number(e.annualPremiumEmployer || 0), 0),
      };
    });

    res.json({
      enrollmentSummary,
      claimsSummary,
      plansActive: plans.length,
      bikByPlan,
      openEnrollment: activePeriod ? { id: activePeriod.id, name: activePeriod.name, endDate: activePeriod.endDate } : null,
    });
  } catch (err) { next(err); }
});

// GET /benefits/reconciliation?planId=...&insurerBilled=...
app.get('/benefits/reconciliation', authenticate, authorize(...HR_ROLES, ...FINANCE_ROLES), async (req, res, next) => {
  try {
    const { planId, insurerBilled } = req.query;
    if (!planId) return res.status(400).json({ error: 'planId is required' });
    const enrollments = await prisma.employeeEnrollment.findMany({
      where: { planId, status: 'ACTIVE' },
    });
    const recon = computeReconciliation(enrollments, parseFloat(insurerBilled || 0));
    res.json({ planId, activeEnrollments: enrollments.length, ...recon });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// BEN-002: Flexi-Benefits Wallet
// ─────────────────────────────────────────────────────────────────────────────

const {
  WALLET_CATEGORIES,
  DEFAULT_GRADE_AMOUNTS,
  computeBalance,
  isWalletExpired,
  shouldAutoApprove,
  computeYearEndSummary,
  buildWalletDashboard,
  walletExpiresAt,
  round2: r2,
} = require('./engines/flexi-wallet.engine');

const FINANCE_VIEW_ROLES = [...FINANCE_ROLES, ...HR_ROLES];

async function nextFlexiClaimNumber() {
  await ensureBenefitsSequences();
  const year = new Date().getFullYear();
  const rows = await prisma.$queryRawUnsafe(`SELECT nextval('benefits_flx_seq') AS n`);
  return `FLX-${year}-${String(Number(rows[0].n)).padStart(5, '0')}`;
}

// ── Flexi Categories ─────────────────────────────────────────────────────────

// POST /benefits/flexi-categories/seed — idempotent seed of 6 default categories
app.post('/benefits/flexi-categories/seed', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const results = { created: 0, skipped: 0 };
    for (const cat of WALLET_CATEGORIES) {
      const exists = await prisma.flexiCategory.findUnique({ where: { code: cat.code } });
      if (exists) { results.skipped += 1; continue; }
      await prisma.flexiCategory.create({
        data: { id: uuidv4(), ...cat, createdBy: req.user.sub },
      });
      results.created += 1;
    }
    res.status(201).json({ message: 'Seed complete', ...results });
  } catch (err) { next(err); }
});

// GET /benefits/flexi-categories — list active categories
app.get('/benefits/flexi-categories', authenticate, async (req, res, next) => {
  try {
    const where = { isActive: true };
    const categories = await prisma.flexiCategory.findMany({ where, orderBy: { name: 'asc' } });
    res.json({ categories, total: categories.length });
  } catch (err) { next(err); }
});

// POST /benefits/flexi-categories — HR creates a custom category
app.post('/benefits/flexi-categories', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { code, name, description, requiresReceipt } = req.body;
    if (!code || !code.trim()) return res.status(400).json({ error: 'code is required' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    const cat = await prisma.flexiCategory.create({
      data: {
        id: uuidv4(), code: code.trim().toUpperCase(), name: name.trim(),
        description: description?.trim() || null,
        requiresReceipt: requiresReceipt !== undefined ? Boolean(requiresReceipt) : true,
        createdBy: req.user.sub,
      },
    });
    res.status(201).json(cat);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Category with this code already exists' });
    next(err);
  }
});

// PUT /benefits/flexi-categories/:id — HR updates
app.put('/benefits/flexi-categories/:id', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const data = {};
    const f = req.body;
    if (f.name !== undefined)            data.name = f.name.trim();
    if (f.description !== undefined)     data.description = f.description?.trim() || null;
    if (f.requiresReceipt !== undefined) data.requiresReceipt = Boolean(f.requiresReceipt);
    if (f.isActive !== undefined)        data.isActive = Boolean(f.isActive);
    const cat = await prisma.flexiCategory.update({ where: { id: req.params.id }, data });
    res.json(cat);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
    next(err);
  }
});

// ── Flexi Wallet Config ───────────────────────────────────────────────────────

// GET /benefits/flexi-config — list grade configs (defaults for unconfigured grades)
app.get('/benefits/flexi-config', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const stored = await prisma.flexiWalletConfig.findMany({ orderBy: { grade: 'asc' } });
    const storedGrades = new Set(stored.map(c => c.grade));
    const defaults = Object.entries(DEFAULT_GRADE_AMOUNTS)
      .filter(([grade]) => !storedGrades.has(grade))
      .map(([grade, annualAmount]) => ({
        id: null, grade, annualAmount, autoApproveThreshold: 50, isActive: true, isDefault: true,
      }));
    const configs = [
      ...stored.map(c => ({ ...c, isDefault: false })),
      ...defaults,
    ].sort((a, b) => a.grade.localeCompare(b.grade));
    res.json({ configs, total: configs.length });
  } catch (err) { next(err); }
});

// PUT /benefits/flexi-config — upsert a grade config
app.put('/benefits/flexi-config', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { grade, annualAmount, autoApproveThreshold, isActive } = req.body;
    if (!grade || !grade.trim()) return res.status(400).json({ error: 'grade is required' });
    if (annualAmount === undefined || isNaN(parseFloat(annualAmount)) || parseFloat(annualAmount) < 0)
      return res.status(400).json({ error: 'annualAmount must be a non-negative number' });

    const data = {
      grade:                grade.trim().toUpperCase(),
      annualAmount:         parseFloat(annualAmount),
      autoApproveThreshold: autoApproveThreshold !== undefined ? parseFloat(autoApproveThreshold) : 50,
      isActive:             isActive !== undefined ? Boolean(isActive) : true,
      updatedBy:            req.user.sub,
    };
    const config = await prisma.flexiWalletConfig.upsert({
      where:  { grade: data.grade },
      update: { ...data },
      create: { id: uuidv4(), ...data, createdBy: req.user.sub },
    });
    res.json(config);
  } catch (err) { next(err); }
});

// ── Flexi Wallets ─────────────────────────────────────────────────────────────

// GET /benefits/flexi-wallets/me?year= — employee's own wallet (current user)
app.get('/benefits/flexi-wallets/me', authenticate, async (req, res, next) => {
  try {
    const empId = req.user.employeeId || req.user.sub;
    const year  = parseInt(req.query.year) || new Date().getFullYear();
    const wallet = await prisma.flexiWallet.findUnique({ where: { employeeId_year: { employeeId: empId, year } } });
    if (!wallet) return res.json({ wallet: null, balance: null });
    const pendingClaims = await prisma.flexiClaim.findMany({
      where: { walletId: wallet.id, status: 'PENDING' },
    });
    const balance = computeBalance(wallet, pendingClaims);
    res.json({ wallet, balance, expired: isWalletExpired(wallet) });
  } catch (err) { next(err); }
});

// GET /benefits/flexi-wallets?year=&employeeId=&status= — HR sees all; employee sees own
app.get('/benefits/flexi-wallets', authenticate, async (req, res, next) => {
  try {
    const where = {};
    if (!isHr(req.user.role)) {
      where.employeeId = req.user.employeeId || req.user.sub;
    } else {
      if (req.query.employeeId) where.employeeId = req.query.employeeId;
    }
    if (req.query.year)   where.year   = parseInt(req.query.year);
    if (req.query.status) where.status = req.query.status;

    const wallets = await prisma.flexiWallet.findMany({ where, orderBy: [{ year: 'desc' }, { employeeName: 'asc' }] });
    res.json({ wallets, total: wallets.length });
  } catch (err) { next(err); }
});

// POST /benefits/flexi-wallets — HR credits (or top-ups) a wallet for an employee + year
app.post('/benefits/flexi-wallets', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { employeeId, employeeName, employeeGrade, year, creditedAmount } = req.body;
    if (!employeeId)     return res.status(400).json({ error: 'employeeId is required' });
    if (!employeeName)   return res.status(400).json({ error: 'employeeName is required' });
    if (!year || isNaN(parseInt(year))) return res.status(400).json({ error: 'year is required' });
    if (creditedAmount === undefined || isNaN(parseFloat(creditedAmount)) || parseFloat(creditedAmount) < 0)
      return res.status(400).json({ error: 'creditedAmount must be a non-negative number' });

    const yr  = parseInt(year);
    const amt = parseFloat(creditedAmount);

    const wallet = await prisma.flexiWallet.upsert({
      where:  { employeeId_year: { employeeId, year: yr } },
      update: { creditedAmount: amt, employeeGrade: employeeGrade || null, updatedAt: new Date() },
      create: {
        id: uuidv4(), employeeId, employeeName, employeeGrade: employeeGrade || null,
        year: yr, creditedAmount: amt, expiresAt: walletExpiresAt(yr), createdBy: req.user.sub,
      },
    });
    res.status(201).json(wallet);
  } catch (err) { next(err); }
});

// POST /benefits/flexi-wallets/credit-batch — HR credits wallets for all employees in a year by grade
app.post('/benefits/flexi-wallets/credit-batch', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { year, gradeOverrides } = req.body;
    if (!year || isNaN(parseInt(year))) return res.status(400).json({ error: 'year is required' });
    const yr = parseInt(year);

    // Fetch all active employees from employee-service
    let employees = [];
    try {
      const resp = await fetch(`${EMPLOYEE_SERVICE_URL}/employees?status=ACTIVE&limit=5000`, {
        headers: { authorization: req.headers.authorization || '' },
      });
      if (resp.ok) {
        const data = await resp.json();
        employees = data.employees || data.data || [];
      }
    } catch (_) { /* service unreachable — caller must retry */ }

    if (employees.length === 0) {
      return res.status(502).json({ error: 'Could not fetch employees from employee-service or no active employees found' });
    }

    // Load stored grade configs + fall back to defaults
    const storedConfigs = await prisma.flexiWalletConfig.findMany({ where: { isActive: true } });
    const configMap = Object.fromEntries(storedConfigs.map(c => [c.grade, c.annualAmount]));

    const results = { credited: 0, skipped: 0, errors: [] };
    for (const emp of employees) {
      try {
        const grade = emp.grade || emp.employeeGrade || '';
        let amount = gradeOverrides?.[grade] ?? configMap[grade] ?? DEFAULT_GRADE_AMOUNTS[grade] ?? 0;
        if (amount <= 0) { results.skipped += 1; continue; }
        await prisma.flexiWallet.upsert({
          where:  { employeeId_year: { employeeId: emp.id, year: yr } },
          update: { creditedAmount: amount, employeeGrade: grade || null },
          create: {
            id: uuidv4(), employeeId: emp.id,
            employeeName: emp.fullName || emp.name || 'Unknown',
            employeeGrade: grade || null, year: yr, creditedAmount: amount,
            expiresAt: walletExpiresAt(yr), createdBy: req.user.sub,
          },
        });
        results.credited += 1;
      } catch (e) {
        results.errors.push({ employeeId: emp.id, error: e.message });
      }
    }
    res.status(201).json({ year: yr, ...results });
  } catch (err) { next(err); }
});

// GET /benefits/flexi-wallets/year-end-preview?year= — dry-run of forfeiture/encashment
app.get('/benefits/flexi-wallets/year-end-preview', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const wallets = await prisma.flexiWallet.findMany({ where: { year, status: 'ACTIVE' } });
    const summary = computeYearEndSummary(wallets);
    const rows = wallets.map(w => ({
      employeeId:    w.employeeId,
      employeeName:  w.employeeName,
      employeeGrade: w.employeeGrade,
      credited:      w.creditedAmount,
      used:          w.usedAmount,
      remaining:     r2(w.creditedAmount - w.usedAmount),
    }));
    res.json({ year, preview: true, summary, rows });
  } catch (err) { next(err); }
});

// POST /benefits/flexi-wallets/year-end — apply forfeiture or encashment, mark wallets EXPIRED
app.post('/benefits/flexi-wallets/year-end', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const { year, encash } = req.body;
    if (!year || isNaN(parseInt(year))) return res.status(400).json({ error: 'year is required' });
    const yr = parseInt(year);

    const wallets = await prisma.flexiWallet.findMany({ where: { year: yr, status: 'ACTIVE' } });
    let processed = 0;
    let totalForfeited = 0, totalEncashed = 0;

    for (const w of wallets) {
      const remaining = r2(w.creditedAmount - w.usedAmount);
      if (remaining < 0) {
        // Over-spent — just expire; no forfeiture or encashment adjustment
        await prisma.flexiWallet.update({ where: { id: w.id }, data: { status: 'EXPIRED' } });
      } else if (encash) {
        await prisma.flexiWallet.update({
          where: { id: w.id },
          data: { status: 'EXPIRED', encashedAmount: r2((w.encashedAmount || 0) + remaining) },
        });
        totalEncashed = r2(totalEncashed + remaining);
      } else {
        await prisma.flexiWallet.update({
          where: { id: w.id },
          data: { status: 'EXPIRED', forfeitedAmount: r2((w.forfeitedAmount || 0) + remaining) },
        });
        totalForfeited = r2(totalForfeited + remaining);
      }
      processed += 1;
    }

    res.json({
      year: yr,
      processed,
      encash: Boolean(encash),
      totalForfeited,
      totalEncashed,
    });
  } catch (err) { next(err); }
});

// GET /benefits/internal/flexi-encashment?year= — payroll callback for encashed balances
app.get('/benefits/internal/flexi-encashment', async (req, res, next) => {
  try {
    const internalKey = req.headers['x-internal-service-key'];
    if (!internalKey || internalKey !== process.env.INTERNAL_SERVICE_KEY) {
      return res.status(403).json({ error: 'Internal access only' });
    }
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const wallets = await prisma.flexiWallet.findMany({
      where: { year, status: 'EXPIRED', encashedAmount: { gt: 0 } },
      orderBy: { employeeName: 'asc' },
    });
    const employees = wallets.map(w => ({
      employeeId:    w.employeeId,
      employeeName:  w.employeeName,
      encashedAmount: w.encashedAmount,
    }));
    const totalEncashed = r2(wallets.reduce((s, w) => s + (w.encashedAmount || 0), 0));
    res.json({ year, employees, totalEncashed });
  } catch (err) { next(err); }
});

// ── Flexi Claims ──────────────────────────────────────────────────────────────

// POST /benefits/flexi-claims — employee submits a claim against their wallet
app.post('/benefits/flexi-claims', authenticate, async (req, res, next) => {
  try {
    const { walletId, categoryId, receiptDate, vendor, description, claimAmount, receipts } = req.body;

    if (!walletId)    return res.status(400).json({ error: 'walletId is required' });
    if (!categoryId)  return res.status(400).json({ error: 'categoryId is required' });
    if (!receiptDate) return res.status(400).json({ error: 'receiptDate is required' });
    if (!description || !description.trim()) return res.status(400).json({ error: 'description is required' });
    const amt = parseFloat(claimAmount);
    if (!claimAmount || isNaN(amt) || amt <= 0)
      return res.status(400).json({ error: 'claimAmount must be a positive number' });

    const wallet = await prisma.flexiWallet.findUnique({ where: { id: walletId } });
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

    const empId = req.user.employeeId || req.user.sub;
    const isOwn = wallet.employeeId === empId;
    if (!isHr(req.user.role) && !isOwn) return res.status(403).json({ error: 'Forbidden' });

    if (isWalletExpired(wallet)) return res.status(409).json({ error: 'Wallet has expired' });

    const category = await prisma.flexiCategory.findUnique({ where: { id: categoryId } });
    if (!category || !category.isActive) return res.status(404).json({ error: 'Category not found or inactive' });

    // Balance check: creditedAmount - usedAmount - sum of PENDING claims
    const pendingClaims = await prisma.flexiClaim.findMany({
      where: { walletId, status: 'PENDING' },
    });
    const available = r2(wallet.creditedAmount - wallet.usedAmount -
      pendingClaims.reduce((s, c) => s + Number(c.claimAmount || 0), 0));
    if (available < amt) {
      return res.status(409).json({
        error: `Insufficient balance. Available: SGD ${available}, Requested: SGD ${amt}`,
        available,
        requested: amt,
      });
    }

    // Determine if auto-approve applies
    const config = await prisma.flexiWalletConfig.findUnique({ where: { grade: wallet.employeeGrade || '' } }).catch(() => null);
    const autoApprove = shouldAutoApprove(amt, config);

    const claimData = {
      id:            uuidv4(),
      claimNumber:   await nextFlexiClaimNumber(),
      walletId,
      employeeId:    wallet.employeeId,
      employeeName:  wallet.employeeName,
      categoryId,
      categoryCode:  category.code,
      categoryName:  category.name,
      receiptDate:   new Date(receiptDate),
      vendor:        vendor?.trim() || null,
      description:   description.trim(),
      claimAmount:   amt,
      receipts:      Array.isArray(receipts) ? receipts : [],
      status:        autoApprove ? 'APPROVED' : 'PENDING',
      autoApproved:  autoApprove,
      approvedAmount: autoApprove ? amt : null,
      reviewedAt:    autoApprove ? new Date() : null,
      reviewedBy:    autoApprove ? 'system:auto-approve' : null,
    };

    if (autoApprove) {
      // SECURITY (M-05): TOCTOU race fix. Use an atomic conditional UPDATE
      // that increments usedAmount only when (usedAmount + amt) <=
      // creditedAmount. Concurrent auto-approves can't overspend: the
      // updateMany returns count=0 if the conditional fails, and we abort.
      const r = await prisma.$executeRaw`
        UPDATE flexi_wallets
        SET used_amount = used_amount + ${amt}
        WHERE id = ${walletId}
          AND used_amount + ${amt} <= credited_amount
      `;
      if (Number(r) === 0) {
        return res.status(409).json({
          error: 'Insufficient balance — wallet was updated by a concurrent claim. Please try again.',
        });
      }
      const claim = await prisma.flexiClaim.create({ data: claimData });
      return res.status(201).json({ ...claim, autoApproved: true });
    }

    const claim = await prisma.flexiClaim.create({ data: claimData });
    res.status(201).json(claim);
  } catch (err) { next(err); }
});

// GET /benefits/flexi-claims?walletId=&status=&year=&employeeId= — list claims
app.get('/benefits/flexi-claims', authenticate, async (req, res, next) => {
  try {
    const where = {};
    if (!isHr(req.user.role)) {
      where.employeeId = req.user.employeeId || req.user.sub;
    } else {
      if (req.query.employeeId) where.employeeId = req.query.employeeId;
    }
    if (req.query.walletId) where.walletId = req.query.walletId;
    if (req.query.status)   where.status   = req.query.status;
    if (req.query.year) {
      const yr = parseInt(req.query.year);
      // Filter by claim submission year via submittedAt
      const start = new Date(`${yr}-01-01T00:00:00.000Z`);
      const end   = new Date(`${yr + 1}-01-01T00:00:00.000Z`);
      where.submittedAt = { gte: start, lt: end };
    }

    const claims = await prisma.flexiClaim.findMany({
      where,
      include: { category: true },
      orderBy: { submittedAt: 'desc' },
    });
    const byStatus = {};
    for (const c of claims) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    res.json({ claims, total: claims.length, summary: { byStatus } });
  } catch (err) { next(err); }
});

// PUT /benefits/flexi-claims/:id/approve — Finance / HR approves a PENDING claim
app.put('/benefits/flexi-claims/:id/approve', authenticate, authorize(...FINANCE_VIEW_ROLES), async (req, res, next) => {
  try {
    const claim = await prisma.flexiClaim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (claim.status !== 'PENDING') return res.status(409).json({ error: `Cannot approve claim in status ${claim.status}` });

    const approvedAmt = req.body.approvedAmount !== undefined
      ? parseFloat(req.body.approvedAmount)
      : claim.claimAmount;
    if (isNaN(approvedAmt) || approvedAmt < 0)
      return res.status(400).json({ error: 'approvedAmount must be a non-negative number' });

    const wallet = await prisma.flexiWallet.findUnique({ where: { id: claim.walletId } });

    const [updated] = await prisma.$transaction([
      prisma.flexiClaim.update({
        where: { id: req.params.id },
        data: {
          status: 'APPROVED', approvedAmount: approvedAmt,
          reviewedBy: req.user.sub, reviewedAt: new Date(),
        },
      }),
      prisma.flexiWallet.update({
        where: { id: claim.walletId },
        data:  { usedAmount: r2((wallet?.usedAmount || 0) + approvedAmt) },
      }),
    ]);
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /benefits/flexi-claims/:id/reject — Finance / HR rejects (reverses wallet if already APPROVED)
app.put('/benefits/flexi-claims/:id/reject', authenticate, authorize(...FINANCE_VIEW_ROLES), async (req, res, next) => {
  try {
    const { rejectedReason } = req.body;
    if (!rejectedReason || !rejectedReason.trim())
      return res.status(400).json({ error: 'rejectedReason is required' });

    const claim = await prisma.flexiClaim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (!['PENDING', 'APPROVED'].includes(claim.status))
      return res.status(409).json({ error: `Cannot reject claim in status ${claim.status}` });

    const ops = [
      prisma.flexiClaim.update({
        where: { id: req.params.id },
        data: {
          status: 'REJECTED', rejectedReason: rejectedReason.trim(),
          reviewedBy: req.user.sub, reviewedAt: new Date(),
        },
      }),
    ];

    // Reverse wallet usedAmount if the claim was already APPROVED (including auto-approved)
    if (claim.status === 'APPROVED' && claim.approvedAmount) {
      const wallet = await prisma.flexiWallet.findUnique({ where: { id: claim.walletId } });
      ops.push(
        prisma.flexiWallet.update({
          where: { id: claim.walletId },
          data:  { usedAmount: r2(Math.max(0, (wallet?.usedAmount || 0) - claim.approvedAmount)) },
        }),
      );
    }

    const [updated] = await prisma.$transaction(ops);
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /benefits/flexi-claims/:id/cancel — employee cancels own PENDING claim
app.put('/benefits/flexi-claims/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const claim = await prisma.flexiClaim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });

    const empId = req.user.employeeId || req.user.sub;
    const isOwn = claim.employeeId === empId;
    if (!isHr(req.user.role) && !isOwn) return res.status(403).json({ error: 'Forbidden' });
    if (claim.status !== 'PENDING') return res.status(409).json({ error: `Cannot cancel claim in status ${claim.status}` });

    const updated = await prisma.flexiClaim.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED' },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── Flexi Dashboard ───────────────────────────────────────────────────────────

// GET /benefits/flexi-dashboard?year= — HR aggregate view
app.get('/benefits/flexi-dashboard', authenticate, authorize(...HR_ROLES), async (req, res, next) => {
  try {
    const year  = parseInt(req.query.year) || new Date().getFullYear();
    const [wallets, claims] = await Promise.all([
      prisma.flexiWallet.findMany({ where: { year } }),
      prisma.flexiClaim.findMany({
        where: {
          submittedAt: {
            gte: new Date(`${year}-01-01T00:00:00.000Z`),
            lt:  new Date(`${year + 1}-01-01T00:00:00.000Z`),
          },
        },
      }),
    ]);
    const dashboard = buildWalletDashboard(wallets, claims);
    const pendingClaims = claims.filter(c => c.status === 'PENDING').length;
    res.json({ year, ...dashboard, pendingClaims });
  } catch (err) { next(err); }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[benefits-service] Running on port ${PORT}`));
}

module.exports = app;
