'use strict';
require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const morgan  = require('morgan');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

// SECURITY (H-07): service-to-service callers (e.g. auth-service sending
// login OTP emails) authenticate with x-internal-service-key instead of a
// forged SUPER_ADMIN JWT. The previous pattern was logged in plaintext by
// morgan on every call; a single log line gave an attacker an 8h SUPER_ADMIN
// bearer.
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || '';
function internalOrAuth(req, res, next) {
  const key = req.headers['x-internal-service-key'];
  if (INTERNAL_SERVICE_KEY && key && key === INTERNAL_SERVICE_KEY) {
    req.isInternal = true;
    req.user = req.user || { sub: 'internal:notification', role: 'INTERNAL_SERVICE' };
    return next();
  }
  return authenticate(req, res, next);
}

const prisma = require('./utils/prisma');
const app    = express();
const PORT   = process.env.PORT || 4009;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
const { tenantContextMiddleware } = require('/app/shared/tenant-context');
app.use(tenantContextMiddleware);
app.get('/health', (_req, res) => res.json({ service: 'notification-service', status: 'ok', ts: new Date() }));

// ── SMTP ───────────────────────────────────────────────────────────────────────
let smtpConfig = {
  host: process.env.SMTP_HOST || 'smtp.titan.email',
  port: parseInt(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER || 'enquires@gadonghr.com',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || 'enquires@gadonghr.com',
};
// Reject SMTP hosts that can't be a real relay. A loopback/empty host (the
// in-container localhost) silently breaks ALL outbound mail — including login
// OTPs and password resets — until the next restart, with no error shown to
// the admin who saved it. This guard turns that footgun into a clear 400.
function smtpHostError(host) {
  if (host === undefined) return null; // not being changed
  if (typeof host !== 'string' || !host.trim()) return 'SMTP host is required';
  const h = host.trim().toLowerCase();
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1', '::'].includes(h)) {
    return 'SMTP host must be a reachable mail server, not localhost/loopback';
  }
  return null;
}
function buildTransporter() {
  return nodemailer.createTransport({
    host: smtpConfig.host, port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: { user: smtpConfig.user, pass: smtpConfig.pass },
  });
}
let transporter = buildTransporter();

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({ from: smtpConfig.from, to, subject, html });
    return true;
  } catch { return false; }
}

