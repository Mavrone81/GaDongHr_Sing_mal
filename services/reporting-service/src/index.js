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
const PAYROLL_URL      = process.env.PAYROLL_SERVICE_URL    || 'http://payroll-service:4003';
const EMPLOYEE_URL     = process.env.EMPLOYEE_SERVICE_URL   || 'http://employee-service:4002';
const LEAVE_URL        = process.env.LEAVE_SERVICE_URL      || 'http://leave-service:4004';
const ATTENDANCE_URL   = process.env.ATTENDANCE_SERVICE_URL || 'http://attendance-service:4007';
const TRAINING_URL     = process.env.TRAINING_SERVICE_URL   || 'http://training-service:4013';
const INTERNAL_KEY     = process.env.INTERNAL_SERVICE_KEY   || '';

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

// ── RPT-002 — Statutory Reports ───────────────────────────────────────────────

const PAYROLL_URL2   = process.env.PAYROLL_SERVICE_URL  || 'http://payroll-service:4003';
const EMPLOYEE_URL2  = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';

let _prismaRpt;
function getPrisma() {
  if (!_prismaRpt) {
    const { PrismaClient } = require('@prisma/client');
    _prismaRpt = new PrismaClient();
  }
  return _prismaRpt;
}

// GET /reports/fwl/:period — FWL amounts per WP/S-Pass employee for a period
app.get('/reports/fwl/:period',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const { period } = req.params;
      const auth = authHeaders(req);

      // 1. Get FINALISED runs for the period
      const runsRes = await axios.get(`${PAYROLL_URL2}/payroll/runs?period=${period}&status=FINALISED`, { headers: auth });
      const runs = runsRes.data.runs || [];
      if (!runs.length) return res.json({ period, message: 'No finalised runs for this period', rows: [], totals: { totalFwl: 0, byPassType: {} } });

      // 2. Collect payslips from all runs; key by employeeId (last run wins)
      const payslipByEmp = {};
      for (const run of runs) {
        const psRes = await axios.get(`${PAYROLL_URL2}/payroll/runs/${run.id}/payslips`, { headers: auth });
        for (const ps of (psRes.data.payslips || [])) {
          if ((ps.fwl || 0) > 0) payslipByEmp[ps.employeeId] = ps;
        }
      }

      const empIds = Object.keys(payslipByEmp);
      if (!empIds.length) return res.json({ period, message: 'No FWL-liable employees found', rows: [], totals: { totalFwl: 0, byPassType: {} } });

      // 3. Fetch employee records for pass type / name / NRIC
      const empRes = await axios.get(`${EMPLOYEE_URL2}/employees?limit=2000`, { headers: auth });
      const empMap = {};
      for (const e of (empRes.data.employees || [])) empMap[e.id] = e;

      // 4. Build report rows
      const rows = [];
      let totalFwl = 0;
      const byPassType = {};

      for (const empId of empIds) {
        const ps  = payslipByEmp[empId];
        const emp = empMap[empId] || {};
        const passType = emp.workPassType || emp.passType || 'UNKNOWN';
        const fwl = parseFloat(ps.fwl) || 0;

        rows.push({
          employeeId:   empId,
          employeeCode: emp.employeeCode || null,
          fullName:     emp.fullName     || null,
          nric:         emp.nric || emp.fin || null,
          nationality:  emp.nationality  || null,
          passType,
          fwlAmount:    Math.round(fwl * 100) / 100,
          period,
        });

        totalFwl += fwl;
        byPassType[passType] = (byPassType[passType] || 0) + fwl;
      }

      for (const k of Object.keys(byPassType)) byPassType[k] = Math.round(byPassType[k] * 100) / 100;

      rows.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
      res.json({
        period,
        generatedAt: new Date().toISOString(),
        totalEmployees: rows.length,
        totals: { totalFwl: Math.round(totalFwl * 100) / 100, byPassType },
        rows,
      });
    } catch (err) { next(err); }
  }
);

