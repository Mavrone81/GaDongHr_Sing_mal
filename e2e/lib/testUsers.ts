/**
 * Test user registry.
 *
 * Each role needs a real DB user in `hrms_auth.users` so /auth/me returns a row.
 * We don't need to know passwords because we forge JWTs against the auth-service
 * private key (see lib/jwt.ts). The login-flow specs (auth.spec.ts) need a real
 * password and use the dedicated `loginPassword` user.
 *
 * To populate missing rows, run: `npm run seed-test-users` (from e2e/).
 */

import * as fs from 'fs';
import * as path from 'path';
import { Role } from './roles';

export interface TestUserRecord {
  id: string;
  email: string;
  employeeId: string | null;
}

/**
 * `scripts/seed-test-users.js` writes the freshly-seeded ids here on every CI
 * run. The hardcoded ids below are only a local-dev fallback — each fresh DB
 * assigns new ids, so without this overlay the forged-JWT specs reference
 * users that don't exist and every /auth/me lookup 404s.
 */
function loadRuntimeOverrides(): Partial<Record<Role, TestUserRecord>> {
  try {
    const p = path.join(__dirname, 'testUsers.runtime.json');
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Filled in by scripts/seed-test-users.js. Each role gets exactly one
 * deterministic test account.
 */
export const TEST_USERS: Record<Role, TestUserRecord> = {
  SUPER_ADMIN: {
    id: '5a48426f-9ec8-49e6-b947-adf20b88975a',
    email: 'admin@hrms.com',
    employeeId: null,
  },
  ADMIN:            { id: 'b101ab62-0566-43ff-895c-9a68cbcc81b2', email: 'test-admin@example.com',            employeeId: null },
  IT_ADMIN:         { id: '28b3e8e4-d1e8-4ef1-b95c-bc88a3bb74c6', email: 'test-it-admin@example.com',         employeeId: null },
  HR_ADMIN:         { id: '5d8b8222-1bbf-42b1-b754-5152597e68f5', email: 'test-hr-admin@example.com',         employeeId: null },
  HR_MANAGER:       { id: '71f96a75-8fb4-4c99-bf00-7d85622c9753', email: 'test-hr-manager@example.com',       employeeId: null },
  PAYROLL_OFFICER:  { id: 'f526cdab-ef1d-4ce3-bec4-4e9ea75588cf', email: 'test-payroll-officer@example.com',  employeeId: null },
  FINANCE_ADMIN:    { id: '00b65ca3-223a-46a1-9bc7-29f6f3b8b317', email: 'test-finance-admin@example.com',    employeeId: null },
  LINE_MANAGER:     { id: '3a1fa86e-46c9-4517-ab02-075afdc8b94f', email: 'test-line-manager@example.com',     employeeId: null },
  RECRUITER:        { id: '5b3888d9-268e-463f-9a76-e9d405455961', email: 'test-recruiter@example.com',        employeeId: null },
  TRAINING_MANAGER: { id: 'fee4f7a8-9a9d-4f37-8c58-afcdf7bd7ca4', email: 'test-training-manager@example.com', employeeId: null },
  EMPLOYEE:         { id: '85d6d2ea-cac4-43da-bcff-bb7dfe6737e9', email: 'test-employee@example.com',         employeeId: null },
};

// Overlay the freshly-seeded ids (if scripts/seed-test-users.js wrote them).
const RUNTIME_OVERRIDES = loadRuntimeOverrides();
for (const role of Object.keys(RUNTIME_OVERRIDES) as Role[]) {
  const o = RUNTIME_OVERRIDES[role];
  if (o?.id && TEST_USERS[role]) {
    TEST_USERS[role] = { ...TEST_USERS[role], id: o.id, employeeId: o.employeeId ?? TEST_USERS[role].employeeId };
  }
}

/** Password used by the seed script and the real-login spec. */
export const TEST_PASSWORD = 'TestE2E@2026!';
