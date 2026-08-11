#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Seed one test user per role for the E2E suite.
 *
 * Strategy:
 *   1. Mint a SUPER_ADMIN JWT using the auth-service's signing key.
 *   2. For each role, POST /api/users to create the user (or update its role).
 *   3. Print the resulting user_id so e2e/lib/testUsers.ts can be updated.
 *
 * Idempotent: re-running picks up existing users by email and updates their role.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const API_BASE = process.env.E2E_API_URL || 'http://localhost:4000/api';
const PASSWORD = process.env.TEST_PASSWORD || 'TestE2E@2026!';

const ROLES = [
  'ADMIN', 'IT_ADMIN', 'HR_ADMIN', 'HR_MANAGER',
  'PAYROLL_OFFICER', 'FINANCE_ADMIN', 'LINE_MANAGER',
  'RECRUITER', 'TRAINING_MANAGER', 'EMPLOYEE',
];

function mintSuperAdminToken() {
  const script = `
    const jwt = require('jsonwebtoken');
    const fs = require('fs');
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    (async () => {
      // findFirst, not findUnique. Email stopped being unique on its own when
      // multi-tenancy landed - User is now unique on (tenantId, email) - and
      // findUnique rejects a where-clause that is not a full unique key, which
      // is what broke the e2e seed. This script has no tenantId to hand, and a
      // freshly seeded CI stack has exactly one tenant, so findFirst is both
      // correct and sufficient. No backticks in here: this whole block is
      // embedded in a template literal and then shell-escaped into docker exec.
      const u = await prisma.user.findFirst({
        where: { email: 'admin@hrms.com' },
        include: { role: { include: { permissions: { include: { permission: true } } } } }
      });
      const perms = u.role?.permissions.map(p => p.permission.code) || [];
      console.log(jwt.sign({
        sub: u.id, email: u.email, role: 'SUPER_ADMIN', employeeId: u.employeeId, permissions: perms
      }, fs.readFileSync('/app/certs/private.pem'), { algorithm: 'RS256', issuer: 'gadonghr', expiresIn: '10m' }));
      await prisma.$disconnect();
    })();
  `.trim();
  const cmd = `docker exec hrms-auth node -e "${script.replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`;
  return execSync(cmd).toString().trim();
}

async function findOrCreateUser(token, email, role) {
  const headers = { Authorization: `Bearer ${token}` };
  // Try to find first
  const list = await axios.get(`${API_BASE}/users?limit=200`, { headers }).catch(e => {
    throw new Error(`GET /users failed: ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
  });
  const existing = (list.data.users || list.data || []).find(u => u.email === email);

  if (existing) {
    // Update its role
    await axios.put(`${API_BASE}/users/${existing.id}`, { role }, { headers });
    return { id: existing.id, email, updated: true };
  }

  // Create
  const created = await axios.post(`${API_BASE}/users`, {
    name: `Test ${role}`,
    email,
    password: PASSWORD,
    role,
  }, { headers });
  return { id: created.data.id, email, updated: false };
}

(async () => {
  console.log(`Seeding test users to ${API_BASE} ...`);
  const token = mintSuperAdminToken();
  const results = {};

  for (const role of ROLES) {
    const email = `test-${role.toLowerCase().replace(/_/g, '-')}@example.com`;
    try {
      const r = await findOrCreateUser(token, email, role);
      results[role] = r;
      console.log(`  ${r.updated ? '↻' : '✓'} ${role.padEnd(18)} ${email}  (id=${r.id})`);
    } catch (err) {
      console.error(`  ✗ ${role.padEnd(18)} ${email}  -- ${err.message}`);
    }
  }

  // SUPER_ADMIN is the bootstrap admin (admin@hrms.com), created by the auth
  // container's seed with a random id — resolve it so SUPER_ADMIN-scoped specs
  // that hit /auth/me (which looks the user up by id) also match a real row.
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@hrms.com').toLowerCase();
  try {
    const list = await axios.get(`${API_BASE}/users?limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const admin = (list.data.users || list.data || []).find(u => (u.email || '').toLowerCase() === adminEmail);
    if (admin) results.SUPER_ADMIN = { id: admin.id, email: admin.email };
  } catch (err) {
    console.error(`  ✗ could not resolve SUPER_ADMIN (${adminEmail}) -- ${err.message}`);
  }

  // Write the freshly-seeded ids to a runtime file that lib/testUsers.ts loads,
  // so forged-JWT specs reference users that actually exist. Without this the
  // hardcoded ids drift from each fresh DB and every /auth/me lookup 404s,
  // breaking the smoke/login/role specs.
  const runtime = {};
  for (const role of [...ROLES, 'SUPER_ADMIN']) {
    const r = results[role];
    if (r) runtime[role] = { id: r.id, email: r.email, employeeId: r.employeeId ?? null };
  }
  const outPath = path.join(__dirname, '..', 'lib', 'testUsers.runtime.json');
  fs.writeFileSync(outPath, JSON.stringify(runtime, null, 2) + '\n');
  console.log(`\nWrote ${Object.keys(runtime).length} ids -> ${outPath}`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
