'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const prisma = require('../utils/prisma');
const { signAccessToken } = require('../utils/jwt.utils');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const EMPLOYEE_SVC  = process.env.EMPLOYEE_SERVICE_URL  || 'http://employee-service:4002';
const PAYROLL_SVC   = process.env.PAYROLL_SERVICE_URL   || 'http://payroll-service:4003';
const LEAVE_SVC     = process.env.LEAVE_SERVICE_URL     || 'http://leave-service:4004';

// Returns the oldest date (UTC midnight) for which retention period has expired.
// Records with eventDate <= cutoff have been retained for exactly retentionYears years.
function cutoffDate(retentionYears) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(d.getUTCFullYear() - retentionYears);
  return d;
}

async function getRetentionConfig() {
  try {
    const row = await prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'retentionPeriods' LIMIT 1`;
    if (row[0]?.value) return JSON.parse(row[0].value);
  } catch {}
  return { employeeRecords: 7, payrollRecords: 5, leaveRecords: 3, recruitmentRecords: 2, auditLogs: 7 };
}

function svcToken() {
  return signAccessToken({ sub: 'purge-service', role: 'SUPER_ADMIN', permissions: ['*'] });
}

async function callPurge(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${svcToken()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${res.status} from ${url}`); }
  return res.json();
}

// Core purge executor — called both from the HTTP route and the scheduler
async function executePurge(config) {
  const results = {};
  const errors = [];
  const runAt = new Date().toISOString();

  // 1. Purge auth-service audit_logs
  try {
    const cutoff = cutoffDate(config.auditLogs);
    const r = await prisma.$executeRaw`
      DELETE FROM audit_logs WHERE "createdAt" <= ${cutoff}
    `;
    // VACUUM must run outside a transaction — use a separate execute call
    await prisma.$executeRawUnsafe('VACUUM ANALYZE audit_logs').catch(() => {});
    results.auditLogs = { purged: r, cutoff: cutoff.toISOString().slice(0, 10) };
  } catch (e) { errors.push(`auditLogs: ${e.message}`); }

  // 2. Employee records
  try {
    const r = await callPurge(`${EMPLOYEE_SVC}/employees/purge`, { retentionYears: config.employeeRecords });
    results.employees = r;
  } catch (e) { errors.push(`employees: ${e.message}`); }

  // 3. Payroll records
  try {
    const r = await callPurge(`${PAYROLL_SVC}/payroll/purge`, { retentionYears: config.payrollRecords });
    results.payroll = r;
  } catch (e) { errors.push(`payroll: ${e.message}`); }

  // 4. Leave records
  try {
    const r = await callPurge(`${LEAVE_SVC}/leave/purge`, { retentionYears: config.leaveRecords });
    results.leave = r;
  } catch (e) { errors.push(`leave: ${e.message}`); }

  // Store last run summary
  const summary = { runAt, results, errors, status: errors.length === 0 ? 'clean' : 'partial' };
  try {
    // Append to purge log (keep last 30 runs)
    const existing = await prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'purgeLog' LIMIT 1`;
    let log = [];
    try { log = JSON.parse(existing[0]?.value ?? '[]'); } catch {}
    log.unshift(summary);
    if (log.length > 30) log = log.slice(0, 30);
    const val = JSON.stringify(log);
    await prisma.$executeRaw`
      INSERT INTO org_settings (key, value, "updatedAt") VALUES ('purgeLog', ${val}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${val}, "updatedAt" = now()
    `;
  } catch {}

  return summary;
}

// POST /auth/purge/run — manual trigger (SUPER_ADMIN only)
router.post('/run', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const config = await getRetentionConfig();
    const summary = await executePurge(config);
    res.json(summary);
  } catch (err) { next(err); }
});

// GET /auth/purge/status — last run info + upcoming schedule
router.get('/status', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const [logRow, configRow, schedRow] = await Promise.all([
      prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'purgeLog' LIMIT 1`,
      prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'retentionPeriods' LIMIT 1`,
      prisma.$queryRaw`SELECT value FROM org_settings WHERE key = 'purgeScheduleEnabled' LIMIT 1`,
    ]);
    let log = [];
    try { log = JSON.parse(logRow[0]?.value ?? '[]'); } catch {}
    let retention = { employeeRecords: 7, payrollRecords: 5, leaveRecords: 3, recruitmentRecords: 2, auditLogs: 7 };
    try { if (configRow[0]?.value) retention = JSON.parse(configRow[0].value); } catch {}
    const scheduleEnabled = (schedRow[0]?.value) === 'true';

    // Next midnight UTC
    const now = new Date();
    const nextRun = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

    res.json({ log, retention, scheduleEnabled, nextScheduledRun: nextRun.toISOString() });
  } catch (err) { next(err); }
});

// PUT /auth/purge/schedule — enable or disable scheduled purge
router.put('/schedule', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const { enabled } = req.body;
    const val = enabled ? 'true' : 'false';
    await prisma.$executeRaw`
      INSERT INTO org_settings (key, value, "updatedAt") VALUES ('purgeScheduleEnabled', ${val}, now())
      ON CONFLICT (key) DO UPDATE SET value = ${val}, "updatedAt" = now()
    `;
    res.json({ scheduleEnabled: enabled });
  } catch (err) { next(err); }
});

// Export executePurge and getRetentionConfig for use by the scheduler in index.js
module.exports = router;
module.exports.executePurge = executePurge;
module.exports.getRetentionConfig = getRetentionConfig;