// ── Notification templates ─────────────────────────────────────────────────────
// Each entry: { title(data), body(data), category, link(data) }
const TEMPLATES = {
  // Onboarding
  NEW_HIRE_WELCOME: {
    title: d => `Welcome, ${d.firstName || 'New Team Member'}!`,
    body:  d => `Your journey starts on ${d.startDate || 'your first day'}. You've joined the ${d.department || 'team'} as ${d.jobTitle || 'a team member'}. Check your onboarding checklist to get started.`,
    category: 'ONBOARDING', link: () => '/recruitment',
  },
  BUDDY_ASSIGNED: {
    title: () => `You've been assigned as an HR Buddy`,
    body:  d => `You are the HR Buddy for ${d.newHireName || 'a new team member'}, starting ${d.startDate || 'soon'}. ${d.note ? `Note: ${d.note}` : 'Please reach out to help them settle in.'}`,
    category: 'ONBOARDING', link: () => '/recruitment',
  },
  ONBOARDING_INCOMPLETE_ALERT: {
    title: d => `Onboarding Alert: ${d.employeeName || 'New hire'} starts in ${d.daysUntilStart || '3'} days`,
    body:  d => `${d.employeeName || 'A new hire'} is starting on ${d.startDate} with ${d.incompleteTasks} of ${d.totalTasks} tasks incomplete. Pending: ${(d.pendingTaskNames || []).slice(0, 3).join(', ')}.`,
    category: 'ONBOARDING', link: () => '/recruitment',
  },
  // Payroll
  PAYSLIP_PUBLISHED: {
    title: d => `Your payslip for ${d.period || 'this period'} is ready`,
    body:  () => `Your payslip has been published. Log in to view your earnings and deductions.`,
    category: 'PAYROLL', link: () => '/payroll',
  },
  // Attendance
  ATTENDANCE_ANOMALY_DIGEST: {
    title: () => `Attendance anomalies require your attention`,
    body:  d => `You have ${d.anomalyCount || 'several'} team member(s) with pending attendance issues for ${d.date || 'today'}.`,
    category: 'ATTENDANCE', link: () => '/attendance',
  },
  // Leave
  LEAVE_APPROVED: {
    title: () => `Your leave application has been approved`,
    body:  d => `Your ${d.leaveType || 'leave'} from ${d.startDate || ''} to ${d.endDate || ''} has been approved.`,
    category: 'LEAVE', link: () => '/leave',
  },
  LEAVE_REJECTED: {
    title: () => `Your leave application was not approved`,
    body:  d => `Your ${d.leaveType || 'leave'} application was rejected. ${d.reason ? `Reason: ${d.reason}` : ''}`,
    category: 'LEAVE', link: () => '/leave',
  },
  LEAVE_PENDING_APPROVAL: {
    title: d => `Leave application pending your approval`,
    body:  d => `${d.employeeName || 'An employee'} has applied for ${d.leaveType || 'leave'} from ${d.startDate || ''} to ${d.endDate || ''}. Please review.`,
    category: 'LEAVE', link: () => '/leave',
  },
  // Work pass
  WORK_PASS_EXPIRY_ALERT: {
    title: d => `Work pass expiring in ${d.daysUntilExpiry} days`,
    body:  d => `${d.employeeName || 'An employee'}'s ${d.passType || 'work pass'} (${d.passNumber || ''}) expires on ${d.expiryDate || ''}. Initiate renewal now.`,
    category: 'COMPLIANCE', link: () => '/recruitment',
  },
  // Probation
  PROBATION_REVIEW_DUE: {
    title: d => `Probation review due for ${d.employeeName || 'an employee'}`,
    body:  d => `The probation period for ${d.employeeName || 'an employee'} ends on ${d.endDate || 'soon'}. Please complete the appraisal.`,
    category: 'PERFORMANCE', link: () => '/performance',
  },
  // Claims
  CLAIM_APPROVED: {
    title: () => `Your expense claim has been approved`,
    body:  d => `Your claim for SGD ${d.amount || ''} (${d.description || ''}) has been approved and will be included in the next payroll.`,
    category: 'CLAIMS', link: () => '/claims',
  },
  // Generic fallback
  SYSTEM: {
    title: d => d.title || 'System Notification',
    body:  d => d.body  || '',
    category: 'SYSTEM', link: () => '/dashboard',
  },
};

function renderTemplate(type, data) {
  const tpl = TEMPLATES[type] || TEMPLATES.SYSTEM;
  return {
    title:    tpl.title(data || {}),
    body:     tpl.body(data || {}),
    category: tpl.category,
    link:     tpl.link(data || {}),
  };
}

function buildEmailHtml(title, body, category) {
  const CATEGORY_COLORS = {
    PAYROLL: '#4f46e5', LEAVE: '#0891b2', ONBOARDING: '#059669',
    ATTENDANCE: '#d97706', COMPLIANCE: '#dc2626', PERFORMANCE: '#7c3aed',
    CLAIMS: '#0284c7', SYSTEM: '#475569',
  };
  const accent = CATEGORY_COLORS[category] || '#4f46e5';
  return `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
    <div style="background:${accent};padding:20px 24px;border-radius:12px 12px 0 0">
      <h2 style="color:white;margin:0;font-size:16px;font-weight:900">${title}</h2>
      ${category ? `<p style="color:rgba(255,255,255,0.75);margin:4px 0 0;font-size:11px;text-transform:uppercase;letter-spacing:0.1em">${category}</p>` : ''}
    </div>
    <div style="background:white;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <p style="color:#334155;margin:0;line-height:1.6">${body}</p>
      <hr style="border:none;border-top:1px solid #f1f5f9;margin:20px 0">
      <p style="color:#94a3b8;font-size:11px;margin:0">GaDongHR HRMS · This is an automated notification.</p>
    </div>
  </div>`;
}

