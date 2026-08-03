'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { encrypt, decrypt, encryptNumber, decryptNumber } = require('/app/shared/crypto');
const { computeNetPay, countWorkingDays, countPeriodLeaveWorkingDays } = require('../engines/cpf.engine');
// Statutory computation now lives behind an HTTP contract, one service per
// country. This file no longer knows what CPF or SDL is.
const { computeStatutoryBatch, findResult, sumByKind } = require('../utils/statutory-client');
const { resolveEntity } = require('/app/shared/entity-client');
const { buildEntriesForEmployee, summariseEntries } = require('../engines/journal.engine');
const { isSupplemental, isBiMonthly, computePeriodBoundaries, trimSupplementalEmployee, validateRunTypeShape } = require('../engines/run-types');
const { toStoredPeriodHalf } = require('../utils/run-scope');
const { buildStatutoryLines } = require('../utils/statutory-lines');
const { classifyRunSla, isAlertResolved } = require('../engines/sla.engine');
const { buildPayslipPdf, splitLineItems } = require('../engines/pdf.engine');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4009';
const EMPLOYEE_SERVICE_URL     = process.env.EMPLOYEE_SERVICE_URL     || 'http://employee-service:4002';

async function fireAndForget(fn) {
  try { await fn(); } catch (err) { console.error('[fire-and-forget]', err.message); }
}

const prisma = require('../utils/prisma');

// ─── Helper: safe decrypt to float ───────────────────────────────────────────
const decSafe = (enc) => { try { return enc ? parseFloat(decrypt(enc)) || 0 : 0; } catch { return 0; } };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ─── Helper: consolidatePeriod ────────────────────────────────────────────────
// Merges all published payslips for a period into the primary run's payslips.
// Returns the count of employees where consolidation was needed (>1 payslip).
async function consolidatePeriod(period, primaryRunId) {
  const allPublished = await prisma.payslip.findMany({
    where: { period, isPublished: true },
  });

  // Group by employeeId
  const byEmp = {};
  for (const ps of allPublished) {
    if (!byEmp[ps.employeeId]) byEmp[ps.employeeId] = [];
    byEmp[ps.employeeId].push(ps);
  }

  let consolidated = 0;
  for (const [employeeId, slips] of Object.entries(byEmp)) {
    if (slips.length <= 1) continue; // nothing to merge

    // Find the primary slip (belongs to primaryRunId), or use first slip
    const primary = slips.find(s => s.runId === primaryRunId) || slips[0];

    // Sum numeric fields across all slips
    const totals = {
      grossPay:        slips.reduce((s, p) => s + decSafe(p.grossPayEnc), 0),
      netPay:          slips.reduce((s, p) => s + decSafe(p.netPayEnc), 0),
      employeeCpf:     slips.reduce((s, p) => s + decSafe(p.employeeCpfEnc), 0),
      employerCpf:     slips.reduce((s, p) => s + decSafe(p.employerCpfEnc), 0),
      sdl:             slips.reduce((s, p) => s + decSafe(p.sdlAmountEnc), 0),
      nplDays:         slips.reduce((s, p) => s + (p.nplDays || 0), 0),
      nplDeduction:    slips.reduce((s, p) => s + decSafe(p.nplDeductionEnc), 0),
      govtPaidDays:    slips.reduce((s, p) => s + (p.govtPaidDays || 0), 0),
      govtPaidAmount:  slips.reduce((s, p) => s + decSafe(p.govtPaidAmountEnc), 0),
    };

    // MAX for YTD fields (avoid double-counting cumulative totals)
    const ytdGross       = Math.max(...slips.map(p => decSafe(p.ytdGrossEnc)));
    const ytdEmployeeCpf = Math.max(...slips.map(p => decSafe(p.ytdEmployeeCpfEnc)));
    const ytdEmployerCpf = Math.max(...slips.map(p => decSafe(p.ytdEmployerCpfEnc)));

    // basicSalary: use the highest value across all runs — a supplemental run
    // may carry the corrected salary when the primary was computed with stale data
    const basicSalary = Math.max(...slips.map(p => decSafe(p.basicSalaryEnc)));

    // Update the primary payslip with consolidated values
    await prisma.payslip.update({
      where: { id: primary.id },
      data: {
        grossPayEnc:       encrypt(String(totals.grossPay)),
        netPayEnc:         encrypt(String(totals.netPay)),
        employeeCpfEnc:    encrypt(String(totals.employeeCpf)),
        employerCpfEnc:    encrypt(String(totals.employerCpf)),
        sdlAmountEnc:      encrypt(String(totals.sdl)),
        nplDays:           totals.nplDays || null,
        nplDeductionEnc:   totals.nplDeduction > 0 ? encrypt(String(totals.nplDeduction)) : null,
        govtPaidDays:      totals.govtPaidDays || null,
        govtPaidAmountEnc: totals.govtPaidAmount > 0 ? encrypt(String(totals.govtPaidAmount)) : null,
        ytdGrossEnc:       encrypt(String(ytdGross)),
        ytdEmployeeCpfEnc: encrypt(String(ytdEmployeeCpf)),
        ytdEmployerCpfEnc: encrypt(String(ytdEmployerCpf)),
        basicSalaryEnc:    encrypt(String(basicSalary)),
        isPublished:       true,
      },
    });

    // Unpublish all other payslips for this employee+period
    const otherIds = slips.filter(s => s.id !== primary.id).map(s => s.id);
    if (otherIds.length > 0) {
      await prisma.payslip.updateMany({
        where: { id: { in: otherIds } },
        data: { isPublished: false },
      });
    }

    consolidated++;
  }

  return consolidated;
}

// ─── GET /payroll/runs ───────────────────────────────────────────────────────
router.get('/runs', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { page = 1, limit = 20, period, status } = req.query;
    const where = {};
    if (period) where.period = period;
    if (status) where.status = status.toUpperCase();

    const [runs, total] = await Promise.all([
      prisma.payrollRun.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit, take: Number(limit),
        select: { id: true, period: true, runType: true, status: true, initiatedBy: true, approvedBy: true, createdAt: true, finalisedAt: true },
      }),
      prisma.payrollRun.count({ where }),
    ]);
    res.json({ runs, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// ─── POST /payroll/runs ─ Initiate Payroll Run ───────────────────────────────
router.post('/runs', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { period, runType = 'MONTHLY', employeeGroup, paymentDate, legalEntityId } = req.body;
    if (!period) return res.status(400).json({ error: 'Period is required (YYYY-MM)' });
    // ENT-001: a run belongs to exactly one legal entity, which fixes its
    // country, currency and statutory rule set for the whole compute.
    if (!legalEntityId) return res.status(400).json({ error: 'legalEntityId is required to create a payroll run' });

    const RT = runType.toUpperCase();
    const periodHalf = req.body.periodHalf ? String(req.body.periodHalf).toUpperCase() : null;

    // PAY-001: validate periodHalf — required for BIMONTHLY, forbidden otherwise.
    // Validated against the CLIENT-supplied value (null when omitted), so the
    // API contract is unchanged by the storage sentinel below.
    const shapeErr = validateRunTypeShape(RT, periodHalf);
    if (shapeErr) return res.status(400).json({ error: shapeErr });

    // NONE rather than NULL from here on: NULL cannot participate in the unique
    // key, which is what let duplicate monthly runs through the database.
    const storedHalf = toStoredPeriodHalf(periodHalf);

    // Duplicate check. tenantId is auto-injected by the tenant-scope extension;
    // legalEntityId must be explicit, or a group tenant's second entity would
    // be refused a run once its first entity had run the same period.
    const existing = await prisma.payrollRun.findFirst({
      where: { period, runType: RT, periodHalf: storedHalf, legalEntityId },
    });
    if (existing) {
      const halfLabel = periodHalf ? ` ${periodHalf} half` : '';
      return res.status(409).json({ error: `A ${RT.toLowerCase()}${halfLabel} payroll run for ${period} already exists (status: ${existing.status.toLowerCase().replace('_', ' ')}). Choose a different run type (e.g. ADHOC) to create a supplemental run.` });
    }

    // PAY-005: paymentDate default = period-end + 7 days (MOM EA s.21 cap)
    let resolvedPaymentDate = paymentDate ? new Date(paymentDate) : null;
    if (!resolvedPaymentDate) {
      const [yy, mm] = period.split('-').map(Number);
      const periodEnd = new Date(Date.UTC(yy, mm, 0));
      resolvedPaymentDate = new Date(periodEnd);
      resolvedPaymentDate.setUTCDate(resolvedPaymentDate.getUTCDate() + 7);
    }

    const run = await prisma.payrollRun.create({
      data: {
        id: uuidv4(), period, runType: RT, periodHalf: storedHalf, status: 'DRAFT',
        initiatedBy: req.user.sub, employeeGroup,
        paymentDate: resolvedPaymentDate,
        legalEntityId,
      },
    });
    res.status(201).json(run);
  } catch (err) {
    // Now genuinely a duplicate: the unique key is scoped to tenant + entity,
    // so this can no longer fire because another tenant ran the same period.
    if (err.code === 'P2002') return res.status(409).json({ error: `A payroll run for this period already exists for this legal entity. Please check the payroll list before creating a new one.` });
    next(err);
  }
});

// PAY-005: update paymentDate on an existing (non-finalised) run
router.patch('/runs/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { paymentDate, notes } = req.body;
    const existing = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Run not found' });
    if (existing.status === 'FINALISED') return res.status(409).json({ error: 'Cannot modify a finalised run' });
    const data = {};
    if (paymentDate != null) data.paymentDate = paymentDate ? new Date(paymentDate) : null;
    if (notes       != null) data.notes       = notes;
    const updated = await prisma.payrollRun.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) { next(err); }
});

// ─── GET /payroll/runs/:id ───────────────────────────────────────────────────
router.get('/runs/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id }, include: { lineItems: true, payslips: true } });
    if (!run) return res.status(404).json({ error: 'Payroll run not found' });
    res.json(run);
  } catch (err) { next(err); }
});

