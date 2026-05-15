'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 4011;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'asset-service', status: 'ok', ts: new Date() }));

// ── GET /assets ───────────────────────────────────────────────────────────────
app.get('/assets', authenticate, async (req, res, next) => {
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
        include: {
          assignments: {
            where: { isActive: true },
            orderBy: { assignedAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.asset.count({ where }),
    ]);

    res.json({ assets, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
});

// ── POST /assets ──────────────────────────────────────────────────────────────
app.post('/assets', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { name, category, serialNumber, purchaseDate, purchaseValue, currentValue, location, notes } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'name and category are required' });

    // Auto-generate asset code
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
        status: 'AVAILABLE',
      },
    });
    res.status(201).json(asset);
  } catch (err) { next(err); }
});

// ── PUT /assets/:id ───────────────────────────────────────────────────────────
app.put('/assets/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { name, category, serialNumber, purchaseDate, purchaseValue, currentValue, status, location, notes } = req.body;
    const asset = await prisma.asset.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(category !== undefined && { category }),
        ...(serialNumber !== undefined && { serialNumber }),
        ...(purchaseDate !== undefined && { purchaseDate: purchaseDate ? new Date(purchaseDate) : null }),
        ...(purchaseValue !== undefined && { purchaseValue: parseFloat(purchaseValue) }),
        ...(currentValue !== undefined && { currentValue: parseFloat(currentValue) }),
        ...(status !== undefined && { status }),
        ...(location !== undefined && { location }),
        ...(notes !== undefined && { notes }),
      },
    });
    res.json(asset);
  } catch (err) { next(err); }
});

// ── DELETE /assets/:id — retire asset ────────────────────────────────────────
app.delete('/assets/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    await prisma.asset.update({ where: { id: req.params.id }, data: { status: 'RETIRED' } });
    res.json({ message: 'Asset retired' });
  } catch (err) { next(err); }
});

// ── POST /assets/:id/assign ───────────────────────────────────────────────────
app.post('/assets/:id/assign', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { employeeId, notes } = req.body;
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });

    const asset = await prisma.asset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (asset.status !== 'AVAILABLE') return res.status(400).json({ error: `Asset is not available (current status: ${asset.status})` });

    const [assignment] = await prisma.$transaction([
      prisma.assetAssignment.create({
        data: { id: uuidv4(), assetId: req.params.id, employeeId, notes: notes || null },
      }),
      prisma.asset.update({ where: { id: req.params.id }, data: { status: 'ASSIGNED' } }),
    ]);
    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

// ── POST /assets/:id/return ───────────────────────────────────────────────────
app.post('/assets/:id/return', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { notes, status = 'AVAILABLE' } = req.body;

    const active = await prisma.assetAssignment.findFirst({
      where: { assetId: req.params.id, isActive: true },
    });
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
app.get('/assets/employee/:employeeId', authenticate, async (req, res, next) => {
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
app.get('/assets/:id/history', authenticate, async (req, res, next) => {
  try {
    const history = await prisma.assetAssignment.findMany({
      where: { assetId: req.params.id },
      orderBy: { assignedAt: 'desc' },
    });
    res.json(history);
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });
app.listen(PORT, () => console.log(`[asset-service] Running on port ${PORT}`));
