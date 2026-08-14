'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { countWorkingDays } = require('/app/shared/payroll-utils');
const {
  computeIr21Deadline,
  daysUntilDeadline,
  shouldWithholdPay,
  buildDashboardEntry,
} = require('./engines/ir21.engine');

const prisma = require('./utils/prisma');
const app = express();
const PORT = process.env.PORT || 4008;

const EMPLOYEE_URL  = process.env.EMPLOYEE_SERVICE_URL  || 'http://employee-service:4002';
const LEAVE_URL     = process.env.LEAVE_SERVICE_URL     || 'http://leave-service:4004';
const CLAIMS_URL    = process.env.CLAIMS_SERVICE_URL    || 'http://claims-service:4005';
const PAYROLL_URL   = process.env.PAYROLL_SERVICE_URL   || 'http://payroll-service:4003';
const INTERNAL_KEY  = process.env.INTERNAL_SERVICE_KEY  || '';

app.use(helmet()); app.use(cors()); app.use(express.json({ limit: '10kb' })); app.use(morgan('combined'));
const { tenantContextMiddleware } = require('/app/shared/tenant-context');
app.use(tenantContextMiddleware);
app.get('/health', (_req, res) => res.json({ service: 'offboarding-service', status: 'ok', ts: new Date() }));

const DEFAULT_CLEARANCE_ITEMS = [
  'Resignation letter received', 'IT equipment returned', 'Access card returned',
  'Email account deactivated', 'System access revoked', 'Locker cleared',
  'Exit interview completed', 'Leave encashment computed', 'Final pay computed',
  'Certificate of Employment issued', 'CPF final contribution filed', 'H&S acknowledgement',
];

// ── GET /offboarding — list all cases ────────────────────────────────────────
app.get('/offboarding', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.status = status.toUpperCase();
    const cases = await prisma.offboardingCase.findMany({
      where,
      include: { clearanceItems: { select: { id: true, isDone: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(cases);
  } catch (err) { next(err); }
});

// ── GET /offboarding/ir21/dashboard — IR21 filing overview ───────────────────
app.get('/offboarding/ir21/dashboard', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = { isForeignEmployee: true };
    if (status) {
      const allowed = ['NOT_REQUIRED', 'PENDING', 'SUBMITTED', 'CLEARANCE_ISSUED', 'PAYRELEASED'];
      if (!allowed.includes(status.toUpperCase())) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
      where.ir21Status = status.toUpperCase();
    }
    const cases = await prisma.offboardingCase.findMany({
      where,
      orderBy: [{ ir21DeadlineDate: 'asc' }, { lastWorkingDate: 'asc' }],
    });
    const entries = cases.map(c => buildDashboardEntry(c));
    const summary = {
      total: entries.length,
      pending: entries.filter(e => e.ir21Status === 'PENDING').length,
      submitted: entries.filter(e => e.ir21Status === 'SUBMITTED').length,
      clearanceIssued: entries.filter(e => e.ir21Status === 'CLEARANCE_ISSUED').length,
      overdue: entries.filter(e => e.urgency === 'OVERDUE').length,
      critical: entries.filter(e => e.urgency === 'CRITICAL').length,
    };
    res.json({ summary, cases: entries });
  } catch (err) { next(err); }
});

// ── POST /offboarding/initiate ────────────────────────────────────────────────
app.post('/offboarding/initiate', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { employeeId, employeeName, department, reason, lastWorkingDate, noticeGivenDate, noticePeriodDays, isForeignEmployee } = req.body;
    if (!employeeId || !reason || !lastWorkingDate) return res.status(400).json({ error: 'employeeId, reason, lastWorkingDate required' });

    const existing = await prisma.offboardingCase.findFirst({ where: { employeeId } });
    if (existing) return res.status(409).json({ error: 'Offboarding case already exists for this employee' });

    const isForeign = !!isForeignEmployee;
    const lwd = new Date(lastWorkingDate);
    const ir21DeadlineDate = isForeign ? computeIr21Deadline(lwd) : null;

    const offCase = await prisma.offboardingCase.create({
      data: {
        id: uuidv4(), employeeId, employeeName: employeeName || '', department: department || '',
        reason: reason.toUpperCase(), lastWorkingDate: lwd,
        noticeGivenDate: noticeGivenDate ? new Date(noticeGivenDate) : new Date(),
        noticePeriodDays: noticePeriodDays || 30, isForeignEmployee: isForeign,
        ir21Status: isForeign ? 'PENDING' : null,
        ir21DeadlineDate,
        moniesWithheld: isForeign,
        initiatedBy: req.user.sub, status: 'INITIATED',
        clearanceItems: {
          create: DEFAULT_CLEARANCE_ITEMS.map(name => ({ id: uuidv4(), itemName: name })),
        },
      },
      include: { clearanceItems: true },
    });

    const resp = { ...offCase };
    if (isForeign && ir21DeadlineDate) {
      resp.ir21FilingDeadline = ir21DeadlineDate;
      resp.daysUntilIr21Deadline = daysUntilDeadline(ir21DeadlineDate);
      resp.ir21Note = 'Monies withheld. IR21 must be filed before the deadline. Release requires IRAS clearance.';
    }
    res.status(201).json(resp);
  } catch (err) { next(err); }
});

