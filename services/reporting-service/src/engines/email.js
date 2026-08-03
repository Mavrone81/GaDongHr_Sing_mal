'use strict';
/**
 * RPT-003 Phase 2 — email delivery engine.
 *
 * Sends report attachments via SMTP (nodemailer).
 * Falls back gracefully when SMTP_HOST is not configured — returns { skipped: true }.
 *
 * Required env vars:
 *   SMTP_HOST          — SMTP server hostname
 *   SMTP_PORT          — port (default 587)
 *   SMTP_SECURE        — "true" for TLS on port 465 (default false)
 *   SMTP_USER          — login username (optional if relay doesn't auth)
 *   SMTP_PASS          — login password
 *   SMTP_FROM          — From address (default noreply@gadonghr.app)
 */

const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  _transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return _transporter;
}

/**
 * @param {object} opts
 * @param {string|string[]} opts.recipients
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.attachmentName]
 * @param {Buffer} [opts.attachmentBuffer]
 * @param {string} [opts.contentType]
 * @returns {Promise<{ sent: boolean } | { skipped: boolean }>}
 */
async function sendReportEmail({ recipients, subject, html, attachmentName, attachmentBuffer, contentType }) {
  const transporter = getTransporter();
  if (!transporter) {
    const to = Array.isArray(recipients) ? recipients.join(', ') : recipients;
    console.warn(`[reporting/email] SMTP_HOST not configured — skipping delivery to: ${to}`);
    return { skipped: true };
  }
  const from = process.env.SMTP_FROM || 'noreply@gadonghr.app';
  const to = Array.isArray(recipients) ? recipients.join(',') : recipients;
  await transporter.sendMail({
    from, to, subject, html,
    attachments: attachmentBuffer
      ? [{ filename: attachmentName, content: attachmentBuffer, contentType }]
      : [],
  });
  return { sent: true };
}

module.exports = { sendReportEmail, _resetTransporter: () => { _transporter = null; } };
