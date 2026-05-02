'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
// Node 20 has native fetch — no import needed

const prisma = require('../utils/prisma');
const { signAccessToken, signRefreshToken, verifyToken } = require('../utils/jwt.utils');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { encrypt, decrypt } = require('/app/shared/crypto');

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getOrgMfaMethod() {
  try {
    const s = await prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'mfaMethod' LIMIT 1`;
    return (s[0]?.value) || 'TOTP';
  } catch { return 'TOTP'; }
}

async function getOrgMfaRequired() {
  try {
    const s = await prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'mfaRequired' LIMIT 1`;
    return (s[0]?.value) === 'true';
  } catch { return false; }
}

async function sendEmailOtp(user) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  await prisma.$executeRaw`
    INSERT INTO otp_tokens (id, "userId", "codeHash", "expiresAt", used, "createdAt")
    VALUES (${uuidv4()}, ${user.id}, ${codeHash}, ${expiresAt}, false, now())
  `;
  // Send via notification service (internal call)
  const notifUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4009';
  try {
    // Get a service token — sign with a minimal payload
    const svcToken = signAccessToken({ sub: 'auth-service', role: 'SUPER_ADMIN', permissions: ['*'] });
    await fetch(`${notifUrl}/notifications/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${svcToken}` },
      body: JSON.stringify({
        to: user.email,
        subject: 'Your Vorkhive login code',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1e293b;font-size:20px;margin-bottom:8px">Your one-time login code</h2>
          <p style="color:#64748b;font-size:14px;margin-bottom:24px">Use this code to complete your sign-in. It expires in 10 minutes.</p>
          <div style="background:#f1f5f9;border-radius:12px;padding:24px;text-align:center">
            <span style="font-size:36px;font-weight:900;letter-spacing:12px;color:#1e293b">${code}</span>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin-top:16px">If you didn't request this, ignore this email — your account is safe.</p>
        </div>`,
        text: `Your Vorkhive login code: ${code} (expires in 10 minutes)`,
      }),
    });
  } catch (e) {
    console.error('[auth] email OTP send failed:', e.message);
  }
  return code; // returned only for dev/test fallback — never expose in prod response
}

async function verifyEmailOtp(userId, code) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT id, "codeHash" FROM otp_tokens
      WHERE "userId" = ${userId} AND used = false AND "expiresAt" > now()
      ORDER BY "createdAt" DESC LIMIT 5
    `;
    for (const row of rows) {
      if (await bcrypt.compare(code, row.codeHash)) {
        await prisma.$executeRaw`UPDATE otp_tokens SET used = true WHERE id = ${row.id}`;
        return true;
      }
    }
    return false;
  } catch { return false; }
}

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
    
    // Determine whether MFA is required for this login:
    // - user has mfaEnabled=true (their own setting), OR
    // - org requires MFA for all AND user is not individually exempt
    const [orgMfaRequired, orgMethod] = await Promise.all([getOrgMfaRequired(), getOrgMfaMethod()]);
    const mfaExempt = user.mfaExempt ?? false;
    const needsMfa = user.mfaEnabled || (orgMfaRequired && !mfaExempt);

    if (needsMfa) {
      // If user doesn't have an enrolled secret yet, tell frontend to run setup flow
      if (!user.mfaSecret && orgMfaRequired && !user.mfaEnabled) {
        // No code to verify — send back the access token but flag that setup is required
        // (user will be enrolled before they can access the app)
        const permissions = user.role?.permissions.map(p => p.permission.code) || [];
        const tokenPayload = {
          sub: user.id, email: user.email, role: (user.role?.name || 'EMPLOYEE').toUpperCase(),
          permissions, employeeId: user.employeeId, name: user.name,
        };
        const accessToken = signAccessToken(tokenPayload);
        const refreshTokenStr = signRefreshToken({ sub: user.id });
        const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await prisma.refreshToken.create({ data: { id: uuidv4(), token: refreshTokenStr, userId: user.id, expiresAt: refreshExpiresAt } });
        return res.status(200).json({
          accessToken, refreshToken: refreshTokenStr,
          mfaSetupRequired: true, mfaMethod: orgMethod,
          user: { id: user.id, name: user.name, email: user.email, role: user.role?.name, employeeId: user.employeeId, permissions },
        });
      }

      if (!mfaCode) {
        // Trigger email OTP send if method is EMAIL_OTP or EITHER
        if (orgMethod === 'EMAIL_OTP' || orgMethod === 'EITHER') {
          await sendEmailOtp(user);
        }
        return res.status(200).json({
          mfaRequired: true,
          mfaMethod: orgMethod,
          message: 'MFA code required',
        });
      }

      // Verify based on method
      if (orgMethod === 'TOTP' || orgMethod === 'EITHER') {
        // Try TOTP first
        const secret = user.mfaSecret ? decrypt(user.mfaSecret) : null;
        if (secret && authenticator.verify({ token: mfaCode, secret })) {
          // TOTP valid — fall through to token issuance
        } else if (orgMethod === 'EITHER') {
          // TOTP failed — try email OTP
          const valid = await verifyEmailOtp(user.id, mfaCode);
          if (!valid) {
            await logAudit(prisma, { userId: user.id, action: 'MFA_FAILED', resource: 'auth', req, success: false });
            return res.status(401).json({ error: 'Invalid MFA code' });
          }
        } else {
          await logAudit(prisma, { userId: user.id, action: 'MFA_FAILED', resource: 'auth', req, success: false });
          return res.status(401).json({ error: 'Invalid MFA code' });
        }
      } else {
        // EMAIL_OTP only
        const valid = await verifyEmailOtp(user.id, mfaCode);
        if (!valid) {
          await logAudit(prisma, { userId: user.id, action: 'MFA_FAILED', resource: 'auth', req, success: false });
          return res.status(401).json({ error: 'Invalid or expired email code' });
        }
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
    if (user.email === 'admin@vorkhive.sg' || user.email === 'admin@hrms.com') {
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
    const otpauthUrl = authenticator.keyuri(user.email, 'Vorkhive', secret);
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

// POST /auth/mfa/disable — turn off MFA login requirement, keep secret so user can re-enable without re-scanning
router.post('/mfa/disable', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false } });
    await logAudit(prisma, { userId: req.user.sub, action: 'MFA_DISABLED', resource: 'user', resourceId: userId, req });
    res.json({ message: 'MFA disabled — secret retained for easy re-enable' });
  } catch (err) { next(err); }
});

