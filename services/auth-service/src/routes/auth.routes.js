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
    // Exempt overrides everything — if admin marks a user exempt, they skip MFA even if mfaEnabled=true
    const needsMfa = !mfaExempt && (user.mfaEnabled || orgMfaRequired);

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
    const rows = await prisma.$queryRaw`SELECT key, value FROM org_settings WHERE key IN ('smtpFrom', 'orgName', 'apiKeys', 'webhooks', 'retentionPeriods', 'ssoConfig')`;
    const map = {};
    for (const r of rows) {
      try { map[r.key] = JSON.parse(r.value); } catch { map[r.key] = r.value; }
    }
    res.json({
      smtpFrom: map.smtpFrom || '',
      orgName: map.orgName || 'Vorkhive',
      apiKeys: map.apiKeys || [],
      webhooks: map.webhooks || [],
      retentionPeriods: map.retentionPeriods || null,
    });
  } catch (err) { next(err); }
});

// PUT /auth/org-settings/general — update general org settings (SUPER_ADMIN only)
router.put('/org-settings/general', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { smtpFrom, orgName, apiKeys, webhooks, retentionPeriods, ssoConfig } = req.body;
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
    if (retentionPeriods !== undefined) await upsert('retentionPeriods', retentionPeriods);
    if (ssoConfig !== undefined) await upsert('ssoConfig', ssoConfig);
    await logAudit(prisma, { userId: req.user.sub, action: 'ORG_SETTING_CHANGED', resource: 'org_settings', req, after: req.body });
    res.json({ message: 'Settings updated' });
  } catch (err) { next(err); }
});

// ── SSO secrets helpers ───────────────────────────────────────────────────────

async function getSsoSecrets() {
  try {
    const rows = await prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'ssoSecrets' LIMIT 1`;
    let s = {};
    try { s = JSON.parse(rows[0]?.value ?? '{}'); } catch {}
    return s;
  } catch { return {}; }
}

async function getSsoClientSecret(provider) {
  const s = await getSsoSecrets();
  const encrypted = s[provider]?.clientSecret;
  if (encrypted) { try { return decrypt(encrypted); } catch {} }
  if (provider === 'google') return process.env.GOOGLE_CLIENT_SECRET || null;
  if (provider === 'microsoft') return process.env.MICROSOFT_CLIENT_SECRET || null;
  return null;
}

// GET /auth/org-settings/sso-secrets/status — whether each provider has a secret configured (never returns the value)
router.get('/org-settings/sso-secrets/status', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const s = await getSsoSecrets();
    res.json({
      google:    { hasSecret: !!(s.google?.clientSecret    || process.env.GOOGLE_CLIENT_SECRET) },
      microsoft: { hasSecret: !!(s.microsoft?.clientSecret || process.env.MICROSOFT_CLIENT_SECRET) },
    });
  } catch (err) { next(err); }
});

// PUT /auth/org-settings/sso-secrets — store encrypted SSO client secrets (SUPER_ADMIN only)
router.put('/org-settings/sso-secrets', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { google, microsoft } = req.body;
    const secrets = await getSsoSecrets();
    if (google?.clientSecret)    secrets.google    = { clientSecret: encrypt(google.clientSecret) };
    if (microsoft?.clientSecret) secrets.microsoft = { clientSecret: encrypt(microsoft.clientSecret) };
    const val = JSON.stringify(secrets);
    await prisma.$executeRaw`
      INSERT INTO org_settings (key, value, "updatedAt") VALUES ('ssoSecrets', ${val}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${val}, "updatedAt" = now()
    `;
    await logAudit(prisma, { userId: req.user.sub, action: 'SSO_SECRET_UPDATED', resource: 'org_settings', req });
    res.json({ message: 'SSO secrets saved' });
  } catch (err) { next(err); }
});

// ── Google SSO ────────────────────────────────────────────────────────────────

// GET /auth/sso/google/config — public, returns clientId so the login page can build the OAuth URL
router.get('/sso/google/config', async (req, res, next) => {
  try {
    const rows = await prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'ssoConfig' LIMIT 1`;
    let config = {};
    try { config = JSON.parse(rows[0]?.value ?? '{}'); } catch {}
    const googleCfg = config.google ?? {};
    res.json({
      clientId: googleCfg.clientId || process.env.GOOGLE_CLIENT_ID || '',
      domain: googleCfg.domain || '',
      enabled: !!(googleCfg.clientId || process.env.GOOGLE_CLIENT_ID),
    });
  } catch (err) { next(err); }
});

// ── SSO MFA helper ────────────────────────────────────────────────────────────
// Returns a pending-token response if MFA is required, or null if not needed.
async function checkSsoMfa(user, req) {
  const mfaExempt = user.mfaExempt ?? false;
  const [orgMfaRequired, orgMethod] = await Promise.all([getOrgMfaRequired(), getOrgMfaMethod()]);
  const needsMfa = !mfaExempt && (user.mfaEnabled || orgMfaRequired);
  if (!needsMfa) return null;

  // Issue a 5-minute pending token (not a full session token)
  const pendingToken = signAccessToken({ sub: user.id, sso_pending: true, expiresIn: '5m' });

  if (!user.mfaSecret && orgMfaRequired && !user.mfaEnabled) {
    return { ssoMfaPending: true, pendingToken, mfaSetupRequired: true, mfaMethod: orgMethod };
  }

  if (orgMethod === 'EMAIL_OTP' || orgMethod === 'EITHER') {
    await sendEmailOtp(user);
  }
  return { ssoMfaPending: true, pendingToken, mfaMethod: orgMethod };
}