// ── GET /offboarding/:id — single case ───────────────────────────────────────
app.get('/offboarding/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const offCase = await prisma.offboardingCase.findUnique({
      where: { id: req.params.id },
      include: { clearanceItems: { orderBy: { createdAt: 'asc' } } },
    });
    if (!offCase) return res.status(404).json({ error: 'Not found' });
    res.json(offCase);
  } catch (err) { next(err); }
});

// ── GET /offboarding/:id/checklist ───────────────────────────────────────────
app.get('/offboarding/:id/checklist', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const offCase = await prisma.offboardingCase.findUnique({ where: { id: req.params.id }, include: { clearanceItems: true } });
    if (!offCase) return res.status(404).json({ error: 'Not found' });
    res.json(offCase);
  } catch (err) { next(err); }
});

// ── PUT /offboarding/:id/checklist/:itemId ───────────────────────────────────
app.put('/offboarding/:id/checklist/:itemId', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.IT_ADMIN), async (req, res, next) => {
  try {
    const item = await prisma.clearanceItem.update({
      where: { id: req.params.itemId }, data: { isDone: true, completedAt: new Date(), notes: req.body.notes },
    });
    res.json(item);
  } catch (err) { next(err); }
});

// ── POST /offboarding/:id/ir21-trigger ───────────────────────────────────────
app.post('/offboarding/:id/ir21-trigger', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const offCase = await prisma.offboardingCase.findUnique({ where: { id: req.params.id } });
    if (!offCase) return res.status(404).json({ error: 'Not found' });
    if (!offCase.isForeignEmployee) return res.status(400).json({ error: 'IR21 only applicable for non-SC/non-PR employees' });
    if (offCase.ir21Status === 'CLEARANCE_ISSUED' || offCase.ir21Status === 'PAYRELEASED') {
      return res.status(409).json({ error: `IR21 already at status ${offCase.ir21Status}; cannot re-trigger` });
    }

    const ir21DeadlineDate = offCase.ir21DeadlineDate || computeIr21Deadline(offCase.lastWorkingDate);
    const updated = await prisma.offboardingCase.update({
      where: { id: offCase.id },
      data: { ir21Status: 'SUBMITTED', ir21FiledAt: new Date(), moniesWithheld: true, ir21DeadlineDate },
    });
    res.json({
      message: 'IR21 filed. All salary payments suspended until IRAS clearance is issued.',
      daysUntilDeadline: daysUntilDeadline(ir21DeadlineDate),
      case: updated,
    });
  } catch (err) { next(err); }
});

// ── POST /offboarding/:id/ir21-populate ──────────────────────────────────────
// Fetch YTD income data from payroll service and store it as the IR21 form snapshot.
app.post('/offboarding/:id/ir21-populate', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const offCase = await prisma.offboardingCase.findUnique({ where: { id: req.params.id } });
    if (!offCase) return res.status(404).json({ error: 'Not found' });
    if (!offCase.isForeignEmployee) return res.status(400).json({ error: 'IR21 form only applicable for non-SC/non-PR employees' });

    const lwd = new Date(offCase.lastWorkingDate);
    const year = lwd.getFullYear();

    const ytdRes = await fetch(
      `${PAYROLL_URL}/payroll/internal/ir21-ytd/${offCase.employeeId}/${year}`,
      { headers: { 'x-internal-service-key': INTERNAL_KEY } },
    );
    if (!ytdRes.ok) {
      const detail = await ytdRes.json().catch(() => ({}));
      return res.status(502).json({ error: 'Failed to fetch YTD data from payroll service', detail });
    }
    const ytd = await ytdRes.json();

    const formData = {
      ...ytd,
      populatedAt: new Date().toISOString(),
      ir21DeadlineDate: offCase.ir21DeadlineDate,
    };

    const updated = await prisma.offboardingCase.update({
      where: { id: offCase.id },
      data: { ir21FormData: formData },
    });
    res.json({ message: 'IR21 form data populated from payroll YTD.', formData, caseId: updated.id });
  } catch (err) { next(err); }
});