// ─── POST /payroll/runs/:id/compute ─ Compute (or recompute) payroll ─────────
router.post('/runs/:id/compute', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(run.status)) return res.status(400).json({ error: 'Can only compute a DRAFT or PENDING_APPROVAL run' });

    let { employees } = req.body;

    if (!employees) {
      const EMPLOYEE_SERVICE_URL = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';
      const empRes = await fetch(`${EMPLOYEE_SERVICE_URL}/employees/payroll-data`, {
        headers: { 'Authorization': req.headers.authorization || '' },
      });
      if (!empRes.ok) {
        const err = await empRes.json().catch(() => ({}));
        return res.status(502).json({ error: `Failed to fetch employee data: ${err.error || empRes.status}` });
      }
      employees = await empRes.json();
    }

    if (!employees || employees.length === 0) return res.status(400).json({ error: 'No active employees found for payroll computation' });

    // ── Derive period boundaries (needed for employee eligibility filter) ─
    // PAY-001: BIMONTHLY runs use a half-month window (1-15 or 16-end)
    let periodStart, periodEnd, daysInMonth;
    try {
      ({ periodStart, periodEnd, daysInMonth } = computePeriodBoundaries(run.period, run.runType, run.periodHalf));
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Exclude employees whose employment hasn't started by the period end,
    // or whose employment ended before the period start (EA: pay only covers actual service days)
    employees = employees.filter(emp => {
      if (emp.startDate && new Date(emp.startDate) > periodEnd) return false;
      if (emp.endDate   && new Date(emp.endDate)   < periodStart) return false;
      return true;
    });

    if (employees.length === 0) return res.status(400).json({ error: 'No active employees found for payroll computation' });

    // ── PAY-001 Supplemental auto-trim: for ADHOC/BONUS/COMMISSION runs, fetch ──
    // ── prior published payslips so we can (a) trim OW for employees who were ──
    // ── already paid in the primary run (prevents double-counting when         ──
    // ── consolidatePeriod sums grossPay later), and (b) drop empty payslips    ──
    // ── (no paycodes + already paid in prior run = nothing to add).            ──
    const supplementalRun = isSupplemental(run.runType);
    let priorPayslipMap = {}; // employeeId → { basicSalary, grossPay, netPay, ytdGross, ytdEmployeeCpf, ytdEmployerCpf }
    if (supplementalRun) {
      const priorPublished = await prisma.payslip.findMany({
        where: { period: run.period, isPublished: true, runId: { not: run.id } },
        select: {
          employeeId: true,
          basicSalaryEnc: true, grossPayEnc: true, netPayEnc: true,
          ytdGrossEnc: true, ytdEmployeeCpfEnc: true, ytdEmployerCpfEnc: true,
        },
      });
      for (const ps of priorPublished) {
        priorPayslipMap[ps.employeeId] = {
          basicSalary:    decSafe(ps.basicSalaryEnc),
          grossPay:       decSafe(ps.grossPayEnc),
          netPay:         decSafe(ps.netPayEnc),
          ytdGross:       decSafe(ps.ytdGrossEnc),
          ytdEmployeeCpf: decSafe(ps.ytdEmployeeCpfEnc),
          ytdEmployerCpf: decSafe(ps.ytdEmployerCpfEnc),
        };
      }
    }

    // ── Fetch period config + public holidays for working-day pro-rating (MOM EA s.20) ──
    const [periodConfig, periodHolidays] = await Promise.all([
      prisma.payrollPeriodConfig.findUnique({ where: { period: run.period } }),
      prisma.publicHoliday.findMany({
        where: { date: { gte: periodStart, lte: periodEnd } },
        select: { date: true },
      }),
    ]);
    const workDayType = periodConfig?.workDayType || 'FIVE_DAY';
    const holidaySet  = new Set(periodHolidays.map(h => h.date.toISOString().slice(0, 10)));
    // Total working days in this pay period (override or auto-computed)
    const workingDaysInPeriod = (periodConfig?.workingDays != null)
      ? periodConfig.workingDays
      : countWorkingDays(periodStart, periodEnd, holidaySet, workDayType);

    // ── EA s.20: pro-rate OW/grossPay for mid-month starters/leavers using working days ──
    // PAY-001: for supplemental runs with a prior payslip, the trim happens after this
    // loop (zeroes OW/grossPay) so any proration is harmlessly applied to zero.
    const prorationFactors = new Map();
    for (const emp of employees) {
      const startD   = emp.startDate ? new Date(emp.startDate) : null;
      const endD     = emp.endDate   ? new Date(emp.endDate)   : null;
      const effStart = (startD && startD > periodStart) ? startD : periodStart;
      const effEnd   = (endD   && endD   < periodEnd)   ? endD   : periodEnd;
      const workedDays = countWorkingDays(effStart, effEnd, holidaySet, workDayType);
      const factor = workedDays < workingDaysInPeriod ? workedDays / workingDaysInPeriod : 1;
      prorationFactors.set(emp.employeeId, factor);
      if (factor < 1) {
        emp.ow       = Math.round((emp.ow       || 0) * factor * 100) / 100;
        emp.grossPay = Math.round((emp.grossPay || 0) * factor * 100) / 100;
      }
    }

    // ── PAY-001 Supplemental auto-trim: zero OW/AW/grossPay + carry YTDs forward ──
    // for employees that already have a published payslip in this period from a
    // primary run. Their CPF was already computed and remitted; the supplemental
    // should only contribute the new paycode delta.
    const trimmedEmployees = new Set();
    if (supplementalRun) {
      for (const emp of employees) {
        const prior = priorPayslipMap[emp.employeeId];
        if (prior) {
          trimSupplementalEmployee(emp, prior);
          trimmedEmployees.add(emp.employeeId);
          // Override proration factor — emp.ow is now 0, OW paycodes shouldn't be re-prorated
          prorationFactors.set(emp.employeeId, 1);
        }
      }
    }

    const savedLineItems = await prisma.payrollLineItem.findMany({ where: { runId: run.id } });

    // Fetch all approved leave applications overlapping this period from leave service.
    // Overlap condition: startDate <= periodEnd AND endDate >= periodStart — catches cross-month leaves.
    const LEAVE_SERVICE_URL = process.env.LEAVE_SERVICE_URL || 'http://leave-service:4004';
    let approvedLeaves = [];
    try {
      const leaveRes = await fetch(
        `${LEAVE_SERVICE_URL}/leave/applications?status=APPROVED&limit=5000` +
        `&startDateTo=${periodEnd.toISOString().slice(0,10)}` +
        `&endDateFrom=${periodStart.toISOString().slice(0,10)}`,
        { headers: { 'Authorization': req.headers.authorization || '' } }
      );
      if (leaveRes.ok) {
        const leaveData = await leaveRes.json();
        approvedLeaves = leaveData.applications || [];
      }
    } catch (e) {
      console.warn('[payroll] Could not fetch leave data:', e.message);
    }

    // ── TAT-005: fetch attendance period summary for the auto-feed ─────────
    // The attendance-service exposes /attendance/internal/period-summary/:period
    // behind INTERNAL_SERVICE_KEY. It returns periodStatus so we can enforce
    // the APPROVED_FOR_PAYROLL gate, and per-employee billable hours/OT/absent
    // days for materializing OT_PAY, ABSENT_DEDUCT, PH_WORK_PAY line items.
    //
    // Hard gate: if the period isn't APPROVED_FOR_PAYROLL and the caller
    // didn't pass attendanceOverride:true, refuse compute with 409.
    // "Manual Wins": if an employee already has a manual line item for one of
    // the auto-fed codes (OT_PAY, ABSENT_DEDUCT, PH_WORK_PAY) we skip the
    // auto-add for that employee/code — manual entries are authoritative.
    const ATTENDANCE_SERVICE_URL = process.env.ATTENDANCE_SERVICE_URL || 'http://attendance-service:4007';
    // Fail-closed: never accept a literal default for the internal service key —
    // a 'dev-internal-key' fallback in any environment is a full auth bypass.
    const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY;
    if (!INTERNAL_KEY) throw new Error('INTERNAL_SERVICE_KEY env var is required');
    let attendanceSummary = {};
    let attendancePeriodStatus = 'OPEN';
    let attendanceFetchFailed = false;
    let attendancePeriodLockedBy = null;
    let attendancePeriodApprovedBy = null;
    try {
      const attRes = await fetch(
        `${ATTENDANCE_SERVICE_URL}/attendance/internal/period-summary/${run.period}`,
        { headers: { 'x-internal-service-key': INTERNAL_KEY } },
      );
      if (attRes.ok) {
        const body = await attRes.json();
        attendanceSummary = body.summary || {};
        attendancePeriodStatus = body.periodStatus || 'OPEN';
        attendancePeriodLockedBy = body.lockedBy || null;
        attendancePeriodApprovedBy = body.approvedBy || null;
      } else {
        attendanceFetchFailed = true;
        console.warn('[payroll] attendance fetch returned', attRes.status);
      }
    } catch (e) {
      attendanceFetchFailed = true;
      console.warn('[payroll] Could not fetch attendance summary:', e.message);
    }

    // Auto-proceed when attendance period is not yet approved — payroll is not
    // blocked, but the unapproved status is logged as a warning so management
    // can follow up with the responsible approver.
    let attendanceNotApprovedWarning = null;
    if (attendancePeriodStatus !== 'APPROVED_FOR_PAYROLL' && !attendanceFetchFailed) {
      const whoLocked = attendancePeriodLockedBy
        ? `locked by user ${attendancePeriodLockedBy} (not yet approved for payroll)`
        : 'not yet locked or approved for payroll';
      const warningMsg = `Payroll computed with attendance period ${run.period} unapproved — ${whoLocked}. Status: ${attendancePeriodStatus}. Attendance auto-feed skipped.`;
      console.warn(`[payroll][attendance-warning] run=${run.id} period=${run.period} ${warningMsg}`);
      attendanceNotApprovedWarning = {
        period: run.period,
        periodStatus: attendancePeriodStatus,
        lockedBy: attendancePeriodLockedBy,
        approvedBy: attendancePeriodApprovedBy,
        message: warningMsg,
      };
      // Write to payroll audit log so it is queryable from the audit trail.
      prisma.auditLog.create({
        data: {
          entityType: 'PayrollRun',
          entityId:   run.id,
          action:     'COMPUTE_ATTENDANCE_WARNING',
          actorId:    req.user?.sub  || null,
          actorEmail: req.user?.email || null,
          actorRole:  req.user?.role  || null,
          details:    attendanceNotApprovedWarning,
          ipAddress:  req.ip || req.headers?.['x-forwarded-for'] || null,
        },
      }).catch(e => console.error('[payroll][audit] failed to write attendance warning:', e.message));
    }

    // Auto-feed only applies when the period is fully approved and fetch succeeded.
    // When the period is unapproved we skip the feed — Payroll Officer must add
    // OT/Absent paycodes manually if needed.
    const applyAttendanceFeed = attendancePeriodStatus === 'APPROVED_FOR_PAYROLL' && !attendanceFetchFailed;

    // Look up the pay component IDs we materialize. Codes are pre-seeded.
    // Missing codes silently skip that side of the auto-feed.
    const AUTO_FEED_CODES = ['OT_PAY', 'ABSENCE_DED', 'PH_WORK'];
    const autoFeedComponents = await prisma.payComponent.findMany({
      where: { code: { in: AUTO_FEED_CODES }, isActive: true },
    });
    const componentByCode = Object.fromEntries(autoFeedComponents.map(c => [c.code, c]));

    // Build per-employee deductible leave summary for this period.
    // Cross-month leaves are clamped to the period boundaries; working days (MOM) are counted.
    // isPaid=false  → NPL-type: deducted from employee salary
    // isGovtPaid=true → NS/GPML-type: no employee deduction; employer claims reimbursement
    const leaveSummary = {};
    for (const app of approvedLeaves) {
      const lt = app.leaveType;
      if (!lt || (lt.isPaid && !lt.isGovtPaid)) continue; // paid non-govt leave = no deduction

      const appStart = new Date(app.startDate);
      const appEnd   = new Date(app.endDate);
      const daysInPeriod = countPeriodLeaveWorkingDays(
        appStart, appEnd, periodStart, periodEnd, holidaySet, workDayType, !!app.isHalfDay
      );
      if (daysInPeriod === 0) continue;

      if (!leaveSummary[app.employeeId]) leaveSummary[app.employeeId] = { nplDays: 0, govtPaidDays: 0 };
      if (!lt.isPaid)    leaveSummary[app.employeeId].nplDays      += daysInPeriod;
      if (lt.isGovtPaid) leaveSummary[app.employeeId].govtPaidDays += daysInPeriod;
    }

    let totalGross = 0, totalNet = 0, totalEmployee = 0, totalEmployer = 0, totalSdl = 0;
    const zeroSalaryWarnings = [];
    const computedResults = [];
    const pendingPayslips = []; // { employeeId, effectiveOw, effectiveGross, net, hasPaycodes }

    // Track auto-feed line items we create here so we can include them in
    // empItems when computing CPF/net for THIS run (without re-querying).
    const autoFeedItemsByEmp = {};
    const autoFeedSkips = []; // { employeeId, code, reason } for debug

    for (const emp of employees) {
      let empItems = savedLineItems.filter(li => li.employeeId === emp.employeeId);

      // ── TAT-005 attendance auto-feed: OT_PAY, ABSENT_DEDUCT, PH_WORK_PAY ─
      // Manual Wins: skip any code where an existing line item exists.
      if (applyAttendanceFeed) {
        const att = attendanceSummary[emp.employeeId];
        if (att) {
          const monthlyOw = emp.ow || 0;
          // EA s.20 daily rate uses working days in the period
          const dailyRate  = workingDaysInPeriod > 0 ? monthlyOw / workingDaysInPeriod : 0;
          const hourlyRate = workingDaysInPeriod > 0 ? monthlyOw / (workingDaysInPeriod * 8) : 0;
          const existingCodes = new Set(
            empItems.map(li => autoFeedComponents.find(c => c.id === li.componentId)?.code).filter(Boolean)
          );

          const candidates = [
            { code: 'OT_PAY',      amount: round2(hourlyRate * 1.5 * (att.otHours || 0)),  wageType: 'OW',        isCpfApplicable: true,  description: `Auto OT: ${att.otHours || 0}h × 1.5 × hourly rate` },
            { code: 'ABSENCE_DED', amount: -round2(dailyRate * (att.absentDays || 0)),     wageType: 'DEDUCTION', isCpfApplicable: false, description: `Auto absent deduction: ${att.absentDays || 0} day(s)` },
            { code: 'PH_WORK',     amount: round2(dailyRate * (att.phWorkedDays || 0)),    wageType: 'OW',        isCpfApplicable: true,  description: `Auto PH work pay: ${att.phWorkedDays || 0} day(s)` },
          ];
          for (const cand of candidates) {
            const comp = componentByCode[cand.code];
            if (!comp) { autoFeedSkips.push({ employeeId: emp.employeeId, code: cand.code, reason: 'pay component not configured' }); continue; }
            if (existingCodes.has(cand.code)) { autoFeedSkips.push({ employeeId: emp.employeeId, code: cand.code, reason: 'manual line item present' }); continue; }
            if (cand.amount === 0) continue;
            const created = await prisma.payrollLineItem.create({
              data: {
                id: uuidv4(),
                runId: run.id,
                employeeId: emp.employeeId,
                componentId: comp.id,
                description: cand.description,
                amountEncrypted: encrypt(String(cand.amount)),
                wageType: cand.wageType,
                isCpfApplicable: cand.isCpfApplicable,
                isIrasTaxable: true,
              },
            });
            empItems.push(created);
            (autoFeedItemsByEmp[emp.employeeId] ||= []).push({ code: cand.code, amount: cand.amount });
          }
        }
      }

      const empFactor = prorationFactors.get(emp.employeeId) || 1;
      let owAdj = 0, awAdj = 0, nonCpfAdj = 0, deductions = 0, reimbursements = 0;
      for (const item of empItems) {
        const amt = parseFloat(decrypt(item.amountEncrypted)) || 0;
        if (item.wageType === 'DEDUCTION')      deductions    += Math.abs(amt);
        else if (item.wageType === 'REIMBURSEMENT') reimbursements += amt;
        else if (item.isCpfApplicable && item.wageType === 'AW') awAdj += amt;
        // OW line items represent monthly rates — apply the same EA s.20 pro-ration
        else if (item.isCpfApplicable)           owAdj         += Math.round(amt * empFactor * 100) / 100;
        else                                     nonCpfAdj     += Math.round(amt * empFactor * 100) / 100;
      }

      const effectiveOw    = (emp.ow || 0) + owAdj;
      const effectiveAw    = (emp.aw || 0) + awAdj;
      const effectiveGross = (emp.grossPay || emp.ow || 0) + owAdj + awAdj + nonCpfAdj;

      // ── Deductible leave: daily rate = gross / working days in period (MOM EA s.23) ──
      const leave = leaveSummary[emp.employeeId] || { nplDays: 0, govtPaidDays: 0 };
      const dailyRate   = workingDaysInPeriod > 0 ? effectiveGross / workingDaysInPeriod : 0;
      const autoNpl     = Math.round(dailyRate * leave.nplDays * 100) / 100;
      const govtPaidAmt = Math.round(dailyRate * leave.govtPaidDays * 100) / 100;

      // Defer statutory + payslip writing to the second pass below: the
      // statutory service is called ONCE for the whole run, not once per
      // employee, so the effective figures have to be collected first.
      pendingPayslips.push({
        emp, effectiveOw, effectiveAw, effectiveGross,
        leave, autoNpl, govtPaidAmt, deductions, reimbursements,
        hasPaycodes: empItems.length > 0,
      });
    }

    // ── Statutory computation ─────────────────────────────────────────────────
    // One HTTP call for the entire run. The entity fixes the country, and this
    // file never learns which statutory rules were applied — that is what lets
    // a Malaysian service exist without touching Singapore payroll.
    //
    // FAIL CLOSED: resolveEntity and computeStatutoryBatch both throw with
    // status 503, which propagates to the error handler and leaves the run in
    // DRAFT with no payslips written. Never caught-and-continued.
    const entityCtx = await resolveEntity(run.legalEntityId);
    const [periodYear, periodMonth] = run.period.split('-').map(Number);
    const statutoryBatch = await computeStatutoryBatch({
      country: entityCtx.country,
      period: { year: periodYear, month: periodMonth },
      entity: {
        country: entityCtx.country,
        state: entityCtx.state,
        statutoryIds: entityCtx.statutoryIds,
      },
      employees: pendingPayslips.map(p => ({
        employeeId: p.emp.employeeId,
        profile: { citizenStatus: p.emp.citizenStatus, age: p.emp.age },
        remuneration: {
          ordinary: p.effectiveOw,
          additional: p.effectiveAw,
          gross: p.effectiveGross,
          ytdOrdinary: p.emp.ytdOw || 0,
          ytdAdditional: p.emp.ytdAw || 0,
        },
      })),
    });

    for (const p of pendingPayslips) {
      const {
        emp, effectiveOw, effectiveGross,
        leave, autoNpl, govtPaidAmt, deductions, reimbursements,
      } = p;

      const statutory         = findResult(statutoryBatch.results, emp.employeeId);
      const employeeStatutory = sumByKind(statutory, 'employeeDeductions');
      const employerStatutory = sumByKind(statutory, 'employerContributions');
      const levies            = sumByKind(statutory, 'employerLevies');

      const net = computeNetPay({ grossPay: effectiveGross, employeeCpf: employeeStatutory, nplDeduction: (emp.nplDeduction || 0) + deductions + autoNpl, reimbursements: (emp.reimbursements || 0) + reimbursements });

      totalGross += effectiveGross; totalNet += net;
      totalEmployee += employeeStatutory; totalEmployer += employerStatutory; totalSdl += levies;

      // The SG-named encrypted columns keep being written unchanged so every
      // existing reader (PDF engine, IRAS engine, reporting) is untouched.
      // Task 14 adds the generic PayslipStatutoryLine child rows alongside.
      const payslipData = {
        runId: run.id, employeeId: emp.employeeId, period: run.period,
        basicSalaryEnc: encrypt(String(effectiveOw)),
        grossPayEnc: encrypt(String(effectiveGross)),
        netPayEnc: encrypt(String(net)),
        employeeCpfEnc: encrypt(String(employeeStatutory)),
        employerCpfEnc: encrypt(String(employerStatutory)),
        sdlAmountEnc: encrypt(String(levies)),
        ytdGrossEnc: encrypt(String((emp.ytdGross || 0) + effectiveGross)),
        ytdEmployeeCpfEnc: encrypt(String((emp.ytdEmployeeCpf || 0) + employeeStatutory)),
        ytdEmployerCpfEnc: encrypt(String((emp.ytdEmployerCpf || 0) + employerStatutory)),
        nplDays: leave.nplDays || null,
        nplDeductionEnc: autoNpl > 0 ? encrypt(String(autoNpl)) : null,
        govtPaidDays: leave.govtPaidDays || null,
        govtPaidAmountEnc: govtPaidAmt > 0 ? encrypt(String(govtPaidAmt)) : null,
      };

      if (effectiveOw === 0) zeroSalaryWarnings.push(emp.employeeId);

      computedResults.push({ employeeId: emp.employeeId, effectiveOw, effectiveGross, net, hasPaycodes: p.hasPaycodes });

      const upserted = await prisma.payslip.upsert({
        where: { runId_employeeId: { runId: run.id, employeeId: emp.employeeId } },
        create: { id: uuidv4(), ...payslipData },
        update: payslipData,
        select: { id: true },
      });

      // ENT-006 dual-write. The SG-named columns above keep being written so
      // every existing reader is untouched; these rows are the country-agnostic
      // source of truth and carry the rate version that produced each figure.
      const statutoryLines = buildStatutoryLines({
        payslipId: upserted.id,
        tenantId: run.tenantId,
        statutory,
        rateVersion: statutoryBatch.rateVersion,
        encrypt,
      });

      // Recompute must be clean: a re-run of the same period must not leave
      // stale lines from the previous attempt alongside the new ones.
      await prisma.payslipStatutoryLine.deleteMany({ where: { payslipId: upserted.id } });
      if (statutoryLines.length) {
        await prisma.payslipStatutoryLine.createMany({ data: statutoryLines });
      }
    }

    // ── PAY-001 Post-compute cleanup for supplemental runs ──
    // After auto-trim, employees who were trimmed (had a prior payslip) AND have
    // no paycodes will have effectiveOw=0 + effectiveGross=0 — nothing to add.
    // Delete their empty payslips to keep the supplemental run focused on the
    // actual deltas. Employees with paycodes are kept (carrying just the deltas).
    let autoRemovedIds = [];
    const autoTrimmedIds = Array.from(trimmedEmployees).filter(id =>
      computedResults.find(r => r.employeeId === id && r.hasPaycodes)
    );
    if (supplementalRun && trimmedEmployees.size > 0) {
      const toRemove = computedResults
        .filter(r => trimmedEmployees.has(r.employeeId) && !r.hasPaycodes)
        .map(r => r.employeeId);
      if (toRemove.length > 0) {
        await prisma.payslip.deleteMany({ where: { runId: run.id, employeeId: { in: toRemove } } });
        for (const r of computedResults.filter(c => toRemove.includes(c.employeeId))) {
          totalGross -= r.effectiveGross;
          totalNet   -= r.net;
        }
        autoRemovedIds = toRemove;
      }
    }

    await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'PENDING_APPROVAL',
        // ENT-006: pin the rate version the whole run computed under. The
        // per-line copy is the guarantee; this is the run-level record, and
        // they are equal for a normal run.
        rateVersion: statutoryBatch.rateVersion,
        country: entityCtx.country,
        currency: entityCtx.currency,
        totalGross: encrypt(String(totalGross)),
        totalNet: encrypt(String(totalNet)),
        totalCpf: encrypt(String(totalEmployee)),
        totalEmployerCpf: encrypt(String(totalEmployer)),
        totalSdl: String(totalSdl),
        ...(attendanceNotApprovedWarning && {
          notes: attendanceNotApprovedWarning.message,
        }),
      },
    });
    const warnings = {
      ...(zeroSalaryWarnings.length > 0 && { zeroOrdinaryWages: zeroSalaryWarnings }),
      ...(attendanceNotApprovedWarning && { attendanceNotApproved: attendanceNotApprovedWarning }),
    };
    res.json({
      message: 'Payroll computed. Status: PENDING_APPROVAL',
      total: { gross: totalGross, net: totalNet, employeeCpf: totalEmployee, employerCpf: totalEmployer, sdl: totalSdl },
      ...(Object.keys(warnings).length > 0 && { warnings }),
      ...(autoRemovedIds.length > 0 && { autoRemovedIds }),
      ...(autoTrimmedIds.length > 0 && { autoTrimmedIds }),
      attendance: {
        periodStatus: attendancePeriodStatus,
        applied: applyAttendanceFeed,
        autoFeedItemsByEmployee: autoFeedItemsByEmp,
        skipped: autoFeedSkips,
        ...(attendanceFetchFailed && { fetchFailed: true }),
      },
    });
  } catch (err) { next(err); }
});

