'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');

const app = express();
const PORT = process.env.PORT || 4010;
const PAYROLL_URL = process.env.PAYROLL_SERVICE_URL || 'http://payroll-service:4003';
const EMPLOYEE_URL = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';
const LEAVE_URL = process.env.LEAVE_SERVICE_URL || 'http://leave-service:4004';

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
app.get('/health', (req, res) => res.json({ service: 'reporting-service', status: 'ok', ts: new Date() }));

function authHeaders(req) { return { Authorization: req.headers['authorization'] }; }

// GET /reports/headcount
app.get('/reports/headcount', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const empRes = await axios.get(`${EMPLOYEE_URL}/employees?limit=1000`, { headers: authHeaders(req) });
    const employees = empRes.data.employees || [];
    const byDept = employees.reduce((acc, e) => { acc[e.department] = (acc[e.department] || 0) + 1; return acc; }, {});
    const byType = employees.reduce((acc, e) => { acc[e.employmentType] = (acc[e.employmentType] || 0) + 1; return acc; }, {});
    const active = employees.filter(e => e.isActive).length;
    res.json({ total: employees.length, active, inactive: employees.length - active, byDepartment: byDept, byEmploymentType: byType });
  } catch (err) { next(err); }
});

// GET /reports/payroll-summary/:period
app.get('/reports/payroll-summary/:period', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER, ROLES.FINANCE_ADMIN), async (req, res, next) => {
  try {
    const payRes = await axios.get(`${PAYROLL_URL}/payroll/runs?period=${req.params.period}`, { headers: authHeaders(req) });
    res.json(payRes.data);
  } catch (err) { next(err); }
});

// GET /reports/leave-utilisation
app.get('/reports/leave-utilisation', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const { year } = req.query;
    const leaveRes = await axios.get(`${LEAVE_URL}/leave/applications?limit=10000`, { headers: authHeaders(req) });
    const apps = leaveRes.data.applications || [];
    const byType = apps.reduce((acc, a) => {
      const k = a.leaveType?.name || 'Unknown';
      acc[k] = (acc[k] || 0) + a.totalDays;
      return acc;
    }, {});
    res.json({ year: year || new Date().getFullYear(), totalApplications: apps.length, byLeaveType: byType });
  } catch (err) { next(err); }
});

// GET /reports/cpf-submission/:period
app.get('/reports/cpf-submission/:period', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const runRes = await axios.get(`${PAYROLL_URL}/payroll/runs?period=${req.params.period}&status=FINALISED`, { headers: authHeaders(req) });
    const runs = runRes.data.runs || [];
    res.json({ period: req.params.period, runs: runs.length, message: 'Use /payroll/cpf-file/:runId to download the CPF e-Submit file' });
  } catch (err) { next(err); }
});

// GET /reports/work-pass-expiry
app.get('/reports/work-pass-expiry', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { daysAhead = 60 } = req.query;
    const cutoff = new Date(Date.now() + parseInt(daysAhead) * 24 * 60 * 60 * 1000);
    res.json({ message: `Work passes expiring within ${daysAhead} days`, cutoffDate: cutoff.toISOString().split('T')[0] });
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });
app.listen(PORT, () => console.log(`[reporting-service] Running on port ${PORT}`));