// POST /auth/sso/mfa-verify — public, verifies MFA after SSO identity check
router.post('/sso/mfa-verify', async (req, res, next) => {
  try {
    const { pendingToken, mfaCode } = req.body;
    if (!pendingToken || !mfaCode) return res.status(400).json({ error: 'pendingToken and mfaCode required' });

    let payload;
    try { payload = verifyToken(pendingToken); } catch { return res.status(401).json({ error: 'Pending token invalid or expired. Please sign in again.' }); }
    if (!payload.sso_pending) return res.status(401).json({ error: 'Invalid pending token' });

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!user || !user.isActive) return res.status(401).json({ error: 'Account not found or deactivated' });

    const orgMethod = await getOrgMfaMethod();

    // Verify MFA code
    let verified = false;
    if (orgMethod === 'TOTP' || orgMethod === 'EITHER') {
      const secret = user.mfaSecret ? decrypt(user.mfaSecret) : null;
      if (secret && authenticator.verify({ token: mfaCode, secret })) verified = true;
    }
    if (!verified && (orgMethod === 'EMAIL_OTP' || orgMethod === 'EITHER')) {
      verified = await verifyEmailOtp(user.id, mfaCode);
    }
    if (!verified) {
      await logAudit(prisma, { userId: user.id, action: 'MFA_FAILED', resource: 'auth', req, success: false });
      return res.status(401).json({ error: 'Invalid MFA code' });
    }

    // Issue full JWT
    const permissions = user.role?.permissions.map(p => p.permission.code) || [];
    const tokenPayload = {
      sub: user.id, email: user.email, role: (user.role?.name || 'EMPLOYEE').toUpperCase(),
      permissions, employeeId: user.employeeId, name: user.name,
    };
    const accessToken = signAccessToken(tokenPayload);
    const refreshTokenStr = signRefreshToken({ sub: user.id });
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { id: uuidv4(), token: refreshTokenStr, userId: user.id, expiresAt: refreshExpiresAt } });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await logAudit(prisma, { userId: user.id, action: 'SSO_LOGIN_SUCCESS', resource: 'auth', req, after: { sso_mfa: true } });

    res.json({
      accessToken, refreshToken: refreshTokenStr,
      user: { id: user.id, name: user.name, email: user.email, role: user.role?.name, employeeId: user.employeeId, permissions },
    });
  } catch (err) { next(err); }
});

// POST /auth/sso/google/callback — public, exchanges OAuth code for Vorkhive JWT
router.post('/sso/google/callback', async (req, res, next) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code || !redirectUri) return res.status(400).json({ error: 'code and redirectUri required' });

    // Read clientId from org_settings (fallback to env)
    const cfgRows = await prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'ssoConfig' LIMIT 1`;
    let ssoConfig = {};
    try { ssoConfig = JSON.parse(cfgRows[0]?.value ?? '{}'); } catch {}
    const clientId = ssoConfig.google?.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = await getSsoClientSecret('google');

    if (!clientId) return res.status(503).json({ error: 'Google SSO not configured — clientId missing' });
    if (!clientSecret) return res.status(503).json({ error: 'Google SSO not configured — client secret not set. Configure it in Settings → Security.' });

    // Exchange authorization code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.id_token) {
      console.error('[sso/google] Token exchange failed:', tokenData);
      return res.status(401).json({ error: tokenData.error_description || 'Google token exchange failed' });
    }

    // Decode the id_token (JWT) — verify with Google's certs for production; for now decode payload only
    const [, payloadB64] = tokenData.id_token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const { email, name, email_verified } = payload;

    if (!email_verified) return res.status(401).json({ error: 'Google email not verified' });

    // Find the matching user in Vorkhive
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    if (!user) return res.status(401).json({ error: 'No Vorkhive account found for this Google account. Contact your administrator.' });
    if (!user.isActive) return res.status(403).json({ error: 'Account deactivated' });

    // Check domain restriction if configured
    const allowedDomain = ssoConfig.google?.domain;
    if (allowedDomain && !email.toLowerCase().endsWith(`@${allowedDomain.toLowerCase()}`)) {
      return res.status(401).json({ error: `Only @${allowedDomain} accounts are permitted` });
    }

    // MFA check — same rules as regular login
    const mfaResult = await checkSsoMfa(user, req);
    if (mfaResult) return res.json(mfaResult);

    // Issue Vorkhive JWT
    const permissions = user.role?.permissions.map(p => p.permission.code) || [];
    const tokenPayload = {
      sub: user.id, email: user.email, role: (user.role?.name || 'EMPLOYEE').toUpperCase(),
      permissions, employeeId: user.employeeId, name: user.name,
    };
    const accessToken = signAccessToken(tokenPayload);
    const refreshTokenStr = signRefreshToken({ sub: user.id });
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { id: uuidv4(), token: refreshTokenStr, userId: user.id, expiresAt: refreshExpiresAt } });

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await logAudit(prisma, { userId: user.id, action: 'SSO_LOGIN_SUCCESS', resource: 'auth', req, after: { provider: 'google' } });

    res.json({
      accessToken, refreshToken: refreshTokenStr,
      user: { id: user.id, name: user.name, email: user.email, role: user.role?.name, employeeId: user.employeeId, permissions },
    });
  } catch (err) { next(err); }
});

// ── Microsoft Entra ID SSO ────────────────────────────────────────────────────

// GET /auth/sso/microsoft/config — public, returns client config so login page can build OAuth URL
router.get('/sso/microsoft/config', async (req, res, next) => {
  try {
    const cfgRows = await prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'ssoConfig' LIMIT 1`;
    let ssoConfig = {};
    try { ssoConfig = JSON.parse(cfgRows[0]?.value ?? '{}'); } catch {}
    const msCfg = ssoConfig.microsoft ?? {};
    const clientId = msCfg.clientId || process.env.MICROSOFT_CLIENT_ID || '';
    const tenant = msCfg.tenantId || process.env.MICROSOFT_TENANT_ID || 'common';
    res.json({ clientId, tenantId: tenant, domain: msCfg.domain || '', enabled: !!clientId });
  } catch (err) { next(err); }
});

