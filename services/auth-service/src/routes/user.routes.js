'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

// GET /users  (admin: list all users)
router.get('/', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, isActive } = req.query;
    const where = {};
    if (role) where.role = role.toUpperCase();
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, role: true, employeeId: true, isActive: true, mfaEnabled: true, lastLoginAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: Number(limit),
      }),
      prisma.user.count({ where }),
    ]);
    res.json({ users, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// POST /users  (create user — admin only)
router.post('/', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { email, password, name, role, employeeId } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'email, password, name are required' });

    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        email: email.toLowerCase(),
        passwordHash,
        name,
        role: (role || 'EMPLOYEE').toUpperCase(),
        employeeId,
      },
      select: { id: true, email: true, name: true, role: true, employeeId: true, createdAt: true },
    });
    res.status(201).json(user);
  } catch (err) { next(err); }
});

// PUT /users/:id  (update user)
router.put('/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { name, role, isActive } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...(name && { name }), ...(role && { role: role.toUpperCase() }), ...(isActive !== undefined && { isActive }) },
      select: { id: true, email: true, name: true, role: true, isActive: true, employeeId: true },
    });
    res.json(user);
  } catch (err) { next(err); }
});

// POST /users/:id/reset-password
router.post('/:id/reset-password', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
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
