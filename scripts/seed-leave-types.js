'use strict';
// Seed default Singapore Employment Act leave types
// Usage: node scripts/seed-leave-types.js

const http = require('http');

const AUTH_URL = 'http://localhost:4001';
const GATEWAY  = 'http://localhost:4000';

async function request(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname, port: parsed.port || 80,
      path: parsed.pathname + parsed.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const LEAVE_TYPES = [
  // ── Statutory ─────────────────────────────────────────────────────────────
  {
    code: 'AL',
    name: 'Annual Leave',
    isPaid: true, isStatutory: true, isGovtPaid: false,
    annualEntitlement: 14,   // minimum 7 by EA; 14 is common
    maxCarryForward: 5,
    requiresDocument: false,
    minNoticeDays: 3,
  },
  {
    code: 'SL',
    name: 'Sick Leave (Outpatient)',
    isPaid: true, isStatutory: true, isGovtPaid: false,
    annualEntitlement: 14,   // EA minimum
    maxCarryForward: 0,
    requiresDocument: true,  // MC required
    minNoticeDays: 0,
  },
  {
    code: 'HL',
    name: 'Hospitalisation Leave',
    isPaid: true, isStatutory: true, isGovtPaid: false,
    annualEntitlement: 60,   // includes SL days
    maxCarryForward: 0,
    requiresDocument: true,
    minNoticeDays: 0,
  },
  {
    code: 'ML',
    name: 'Maternity Leave',
    isPaid: true, isStatutory: true, isGovtPaid: true,  // weeks 9–16 govt-paid
    annualEntitlement: 112,  // 16 weeks in days
    maxCarryForward: 0,
    requiresDocument: true,
    minNoticeDays: 0,
  },
  {
    code: 'PL',
    name: 'Paternity Leave',
    isPaid: true, isStatutory: true, isGovtPaid: true,  // fully govt-paid
    annualEntitlement: 14,   // 2 weeks
    maxCarryForward: 0,
    requiresDocument: true,
    minNoticeDays: 0,
  },
  {
    code: 'CCL',
    name: 'Childcare Leave',
    isPaid: true, isStatutory: true, isGovtPaid: true,  // govt portion for qualifying
    annualEntitlement: 6,
    maxCarryForward: 0,
    requiresDocument: false,
    minNoticeDays: 1,
  },
  {
    code: 'ECCL',
    name: 'Extended Childcare Leave',
    isPaid: true, isStatutory: true, isGovtPaid: false,
    annualEntitlement: 2,    // child 7–12 yrs
    maxCarryForward: 0,
    requiresDocument: false,
    minNoticeDays: 1,
  },
  {
    code: 'SPL',
    name: 'Shared Parental Leave',
    isPaid: true, isStatutory: true, isGovtPaid: true,
    annualEntitlement: 28,   // up to 4 weeks shared from maternity
    maxCarryForward: 0,
    requiresDocument: true,
    minNoticeDays: 0,
  },
  {
    code: 'NSL',
    name: 'National Service / Reservist Leave',
    isPaid: true, isStatutory: true, isGovtPaid: true,  // MINDEF pays makeup pay
    annualEntitlement: 0,    // as per call-up duration
    maxCarryForward: 0,
    requiresDocument: true,
    minNoticeDays: 0,
  },
  // ── Company Leave ─────────────────────────────────────────────────────────
  {
    code: 'CL',
    name: 'Compassionate Leave',
    isPaid: true, isStatutory: false, isGovtPaid: false,
    annualEntitlement: 3,
    maxCarryForward: 0,
    requiresDocument: false,
    minNoticeDays: 0,
  },
  {
    code: 'MARR',
    name: 'Marriage Leave',
    isPaid: true, isStatutory: false, isGovtPaid: false,
    annualEntitlement: 3,
    maxCarryForward: 0,
    requiresDocument: true,
    minNoticeDays: 7,
  },
  {
    code: 'EXAM',
    name: 'Examination Leave',
    isPaid: true, isStatutory: false, isGovtPaid: false,
    annualEntitlement: 5,
    maxCarryForward: 0,
    requiresDocument: true,
    minNoticeDays: 14,
  },
  {
    code: 'OFF',
    name: 'Off-in-Lieu',
    isPaid: true, isStatutory: false, isGovtPaid: false,
    annualEntitlement: 0,    // accrued per overtime
    maxCarryForward: 5,
    requiresDocument: false,
    minNoticeDays: 1,
  },
  {
    code: 'NPL',
    name: 'No-Pay Leave',
    isPaid: false, isStatutory: false, isGovtPaid: false,
    annualEntitlement: 0,    // on approval
    maxCarryForward: 0,
    requiresDocument: false,
    minNoticeDays: 3,
  },
];

async function main() {
  console.log('🔐 Logging in...');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD
    ?? (process.env.NODE_ENV === 'production' ? null : '***REMOVED***');
  if (!adminPassword) {
    console.error('SEED_ADMIN_PASSWORD env var required when NODE_ENV=production'); process.exit(1);
  }
  const loginRes = await request('POST', `${AUTH_URL}/auth/login`, { email: 'admin@vorkhive.sg', password: adminPassword });
  if (!loginRes.body.accessToken) { console.error('Login failed:', loginRes.body); process.exit(1); }
  const TOKEN = loginRes.body.accessToken;
  console.log('✅ Logged in\n');

  // Check existing types
  const existRes = await request('GET', `${GATEWAY}/api/leave/types?all=true`, null, TOKEN);
  const existing = Array.isArray(existRes.body) ? existRes.body : [];
  const existingCodes = new Set(existing.map(t => t.code));
  console.log(`ℹ️  ${existingCodes.size} leave types already exist\n`);

  console.log('📋 Seeding leave types...');
  let created = 0, skipped = 0;
  for (const lt of LEAVE_TYPES) {
    if (existingCodes.has(lt.code)) {
      console.log(`   ⏭️  ${lt.code.padEnd(6)} ${lt.name} — already exists`);
      skipped++;
      continue;
    }
    const r = await request('POST', `${GATEWAY}/api/leave/types`, lt, TOKEN);
    if (r.status === 201) {
      console.log(`   ✅ ${lt.code.padEnd(6)} ${lt.name}`);
      created++;
    } else {
      console.log(`   ⚠️  ${lt.code.padEnd(6)} ${lt.name} — ${JSON.stringify(r.body)}`);
    }
  }

  console.log(`\n🎉 Done — ${created} created, ${skipped} skipped`);
}

main().catch(e => { console.error(e); process.exit(1); });
