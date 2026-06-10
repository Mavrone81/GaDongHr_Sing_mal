'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

// Invite JWTs are signed with a dedicated secret. Previously this reused
// ENCRYPTION_KEY (the AES-256-GCM data-encryption key), which meant a leak of
// either secret compromised both — and the random fallback silently
// invalidated all outstanding invites on container restart / replica scale-out.
const INVITE_SECRET = process.env.INVITE_TOKEN_SECRET;
if (!INVITE_SECRET || INVITE_SECRET.length < 32) {
  throw new Error('INVITE_TOKEN_SECRET env var is required (>=32 chars).');
}

function signInviteJwt(userId, rawToken) {
  // H-10: 7-day invite expiry (was 30 days). The DB row carries the
  // authoritative inviteExpiry too; this JWT expiry stops a stolen URL token
  // from being usable beyond a week even if the DB is briefly inconsistent.
  return jwt.sign(
    { sub: userId, jti: rawToken, purpose: 'onboard' },
    INVITE_SECRET,
    { algorithm: 'HS256', expiresIn: '7d' }
  );
}

function verifyInviteJwt(token) {
  return jwt.verify(token, INVITE_SECRET, { algorithms: ['HS256'] });
}

// GET /users  (admin: list all users)
router.get('/', authenticate, authorize('user:manage'), async (req, res, next) => {
  try {
    const { page = 1, limit = 20, role, isActive, employeeId } = req.query;
    const where = {};
    if (role) where.role = role.toUpperCase();
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (employeeId) where.employeeId = employeeId;

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

    const formattedUsers = users.map(({ passwordHash: _ph, mfaSecret: _ms, ...u }) => ({ ...u, role: u.role?.name }));
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
    const { email, password, name, role, employeeId, relink } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'email, password, name are required' });

    const exists = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    if (employeeId) {
      const empExists = await prisma.user.findUnique({ where: { employeeId } });
      if (empExists) {
        if (!relink) {
          return res.status(409).json({
            error: 'This employee already has a login account.',
            existingUser: { id: empExists.id, email: empExists.email, name: empExists.name },
            canRelink: true,
          });
        }
        // relink=true: unlink the old account so the new one can take the employeeId
        await prisma.user.update({ where: { id: empExists.id }, data: { employeeId: null } });
      }
    }

    const targetRole = await prisma.role.findFirst({
      where: { name: { equals: role || 'EMPLOYEE', mode: 'insensitive' } }
    });

    // Stamp the creator's tenant explicitly. Internal callers must pass tenantId
    // in the body. (Don't rely on the auto-scoping extension here — this handler
    // runs behind authenticate-inside-a-wrapper where the request tenant context
    // isn't guaranteed to propagate, which otherwise drops the user into Default.)
    const tenantId = req.user?.tenantId || req.body.tenantId;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        id: uuidv4(),
        tenantId,
        email: email.toLowerCase(),
        passwordHash,
        name,
        roleId: targetRole?.id,
        employeeId,
      },
      include: { role: true },
    });
    res.status(201).json({ ...user, role: user.role?.name });
  } catch (err) {
    if (err.code === 'P2002' && err.meta?.target?.includes('employeeId')) {
      return res.status(409).json({ error: 'This employee already has a login account.' });
    }
    next(err);
  }
});

// SECURITY (H-20): role hierarchy. Higher rank = more privileged. Any user
// granting a role must (a) have rank >= the target role's rank, and (b) when
// editing another user, the actor's rank must be > the target user's current
// rank (cannot demote a peer, cannot grant peer-or-higher). Internal callers
// (x-internal-service-key) bypass the hierarchy check — they are by definition
// trusted backend code.
const ROLE_RANK = {
  SUPER_ADMIN: 100,
  ADMIN:        90,
  HR_ADMIN:     80,
  HR_MANAGER:   70,
  FINANCE_ADMIN:70,
  IT_ADMIN:     70,
  PAYROLL_OFFICER: 60,
  TRAINING_MANAGER: 60,
  RECRUITER:    50,
  LINE_MANAGER: 50,
  EMPLOYEE:     10,
};
function rankOf(roleName) {
  if (!roleName) return 0;
  return ROLE_RANK[roleName.toUpperCase()] ?? 0;
}

