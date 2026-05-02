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

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

let smtpFromOverride = null;
function effectiveFrom() { return smtpFromOverride || process.env.SMTP_FROM || 'noreply@ezyhrm.sg'; }

// GET /notifications/config
app.get('/notifications/config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), (req, res) => {
  res.json({ smtpFrom: effectiveFrom() });
});

// PUT /notifications/config — update live sender address (survives until restart)
app.put('/notifications/config', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), (req, res) => {
  const { smtpFrom } = req.body;
  if (smtpFrom !== undefined) smtpFromOverride = smtpFrom || null;
  res.json({ smtpFrom: effectiveFrom() });
});

// POST /notifications/email  (internal)
app.post('/notifications/email', authenticate, async (req, res, next) => {
  try {
    const { to, subject, html, text } = req.body;
    if (!to || !subject) return res.status(400).json({ error: 'to, subject required' });
    await transporter.sendMail({ from: effectiveFrom(), to, subject, html, text });
    res.json({ message: 'Email sent' });
  } catch (err) { next(err); }
});

// POST /notifications/in-app  (internal)
app.post('/notifications/in-app', authenticate, async (req, res, next) => {
  try {
    const { userId, title, body, meta } = req.body;
    if (!userId || !title || !body) return res.status(400).json({ error: 'userId, title, body required' });
    const notif = await prisma.notification.create({ data: { id: uuidv4(), userId, type: 'IN_APP', title, body, meta } });
    res.status(201).json(notif);
  } catch (err) { next(err); }
});

// GET /notifications/:userId
app.get('/notifications/:userId', authenticate, async (req, res, next) => {
  try {
    const notifs = await prisma.notification.findMany({
      where: { userId: req.params.userId }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    res.json(notifs);
  } catch (err) { next(err); }
});

// PUT /notifications/:id/read
app.put('/notifications/:id/read', authenticate, async (req, res, next) => {
  try {
    const notif = await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true, readAt: new Date() } });
    res.json(notif);
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });
app.listen(PORT, () => console.log(`[notification-service] Running on port ${PORT}`));
