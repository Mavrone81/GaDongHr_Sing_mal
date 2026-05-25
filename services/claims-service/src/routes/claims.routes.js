'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, authorizeSelfOrRole, ROLES } = require('/app/shared/auth-middleware');
const {
  validateGstNumber,
  checkRegistryMatch,
  aggregateGstByPeriod,
  aggregateByCostCentre,
  aggregateByCategory,
  rankTopClaimants,
  computeCategoryBudgetUtilisation,
} = require('../engines/gst.engine');

const prisma = new PrismaClient();

const FINANCE_ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.FINANCE_ADMIN];
const FINANCE_VIEW_ROLES  = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.FINANCE_ADMIN, ROLES.PAYROLL_OFFICER];

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
    const { categoryId, title, description, claimDate, totalAmount, gstAmount, items, notes, costCentre, vendorName, vendorGstNumber } = req.body;
    const employeeId = req.body.employeeId || req.user.employeeId;

    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to your account. Contact HR to link your employee record before submitting claims.' });
    if (!categoryId || !title || !claimDate || !totalAmount) return res.status(400).json({ error: 'categoryId, title, claimDate, totalAmount required' });

    const cat = await prisma.claimCategory.findUnique({ where: { id: categoryId } });
    if (cat?.maxAmount && totalAmount > cat.maxAmount) return res.status(400).json({ error: `Amount exceeds category limit of SGD ${cat.maxAmount}` });

    // CLM-004: auto-validate vendor GST against IRAS registry if number provided.
    let gstValidated = false;
    let gstValidationNote = null;
    let normalizedGst = null;
    if (vendorGstNumber) {
      const registry = await prisma.vendorGstRegistration.findMany({ where: { isActive: true } });
      const match = checkRegistryMatch(vendorGstNumber, claimDate, registry);
      gstValidated = match.valid;
      normalizedGst = match.normalized;
      gstValidationNote = match.valid ? `Matched ${match.vendor.vendorName}` : `Validation failed: ${match.reason}`;
    } else if (cat?.isGstClaimable && Number(gstAmount) > 0) {
      gstValidationNote = 'GST claimed but no vendor GST number supplied';
    }

    const claimData = {
      id: uuidv4(), employeeId, categoryId, title, description: description || null,
      claimDate: new Date(claimDate), totalAmount: Number(totalAmount),
      gstAmount: Number(gstAmount) || 0, notes: notes || null,
      costCentre: costCentre || null,
      vendorName: vendorName || null,
      vendorGstNumber: normalizedGst || (vendorGstNumber || null),
      gstValidated, gstValidationNote,
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

// ─── CLM-004 Vendor GST registry ─────────────────────────────────────────────

router.get('/vendor-gst', authenticate, authorize(...FINANCE_VIEW_ROLES), async (req, res, next) => {
  try {
    const { search } = req.query;
    const where = {};
    if (search) {
      where.OR = [
        { gstNumber:  { contains: String(search), mode: 'insensitive' } },
        { vendorName: { contains: String(search), mode: 'insensitive' } },
      ];
    }
    const rows = await prisma.vendorGstRegistration.findMany({ where, orderBy: { vendorName: 'asc' }, take: 500 });
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/vendor-gst', authenticate, authorize(...FINANCE_ADMIN_ROLES), async (req, res, next) => {
  try {
    const { gstNumber, vendorName, effectiveFrom, effectiveTo, notes } = req.body;
    if (!gstNumber || !vendorName) return res.status(400).json({ error: 'gstNumber and vendorName required' });
    const fmt = validateGstNumber(gstNumber);
    if (!fmt.valid) return res.status(400).json({ error: `Invalid GST number format: ${fmt.reason}` });
    const row = await prisma.vendorGstRegistration.create({
      data: {
        id: uuidv4(), gstNumber: fmt.normalized, vendorName,
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
        effectiveTo:   effectiveTo   ? new Date(effectiveTo)   : null,
        notes: notes || null, createdBy: req.user?.sub || null,
      },
    });
    res.status(201).json(row);
  } catch (err) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'GST number already registered' });
    next(err);
  }
});

router.put('/vendor-gst/:id', authenticate, authorize(...FINANCE_ADMIN_ROLES), async (req, res, next) => {
  try {
    const { vendorName, effectiveFrom, effectiveTo, isActive, notes } = req.body;
    const data = {};
    if (vendorName    != null) data.vendorName    = vendorName;
    if (effectiveFrom != null) data.effectiveFrom = new Date(effectiveFrom);
    if (effectiveTo   != null) data.effectiveTo   = effectiveTo === '' ? null : new Date(effectiveTo);
    if (isActive      != null) data.isActive      = isActive;
    if (notes         != null) data.notes         = notes;
    const row = await prisma.vendorGstRegistration.update({ where: { id: req.params.id }, data });
    res.json(row);
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Vendor not found' });
    next(err);
  }
});

