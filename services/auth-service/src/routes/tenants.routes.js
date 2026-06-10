'use strict';

// Public self-service company signup (Payboy-style) + company-profile setup.
// POST /tenants/register  — create an isolated tenant + owner, free 14-day trial.
// POST /tenants/:id/profile — owner/admin saves the CompanyProfile.
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const prisma = require('../utils/prisma');
const { runUnscoped, DEFAULT_TENANT_ID } = require('../utils/tenantContext');
const { signAccessToken, signRefreshToken } = require('../utils/jwt.utils');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const router = express.Router();

const TRIAL_DAYS = 14;

// Public endpoint → rate-limit by IP to blunt abuse/automation.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.REGISTER_RATELIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signups from this IP. Try again later.' },
});

function slugify(name) {
  return String(name || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'company';
}

async function uniqueSlug(base) {
  let slug = base;
  let i = 2;
  // Unscoped: slug is globally unique across tenants.
  while (await runUnscoped(async () => prisma.tenant.findUnique({ where: { slug } }))) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

// Optional reCAPTCHA verification — only enforced when RECAPTCHA_SECRET is set.
async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET;
  if (!secret) return true; // not configured → skip
  if (!token) return false;
  try {
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    });
    const data = await r.json();
    return !!data.success;
  } catch {
    return false;
  }
}

const SUPPORTED_COUNTRIES = ['SG', 'MY', 'HK', 'ID', 'TH', 'PH', 'VN'];

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const { companyName, fullName, workEmail, password, country, companySize, referralSource, recaptchaToken } = req.body || {};

    if (!companyName || !fullName || !workEmail || !password) {
      return res.status(400).json({ error: 'companyName, fullName, workEmail and password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const email = String(workEmail).toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid work email is required' });
    }
    const ctry = String(country || 'SG').toUpperCase();
    if (!SUPPORTED_COUNTRIES.includes(ctry)) {
      return res.status(400).json({ error: `country must be one of ${SUPPORTED_COUNTRIES.join(', ')}` });
    }
    if (!(await verifyRecaptcha(recaptchaToken))) {
      return res.status(400).json({ error: 'reCAPTCHA verification failed' });
    }

    // Reject if this email already owns a company (an OWNER/SUPER_ADMIN somewhere).
    const existingOwner = await runUnscoped(async () =>
      prisma.user.findFirst({ where: { email, role: { name: { in: ['OWNER', 'SUPER_ADMIN'] } } } })
    );
    if (existingOwner) {
      return res.status(409).json({ error: 'This email is already registered to a company.' });
    }

    const slug = await uniqueSlug(slugify(companyName));
    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const passwordHash = await bcrypt.hash(String(password), 12); // hash BEFORE the tx (slow)

    // Everything for a brand-new tenant is created unscoped, with explicit
    // tenantId. The role/permission set is cloned from the Default tenant
    // template so the company lands with a full, working RBAC config.
    const created = await runUnscoped(async () => prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: companyName, slug, country: ctry,
          companySize: companySize || null, referralSource: referralSource || null,
          status: 'TRIALING', trialEndsAt,
        },
      });

      await tx.subscription.create({
        data: { tenantId: tenant.id, plan: 'trial', status: 'trialing', trialEndsAt },
      });

      // Clone the Default tenant's roles + permission links into this tenant.
      const templateRoles = await tx.role.findMany({
        where: { tenantId: DEFAULT_TENANT_ID },
        include: { permissions: true },
      });
      let ownerRole = null;
      for (const r of templateRoles) {
        const newRole = await tx.role.create({
          data: { tenantId: tenant.id, name: r.name, description: r.description, isSystem: r.isSystem },
        });
        if (r.permissions.length) {
          await tx.rolePermission.createMany({
            data: r.permissions.map((p) => ({ roleId: newRole.id, permissionId: p.permissionId })),
          });
        }
        // The first user is the company owner → full admin (SUPER_ADMIN role).
        if (r.name === 'SUPER_ADMIN') ownerRole = newRole;
      }

      const owner = await tx.user.create({
        data: { tenantId: tenant.id, email, passwordHash, name: fullName, roleId: ownerRole ? ownerRole.id : null, isActive: true },
      });

      return { tenant, owner, ownerRoleName: ownerRole ? ownerRole.name : 'SUPER_ADMIN' };
    }, { timeout: 15000 }));

    // Resolve the owner's permission codes for the token.
    const permissions = await runUnscoped(async () => {
      if (!created.owner.roleId) return [];
      const rps = await prisma.rolePermission.findMany({
        where: { roleId: created.owner.roleId },
        include: { permission: true },
      });
      return rps.map((rp) => rp.permission.code);
    });

    const accessToken = signAccessToken({
      sub: created.owner.id,
      tenantId: created.tenant.id,
      email: created.owner.email,
      role: (created.ownerRoleName || 'SUPER_ADMIN').toUpperCase(),
      permissions,
      employeeId: null,
      name: created.owner.name,
    });
    const refreshToken = signRefreshToken({ sub: created.owner.id });
    await runUnscoped(async () => prisma.refreshToken.create({
      data: { token: refreshToken, userId: created.owner.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    }));

    return res.status(201).json({
      accessToken,
      refreshToken,
      tenant: {
        id: created.tenant.id, name: created.tenant.name, slug: created.tenant.slug,
        country: created.tenant.country, status: created.tenant.status, trialEndsAt: created.tenant.trialEndsAt,
      },
      user: {
        id: created.owner.id, name: created.owner.name, email: created.owner.email,
        role: created.ownerRoleName, permissions,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Save / update the company profile. Auth required; the tenantId comes from the
// verified token, so a caller can only edit their OWN tenant's profile.
router.post('/:id/profile', authenticate, authorize('employee:manage', ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    if (!tenantId || (req.params.id !== tenantId && req.params.id !== 'me')) {
      return res.status(403).json({ error: 'You can only edit your own company profile' });
    }
    const b = req.body || {};
    if (!b.legalName) return res.status(400).json({ error: 'legalName is required' });

    const data = {
      legalName: b.legalName, registrationNo: b.registrationNo || null, industry: b.industry || null,
      addressLine1: b.addressLine1 || null, addressLine2: b.addressLine2 || null,
      postalCode: b.postalCode || null, city: b.city || null,
      country: (b.country || 'SG').toUpperCase(), logoUrl: b.logoUrl || null,
      payrollConfig: b.payrollConfig || undefined, completed: true,
    };

    const profile = await runUnscoped(async () => prisma.companyProfile.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    }));

    return res.json({ profile });
  } catch (err) {
    next(err);
  }
});

// Lightweight: the current tenant + subscription + profile-completion status.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const tenantId = req.user.tenantId;
    if (!tenantId) return res.status(404).json({ error: 'No tenant' });
    const [tenant, subscription, profile] = await runUnscoped(async () => Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.subscription.findUnique({ where: { tenantId } }),
      prisma.companyProfile.findUnique({ where: { tenantId } }),
    ]));
    return res.json({ tenant, subscription, profileCompleted: !!(profile && profile.completed), profile });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
