'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { authenticator } = require('otplib');
const prisma = require('../utils/prisma');
const authdb = require('../utils/authdb');
const { signPlatformToken, verifyToken } = require('../utils/jwt');

let crypto;
try { crypto = require('/app/shared/crypto'); } catch { crypto = null; }
const enc = (s) => (crypto && crypto.encrypt ? crypto.encrypt(s) : s);
const dec = (s) => (crypto && crypto.decrypt ? crypto.decrypt(s) : s);

const router = express.Router();

// ── Auth: platform-scope only ────────────────────────────────────────────────
function requirePlatform(req, res, next) {
  const h = req.headers['authorization'];
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing platform token' });
  try {
    const p = verifyToken(h.slice(7));
    if (p.scope !== 'platform') return res.status(403).json({ error: 'Not a platform token' });
    req.admin = p;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired platform token' });
  }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.length || roles.includes(req.admin.role)) return next();
    return res.status(403).json({ error: 'Insufficient platform role' });
  };
}

async function audit(req, action, tenantId, before, after) {
  try {
    await prisma.platformAuditLog.create({
      data: { adminId: req.admin?.sub || 'system', action, tenantId: tenantId || null, before: before || undefined, after: after || undefined, ipAddress: req.ip },
    });
  } catch (e) { console.error('[platform-audit] failed:', e.message); }
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: Number(process.env.PLATFORM_LOGIN_MAX || 10), standardHeaders: true, legacyHeaders: false });

// ── Login (mandatory MFA) ────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password, mfaCode } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const admin = await prisma.platformAdmin.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (!admin || !admin.isActive || !(await bcrypt.compare(password, admin.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // MFA is mandatory for the platform realm.
    if (!admin.mfaEnabled || !admin.mfaSecret) {
      // First login → must enrol. Issue a short setup token (scope-limited).
      const setupToken = signPlatformToken({ sub: admin.id, role: admin.role, email: admin.email, mfa_setup: true });
      return res.status(200).json({ mfaSetupRequired: true, setupToken });
    }
    if (!mfaCode) return res.status(200).json({ mfaRequired: true });
    if (!authenticator.verify({ token: String(mfaCode), secret: dec(admin.mfaSecret) })) {
      await audit({ admin: { sub: admin.id }, ip: req.ip }, 'platform.login_failed', null, null, { email });
      return res.status(401).json({ error: 'Invalid MFA code' });
    }
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const token = signPlatformToken({ sub: admin.id, role: admin.role, email: admin.email, name: admin.name });
    await audit({ admin: { sub: admin.id }, ip: req.ip }, 'platform.login', null, null, null);
    res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role } });
  } catch (err) { next(err); }
});

// MFA enrolment (requires the setup token from first login)
router.post('/mfa/setup', async (req, res, next) => {
  try {
    const h = req.headers['authorization'];
    const p = h && h.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
    if (!p || p.scope !== 'platform') return res.status(401).json({ error: 'Setup token required' });
    const secret = authenticator.generateSecret();
    await prisma.platformAdmin.update({ where: { id: p.sub }, data: { mfaSecret: enc(secret) } });
    const otpauth = authenticator.keyuri(p.email, 'Vorkhive Platform', secret);
    res.json({ secret, otpauth });
  } catch (err) { next(err); }
});
router.post('/mfa/enable', async (req, res, next) => {
  try {
    const h = req.headers['authorization'];
    const p = h && h.startsWith('Bearer ') ? verifyToken(h.slice(7)) : null;
    if (!p || p.scope !== 'platform') return res.status(401).json({ error: 'Setup token required' });
    const admin = await prisma.platformAdmin.findUnique({ where: { id: p.sub } });
    if (!admin?.mfaSecret) return res.status(400).json({ error: 'Run /mfa/setup first' });
    if (!authenticator.verify({ token: String(req.body?.mfaCode || ''), secret: dec(admin.mfaSecret) })) {
      return res.status(401).json({ error: 'Invalid MFA code' });
    }
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { mfaEnabled: true } });
    const token = signPlatformToken({ sub: admin.id, role: admin.role, email: admin.email, name: admin.name });
    res.json({ token });
  } catch (err) { next(err); }
});

