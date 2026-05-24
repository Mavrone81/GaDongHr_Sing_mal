'use strict';
/**
 * RPT-003 Phase 1 — data source fetchers.
 *
 * Each data source returns a flat array of rows. axios calls are made with the
 * caller's auth header so RBAC at the source service is respected.
 *
 * The list of sources is intentionally bounded — RPT-003 lets users build
 * reports over canonical data shapes, not arbitrary tables.
 */

const axios = require('axios');

const PAYROLL_URL    = process.env.PAYROLL_SERVICE_URL    || 'http://payroll-service:4003';
const EMPLOYEE_URL   = process.env.EMPLOYEE_SERVICE_URL   || 'http://employee-service:4002';
const LEAVE_URL      = process.env.LEAVE_SERVICE_URL      || 'http://leave-service:4004';
const ATTENDANCE_URL = process.env.ATTENDANCE_SERVICE_URL || 'http://attendance-service:4007';
const CLAIMS_URL     = process.env.CLAIMS_SERVICE_URL     || 'http://claims-service:4005';

async function fetchEmployees(authHeader) {
  const { data } = await axios.get(`${EMPLOYEE_URL}/employees?limit=5000`, {
    headers: { Authorization: authHeader },
    timeout: 15000,
  });
  return data.employees || [];
}

async function fetchPayrollRuns(authHeader) {
  const { data } = await axios.get(`${PAYROLL_URL}/payroll/runs?limit=5000`, {
    headers: { Authorization: authHeader },
    timeout: 15000,
  });
  return data.runs || data || [];
}

async function fetchLeaveApplications(authHeader) {
  const { data } = await axios.get(`${LEAVE_URL}/leave/applications?limit=10000`, {
    headers: { Authorization: authHeader },
    timeout: 15000,
  });
  return (data.applications || []).map(a => ({
    ...a,
    leaveTypeName: a.leaveType?.name,
    leaveTypeCode: a.leaveType?.code,
  }));
}

async function fetchAttendance(authHeader) {
  const { data } = await axios.get(`${ATTENDANCE_URL}/attendance/records?limit=10000`, {
    headers: { Authorization: authHeader },
    timeout: 15000,
  });
  return data.records || data || [];
}

async function fetchClaims(authHeader) {
  const { data } = await axios.get(`${CLAIMS_URL}/claims?limit=10000`, {
    headers: { Authorization: authHeader },
    timeout: 15000,
  });
  return data.claims || data || [];
}

const FETCHERS = {
  employees: fetchEmployees,
  payrollRuns: fetchPayrollRuns,
  leaveApplications: fetchLeaveApplications,
  attendance: fetchAttendance,
  claims: fetchClaims,
};

async function fetchDataSource(dataSource, authHeader) {
  const fn = FETCHERS[dataSource];
  if (!fn) throw new Error(`Unknown dataSource: ${dataSource}`);
  return fn(authHeader);
}

module.exports = { FETCHERS, fetchDataSource };
