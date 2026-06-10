'use strict';

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { encrypt, decrypt } = require('/app/shared/crypto');
const {
  buildClaimRecord,
  groupLeavesByEmployeeAndType,
  isValidTransition,
  round2,
} = require('../engines/govt-leave-claims.engine');

const router = express.Router();
const prisma = require('../utils/prisma');

const LEAVE_SERVICE_URL = process.env.LEAVE_SERVICE_URL || 'http://leave-service:4004';

// ─── POST /payroll/govt-leave-claims/generate ─────────────────────────────────
// Generates (or refreshes) claim records for a payroll period.
// Calls the leave service for approved govt-paid leave applications, then
// upserts one GovtLeaveClaimPayroll row per employee × leave-type combination.
// Query params:
//   period            YYYY-MM  (required)
//   nsAllowancePerDay number   (optional, default 0)
//   employerCpfRate   number   (optional, e.g. 0.17 — used only for CPF tracking)
router.post('/govt-leave-claims/generate',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const { period, nsAllowancePerDay, employerCpfRate } = req.query;
      if (!period || !/^\d{4}-\d{2}$/.test(period)) {
        return res.status(400).json({ error: 'period query param required (YYYY-MM)' });
      }

      const nsAllowance  = parseFloat(nsAllowancePerDay) || 0;
      const cpfRate      = parseFloat(employerCpfRate)   || 0;

      // 1. Fetch approved govt-paid leaves for the period from leave service.
      const [y, m]       = period.split('-').map(Number);
      const periodStart  = new Date(y, m - 1, 1).toISOString();
      const periodEnd    = new Date(y, m, 0, 23, 59, 59).toISOString();

      const leaveUrl = `${LEAVE_SERVICE_URL}/leave/applications?status=APPROVED&periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}&limit=2000`;
      const leaveRes = await fetch(leaveUrl, {
        headers: { Authorization: req.headers.authorization || '' },
      });
      if (!leaveRes.ok) {
        return res.status(502).json({ error: 'Failed to fetch leave data', details: `Leave service returned ${leaveRes.status}` });
      }
      const leaveData    = await leaveRes.json();
      const applications = leaveData.applications || [];

      // Filter to govt-paid types only (leave service should already flag isGovtPaid).
      const govtApps = applications.filter(a => a.leaveType?.isGovtPaid);
      if (!govtApps.length) {
        return res.json({ period, generated: 0, claims: [], message: 'No govt-paid leave found for this period' });
      }

      // 2. Fetch published payslips for the period to derive per-employee daily rates.
      const payslips = await prisma.payslip.findMany({
        where: { period, isPublished: true, govtPaidDays: { gt: 0 } },
        select: { employeeId: true, govtPaidDays: true, govtPaidAmountEnc: true },
      });

      // Build employeeId → dailyRate lookup.
      // dailyRate = govtPaidAmount / govtPaidDays (exact inverse of compute).
      const dailyRateByEmp = {};
      for (const ps of payslips) {
        if (!ps.govtPaidDays || !ps.govtPaidAmountEnc) continue;
        const total = parseFloat(decrypt(ps.govtPaidAmountEnc)) || 0;
        dailyRateByEmp[ps.employeeId] = total > 0 ? round2(total / ps.govtPaidDays) : 0;
      }

      // 3. Group leave applications by employeeId + leaveTypeCode.
      const groups = groupLeavesByEmployeeAndType(govtApps);

      // 4. Upsert one claim per employee × leave-type.
      const upserted = [];
      const skipped  = [];

      for (const [empId, byType] of Object.entries(groups)) {
        const dailyRate = dailyRateByEmp[empId];
        if (dailyRate == null || dailyRate === 0) {
          skipped.push({ employeeId: empId, reason: 'no published payslip with govtPaidDays for this period' });
          continue;
        }

        for (const [code, { days, name }] of Object.entries(byType)) {
          const claim = buildClaimRecord({
            employeeId:       empId,
            period,
            leaveTypeCode:    code,
            leaveTypeName:    name,
            leaveDays:        days,
            dailyRate,
            nsAllowancePerDay: nsAllowance,
            employerCpfRate:  cpfRate,
          });

          const row = await prisma.govtLeaveClaimPayroll.upsert({
            where: { employeeId_period_leaveTypeCode: { employeeId: empId, period, leaveTypeCode: code } },
            create: {
              id:                  uuidv4(),
              employeeId:          claim.employeeId,
              period:              claim.period,
              leaveTypeCode:       claim.leaveTypeCode,
              leaveTypeName:       claim.leaveTypeName,
              leaveDays:           claim.leaveDays,
              dailyRateEnc:        encrypt(String(claim.dailyRate)),
              claimableAmountEnc:  encrypt(String(claim.claimableAmount)),
              cpfOnGovtPaidEnc:    claim.cpfOnGovtPaid != null ? encrypt(String(claim.cpfOnGovtPaid)) : null,
              nsMakeupAmountEnc:   claim.nsMakeupAmount != null ? encrypt(String(claim.nsMakeupAmount)) : null,
              nsAllowancePerDay:   claim.nsAllowancePerDay,
              status:              'PENDING',
            },
            update: {
              leaveTypeName:       claim.leaveTypeName,
              leaveDays:           claim.leaveDays,
              dailyRateEnc:        encrypt(String(claim.dailyRate)),
              claimableAmountEnc:  encrypt(String(claim.claimableAmount)),
              cpfOnGovtPaidEnc:    claim.cpfOnGovtPaid != null ? encrypt(String(claim.cpfOnGovtPaid)) : null,
              nsMakeupAmountEnc:   claim.nsMakeupAmount != null ? encrypt(String(claim.nsMakeupAmount)) : null,
              nsAllowancePerDay:   claim.nsAllowancePerDay,
            },
          });
          upserted.push(decClaim(row));
        }
      }

      res.status(201).json({
        period,
        generated: upserted.length,
        skipped:   skipped.length,
        skippedDetails: skipped,
        claims:    upserted,
      });
    } catch (err) { next(err); }
  }
);