// ── GET /offboarding/:id/ir21-form ───────────────────────────────────────────
app.get('/offboarding/:id/ir21-form', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const offCase = await prisma.offboardingCase.findUnique({ where: { id: req.params.id } });
    if (!offCase) return res.status(404).json({ error: 'Not found' });
    if (!offCase.isForeignEmployee) return res.status(400).json({ error: 'IR21 form only applicable for non-SC/non-PR employees' });

    const ir21DeadlineDate = offCase.ir21DeadlineDate || computeIr21Deadline(offCase.lastWorkingDate);
    const days = daysUntilDeadline(ir21DeadlineDate);

    res.json({
      caseId: offCase.id,
      employeeId: offCase.employeeId,
      employeeName: offCase.employeeName,
      ir21Status: offCase.ir21Status,
      ir21DeadlineDate,
      daysUntilDeadline: days,
      moniesWithheld: offCase.moniesWithheld,
      formData: offCase.ir21FormData || null,
      formPopulated: !!offCase.ir21FormData,
    });
  } catch (err) { next(err); }
});

// ── PUT /offboarding/:id/ir21-clearance ──────────────────────────────────────
app.put('/offboarding/:id/ir21-clearance', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const offCase = await prisma.offboardingCase.findUnique({ where: { id: req.params.id } });
    if (!offCase) return res.status(404).json({ error: 'Not found' });
    if (!offCase.isForeignEmployee) return res.status(400).json({ error: 'IR21 clearance only applicable for non-SC/non-PR employees' });
    if (offCase.ir21Status !== 'SUBMITTED') {
      return res.status(409).json({ error: `Cannot issue clearance from status ${offCase.ir21Status}. IR21 must be SUBMITTED first.` });
    }

    const { irasReference } = req.body;
    const updated = await prisma.offboardingCase.update({
      where: { id: req.params.id },
      data: {
        ir21Status: 'CLEARANCE_ISSUED',
        ir21ClearedAt: new Date(),
        moniesToRelease: true,
        moniesWithheld: false,
        ...(irasReference ? { ir21FormData: { ...(offCase.ir21FormData || {}), irasReference, clearedAt: new Date().toISOString() } } : {}),
      },
    });
    res.json({ message: 'IR21 clearance received. Salary payment can now be released.', case: updated });
  } catch (err) { next(err); }
});

// ── PUT /offboarding/:id/exit-interview ──────────────────────────────────────
app.put('/offboarding/:id/exit-interview', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { exitInterviewDate, exitSatisfaction, exitFeedback } = req.body;
    const data = {};
    if (exitInterviewDate !== undefined) data.exitInterviewDate = exitInterviewDate ? new Date(exitInterviewDate) : null;
    if (exitSatisfaction !== undefined) data.exitSatisfaction = exitSatisfaction ? parseInt(exitSatisfaction) : null;
    if (exitFeedback !== undefined) data.exitFeedback = exitFeedback || null;
    if (!Object.keys(data).length) return res.status(400).json({ error: 'No fields provided' });
    const updated = await prisma.offboardingCase.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── GET /offboarding/analytics/exit ──────────────────────────────────────────
app.get('/offboarding/analytics/exit', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.HR_MANAGER), async (req, res, next) => {
  try {
    const cases = await prisma.offboardingCase.findMany({
      select: { reason: true, exitSatisfaction: true, lastWorkingDate: true, department: true, exitInterviewDate: true, status: true },
    });
    const byReason = {}, byDept = {}, byMonth = {};
    let totalSat = 0, satCount = 0;
    for (const c of cases) {
      byReason[c.reason] = (byReason[c.reason] || 0) + 1;
      if (c.department) byDept[c.department] = (byDept[c.department] || 0) + 1;
      const m = new Date(c.lastWorkingDate).toISOString().slice(0, 7);
      byMonth[m] = (byMonth[m] || 0) + 1;
      if (c.exitSatisfaction) { totalSat += c.exitSatisfaction; satCount++; }
    }
    res.json({
      total: cases.length,
      interviewCompleted: cases.filter(c => c.exitInterviewDate).length,
      avgSatisfaction: satCount ? Math.round((totalSat / satCount) * 10) / 10 : null,
      byReason, byDept, byMonth,
    });
  } catch (err) { next(err); }
});

