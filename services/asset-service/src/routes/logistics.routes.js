'use strict';
// AST-002 logistics requests, inventory, stock transactions, purchase requests.

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { isLowStock, computeReorderQty, applyStockTransaction, shouldAutoCreatePr } = require('../engines/inventory.engine');

const prisma = new PrismaClient();
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN];
const LOGISTICS_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN, ROLES.HR_MANAGER];

const OPEN_PR_STATES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED'];

// Helper to auto-create a PR for an item if low-stock and none open
async function maybeAutoCreatePr(itemId, triggeredBy = 'system:low-stock') {
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) return null;
  const openCount = await prisma.purchaseRequest.count({
    where: { inventoryItemId: itemId, status: { in: OPEN_PR_STATES } },
  });
  if (!shouldAutoCreatePr(item, openCount)) return null;
  const qty = computeReorderQty(item);
  const prCount = await prisma.purchaseRequest.count();
  const prNumber = `PR-${String(prCount + 1).padStart(4, '0')}`;
  return prisma.purchaseRequest.create({
    data: {
      id: uuidv4(), prNumber, inventoryItemId: item.id,
      quantitySuggested: qty, status: 'DRAFT', triggeredBy,
      notes: `Auto-generated: current ${item.currentStock} ≤ reorder ${item.reorderPoint}`,
    },
  });
}

// ── INVENTORY ─────────────────────────────────────────────────────────────────

// GET /inventory
router.get('/inventory', authenticate, async (req, res, next) => {
  try {
    const { category, lowStock, active = 'true' } = req.query;
    const where = {};
    if (category) where.category = category;
    if (active === 'true') where.isActive = true;
    const items = await prisma.inventoryItem.findMany({ where, orderBy: { name: 'asc' } });
    const filtered = lowStock === 'true' ? items.filter(isLowStock) : items;
    res.json(filtered);
  } catch (err) { next(err); }
});

// GET /inventory/low-stock
router.get('/inventory/low-stock', authenticate, authorize(...LOGISTICS_ROLES), async (_req, res, next) => {
  try {
    const items = await prisma.inventoryItem.findMany({ where: { isActive: true } });
    res.json(items.filter(isLowStock).map(i => ({ ...i, suggestedReorderQty: computeReorderQty(i) })));
  } catch (err) { next(err); }
});

// GET /inventory/:id
router.get('/inventory/:id', authenticate, async (req, res, next) => {
  try {
    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Inventory item not found' });
    res.json({ ...item, lowStock: isLowStock(item) });
  } catch (err) { next(err); }
});

// POST /inventory
router.post('/inventory', authenticate, authorize(...LOGISTICS_ROLES), async (req, res, next) => {
  try {
    const { sku, name, category, unit, currentStock, reorderPoint, reorderQty, unitCost, location } = req.body;
    if (!sku || !name || !category) return res.status(400).json({ error: 'sku, name, category required' });
    const item = await prisma.inventoryItem.create({
      data: {
        id: uuidv4(), sku, name, category,
        unit: unit || 'EA',
        currentStock: parseInt(currentStock, 10) || 0,
        reorderPoint: parseInt(reorderPoint, 10) || 0,
        reorderQty: parseInt(reorderQty, 10) || 0,
        unitCost: parseFloat(unitCost) || 0,
        location: location || null,
      },
    });
    res.status(201).json(item);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'SKU already exists' });
    next(err);
  }
});

// PUT /inventory/:id
router.put('/inventory/:id', authenticate, authorize(...LOGISTICS_ROLES), async (req, res, next) => {
  try {
    const b = req.body;
    const data = {};
    if (b.name !== undefined) data.name = b.name;
    if (b.category !== undefined) data.category = b.category;
    if (b.unit !== undefined) data.unit = b.unit;
    if (b.reorderPoint !== undefined) data.reorderPoint = parseInt(b.reorderPoint, 10) || 0;
    if (b.reorderQty !== undefined) data.reorderQty = parseInt(b.reorderQty, 10) || 0;
    if (b.unitCost !== undefined) data.unitCost = parseFloat(b.unitCost) || 0;
    if (b.location !== undefined) data.location = b.location || null;
    if (b.isActive !== undefined) data.isActive = !!b.isActive;
    const item = await prisma.inventoryItem.update({ where: { id: req.params.id }, data });
    res.json(item);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Inventory item not found' });
    next(err);
  }
});

