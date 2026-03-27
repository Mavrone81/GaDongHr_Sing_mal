'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('../../../../shared/auth-middleware');
const { encrypt, decrypt, encryptNumber, decryptNumber } = require('../../../../shared/crypto');
const { computeCpf, computeSdl, computeNetPay } = require('../engines/cpf.engine');

const prisma = new PrismaClient();

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
    const { period, runType = 'MONTHLY', employeeGroup } = req.body;
    if (!period) return res.status(400).json({ error: 'Period is required (YYYY-MM)' });

    const existing = await prisma.payrollRun.findFirst({ where: { period, runType, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } } });
    if (existing) return res.status(409).json({ error: `A payroll run for ${period} is already in progress (${existing.status})` });

    const run = await prisma.payrollRun.create({
      data: { id: uuidv4(), period, runType: runType.toUpperCase(), status: 'DRAFT', initiatedBy: req.user.sub, employeeGroup },
    });
    res.status(201).json(run);
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

// ─── POST /payroll/runs/:id/compute ─ Compute CPF for all employees ──────────
router.post('/runs/:id/compute', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (!['DRAFT'].includes(run.status)) return res.status(400).json({ error: 'Can only compute a DRAFT run' });

    // lineItems should have been added before calling compute
    const { lineItems, employees } = req.body; // array of { employeeId, ow, aw, ...deductions }
    if (!lineItems || !employees) return res.status(400).json({ error: 'lineItems and employees are required' });

    // Get CPF rates and SDL config
    const cpfRates = await prisma.cpfRate.findMany({ where: { isActive: true } });
    const sdlConfig = await prisma.sdlConfig.findFirst({ where: { isActive: true } });

    let totalGross = 0, totalNet = 0, totalEmployee = 0, totalEmployer = 0, totalSdl = 0;
    const payslips = [];

    for (const emp of employees) {
      const rate = findCpfRate(cpfRates, emp.citizenStatus, emp.age);
      const cpf = computeCpf({ ow: emp.ow, aw: emp.aw || 0, ytdOw: emp.ytdOw || 0, ytdAw: emp.ytdAw || 0, citizenStatus: emp.citizenStatus, age: emp.age, rates: rate });
      const sdl = computeSdl(emp.grossPay || emp.ow, sdlConfig);
      const net = computeNetPay({ grossPay: emp.grossPay || emp.ow + (emp.aw || 0), employeeCpf: cpf.totalEmployee, nplDeduction: emp.nplDeduction || 0, reimbursements: emp.reimbursements || 0 });

      totalGross += (emp.grossPay || emp.ow + (emp.aw || 0));
      totalNet += net;
      totalEmployee += cpf.totalEmployee;
      totalEmployer += cpf.totalEmployer;
      totalSdl += sdl;

      payslips.push({
        id: uuidv4(), runId: run.id, employeeId: emp.employeeId, period: run.period,
        basicSalaryEnc: encrypt(String(emp.ow)),
        grossPayEnc: encrypt(String(emp.grossPay || emp.ow)),
        netPayEnc: encrypt(String(net)),
        employeeCpfEnc: encrypt(String(cpf.totalEmployee)),
        employerCpfEnc: encrypt(String(cpf.totalEmployer)),
        sdlAmountEnc: encrypt(String(sdl)),
        ytdGrossEnc: encrypt(String((emp.ytdGross || 0) + (emp.grossPay || emp.ow))),
        ytdEmployeeCpfEnc: encrypt(String((emp.ytdEmployeeCpf || 0) + cpf.totalEmployee)),
        ytdEmployerCpfEnc: encrypt(String((emp.ytdEmployerCpf || 0) + cpf.totalEmployer)),
      });
    }

    // Bulk upsert payslips
    await prisma.payslip.createMany({ data: payslips, skipDuplicates: true });

    // Update run totals
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'PENDING_APPROVAL',
        totalGross: encrypt(String(totalGross)),
        totalNet: encrypt(String(totalNet)),
        totalCpf: encrypt(String(totalEmployee)),
        totalEmployerCpf: encrypt(String(totalEmployer)),
        totalSdl: String(totalSdl),
      },
    });
    res.json({ message: 'Payroll computed. Status: PENDING_APPROVAL', total: { gross: totalGross, net: totalNet, employeeCpf: totalEmployee, employerCpf: totalEmployer, sdl: totalSdl } });
  } catch (err) { next(err); }
});

// ─── POST /payroll/runs/:id/approve ─ Checker approval ──────────────────────
router.post('/runs/:id/approve', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'PENDING_APPROVAL') return res.status(400).json({ error: 'Run is not pending approval' });
    // Maker-checker: approver MUST be different from initiator
    if (run.initiatedBy === req.user.sub) return res.status(403).json({ error: 'Maker cannot approve their own payroll run (maker-checker policy)' });

    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: 'APPROVED', approvedBy: req.user.sub, approvedAt: new Date() },
    });
    res.json({ message: 'Payroll approved', run: updated });
  } catch (err) { next(err); }
});