// ─── GET /payroll/components ─ List pay components for paycode dropdown ───────
router.get('/components', authenticate, async (req, res, next) => {
  try {
    const components = await prisma.payComponent.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    res.json(components);
  } catch (err) { next(err); }
});

// ─── GET /payroll/runs/:id/paycodes ─ List line items for a run ───────────────
router.get('/runs/:id/paycodes', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const items = await prisma.payrollLineItem.findMany({ where: { runId: req.params.id }, orderBy: { createdAt: 'asc' } });
    const result = items.map(item => ({ ...item, amount: parseFloat(decrypt(item.amountEncrypted)) || 0 }));
    res.json(result);
  } catch (err) { next(err); }
});

// ─── POST /payroll/runs/:id/paycodes ─ Add a paycode to a run ────────────────
router.post('/runs/:id/paycodes', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status === 'FINALISED') return res.status(400).json({ error: 'Cannot add paycodes to a finalised run' });

    const { employeeId, componentId, description, amount } = req.body;
    if (!employeeId || !componentId || amount === undefined) return res.status(400).json({ error: 'employeeId, componentId and amount are required' });

    const component = await prisma.payComponent.findUnique({ where: { id: componentId } });
    if (!component) return res.status(404).json({ error: 'Pay component not found' });

    const item = await prisma.payrollLineItem.create({
      data: {
        id: uuidv4(), runId: run.id, employeeId,
        componentId,
        description: description || component.name,
        amountEncrypted: encrypt(String(amount)),
        wageType: component.wageType,
        isCpfApplicable: component.isCpfApplicable,
        isIrasTaxable: component.isIrasTaxable,
      },
    });
    res.status(201).json({ ...item, amount: parseFloat(amount) });
  } catch (err) { next(err); }
});

// ─── DELETE /payroll/runs/:id/paycodes/:itemId ─ Remove a paycode ─────────────
router.delete('/runs/:id/paycodes/:itemId', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status === 'FINALISED') return res.status(400).json({ error: 'Cannot modify a finalised run' });
    await prisma.payrollLineItem.delete({ where: { id: req.params.itemId } });
    res.json({ message: 'Paycode removed' });
  } catch (err) { next(err); }
});

// ─── POST /payroll/runs/:id/approve ─ Checker approval ──────────────────────
router.post('/runs/:id/approve', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'Run is not pending approval' });
    // Maker-checker: skip if DISABLE_MAKER_CHECKER is set (single-admin environments)
    const makerCheckerEnabled = process.env.DISABLE_MAKER_CHECKER !== 'true';
    if (makerCheckerEnabled && run.initiatedBy === req.user.sub) {
      return res.status(403).json({ error: 'Maker-checker policy: a different authorised user must approve this payroll run. Contact your administrator.' });
    }

    try {
      const updated = await prisma.payrollRun.update({
        where: { id: run.id },
        data: { status: 'APPROVED', approvedBy: req.user.sub, approvedAt: new Date() },
      });
      res.json({ message: 'Payroll approved', run: updated });
    } catch (dbErr) {
      // DB CHECK constraint (payroll_runs_maker_checker_diff) fired — translate to 403
      if (dbErr.message && /payroll_runs_maker_checker_diff/.test(dbErr.message)) {
        return res.status(403).json({ error: 'Maker-checker policy enforced at database level: approver must differ from initiator.' });
      }
      throw dbErr;
    }
  } catch (err) { next(err); }
});

// ─── POST /payroll/runs/:id/cancel ─ Void any run including finalised ────────
router.post('/runs/:id/cancel', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });

    await prisma.payslip.deleteMany({ where: { runId: run.id } });
    await prisma.payrollLineItem.deleteMany({ where: { runId: run.id } });
    await prisma.payrollRun.delete({ where: { id: run.id } });

    res.json({ message: `Payroll run for ${run.period} (${run.runType}) has been voided.` });
  } catch (err) { next(err); }
});

// ─── POST /payroll/runs/:id/finalise ─ Lock and generate outputs ─────────────
router.post('/runs/:id/finalise', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'APPROVED') return res.status(400).json({ error: 'Run must be APPROVED before finalising' });

    const finalisedAt = new Date();
    await prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'FINALISED', finalisedAt } });
    // Publish payslips — PAY-005: stamp publishedAt for SLA tracking + archive search
    await prisma.payslip.updateMany({ where: { runId: run.id }, data: { isPublished: true, publishedAt: finalisedAt } });

    // PAY-005: fire-and-forget publish notifications to employees
    fireAndForget(() => sendPublishNotifications(run, req.headers.authorization));

    // Auto-consolidate: merge any duplicate payslips for this period across runs
    const consolidatedCount = await consolidatePeriod(run.period, run.id);

    // Auto-generate payroll journal (best-effort — never block finalisation)
    let journalResult = null;
    try {
      const payslips = await prisma.payslip.findMany({ where: { runId: run.id } });
      const allocs = await prisma.employeeCostCentre.findMany({
        where: {
          employeeId: { in: payslips.map(p => p.employeeId) },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
        },
        include: { costCentre: true },
      });
      const allocByEmp = {};
      for (const a of allocs) {
        (allocByEmp[a.employeeId] ||= []).push({
          costCentreId: a.costCentreId, percentage: a.percentage, costCentre: a.costCentre,
        });
      }
      const allEntries = [];
      for (const ps of payslips) {
        const decoded = {
          employeeId: ps.employeeId, period: ps.period,
          grossPay:    decSafe(ps.grossPayEnc),
          netPay:      decSafe(ps.netPayEnc),
          employeeCpf: decSafe(ps.employeeCpfEnc),
          employerCpf: decSafe(ps.employerCpfEnc),
          sdl:         decSafe(ps.sdlAmountEnc),
          fwl:         decSafe(ps.fwlAmountEnc),
        };
        allEntries.push(...buildEntriesForEmployee(decoded, allocByEmp[ps.employeeId] || []));
      }
      const totals = summariseEntries(allEntries);

      await prisma.$transaction(async (tx) => {
        const existing = await tx.payrollJournal.findUnique({ where: { runId: run.id } });
        if (existing) await tx.payrollJournal.delete({ where: { id: existing.id } });
        const journal = await tx.payrollJournal.create({
          data: { runId: run.id, period: run.period, totalDebit: totals.debit, totalCredit: totals.credit, status: 'DRAFT' },
        });
        await tx.payrollJournalEntry.createMany({
          data: allEntries.map(e => ({
            journalId: journal.id, account: e.account, accountName: e.accountName,
            side: e.side, description: e.description, amountEnc: encrypt(String(e.amount)),
            costCentreId: e.costCentreId || null, employeeId: e.employeeId || null,
          })),
        });
      });
      journalResult = { balanced: totals.balanced, totalDebit: totals.debit, totalCredit: totals.credit, entries: allEntries.length };
    } catch (jerr) {
      console.error('[finalise] journal generation failed:', jerr.message);
      journalResult = { error: jerr.message };
    }

    res.json({
      message: 'Payroll finalised. Payslips published.',
      consolidated: consolidatedCount > 0,
      consolidatedEmployees: consolidatedCount,
      journal: journalResult,
    });
  } catch (err) { next(err); }
});