// ── POST /offboarding/:id/compute-final-pay ───────────────────────────────────
app.post('/offboarding/:id/compute-final-pay', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const offCase = await prisma.offboardingCase.findUnique({ where: { id: req.params.id } });
    if (!offCase) return res.status(404).json({ error: 'Not found' });

    const authHeader = req.headers.authorization;
    const { noticeServed = false } = req.body;

    // 1. Fetch employee
    const empRes = await fetch(`${EMPLOYEE_URL}/employees/${offCase.employeeId}`, { headers: { Authorization: authHeader } });
    if (!empRes.ok) return res.status(502).json({ error: 'Failed to fetch employee data' });
    const emp = await empRes.json();
    const basicSalary = parseFloat(emp.basicSalary) || 0;
    if (!basicSalary) return res.status(400).json({ error: 'Employee has no basic salary on record' });

    const lastWorkingDate = new Date(offCase.lastWorkingDate);
    const year = lastWorkingDate.getFullYear();
    const monthStart = new Date(year, lastWorkingDate.getMonth(), 1);
    const monthEnd   = new Date(year, lastWorkingDate.getMonth() + 1, 0);

    // 2. Count working days
    const workingDaysInMonth = countWorkingDays(monthStart, monthEnd);
    const daysWorked         = countWorkingDays(monthStart, lastWorkingDate);
    const salaryForDaysWorked = workingDaysInMonth > 0 ? Math.round((basicSalary / workingDaysInMonth) * daysWorked * 100) / 100 : 0;

    // 3. Notice pay in lieu
    const noticePeriodDays = offCase.noticePeriodDays || 0;
    const noticePay = noticeServed ? 0 : Math.round((basicSalary / 26) * noticePeriodDays * 100) / 100;

    // 4. Fetch AL entitlement
    let leaveEncashment = 0, excessLeaveDeduction = 0, unusedAL = 0, excessAL = 0;
    try {
      const leaveRes = await fetch(`${LEAVE_URL}/leave/entitlements/${offCase.employeeId}?year=${year}`, { headers: { Authorization: authHeader, 'x-internal-service-key': INTERNAL_KEY } });
      if (leaveRes.ok) {
        const entitlements = await leaveRes.json();
        const al = entitlements.find(e => e.code === 'AL' || e.name?.toLowerCase().includes('annual'));
        if (al && al.entitledDays !== null) {
          const startDate  = emp.startDate ? new Date(emp.startDate) : new Date(year, 0, 1);
          const monthsServedThisYear = lastWorkingDate.getMonth() - (startDate.getFullYear() < year ? -1 : startDate.getMonth()) + 1;
          const clampedMonths = Math.min(Math.max(monthsServedThisYear, 1), 12);
          const alEntitledFinalYear = Math.round(al.annualEntitlement * (clampedMonths / 12) * 10) / 10;
          unusedAL  = Math.max(0, alEntitledFinalYear - (al.usedDays || 0) - (al.pendingDays || 0) + (al.carryForward || 0));
          excessAL  = Math.max(0, (al.usedDays || 0) - alEntitledFinalYear);
          leaveEncashment      = Math.round((basicSalary / 26) * unusedAL * 100) / 100;
          excessLeaveDeduction = Math.round((basicSalary / 26) * excessAL * 100) / 100;
        }
      }
    } catch {}

    // 5. Outstanding approved claims
    let outstandingClaims = 0;
    try {
      const claimsRes = await fetch(`${CLAIMS_URL}/claims?employeeId=${offCase.employeeId}&status=APPROVED&limit=200`, { headers: { Authorization: authHeader } });
      if (claimsRes.ok) {
        const clData = await claimsRes.json();
        const claims = Array.isArray(clData) ? clData : (clData.claims || []);
        outstandingClaims = Math.round(claims.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0) * 100) / 100;
      }
    } catch {}

    // SECURITY (M-06): sum in integer cents to avoid IEEE-754 drift on long
    // money chains. The previous Math.round((a + b + c - d) * 100) / 100
    // pattern accumulated binary rounding errors across each addend.
    const toCents = (v) => Math.round((Number(v) || 0) * 100);
    const grossFinalPay = (
      toCents(salaryForDaysWorked) + toCents(noticePay) + toCents(leaveEncashment) +
      toCents(outstandingClaims) - toCents(excessLeaveDeduction)
    ) / 100;

    const finalPayData = {
      basicSalary, workingDaysInMonth, daysWorked, salaryForDaysWorked,
      noticePeriodDays, noticeServed, noticePay,
      unusedAL, leaveEncashment, excessAL, excessLeaveDeduction,
      outstandingClaims, grossFinalPay, computedAt: new Date().toISOString(),
    };

    const updated = await prisma.offboardingCase.update({
      where: { id: req.params.id },
      data: { finalPayData, status: 'PAYROLL_COMPUTED' },
    });
    res.json({ ...finalPayData, caseId: updated.id, status: updated.status });
  } catch (err) { next(err); }
});