// PUT /users/:id  (update user — admin or internal service)
router.put('/:id', checkInternal, (req, res, next) => {
  if (req.isInternal) return next();
  authenticate(req, res, () => { authorize('user:manage')(req, res, next); });
}, async (req, res, next) => {
  try {
    const { name, role, isActive, employeeId } = req.body;
    let roleId = undefined;

    // Hierarchy guard for role changes by non-internal callers.
    if (role && !req.isInternal) {
      const actorRank = rankOf(req.user?.role);
      const targetRoleRank = rankOf(role);
      if (targetRoleRank > actorRank) {
        return res.status(403).json({ error: 'Cannot grant a role higher than your own' });
      }
      // Also prevent escalation of an existing user above the actor: load the
      // target user's current role and forbid the edit if they're already at
      // or above the actor's rank.
      const targetUser = await prisma.user.findUnique({
        where: { id: req.params.id },
        include: { role: true },
      });
      if (targetUser && rankOf(targetUser.role?.name) >= actorRank && req.user.sub !== targetUser.id) {
        return res.status(403).json({ error: 'Cannot edit a user at or above your role rank' });
      }
    }

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
        ...(isActive !== undefined && { isActive }),
        ...(req.isInternal && employeeId !== undefined && { employeeId }),
      },
      include: { role: true },
    });
    res.json({ ...user, role: user.role?.name });
  } catch (err) { next(err); }
});

// PATCH /users/link-employee  (internal — link existing auth user to an employee record by email)
router.patch('/link-employee', checkInternal, async (req, res, next) => {
  if (!req.isInternal) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { email, employeeId } = req.body;
    if (!email || !employeeId) return res.status(400).json({ error: 'email and employeeId required' });

    const target = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    const user = await prisma.user.update({
      where: { id: target.id },
      data: { employeeId },
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
    await prisma.refreshToken.updateMany({ where: { userId: req.params.id }, data: { isRevoked: true } });
    res.json({ message: 'Password reset. All sessions invalidated.' });
  } catch (err) { next(err); }
});

// POST /users/:id/reset-mfa  (admin — clears TOTP secret, forces re-enrolment)
router.post('/:id/reset-mfa', authenticate, authorize('user:manage'), async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, mfaEnabled: true } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    await prisma.user.update({
      where: { id: req.params.id },
      data: { mfaEnabled: false, mfaSecret: null, failedLogins: 0, lockedUntil: null },
    });
    // Revoke all active sessions so the user must re-login and re-enrol MFA
    await prisma.refreshToken.updateMany({ where: { userId: req.params.id }, data: { isRevoked: true } });
    res.json({ message: 'MFA cleared. User must re-enrol on next login.' });
  } catch (err) { next(err); }
});

// PATCH /users/:id/toggle-active  (lock / unlock account)
router.patch('/:id/toggle-active', authenticate, authorize('user:manage'), async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { isActive: true } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: !target.isActive, ...(target.isActive ? {} : { failedLogins: 0, lockedUntil: null }) },
      include: { role: true },
    });
    if (target.isActive) {
      // Revoke sessions when locking
      await prisma.refreshToken.updateMany({ where: { userId: req.params.id }, data: { isRevoked: true } });
    }
    res.json({ ...user, role: user.role?.name });
  } catch (err) { next(err); }
});

// POST /users/:id/send-invite — generate invite token and send onboarding email
router.post('/:id/send-invite', authenticate, authorize('user:manage'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.user.update({ where: { id: req.params.id }, data: { inviteToken: rawToken, inviteExpiry: expiry } });

    // Sign raw token as a JWT — URL carries a tamper-evident, signed token (30d JWT expiry)
    const signedToken = signInviteJwt(user.id, rawToken);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8081';
    const inviteUrl = `${frontendUrl}/onboard?token=${signedToken}`;
    const notifUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4009';

    try {
      await fetch(`${notifUrl}/notifications/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.authorization },
        body: JSON.stringify({
          to: user.email,
          subject: 'Complete Your Employee Profile — Action Required',
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <div style="background:#4f46e5;padding:32px;border-radius:16px 16px 0 0;text-align:center">
              <h1 style="color:white;margin:0;font-size:20px;font-weight:900;letter-spacing:-0.5px">Complete Your Profile</h1>
              <p style="color:#c7d2fe;font-size:11px;margin:8px 0 0;text-transform:uppercase;letter-spacing:2px">Onboarding Invitation</p>
            </div>
            <div style="background:white;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:32px">
              <p style="color:#1e293b;font-size:14px">Hi ${user.name},</p>
              <p style="color:#475569;font-size:13px;line-height:1.6">Your account has been created. Please complete your employee profile by filling in your personal details. Once submitted, HR will review and activate your profile.</p>
              <div style="text-align:center;margin:28px 0">
                <a href="${inviteUrl}" style="background:#4f46e5;color:white;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:12px;font-weight:900;letter-spacing:1px;text-transform:uppercase">Complete Profile</a>
              </div>
              <p style="color:#94a3b8;font-size:11px;margin-top:24px">This link expires in 30 days. If you have questions, contact HR.</p>
            </div>
          </div>`,
        }),
      });
    } catch (emailErr) {
      console.error('[user-routes] invite email send failed:', emailErr.message);
    }

    res.json({ message: 'Invite sent', inviteExpiry: expiry });
  } catch (err) { next(err); }
});