// ─── GET /payroll/runs/:id/variance ─ Show what this run adds vs existing ────
router.get('/runs/:id/variance', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });

    // Payslips for THIS run
    const thisRunPayslips = await prisma.payslip.findMany({ where: { runId: run.id } });

    // Published payslips for the same period from OTHER runs
    const otherPayslips = await prisma.payslip.findMany({
      where: { period: run.period, isPublished: true, runId: { not: run.id } },
    });

    // Build lookup: employeeId → existing (other runs) payslip values
    const existingByEmp = {};
    for (const ps of otherPayslips) {
      existingByEmp[ps.employeeId] = {
        existingNet: decSafe(ps.netPayEnc),
        existingGross: decSafe(ps.grossPayEnc),
      };
    }

    // Count distinct other runs
    const otherRunIds = [...new Set(otherPayslips.map(p => p.runId))];

    const rows = thisRunPayslips.map(ps => {
      const existing = existingByEmp[ps.employeeId] || { existingNet: 0, existingGross: 0 };
      const thisNet   = decSafe(ps.netPayEnc);
      const thisGross = decSafe(ps.grossPayEnc);
      return {
        employeeId:    ps.employeeId,
        existingNet:   existing.existingNet,
        existingGross: existing.existingGross,
        thisNet,
        thisGross,
        combinedNet:   existing.existingNet + thisNet,
        combinedGross: existing.existingGross + thisGross,
        delta:         thisNet,
        hasExisting:   existing.existingNet > 0 || existing.existingGross > 0,
      };
    });

    const hasConflicts = otherPayslips.length > 0;
    res.json({ hasConflicts, period: run.period, rows, otherRunCount: otherRunIds.length });
  } catch (err) { next(err); }
});

// ─── POST /payroll/runs/:id/consolidate ─ Manually consolidate a period ──────
router.post('/runs/:id/consolidate', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'FINALISED') return res.status(400).json({ error: 'Run must be FINALISED to consolidate' });

    const count = await consolidatePeriod(run.period, run.id);
    res.json({ message: `Consolidation complete for ${run.period}.`, period: run.period, consolidatedEmployees: count });
  } catch (err) { next(err); }
});

// ─── GET /payroll/payslips/me ─ Employee's own payslip list ──────────────────
router.get('/payslips/me', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user.employeeId;
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });

    const payslips = await prisma.payslip.findMany({
      where: { employeeId, isPublished: true },
      orderBy: { period: 'desc' },
      select: {
        id: true, period: true, isPublished: true, createdAt: true,
        netPayEnc: true, grossPayEnc: true, employeeCpfEnc: true, basicSalaryEnc: true,
        ytdGrossEnc: true, ytdEmployeeCpfEnc: true,
        nplDays: true, nplDeductionEnc: true, govtPaidDays: true, govtPaidAmountEnc: true,
      },
    });

    const result = payslips.map(ps => ({
      id: ps.id,
      period: ps.period,
      isPublished: ps.isPublished,
      createdAt: ps.createdAt,
      basicSalary: parseFloat(decrypt(ps.basicSalaryEnc)) || 0,
      grossPay: parseFloat(decrypt(ps.grossPayEnc)) || 0,
      netPay: parseFloat(decrypt(ps.netPayEnc)) || 0,
      employeeCpf: parseFloat(decrypt(ps.employeeCpfEnc)) || 0,
      ytdGross: ps.ytdGrossEnc ? (parseFloat(decrypt(ps.ytdGrossEnc)) || 0) : null,
      ytdEmployeeCpf: ps.ytdEmployeeCpfEnc ? (parseFloat(decrypt(ps.ytdEmployeeCpfEnc)) || 0) : null,
      nplDays: ps.nplDays || 0,
      nplDeduction: ps.nplDeductionEnc ? (parseFloat(decrypt(ps.nplDeductionEnc)) || 0) : 0,
      govtPaidDays: ps.govtPaidDays || 0,
      govtPaidAmount: ps.govtPaidAmountEnc ? (parseFloat(decrypt(ps.govtPaidAmountEnc)) || 0) : 0,
    }));

    // Dedup safeguard: if multiple payslips exist for same period, keep highest netPay
    const dedupMap = new Map();
    for (const ps of result) {
      const existing = dedupMap.get(ps.period);
      if (!existing || ps.netPay > existing.netPay) dedupMap.set(ps.period, ps);
    }
    const deduped = Array.from(dedupMap.values()).sort((a, b) => b.period.localeCompare(a.period));

    res.json({ payslips: deduped, total: deduped.length, employeeId });
  } catch (err) { next(err); }
});

// ─── GET /payroll/payslips/me/:period ─ Employee's own payslip PDF ────────────
// Kept separate from /:employeeId/:period for two reasons (M-19):
//   1. URL never carries the employeeId, so it can't be brute-forced or
//      accidentally logged with another user's id from a shared device.
//   2. The handler always uses req.user.employeeId from the verified JWT,
//      so there is no path where an attacker could supply an alternate id.
router.get('/payslips/me/:period', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user.employeeId;
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    return streamPayslipPdf(req, res, employeeId, req.params.period);
  } catch (err) { next(err); }
});

// ─── GET /payroll/payslips/:employeeId/:period ─ Download payslip PDF ────────
// PAY-005: reserved-segment guard prevents the :employeeId wildcard from
// shadowing sibling routes like /payslips/sla/* and /payslips/archive.
const PAYSLIP_RESERVED = new Set(['sla', 'archive', 'me']);
router.get('/payslips/:employeeId/:period', authenticate, async (req, res, next) => {
  if (PAYSLIP_RESERVED.has(req.params.employeeId)) return next();
  try {
    const { employeeId, period } = req.params;
    const isAdmin = ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER'].includes(String(req.user?.role || '').toUpperCase());
    if (!isAdmin && req.user.employeeId !== employeeId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    return streamPayslipPdf(req, res, employeeId, period);
  } catch (err) { next(err); }
});

// ─── PAY-005: shared MOM-compliant payslip PDF streamer ─────────────────────
async function streamPayslipPdf(req, res, employeeId, period) {
  const payslip = await prisma.payslip.findFirst({ where: { employeeId, period, isPublished: true }, include: { run: true } });
  if (!payslip) return res.status(404).json({ error: 'Payslip not found or not yet published' });

  // Fetch line items so allowances/OT/deductions itemise properly
  const lineItems = await prisma.payrollLineItem.findMany({
    where: { runId: payslip.runId, employeeId },
    include: { /* relation to PayComponent — peek name + code */ },
  });
  const decoratedLineItems = await Promise.all(lineItems.map(async (li) => {
    let componentCode = null;
    try {
      const comp = await prisma.payComponent.findUnique({ where: { id: li.componentId }, select: { code: true, category: true } });
      componentCode = comp?.code;
    } catch (_e) {}
    return {
      description: li.description,
      amount: decSafe(li.amountEncrypted),
      wageType: li.wageType,
      isCpfApplicable: li.isCpfApplicable,
      componentCode,
    };
  }));
  const split = splitLineItems(decoratedLineItems);

  // Try to enrich with employee details (best-effort)
  let emp = { id: employeeId };
  try {
    const r = await fetch(`${EMPLOYEE_SERVICE_URL}/employees/${employeeId}`, {
      headers: { Authorization: req.headers.authorization || '' },
    });
    if (r.ok) {
      const full = await r.json();
      emp = {
        id: employeeId,
        fullName: full.fullName,
        department: full.department,
        designation: full.designation,
        nric: full.nricLast4 || null,
      };
    }
  } catch (_e) {}

  const employeeCpf = decSafe(payslip.employeeCpfEnc);
  const employerCpf = decSafe(payslip.employerCpfEnc);
  const deductions = [
    { name: 'Employee CPF Contribution', amount: employeeCpf },
    ...split.deductions,
  ];
  if (payslip.nplDays && payslip.nplDeductionEnc) {
    deductions.push({ name: `No-Pay Leave (${payslip.nplDays} day(s))`, amount: decSafe(payslip.nplDeductionEnc) });
  }

  const data = {
    company: {
      name: process.env.COMPANY_NAME || 'GaDongHR Pte Ltd',
      uen:  process.env.COMPANY_UEN  || '202512345A',
      address: process.env.COMPANY_ADDRESS || null,
    },
    employee: emp,
    run: {
      period,
      runType: payslip.run?.runType,
      paymentDate: payslip.run?.paymentDate,
    },
    earnings: {
      basicSalary: decSafe(payslip.basicSalaryEnc),
      grossPay:    decSafe(payslip.grossPayEnc),
    },
    allowances: split.allowances,
    overtime:   split.overtime,
    deductions,
    netPay:     decSafe(payslip.netPayEnc),
    employerCpf,
    sdl:        payslip.sdlAmountEnc ? decSafe(payslip.sdlAmountEnc) : null,
    fwl:        payslip.fwlAmountEnc ? decSafe(payslip.fwlAmountEnc) : null,
    ytdGross:        payslip.ytdGrossEnc        ? decSafe(payslip.ytdGrossEnc)        : null,
    ytdEmployeeCpf:  payslip.ytdEmployeeCpfEnc  ? decSafe(payslip.ytdEmployeeCpfEnc)  : null,
    ytdEmployerCpf:  payslip.ytdEmployerCpfEnc  ? decSafe(payslip.ytdEmployerCpfEnc)  : null,
    govtPaidDays:    payslip.govtPaidDays || 0,
    govtPaidAmount:  payslip.govtPaidAmountEnc ? decSafe(payslip.govtPaidAmountEnc) : 0,
    publishedAt:     payslip.publishedAt ? new Date(payslip.publishedAt).toISOString() : null,
  };

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=payslip-${employeeId}-${period}.pdf`);
  buildPayslipPdf(res, data);
}

// ─── GET /payroll/runs/:id/payslips ─ Admin: list payslips for a run ─────────
router.get('/runs/:id/payslips', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const payslips = await prisma.payslip.findMany({ where: { runId: req.params.id }, orderBy: { employeeId: 'asc' } });
    const dec = (enc) => { try { return enc ? parseFloat(decrypt(enc)) || 0 : 0; } catch { return 0; } };
    const result = payslips.map(ps => ({
      id: ps.id,
      employeeId: ps.employeeId,
      period: ps.period,
      basicSalary: dec(ps.basicSalaryEnc),
      grossPay: dec(ps.grossPayEnc),
      netPay: dec(ps.netPayEnc),
      employeeCpf: dec(ps.employeeCpfEnc),
      employerCpf: dec(ps.employerCpfEnc),
      sdl: dec(ps.sdlAmountEnc),
      fwl: dec(ps.fwlAmountEnc),
      ytdGross: dec(ps.ytdGrossEnc),
      ytdEmployeeCpf: dec(ps.ytdEmployeeCpfEnc),
      ytdEmployerCpf: dec(ps.ytdEmployerCpfEnc),
      nplDays: ps.nplDays ?? 0,
      nplDeduction: dec(ps.nplDeductionEnc),
      govtPaidDays: ps.govtPaidDays ?? 0,
      govtPaidAmount: dec(ps.govtPaidAmountEnc),
      isPublished: ps.isPublished,
    }));
    res.json({ payslips: result, total: result.length, period: run.period });
  } catch (err) { next(err); }
});

// ─── GET /payroll/cpf-file/:runId ─ Generate CPF e-Submit flat file ──────────
router.get('/cpf-file/:runId', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.runId }, include: { payslips: true } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'FINALISED') return res.status(400).json({ error: 'Run must be FINALISED to generate CPF file' });

    const uen = process.env.COMPANY_UEN || '202512345A';
    const lines = [`EMPLOYER|${uen}|${run.period}|CPF_SUBMIT`];
    for (const ps of run.payslips) {
      const ow = decrypt(ps.basicSalaryEnc);
      const empCpf = decrypt(ps.employeeCpfEnc);
      const emplrCpf = decrypt(ps.employerCpfEnc);
      lines.push(`${ps.employeeId}|${ow}|0|${empCpf}|${emplrCpf}|0`);
    }
    const content = lines.join('\n');
    // PAY-007: auto-record / refresh a DRAFT IrasSubmission so Finance can
    // later mark it SUBMITTED with the CPF Board reference number. Best-
    // effort; file generation must never fail because of audit bookkeeping.
    fireAndForget(async () => {
      const { computeDeadline } = require('../engines/iras-submission.engine');
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const existing = await prisma.irasSubmission.findFirst({ where: { kind: 'CPF_E_SUBMIT', period: run.period } });
      const deadline = computeDeadline('CPF_E_SUBMIT', { period: run.period });
      const fileName = `cpf-esubmit-${run.period}.txt`;
      if (existing) {
        await prisma.irasSubmission.update({
          where: { id: existing.id },
          data:  { fileHash: hash, fileSize: Buffer.byteLength(content), fileName, runId: run.id, deadline },
        });
      } else {
        await prisma.irasSubmission.create({
          data: {
            id: uuidv4(), kind: 'CPF_E_SUBMIT', period: run.period, runId: run.id,
            fileName, fileHash: hash, fileSize: Buffer.byteLength(content),
            deadline, createdBy: req.user?.sub || null,
          },
        });
      }
    });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=cpf-esubmit-${run.period}.txt`);
    res.send(content);
  } catch (err) { next(err); }
});

