'use strict';
// AST-001 + AST-003 asset routes.

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN];

// ── GET /assets ───────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { category, status, page = 1, limit = 100 } = req.query;
    const where = {};
    if (category) where.category = category;
    if (status) where.status = status.toUpperCase();

    const [assets, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        include: { assignments: { where: { isActive: true }, orderBy: { assignedAt: 'desc' }, take: 1 } },
      }),
      prisma.asset.count({ where }),
    ]);
    res.json({ assets, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
});

// ── POST /assets ──────────────────────────────────────────────────────────────
router.post('/', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { name, category, serialNumber, purchaseDate, purchaseValue, currentValue, location, notes,
      warrantyExpiry, nextMaintenanceAt, maintenanceIntervalDays, contractEndDate } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'name and category are required' });

    const count = await prisma.asset.count();
    const assetCode = `AST-${String(count + 1).padStart(3, '0')}`;

    const asset = await prisma.asset.create({
      data: {
        id: uuidv4(), assetCode, name, category,
        serialNumber: serialNumber || null,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
        purchaseValue: parseFloat(purchaseValue) || 0,
        currentValue: parseFloat(currentValue) || parseFloat(purchaseValue) || 0,
        location: location || null,
        notes: notes || null,
        warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : null,
        nextMaintenanceAt: nextMaintenanceAt ? new Date(nextMaintenanceAt) : null,
        maintenanceIntervalDays: maintenanceIntervalDays != null ? parseInt(maintenanceIntervalDays, 10) : null,
        contractEndDate: contractEndDate ? new Date(contractEndDate) : null,
        status: 'AVAILABLE',
      },
    });
    res.status(201).json(asset);
  } catch (err) { next(err); }
});

// ── PUT /assets/:id ───────────────────────────────────────────────────────────
router.put('/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const b = req.body;
    const data = {};
    const passthrough = ['name', 'category', 'serialNumber', 'location', 'notes', 'status'];
    for (const k of passthrough) if (b[k] !== undefined) data[k] = b[k];
    if (b.purchaseDate !== undefined) data.purchaseDate = b.purchaseDate ? new Date(b.purchaseDate) : null;
    if (b.purchaseValue !== undefined) data.purchaseValue = parseFloat(b.purchaseValue);
    if (b.currentValue !== undefined) data.currentValue = parseFloat(b.currentValue);
    if (b.warrantyExpiry !== undefined) data.warrantyExpiry = b.warrantyExpiry ? new Date(b.warrantyExpiry) : null;
    if (b.nextMaintenanceAt !== undefined) data.nextMaintenanceAt = b.nextMaintenanceAt ? new Date(b.nextMaintenanceAt) : null;
    if (b.maintenanceIntervalDays !== undefined) data.maintenanceIntervalDays = b.maintenanceIntervalDays != null ? parseInt(b.maintenanceIntervalDays, 10) : null;
    if (b.contractEndDate !== undefined) data.contractEndDate = b.contractEndDate ? new Date(b.contractEndDate) : null;
    const asset = await prisma.asset.update({ where: { id: req.params.id }, data });
    res.json(asset);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Asset not found' });
    next(err);
  }
});

// ── DELETE /assets/:id ────────────────────────────────────────────────────────
router.delete('/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    await prisma.asset.update({ where: { id: req.params.id }, data: { status: 'RETIRED' } });
    res.json({ message: 'Asset retired' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Asset not found' });
    next(err);
  }
});

// ── POST /assets/:id/assign ───────────────────────────────────────────────────
router.post('/:id/assign', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { employeeId, notes, offboardingDate } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });

    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (asset.status !== 'AVAILABLE') return res.status(400).json({ error: `Asset is not available (current status: ${asset.status})` });

    const [assignment] = await prisma.$transaction([
      prisma.assetAssignment.create({
        data: {
          id: uuidv4(),
          assetId: req.params.id,
          employeeId,
          notes: notes || null,
          offboardingDate: offboardingDate ? new Date(offboardingDate) : null,
        },
      }),
      prisma.asset.update({ where: { id: req.params.id }, data: { status: 'ASSIGNED' } }),
    ]);
    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

// ── POST /assets/:id/return ───────────────────────────────────────────────────
router.post('/:id/return', authenticate, authorize(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { notes, status = 'AVAILABLE' } = req.body;
    const active = await prisma.assetAssignment.findFirst({ where: { assetId: req.params.id, isActive: true } });
    if (!active) return res.status(400).json({ error: 'No active assignment found for this asset' });

    await prisma.$transaction([
      prisma.assetAssignment.update({
        where: { id: active.id },
        data: { isActive: false, returnedAt: new Date(), notes: notes || active.notes },
      }),
      prisma.asset.update({ where: { id: req.params.id }, data: { status } }),
    ]);
    res.json({ message: 'Asset returned' });
  } catch (err) { next(err); }
});

// ── GET /assets/employee/:employeeId ─────────────────────────────────────────
router.get('/employee/:employeeId', authenticate, async (req, res, next) => {
  try {
    const assignments = await prisma.assetAssignment.findMany({
      where: { employeeId: req.params.employeeId, isActive: true },
      include: { asset: true },
      orderBy: { assignedAt: 'desc' },
    });
    res.json(assignments.map(a => ({ ...a.asset, assignedAt: a.assignedAt, assignmentId: a.id, notes: a.notes })));
  } catch (err) { next(err); }
});

// ── GET /assets/:id/history ───────────────────────────────────────────────────
router.get('/:id/history', authenticate, async (req, res, next) => {
  try {
    const history = await prisma.assetAssignment.findMany({
      where: { assetId: req.params.id },
      orderBy: { assignedAt: 'desc' },
    });
    res.json(history);
  } catch (err) { next(err); }
});

module.exports = router;