// ── POST /notifications/send — unified fan-out ────────────────────────────────
// Body: { type, recipientIds?, recipients?, roles?, data?, link? }
// recipientIds: ['userId1', ...]  → in-app + email best-effort
// recipients:   ['email@co.com'] → email only (no in-app, userId unknown)
// roles:        ['HR_ADMIN', ...]→ in-app stored as userId='role:ROLE_NAME'
app.post('/notifications/send', authenticate, async (req, res, next) => {
  try {
    const { type, recipientIds, recipients, roles, data, link: overrideLink } = req.body;
    if (!type) return res.status(400).json({ error: 'type is required' });

    const rendered = renderTemplate(type, data || {});
    const finalLink = overrideLink || rendered.link;
    const created = [];

    // 1. Per-user in-app notifications
    if (Array.isArray(recipientIds) && recipientIds.length > 0) {
      for (const userId of recipientIds) {
        const n = await prisma.notification.create({
          data: {
            id: uuidv4(), userId, type: 'IN_APP',
            title: rendered.title, body: rendered.body,
            category: rendered.category, link: finalLink, meta: data || null,
          },
        });
        created.push(n.id);
        // Email best-effort: data.email or skip
        if (data?.email) {
          sendEmail(data.email, rendered.title, buildEmailHtml(rendered.title, rendered.body, rendered.category));
        }
      }
    }

    // 2. Role-broadcast in-app (stored as userId='role:ROLE_NAME')
    if (Array.isArray(roles) && roles.length > 0) {
      for (const role of roles) {
        const n = await prisma.notification.create({
          data: {
            id: uuidv4(), userId: `role:${role}`, type: 'IN_APP',
            title: rendered.title, body: rendered.body,
            category: rendered.category, link: finalLink, meta: data || null,
          },
        });
        created.push(n.id);
      }
    }

    // 3. Email-only recipients (no in-app)
    if (Array.isArray(recipients) && recipients.length > 0) {
      const html = buildEmailHtml(rendered.title, rendered.body, rendered.category);
      for (const email of recipients) {
        sendEmail(email, rendered.title, html);
      }
    }

    res.status(201).json({ sent: created.length + (recipients?.length || 0), inAppIds: created });
  } catch (err) { next(err); }
});

// ── GET /notifications/me — own + role-broadcast notifications ─────────────────
// Scoping guarantee: a user sees ONLY their own records (userId=sub) plus
// broadcasts addressed to their exact role (userId='role:THEIR_ROLE').
// Employees never see HR_ADMIN broadcasts; HR Admins never see EMPLOYEE ones.
app.get('/notifications/me', authenticate, async (req, res, next) => {
  try {
    const userId   = req.user.sub;
    const roleKey  = `role:${req.user.role}`;
    const limit    = Math.min(parseInt(req.query.limit) || 50, 100);
    const unreadOnly = req.query.unread === 'true';

    const where = {
      userId: { in: [userId, roleKey] },
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const notifs = await prisma.notification.findMany({
      where, orderBy: { createdAt: 'desc' }, take: limit,
    });
    res.json(notifs);
  } catch (err) { next(err); }
});

// ── GET /notifications/me/unread-count ────────────────────────────────────────
app.get('/notifications/me/unread-count', authenticate, async (req, res, next) => {
  try {
    const userId  = req.user.sub;
    const roleKey = `role:${req.user.role}`;
    const count   = await prisma.notification.count({
      where: { userId: { in: [userId, roleKey] }, isRead: false },
    });
    res.json({ count });
  } catch (err) { next(err); }
});

// ── PUT /notifications/me/read-all ────────────────────────────────────────────
app.put('/notifications/me/read-all', authenticate, async (req, res, next) => {
  try {
    const userId  = req.user.sub;
    const roleKey = `role:${req.user.role}`;
    const { count } = await prisma.notification.updateMany({
      where: { userId: { in: [userId, roleKey] }, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ updated: count });
  } catch (err) { next(err); }
});

// ── PUT /notifications/:id/read ───────────────────────────────────────────────
// SECURITY (H-04): scope the update to the caller's own notifications OR to
// notifications addressed to a role the caller holds (`role:HR_ADMIN` etc.).
// Previously this update had no ownership filter — any authenticated user
// could mark any other user's notification as read, hiding payroll variance
// or anomaly alerts from supervisors.
app.put('/notifications/:id/read', authenticate, async (req, res, next) => {
  try {
    const userId  = req.user.sub;
    const roleKey = `role:${req.user.role}`;
    const isAdmin = ['SUPER_ADMIN', 'HR_ADMIN', 'IT_ADMIN'].includes(req.user.role);
    const ownerFilter = isAdmin ? {} : { userId: { in: [userId, roleKey] } };

    const { count } = await prisma.notification.updateMany({
      where: { id: req.params.id, ...ownerFilter },
      data: { isRead: true, readAt: new Date() },
    });
    if (count === 0) return res.status(404).json({ error: 'Notification not found' });
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });
    res.json(notif);
  } catch (err) { next(err); }
});