// GET /reports/sdl-summary/:period — SDL computation summary for SSG submission
app.get('/reports/sdl-summary/:period',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const { period } = req.params;
      const auth = authHeaders(req);

      const runsRes = await axios.get(`${PAYROLL_URL2}/payroll/runs?period=${period}&status=FINALISED`, { headers: auth });
      const runs = runsRes.data.runs || [];
      if (!runs.length) return res.json({ period, message: 'No finalised runs for this period', rows: [], totalSdl: 0 });

      const payslipByEmp = {};
      for (const run of runs) {
        const psRes = await axios.get(`${PAYROLL_URL2}/payroll/runs/${run.id}/payslips`, { headers: auth });
        for (const ps of (psRes.data.payslips || [])) {
          const sdl = parseFloat(ps.sdl) || 0;
          if (sdl > 0) {
            if (!payslipByEmp[ps.employeeId] || sdl > payslipByEmp[ps.employeeId].sdl) {
              payslipByEmp[ps.employeeId] = { ...ps, sdl };
            }
          }
        }
      }

      const empRes = await axios.get(`${EMPLOYEE_URL2}/employees?limit=2000`, { headers: auth });
      const empMap = {};
      for (const e of (empRes.data.employees || [])) empMap[e.id] = e;

      let totalSdl = 0;
      const rows = Object.entries(payslipByEmp).map(([empId, ps]) => {
        const emp = empMap[empId] || {};
        totalSdl += ps.sdl;
        return {
          employeeId: empId,
          employeeCode: emp.employeeCode || null,
          fullName: emp.fullName || null,
          grossPay: parseFloat(ps.grossPay) || 0,
          sdlAmount: ps.sdl,
        };
      });

      rows.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));

      res.json({
        period,
        generatedAt: new Date().toISOString(),
        totalEmployees: rows.length,
        totalSdl: Math.round(totalSdl * 100) / 100,
        ssgSubmissionNote: `Total SDL payable for ${period}: SGD ${(Math.round(totalSdl * 100) / 100).toFixed(2)}. Submit via CPF e-Submit portal.`,
        rows,
      });
    } catch (err) { next(err); }
  }
);

// GET /reports/mom-headcount — MOM Monthly Headcount Report
// Query params: year, month (1-12) — defaults to current month
app.get('/reports/mom-headcount',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER),
  async (req, res, next) => {
    try {
      const now = new Date();
      const year  = parseInt(req.query.year)  || now.getFullYear();
      const month = parseInt(req.query.month) || now.getMonth() + 1;

      const auth = authHeaders(req);
      const empRes = await axios.get(`${EMPLOYEE_URL2}/employees?limit=2000`, { headers: auth });
      const employees = empRes.data.employees || [];

      // MOM categories
      const byNationality = {};
      const byEmploymentType = {};
      const byPassType = { SC: 0, PR: 0, EP: 0, S_PASS: 0, WP: 0, DP: 0, OTHER: 0 };

      let totalActive = 0;
      let residents = 0;
      let foreigners = 0;
      let maleCount = 0;
      let femaleCount = 0;
      let newHires = 0;
      let terminations = 0;

      const periodStart = new Date(year, month - 1, 1);
      const periodEnd   = new Date(year, month, 0, 23, 59, 59);

      for (const e of employees) {
        if (!e.isActive) continue;
        totalActive++;

        const nat = e.nationality || 'Unknown';
        byNationality[nat] = (byNationality[nat] || 0) + 1;

        const empType = e.employmentType || 'Unknown';
        byEmploymentType[empType] = (byEmploymentType[empType] || 0) + 1;

        const pass = (e.workPassType || e.passType || '').toUpperCase();
        if (pass === 'SC' || e.nationality === 'Singapore Citizen') { byPassType.SC++; residents++; }
        else if (pass === 'PR') { byPassType.PR++; residents++; }
        else if (pass === 'EP' || pass === 'EMPLOYMENT_PASS') { byPassType.EP++; foreigners++; }
        else if (pass === 'S_PASS' || pass === 'SPASS') { byPassType.S_PASS++; foreigners++; }
        else if (pass === 'WP' || pass === 'WORK_PERMIT') { byPassType.WP++; foreigners++; }
        else if (pass === 'DP' || pass === 'DEPENDANT_PASS') { byPassType.DP++; foreigners++; }
        else { byPassType.OTHER++; }

        const gender = (e.gender || '').toUpperCase();
        if (gender === 'MALE' || gender === 'M') maleCount++;
        else if (gender === 'FEMALE' || gender === 'F') femaleCount++;

        // New hires: joinDate within the reporting month
        if (e.joinDate) {
          const jd = new Date(e.joinDate);
          if (jd >= periodStart && jd <= periodEnd) newHires++;
        }
        // Terminations: use lastWorkingDate or resignationDate if present
        const termDate = e.lastWorkingDate || e.resignationDate;
        if (termDate) {
          const td = new Date(termDate);
          if (td >= periodStart && td <= periodEnd) terminations++;
        }
      }

      const netChange = newHires - terminations;

      res.json({
        reportType: 'MOM_MONTHLY_HEADCOUNT',
        year,
        month,
        period: `${year}-${String(month).padStart(2, '0')}`,
        generatedAt: new Date().toISOString(),
        summary: {
          totalActive,
          residents,
          foreigners,
          male: maleCount,
          female: femaleCount,
          newHires,
          terminations,
          netChange,
        },
        byNationality,
        byEmploymentType,
        byPassType,
        momFormatNote: 'Submit via MOM iSubmit portal (mom.gov.sg/isubmit) for companies with ≥10 employees',
      });
    } catch (err) { next(err); }
  }
);

