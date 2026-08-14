'use strict';
/**
 * Cost-centre & payroll journal routes (PAY-012).
 *
 * Cost centres:
 *   POST   /cost-centres                          create
 *   GET    /cost-centres?active=true              list
 *   GET    /cost-centres/:id                      detail
 *   PUT    /cost-centres/:id                      update
 *   DELETE /cost-centres/:id                      delete (only if no allocations)
 *
 * Employee allocations (split by %):
 *   POST   /employees/:employeeId/cost-centres    bulk replace allocations
 *   GET    /employees/:employeeId/cost-centres    current allocations
 *
 * Journal:
 *   POST   /payroll/runs/:id/journal              (re)generate (idempotent)
 *   GET    /payroll/runs/:id/journal              fetch
 *   GET    /payroll/runs/:id/journal/export?format=csv|xero|quickbooks|sap
 */
const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { encrypt, decrypt } = require('/app/shared/crypto');
const {
  buildEntriesForEmployee, summariseEntries, toCsv, toXero, toQuickBooks, toSap,
} = require('../engines/journal.engine');

const prisma = require('../utils/prisma');

const decSafe = (enc) => { try { return enc ? parseFloat(decrypt(enc)) || 0 : 0; } catch { return 0; } };
const WRITE_ROLES = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER];
const READ_ROLES  = [ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER];

// ─── Cost-centre CRUD ────────────────────────────────────────────────────────

router.post('/cost-centres', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    const { code, name, description } = req.body || {};
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
    const cc = await prisma.costCentre.create({
      data: {
        code: String(code).toUpperCase(),
        name,
        description: description || null,
        glSalaryAccount:    req.body.glSalaryAccount || null,
        glCpfAccount:       req.body.glCpfAccount || null,
        glSdlAccount:       req.body.glSdlAccount || null,
        glFwlAccount:       req.body.glFwlAccount || null,
        glBankAccount:      req.body.glBankAccount || null,
        isActive: req.body.isActive !== undefined ? !!req.body.isActive : true,
      },
    });
    res.status(201).json(cc);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Cost-centre code already exists' });
    next(err);
  }
});

router.get('/cost-centres', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const where = {};
    if (req.query.active === 'true')  where.isActive = true;
    if (req.query.active === 'false') where.isActive = false;
    const ccs = await prisma.costCentre.findMany({ where, orderBy: { code: 'asc' } });
    res.json({ count: ccs.length, costCentres: ccs });
  } catch (err) { next(err); }
});

router.get('/cost-centres/:id', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const cc = await prisma.costCentre.findUnique({ where: { id: req.params.id } });
    if (!cc) return res.status(404).json({ error: 'Not found' });
    res.json(cc);
  } catch (err) { next(err); }
});

router.put('/cost-centres/:id', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    const data = {};
    if (req.body.code !== undefined) data.code = String(req.body.code).toUpperCase();
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.description !== undefined) data.description = req.body.description;
    if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;
    for (const k of ['glSalaryAccount', 'glCpfAccount', 'glSdlAccount', 'glFwlAccount', 'glBankAccount']) {
      if (req.body[k] !== undefined) data[k] = req.body[k];
    }
    const cc = await prisma.costCentre.update({ where: { id: req.params.id }, data });
    res.json(cc);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    if (err.code === 'P2002') return res.status(409).json({ error: 'Cost-centre code already exists' });
    next(err);
  }
});

router.delete('/cost-centres/:id', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    const inUse = await prisma.employeeCostCentre.findFirst({ where: { costCentreId: req.params.id } });
    if (inUse) return res.status(409).json({ error: 'Cost centre is currently allocated to one or more employees' });
    await prisma.costCentre.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    next(err);
  }
});

// ─── Employee allocations (bulk replace) ─────────────────────────────────────

router.post('/employees/:employeeId/cost-centres', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { allocations } = req.body || {};
    if (!Array.isArray(allocations) || allocations.length === 0) {
      return res.status(400).json({ error: 'allocations[] is required and must be non-empty' });
    }

    // Validate percentages sum to ~100
    const total = allocations.reduce((s, a) => s + (Number(a.percentage) || 0), 0);
    if (Math.abs(total - 100) > 0.01) {
      return res.status(400).json({ error: `Allocation percentages must sum to 100 (got ${total})` });
    }

    // Validate all cost-centre IDs exist + active
    const ccIds = allocations.map(a => a.costCentreId);
    const found = await prisma.costCentre.findMany({ where: { id: { in: ccIds } } });
    if (found.length !== new Set(ccIds).size) {
      return res.status(400).json({ error: 'One or more cost-centre IDs not found' });
    }

    // Replace allocations atomically
    await prisma.$transaction([
      prisma.employeeCostCentre.deleteMany({ where: { employeeId } }),
      prisma.employeeCostCentre.createMany({
        data: allocations.map(a => ({
          employeeId,
          costCentreId: a.costCentreId,
          percentage: Number(a.percentage),
        })),
      }),
    ]);
    const created = await prisma.employeeCostCentre.findMany({
      where: { employeeId }, include: { costCentre: true },
    });
    res.json({ employeeId, count: created.length, allocations: created });
  } catch (err) { next(err); }
});

