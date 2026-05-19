'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();

const ADMIN_ROLES = new Set([ROLES.SUPER_ADMIN, ROLES.HR_ADMIN]);

function isAdmin(role) { return ADMIN_ROLES.has(role); }

// ── POST /support/tickets ─────────────────────────────────────────────────────
// Employee raises a new ticket (first message is the body)
router.post('/tickets', authenticate, async (req, res, next) => {
  try {
    const { subject, category, body, priority } = req.body;
    if (!subject || !body) return res.status(400).json({ error: 'subject and body are required' });

    const employeeId = req.user.employeeId;
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to your account' });

    const ticket = await prisma.ticket.create({
      data: {
        id: uuidv4(),
        employeeId,
        subject,
        category: (category || 'GENERAL').toUpperCase(),
        priority: (priority || 'NORMAL').toUpperCase(),
        messages: {
          create: {
            id: uuidv4(),
            authorId: req.user.sub,
            authorRole: req.user.role,
            authorName: req.user.name || req.user.email || 'Employee',
            body,
          },
        },
      },
      include: { messages: true },
    });

    res.status(201).json(ticket);
  } catch (err) { next(err); }
});

// ── GET /support/tickets/my ───────────────────────────────────────────────────
// Employee sees their own tickets
router.get('/tickets/my', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user.employeeId;
    if (!employeeId) return res.json([]);

    const { status, page = 1, limit = 20 } = req.query;
    const where = { employeeId };
    if (status) where.status = status.toUpperCase();

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.ticket.count({ where }),
    ]);

    res.json({ tickets, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
});

// ── GET /support/tickets ──────────────────────────────────────────────────────
// HR/Admin sees all tickets with optional filters
router.get('/tickets', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { status, category, priority, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status.toUpperCase();
    if (category) where.category = category.toUpperCase();
    if (priority) where.priority = priority.toUpperCase();

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { updatedAt: 'desc' }],
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.ticket.count({ where }),
    ]);

    res.json({ tickets, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
});

// ── GET /support/tickets/:id ──────────────────────────────────────────────────
// Employee (own ticket) or HR/Admin
router.get('/tickets/:id', authenticate, async (req, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Employees can only view their own tickets
    if (!isAdmin(req.user.role) && ticket.employeeId !== req.user.employeeId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(ticket);
  } catch (err) { next(err); }
});

// ── POST /support/tickets/:id/messages ───────────────────────────────────────
// Employee or HR/Admin adds a reply to a ticket thread
router.post('/tickets/:id/messages', authenticate, async (req, res, next) => {
  try {
    const { body } = req.body;
    if (!body) return res.status(400).json({ error: 'body is required' });

    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    if (!isAdmin(req.user.role) && ticket.employeeId !== req.user.employeeId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (ticket.status === 'CLOSED') {
      return res.status(400).json({ error: 'Cannot reply to a closed ticket' });
    }

    const [message] = await prisma.$transaction([
      prisma.ticketMessage.create({
        data: {
          id: uuidv4(),
          ticketId: ticket.id,
          authorId: req.user.sub,
          authorRole: req.user.role,
          authorName: req.user.name || req.user.email || req.user.role,
          body,
        },
      }),
      // Re-open if employee replies to a resolved ticket
      ...(ticket.status === 'RESOLVED' && !isAdmin(req.user.role)
        ? [prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'OPEN', updatedAt: new Date() } })]
        : [prisma.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } })]),
    ]);

    res.status(201).json(message);
  } catch (err) { next(err); }
});

// ── PUT /support/tickets/:id ──────────────────────────────────────────────────
// HR/Admin updates status and/or priority
router.put('/tickets/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { status, priority } = req.body;
    const data = { updatedAt: new Date() };
    if (status) data.status = status.toUpperCase();
    if (priority) data.priority = priority.toUpperCase();

    const ticket = await prisma.ticket.update({ where: { id: req.params.id }, data, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    res.json(ticket);
  } catch (err) { next(err); }
});

module.exports = router;