// GET /reports/mom-manpower-survey — Annual MOM Manpower Survey data export (year param)
app.get('/reports/mom-manpower-survey',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN),
  async (req, res, next) => {
    try {
      const year = parseInt(req.query.year) || new Date().getFullYear();
      const auth = authHeaders(req);

      const empRes = await axios.get(`${EMPLOYEE_URL2}/employees?limit=2000`, { headers: auth });
      const employees = empRes.data.employees || [];

      const active = employees.filter(e => e.isActive);
      const yearStart = new Date(year, 0, 1);
      const yearEnd   = new Date(year, 11, 31, 23, 59, 59);

      const hiredInYear = employees.filter(e => {
        if (!e.joinDate) return false;
        const d = new Date(e.joinDate);
        return d >= yearStart && d <= yearEnd;
      });

      const terminatedInYear = employees.filter(e => {
        const d = new Date(e.lastWorkingDate || e.resignationDate || null);
        return d && d >= yearStart && d <= yearEnd;
      });

      const byOccupation = {};
      const byAge = { 'Below 25': 0, '25-34': 0, '35-44': 0, '45-54': 0, '55-64': 0, '65 and above': 0 };

      for (const e of active) {
        const occ = e.jobTitle || e.designation || 'Other';
        byOccupation[occ] = (byOccupation[occ] || 0) + 1;

        if (e.dateOfBirth) {
          const age = year - new Date(e.dateOfBirth).getFullYear();
          if (age < 25)        byAge['Below 25']++;
          else if (age < 35)   byAge['25-34']++;
          else if (age < 45)   byAge['35-44']++;
          else if (age < 55)   byAge['45-54']++;
          else if (age < 65)   byAge['55-64']++;
          else                 byAge['65 and above']++;
        }
      }

      res.json({
        reportType: 'MOM_ANNUAL_MANPOWER_SURVEY',
        year,
        generatedAt: new Date().toISOString(),
        totalEmployees: active.length,
        newHires: hiredInYear.length,
        terminations: terminatedInYear.length,
        byOccupation,
        byAgeGroup: byAge,
        surveyNote: `Complete the MOM Annual Manpower Survey at stats.mom.gov.sg. Reference period: Jan–Dec ${year}.`,
      });
    } catch (err) { next(err); }
  }
);

// ── Statutory submission history ──────────────────────────────────────────────

// POST /reports/submissions — record a submission
app.post('/reports/submissions',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const { type, period, referenceNumber, fileName, notes, status } = req.body;
      const VALID_TYPES = ['CPF_E_SUBMIT', 'SDL_SSG', 'FWL_MOM', 'IR8A_IRAS', 'MOM_HEADCOUNT', 'ANNUAL_MANPOWER_SURVEY'];
      if (!type || !VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: `type is required and must be one of ${VALID_TYPES.join(', ')}` });
      }
      if (!period) return res.status(400).json({ error: 'period is required (YYYY-MM or YYYY)' });

      const db = getPrisma();
      const sub = await db.statutorySubmission.create({
        data: {
          id: require('crypto').randomUUID(),
          type,
          period,
          referenceNumber: referenceNumber || null,
          fileName: fileName || null,
          notes: notes || null,
          status: status || 'DRAFT',
          submittedBy: req.user.sub,
          submittedAt: status === 'SUBMITTED' ? new Date() : null,
        },
      });
      res.status(201).json(sub);
    } catch (err) { next(err); }
  }
);

