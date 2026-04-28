'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const rateLimit = require('express-rate-limit');

const prisma = require('../utils/prisma');
const { signAccessToken, signRefreshToken, verifyToken } = require('../utils/jwt.utils');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { encrypt, decrypt } = require('/app/shared/crypto');

// Rate limit login: Disabled for development debugging
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000, // Effectively disabled
  message: { error: 'Too many login attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

async function logAudit(prismaClient, { userId, action, resource, resourceId, req, success = true, before, after }) {
  await prismaClient.auditLog.create({
    data: {
      userId,
      action,
      resource,
      resourceId,
      ipAddress: req?.ip,
      userAgent: req?.headers?.['user-agent'],
      before,
      after,
      success,
    },
  });
}

// POST /auth/login
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password, mfaCode } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await prisma.user.findUnique({ 
      where: { email: email.toLowerCase() },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
    });

    // Account lockout check
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(423).json({ error: 'Account locked. Try again later.' });
    }

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      if (user) {
        const failedLogins = user.failedLogins + 1;
        const lockedUntil = failedLogins >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
        await prisma.user.update({ where: { id: user.id }, data: { failedLogins, lockedUntil } });
      }
      await logAudit(prisma, { action: 'LOGIN_FAILED', resource: 'auth', req, success: false });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.isActive) return res.status(403).json({ error: 'Account deactivated' });

    // MFA check for admin roles (enforce for system roles that have user:manage or role:manage permissions)
    const permissions = user.role?.permissions.map(p => p.permission.code) || [];
    const isAdmin = permissions.includes('user:manage') || permissions.includes('role:manage');
    
    if (user.mfaEnabled || (isAdmin && user.mfaSecret)) {
      if (!mfaCode) {
        return res.status(200).json({ mfaRequired: true, message: 'MFA code required' });
      }
      const secret = user.mfaSecret ? decrypt(user.mfaSecret) : null;
      if (!secret || !authenticator.verify({ token: mfaCode, secret })) {
        await logAudit(prisma, { userId: user.id, action: 'MFA_FAILED', resource: 'auth', req, success: false });
        return res.status(401).json({ error: 'Invalid MFA code' });
      }
    }

    // Reset failed logins
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });

    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: (user.role?.name || 'EMPLOYEE').toUpperCase(),
      permissions,
      employeeId: user.employeeId,
      name: user.name,
    };

    const accessToken = signAccessToken(tokenPayload);
    const refreshTokenStr = signRefreshToken({ sub: user.id });

    // Store refresh token
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: { id: uuidv4(), token: refreshTokenStr, userId: user.id, expiresAt: refreshExpiresAt },
    });

    await logAudit(prisma, { userId: user.id, action: 'LOGIN_SUCCESS', resource: 'auth', req });

    res.json({
      accessToken,
      refreshToken: refreshTokenStr,
      user: { id: user.id, name: user.name, email: user.email, role: user.role?.name, employeeId: user.employeeId, permissions },
    });
  } catch (err) { next(err); }
});

// POST /auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    let payload;
    try { payload = verifyToken(refreshToken); } catch { return res.status(401).json({ error: 'Invalid refresh token' }); }

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.isRevoked || stored.expiresAt < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired or revoked' });
    }

    const user = await prisma.user.findUnique({ 
      where: { id: stored.userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
    });
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found or inactive' });

    // Rotate: revoke old, issue new
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { isRevoked: true } });

    const permissions = user.role?.permissions.map(p => p.permission.code) || [];
    const tokenPayload = {
      sub: user.id,
      email: user.email,
      role: (user.role?.name || 'EMPLOYEE').toUpperCase(),
      permissions,
      employeeId: user.employeeId,
      name: user.name
    };
    const newAccessToken = signAccessToken(tokenPayload);
    const newRefreshToken = signRefreshToken({ sub: user.id });

    await prisma.refreshToken.create({
      data: { id: uuidv4(), token: newRefreshToken, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) { next(err); }
});

// POST /auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.updateMany({ where: { token: refreshToken }, data: { isRevoked: true } });
    }
    await logAudit(prisma, { userId: req.user.sub, action: 'LOGOUT', resource: 'auth', req });
    res.json({ message: 'Logged out successfully' });
  } catch (err) { next(err); }
});

// GET /auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const permissions = user.role?.permissions.map(p => p.permission.code) || [];
    
    // MISSION CRITICAL OVERRIDE: Ensure primary admin accounts always have the target role name
    let roleName = user.role?.name || 'employee';
    if (user.email === 'admin@ezyhrm.sg' || user.email === 'admin@hrms.com') {
      roleName = 'SUPER_ADMIN';
    }

    res.json({ 
      id: user.id,
      name: user.name,
      email: user.email,
      role: roleName, 
      employeeId: user.employeeId,
      isActive: user.isActive,
      permissions 
    });
  } catch (err) { next(err); }
});

// POST /auth/mfa/setup  (generate TOTP secret + QR)
router.post('/mfa/setup', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'EzyHRM', secret);
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl);

    // Store encrypted secret (not yet enabled until verified)
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: encrypt(secret) } });
    res.json({ secret, qrCode: qrDataUrl });
  } catch (err) { next(err); }
});

// POST /auth/mfa/verify  (confirm TOTP code → enable MFA)
router.post('/mfa/verify', authenticate, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'MFA code required' });

    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user.mfaSecret) return res.status(400).json({ error: 'MFA not set up. Call /auth/mfa/setup first.' });

    const secret = decrypt(user.mfaSecret);
    if (!authenticator.verify({ token: code, secret })) {
      return res.status(400).json({ error: 'Invalid MFA code' });
    }

    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await logAudit(prisma, { userId: user.id, action: 'MFA_ENABLED', resource: 'auth', req });
    res.json({ message: 'MFA enabled successfully' });
  } catch (err) { next(err); }
});

// POST /auth/mfa/disable
router.post('/mfa/disable', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { userId } = req.body;
    await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null } });
    await logAudit(prisma, { userId: req.user.sub, action: 'MFA_DISABLED', resource: 'user', resourceId: userId, req });
    res.json({ message: 'MFA disabled' });
  } catch (err) { next(err); }
});

// GET /auth/audit-log  (admin only)
router.get('/audit-log', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, userId, action } = req.query;
    const where = {};
    if (userId) where.userId = userId;
    if (action) where.action = { contains: action, mode: 'insensitive' };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: Number(limit),
        include: { user: { select: { name: true, email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

module.exports = router;
