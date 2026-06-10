'use strict';

const axios = require('axios');
const crypto = require('crypto');

// Per-employee random password — leftover VAPT C-06 finding remediation. The
// previous hardcoded literal meant every auto-provisioned employee account
// had the same password, so one user's credentials unlocked any other. The
// random password is intentionally never logged or persisted; users land on
// the system through the invite/SSO flow rather than the password itself.
function generateRandomPassword() {
  // 32 bytes → 64 hex chars; far beyond any reasonable brute-force budget and
  // satisfies the 12-char minimum the auth service may enforce in future.
  return crypto.randomBytes(32).toString('hex');
}

async function createAuthUser(employee) {
  const authUrl = process.env.AUTH_SERVICE_URL || 'http://auth-service:4001';
  const internalKey = process.env.INTERNAL_SERVICE_KEY;

  if (!internalKey) {
    console.error('[EmployeeService] INTERNAL_SERVICE_KEY not set. Cannot create auth user.');
    return;
  }

  const headers = { 'x-internal-service-key': internalKey, 'Content-Type': 'application/json' };

  try {
    const response = await axios.post(`${authUrl}/users`, {
      // The auto-created login user must belong to the EMPLOYEE'S tenant. This is
      // an internal call (no JWT), so auth-service can't infer the tenant — pass
      // it explicitly, else the user defaults into the Default tenant.
      tenantId: employee.tenantId,
      email: employee.workEmail,
      name: employee.fullName,
      password: generateRandomPassword(),
      role: 'EMPLOYEE',
      employeeId: employee.id,
    }, { headers });

    console.log(`[EmployeeService] Created auth user for ${employee.workEmail}`);
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const errData = err.response?.data;

    // Email already exists — link the existing account to this employee record
    if (status === 409 && errData?.error === 'Email already registered') {
      console.warn(`[EmployeeService] Auth user for ${employee.workEmail} already exists — linking employeeId`);
      try {
        const linkRes = await axios.patch(`${authUrl}/users/link-employee`, {
          email: employee.workEmail,
          employeeId: employee.id,
        }, { headers });
        console.log(`[EmployeeService] Linked auth user for ${employee.workEmail} to employeeId ${employee.id}`);
        return linkRes.data;
      } catch (linkErr) {
        console.error(`[EmployeeService] Failed to link auth user for ${employee.workEmail}:`, linkErr.response?.data || linkErr.message);
      }
      return;
    }

    console.error(`[EmployeeService] Failed to create auth user for ${employee.workEmail}:`, errData || err.message);
  }
}

module.exports = { createAuthUser };