// DELETE /inventory/:id
router.delete('/inventory/:id', authenticate, authorize(...LOGISTICS_ROLES), async (req, res, next) => {
  try {
    await prisma.inventoryItem.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Inventory item deactivated' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Inventory item not found' });
    next(err);
  }
});

// ── STOCK TRANSACTIONS ────────────────────────────────────────────────────────

// POST /inventory/:id/transactions
router.post('/inventory/:id/transactions', authenticate, authorize(...LOGISTICS_ROLES), async (req, res, next) => {
  try {
    const { txType, quantity, reference, employeeId, notes } = req.body;
    if (!txType || quantity == null) return res.status(400).json({ error: 'txType and quantity required' });

    const item = await prisma.inventoryItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Inventory item not found' });

    let newStock;
    try {
      newStock = applyStockTransaction(item.currentStock, txType.toUpperCase(), parseInt(quantity, 10));
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const [tx, updatedItem] = await prisma.$transaction([
      prisma.stockTransaction.create({
        data: {
          id: uuidv4(),
          inventoryItemId: item.id,
          txType: txType.toUpperCase(),
          quantity: parseInt(quantity, 10),
          reference: reference || null,
          employeeId: employeeId || null,
          createdBy: req.user.sub,
          notes: notes || null,
        },
      }),
      prisma.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } }),
    ]);

    let autoPr = null;
    if (isLowStock(updatedItem)) {
      try { autoPr = await maybeAutoCreatePr(item.id); } catch {}
    }

    res.status(201).json({ transaction: tx, currentStock: newStock, autoPr });
  } catch (err) { next(err); }
});

// GET /inventory/:id/transactions
router.get('/inventory/:id/transactions', authenticate, async (req, res, next) => {
  try {
    const txs = await prisma.stockTransaction.findMany({
      where: { inventoryItemId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: parseInt(req.query.limit || 100, 10),
    });
    res.json(txs);
  } catch (err) { next(err); }
});

// ── LOGISTICS REQUESTS ────────────────────────────────────────────────────────

// POST /logistics/requests — employee submits
router.post('/logistics/requests', authenticate, async (req, res, next) => {
  try {
    const { requesterEmployeeId, lines, notes } = req.body;
    if (!requesterEmployeeId) return res.status(400).json({ error: 'requesterEmployeeId required' });
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'At least one line required' });
    for (const l of lines) {
      if (!l.inventoryItemId || !l.quantityRequested || l.quantityRequested <= 0) {
        return res.status(400).json({ error: 'Each line needs inventoryItemId and positive quantityRequested' });
      }
    }

    const reqRow = await prisma.logisticsRequest.create({
      data: {
        id: uuidv4(),
        requesterEmployeeId,
        notes: notes || null,
        lines: {
          create: lines.map(l => ({
            id: uuidv4(),
            inventoryItemId: l.inventoryItemId,
            quantityRequested: parseInt(l.quantityRequested, 10),
            notes: l.notes || null,
          })),
        },
      },
      include: { lines: { include: { inventoryItem: true } } },
    });
    res.status(201).json(reqRow);
  } catch (err) { next(err); }
});