// GET /reports/submissions — list submission history
app.get('/reports/submissions',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const { type, period, status } = req.query;
      const where = {};
      if (type)   where.type   = type;
      if (period) where.period = period;
      if (status) where.status = status;

      const db = getPrisma();
      const [submissions, total] = await Promise.all([
        db.statutorySubmission.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 }),
        db.statutorySubmission.count({ where }),
      ]);
      res.json({ submissions, total });
    } catch (err) { next(err); }
  }
);

// GET /reports/submissions/:id
app.get('/reports/submissions/:id',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const db = getPrisma();
      const sub = await db.statutorySubmission.findUnique({ where: { id: req.params.id } });
      if (!sub) return res.status(404).json({ error: 'Submission record not found' });
      res.json(sub);
    } catch (err) { next(err); }
  }
);

// PUT /reports/submissions/:id — update (mark as submitted/acknowledged)
app.put('/reports/submissions/:id',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const db = getPrisma();
      const existing = await db.statutorySubmission.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Submission record not found' });

      const { status, referenceNumber, fileName, notes } = req.body;
      const updates = {};
      if (referenceNumber !== undefined) updates.referenceNumber = referenceNumber;
      if (fileName        !== undefined) updates.fileName        = fileName;
      if (notes           !== undefined) updates.notes           = notes;
      if (status) {
        updates.status = status;
        if (status === 'SUBMITTED'    && !existing.submittedAt)   updates.submittedAt   = new Date();
        if (status === 'ACKNOWLEDGED' && !existing.acknowledgedAt) updates.acknowledgedAt = new Date();
      }

      if (!Object.keys(updates).length) return res.status(400).json({ error: 'No fields to update' });

      const updated = await db.statutorySubmission.update({ where: { id: req.params.id }, data: updates });
      res.json(updated);
    } catch (err) { next(err); }
  }
);

// ── RPT-001 — Executive Workforce Dashboard ───────────────────────────────────
app.get('/reports/workforce-dashboard',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER),
  async (req, res, next) => {
    try {
      const auth = authHeaders(req);
      const empRes = await axios.get(`${EMPLOYEE_URL2}/employees?limit=2000`, { headers: auth });
      const employees = empRes.data.employees || [];

      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

      // Build 12-month rolling window (oldest first)
      const months = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          year: d.getFullYear(),
          month: d.getMonth() + 1,
          label: d.toLocaleDateString('en-SG', { month: 'short', year: '2-digit' }),
          start: new Date(d.getFullYear(), d.getMonth(), 1),
          end:   new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59),
          hires: 0,
          terminations: 0,
        });
      }

      const twelveMonthsAgo = months[0].start;

      let totalActive = 0;
      let hiresMtd = 0;
      let termsMtd = 0;
      let terminations12m = 0;
      const byDepartment = {};
      const byEmploymentType = {};
      const byCitizenship = { SC: 0, PR: 0, EP: 0, S_PASS: 0, WP: 0, OTHER: 0 };

      for (const e of employees) {
        const joinDate = e.joinDate ? new Date(e.joinDate) : null;
        const termDate = e.lastWorkingDate
          ? new Date(e.lastWorkingDate)
          : e.resignationDate ? new Date(e.resignationDate) : null;

        // Active headcount
        if (e.isActive) {
          totalActive++;
          const dept = e.department || 'Unassigned';
          byDepartment[dept] = (byDepartment[dept] || 0) + 1;
          const et = e.employmentType || 'Unknown';
          byEmploymentType[et] = (byEmploymentType[et] || 0) + 1;

          const pass = (e.workPassType || e.passType || '').toUpperCase();
          const cs   = (e.citizenshipStatus || '').toUpperCase();
          if (cs === 'SC' || pass === 'SC' || e.nationality === 'Singapore Citizen')      byCitizenship.SC++;
          else if (cs === 'PR' || pass === 'PR')                                           byCitizenship.PR++;
          else if (pass === 'EP' || pass === 'EMPLOYMENT_PASS')                            byCitizenship.EP++;
          else if (pass === 'S_PASS' || pass === 'SPASS')                                  byCitizenship.S_PASS++;
          else if (pass === 'WP' || pass === 'WORK_PERMIT')                               byCitizenship.WP++;
          else                                                                             byCitizenship.OTHER++;
        }

        // Hires MTD
        if (joinDate && joinDate >= thisMonthStart && joinDate <= thisMonthEnd) hiresMtd++;

        // Terminations MTD
        if (termDate && termDate >= thisMonthStart && termDate <= thisMonthEnd) termsMtd++;

        // 12m rolling buckets
        for (const m of months) {
          if (joinDate && joinDate >= m.start && joinDate <= m.end) m.hires++;
          if (termDate && termDate >= m.start && termDate <= m.end) { m.terminations++; }
        }

        // 12m termination count for attrition rate
        if (termDate && termDate >= twelveMonthsAgo && termDate <= now) terminations12m++;
      }

      const attritionRate12m = totalActive > 0
        ? Math.round((terminations12m / (totalActive + terminations12m)) * 100 * 10) / 10
        : 0;

      const trend = months.map(m => ({ label: m.label, hires: m.hires, terminations: m.terminations }));

      res.json({
        generatedAt: now.toISOString(),
        kpis: {
          totalHeadcount: employees.length,
          activeHeadcount: totalActive,
          hiresMtd,
          termsMtd,
          attritionRate12m,
          terminations12m,
        },
        trend,
        byDepartment,
        byEmploymentType,
        byCitizenship,
      });
    } catch (err) { next(err); }
  }
);