// GET /users/pending-invites — users who have been invited but not yet submitted their profile
router.get('/pending-invites', authenticate, authorize('user:manage'), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { inviteToken: { not: null } },
      select: { id: true, name: true, email: true, inviteExpiry: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (err) { next(err); }
});

// GET /users/invite/:token — validate signed JWT invite token (public)
router.get('/invite/:token', async (req, res, next) => {
  try {
    let rawToken;
    try {
      const payload = verifyInviteJwt(req.params.token);
      if (payload.purpose !== 'onboard') throw new Error('wrong purpose');
      rawToken = payload.jti;
    } catch {
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    }
    const user = await prisma.user.findFirst({
      where: { inviteToken: rawToken, inviteExpiry: { gt: new Date() } },
      select: { id: true, name: true, email: true },
    });
    if (!user) return res.status(404).json({ error: 'Invalid or expired invite link' });
    res.json(user);
  } catch (err) { next(err); }
});

// POST /users/invite/derive-key — internal: verify JWT signature and return
// the rawToken used as HKDF input for form-payload decryption WITHOUT
// consuming. This replaces the previous flow where employee-service decoded
// the JWT locally (without signature verification) to pluck the jti claim,
// which let a malicious caller forge a token with any jti value and recover
// the decryption key for someone else's pending application (H-10, H-23).
router.post('/invite/derive-key', async (req, res, next) => {
  const key = req.headers['x-internal-service-key'];
  if (!key || key !== process.env.INTERNAL_SERVICE_KEY) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token required' });
    let rawToken;
    try {
      const payload = verifyInviteJwt(token);
      if (payload.purpose !== 'onboard') throw new Error('wrong purpose');
      rawToken = payload.jti;
    } catch {
      return res.status(404).json({ error: 'Invalid or expired invite token' });
    }
    // Confirm rawToken still binds to an active invite row (not consumed).
    const user = await prisma.user.findFirst({
      where: { inviteToken: rawToken, inviteExpiry: { gt: new Date() } },
      select: { id: true },
    });
    if (!user) return res.status(404).json({ error: 'Invalid or expired invite token' });
    res.json({ rawToken });
  } catch (err) { next(err); }
});

// POST /users/consume-invite — internal: validate JWT + consume raw token.
// Note: rawToken is intentionally NOT returned anymore. Callers needing the
// HKDF input must use /users/invite/derive-key BEFORE consuming.
router.post('/consume-invite', async (req, res, next) => {
  const key = req.headers['x-internal-service-key'];
  if (!key || key !== process.env.INTERNAL_SERVICE_KEY) return res.status(403).json({ error: 'Forbidden' });
  try {
    const { token } = req.body;
    let rawToken;
    try {
      const payload = verifyInviteJwt(token);
      if (payload.purpose !== 'onboard') throw new Error('wrong purpose');
      rawToken = payload.jti;
    } catch {
      return res.status(404).json({ error: 'Invalid or expired invite token' });
    }
    const user = await prisma.user.findFirst({
      where: { inviteToken: rawToken, inviteExpiry: { gt: new Date() } },
      select: { id: true, name: true, email: true },
    });
    if (!user) return res.status(404).json({ error: 'Invalid or expired invite token' });
    await prisma.user.update({ where: { id: user.id }, data: { inviteToken: null, inviteExpiry: null } });
    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (err) { next(err); }
});

module.exports = router;
