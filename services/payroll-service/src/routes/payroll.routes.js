'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const { encrypt, decrypt, encryptNumber, decryptNumber } = require('/app/shared/crypto');
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

    let { lineItems = [], employees } = req.body;

    // Auto-fetch employee payroll data if not provided
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
    // Maker-checker: skip if DISABLE_MAKER_CHECKER is set (single-admin environments)
    const makerCheckerEnabled = process.env.DISABLE_MAKER_CHECKER !== 'true';
    if (makerCheckerEnabled && run.initiatedBy === req.user.sub) {
      return res.status(403).json({ error: 'Maker-checker policy: a different authorised user must approve this payroll run. Contact your administrator.' });
    }

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
    }));

    res.json({ payslips: result, total: result.length, employeeId });
  } catch (err) { next(err); }
});

// ─── GET /payroll/payslips/me/:period ─ Employee's own payslip PDF ────────────
router.get('/payslips/me/:period', authenticate, async (req, res, next) => {
  try {
    const employeeId = req.user.employeeId;
    if (!employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });

    const payslip = await prisma.payslip.findFirst({
      where: { employeeId, period: req.params.period, isPublished: true },
    });
    if (!payslip) return res.status(404).json({ error: 'Payslip not found or not yet published' });

    const data = {
      period: req.params.period,
      basicSalary: decrypt(payslip.basicSalaryEnc),
      grossPay: decrypt(payslip.grossPayEnc),
      netPay: decrypt(payslip.netPayEnc),
      employeeCpf: decrypt(payslip.employeeCpfEnc),
      employerCpf: decrypt(payslip.employerCpfEnc),
      sdl: payslip.sdlAmountEnc ? decrypt(payslip.sdlAmountEnc) : 0,
      ytdGross: payslip.ytdGrossEnc ? decrypt(payslip.ytdGrossEnc) : null,
      ytdEmployeeCpf: payslip.ytdEmployeeCpfEnc ? decrypt(payslip.ytdEmployeeCpfEnc) : null,
    };

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=payslip-${employeeId}-${req.params.period}.pdf`);
    doc.pipe(res);

    doc.fontSize(20).font('Helvetica-Bold').text('PAYSLIP', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(`${process.env.COMPANY_NAME || 'Vorkhive Pte Ltd'}`, { align: 'center' });
    doc.text(`UEN: ${process.env.COMPANY_UEN || '202512345A'}`, { align: 'center' });
    doc.moveDown();
    doc.text(`Pay Period: ${data.period}`);
    doc.text(`Employee ID: ${employeeId}`);
    doc.moveDown();
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
    if (data.ytdGross) {
      doc.moveDown();
      doc.text(`YTD Gross: SGD ${parseFloat(data.ytdGross).toFixed(2)}`);
      doc.text(`YTD Employee CPF: SGD ${parseFloat(data.ytdEmployeeCpf).toFixed(2)}`);
    }
    doc.end();
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
    doc.fontSize(12).font('Helvetica').text(`${process.env.COMPANY_NAME || 'Vorkhive Pte Ltd'}`, { align: 'center' });
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

// ─── GET /payroll/runs/:id/payslips ─ Admin: list payslips for a run ─────────
router.get('/runs/:id/payslips', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const payslips = await prisma.payslip.findMany({ where: { runId: req.params.id }, orderBy: { employeeId: 'asc' } });
    const result = payslips.map(ps => ({
      id: ps.id,
      employeeId: ps.employeeId,
      period: ps.period,
      grossPay: (() => { try { return parseFloat(decrypt(ps.grossPayEnc)) || 0; } catch { return 0; } })(),
      netPay: (() => { try { return parseFloat(decrypt(ps.netPayEnc)) || 0; } catch { return 0; } })(),
      employeeCpf: (() => { try { return parseFloat(decrypt(ps.employeeCpfEnc)) || 0; } catch { return 0; } })(),
      employerCpf: (() => { try { return parseFloat(decrypt(ps.employerCpfEnc)) || 0; } catch { return 0; } })(),
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
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=cpf-esubmit-${run.period}.txt`);
    res.send(content);
  } catch (err) { next(err); }
});

// ─── GET /payroll/bank-giro/:runId?bank=uob|ocbc|dbs ─ Bank GIRO file ───────
router.get('/bank-giro/:runId', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.HR_ADMIN, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const bank = (req.query.bank || 'uob').toLowerCase();
    if (!['uob', 'ocbc', 'dbs'].includes(bank)) {
      return res.status(400).json({ error: 'Unsupported bank. Use: uob, ocbc, dbs' });
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
      companyName: (req.query.companyName || process.env.COMPANY_NAME || 'VORKHIVE PTE LTD').slice(0, 140).toUpperCase(),
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
    } else {
      content = generateDbsGiro(payments, totalAmount, run, today, opts);
      filename = `DBS-GIRO-${run.period}.txt`;
    }

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(content);
  } catch (err) { next(err); }
});

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

function yyyymmdd(d) { return `${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}`; }
function ddmmyyyy(d) { return `${pad2(d.getDate())}${pad2(d.getMonth()+1)}${d.getFullYear()}`; }
function ddmmyy(d)   { return `${pad2(d.getDate())}${pad2(d.getMonth()+1)}${String(d.getFullYear()).slice(-2)}`; }

// ── UOB Infinity Bulk GIRO (without Payment Advice) ─────────────────────────
// Spec: UOB Bulk FAST & GIRO Format Specification v4.81
// Record size: 615 chars, CRLF line endings
function generateUobGiro(payments, totalAmount, run, today, opts = {}) {
  const companyAcct = (opts.acct || process.env.UOB_ACCOUNT_NO || '').replace(/[-\s]/g, '');
  const companyName = opts.companyName || process.env.COMPANY_NAME || 'VORKHIVE PTE LTD';
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
  const companyName = (opts.companyName || process.env.COMPANY_NAME || 'VORKHIVE PTE LTD').slice(0, 20);
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