const SUPPORTED_BANKS = ['uob', 'ocbc', 'dbs', 'scb', 'hsbc', 'maybank'];
const GENERIC_FORMAT_BANKS = ['scb', 'hsbc', 'maybank'];

// ─── GET /payroll/bank-giro/:runId?bank=uob|ocbc|dbs|scb|hsbc|maybank ────────
router.get('/bank-giro/:runId', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const bank = (req.query.bank || 'uob').toLowerCase();
    if (!SUPPORTED_BANKS.includes(bank)) {
      return res.status(400).json({ error: `Unsupported bank. Use: ${SUPPORTED_BANKS.join(', ')}` });
    }

    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.runId }, include: { payslips: true } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'FINALISED') return res.status(400).json({ error: 'Run must be FINALISED' });

    const EMPLOYEE_SERVICE_URL = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';
    const empRes = await fetch(`${EMPLOYEE_SERVICE_URL}/employees/payroll-data`, {
      headers: { 'Authorization': req.headers.authorization || '' },
    });
    if (!empRes.ok) return res.status(502).json({ error: 'Failed to fetch employee bank data' });
    const employees = await empRes.json();

    const empMap = {};
    for (const emp of employees) empMap[emp.employeeId] = emp;

    const payments = [];
    let totalAmount = 0;
    for (const ps of run.payslips) {
      const net = parseFloat(decrypt(ps.netPayEnc)) || 0;
      const emp = empMap[ps.employeeId];
      if (!emp) continue;
      totalAmount += net;
      payments.push({ employeeId: ps.employeeId, name: (emp.fullName || 'UNKNOWN').toUpperCase(), bankCode: emp.bankCode || '', bankBranchCode: emp.bankBranchCode || '', bankAccount: emp.bankAccount || '', netPay: net });
    }

    const today = new Date();
    const valueDate = req.query.valueDate ? new Date(req.query.valueDate) : today;
    const opts = {
      acct:        (req.query.acct        || '').slice(0, 34),
      companyName: resolveGiroCompanyName(req.query.companyName).slice(0, 140).toUpperCase(),
      ref:         (req.query.ref         || `PAYROLL${run.period.replace('-','')}`).slice(0, 16).toUpperCase(),
      batchNo:     (req.query.batchNo     || '001').slice(0, 3),
      payDesc:     (req.query.payDesc     || `SALARY ${run.period}`).slice(0, 35).toUpperCase(),
      valueDate,
    };

    let content, filename;
    if (bank === 'uob') {
      content = generateUobGiro(payments, totalAmount, run, today, opts);
      filename = `UGBI${pad2(today.getDate())}${pad2(today.getMonth()+1)}01.txt`;
    } else if (bank === 'ocbc') {
      content = generateOcbcGiro(payments, totalAmount, run, today, opts);
      filename = `OCBC-GIRO-${run.period}.txt`;
    } else if (bank === 'dbs') {
      content = generateDbsGiro(payments, totalAmount, run, today, opts);
      filename = `DBS-GIRO-${run.period}.txt`;
    } else {
      // SCB / HSBC / Maybank — generic CSV (replace when bank-specific spec received)
      content = generateGenericCsvGiro(payments, totalAmount, run, today, opts, bank);
      filename = `${bank.toUpperCase()}-GIRO-${run.period}.csv`;
    }

    // Persist payment records for ACK reconciliation (fire-and-forget)
    const crypto = require('crypto');
    prisma.giroPayment.deleteMany({ where: { runId: run.id } }).then(() =>
      prisma.giroPayment.createMany({
        data: payments.map(p => ({
          id: crypto.randomUUID(),
          runId: run.id,
          employeeId: p.employeeId,
          employeeName: p.name,
          bank,
          bankCode: p.bankCode || null,
          bankAccount: p.bankAccount || null,
          amountEnc: encrypt(String(p.netPay)),
          status: 'PENDING',
        })),
      })
    ).catch(e => console.error('[giro] Failed to persist payment records:', e.message));

    if (GENERIC_FORMAT_BANKS.includes(bank)) {
      res.setHeader('X-Bank-Format-Status', 'GENERIC - replace with bank-specific template when spec is received');
    }
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(content);
  } catch (err) { next(err); }
});

// ─── GET /payroll/bank-giro/:runId/payments ─ ACK payment status list ────────
router.get('/bank-giro/:runId/payments', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const payments = await prisma.giroPayment.findMany({
      where: { runId: req.params.runId },
      orderBy: { generatedAt: 'desc' },
    });
    const total   = payments.length;
    const pending  = payments.filter(p => p.status === 'PENDING').length;
    const sent     = payments.filter(p => p.status === 'SENT').length;
    const returned = payments.filter(p => p.status === 'RETURNED').length;
    const failed   = payments.filter(p => p.status === 'FAILED').length;
    const failed_payments = payments.filter(p => ['RETURNED', 'FAILED'].includes(p.status));
    res.json({ runId: req.params.runId, total, summary: { pending, sent, returned, failed }, failedPayments: failed_payments, payments });
  } catch (err) { next(err); }
});

// ─── POST /payroll/bank-giro/:runId/ack ─ Parse bank ACK / return file ────────
// Query: ?bank=dbs|uob|ocbc|scb|hsbc|maybank&format=auto|csv|dbs
// Body: { fileContent: '<raw text of the return file>' }
router.post('/bank-giro/:runId/ack', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { runId } = req.params;
    const bank   = (req.query.bank || 'dbs').toLowerCase();
    const format = (req.query.format || 'auto').toLowerCase();
    const { fileContent } = req.body;
    if (!fileContent || typeof fileContent !== 'string') {
      return res.status(400).json({ error: 'fileContent (string) is required in request body' });
    }

    const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const stored = await prisma.giroPayment.findMany({ where: { runId } });
    if (!stored.length) return res.status(400).json({ error: 'No payment records found for this run — generate the GIRO file first' });

    // Build account → payment map for matching
    const byAccount = {};
    for (const p of stored) byAccount[normaliseAcct(p.bankAccount)] = p;

    let parsed;
    if (format === 'dbs' || (format === 'auto' && bank === 'dbs')) {
      parsed = parseDbsAck(fileContent);
    } else {
      parsed = parseCsvAck(fileContent);
    }

    let matched = 0; let unmatched = 0;
    const updates = [];
    for (const row of parsed) {
      const key = normaliseAcct(row.account);
      const rec = byAccount[key];
      if (!rec) { unmatched++; continue; }
      matched++;
      const isReturn = row.returned;
      updates.push(
        prisma.giroPayment.update({
          where: { id: rec.id },
          data: {
            status:      isReturn ? 'RETURNED' : 'SENT',
            returnCode:  row.returnCode   || null,
            returnReason: row.returnReason || null,
            processedAt: new Date(),
          },
        })
      );
    }

    await Promise.all(updates);

    const failed = await prisma.giroPayment.findMany({
      where: { runId, status: { in: ['RETURNED', 'FAILED'] } },
    });

    res.json({
      runId,
      bank,
      parsedRows: parsed.length,
      matched,
      unmatched,
      failedCount: failed.length,
      failedPayments: failed,
    });
  } catch (err) { next(err); }
});

function normaliseAcct(acct) { return (acct || '').replace(/[-\s]/g, '').toLowerCase(); }

// Parse DBS CLEARS return file — failed records have a non-zero return code in pos 94-96
function parseDbsAck(content) {
  const results = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    const type = line.slice(-1); // last char = record type
    if (type !== '1') continue;  // only detail records
    const account    = line.slice(4, 18).trim();
    const returnCode = line.slice(93, 96).trim();
    const returned   = returnCode !== '' && returnCode !== '000' && returnCode !== '00';
    results.push({ account, returnCode, returnReason: DBS_RETURN_CODES[returnCode] || null, returned });
  }
  return results;
}

// Parse generic CSV return file: account,status,return_code,reason
// Status: R/RETURNED/FAILED = failed; S/SENT/OK = success
function parseCsvAck(content) {
  const results = [];
  const lines = content.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  const isHeader = l => /account|status|code/i.test(l.split(',')[0]);
  const rows = lines.filter(l => !isHeader(l));
  for (const row of rows) {
    const cols = row.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;
    const account    = cols[0];
    const status     = (cols[1] || '').toUpperCase();
    const returnCode = cols[2] || '';
    const reason     = cols[3] || '';
    const returned   = ['R', 'RETURNED', 'FAILED', 'F', 'REJECT', 'REJECTED'].includes(status);
    results.push({ account, returnCode, returnReason: reason || null, returned });
  }
  return results;
}

// DBS GIRO return / rejection codes (partial — add more from bank spec)
const DBS_RETURN_CODES = {
  '01': 'Insufficient funds',
  '02': 'Account closed',
  '03': 'Account not found',
  '04': 'Payment stopped by payer',
  '05': 'Invalid account number',
  '06': 'Account frozen',
  '07': 'Amount exceeds limit',
  '08': 'Account dormant',
  '09': 'Account not accepting GIRO',
  '10': 'Currency mismatch',
};

// ─── GIRO generator helpers ──────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, '0'); }
function pR(str, len) { return String(str || '').padEnd(len, ' ').slice(0, len); }   // left-align (pad right)
function pL(str, len, ch = '0') { return String(str || '').padStart(len, ch).slice(-len); } // right-align (pad left)
function amtCents(val, len) { return pL(String(Math.round(val * 100)), len); }       // amount → cents, right-justified

// Map stored bank code / name → BIC
function toBic(code, name) {
  const m = {
    '7171': 'DBSSSGSGXXX', 'DBS': 'DBSSSGSGXXX',
    '7375': 'UOVBSGSGXXX', 'UOB': 'UOVBSGSGXXX',
    '7339': 'OCBCSGSGXXX', 'OCBC': 'OCBCSGSGXXX',
    '7302': 'MBBESGSGXXX', 'MAYBANK': 'MBBESGSGXXX', 'MBB': 'MBBESGSGXXX',
    '9496': 'SCBLSGSGXXX', 'SCB': 'SCBLSGSGXXX', 'SC': 'SCBLSGSGXXX', 'STANDARD CHARTERED': 'SCBLSGSGXXX',
    '7232': 'HSBCSGSGXXX', 'HSBC': 'HSBCSGSGXXX',
  };
  const k = (code || '').trim().toUpperCase();
  const n = (name || '').trim().toUpperCase();
  return m[k] || m[n] || m[k.replace(/SGSGXXX$/,'')] || 'DBSSSGSGXXX';
}

// Map stored bank code / name → 4-digit DBS IDEAL bank code
function toDbsCode(code, name) {
  const m = {
    '7171': '7171', 'DBS': '7171', 'DBSSSGSGXXX': '7171',
    '7375': '7375', 'UOB': '7375', 'UOVBSGSGXXX': '7375',
    '7339': '7339', 'OCBC': '7339', 'OCBCSGSGXXX': '7339',
    '7302': '7302', 'MAYBANK': '7302', 'MBB': '7302', 'MBBESGSGXXX': '7302',
    '9496': '9496', 'SCB': '9496', 'SC': '9496', 'STANDARD CHARTERED': '9496', 'SCBLSGSGXXX': '9496',
    '7232': '7232', 'HSBC': '7232', 'HSBCSGSGXXX': '7232',
  };
  const k = (code || '').trim().toUpperCase();
  const n = (name || '').trim().toUpperCase();
  return m[k] || m[n] || '7171';
}


/**
 * Originating employer name for a GIRO / bank payment file.
 *
 * Deliberately has NO default. This is the customer's own registered entity —
 * per-company payroll data, not a product brand — and it is printed on a file
 * the bank acts on. A fallback would silently stamp the wrong company onto a
 * real payment instruction, which the bank accepts and the customer discovers
 * only afterwards. Better to refuse to generate the file.
 *
 * Supplied per request, or per deployment via COMPANY_NAME.
 */
function resolveGiroCompanyName(supplied) {
  const name = supplied || process.env.COMPANY_NAME;
  if (!name || !String(name).trim()) {
    throw Object.assign(
      new Error('companyName is required to generate a bank file — set it on the request or COMPANY_NAME'),
      { status: 400 },
    );
  }
  return String(name).trim();
}

