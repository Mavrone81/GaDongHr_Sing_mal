'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

// GET /users  (admin: list all users)
router.get('/', authenticate, authorize('user:manage'), async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, isActive } = req.query;
    const where = {};
    if (role) where.role = role.toUpperCase();
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: { role: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: Number(limit),
      }),
      prisma.user.count({ where }),
    ]);

    // Format for response to keep contract
    const formattedUsers = users.map(u => ({ ...u, role: u.role?.name }));
    res.json({ users: formattedUsers, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

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

// POST /users  (create user — admin or internal)
router.post('/', checkInternal, (req, res, next) => {
  if (req.isInternal) return next();
  authenticate(req, res, () => {
    authorize('user:manage')(req, res, next);
  });
}, async (req, res, next) => {
  try {
    const { email, password, name, role, employeeId } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'email, password, name are required' });

    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const targetRole = await prisma.role.findFirst({
      where: { name: { equals: role || 'EMPLOYEE', mode: 'insensitive' } }
    });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        email: email.toLowerCase(),
        passwordHash,
        name,
        roleId: targetRole?.id,
        employeeId,
      },
      include: { role: true },
    });
    res.status(201).json({ ...user, role: user.role?.name });
  } catch (err) { next(err); }
});

// PUT /users/:id  (update user)
router.put('/:id', authenticate, authorize('user:manage'), async (req, res, next) => {
  try {
    const { name, role, isActive } = req.body;
    let roleId = undefined;
    
    if (role) {
      const targetRole = await prisma.role.findFirst({
        where: { name: { equals: role, mode: 'insensitive' } }
      });
      roleId = targetRole?.id;
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { 
        ...(name && { name }), 
        ...(roleId && { roleId }), 
        ...(isActive !== undefined && { isActive }) 
      },
      include: { role: true },
    });
    res.json({ ...user, role: user.role?.name });
  } catch (err) { next(err); }
});

// POST /users/:id/reset-password
router.post('/:id/reset-password', authenticate, authorize('user:manage'), async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash, failedLogins: 0, lockedUntil: null } });
    // Revoke all refresh tokens
    await prisma.refreshToken.updateMany({ where: { userId: req.params.id }, data: { isRevoked: true } });
    res.json({ message: 'Password reset. All sessions invalidated.' });
  } catch (err) { next(err); }
});

module.exports = router;
