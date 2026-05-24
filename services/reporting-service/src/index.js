'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const builderRoutes = require('./routes/builder.routes');
const { tick: schedulerTick } = require('./scheduler-tick');

const app = express();
const PORT = process.env.PORT || 4010;
const PAYROLL_URL    = process.env.PAYROLL_SERVICE_URL   || 'http://payroll-service:4003';
const EMPLOYEE_URL   = process.env.EMPLOYEE_SERVICE_URL  || 'http://employee-service:4002';
const LEAVE_URL      = process.env.LEAVE_SERVICE_URL     || 'http://leave-service:4004';
const INTERNAL_KEY   = process.env.INTERNAL_SERVICE_KEY  || '';

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '100kb' })); app.use(morgan('combined'));
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

// GET /reports/leave-liability?year=YYYY
app.get('/reports/leave-liability', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.FINANCE_ADMIN), async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const [empRes, balRes] = await Promise.all([
      axios.get(`${EMPLOYEE_URL}/employees?limit=1000&isActive=true`, { headers: authHeaders(req) }),
      axios.get(`${LEAVE_URL}/leave/internal/all-balances?year=${year}`, { headers: { 'x-internal-service-key': INTERNAL_KEY } }),
    ]);

    const employees = empRes.data.employees || [];
    const balanceMap = {};
    for (const b of (balRes.data || [])) balanceMap[b.employeeId] = b.balances;

    let totalLiability = 0;
    const byDepartment = {};
    const rows = [];

    for (const emp of employees) {
      const salary = parseFloat(emp.basicSalary) || 0;
      if (!salary) continue;
      const dailyRate = Math.round((salary / 26) * 100) / 100;
      const balances = balanceMap[emp.id] || [];
      const paidLeaves = balances.filter(b => b.isPaid && b.entitledDays !== null);

      for (const b of paidLeaves) {
        const unusedDays = Math.max(0, (b.entitledDays + b.carryForward - b.usedDays - b.pendingDays));
        const liability = Math.round(unusedDays * dailyRate * 100) / 100;
        totalLiability += liability;
        if (!byDepartment[emp.department]) byDepartment[emp.department] = 0;
        byDepartment[emp.department] += liability;
        rows.push({
          employeeId: emp.id, employeeCode: emp.employeeCode, fullName: emp.fullName,
          department: emp.department, leaveType: b.name, leaveCode: b.code,
          entitledDays: b.entitledDays, carryForward: b.carryForward,
          usedDays: b.usedDays, pendingDays: b.pendingDays, unusedDays,
          dailyRate, liability,
        });
      }
    }

    // Round dept totals
    for (const dept of Object.keys(byDepartment)) byDepartment[dept] = Math.round(byDepartment[dept] * 100) / 100;

    res.json({
      year, generatedAt: new Date().toISOString(),
      totalLiability: Math.round(totalLiability * 100) / 100,
      headcount: employees.length, byDepartment, rows,
    });
  } catch (err) { next(err); }
});

// GET /reports/ir8a-data/:year
app.get('/reports/ir8a-data/:year', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { year } = req.params;
    const payRes = await axios.get(`${PAYROLL_URL}/payroll/ir8a-data/${year}`, { headers: authHeaders(req) });
    res.json(payRes.data);
  } catch (err) {
    if (err.response) return res.status(err.response.status).json(err.response.data);
    next(err);
  }
});

// GET /reports/ir8a-file/:year
app.get('/reports/ir8a-file/:year', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { year } = req.params;
    const payRes = await axios.get(`${PAYROLL_URL}/payroll/ir8a-file/${year}`, { headers: authHeaders(req), responseType: 'text' });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=IR8A-${year}.txt`);
    res.send(payRes.data);
  } catch (err) {
    if (err.response) return res.status(err.response.status).json(err.response.data);
    next(err);
  }
});

// RPT-003 Phase 1 — report builder + schedules mounted under /reports
app.use('/reports', builderRoutes);

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Internal server error' }); });

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[reporting-service] Running on port ${PORT}`);
    // Scheduler tick: run shortly after startup, then hourly.
    setTimeout(() => {
      schedulerTick(new Date())
        .then(r => r.due > 0 && console.log(`[reporting-service] Scheduler tick: due=${r.due}`))
        .catch(err => console.error('[reporting-service] Scheduler startup tick error:', err));
      setInterval(() => {
        schedulerTick(new Date())
          .then(r => r.due > 0 && console.log(`[reporting-service] Scheduler tick: due=${r.due}`))
          .catch(err => console.error('[reporting-service] Scheduler hourly tick error:', err));
      }, 60 * 60 * 1000);
    }, 45000);
  });
}

module.exports = { app };