// GET /logistics/requests
router.get('/logistics/requests', authenticate, async (req, res, next) => {
  try {
    const { status, requesterEmployeeId, mine } = req.query;
    const where = {};
    if (status) where.status = status.toUpperCase();
    if (requesterEmployeeId) where.requesterEmployeeId = requesterEmployeeId;
    if (mine === 'true') {
      const empId = req.headers['x-employee-id'] || req.user.sub;
      where.requesterEmployeeId = empId;
    }
    const rows = await prisma.logisticsRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { lines: { include: { inventoryItem: true } } },
    });
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /logistics/requests/:id
router.get('/logistics/requests/:id', authenticate, async (req, res, next) => {
  try {
    const row = await prisma.logisticsRequest.findUnique({
      where: { id: req.params.id },
      include: { lines: { include: { inventoryItem: true } } },
    });
    if (!row) return res.status(404).json({ error: 'Request not found' });
    res.json(row);
  } catch (err) { next(err); }
});

// PUT /logistics/requests/:id/approve
router.put('/logistics/requests/:id/approve', authenticate, authorize(...LOGISTICS_ROLES, ROLES.LINE_MANAGER), async (req, res, next) => {
  try {
    const row = await prisma.logisticsRequest.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Request not found' });
    if (row.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: `Cannot approve from status ${row.status}` });

    const updated = await prisma.logisticsRequest.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', approvedBy: req.user.sub, approvedAt: new Date() },
      include: { lines: true },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /logistics/requests/:id/reject
router.put('/logistics/requests/:id/reject', authenticate, authorize(...LOGISTICS_ROLES, ROLES.LINE_MANAGER), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const row = await prisma.logisticsRequest.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Request not found' });
    if (row.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: `Cannot reject from status ${row.status}` });

    const updated = await prisma.logisticsRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', approvedBy: req.user.sub, approvedAt: new Date(), rejectedReason: reason || null },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /logistics/requests/:id/fulfill
// Body: { lines: [{ id, quantityFulfilled }] }. Issues stock and decrements inventory.
router.put('/logistics/requests/:id/fulfill', authenticate, authorize(...LOGISTICS_ROLES), async (req, res, next) => {
  try {
    const { lines = [] } = req.body;
    const row = await prisma.logisticsRequest.findUnique({
      where: { id: req.params.id },
      include: { lines: { include: { inventoryItem: true } } },
    });
    if (!row) return res.status(404).json({ error: 'Request not found' });
    if (row.status !== 'APPROVED') return res.status(409).json({ error: `Cannot fulfill from status ${row.status}` });

    const updates = [];
    const stockTxs = [];

    for (const reqLine of row.lines) {
      const incoming = lines.find(l => l.id === reqLine.id);
      const qty = incoming
        ? Math.min(parseInt(incoming.quantityFulfilled, 10) || 0, reqLine.quantityRequested)
        : reqLine.quantityRequested;
      if (qty <= 0) continue;
      const item = reqLine.inventoryItem;
      let newStock;
      try {
        newStock = applyStockTransaction(item.currentStock, 'ISSUE', qty);
      } catch (e) {
        return res.status(400).json({ error: `${item.sku}: ${e.message}` });
      }
      updates.push(
        prisma.logisticsRequestLine.update({ where: { id: reqLine.id }, data: { quantityFulfilled: qty } }),
        prisma.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } }),
      );
      stockTxs.push(prisma.stockTransaction.create({
        data: {
          id: uuidv4(),
          inventoryItemId: item.id,
          txType: 'ISSUE',
          quantity: qty,
          reference: `REQ-${row.id.slice(0, 8)}`,
          employeeId: row.requesterEmployeeId,
          createdBy: req.user.sub,
        },
      }));
      // Refresh item.currentStock locally for subsequent low-stock check
      item.currentStock = newStock;
    }

    updates.push(prisma.logisticsRequest.update({
      where: { id: req.params.id },
      data: { status: 'FULFILLED', fulfilledBy: req.user.sub, fulfilledAt: new Date() },
    }));

    await prisma.$transaction([...updates, ...stockTxs]);

    // Trigger PR auto-create for any item that fell to low-stock
    const autoPrs = [];
    for (const reqLine of row.lines) {
      if (isLowStock(reqLine.inventoryItem)) {
        try {
          const pr = await maybeAutoCreatePr(reqLine.inventoryItem.id);
          if (pr) autoPrs.push(pr);
        } catch {}
      }
    }

    const fresh = await prisma.logisticsRequest.findUnique({
      where: { id: req.params.id },
      include: { lines: { include: { inventoryItem: true } } },
    });
    res.json({ ...fresh, autoPrs });
  } catch (err) { next(err); }
});