// ── RPT-001 — OT Hours by Department (6-month rolling) ───────────────────────
app.get('/reports/ot-by-department',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER),
  async (req, res, next) => {
    try {
      const months = Math.min(Math.max(parseInt(req.query.months) || 6, 1), 12);
      const auth = authHeaders(req);

      const now = new Date();
      const periods = [];
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        periods.push({
          period: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label:  d.toLocaleDateString('en-SG', { month: 'short', year: '2-digit' }),
        });
      }

      const [empRes, ...summaryResults] = await Promise.allSettled([
        axios.get(`${EMPLOYEE_URL2}/employees?limit=2000`, { headers: auth }),
        ...periods.map(({ period }) =>
          axios.get(`${ATTENDANCE_URL}/attendance/internal/period-summary/${period}`, {
            headers: { 'x-internal-service-key': INTERNAL_KEY },
          })
        ),
      ]);

      const empMap = {};
      if (empRes.status === 'fulfilled') {
        for (const e of (empRes.value.data.employees || [])) empMap[e.id] = e.department || 'Unassigned';
      }

      const byDepartment = {};
      for (let i = 0; i < periods.length; i++) {
        const result = summaryResults[i];
        const periodSummary = result.status === 'fulfilled' ? (result.value.data.summary || {}) : {};

        for (const [empId, s] of Object.entries(periodSummary)) {
          const dept = empMap[empId] || 'Unassigned';
          const ot   = parseFloat(s.billableOtHours ?? s.otHours ?? 0) || 0;
          if (!byDepartment[dept]) byDepartment[dept] = new Array(periods.length).fill(0);
          byDepartment[dept][i] = Math.round((byDepartment[dept][i] + ot) * 10) / 10;
        }
      }

      const totals = {};
      for (const [dept, arr] of Object.entries(byDepartment)) {
        totals[dept] = Math.round(arr.reduce((s, v) => s + v, 0) * 10) / 10;
      }

      const topDepts = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d]) => d);
      const filtered = {};
      for (const d of topDepts) filtered[d] = byDepartment[d];

      res.json({
        generatedAt:  now.toISOString(),
        months:       periods.map(p => p.label),
        byDepartment: filtered,
        totals:       Object.fromEntries(topDepts.map(d => [d, totals[d]])),
      });
    } catch (err) { next(err); }
  }
);

// ── RPT-001 — Training Completion Summary ────────────────────────────────────
app.get('/reports/training-summary',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER),
  async (req, res, next) => {
    try {
      const auth = authHeaders(req);
      const trainRes = await axios.get(`${TRAINING_URL}/training/stats`, { headers: auth });
      res.json(trainRes.data);
    } catch (err) {
      if (err.response) return res.status(err.response.status).json(err.response.data);
      next(err);
    }
  }
);

// RPT-003 Phase 1 — report builder + schedules mounted under /reports
app.use('/reports', builderRoutes);

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║          ENG-002 — HR Analytics Dashboard (extended endpoints)            ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

const ANALYTICS_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER];

