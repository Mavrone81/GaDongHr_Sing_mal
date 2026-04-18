'use strict';

const axios = require('axios');

async function createAuthUser(employee) {
  const authUrl = process.env.AUTH_SERVICE_URL || 'http://auth-service:4001';
  const internalKey = process.env.INTERNAL_SERVICE_KEY;

  if (!internalKey) {
    console.error('[EmployeeService] INTERNAL_SERVICE_KEY not set. Cannot create auth user.');
    return;
  }

  try {
    const response = await axios.post(`${authUrl}/users`, {
      email: employee.workEmail,
      name: employee.fullName,
      password: 'EzyHRM@2025!', // Default temporary password
      role: 'EMPLOYEE',
      employeeId: employee.id
    }, {
      headers: {
        'x-internal-service-key': internalKey,
        'Content-Type': 'application/json'
      }
    });

    console.log(`[EmployeeService] Successfully created auth user for ${employee.workEmail}`);
    return response.data;
  } catch (err) {
    console.error(`[EmployeeService] Failed to create auth user for ${employee.workEmail}:`, err.response?.data || err.message);
    // We don't throw here to avoid failing employee creation if auth-service is down
  }
}

module.exports = { createAuthUser };