// DELETE /logistics/requests/:id — requester cancels (only while PENDING)
router.delete('/logistics/requests/:id', authenticate, async (req, res, next) => {
  try {
    const row = await prisma.logisticsRequest.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Request not found' });
    const isAdmin = LOGISTICS_ROLES.includes(req.user?.role);
    const isOwner = (req.headers['x-employee-id'] || req.user.sub) === row.requesterEmployeeId;
    if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Forbidden' });
    if (row.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: `Cannot cancel from status ${row.status}` });
    const updated = await prisma.logisticsRequest.update({ where: { id: row.id }, data: { status: 'CANCELLED' } });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── PURCHASE REQUESTS ─────────────────────────────────────────────────────────

// GET /purchase-requests
router.get('/purchase-requests', authenticate, authorize(...LOGISTICS_ROLES), async (req, res, next) => {
  try {
    const { status, inventoryItemId } = req.query;
    const where = {};
    if (status) where.status = status.toUpperCase();
    if (inventoryItemId) where.inventoryItemId = inventoryItemId;
    const rows = await prisma.purchaseRequest.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: { inventoryItem: true },
    });
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /purchase-requests — manual create
router.post('/purchase-requests', authenticate, authorize(...LOGISTICS_ROLES), async (req, res, next) => {
  try {
    const { inventoryItemId, quantitySuggested, notes } = req.body;
    if (!inventoryItemId || !quantitySuggested) return res.status(400).json({ error: 'inventoryItemId and quantitySuggested required' });
    const count = await prisma.purchaseRequest.count();
    const prNumber = `PR-${String(count + 1).padStart(4, '0')}`;
    const row = await prisma.purchaseRequest.create({
      data: {
        id: uuidv4(),
        prNumber,
        inventoryItemId,
        quantitySuggested: parseInt(quantitySuggested, 10),
        status: 'DRAFT',
        triggeredBy: req.user.sub,
        notes: notes || null,
      },
    });
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// PUT /purchase-requests/:id — status update
router.put('/purchase-requests/:id', authenticate, authorize(...LOGISTICS_ROLES), async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const data = {};
    if (status) {
      const allowed = ['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED', 'RECEIVED', 'CANCELLED'];
      if (!allowed.includes(status.toUpperCase())) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
      data.status = status.toUpperCase();
      if (data.status === 'APPROVED') { data.approvedBy = req.user.sub; data.approvedAt = new Date(); }
    }
    if (notes !== undefined) data.notes = notes || null;

    const row = await prisma.purchaseRequest.findUnique({ where: { id: req.params.id }, include: { inventoryItem: true } });
    if (!row) return res.status(404).json({ error: 'PR not found' });

    // If marking RECEIVED, also receive stock automatically
    if (data.status === 'RECEIVED' && row.status !== 'RECEIVED') {
      const item = row.inventoryItem;
      const newStock = applyStockTransaction(item.currentStock, 'RECEIVE', row.quantitySuggested);
      await prisma.$transaction([
        prisma.purchaseRequest.update({ where: { id: row.id }, data }),
        prisma.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } }),
        prisma.stockTransaction.create({
          data: {
            id: uuidv4(),
            inventoryItemId: item.id,
            txType: 'RECEIVE',
            quantity: row.quantitySuggested,
            reference: row.prNumber,
            createdBy: req.user.sub,
            notes: `Auto-received from ${row.prNumber}`,
          },
        }),
      ]);
      const updated = await prisma.purchaseRequest.findUnique({ where: { id: row.id }, include: { inventoryItem: true } });
      return res.json(updated);
    }

    const updated = await prisma.purchaseRequest.update({ where: { id: req.params.id }, data, include: { inventoryItem: true } });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'PR not found' });
    next(err);
  }
});

// POST /purchase-requests/auto-generate — sweeps low-stock items
router.post('/purchase-requests/auto-generate', authenticate, authorize(...LOGISTICS_ROLES), async (_req, res, next) => {
  try {
    const items = await prisma.inventoryItem.findMany({ where: { isActive: true } });
    const created = [];
    for (const item of items) {
      if (!isLowStock(item)) continue;
      const pr = await maybeAutoCreatePr(item.id);
      if (pr) created.push(pr);
    }
    res.json({ scanned: items.length, created: created.length, prs: created });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.maybeAutoCreatePr = maybeAutoCreatePr;