router.get('/employees/:employeeId/cost-centres', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const allocs = await prisma.employeeCostCentre.findMany({
      where: { employeeId: req.params.employeeId, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] },
      include: { costCentre: true },
    });
    res.json({ employeeId: req.params.employeeId, count: allocs.length, allocations: allocs });
  } catch (err) { next(err); }
});

// ─── Journal generation ─────────────────────────────────────────────────────

async function loadAllocationsByEmployee(employeeIds) {
  const allocs = await prisma.employeeCostCentre.findMany({
    where: {
      employeeId: { in: employeeIds },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
    },
    include: { costCentre: true },
  });
  const byEmp = {};
  for (const a of allocs) {
    (byEmp[a.employeeId] ||= []).push({
      costCentreId: a.costCentreId,
      percentage: a.percentage,
      costCentre: a.costCentre,
    });
  }
  return byEmp;
}

router.post('/payroll/runs/:id/journal', authenticate, authorize(...WRITE_ROLES), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'FINALISED') {
      return res.status(400).json({ error: 'Run must be FINALISED to generate journal' });
    }

    const payslips = await prisma.payslip.findMany({ where: { runId: run.id } });
    const allocByEmp = await loadAllocationsByEmployee(payslips.map(p => p.employeeId));

    // Build all entries
    const allEntries = [];
    for (const ps of payslips) {
      const decoded = {
        employeeId: ps.employeeId,
        period: ps.period,
        grossPay: decSafe(ps.grossPayEnc),
        netPay: decSafe(ps.netPayEnc),
        employeeCpf: decSafe(ps.employeeCpfEnc),
        employerCpf: decSafe(ps.employerCpfEnc),
        sdl: decSafe(ps.sdlAmountEnc),
        fwl: decSafe(ps.fwlAmountEnc),
      };
      const entries = buildEntriesForEmployee(decoded, allocByEmp[ps.employeeId] || []);
      allEntries.push(...entries);
    }

    const totals = summariseEntries(allEntries);

    // Idempotent upsert: remove any prior journal for this run, then re-create
    await prisma.$transaction(async (tx) => {
      const existing = await tx.payrollJournal.findUnique({ where: { runId: run.id } });
      if (existing) await tx.payrollJournal.delete({ where: { id: existing.id } });
      const journal = await tx.payrollJournal.create({
        data: {
          runId: run.id,
          period: run.period,
          totalDebit: totals.debit,
          totalCredit: totals.credit,
          status: 'DRAFT',
        },
      });
      await tx.payrollJournalEntry.createMany({
        data: allEntries.map(e => ({
          journalId: journal.id,
          account: e.account,
          accountName: e.accountName,
          side: e.side,
          description: e.description,
          amountEnc: encrypt(String(e.amount)),
          costCentreId: e.costCentreId || null,
          employeeId: e.employeeId || null,
        })),
      });
    });

    res.json({
      message: totals.balanced ? 'Journal generated and balanced' : 'Journal generated but UNBALANCED',
      balanced: totals.balanced, totalDebit: totals.debit, totalCredit: totals.credit,
      entryCount: allEntries.length,
    });
  } catch (err) { next(err); }
});

router.get('/payroll/runs/:id/journal', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const journal = await prisma.payrollJournal.findFirst({
      where: { runId: req.params.id },
      include: { entries: { include: { costCentre: true } } },
    });
    if (!journal) return res.status(404).json({ error: 'No journal generated yet for this run' });
    const out = {
      ...journal,
      entries: journal.entries.map(e => ({
        ...e,
        amount: decSafe(e.amountEnc),
        costCentreCode: e.costCentre?.code || null,
      })),
    };
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/payroll/runs/:id/journal/export', authenticate, authorize(...READ_ROLES), async (req, res, next) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const supported = ['csv', 'xero', 'quickbooks', 'sap'];
    if (!supported.includes(format)) {
      return res.status(400).json({ error: `format must be one of: ${supported.join(', ')}` });
    }

    const journal = await prisma.payrollJournal.findFirst({
      where: { runId: req.params.id },
      include: { entries: { include: { costCentre: true } } },
    });
    if (!journal) return res.status(404).json({ error: 'No journal generated yet for this run' });

    const entries = journal.entries.map(e => ({
      account: e.account, accountName: e.accountName, side: e.side, description: e.description,
      amount: decSafe(e.amountEnc), costCentreCode: e.costCentre?.code || null,
      employeeId: e.employeeId || null, date: `${journal.period}-01`,
    }));

    let body;
    let filename = `journal-${journal.period}-${format}`;
    if      (format === 'csv')        { body = toCsv(entries);            filename += '.csv'; }
    else if (format === 'xero')       { body = toXero(entries, journal.period);       filename += '.csv'; }
    else if (format === 'quickbooks') { body = toQuickBooks(entries, journal.period); filename += '.iif'; }
    else if (format === 'sap')        { body = toSap(entries, journal.period);        filename += '.csv'; }

    // Mark exported
    await prisma.payrollJournal.update({
      where: { id: journal.id },
      data: { status: 'EXPORTED', exportFormat: format.toUpperCase(), exportedAt: new Date() },
    });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(body);
  } catch (err) { next(err); }
});

module.exports = router;