function yyyymmdd(d) { return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`; }
function ddmmyyyy(d) { return `${pad2(d.getDate())}${pad2(d.getMonth()+1)}${d.getFullYear()}`; }
function ddmmyy(d)   { return `${pad2(d.getDate())}${pad2(d.getMonth()+1)}${String(d.getFullYear()).slice(-2)}`; }

// ── UOB Infinity Bulk GIRO (without Payment Advice) ─────────────────────────
// Spec: UOB Bulk FAST & GIRO Format Specification v4.81
// Record size: 615 chars, CRLF line endings
function generateUobGiro(payments, totalAmount, run, today, opts = {}) {
  const companyAcct = (opts.acct || process.env.UOB_ACCOUNT_NO || '').replace(/[-\s]/g, '');
  const companyName = resolveGiroCompanyName(opts.companyName);
  const valueDate = opts.valueDate || today;
  const ref = opts.ref || `PAYROLL${run.period.replace('-','')}`;
  const payDesc = opts.payDesc || `SALARY ${run.period}`;
  const ddmm = `${pad2(today.getDate())}${pad2(today.getMonth()+1)}`;
  const fileName = `UGBI${ddmm}01`;
  const lines = [];

  // Record "1" — Batch Header (615 chars)
  lines.push([
    '1',                                     // [1]   pos 1:       Record Type
    pR(fileName, 10),                        // [10]  pos 2-11:    File Name
    'R',                                     // [1]   pos 12:      Payment Type (R=Payroll)
    pR('NORMAL', 10),                        // [10]  pos 13-22:   Service Type
    'B',                                     // [1]   pos 23:      Processing Mode (B=Batch GIRO)
    pR('', 12),                              // [12]  pos 24-35:   Company ID
    'UOVBSGSGXXX',                           // [11]  pos 36-46:   Originating BIC
    'SGD',                                   // [3]   pos 47-49:   Currency
    pR(companyAcct, 34),                     // [34]  pos 50-83:   Originating A/C No
    pR(companyName, 140),                    // [140] pos 84-223:  Originating A/C Name
    yyyymmdd(today),                         // [8]   pos 224-231: File Creation Date
    yyyymmdd(valueDate),                     // [8]   pos 232-239: Value Date
    pR('', 140),                             // [140] pos 240-379: Ultimate Originating Customer
    pR(ref, 16),                             // [16]  pos 380-395: Bulk Customer Reference
    pR('HRMS', 10),                          // [10]  pos 396-405: Software Label
    pR('', 210),                             // [210] pos 406-615: Filler
  ].join(''));

  // Record "2" — Batch Detail (615 chars each)
  for (const p of payments) {
    const bic = toBic(p.bankCode, '');
    const endToEndId = pR(`${p.employeeId}-${run.period}`, 35);
    lines.push([
      '2',                                   // [1]   pos 1:       Record Type
      pR(bic, 11),                           // [11]  pos 2-12:    Receiving Bank BIC
      pR((p.bankAccount || '').replace(/[-\s]/g, ''), 34), // [34] pos 13-46: Receiving A/C No (numeric only)
      pR(p.name, 140),                       // [140] pos 47-186:  Receiving A/C Name
      'SGD',                                 // [3]   pos 187-189: Currency
      amtCents(p.netPay, 18),               // [18]  pos 190-207: Amount (cents, leading zeros)
      endToEndId,                            // [35]  pos 208-242: End to End ID
      pR('', 35),                            // [35]  pos 243-277: Mandate ID
      'SALA',                                // [4]   pos 278-281: Purpose Code
      pR(payDesc, 140),                      // [140] pos 282-421: Remittance Information
      pR('', 140),                           // [140] pos 422-561: Ultimate Payer/Beneficiary
      pR(ref, 16),                           // [16]  pos 562-577: Customer Reference
      pR('', 38),                            // [38]  pos 578-615: Filler
    ].join(''));
  }

  // Record "9" — Batch Trailer (615 chars)
  lines.push([
    '9',                                     // [1]   pos 1:       Record Type
    amtCents(totalAmount, 18),              // [18]  pos 2-19:    Total Payment Amount
    pL(String(payments.length), 7),         // [7]   pos 20-26:   Total Count
    pR('', 589),                             // [589] pos 27-615:  Filler
  ].join(''));

  return lines.join('\r\n');
}

// ── OCBC GIRO/FAST (Payroll, without invoice / PayNow) ───────────────────────
// Spec: OCBC GIRO/FAST WITH INV v1.6 — header + detail records, 1000 chars each
function generateOcbcGiro(payments, totalAmount, run, today, opts = {}) {
  const companyAcct = (opts.acct || process.env.OCBC_ACCOUNT_NO || '').replace(/[-\s]/g, '');
  const ref = opts.ref || `PAYROLL${run.period.replace('-','')}`;
  const batchNo = opts.batchNo || '001';
  const payDesc = opts.payDesc || `SALARY ${run.period}`;
  const valueDate = opts.valueDate || today;
  const lines = [];

  // Header record (1000 chars)
  lines.push([
    '30',                                    // [2]   pos 1-2:     Transaction Type (30=Payroll)
    pR(batchNo, 3),                          // [3]   pos 3-5:     Batch Number
    yyyymmdd(today),                         // [8]   pos 6-13:    Submission Date (YYYYMMDD)
    'OCBCSGSGXXX',                           // [11]  pos 14-24:   Originating Bank Code
    pR(companyAcct, 34),                     // [34]  pos 25-58:   Your Account Number
    pR('', 3),                               // [3]   pos 59-61:   Filler
    pR('', 20),                              // [20]  pos 62-81:   On Behalf Of
    pR('', 120),                             // [120] pos 82-201:  Filler
    pR('', 4),                               // [4]   pos 202-205: Charge Bearer
    'GIRO',                                  // [4]   pos 206-209: Clearing
    pR(ref, 16),                             // [16]  pos 210-225: Your Reference Number
    ddmmyyyy(valueDate),                     // [8]   pos 226-233: Value Date (DDMMYYYY)
    pR('', 4),                               // [4]   pos 234-237: Value Time (blank for GIRO)
    ' ',                                     // [1]   pos 238:     Batch Booking
    pR('', 762),                             // [762] pos 239-1000: Filler
  ].join(''));

  // Detail records (1000 chars each)
  for (const p of payments) {
    const bic = toBic(p.bankCode, '');
    lines.push([
      pR(bic, 11),                           // [11]  pos 1-11:    Bank Code (BIC)
      pR((p.bankAccount || '').replace(/[-\s]/g, ''), 34), // [34] pos 12-45: Account Number (numeric only)
      pR(p.name, 140),                       // [140] pos 46-185:  Employee Name
      pR('', 3),                             // [3]   pos 186-188: Currency (blank)
      amtCents(p.netPay, 17),               // [17]  pos 189-205: Amount (cents, leading zeros)
      pR(payDesc, 35),                       // [35]  pos 206-240: Payment Details
      'SALA',                                // [4]   pos 241-244: Purpose Code
      pR('', 35),                            // [35]  pos 245-279: Debtors Reference
      pR('', 140),                           // [140] pos 280-419: Ultimate Creditor Name
      pR('', 140),                           // [140] pos 420-559: Ultimate Debtor Name
      ' ',                                   // [1]   pos 560:     Send Remittance Advice Via
      pR('', 255),                           // [255] pos 561-815: Send Details
      pR('', 12),                            // [12]  pos 816-827: Proxy Type
      pR('', 140),                           // [140] pos 828-967: Proxy Value
      pR('', 33),                            // [33]  pos 968-1000: Filler
    ].join(''));
  }

  return lines.join('\r\n');
}

// ── DBS IDEAL Payroll GIRO ───────────────────────────────────────────────────
// Reverse-engineered from real DBS GIRO sample files.
// Record size: 114 chars (115 for OCBC 15-digit accounts); record type at END.
// "0"=header  "1"=detail  "9"=trailer
function generateDbsGiro(payments, totalAmount, run, today, opts = {}) {
  const companyAcctRaw = (opts.acct || process.env.DBS_ACCOUNT_NO || '').replace(/[-\s]/g, '');
  const companyName = resolveGiroCompanyName(opts.companyName).slice(0, 20);
  const ref = (opts.ref || `SAL${run.period.replace('-','')}`).slice(0, 10);
  const lines = [];

  // Count distinct receiving bank codes (used in header pos 92-96)
  const distinctBanks = new Set(payments.map(p => toDbsCode(p.bankCode, '')));

  // Header account: "7171" (company is at DBS) + 14-char account, total 18 chars
  const headerAcct = '7171' + pR(companyAcctRaw, 14);

  // Date YYMMDD
  const yymmdd = String(today.getFullYear()).slice(-2) + pad2(today.getMonth() + 1) + pad2(today.getDate());

  // Header record — 114 chars, record type "0" at position 114
  lines.push(
    yymmdd +                           // pos 1-6:    Date YYMMDD
    pR('', 45) +                       // pos 7-51:   Filler
    headerAcct +                       // pos 52-69:  Company account (18 chars)
    '  ' +                             // pos 70-71:  Spaces
    pR(companyName, 20) +              // pos 72-91:  Company Name
    pL(String(distinctBanks.size), 5) + // pos 92-96: Distinct receiving bank count
    pR(ref, 10) +                      // pos 97-106: Reference
    pR('', 7) +                        // pos 107-113: Filler
    '0'                                // pos 114:    Record type
  );

  // Detail records — 114 chars (115 for 15-digit OCBC accounts), record type "1" at end
  for (const p of payments) {
    const dbsCode = toDbsCode(p.bankCode, '');
    const acctStripped = (p.bankAccount || '').replace(/[-\s]/g, '');
    // OCBC accounts can be 15 digits — account field expands by 1, total becomes 115
    const acctField = pR(acctStripped, acctStripped.length > 14 ? 15 : 14);
    lines.push(
      dbsCode +                        // pos 1-4:    Receiving Bank Code (4 digits)
      acctField +                      // pos 5-18:   Account Number (14 chars, or 15 for OCBC)
      pR(p.name, 20) +                 // Payee Name  (20 chars)
      '22' +                           // Transaction Code
      amtCents(p.netPay, 11) +        // Amount in cents (11 chars, right-justified)
      pR('', 62) +                     // Filler
      '1'                              // Record type
    );
  }

  // Trailer record — 114 chars, record type "9" at position 114
  lines.push(
    pL(String(payments.length), 8) +  // pos 1-8:    Credit transaction count (8 digits)
    amtCents(totalAmount, 11) +       // pos 9-19:   Credit amount in cents (11 digits)
    pR('', 5) +                        // pos 20-24:  Filler
    '00000000' +                       // pos 25-32:  Debit count (zero-padded)
    '00000000000' +                    // pos 33-43:  Debit amount in cents (zero-padded)
    pR('', 70) +                       // pos 44-113: Filler
    '9'                                // pos 114:    Record type
  );

  return lines.join('\r\n');
}

// ── Generic CSV GIRO (SCB / HSBC / Maybank — replace with bank-specific format) ─
// Column headers match the common bulk-payment CSV accepted by most SG corporate portals.
function generateGenericCsvGiro(payments, totalAmount, run, today, opts = {}, bank = 'generic') {
  const payDesc = opts.payDesc || `SALARY ${run.period}`;
  const ref     = opts.ref     || `PAYROLL${run.period.replace('-', '')}`;
  const csvEsc  = v => `"${String(v || '').replace(/"/g, '""')}"`;
  const fmt     = v => v.toFixed(2);

  const header = [
    '# GENERIC PAYROLL GIRO FILE',
    `# Bank: ${bank.toUpperCase()}-GIRO`,
    `# Period: ${run.period}`,
    `# Generated: ${today.toISOString()}`,
    `# IMPORTANT: This file uses a generic CSV format.`,
    `#            Replace with bank-specific format when spec is received.`,
    `# Total payments: ${payments.length}  Total amount: SGD ${totalAmount.toFixed(2)}`,
    '',
    'PAYMENT_DATE,PAYEE_NAME,BANK_CODE,ACCOUNT_NO,CURRENCY,AMOUNT,REFERENCE,DESCRIPTION,PURPOSE_CODE',
  ].join('\r\n');

  const valueDateStr = opts.valueDate
    ? `${opts.valueDate.getFullYear()}-${pad2(opts.valueDate.getMonth()+1)}-${pad2(opts.valueDate.getDate())}`
    : `${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;

  const rows = payments.map(p => [
    csvEsc(valueDateStr),
    csvEsc(p.name),
    csvEsc(p.bankCode || ''),
    csvEsc((p.bankAccount || '').replace(/[-\s]/g, '')),
    csvEsc('SGD'),
    csvEsc(fmt(p.netPay)),
    csvEsc(`${ref}-${p.employeeId}`.slice(0, 35)),
    csvEsc(payDesc.slice(0, 50)),
    csvEsc('SALA'),
  ].join(','));

  const trailer = [
    '',
    `# TOTAL RECORDS: ${payments.length}`,
    `# TOTAL AMOUNT SGD: ${totalAmount.toFixed(2)}`,
  ].join('\r\n');

  return [header, ...rows, trailer].join('\r\n');
}

// ─── GET /payroll/period-config/:period ─ MOM working-day config for a period ─
router.get('/period-config/:period', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { period } = req.params;
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'Period must be YYYY-MM' });
    const [y, m] = period.split('-').map(Number);
    const pStart = new Date(y, m - 1, 1);
    const pEnd   = new Date(y, m,     0);

    const [config, holidays] = await Promise.all([
      prisma.payrollPeriodConfig.findUnique({ where: { period } }),
      prisma.publicHoliday.findMany({
        where: { date: { gte: pStart, lte: pEnd } },
        select: { id: true, date: true, name: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    const workDayType = config?.workDayType || 'FIVE_DAY';
    const hSet = new Set(holidays.map(h => h.date.toISOString().slice(0, 10)));
    const recommended = countWorkingDays(pStart, pEnd, hSet, workDayType);

    res.json({
      period,
      workDayType,
      workingDays:          config?.workingDays ?? recommended,
      recommendedWorkingDays: recommended,
      isOverridden:         config?.workingDays != null,
      notes:                config?.notes ?? null,
      publicHolidays:       holidays.map(h => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name })),
    });
  } catch (err) { next(err); }
});

// ─── PUT /payroll/period-config/:period ─ Save working-day override ──────────
router.put('/period-config/:period', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { period } = req.params;
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'Period must be YYYY-MM' });
    const { workDayType = 'FIVE_DAY', workingDays, notes } = req.body;

    if (!['FIVE_DAY', 'SIX_DAY'].includes(workDayType)) {
      return res.status(400).json({ error: 'workDayType must be FIVE_DAY or SIX_DAY' });
    }
    if (workingDays !== undefined && workingDays !== null) {
      const n = Number(workingDays);
      if (!Number.isInteger(n) || n < 1 || n > 31) {
        return res.status(400).json({ error: 'workingDays must be an integer between 1 and 31' });
      }
    }

    const config = await prisma.payrollPeriodConfig.upsert({
      where:  { period },
      create: { id: uuidv4(), period, workDayType, workingDays: workingDays ?? null, notes: notes ?? null },
      update: { workDayType, workingDays: workingDays ?? null, notes: notes ?? null },
    });
    res.json(config);
  } catch (err) { next(err); }
});