// Analytics budget store — backed by the AnalyticsBudget table. The legacy
// shape returned to callers (`{ headcount: { YYYY-MM: n }, recruitment: ..., revenue: ... }`)
// is preserved so existing dashboard reads keep working.
const BUDGET_CATEGORIES = ['headcount', 'recruitment', 'revenue'];
async function loadBudgetStore() {
  const rows = await getPrisma().analyticsBudget.findMany();
  const store = { headcount: {}, recruitment: {}, revenue: {} };
  for (const row of rows) {
    const key = row.category.toLowerCase();
    if (store[key]) store[key][row.period] = row.value;
  }
  return store;
}
async function getBudgetValue(category, period) {
  const row = await getPrisma().analyticsBudget.findUnique({
    where: { category_period: { category: category.toUpperCase(), period } },
  });
  return row ? row.value : null;
}

// POST /reports/analytics/budget — HR sets headcount/recruitment/revenue budgets per period
app.post('/reports/analytics/budget',
  authenticate, authorize(...ANALYTICS_ROLES, ROLES.FINANCE_ADMIN),
  async (req, res, next) => {
    try {
      const { category, period, value } = req.body || {};
      if (!BUDGET_CATEGORIES.includes(category))
        return res.status(400).json({ error: 'category must be headcount|recruitment|revenue' });
      if (!period) return res.status(400).json({ error: 'period (YYYY or YYYY-MM) is required' });
      const parsed = parseFloat(value);
      if (!Number.isFinite(parsed))
        return res.status(400).json({ error: 'value must be a number' });
      const row = await getPrisma().analyticsBudget.upsert({
        where: { category_period: { category: category.toUpperCase(), period } },
        update: { value: parsed, setBy: req.user?.sub || null },
        create: { category: category.toUpperCase(), period, value: parsed, setBy: req.user?.sub || null },
      });
      res.json({ category, period, value: row.value });
    } catch (err) { next(err); }
  }
);

// GET /reports/analytics/budget — read current budgets
app.get('/reports/analytics/budget',
  authenticate, authorize(...ANALYTICS_ROLES, ROLES.FINANCE_ADMIN),
  async (_req, res, next) => {
    try { res.json(await loadBudgetStore()); }
    catch (err) { next(err); }
  }
);

// GET /reports/analytics/headcount?period=YYYY-MM
app.get('/reports/analytics/headcount', authenticate, authorize(...ANALYTICS_ROLES), async (req, res, next) => {
  try {
    const period = req.query.period || new Date().toISOString().slice(0, 7);
    const empRes = await axios.get(`${EMPLOYEE_URL}/employees?limit=1000`, { headers: authHeaders(req) });
    const employees = empRes.data.employees || [];
    const active = employees.filter(e => e.isActive);
    const byDept = active.reduce((acc, e) => { acc[e.department] = (acc[e.department] || 0) + 1; return acc; }, {});
    // Prefer the period-specific budget, fall back to the year-level budget.
    const budget = (await getBudgetValue('headcount', period))
                ?? (await getBudgetValue('headcount', period.slice(0, 4)))
                ?? null;
    const variance = budget !== null ? active.length - budget : null;
    res.json({
      period,
      actual: active.length,
      budget,
      variance,
      variancePct: budget ? Math.round((variance / budget) * 100) : null,
      byDepartment: byDept,
      total: employees.length,
      inactive: employees.length - active.length,
    });
  } catch (err) { next(err); }
});

// GET /reports/analytics/attrition?months=12
app.get('/reports/analytics/attrition', authenticate, authorize(...ANALYTICS_ROLES), async (req, res, next) => {
  try {
    const months = parseInt(req.query.months || '12');
    const empRes = await axios.get(`${EMPLOYEE_URL}/employees?limit=1000`, { headers: authHeaders(req) });
    const employees = empRes.data.employees || [];
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
    const leavers = employees.filter(e => e.endDate && new Date(e.endDate) >= cutoff && new Date(e.endDate) <= now);
    const active = employees.filter(e => e.isActive);
    const avgHeadcount = (active.length + (active.length + leavers.length)) / 2 || 1;
    const rate = (leavers.length / avgHeadcount) * 100;

    // Bucket by department + tenure
    const byDept = {}, byTenure = { '<1y': 0, '1-3y': 0, '3-5y': 0, '5y+': 0 };
    for (const l of leavers) {
      byDept[l.department] = (byDept[l.department] || 0) + 1;
      const tm = l.startDate && l.endDate
        ? Math.floor((new Date(l.endDate).getTime() - new Date(l.startDate).getTime()) / (30 * 86_400_000))
        : 0;
      if (tm < 12) byTenure['<1y'] += 1;
      else if (tm < 36) byTenure['1-3y'] += 1;
      else if (tm < 60) byTenure['3-5y'] += 1;
      else byTenure['5y+'] += 1;
    }
    res.json({
      windowMonths: months,
      leaversCount: leavers.length,
      activeCount: active.length,
      attritionRatePct: Math.round(rate * 10) / 10,
      byDepartment: byDept,
      byTenure,
    });
  } catch (err) { next(err); }
});

