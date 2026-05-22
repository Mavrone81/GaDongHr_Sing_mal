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
      const u = await prisma.user.findUnique({
        where: { email: 'admin@hrms.com' },
        include: { role: { include: { permissions: { include: { permission: true } } } } }
      });
      const perms = u.role?.permissions.map(p => p.permission.code) || [];
      console.log(jwt.sign({
        sub: u.id, email: u.email, role: 'SUPER_ADMIN', employeeId: u.employeeId, permissions: perms
      }, fs.readFileSync('/app/certs/private.pem'), { algorithm: 'RS256', issuer: 'ezyhRM', expiresIn: '10m' }));
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

  console.log('\nUpdate e2e/lib/testUsers.ts with these IDs:');
  for (const role of ROLES) {
    const r = results[role];
    if (r) console.log(`  ${role}: { id: '${r.id}', email: '${r.email}', employeeId: null },`);
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