// ─── GET /payroll/public-holidays ─ List holidays (filter by year) ───────────
router.get('/public-holidays', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { year } = req.query;
    const where = year ? { year: Number(year) } : {};
    const holidays = await prisma.publicHoliday.findMany({ where, orderBy: { date: 'asc' } });
    res.json(holidays.map(h => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name, year: h.year })));
  } catch (err) { next(err); }
});

// ─── POST /payroll/public-holidays ─ Add a public holiday ────────────────────
router.post('/public-holidays', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const { date, name } = req.body;
    if (!date || !name) return res.status(400).json({ error: 'date (YYYY-MM-DD) and name are required' });
    const d = new Date(date);
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid date' });
    const year = d.getUTCFullYear();
    const holiday = await prisma.publicHoliday.create({
      data: { id: uuidv4(), date: d, name: name.trim(), year },
    });
    res.status(201).json({ id: holiday.id, date: holiday.date.toISOString().slice(0, 10), name: holiday.name, year: holiday.year });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A holiday on this date already exists' });
    next(err);
  }
});

// ─── DELETE /payroll/public-holidays/:id ─ Remove a public holiday ─────────
router.delete('/public-holidays/:id', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    await prisma.publicHoliday.delete({ where: { id: req.params.id } });
    res.json({ message: 'Holiday removed' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Holiday not found' });
    next(err);
  }
});

// ─── Helper functions ────────────────────────────────────────────────────────

function drawLine(doc) {
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.5);
}

// POST /payroll/purge — PDPA data retention purge (internal, SUPER_ADMIN only)
// Purges PayrollRuns whose period end date + retentionYears <= today
router.post('/purge', authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res, next) => {
  try {
    const retentionYears = parseInt(req.body.retentionYears) || 5;
    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - retentionYears);

    // period field is "YYYY-MM" — last day of that month is the retention anchor
    // Purge runs where the last day of their period <= cutoff
    const targets = await prisma.$queryRaw`
      SELECT id FROM payroll_runs
      WHERE (to_date(period, 'YYYY-MM') + INTERVAL '1 month - 1 day') <= ${cutoff}
        AND status IN ('FINALISED', 'PAID')
    `;

    if (targets.length === 0) {
      return res.json({ purged: 0, cutoff: cutoff.toISOString().slice(0, 10) });
    }

    const ids = targets.map(t => t.id);

    await prisma.$executeRaw`DELETE FROM payroll_line_items WHERE "runId" = ANY(${ids}::uuid[])`;
    await prisma.$executeRaw`DELETE FROM payslips WHERE "runId" = ANY(${ids}::uuid[])`;
    const purged = await prisma.$executeRaw`DELETE FROM payroll_runs WHERE id = ANY(${ids}::uuid[])`;

    for (const tbl of ['payroll_runs', 'payroll_line_items', 'payslips']) {
      await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${tbl}`).catch(() => {});
    }

    res.json({ purged: Number(purged), cutoff: cutoff.toISOString().slice(0, 10) });
  } catch (err) { next(err); }
});

// ── GET /payroll/ir8a-data/:year ───────────────────────────────────────────────
router.get('/ir8a-data/:year', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { year } = req.params;
    const EMPLOYEE_URL = process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002';

    // All finalised payslips for the year, one per employee (last in year by period)
    const payslips = await prisma.payslip.findMany({
      where: { period: { startsWith: year }, isPublished: true },
      orderBy: { period: 'desc' },
    });

    // Deduplicate: keep last finalised payslip per employee (max YTD)
    const byEmp = {};
    for (const ps of payslips) {
      if (!byEmp[ps.employeeId] || decSafe(ps.ytdGrossEnc) > decSafe(byEmp[ps.employeeId].ytdGrossEnc)) {
        byEmp[ps.employeeId] = ps;
      }
    }

    // Sum AW line items across all runs in the year (bonus/AWS)
    const awItems = await prisma.payrollLineItem.findMany({
      where: { wageType: 'AW', isIrasTaxable: true, run: { period: { startsWith: year } } },
    });
    const awByEmp = {};
    for (const item of awItems) {
      const amt = decSafe(item.amountEnc);
      awByEmp[item.employeeId] = (awByEmp[item.employeeId] || 0) + amt;
    }

    // Appendix 8A — sum BIK items per employee for the year
    const bikItems = await prisma.bikItem.findMany({ where: { year: parseInt(year, 10) } });
    const bikByEmp = {};
    for (const it of bikItems) {
      bikByEmp[it.employeeId] = (bikByEmp[it.employeeId] || 0) + decSafe(it.annualValueEnc);
    }

    // Appendix 8B — sum stock option exercise gains per employee for the year
    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd   = new Date(`${parseInt(year, 10) + 1}-01-01T00:00:00Z`);
    const exercises = await prisma.stockOptionExercise.findMany({
      where: { exerciseDate: { gte: yearStart, lt: yearEnd } },
      include: { grant: { select: { employeeId: true } } },
    });
    const esopByEmp = {};
    for (const e of exercises) {
      esopByEmp[e.grant.employeeId] = (esopByEmp[e.grant.employeeId] || 0) + decSafe(e.taxableGainEnc);
    }

    // Union of all employees mentioned (payslips + BIK-only + ESOP-only)
    const allEmpIds = new Set([
      ...Object.keys(byEmp),
      ...Object.keys(bikByEmp),
      ...Object.keys(esopByEmp),
    ]);

    // Fetch employee master for name/NRIC (best-effort; mask NRIC)
    const empLookup = {};
    try {
      const { data } = await require('axios').get(`${EMPLOYEE_URL}/employees?limit=1000`, { headers: { Authorization: req.headers.authorization } });
      for (const e of (data.employees || [])) empLookup[e.id] = e;
    } catch {}

    const records = Array.from(allEmpIds).map(empId => {
      const ps  = byEmp[empId];
      const emp = empLookup[empId] || {};
      const ytdGross       = ps ? decSafe(ps.ytdGrossEnc) : 0;
      const ytdEmployeeCpf = ps ? decSafe(ps.ytdEmployeeCpfEnc) : 0;
      const ytdEmployerCpf = ps ? decSafe(ps.ytdEmployerCpfEnc) : 0;
      const awIncome       = Math.round((awByEmp[empId] || 0) * 100) / 100;
      const bikValue       = Math.round((bikByEmp[empId] || 0) * 100) / 100;
      const stockGain      = Math.round((esopByEmp[empId] || 0) * 100) / 100;
      const nric           = emp.nric ? `${emp.nric.slice(0, 1)}XXXX${emp.nric.slice(-4)}` : null;
      return {
        employeeId: empId,
        employeeCode: emp.employeeCode || null,
        fullName: emp.fullName || empId,
        nric, citizenshipStatus: emp.citizenshipStatus || null,
        employmentIncome: Math.round(ytdGross * 100) / 100,
        employeeCpf: Math.round(ytdEmployeeCpf * 100) / 100,
        employerCpf: Math.round(ytdEmployerCpf * 100) / 100,
        awIncome,
        benefitsInKind: bikValue,         // Appendix 8A total
        stockOptionGain: stockGain,        // Appendix 8B total
        otherTaxableIncome: 0,
      };
    });

    res.json({ year, generatedAt: new Date().toISOString(), count: records.length, records });
  } catch (err) { next(err); }
});

// ── GET /payroll/ir8a-file/:year ─ IRAS AIS flat-file ─────────────────────────
router.get('/ir8a-file/:year', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { year } = req.params;
    const UEN = process.env.COMPANY_UEN || 'UNKNOWN';

    // Reuse the data endpoint logic inline
    const payslips = await prisma.payslip.findMany({
      where: { period: { startsWith: year }, isPublished: true },
      orderBy: { period: 'desc' },
    });
    const byEmp = {};
    for (const ps of payslips) {
      if (!byEmp[ps.employeeId] || decSafe(ps.ytdGrossEnc) > decSafe(byEmp[ps.employeeId].ytdGrossEnc)) {
        byEmp[ps.employeeId] = ps;
      }
    }
    const awItems = await prisma.payrollLineItem.findMany({
      where: { wageType: 'AW', isIrasTaxable: true, run: { period: { startsWith: year } } },
    });
    const awByEmp = {};
    for (const item of awItems) awByEmp[item.employeeId] = (awByEmp[item.employeeId] || 0) + decSafe(item.amountEnc);

    // Appendix 8A — BIK totals per employee
    const bikItems = await prisma.bikItem.findMany({ where: { year: parseInt(year, 10) } });
    const bikByEmp = {};
    for (const it of bikItems) bikByEmp[it.employeeId] = (bikByEmp[it.employeeId] || 0) + decSafe(it.annualValueEnc);

    // Appendix 8B — stock option exercise gains per employee for the year
    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd   = new Date(`${parseInt(year, 10) + 1}-01-01T00:00:00Z`);
    const exercises = await prisma.stockOptionExercise.findMany({
      where: { exerciseDate: { gte: yearStart, lt: yearEnd } },
      include: { grant: { select: { employeeId: true } } },
    });
    const esopByEmp = {};
    for (const e of exercises) esopByEmp[e.grant.employeeId] = (esopByEmp[e.grant.employeeId] || 0) + decSafe(e.taxableGainEnc);

    const empLookup = {};
    try {
      const { data } = await require('axios').get(`${process.env.EMPLOYEE_SERVICE_URL || 'http://employee-service:4002'}/employees?limit=1000`, { headers: { Authorization: req.headers.authorization } });
      for (const e of (data.employees || [])) empLookup[e.id] = e;
    } catch {}

    const allEmpIds = new Set([...Object.keys(byEmp), ...Object.keys(bikByEmp), ...Object.keys(esopByEmp)]);

    const lines = [`IR8A|${year}|${UEN}`];
    for (const empId of allEmpIds) {
      const ps   = byEmp[empId];
      const emp  = empLookup[empId] || {};
      const nric = emp.nric || 'UNKNOWN';
      const name = (emp.fullName || empId).replace(/\|/g, ' ');
      const income = ps ? Math.round(decSafe(ps.ytdGrossEnc) * 100) / 100 : 0;
      const empCpf = ps ? Math.round(decSafe(ps.ytdEmployeeCpfEnc) * 100) / 100 : 0;
      const erlCpf = ps ? Math.round(decSafe(ps.ytdEmployerCpfEnc) * 100) / 100 : 0;
      const aw     = Math.round((awByEmp[empId] || 0) * 100) / 100;
      const bik    = Math.round((bikByEmp[empId] || 0) * 100) / 100;
      const esop   = Math.round((esopByEmp[empId] || 0) * 100) / 100;
      lines.push([nric, name, income, empCpf, erlCpf, aw, bik, esop].join('|'));
    }

    // PAY-007: auto-record / refresh a DRAFT IR8A IrasSubmission.
    const ir8aContent = lines.join('\n');
    fireAndForget(async () => {
      const { computeDeadline } = require('../engines/iras-submission.engine');
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(ir8aContent).digest('hex');
      const yearInt = parseInt(year, 10);
      const existing = await prisma.irasSubmission.findFirst({ where: { kind: 'IR8A', year: yearInt } });
      const deadline = computeDeadline('IR8A', { year: yearInt });
      const fileName = `IR8A-${year}.txt`;
      if (existing) {
        await prisma.irasSubmission.update({
          where: { id: existing.id },
          data:  { fileHash: hash, fileSize: Buffer.byteLength(ir8aContent), fileName, deadline },
        });
      } else {
        await prisma.irasSubmission.create({
          data: {
            id: uuidv4(), kind: 'IR8A', year: yearInt,
            fileName, fileHash: hash, fileSize: Buffer.byteLength(ir8aContent),
            deadline, createdBy: req.user?.sub || null,
          },
        });
      }
    });
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=IR8A-${year}.txt`);
    res.send(ir8aContent);
  } catch (err) { next(err); }
});