// ── GET /notifications/me/all — alias matching older frontend calls ────────────
app.get('/notifications/me/all', authenticate, async (req, res, next) => {
  try {
    const userId  = req.user.sub;
    const roleKey = `role:${req.user.role}`;
    const notifs  = await prisma.notification.findMany({
      where: { userId: { in: [userId, roleKey] } },
      orderBy: { createdAt: 'desc' }, take: 100,
    });
    res.json(notifs);
  } catch (err) { next(err); }
});

// ── Legacy: POST /notifications/in-app ───────────────────────────────────────
app.post('/notifications/in-app', authenticate, async (req, res, next) => {
  try {
    const { userId, title, body, meta, category, link } = req.body;
    if (!userId || !title || !body) return res.status(400).json({ error: 'userId, title, body required' });
    const notif = await prisma.notification.create({
      data: { id: uuidv4(), userId, type: 'IN_APP', title, body, category: category || null, link: link || null, meta: meta || null },
    });
    res.status(201).json(notif);
  } catch (err) { next(err); }
});

// ── Legacy: POST /notifications/email ────────────────────────────────────────
// Accepts either old { to, subject, html } OR structured { type, recipients, roles, data }
app.post('/notifications/email', internalOrAuth, async (req, res, next) => {
  try {
    const { to, subject, html, text, type, recipients, roles, data } = req.body;

    // Structured call (new services use type+recipients/roles)
    if (type && (recipients || roles)) {
      const rendered  = renderTemplate(type, data || {});
      const emailHtml = buildEmailHtml(rendered.title, rendered.body, rendered.category);
      const targets   = [...(recipients || [])];

      // Role-based in-app (don't need email for these unless we have emails)
      if (Array.isArray(roles) && roles.length > 0) {
        for (const role of roles) {
          await prisma.notification.create({
            data: {
              id: uuidv4(), userId: `role:${role}`, type: 'IN_APP',
              title: rendered.title, body: rendered.body,
              category: rendered.category, link: rendered.link, meta: data || null,
            },
          });
        }
      }
      for (const email of targets) {
        sendEmail(email, rendered.title, emailHtml);
      }
      return res.json({ message: 'Notification dispatched', recipients: targets.length, roles: roles?.length || 0 });
    }

    // Legacy plain-email call
    if (!to || !subject) return res.status(400).json({ error: 'to and subject required' });
    await transporter.sendMail({ from: smtpConfig.from, to, subject, html: html || text || '' });
    res.json({ message: 'Email sent' });
  } catch (err) { next(err); }
});