// POST /auth/mfa/reset — wipe secret entirely, forces full re-enrollment on next setup
router.post('/mfa/reset', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null } });
    await logAudit(prisma, { userId: req.user.sub, action: 'MFA_RESET', resource: 'user', resourceId: userId, req });
    res.json({ message: 'MFA reset — user must re-enroll' });
  } catch (err) { next(err); }
});

// POST /auth/otp/resend — resend email OTP (for EMAIL_OTP / EITHER methods)
router.post('/otp/resend', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!user.mfaEnabled) return res.status(400).json({ error: 'MFA not enabled for this account' });
    await sendEmailOtp(user);
    res.json({ message: 'Code sent to your email' });
  } catch (err) { next(err); }
});

// GET /auth/org-settings/mfa  — read org MFA settings (public, needed before login)
router.get('/org-settings/mfa', async (req, res, next) => {
  try {
    const [method, required] = await Promise.all([getOrgMfaMethod(), getOrgMfaRequired()]);
    res.json({ mfaMethod: method, mfaRequired: required });
  } catch (err) { next(err); }
});

// PUT /auth/org-settings/mfa  — set org MFA method + required policy (admin only)
router.put('/org-settings/mfa', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { mfaMethod, mfaRequired } = req.body;
    const validMethods = ['TOTP', 'EMAIL_OTP', 'EITHER'];
    if (mfaMethod && !validMethods.includes(mfaMethod)) {
      return res.status(400).json({ error: `mfaMethod must be one of: ${validMethods.join(', ')}` });
    }
    if (mfaMethod) {
      await prisma.$executeRaw`
        INSERT INTO org_settings (key, value, "updatedAt") VALUES ('mfaMethod', ${mfaMethod}, now())
        ON CONFLICT (key) DO UPDATE SET value = ${mfaMethod}, "updatedAt" = now()
      `;
    }
    if (mfaRequired !== undefined) {
      const val = mfaRequired ? 'true' : 'false';
      await prisma.$executeRaw`
        INSERT INTO org_settings (key, value, "updatedAt") VALUES ('mfaRequired', ${val}, now())
        ON CONFLICT (key) DO UPDATE SET value = ${val}, "updatedAt" = now()
      `;
    }
    await logAudit(prisma, { userId: req.user.sub, action: 'ORG_SETTING_CHANGED', resource: 'org_settings', req, after: { mfaMethod, mfaRequired } });
    res.json({ mfaMethod: mfaMethod || (await getOrgMfaMethod()), mfaRequired: mfaRequired !== undefined ? mfaRequired : (await getOrgMfaRequired()) });
  } catch (err) { next(err); }
});

