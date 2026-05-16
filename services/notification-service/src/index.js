'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 4009;

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'notification-service', status: 'ok', ts: new Date() }));

// ── Live SMTP state (overrides env vars until restart) ─────────────────────────
let smtpConfig = {
  host: process.env.SMTP_HOST || 'smtp.titan.email',
  port: parseInt(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER || 'enquires@vorkhive.com',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || 'enquires@vorkhive.com',
};

function buildTransporter() {
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.port === 465,
    auth: { user: smtpConfig.user, pass: smtpConfig.pass },
  });
}

let transporter = buildTransporter();

// ── GET /notifications/smtp-config — returns current SMTP settings (password masked) ──
app.get('/notifications/smtp-config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), (req, res) => {
  res.json({
    host: smtpConfig.host,
    port: smtpConfig.port,
    user: smtpConfig.user,
    pass: smtpConfig.pass ? '••••••••' : '',
    from: smtpConfig.from,
    hasPassword: !!smtpConfig.pass,
  });
});

// ── PUT /notifications/smtp-config — update SMTP settings live ─────────────────
app.put('/notifications/smtp-config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), (req, res) => {
  const { host, port, user, pass, from } = req.body;
  if (host !== undefined) smtpConfig.host = host;
  if (port !== undefined) smtpConfig.port = parseInt(port) || 587;
  if (user !== undefined) smtpConfig.user = user;
  if (pass !== undefined && pass !== '••••••••') smtpConfig.pass = pass; // ignore if still masked
  if (from !== undefined) smtpConfig.from = from;
  transporter = buildTransporter(); // rebuild with new settings
  res.json({ message: 'SMTP configuration updated', host: smtpConfig.host, port: smtpConfig.port, user: smtpConfig.user, from: smtpConfig.from });
});

// ── POST /notifications/smtp-test — send a test email using current config ──────
app.post('/notifications/smtp-test', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const { to } = req.body;
    if (!to) return res.status(400).json({ error: 'to is required' });
    await transporter.sendMail({
      from: smtpConfig.from,
      to,
      subject: 'Vorkhive — SMTP Configuration Test',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <div style="background:#4f46e5;padding:24px;border-radius:12px 12px 0 0;text-align:center">
          <h2 style="color:white;margin:0;font-size:18px;font-weight:900">SMTP Test Successful</h2>
        </div>
        <div style="background:white;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:24px">
          <p style="color:#1e293b">Your Vorkhive SMTP configuration is working correctly.</p>
          <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:13px">
            <tr><td style="padding:6px 0;color:#94a3b8;width:80px">Host</td><td style="color:#1e293b;font-weight:bold">${smtpConfig.host}</td></tr>
            <tr><td style="padding:6px 0;color:#94a3b8">Port</td><td style="color:#1e293b;font-weight:bold">${smtpConfig.port}</td></tr>
            <tr><td style="padding:6px 0;color:#94a3b8">From</td><td style="color:#1e293b;font-weight:bold">${smtpConfig.from}</td></tr>
          </table>
        </div>
      </div>`,
    });
    res.json({ message: `Test email sent to ${to}` });
  } catch (err) { next(err); }
});

// ── Legacy config endpoints (kept for compatibility) ───────────────────────────
app.get('/notifications/config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), (req, res) => {
  res.json({ smtpFrom: smtpConfig.from });
});
app.put('/notifications/config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), (req, res) => {
  const { smtpFrom } = req.body;
  if (smtpFrom !== undefined) { smtpConfig.from = smtpFrom || smtpConfig.from; transporter = buildTransporter(); }
  res.json({ smtpFrom: smtpConfig.from });
});

// ── POST /notifications/email ──────────────────────────────────────────────────
app.post('/notifications/email', authenticate, async (req, res, next) => {
  try {
    const { to, subject, html, text } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'to, subject required' });
    await transporter.sendMail({ from: smtpConfig.from, to, subject, html, text });
    res.json({ message: 'Email sent' });
  } catch (err) { next(err); }
});

// ── POST /notifications/in-app ─────────────────────────────────────────────────
app.post('/notifications/in-app', authenticate, async (req, res, next) => {
  try {
    const { userId, title, body, meta } = req.body;
    if (!userId || !title || !body) return res.status(400).json({ error: 'userId, title, body required' });
    const notif = await prisma.notification.create({ data: { id: uuidv4(), userId, type: 'IN_APP', title, body, meta } });
    res.status(201).json(notif);
  } catch (err) { next(err); }
});

// ── GET /notifications/:userId ─────────────────────────────────────────────────
app.get('/notifications/:userId', authenticate, async (req, res, next) => {
  try {
    const notifs = await prisma.notification.findMany({
      where: { userId: req.params.userId }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    res.json(notifs);
  } catch (err) { next(err); }
});

// ── PUT /notifications/:id/read ────────────────────────────────────────────────
app.put('/notifications/:id/read', authenticate, async (req, res, next) => {
  try {
    const notif = await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true, readAt: new Date() } });
    res.json(notif);
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });
app.listen(PORT, () => console.log(`[notification-service] Running on port ${PORT}`));