// ── POST /offboarding/:id/create-final-pay-run ───────────────────────────────
app.post('/offboarding/:id/create-final-pay-run', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const offCase = await prisma.offboardingCase.findUnique({ where: { id: req.params.id } });
    if (!offCase) return res.status(404).json({ error: 'Not found' });
    if (!offCase.finalPayData) return res.status(400).json({ error: 'Compute final pay first' });

    // Money-withhold gate: block payment for foreign employees until IRAS clearance
    if (shouldWithholdPay(offCase.isForeignEmployee, offCase.ir21Status)) {
      const ir21DeadlineDate = offCase.ir21DeadlineDate || computeIr21Deadline(offCase.lastWorkingDate);
      return res.status(409).json({
        error: 'Final pay withheld pending IRAS IR21 clearance.',
        ir21Status: offCase.ir21Status,
        ir21DeadlineDate,
        daysUntilDeadline: daysUntilDeadline(ir21DeadlineDate),
        resolution: 'Use PUT /offboarding/:id/ir21-clearance once IRAS clearance is received.',
      });
    }

    const authHeader = req.headers.authorization;
    const lwd = new Date(offCase.lastWorkingDate);
    const period = `${lwd.getFullYear()}-${String(lwd.getMonth() + 1).padStart(2, '0')}`;

    const runRes = await fetch(`${PAYROLL_URL}/payroll/runs`, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ period, runType: 'SUPPLEMENTAL', notes: `Final pay — ${offCase.employeeName || offCase.employeeId}` }),
    });
    if (!runRes.ok) {
      const err = await runRes.json().catch(() => ({}));
      return res.status(502).json({ error: 'Failed to create payroll run', detail: err });
    }
    const run = await runRes.json();
    const runId = run.id || run.run?.id;

    await prisma.offboardingCase.update({
      where: { id: req.params.id },
      data: { finalPayRunId: runId },
    });
    res.json({ runId, period, message: 'Final pay payroll run created. Add line items and process via payroll module.' });
  } catch (err) { next(err); }
});

// ── Scheduled IR21 deadline reminder sweep ────────────────────────────────────
// Runs daily at 00:05 SGT (UTC+8 = 16:05 UTC previous day). On startup, schedules
// next firing. Logs upcoming deadlines at 30/14/7 days; caller can extend to push
// notifications once notification-service integration is wired.
function scheduleIr21Sweep() {
  const now = new Date();
  // Next 00:05 SGT = 16:05 UTC
  const next = new Date(now);
  next.setUTCHours(16, 5, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const msUntil = next - now;

  setTimeout(async function sweep() {
    try {
      const cases = await prisma.offboardingCase.findMany({
        where: { isForeignEmployee: true, ir21Status: { in: ['PENDING', 'SUBMITTED'] }, ir21DeadlineDate: { not: null } },
      });
      const THRESHOLDS = [30, 14, 7];
      for (const c of cases) {
        const days = daysUntilDeadline(c.ir21DeadlineDate);
        if (THRESHOLDS.includes(days)) {
          console.log(`[IR21 REMINDER] ${c.employeeName || c.employeeId} — ${days} day(s) until IR21 deadline (${c.ir21DeadlineDate?.toISOString().slice(0, 10)}), status=${c.ir21Status}`);
        }
        if (days < 0 && c.ir21Status === 'PENDING') {
          console.warn(`[IR21 OVERDUE] ${c.employeeName || c.employeeId} — IR21 filing deadline passed ${Math.abs(days)} day(s) ago. Status still PENDING.`);
        }
      }
    } catch (e) { console.error('[IR21 sweep error]', e.message); }
    setTimeout(sweep, 24 * 60 * 60 * 1000);
  }, msUntil);

  console.log(`[offboarding-service] IR21 deadline sweep scheduled in ${Math.round(msUntil / 60000)} min`);
}

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: (process.env.NODE_ENV === 'production' && (err.status || 500) >= 500) ? 'Internal server error' : (err.message || 'Internal server error') }); });

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[offboarding-service] Running on port ${PORT}`);
    scheduleIr21Sweep();
  });
}

module.exports = app;