// GET /reports/analytics/cost-per-hire?period=YYYY
app.get('/reports/analytics/cost-per-hire', authenticate, authorize(...ANALYTICS_ROLES, ROLES.FINANCE_ADMIN), async (req, res, next) => {
  try {
    const period = req.query.period || String(new Date().getFullYear());
    const empRes = await axios.get(`${EMPLOYEE_URL}/employees?limit=1000`, { headers: authHeaders(req) });
    const employees = empRes.data.employees || [];
    // Hires within the period (start year matches)
    const startYear = period.slice(0, 4);
    const hires = employees.filter(e => e.startDate && String(new Date(e.startDate).getFullYear()) === startYear);
    const recruitmentBudget = (await getBudgetValue('recruitment', period)) || 0;
    const cph = hires.length > 0 ? recruitmentBudget / hires.length : 0;
    res.json({
      period,
      hires: hires.length,
      recruitmentSpend: recruitmentBudget,
      costPerHire: Math.round(cph * 100) / 100,
    });
  } catch (err) { next(err); }
});

// GET /reports/analytics/leave-heatmap?year=YYYY
app.get('/reports/analytics/leave-heatmap', authenticate, authorize(...ANALYTICS_ROLES), async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const from = `${year}-01-01`, to = `${year}-12-31`;
    const lvRes = await axios.get(`${LEAVE_URL}/leave/applications?from=${from}&to=${to}&limit=2000`, { headers: authHeaders(req) }).catch(() => ({ data: { applications: [] } }));
    const applications = lvRes.data.applications || lvRes.data || [];

    const months = Array.from({ length: 12 }, () => 0);
    const byType = {};
    for (const a of applications) {
      if (a.status !== 'APPROVED' && a.status !== 'COMPLETED' && a.status !== 'TAKEN') continue;
      const start = new Date(a.startDate || a.from);
      if (start.getFullYear() !== Number(year)) continue;
      const m = start.getMonth();
      months[m] += (a.totalDays || a.days || 1);
      const t = a.leaveType?.name || a.type || 'Other';
      byType[t] = (byType[t] || 0) + (a.totalDays || a.days || 1);
    }
    res.json({
      year: Number(year),
      monthlyDaysTaken: months,
      byLeaveType: byType,
      totalDays: months.reduce((a, b) => a + b, 0),
    });
  } catch (err) { next(err); }
});

// GET /reports/analytics/ot-cost-trend?months=6
app.get('/reports/analytics/ot-cost-trend', authenticate, authorize(...ANALYTICS_ROLES, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const months = parseInt(req.query.months || '6');
    const now = new Date();
    const periods = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const result = await Promise.all(periods.map(async p => {
      try {
        const r = await axios.get(`${ATTENDANCE_URL}/attendance/ot-summary/${p}`, { headers: authHeaders(req) });
        return { period: p, ...r.data };
      } catch { return { period: p, totalHours: 0, totalCost: 0 }; }
    }));
    res.json({ periods: result });
  } catch (err) { next(err); }
});

// GET /reports/analytics/training-roi?year=YYYY
app.get('/reports/analytics/training-roi', authenticate, authorize(...ANALYTICS_ROLES), async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    let trainings = [];
    try {
      const r = await axios.get(`${TRAINING_URL}/training/courses?year=${year}`, { headers: authHeaders(req) });
      trainings = r.data.courses || r.data || [];
    } catch (_) { /* training service optional */ }

    let totalCost = 0, totalHours = 0, totalCompletions = 0;
    for (const t of trainings) {
      totalCost  += Number(t.totalCost || t.cost || 0);
      totalHours += Number(t.totalTrainingHours || t.duration || 0);
      totalCompletions += Number(t.completedCount || 0);
    }
    res.json({
      year: Number(year),
      trainings: trainings.length,
      totalCost,
      totalHours,
      totalCompletions,
      costPerHour: totalHours > 0 ? Math.round((totalCost / totalHours) * 100) / 100 : 0,
      costPerCompletion: totalCompletions > 0 ? Math.round((totalCost / totalCompletions) * 100) / 100 : 0,
    });
  } catch (err) { next(err); }
});