// ─── GET /payroll/govt-leave-claims ──────────────────────────────────────────
// List claims with optional filters: period, status, leaveTypeCode, employeeId.
router.get('/govt-leave-claims',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const { period, status, leaveTypeCode, employeeId, page = '1', limit = '50' } = req.query;

      const where = {};
      if (period)        where.period        = period;
      if (status)        where.status        = status;
      if (leaveTypeCode) where.leaveTypeCode = leaveTypeCode;
      if (employeeId)    where.employeeId    = employeeId;

      const take = Math.min(parseInt(limit, 10) || 50, 200);
      const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

      const [claims, total] = await Promise.all([
        prisma.govtLeaveClaimPayroll.findMany({ where, orderBy: [{ period: 'desc' }, { leaveTypeCode: 'asc' }], take, skip }),
        prisma.govtLeaveClaimPayroll.count({ where }),
      ]);

      res.json({ claims: claims.map(decClaim), total, page: parseInt(page, 10) || 1, limit: take });
    } catch (err) { next(err); }
  }
);

// ─── GET /payroll/govt-leave-claims/summary ───────────────────────────────────
// Aggregate totals by leave type and status for a period.
router.get('/govt-leave-claims/summary',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const { period } = req.query;
      if (!period) return res.status(400).json({ error: 'period query param required (YYYY-MM)' });

      const claims = await prisma.govtLeaveClaimPayroll.findMany({ where: { period } });

      const byType   = {};
      const byStatus = { PENDING: 0, SUBMITTED: 0, REIMBURSED: 0, REJECTED: 0 };
      let totalClaimable    = 0;
      let totalReimbursed   = 0;
      let totalNsMakeup     = 0;

      for (const c of claims) {
        const claimable   = safeDecrypt(c.claimableAmountEnc);
        const reimbursed  = c.reimbursedAmountEnc ? safeDecrypt(c.reimbursedAmountEnc) : 0;
        const nsMakeup    = c.nsMakeupAmountEnc   ? safeDecrypt(c.nsMakeupAmountEnc)   : 0;

        totalClaimable  += claimable;
        totalReimbursed += reimbursed;
        totalNsMakeup   += nsMakeup;
        byStatus[c.status] = (byStatus[c.status] || 0) + 1;

        if (!byType[c.leaveTypeCode]) {
          byType[c.leaveTypeCode] = { leaveTypeName: c.leaveTypeName, count: 0, totalDays: 0, totalClaimable: 0, totalReimbursed: 0 };
        }
        byType[c.leaveTypeCode].count++;
        byType[c.leaveTypeCode].totalDays       += c.leaveDays;
        byType[c.leaveTypeCode].totalClaimable  += claimable;
        byType[c.leaveTypeCode].totalReimbursed += reimbursed;
      }

      // Round all totals
      for (const t of Object.values(byType)) {
        t.totalDays       = round2(t.totalDays);
        t.totalClaimable  = round2(t.totalClaimable);
        t.totalReimbursed = round2(t.totalReimbursed);
      }

      res.json({
        period,
        totalClaims:    claims.length,
        totalClaimable: round2(totalClaimable),
        totalReimbursed: round2(totalReimbursed),
        totalNsMakeup:  round2(totalNsMakeup),
        byStatus,
        byType,
      });
    } catch (err) { next(err); }
  }
);