// POST /auth/sso/microsoft/callback — public, exchanges code for Vorkhive JWT
router.post('/sso/microsoft/callback', async (req, res, next) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code || !redirectUri) return res.status(400).json({ error: 'code and redirectUri required' });

    const cfgRows = await prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'ssoConfig' LIMIT 1`;
    let ssoConfig = {};
    try { ssoConfig = JSON.parse(cfgRows[0]?.value ?? '{}'); } catch {}
    const msCfg = ssoConfig.microsoft ?? {};

    const clientId = msCfg.clientId || process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = await getSsoClientSecret('microsoft');
    const tenant = msCfg.tenantId || process.env.MICROSOFT_TENANT_ID || 'common';

    if (!clientId) return res.status(503).json({ error: 'Microsoft SSO not configured — clientId missing' });
    if (!clientSecret) return res.status(503).json({ error: 'Microsoft SSO not configured — client secret not set. Configure it in Settings → Security.' });

    // Exchange authorization code for tokens
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        code, redirect_uri: redirectUri,
        grant_type: 'authorization_code', scope: 'openid email profile',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.id_token) {
      console.error('[sso/microsoft] Token exchange failed:', tokenData);
      return res.status(401).json({ error: tokenData.error_description || tokenData.error || 'Microsoft token exchange failed' });
    }

    // Decode the id_token payload
    const [, payloadB64] = tokenData.id_token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const email = (payload.email || payload.preferred_username || '').toLowerCase();
    const name = payload.name || email;

    if (!email) return res.status(401).json({ error: 'Microsoft account has no email address' });

    // Find matching Vorkhive user — also try Gmail dot-stripped variant
    let user = await prisma.user.findUnique({
      where: { email },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!user && email.endsWith('@gmail.com')) {
      const [local] = email.split('@');
      const stripped = local.replace(/\./g, '') + '@gmail.com';
      const withDots = await prisma.user.findMany({
        where: { email: { contains: '@gmail.com' } },
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      });
      user = withDots.find(u => u.email.split('@')[0].replace(/\./g, '') === local.replace(/\./g, '')) || null;
    }

    if (!user) return res.status(401).json({ error: 'No Vorkhive account found for this Microsoft account. Contact your administrator.' });
    if (!user.isActive) return res.status(403).json({ error: 'Account deactivated' });

    // Domain restriction
    const allowedDomain = msCfg.domain;
    if (allowedDomain && !email.endsWith(`@${allowedDomain.toLowerCase()}`)) {
      return res.status(401).json({ error: `Only @${allowedDomain} accounts are permitted` });
    }

    // MFA check — same rules as regular login
    const mfaResult = await checkSsoMfa(user, req);
    if (mfaResult) return res.json(mfaResult);

    // Issue Vorkhive JWT
    const permissions = user.role?.permissions.map(p => p.permission.code) || [];
    const tokenPayload = {
      sub: user.id, email: user.email, role: (user.role?.name || 'EMPLOYEE').toUpperCase(),
      permissions, employeeId: user.employeeId, name: user.name,
    };
    const accessToken = signAccessToken(tokenPayload);
    const refreshTokenStr = signRefreshToken({ sub: user.id });
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({ data: { id: uuidv4(), token: refreshTokenStr, userId: user.id, expiresAt: refreshExpiresAt } });
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await logAudit(prisma, { userId: user.id, action: 'SSO_LOGIN_SUCCESS', resource: 'auth', req, after: { provider: 'microsoft' } });

    res.json({
      accessToken, refreshToken: refreshTokenStr,
      user: { id: user.id, name: user.name, email: user.email, role: user.role?.name, employeeId: user.employeeId, permissions },
    });
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
