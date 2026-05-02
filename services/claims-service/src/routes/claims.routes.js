'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');

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

    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to your account. Contact HR to link your employee record before submitting claims.' });
    if (!categoryId || !title || !claimDate || !totalAmount) return res.status(400).json({ error: 'categoryId, title, claimDate, totalAmount required' });

    const cat = await prisma.claimCategory.findUnique({ where: { id: categoryId } });
    if (cat?.maxAmount && totalAmount > cat.maxAmount) return res.status(400).json({ error: `Amount exceeds category limit of SGD ${cat.maxAmount}` });

    const claimData = {
      id: uuidv4(), employeeId, categoryId, title, description: description || null,
      claimDate: new Date(claimDate), totalAmount: Number(totalAmount),
      gstAmount: Number(gstAmount) || 0, notes: notes || null,
      status: 'SUBMITTED', submittedAt: new Date(),
    };

    const claim = await prisma.claim.create({
      data: items && items.length > 0
        ? { ...claimData, items: { create: items.map(i => ({ id: uuidv4(), ...i })) } }
        : claimData,
      include: { category: true, items: true },
    });
    res.status(201).json(claim);
  } catch (err) { next(err); }
});

// PATCH /claims/:id  (amend a SUBMITTED claim — owner or admin only)
router.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    if (claim.status !== 'SUBMITTED') return res.status(400).json({ error: 'Only pending claims can be amended' });

    const isOwner = req.user.employeeId && claim.employeeId === req.user.employeeId;
    const isAdmin = ['SUPER_ADMIN', 'HR_ADMIN', 'FINANCE_ADMIN'].includes(req.user.role?.toUpperCase());
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not authorised to amend this claim' });

    const { categoryId, title, description, claimDate, totalAmount, gstAmount } = req.body;

    if (categoryId) {
      const cat = await prisma.claimCategory.findUnique({ where: { id: categoryId } });
      if (cat?.maxAmount && (totalAmount ?? claim.totalAmount) > cat.maxAmount)
        return res.status(400).json({ error: `Amount exceeds category limit of SGD ${cat.maxAmount}` });
    }

    const updated = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        ...(categoryId   !== undefined && { categoryId }),
        ...(title        !== undefined && { title }),
        ...(description  !== undefined && { description }),
        ...(claimDate    !== undefined && { claimDate: new Date(claimDate) }),
        ...(totalAmount  !== undefined && { totalAmount }),
        ...(gstAmount    !== undefined && { gstAmount }),
      },
      include: { category: true },
    });
    res.json(updated);
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