// ─── GET /payroll/govt-leave-claims/:id ──────────────────────────────────────
router.get('/govt-leave-claims/:id',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const claim = await prisma.govtLeaveClaimPayroll.findUnique({ where: { id: req.params.id } });
      if (!claim) return res.status(404).json({ error: 'Claim not found' });
      res.json(decClaim(claim));
    } catch (err) { next(err); }
  }
);

// ─── PUT /payroll/govt-leave-claims/:id ──────────────────────────────────────
// Allowed updates: status transition, submissionRef, reimbursedAmount, notes.
router.put('/govt-leave-claims/:id',
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER),
  async (req, res, next) => {
    try {
      const existing = await prisma.govtLeaveClaimPayroll.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Claim not found' });

      const { status, submissionRef, reimbursedAmount, notes } = req.body;
      const updates = {};

      if (status && status !== existing.status) {
        if (!isValidTransition(existing.status, status)) {
          return res.status(409).json({
            error: `Cannot transition from ${existing.status} to ${status}`,
            allowedTransitions: { PENDING: ['SUBMITTED', 'REJECTED'], SUBMITTED: ['REIMBURSED', 'REJECTED'] }[existing.status] || [],
          });
        }
        updates.status = status;
        if (status === 'SUBMITTED') updates.submittedAt = new Date();
        if (status === 'REIMBURSED') {
          updates.reimbursedAt = new Date();
          if (reimbursedAmount != null) {
            updates.reimbursedAmountEnc = encrypt(String(parseFloat(reimbursedAmount) || 0));
          }
        }
      }

      if (submissionRef  != null) updates.submissionRef  = submissionRef;
      if (notes          != null) updates.notes          = notes;
      if (reimbursedAmount != null && !updates.reimbursedAmountEnc) {
        updates.reimbursedAmountEnc = encrypt(String(parseFloat(reimbursedAmount) || 0));
      }

      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const updated = await prisma.govtLeaveClaimPayroll.update({ where: { id: req.params.id }, data: updates });
      res.json(decClaim(updated));
    } catch (err) { next(err); }
  }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeDecrypt(enc) {
  try { return parseFloat(decrypt(enc)) || 0; } catch { return 0; }
}

function decClaim(c) {
  return {
    id:               c.id,
    employeeId:       c.employeeId,
    period:           c.period,
    leaveTypeCode:    c.leaveTypeCode,
    leaveTypeName:    c.leaveTypeName,
    leaveDays:        c.leaveDays,
    dailyRate:        safeDecrypt(c.dailyRateEnc),
    claimableAmount:  safeDecrypt(c.claimableAmountEnc),
    cpfOnGovtPaid:    c.cpfOnGovtPaidEnc   ? safeDecrypt(c.cpfOnGovtPaidEnc)   : null,
    nsMakeupAmount:   c.nsMakeupAmountEnc   ? safeDecrypt(c.nsMakeupAmountEnc)   : null,
    nsAllowancePerDay: c.nsAllowancePerDay  ?? null,
    status:           c.status,
    submissionRef:    c.submissionRef       ?? null,
    submittedAt:      c.submittedAt         ?? null,
    reimbursedAmount: c.reimbursedAmountEnc ? safeDecrypt(c.reimbursedAmountEnc) : null,
    reimbursedAt:     c.reimbursedAt        ?? null,
    notes:            c.notes              ?? null,
    createdAt:        c.createdAt,
    updatedAt:        c.updatedAt,
  };
}

module.exports = router;