// GET /reports/analytics/payroll-revenue-ratio?period=YYYY
app.get('/reports/analytics/payroll-revenue-ratio',
  authenticate, authorize(...ANALYTICS_ROLES, ROLES.FINANCE_ADMIN),
  async (req, res, next) => {
    try {
      const year = req.query.period || String(new Date().getFullYear());
      // Aggregate payroll cost from 12 month-summary calls
      let totalPayrollCost = 0;
      for (let m = 1; m <= 12; m++) {
        const period = `${year}-${String(m).padStart(2, '0')}`;
        try {
          const r = await axios.get(`${PAYROLL_URL}/payroll/runs?period=${period}&status=FINALISED`, { headers: authHeaders(req) });
          const runs = r.data.runs || r.data || [];
          for (const run of runs) totalPayrollCost += Number(run.totalGross || run.netPayout || 0);
        } catch (_) {/* swallow */}
      }
      const revenue = (await getBudgetValue('revenue', year)) || 0;
      const ratio = revenue > 0 ? Math.round((totalPayrollCost / revenue) * 10000) / 100 : 0;
      res.json({
        period: year,
        payrollCost: Math.round(totalPayrollCost * 100) / 100,
        revenue,
        payrollToRevenueRatioPct: ratio,
      });
    } catch (err) { next(err); }
  }
);

// GET /reports/analytics/pdpa-retention — placeholder for records nearing deletion threshold
app.get('/reports/analytics/pdpa-retention',
  authenticate, authorize(...ANALYTICS_ROLES),
  async (req, res, next) => {
    try {
      const empRes = await axios.get(`${EMPLOYEE_URL}/employees?limit=1000`, { headers: authHeaders(req) });
      const employees = empRes.data.employees || [];
      // PDPA: retain ex-employee records for 7 years post-termination. Flag those past 6.5 years.
      const now = new Date();
      const sixHalfYrs = 6.5 * 365 * 86_400_000;
      const approaching = employees.filter(e => !e.isActive && e.endDate && (now.getTime() - new Date(e.endDate).getTime()) > sixHalfYrs);
      res.json({
        total: employees.length,
        approachingDeletion: approaching.length,
        records: approaching.slice(0, 50).map(e => ({
          id: e.id, code: e.employeeCode, name: e.fullName,
          endDate: e.endDate,
          daysSinceTermination: Math.floor((now.getTime() - new Date(e.endDate).getTime()) / 86_400_000),
        })),
      });
    } catch (err) { next(err); }
  }
);

// GET /reports/analytics/summary — single-call aggregate for the analytics page
app.get('/reports/analytics/summary',
  authenticate, authorize(...ANALYTICS_ROLES),
  async (req, res, next) => {
    try {
      const period = req.query.period || new Date().toISOString().slice(0, 7);
      const year = period.slice(0, 4);
      // Parallel fan-out
      const [hc, attr, cph, leaveHm, pdpa] = await Promise.all([
        axios.get(`http://localhost:${PORT}/reports/analytics/headcount?period=${period}`, { headers: authHeaders(req) }).then(r => r.data).catch(() => null),
        axios.get(`http://localhost:${PORT}/reports/analytics/attrition?months=12`, { headers: authHeaders(req) }).then(r => r.data).catch(() => null),
        axios.get(`http://localhost:${PORT}/reports/analytics/cost-per-hire?period=${year}`, { headers: authHeaders(req) }).then(r => r.data).catch(() => null),
        axios.get(`http://localhost:${PORT}/reports/analytics/leave-heatmap?year=${year}`, { headers: authHeaders(req) }).then(r => r.data).catch(() => null),
        axios.get(`http://localhost:${PORT}/reports/analytics/pdpa-retention`, { headers: authHeaders(req) }).then(r => r.data).catch(() => null),
      ]);
      res.json({ period, headcount: hc, attrition: attr, costPerHire: cph, leaveHeatmap: leaveHm, pdpa });
    } catch (err) { next(err); }
  }
);

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') }); });

if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const { seedTemplates } = require('./seeds/seed-templates');
  const _prismaForSeed = new PrismaClient();

  app.listen(PORT, async () => {
    console.log(`[reporting-service] Running on port ${PORT}`);

    // Seed pre-built analytics templates (idempotent).
    seedTemplates(_prismaForSeed).catch(err =>
      console.error('[reporting-service] Seed error:', err.message));

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