// ── Legacy: GET /notifications/:userId ───────────────────────────────────────
// SECURITY (H-05): the prior version only guarded against the literal 'me'.
// Authenticated users could enumerate any userId. We now require either:
//   (a) caller's own sub matches, OR
//   (b) caller is in the admin allowlist.
app.get('/notifications/:userId', authenticate, async (req, res, next) => {
  try {
    if (req.params.userId === 'me') return res.status(400).json({ error: 'Use /notifications/me' });
    const isAdmin = ['SUPER_ADMIN', 'HR_ADMIN', 'IT_ADMIN'].includes(req.user.role);
    if (req.params.userId !== req.user.sub && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden — you may only read your own notifications' });
    }
    const notifs = await prisma.notification.findMany({
      where: { userId: req.params.userId }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    res.json(notifs);
  } catch (err) { next(err); }
});

// ── SMTP admin endpoints ───────────────────────────────────────────────────────
app.get('/notifications/smtp-config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), (_req, res) => {
  res.json({ host: smtpConfig.host, port: smtpConfig.port, user: smtpConfig.user, pass: smtpConfig.pass ? '••••••••' : '', from: smtpConfig.from, hasPassword: !!smtpConfig.pass });
});
app.put('/notifications/smtp-config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res) => {
  const { host, port, user, pass, from } = req.body;
  const hostErr = smtpHostError(host);
  if (hostErr) return res.status(400).json({ error: hostErr });
  const before = { host: smtpConfig.host, port: smtpConfig.port, user: smtpConfig.user, from: smtpConfig.from };
  if (host !== undefined) smtpConfig.host = host;
  if (port !== undefined) smtpConfig.port = parseInt(port) || 587;
  if (user !== undefined) smtpConfig.user = user;
  // Never log the password — capture only whether it was changed.
  const passwordChanged = pass !== undefined && pass !== '••••••••';
  if (passwordChanged) smtpConfig.pass = pass;
  if (from !== undefined) smtpConfig.from = from;
  transporter = buildTransporter();
  // SECURITY (M-20): audit SMTP-host changes. SMTP is a credential-handling
  // surface: rerouting it points outbound mail (including login OTPs) at
  // an attacker-controlled relay. notification-service has no AuditLog
  // table of its own, so we emit a structured log line that container log
  // aggregators (and the future shared audit aggregation) can pick up.
  console.log(JSON.stringify({
    audit:     'SMTP_CONFIG_CHANGED',
    actor:     req.user?.sub || 'unknown',
    actorRole: req.user?.role || null,
    ip:        req.ip,
    before,
    after: {
      host: smtpConfig.host, port: smtpConfig.port, user: smtpConfig.user, from: smtpConfig.from,
      passwordChanged,
    },
    ts: new Date().toISOString(),
  }));
  res.json({ message: 'SMTP configuration updated', host: smtpConfig.host, port: smtpConfig.port });
});
app.post('/notifications/smtp-test', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'to is required' });
    const html = buildEmailHtml('SMTP Test Successful', `Your GaDongHR SMTP configuration is working. Host: ${smtpConfig.host}, Port: ${smtpConfig.port}`, 'SYSTEM');
    await transporter.sendMail({ from: smtpConfig.from, to, subject: 'GaDongHR — SMTP Configuration Test', html });
    res.json({ message: `Test email sent to ${to}` });
  } catch (err) { next(err); }
});
app.get('/notifications/config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), (_req, res) => res.json({ smtpFrom: smtpConfig.from }));
app.put('/notifications/config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), (req, res) => {
  if (req.body.smtpFrom) { smtpConfig.from = req.body.smtpFrom; transporter = buildTransporter(); }
  res.json({ smtpFrom: smtpConfig.from });
});

app.use((err, _req, res, _next) => { console.error(err); res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') }); });

if (require.main === module) {
  app.listen(PORT, () => console.log(`[notification-service] Running on port ${PORT}`));
}
module.exports = { app };