// ── GET /payroll/internal/daily-rate/:employeeId/:period ─────────────────────
// LEA-005: returns the employee's daily rate for the period, derived from the
// latest published payslip in that period (basicSalary ÷ working days for the
// period). Used by leave-service govt-claims/generate to seed the claim amount
// without requiring HR to enter the daily rate manually. Internal key auth.
router.get('/internal/daily-rate/:employeeId/:period', async (req, res, next) => {
  try {
    // Fail-closed: never accept a literal default for the internal service key —
    // a 'dev-internal-key' fallback in any environment is a full auth bypass.
    const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY;
    if (!INTERNAL_KEY) throw new Error('INTERNAL_SERVICE_KEY env var is required');
    const key = req.headers['x-internal-service-key'];
    if (!key || key !== INTERNAL_KEY) return res.status(403).json({ error: 'Forbidden' });
    const { employeeId, period } = req.params;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return res.status(400).json({ error: 'period must be YYYY-MM' });

    // Prefer the latest published payslip in the period; fall back to most
    // recent published payslip overall if none in this exact period.
    let payslip = await prisma.payslip.findFirst({
      where: { employeeId, period, isPublished: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!payslip) {
      payslip = await prisma.payslip.findFirst({
        where: { employeeId, isPublished: true },
        orderBy: { period: 'desc' },
      });
    }
    if (!payslip) return res.status(404).json({ error: 'No published payslip found for employee', dailyRate: 0 });

    // EA s.20 working-day convention — 22 working days/month is the SG standard
    // proxy. If the payslip already encodes a govt-paid daily rate (govtPaidAmount
    // ÷ govtPaidDays), prefer that — it's exactly what payroll computed.
    let dailyRate = 0;
    if (payslip.govtPaidDays && payslip.govtPaidAmountEnc) {
      const days   = Number(payslip.govtPaidDays) || 0;
      const amount = decSafe(payslip.govtPaidAmountEnc);
      if (days > 0 && amount > 0) dailyRate = round2(amount / days);
    }
    if (dailyRate === 0) {
      const basic = decSafe(payslip.basicSalaryEnc);
      if (basic > 0) dailyRate = round2(basic / 22);
    }
    return res.json({ employeeId, period: payslip.period, dailyRate, source: payslip.govtPaidDays ? 'govt_paid_rate' : 'basic_div_22' });
  } catch (err) { next(err); }
});

// ── GET /payroll/internal/ir21-ytd/:employeeId/:year ──────────────────────────
// Internal endpoint for offboarding-service to fetch YTD income data for IR21
// form auto-population. Authenticated by x-internal-service-key header only.
router.get('/internal/ir21-ytd/:employeeId/:year', async (req, res, next) => {
  try {
    // Fail-closed: never accept a literal default for the internal service key —
    // a 'dev-internal-key' fallback in any environment is a full auth bypass.
    const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY;
    if (!INTERNAL_KEY) throw new Error('INTERNAL_SERVICE_KEY env var is required');
    const key = req.headers['x-internal-service-key'];
    if (!key || key !== INTERNAL_KEY) return res.status(403).json({ error: 'Forbidden' });

    const { employeeId, year } = req.params;
    const yearInt = parseInt(year, 10);
    if (!employeeId || isNaN(yearInt)) return res.status(400).json({ error: 'Invalid employeeId or year' });

    // Latest finalised payslip for this employee in the year (max YTD)
    const payslips = await prisma.payslip.findMany({
      where: { employeeId, period: { startsWith: year }, isPublished: true },
      orderBy: { period: 'desc' },
    });
    const latestPs = payslips.reduce((best, ps) => {
      if (!best) return ps;
      return decSafe(ps.ytdGrossEnc) >= decSafe(best.ytdGrossEnc) ? ps : best;
    }, null);

    // AW items (bonus/AWS) for this employee in the year
    const awItems = await prisma.payrollLineItem.findMany({
      where: { employeeId, wageType: 'AW', isIrasTaxable: true, run: { period: { startsWith: year } } },
    });
    const awIncome = round2(awItems.reduce((s, i) => s + decSafe(i.amountEnc), 0));

    // BIK (Appendix 8A)
    const bikItems = await prisma.bikItem.findMany({ where: { employeeId, year: yearInt } });
    const benefitsInKind = round2(bikItems.reduce((s, i) => s + decSafe(i.annualValueEnc), 0));

    // ESOP (Appendix 8B)
    const yearStart = new Date(`${year}-01-01T00:00:00Z`);
    const yearEnd   = new Date(`${yearInt + 1}-01-01T00:00:00Z`);
    const exercises = await prisma.stockOptionExercise.findMany({
      where: { exerciseDate: { gte: yearStart, lt: yearEnd }, grant: { employeeId } },
      include: { grant: { select: { employeeId: true } } },
    });
    const stockOptionGain = round2(exercises.reduce((s, e) => s + decSafe(e.taxableGainEnc), 0));

    const employmentIncome  = latestPs ? round2(decSafe(latestPs.ytdGrossEnc)) : 0;
    const employeeCpf       = latestPs ? round2(decSafe(latestPs.ytdEmployeeCpfEnc)) : 0;
    const employerCpf       = latestPs ? round2(decSafe(latestPs.ytdEmployerCpfEnc)) : 0;
    const totalTaxableIncome = round2(employmentIncome + awIncome + benefitsInKind + stockOptionGain);

    res.json({
      employeeId, year,
      employmentIncome,
      awIncome,
      benefitsInKind,
      stockOptionGain,
      employeeCpf,
      employerCpf,
      totalTaxableIncome,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// ─── PAY-005: payslip publish notifications ─────────────────────────────────

async function sendPublishNotifications(run, authHeader) {
  const payslips = await prisma.payslip.findMany({ where: { runId: run.id, isPublished: true } });
  if (!payslips.length) return;
  const employeeIds = Array.from(new Set(payslips.map(p => p.employeeId)));
  let employeeMap = new Map();
  try {
    const r = await fetch(`${EMPLOYEE_SERVICE_URL}/employees/by-ids?ids=${employeeIds.join(',')}`, {
      headers: { Authorization: authHeader || '' },
    });
    if (r.ok) {
      const list = await r.json();
      for (const e of (Array.isArray(list) ? list : [])) employeeMap.set(e.id, e);
    }
  } catch (err) {
    console.error('[publish-notify] employee lookup failed:', err.message);
  }
  let notified = 0;
  for (const ps of payslips) {
    const emp = employeeMap.get(ps.employeeId);
    const channels = ['IN_APP'];
    const recipients = [];
    if (emp?.workEmail || emp?.personalEmail) { channels.push('EMAIL'); recipients.push(emp.workEmail || emp.personalEmail); }
    if (emp?.personalPhone) channels.push('MOBILE_PUSH');
    try {
      await fetch(`${NOTIFICATION_SERVICE_URL}/notifications/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authHeader || '' },
        body: JSON.stringify({
          type: 'PAYSLIP_PUBLISHED',
          employeeId: ps.employeeId,
          channels,
          recipients,
          data: {
            employeeName: emp?.fullName || ps.employeeId,
            period: ps.period,
            paymentDate: run.paymentDate ? new Date(run.paymentDate).toISOString().slice(0, 10) : null,
            payslipId: ps.id,
          },
        }),
      });
      await prisma.payslip.update({ where: { id: ps.id }, data: { notifiedAt: new Date() } });
      notified += 1;
    } catch (err) {
      console.error('[publish-notify] notification fan-out failed:', err.message);
    }
  }
  return { notified, total: payslips.length };
}

// POST /payroll/runs/:id/notify-published — manual re-fire (for HR if the
// initial fan-out failed or new employees were added post-publish).
router.post('/runs/:id/notify-published', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'FINALISED') return res.status(409).json({ error: 'Run must be FINALISED before notifications can be sent' });
    const result = await sendPublishNotifications(run, req.headers.authorization);
    res.json(result || { notified: 0, total: 0 });
  } catch (err) { next(err); }
});

// ─── PAY-005: SLA sweep ────────────────────────────────────────────────────

async function runPayslipSlaSweep({ now = new Date() } = {}) {
  // Only check runs whose paymentDate has been set and is within ±30 days,
  // or whose status is not yet FINALISED.
  const horizon = new Date(now); horizon.setUTCDate(horizon.getUTCDate() - 30);
  const runs = await prisma.payrollRun.findMany({
    where: { paymentDate: { not: null, gte: horizon } },
    include: { payslips: { select: { isPublished: true, publishedAt: true } } },
  });
  const byType = { UNPUBLISHED_PAST_PAYMENT: 0, LATE_PUBLICATION: 0, PAYMENT_DATE_APPROACHING: 0 };
  let created = 0, updated = 0, resolved = 0;
  for (const run of runs) {
    const alerts = classifyRunSla(run, run.payslips, { now });
    // Upsert active alerts
    for (const a of alerts) {
      const existing = await prisma.payslipSlaAlert.findUnique({
        where: { runId_type: { runId: run.id, type: a.type } },
      });
      const data = {
        runId: run.id, period: run.period, type: a.type,
        severity: a.severity, daysOverdue: a.daysOverdue,
        unpublishedCount: a.unpublishedCount, message: a.message,
        notifiedAt: new Date(), resolvedAt: null,
      };
      if (!existing) {
        await prisma.payslipSlaAlert.create({ data: { id: uuidv4(), ...data } });
        created += 1;
      } else {
        await prisma.payslipSlaAlert.update({ where: { id: existing.id }, data });
        updated += 1;
      }
      byType[a.type] = (byType[a.type] || 0) + 1;
    }
    // Resolve previously-fired alerts that no longer apply
    const stored = await prisma.payslipSlaAlert.findMany({ where: { runId: run.id, resolvedAt: null } });
    for (const s of stored) {
      if (isAlertResolved(s, alerts)) {
        await prisma.payslipSlaAlert.update({ where: { id: s.id }, data: { resolvedAt: new Date() } });
        resolved += 1;
      }
    }
  }
  return { scannedRuns: runs.length, created, updated, resolved, byType };
}

router.post('/payslips/sla/sweep', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const result = await runPayslipSlaSweep();
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/payslips/sla/alerts', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { type, severity, includeResolved } = req.query;
    const where = {};
    if (type)     where.type     = type;
    if (severity) where.severity = severity;
    if (includeResolved !== 'true') where.resolvedAt = null;
    const alerts = await prisma.payslipSlaAlert.findMany({ where, orderBy: [{ severity: 'desc' }, { notifiedAt: 'desc' }], take: 500 });
    const summary = alerts.reduce((acc, a) => {
      acc.byType[a.type]         = (acc.byType[a.type]         || 0) + 1;
      acc.bySeverity[a.severity] = (acc.bySeverity[a.severity] || 0) + 1;
      return acc;
    }, { byType: {}, bySeverity: {} });
    res.json({ total: alerts.length, summary, alerts });
  } catch (err) { next(err); }
});

// ─── PAY-005: 5-year payslip archive ────────────────────────────────────────

// GET /payroll/payslips/archive?employeeId=&fromYear=&toYear=&search=&page=&limit=
//
// Searchable index across the 5-year archive window (or less, depending on
// data retention). RBAC: admins see everyone; employees see only their own.
router.get('/payslips/archive', authenticate, async (req, res, next) => {
  try {
    const adminRoles = ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER'];
    const isAdmin = adminRoles.includes(String(req.user?.role || '').toUpperCase());
    let { employeeId, fromYear, toYear, search, page = 1, limit = 50 } = req.query;

    if (!isAdmin) {
      // Employees can only view their own archive
      employeeId = req.user.employeeId;
      if (!employeeId) return res.status(403).json({ error: 'Employee profile not linked to this account' });
    }

    const where = { isPublished: true };
    if (employeeId) where.employeeId = employeeId;

    const thisYear = new Date().getUTCFullYear();
    const archiveFloor = Math.max(thisYear - 4, 1970); // MOM EA s.96(4): keep payslips for ≥ 2 years; we extend to 5 (PRD)
    const fromY = Number(fromYear) || archiveFloor;
    const toY   = Number(toYear)   || thisYear;
    const periods = [];
    for (let y = fromY; y <= toY; y++) {
      for (let m = 1; m <= 12; m++) periods.push(`${y}-${String(m).padStart(2, '0')}`);
    }
    where.period = { in: periods };
    if (search) {
      // Search on period substring (lets users find by "2025-03" or "2025")
      where.period = { contains: String(search) };
    }
    const take = Math.min(Number(limit) || 50, 200);
    const skip = (Math.max(Number(page), 1) - 1) * take;
    const [rows, total] = await Promise.all([
      prisma.payslip.findMany({
        where, orderBy: [{ period: 'desc' }, { publishedAt: 'desc' }], skip, take,
        select: {
          id: true, runId: true, employeeId: true, period: true, publishedAt: true,
          notifiedAt: true, createdAt: true,
          netPayEnc: true, grossPayEnc: true, ytdGrossEnc: true,
          run: { select: { runType: true, paymentDate: true, finalisedAt: true } },
        },
      }),
      prisma.payslip.count({ where }),
    ]);
    res.json({
      window: { fromYear: fromY, toYear: toY, retentionYears: 5 },
      total, page: Number(page), pageSize: take, pages: Math.ceil(total / take),
      payslips: rows.map(r => ({
        id: r.id, runId: r.runId, employeeId: r.employeeId, period: r.period,
        publishedAt: r.publishedAt, notifiedAt: r.notifiedAt, createdAt: r.createdAt,
        netPay:    decSafe(r.netPayEnc),
        grossPay:  decSafe(r.grossPayEnc),
        ytdGross:  decSafe(r.ytdGrossEnc),
        runType:    r.run?.runType,
        paymentDate: r.run?.paymentDate,
        finalisedAt: r.run?.finalisedAt,
      })),
    });
  } catch (err) { next(err); }
});

// ─── GET /payroll/audit-logs ─ Payroll audit trail ──────────────────────────
router.get('/audit-logs', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, action, entityId, runId } = req.query;
    const pageNum  = Math.max(1, Number(page));
    const limitNum = Math.min(200, Math.max(1, Number(limit)));
    const where = {};
    if (action)            where.action   = { contains: action, mode: 'insensitive' };
    if (entityId || runId) where.entityId = entityId || runId;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total, page: pageNum, pages: Math.ceil(total / limitNum) });
  } catch (err) { next(err); }
});

// ─── PAY-004: DRC headcount status ───────────────────────────────────────────

const { groupBySector, computeDrcStatus } = require('../engines/drc.engine');
const INTERNAL_KEY = process.env.INTERNAL_SERVICE_KEY || '';

// GET /payroll/drc-status — compute current FW/local headcount vs DRC ceilings
router.get('/drc-status', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    // Fetch all active employees with pass type + citizenship + sector
    let employees = [];
    try {
      const axios = require('axios');
      const { data } = await axios.get(
        `${EMPLOYEE_SERVICE_URL}/employees?limit=2000&isActive=true`,
        { headers: { 'x-internal-service-key': INTERNAL_KEY }, timeout: 10000 }
      );
      employees = data.employees || (Array.isArray(data) ? data : []);
    } catch (fetchErr) {
      return res.status(503).json({ error: 'Unable to reach employee-service', detail: fetchErr.message });
    }

    const quotas = await prisma.drcQuota.findMany({ where: { isActive: true } });
    const sectorGroups = groupBySector(employees);
    const results = computeDrcStatus(sectorGroups, quotas);

    const summary = {
      total: results.length,
      exceeded: results.filter(r => r.status === 'EXCEEDED').length,
      warning:  results.filter(r => r.status === 'WARNING').length,
      ok:       results.filter(r => r.status === 'OK').length,
      usingDefaults: quotas.length === 0,
    };

    res.json({ summary, results, asOf: new Date().toISOString() });
  } catch (err) { next(err); }
});

module.exports = router;
// Exported for direct unit testing — see __tests__/giro-company-name.unit.test.js
module.exports.resolveGiroCompanyName = resolveGiroCompanyName;
module.exports.runPayslipSlaSweep = runPayslipSlaSweep;
module.exports.sendPublishNotifications = sendPublishNotifications;