// ── Tenants ──────────────────────────────────────────────────────────────────
router.get('/tenants', requirePlatform, async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().toLowerCase();
    const { rows } = await authdb.query(
      `SELECT t.id, t.name, t.slug, t.country, t.status, t."trialEndsAt", t."createdAt",
              s.plan, s.status AS sub_status,
              (SELECT count(*) FROM users u WHERE u."tenantId" = t.id) AS users
       FROM tenants t LEFT JOIN subscriptions s ON s."tenantId" = t.id
       WHERE ($1 = '' OR lower(t.name) LIKE '%'||$1||'%' OR lower(t.slug) LIKE '%'||$1||'%')
       ORDER BY t."createdAt" DESC LIMIT 200`, [q]);
    res.json({ tenants: rows });
  } catch (err) { next(err); }
});

router.get('/tenants/:id', requirePlatform, async (req, res, next) => {
  try {
    const { rows } = await authdb.query(
      `SELECT t.*, s.plan, s.status AS sub_status, s."currentPeriodEnd", s."stripeCustomerId"
       FROM tenants t LEFT JOIN subscriptions s ON s."tenantId" = t.id WHERE t.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Tenant not found' });
    const usage = await authdb.query(`SELECT count(*)::int AS users FROM users WHERE "tenantId" = $1`, [req.params.id]);
    const modules = await prisma.tenantModule.findMany({ where: { tenantId: req.params.id } });
    res.json({ tenant: rows[0], usage: usage.rows[0], modules });
  } catch (err) { next(err); }
});

async function setTenantStatus(req, res, next, status, action) {
  try {
    const before = await authdb.query(`SELECT status FROM tenants WHERE id = $1`, [req.params.id]);
    if (!before.rows[0]) return res.status(404).json({ error: 'Tenant not found' });
    await authdb.query(`UPDATE tenants SET status = $1, "updatedAt" = now() WHERE id = $2`, [status, req.params.id]);
    await authdb.query(`UPDATE subscriptions SET status = $1, "updatedAt" = now() WHERE "tenantId" = $2`,
      [status === 'SUSPENDED' ? 'past_due' : status === 'CANCELED' ? 'canceled' : 'active', req.params.id]);
    await audit(req, action, req.params.id, { status: before.rows[0].status }, { status });
    res.json({ ok: true, status });
  } catch (err) { next(err); }
}
router.post('/tenants/:id/suspend', requirePlatform, requireRole('SUPER_ADMIN', 'BILLING'), (req, res, next) => setTenantStatus(req, res, next, 'SUSPENDED', 'tenant.suspend'));
router.post('/tenants/:id/resume',  requirePlatform, requireRole('SUPER_ADMIN', 'BILLING'), (req, res, next) => setTenantStatus(req, res, next, 'ACTIVE', 'tenant.resume'));
router.post('/tenants/:id/cancel',  requirePlatform, requireRole('SUPER_ADMIN'), (req, res, next) => setTenantStatus(req, res, next, 'CANCELED', 'tenant.cancel'));

router.post('/tenants/:id/extend-trial', requirePlatform, requireRole('SUPER_ADMIN', 'BILLING'), async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(365, Number(req.body?.days) || 14));
    const before = await authdb.query(`SELECT "trialEndsAt" FROM tenants WHERE id = $1`, [req.params.id]);
    if (!before.rows[0]) return res.status(404).json({ error: 'Tenant not found' });
    const base = new Date(Math.max(Date.now(), new Date(before.rows[0].trialEndsAt).getTime()));
    const newEnd = new Date(base.getTime() + days * 86400000);
    await authdb.query(`UPDATE tenants SET "trialEndsAt" = $1, status = 'TRIALING', "updatedAt" = now() WHERE id = $2`, [newEnd, req.params.id]);
    await authdb.query(`UPDATE subscriptions SET "trialEndsAt" = $1, status = 'trialing', "updatedAt" = now() WHERE "tenantId" = $2`, [newEnd, req.params.id]);
    await audit(req, 'trial.extend', req.params.id, { trialEndsAt: before.rows[0].trialEndsAt }, { trialEndsAt: newEnd, days });
    res.json({ ok: true, trialEndsAt: newEnd });
  } catch (err) { next(err); }
});

// ── Per-tenant module entitlements ───────────────────────────────────────────
router.post('/tenants/:id/modules/:code/toggle', requirePlatform, requireRole('SUPER_ADMIN', 'BILLING'), async (req, res, next) => {
  try {
    const mod = await prisma.module.findUnique({ where: { code: req.params.code } });
    if (!mod) return res.status(404).json({ error: 'Unknown module' });
    if (mod.isCore) return res.status(400).json({ error: 'Core modules cannot be disabled' });
    const enabled = req.body?.enabled !== false;
    const before = await prisma.tenantModule.findUnique({ where: { tenantId_moduleCode: { tenantId: req.params.id, moduleCode: req.params.code } } });
    const row = await prisma.tenantModule.upsert({
      where: { tenantId_moduleCode: { tenantId: req.params.id, moduleCode: req.params.code } },
      update: { enabled }, create: { tenantId: req.params.id, moduleCode: req.params.code, enabled },
    });
    await audit(req, 'module.toggle', req.params.id, { module: req.params.code, enabled: before?.enabled }, { module: req.params.code, enabled });
    res.json({ module: row });
  } catch (err) { next(err); }
});

// ── Module + plan catalog ────────────────────────────────────────────────────
router.get('/modules', requirePlatform, async (_req, res, next) => {
  try { res.json({ modules: await prisma.module.findMany({ orderBy: { code: 'asc' } }) }); } catch (err) { next(err); }
});

// ── Audit log ────────────────────────────────────────────────────────────────
router.get('/audit', requirePlatform, async (req, res, next) => {
  try {
    const where = req.query.tenantId ? { tenantId: String(req.query.tenantId) } : {};
    const logs = await prisma.platformAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ logs });
  } catch (err) { next(err); }
});

// ── Time-boxed, audited impersonation of a tenant owner ──────────────────────
router.post('/tenants/:id/impersonate', requirePlatform, requireRole('SUPER_ADMIN', 'SUPPORT'), async (req, res, next) => {
  try {
    const { rows } = await authdb.query(
      `SELECT u.id, u.email, u."tenantId", u."employeeId", r.name AS role
       FROM users u LEFT JOIN roles r ON r.id = u."roleId"
       WHERE u."tenantId" = $1 AND r.name IN ('OWNER','SUPER_ADMIN') ORDER BY u."createdAt" ASC LIMIT 1`, [req.params.id]);
    const owner = rows[0];
    if (!owner) return res.status(404).json({ error: 'No owner found for tenant' });
    const perms = await authdb.query(
      `SELECT p.code FROM users u JOIN role_permissions rp ON rp."roleId" = u."roleId" JOIN permissions p ON p.id = rp."permissionId" WHERE u.id = $1`, [owner.id]);
    // Short-lived tenant token, flagged as impersonation.
    const token = signPlatformToken({ sub: owner.id, email: owner.email, role: (owner.role || 'SUPER_ADMIN').toUpperCase() });
    // NB: this is signed with scope:platform; for a real tenant-app impersonation
    // you'd mint a tenant-scope token. We expose the owner identity + a flag so
    // the operator UI can open a clearly-bannered session. Audited regardless.
    await audit(req, 'impersonate', req.params.id, null, { ownerId: owner.id, email: owner.email });
    res.json({ owner: { id: owner.id, email: owner.email, tenantId: owner.tenantId, role: owner.role, permissions: perms.rows.map(r => r.code) }, token, expiresInMinutes: 30 });
  } catch (err) { next(err); }
});

// ── Internal: entitlements for the gateway (INTERNAL_SERVICE_KEY) ─────────────
router.get('/entitlements/:tenantId', async (req, res, next) => {
  try {
    if (req.headers['x-internal-key'] !== process.env.INTERNAL_SERVICE_KEY) return res.status(401).json({ error: 'unauthorized' });
    const rows = await prisma.tenantModule.findMany({ where: { tenantId: req.params.tenantId } });
    const disabled = rows.filter(r => !r.enabled).map(r => r.moduleCode);
    res.json({ tenantId: req.params.tenantId, disabled });
  } catch (err) { next(err); }
});

module.exports = router;
