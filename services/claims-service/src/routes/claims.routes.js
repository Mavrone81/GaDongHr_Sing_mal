'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('../../../../shared/auth-middleware');

const prisma = new PrismaClient();

// GET /claims/categories
router.get('/categories', authenticate, async (req, res, next) => {
  try {
    const cats = await prisma.claimCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    res.json(cats);
  } catch (err) { next(err); }
});

// GET /claims
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const where = {};
    if (req.user.role === 'employee') where.employeeId = req.user.employeeId;
    if (status) where.status = status.toUpperCase();

    const [claims, total] = await Promise.all([
      prisma.claim.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: Number(limit), include: { category: { select: { code: true, name: true } }, items: true } }),
      prisma.claim.count({ where }),
    ]);
    res.json({ claims, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// POST /claims  (submit claim)
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { categoryId, title, description, claimDate, totalAmount, gstAmount, items, notes } = req.body;
    const employeeId = req.body.employeeId || req.user.employeeId;
    if (!categoryId || !title || !claimDate || !totalAmount) return res.status(400).json({ error: 'categoryId, title, claimDate, totalAmount required' });

    const cat = await prisma.claimCategory.findUnique({ where: { id: categoryId } });
    if (cat?.maxAmount && totalAmount > cat.maxAmount) return res.status(400).json({ error: `Amount exceeds category limit of SGD ${cat.maxAmount}` });

    const claim = await prisma.claim.create({
      data: {
        id: uuidv4(), employeeId, categoryId, title, description, claimDate: new Date(claimDate),
        totalAmount, gstAmount: gstAmount || 0, notes, status: 'SUBMITTED', submittedAt: new Date(),
        items: items ? { create: items.map(i => ({ id: uuidv4(), ...i })) } : undefined,
      },
      include: { category: true, items: true },
    });
    res.status(201).json(claim);
  } catch (err) { next(err); }
});

// PUT /claims/:id/approve  (Finance Admin)
router.put('/:id/approve', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.FINANCE_ADMIN), async (req, res, next) => {
  try {
    const { payrollPeriod } = req.body;
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (!['SUBMITTED'].includes(claim.status)) return res.status(400).json({ error: 'Only SUBMITTED claims can be approved' });

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: { status: 'APPROVED', approvedById: req.user.sub, approvedAt: new Date(), payrollPeriod },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /claims/:id/reject
router.put('/:id/reject', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.FINANCE_ADMIN), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const updated = await prisma.claim.update({ where: { id: req.params.id }, data: { status: 'REJECTED', rejectedReason: reason } });
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /claims/report  (for payroll integration)
router.get('/report', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER, ROLES.FINANCE_ADMIN), async (req, res, next) => {
  try {
    const { period } = req.query;
    const where = { status: 'APPROVED', payrollPeriod: period };
    const claims = await prisma.claim.findMany({ where, include: { category: true } });
    const summary = claims.reduce((acc, c) => {
      if (!acc[c.employeeId]) acc[c.employeeId] = { employeeId: c.employeeId, totalReimbursement: 0, claims: [] };
      acc[c.employeeId].totalReimbursement += c.totalAmount;
      acc[c.employeeId].claims.push({ id: c.id, title: c.title, amount: c.totalAmount });
      return acc;
    }, {});
    res.json({ period, employeeSummaries: Object.values(summary) });
  } catch (err) { next(err); }
});

module.exports = router;