// ─── POST /payroll/runs/:id/finalise ─ Lock and generate outputs ─────────────
router.post('/runs/:id/finalise', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'APPROVED') return res.status(400).json({ error: 'Run must be APPROVED before finalising' });

    await prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'FINALISED', finalisedAt: new Date() } });
    // Publish payslips
    await prisma.payslip.updateMany({ where: { runId: run.id }, data: { isPublished: true } });

    res.json({ message: 'Payroll finalised. Payslips published.' });
  } catch (err) { next(err); }
});

// ─── GET /payroll/payslips/:employeeId/:period ─ Download payslip PDF ────────
router.get('/payslips/:employeeId/:period', authenticate, async (req, res, next) => {
  try {
    const { employeeId, period } = req.params;
    // RBAC: employee can only view own payslip
    if (req.user.role === 'employee' && req.user.employeeId !== employeeId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const payslip = await prisma.payslip.findFirst({ where: { employeeId, period, isPublished: true } });
    if (!payslip) return res.status(404).json({ error: 'Payslip not found' });

    const data = {
      employeeId,
      period,
      basicSalary: decrypt(payslip.basicSalaryEnc),
      grossPay: decrypt(payslip.grossPayEnc),
      netPay: decrypt(payslip.netPayEnc),
      employeeCpf: decrypt(payslip.employeeCpfEnc),
      employerCpf: decrypt(payslip.employerCpfEnc),
      sdl: payslip.sdlAmountEnc ? decrypt(payslip.sdlAmountEnc) : 0,
      ytdGross: payslip.ytdGrossEnc ? decrypt(payslip.ytdGrossEnc) : null,
      ytdEmployeeCpf: payslip.ytdEmployeeCpfEnc ? decrypt(payslip.ytdEmployeeCpfEnc) : null,
    };

    // Generate PDF with PDFKit
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=payslip-${employeeId}-${period}.pdf`);
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('PAYSLIP', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(`${process.env.COMPANY_NAME || 'EzyHRM Pte Ltd'}`, { align: 'center' });
    doc.text(`UEN: ${process.env.COMPANY_UEN || '202512345A'}`, { align: 'center' });
    doc.moveDown();
    doc.text(`Pay Period: ${period}`);
    doc.text(`Employee ID: ${employeeId}`);
    doc.moveDown();

    // Pay table
    drawLine(doc);
    doc.font('Helvetica-Bold').text('EARNINGS', 50, doc.y);
    doc.font('Helvetica');
    doc.text(`Basic Salary`, 50, doc.y + 5); doc.text(`SGD ${parseFloat(data.basicSalary).toFixed(2)}`, 400, doc.y - 12, { align: 'right' });
    doc.moveDown(0.5);
    drawLine(doc);
    doc.font('Helvetica-Bold').text(`GROSS PAY: SGD ${parseFloat(data.grossPay).toFixed(2)}`, { align: 'right' });
    doc.moveDown();
    doc.font('Helvetica').text(`DEDUCTIONS`);
    doc.text(`Employee CPF`, 50, doc.y + 5); doc.text(`SGD ${parseFloat(data.employeeCpf).toFixed(2)}`, 400, doc.y - 12, { align: 'right' });
    doc.moveDown(0.5);
    drawLine(doc);
    doc.font('Helvetica-Bold').text(`NET PAY: SGD ${parseFloat(data.netPay).toFixed(2)}`, { align: 'right' });
    doc.moveDown();
    doc.font('Helvetica').text(`Employer CPF Contribution: SGD ${parseFloat(data.employerCpf).toFixed(2)}`);
    doc.text(`SDL: SGD ${parseFloat(data.sdl).toFixed(2)}`);
    if (data.ytdGross) { doc.moveDown(); doc.text(`YTD Gross: SGD ${parseFloat(data.ytdGross).toFixed(2)}`); doc.text(`YTD Employee CPF: SGD ${parseFloat(data.ytdEmployeeCpf).toFixed(2)}`); }

    doc.end();
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
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=cpf-esubmit-${run.period}.txt`);
    res.send(content);
  } catch (err) { next(err); }
});

// ─── GET /payroll/bank-giro/:runId ─ Bank GIRO file ─────────────────────────
router.get('/bank-giro/:runId', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.runId }, include: { payslips: true } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.status !== 'FINALISED') return res.status(400).json({ error: 'Run must be FINALISED' });

    const lines = [`BANK_GIRO|${process.env.COMPANY_UEN}|${run.period}`];
    for (const ps of run.payslips) {
      const net = decrypt(ps.netPayEnc);
      lines.push(`${ps.employeeId}|${net}|Salary ${run.period}`);
    }
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=giro-${run.period}.txt`);
    res.send(lines.join('\n'));
  } catch (err) { next(err); }
});

// ─── Helper functions ────────────────────────────────────────────────────────
function findCpfRate(rates, citizenStatus, age) {
  const statusMap = { SC: 'SC_PR', PR_YR3_PLUS: 'SC_PR', PR_YEAR1: 'PR_YEAR1', PR_YEAR2: 'PR_YEAR2', FOREIGNER: 'FOREIGNER' };
  const mappedStatus = statusMap[citizenStatus] || 'SC_PR';
  return rates.find(r => r.citizenStatus === mappedStatus && r.ageMin <= age && (r.ageMax === null || r.ageMax >= age)) || null;
}

function drawLine(doc) {
  doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.5);
}

module.exports = router;