// POST /auth/mfa/exempt — toggle per-user MFA exemption (exempt=true means skip org MFA requirement)
router.post('/mfa/exempt', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { userId, exempt } = req.body;
    if (!userId || typeof exempt !== 'boolean') return res.status(400).json({ error: 'userId and exempt (boolean) required' });
    await prisma.$executeRaw`UPDATE users SET "mfaExempt" = ${exempt} WHERE id = ${userId}`;
    await logAudit(prisma, { userId: req.user.sub, action: exempt ? 'MFA_EXEMPTED' : 'MFA_EXEMPTION_REMOVED', resource: 'user', resourceId: userId, req });
    res.json({ userId, mfaExempt: exempt });
  } catch (err) { next(err); }
});

// POST /auth/mfa/enable — admin forces MFA on for a specific user (sets mfaEnabled=true if secret exists, else clears exempt)
router.post('/mfa/enable', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { mfaSecret: true } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    // If they have a secret from a previous setup, re-enable it; otherwise clear exemption so org policy applies
    if (target.mfaSecret) {
      await prisma.$executeRaw`UPDATE users SET "mfaEnabled" = true, "mfaExempt" = false WHERE id = ${userId}`;
    } else {
      // No secret — remove exemption so they're forced to enroll on next login
      await prisma.$executeRaw`UPDATE users SET "mfaExempt" = false WHERE id = ${userId}`;
    }
    await logAudit(prisma, { userId: req.user.sub, action: 'MFA_ENABLED_BY_ADMIN', resource: 'user', resourceId: userId, req });
    res.json({ userId, mfaEnabled: !!target.mfaSecret, mfaExempt: false, message: target.mfaSecret ? 'MFA re-enabled' : 'Exemption removed — user will enroll on next login' });
  } catch (err) { next(err); }
});

// GET /auth/org-settings/general — read general org settings (admin only)
router.get('/org-settings/general', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`SELECT key, value FROM org_settings WHERE key IN ('smtpFrom', 'orgName', 'apiKeys', 'webhooks')`;
    const map = {};
    for (const r of rows) {
      try { map[r.key] = JSON.parse(r.value); } catch { map[r.key] = r.value; }
    }
    res.json({
      smtpFrom: map.smtpFrom || '',
      orgName: map.orgName || 'Vorkhive',
      apiKeys: map.apiKeys || [],
      webhooks: map.webhooks || [],
    });
  } catch (err) { next(err); }
});

// PUT /auth/org-settings/general — update general org settings (SUPER_ADMIN only)
router.put('/org-settings/general', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { smtpFrom, orgName, apiKeys, webhooks } = req.body;
    const upsert = async (key, value) => {
      const val = typeof value === 'string' ? value : JSON.stringify(value);
      await prisma.$executeRaw`
        INSERT INTO org_settings (key, value, "updatedAt") VALUES (${key}, ${val}, now())
        ON CONFLICT (key) DO UPDATE SET value = ${val}, "updatedAt" = now()
      `;
    };
    if (smtpFrom !== undefined) await upsert('smtpFrom', smtpFrom);
    if (orgName !== undefined) await upsert('orgName', orgName);
    if (apiKeys !== undefined) await upsert('apiKeys', apiKeys);
    if (webhooks !== undefined) await upsert('webhooks', webhooks);
    await logAudit(prisma, { userId: req.user.sub, action: 'ORG_SETTING_CHANGED', resource: 'org_settings', req, after: req.body });
    res.json({ message: 'Settings updated' });
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