router.delete('/vendor-gst/:id', authenticate, authorize(...FINANCE_ADMIN_ROLES), async (req, res, next) => {
  try {
    await prisma.vendorGstRegistration.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'Vendor not found' });
    next(err);
  }
});

// POST /claims/vendor-gst/validate  { gstNumber, asOfDate? }
// Surfaces the engine's match result without persisting anything — used by
// the claim-entry UI to show real-time feedback as the user types.
router.post('/vendor-gst/validate', authenticate, async (req, res, next) => {
  try {
    const { gstNumber, asOfDate } = req.body || {};
    const registry = await prisma.vendorGstRegistration.findMany({ where: { isActive: true } });
    const result = checkRegistryMatch(gstNumber, asOfDate, registry);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /claims/vendor-gst/revalidate  — re-runs validation against all PENDING/SUBMITTED
// claims with a GST number, refreshing their gstValidated + note flag. Lets Finance
// catch claims that were submitted before a vendor was added to the registry.
router.post('/vendor-gst/revalidate', authenticate, authorize(...FINANCE_ADMIN_ROLES), async (req, res, next) => {
  try {
    const [registry, claims] = await Promise.all([
      prisma.vendorGstRegistration.findMany({ where: { isActive: true } }),
      prisma.claim.findMany({ where: { vendorGstNumber: { not: null }, status: { in: ['SUBMITTED', 'APPROVED'] } } }),
    ]);
    let updated = 0;
    let nowValid = 0;
    let nowInvalid = 0;
    for (const c of claims) {
      const match = checkRegistryMatch(c.vendorGstNumber, c.claimDate, registry);
      if (match.valid !== c.gstValidated) {
        await prisma.claim.update({
          where: { id: c.id },
          data: {
            gstValidated: match.valid,
            gstValidationNote: match.valid ? `Matched ${match.vendor.vendorName}` : `Validation failed: ${match.reason}`,
            vendorGstNumber: match.normalized || c.vendorGstNumber,
          },
        });
        updated += 1;
        if (match.valid) nowValid += 1; else nowInvalid += 1;
      }
    }
    res.json({ scanned: claims.length, updated, nowValid, nowInvalid });
  } catch (err) { next(err); }
});

// ─── CLM-004 Category budgets ────────────────────────────────────────────────

router.get('/budgets', authenticate, authorize(...FINANCE_VIEW_ROLES), async (req, res, next) => {
  try {
    const { period, categoryId } = req.query;
    const where = {};
    if (period)     where.period     = period;
    if (categoryId) where.categoryId = categoryId;
    const rows = await prisma.categoryBudget.findMany({ where, orderBy: [{ period: 'desc' }, { categoryId: 'asc' }] });
    res.json(rows);
  } catch (err) { next(err); }
});

router.put('/budgets', authenticate, authorize(...FINANCE_ADMIN_ROLES), async (req, res, next) => {
  try {
    const { categoryId, period, budgetAmount, notes } = req.body;
    if (!categoryId || !period || budgetAmount == null) return res.status(400).json({ error: 'categoryId, period, budgetAmount required' });
    if (Number(budgetAmount) < 0) return res.status(400).json({ error: 'budgetAmount must be >= 0' });
    const row = await prisma.categoryBudget.upsert({
      where: { categoryId_period: { categoryId, period } },
      create: { id: uuidv4(), categoryId, period, budgetAmount: Number(budgetAmount), notes: notes || null, createdBy: req.user?.sub || null },
      update: { budgetAmount: Number(budgetAmount), notes: notes ?? undefined },
    });
    res.json(row);
  } catch (err) { next(err); }
});

// ─── CLM-004 Finance dashboard ───────────────────────────────────────────────

// GET /claims/dashboard/gst-summary?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns claimable GST totals + per-period / per-category / per-cost-centre
// breakdown for APPROVED/PAID claims in the window. Restricted to claims
// where category.isGstClaimable=true.
router.get('/dashboard/gst-summary', authenticate, authorize(...FINANCE_VIEW_ROLES), async (req, res, next) => {
  try {
    const { from, to, periodEq } = req.query;
    const where = { status: { in: ['APPROVED', 'PAID'] } };
    if (from || to) {
      where.claimDate = {};
      if (from) where.claimDate.gte = new Date(from + 'T00:00:00.000Z');
      if (to)   where.claimDate.lte = new Date(to   + 'T23:59:59.999Z');
    }
    if (periodEq) where.payrollPeriod = periodEq;
    const claims = await prisma.claim.findMany({ where, include: { category: { select: { id: true, code: true, name: true, isGstClaimable: true } } } });
    const gstClaimable = claims.filter(c => c.category?.isGstClaimable);
    const totalGst   = round2(gstClaimable.reduce((s, c) => s + Number(c.gstAmount   || 0), 0));
    const totalSpend = round2(claims.reduce((s, c) => s + Number(c.totalAmount || 0), 0));
    const validatedGst = round2(gstClaimable.filter(c => c.gstValidated).reduce((s, c) => s + Number(c.gstAmount || 0), 0));
    const unvalidatedClaims = gstClaimable.filter(c => !c.gstValidated && Number(c.gstAmount) > 0).length;
    const categoryLookup = new Map(claims.map(c => [c.categoryId, c.category]));
    res.json({
      window: { from: from || null, to: to || null, periodEq: periodEq || null },
      totals: {
        claimCount: claims.length,
        gstClaimableClaims: gstClaimable.length,
        totalSpend,
        totalGst,
        validatedGst,
        unvalidatedGst: round2(totalGst - validatedGst),
        unvalidatedClaimCount: unvalidatedClaims,
      },
      byPeriod:     aggregateGstByPeriod(gstClaimable),
      byCategory:   aggregateByCategory(gstClaimable, categoryLookup),
      byCostCentre: aggregateByCostCentre(gstClaimable),
    });
  } catch (err) { next(err); }
});

// GET /claims/dashboard/top-claimants?from=&to=&limit=10
router.get('/dashboard/top-claimants', authenticate, authorize(...FINANCE_VIEW_ROLES), async (req, res, next) => {
  try {
    const { from, to, limit = 10 } = req.query;
    const where = { status: { in: ['APPROVED', 'PAID'] } };
    if (from || to) {
      where.claimDate = {};
      if (from) where.claimDate.gte = new Date(from + 'T00:00:00.000Z');
      if (to)   where.claimDate.lte = new Date(to   + 'T23:59:59.999Z');
    }
    const claims = await prisma.claim.findMany({ where });
    const top = rankTopClaimants(claims, Number(limit) || 10);
    res.json({ count: top.length, top });
  } catch (err) { next(err); }
});

// GET /claims/dashboard/category-budget?period=YYYY-MM
// Spend-vs-budget for the period. Always includes budgeted categories with
// 0 spend; surfaces an UNBUDGETED row for any unbudgeted spend in the period.
router.get('/dashboard/category-budget', authenticate, authorize(...FINANCE_VIEW_ROLES), async (req, res, next) => {
  try {
    const period = req.query.period;
    if (!period) return res.status(400).json({ error: 'period query param required (YYYY-MM or YYYY)' });
    const [claims, budgets, categories] = await Promise.all([
      prisma.claim.findMany({ where: { payrollPeriod: period, status: { in: ['APPROVED', 'PAID'] } } }),
      prisma.categoryBudget.findMany({ where: { period } }),
      prisma.claimCategory.findMany({ where: { isActive: true } }),
    ]);
    const categoryLookup = new Map(categories.map(c => [c.id, c]));
    const rows = computeCategoryBudgetUtilisation(claims, budgets, categoryLookup);
    const summary = rows.reduce((acc, r) => {
      acc.budgetedCategories += r.status !== 'UNBUDGETED' ? 1 : 0;
      acc.totalBudget += r.budgetAmount;
      acc.totalSpend  += r.spent;
      if (r.status === 'BREACH')      acc.breach += 1;
      if (r.status === 'APPROACHING') acc.approaching += 1;
      if (r.status === 'UNBUDGETED' && r.spent > 0) acc.unbudgetedWithSpend += 1;
      return acc;
    }, { budgetedCategories: 0, totalBudget: 0, totalSpend: 0, breach: 0, approaching: 0, unbudgetedWithSpend: 0 });
    summary.totalBudget = round2(summary.totalBudget);
    summary.totalSpend  = round2(summary.totalSpend);
    summary.totalRemaining = round2(summary.totalBudget - summary.totalSpend);
    res.json({ period, summary, rows });
  } catch (err) { next(err); }
});

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

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
