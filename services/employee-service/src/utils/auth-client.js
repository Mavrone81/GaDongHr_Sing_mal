'use strict';

const axios = require('axios');

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
      email: employee.workEmail,
      name: employee.fullName,
      password: '***REMOVED***',
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
