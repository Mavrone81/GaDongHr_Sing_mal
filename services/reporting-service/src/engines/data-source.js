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

// ── Field catalog ─────────────────────────────────────────────────────────────
// Drives the Phase 2 drag-and-drop field picker on the frontend.
const FIELD_CATALOG = {
  employees: [
    { key: 'employeeCode',     label: 'Employee Code',      type: 'string' },
    { key: 'fullName',         label: 'Full Name',           type: 'string' },
    { key: 'department',       label: 'Department',          type: 'string' },
    { key: 'designation',      label: 'Designation',         type: 'string' },
    { key: 'employmentType',   label: 'Employment Type',     type: 'string' },
    { key: 'nationality',      label: 'Nationality',         type: 'string' },
    { key: 'gender',           label: 'Gender',              type: 'string' },
    { key: 'startDate',        label: 'Start Date',          type: 'date' },
    { key: 'endDate',          label: 'End Date',            type: 'date' },
    { key: 'isActive',         label: 'Active',              type: 'boolean' },
    { key: 'workEmail',        label: 'Work Email',          type: 'string' },
    { key: 'passType',         label: 'Pass Type',           type: 'string' },
    { key: 'citizenshipStatus',label: 'Citizenship Status',  type: 'string' },
    { key: 'basicSalary',      label: 'Basic Salary',        type: 'number' },
  ],
  payrollRuns: [
    { key: 'period',            label: 'Period',              type: 'string' },
    { key: 'runType',           label: 'Run Type',            type: 'string' },
    { key: 'status',            label: 'Status',              type: 'string' },
    { key: 'totalGross',        label: 'Total Gross',         type: 'number' },
    { key: 'totalNet',          label: 'Total Net',           type: 'number' },
    { key: 'totalEmployeeCpf',  label: 'Employee CPF',        type: 'number' },
    { key: 'totalEmployerCpf',  label: 'Employer CPF',        type: 'number' },
    { key: 'totalSdl',          label: 'Total SDL',           type: 'number' },
    { key: 'headcount',         label: 'Headcount',           type: 'number' },
    { key: 'createdAt',         label: 'Created At',          type: 'date' },
  ],
  leaveApplications: [
    { key: 'leaveTypeName',    label: 'Leave Type',           type: 'string' },
    { key: 'leaveTypeCode',    label: 'Leave Code',           type: 'string' },
    { key: 'startDate',        label: 'Start Date',           type: 'date' },
    { key: 'endDate',          label: 'End Date',             type: 'date' },
    { key: 'totalDays',        label: 'Total Days',           type: 'number' },
    { key: 'status',           label: 'Status',               type: 'string' },
    { key: 'reason',           label: 'Reason',               type: 'string' },
    { key: 'submittedAt',      label: 'Submitted At',         type: 'date' },
  ],
  attendance: [
    { key: 'employeeId',       label: 'Employee ID',          type: 'string' },
    { key: 'date',             label: 'Date',                  type: 'date' },
    { key: 'clockIn',          label: 'Clock In',             type: 'string' },
    { key: 'clockOut',         label: 'Clock Out',            type: 'string' },
    { key: 'hoursWorked',      label: 'Hours Worked',         type: 'number' },
    { key: 'billableHours',    label: 'Billable Hours',       type: 'number' },
    { key: 'billableOtHours',  label: 'Billable OT Hours',   type: 'number' },
    { key: 'method',           label: 'Clock Method',         type: 'string' },
    { key: 'status',           label: 'Status',               type: 'string' },
    { key: 'period',           label: 'Period',               type: 'string' },
  ],
  claims: [
    { key: 'employeeId',       label: 'Employee ID',          type: 'string' },
    { key: 'category',         label: 'Category',             type: 'string' },
    { key: 'amount',           label: 'Amount',               type: 'number' },
    { key: 'gstAmount',        label: 'GST Amount',           type: 'number' },
    { key: 'vendor',           label: 'Vendor',               type: 'string' },
    { key: 'purpose',          label: 'Purpose',              type: 'string' },
    { key: 'status',           label: 'Status',               type: 'string' },
    { key: 'submittedAt',      label: 'Submitted At',         type: 'date' },
    { key: 'approvedAt',       label: 'Approved At',          type: 'date' },
    { key: 'period',           label: 'Period',               type: 'string' },
  ],
};

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

module.exports = { FETCHERS, fetchDataSource, FIELD_CATALOG };
