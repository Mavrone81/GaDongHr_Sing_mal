'use strict';
require('dotenv').config();
const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const morgan   = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { authenticate, authorize, ROLES } = require('/app/shared/auth-middleware');
const {
  validateAdvanceAmount, validateLoanTerms,
  computeMonthlyInstalment, computeTotalRepayable,
  buildRepaymentSchedule, computeOutstandingBalance, computeEarlySettlement,
  buildLoanDashboard, generateLoanAgreement,
  nextAdvanceNumber, nextLoanNumber,
} = require('./engines/loans.engine');

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:4009';
const EMPLOYEE_SERVICE_URL     = process.env.EMPLOYEE_SERVICE_URL     || 'http://employee-service:4002';
const INTERNAL_SERVICE_KEY     = process.env.INTERNAL_SERVICE_KEY;

// Fetch the authoritative monthlySalary from employee-service. Never trust
// a client-supplied monthlySalary in the request body — it lets the requester
// inflate their declared income and bypass the 1× advance / 30% instalment cap.
async function fetchAuthoritativeMonthlySalary(employeeId) {
  if (!INTERNAL_SERVICE_KEY) {
    throw new Error('INTERNAL_SERVICE_KEY is required to fetch salary');
  }
  const res = await fetch(`${EMPLOYEE_SERVICE_URL}/employees/${employeeId}/internal/monthly-salary`, {
    headers: { 'x-internal-service-key': INTERNAL_SERVICE_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`Salary lookup failed: ${res.status} ${body}`), { status: res.status });
  }
  const data = await res.json();
  return { monthlySalary: Number(data.monthlySalary || 0), isActive: data.isActive };
}

const prisma = new PrismaClient();
const app    = express();
const PORT   = process.env.PORT || 4018;

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined'));

app.get('/health', (req, res) => res.json({ service: 'loans-service', status: 'ok', ts: new Date() }));

const HR_ROLES      = [ROLES.HR_ADMIN, ROLES.HR_MANAGER, ROLES.SUPER_ADMIN];
const FINANCE_ROLES = [ROLES.FINANCE_ADMIN, ROLES.SUPER_ADMIN];
const APPROVER_ROLES = [...HR_ROLES, ...FINANCE_ROLES];

function isHr(role) { return HR_ROLES.includes(role); }
function isApprover(role) { return APPROVER_ROLES.includes(role); }

// ── Number generators ────────────────────────────────────────────────────────
async function generateAdvanceNumber() {
  const year = new Date().getFullYear();
  const count = await prisma.salaryAdvance.count({
    where: { createdAt: { gte: new Date(`${year}-01-01`) } },
  });
  return nextAdvanceNumber(count, year);
}
async function generateLoanNumber() {
  const year = new Date().getFullYear();
  const count = await prisma.staffLoan.count({
    where: { createdAt: { gte: new Date(`${year}-01-01`) } },
  });
  return nextLoanNumber(count, year);
}

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║                          SALARY ADVANCES                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

// POST /loans/advances — employee requests advance
app.post('/loans/advances', authenticate, async (req, res, next) => {
  try {
    const { amount, reason } = req.body;
    if (amount === undefined || isNaN(parseFloat(amount)))
      return res.status(400).json({ error: 'amount is required' });
    if (!reason || !reason.trim())
      return res.status(400).json({ error: 'reason is required' });

    // Resolve target employee BEFORE the salary lookup so we fetch the canonical
    // salary for the right employee, not the requester.
    const myId = req.user.employeeId || req.user.sub;
    const targetEmpId = isApprover(req.user.role) && req.body.employeeId ? req.body.employeeId : myId;
    const targetEmpName = req.body.employeeName || req.user.name || 'Unknown';

    if (!isApprover(req.user.role) && targetEmpId !== myId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // SECURITY (C-17): never trust monthlySalary from the body — fetch the
    // authoritative figure from employee-service. Any body.monthlySalary is
    // ignored and reported back in the response for transparency.
    let salaryLookup;
    try {
      salaryLookup = await fetchAuthoritativeMonthlySalary(targetEmpId);
    } catch (e) {
      return res.status(e.status === 404 ? 404 : 502).json({ error: e.message });
    }
    if (!salaryLookup.isActive) {
      return res.status(400).json({ error: 'Employee is not active — cannot request advance' });
    }
    const monthlySalary = salaryLookup.monthlySalary;
    if (!monthlySalary || monthlySalary <= 0) {
      return res.status(400).json({ error: 'Employee has no recorded basic salary' });
    }

    const v = validateAdvanceAmount(parseFloat(amount), monthlySalary);
    if (!v.valid) return res.status(400).json({ error: v.reason, maxAllowed: v.maxAllowed });

    const existingActive = await prisma.salaryAdvance.findFirst({
      where: { employeeId: targetEmpId, status: { in: ['PENDING','APPROVED'] } },
    });
    if (existingActive) {
      return res.status(409).json({ error: 'You already have a pending or approved advance' });
    }

    const advanceNumber = await generateAdvanceNumber();
    const created = await prisma.salaryAdvance.create({
      data: {
        id:            uuidv4(),
        advanceNumber,
        employeeId:    targetEmpId,
        employeeName:  targetEmpName,
        monthlySalary,                            // server-side authoritative
        amount:        parseFloat(amount),
        reason:        reason.trim(),
        requestedBy:   req.user.sub,
      },
    });

    fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientRole: 'HR_ADMIN',
        type: 'ADVANCE_REQUESTED',
        title: `Salary advance requested: ${advanceNumber}`,
        body:  `${targetEmpName} requested SGD ${amount}`,
        link:  `/loans?tab=advances`,
      }),
    }).catch(() => {});

    res.status(201).json(created);
  } catch (err) { next(err); }
});

// GET /loans/advances — list. Employee sees own; HR/Finance see all.
app.get('/loans/advances', authenticate, async (req, res, next) => {
  try {
    const { status, employeeId } = req.query;
    const where = {};
    if (!isApprover(req.user.role)) {
      where.employeeId = req.user.employeeId || req.user.sub;
    } else if (employeeId) {
      where.employeeId = employeeId;
    }
    if (status) where.status = status;

    const advances = await prisma.salaryAdvance.findMany({
      where, orderBy: { requestedAt: 'desc' },
    });
    res.json({ advances, total: advances.length });
  } catch (err) { next(err); }
});

// PUT /loans/advances/:id/approve
app.put('/loans/advances/:id/approve', authenticate, authorize(...APPROVER_ROLES), async (req, res, next) => {
  try {
    const { deductionMonth } = req.body;
    const adv = await prisma.salaryAdvance.findUnique({ where: { id: req.params.id } });
    if (!adv) return res.status(404).json({ error: 'Advance not found' });
    if (adv.status !== 'PENDING') return res.status(409).json({ error: `Cannot approve advance in status ${adv.status}` });

    const updated = await prisma.salaryAdvance.update({
      where: { id: adv.id },
      data: {
        status: 'APPROVED',
        approvedBy: req.user.sub,
        approvedByName: req.user.name || null,
        approvedAt: new Date(),
        deductionMonth: deductionMonth || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2,'0')}`,
      },
    });

    fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientId: adv.employeeId,
        type: 'ADVANCE_APPROVED',
        title: `Advance approved: ${adv.advanceNumber}`,
        body:  `SGD ${adv.amount} will be paid out; deducted in payroll month ${updated.deductionMonth}.`,
        link:  '/loans',
      }),
    }).catch(() => {});

    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /loans/advances/:id/reject
app.put('/loans/advances/:id/reject', authenticate, authorize(...APPROVER_ROLES), async (req, res, next) => {
  try {
    const { rejectionReason } = req.body;
    if (!rejectionReason || !rejectionReason.trim())
      return res.status(400).json({ error: 'rejectionReason is required' });
    const adv = await prisma.salaryAdvance.findUnique({ where: { id: req.params.id } });
    if (!adv) return res.status(404).json({ error: 'Advance not found' });
    if (adv.status !== 'PENDING') return res.status(409).json({ error: `Cannot reject advance in status ${adv.status}` });

    const updated = await prisma.salaryAdvance.update({
      where: { id: adv.id },
      data: {
        status: 'REJECTED',
        rejectedBy: req.user.sub, rejectedAt: new Date(),
        rejectionReason: rejectionReason.trim(),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /loans/advances/:id/cancel — requester cancels PENDING
app.put('/loans/advances/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const adv = await prisma.salaryAdvance.findUnique({ where: { id: req.params.id } });
    if (!adv) return res.status(404).json({ error: 'Advance not found' });
    if (adv.requestedBy !== req.user.sub && !isApprover(req.user.role))
      return res.status(403).json({ error: 'Only the requester or HR/Finance can cancel' });
    if (adv.status !== 'PENDING') return res.status(409).json({ error: `Cannot cancel advance in status ${adv.status}` });
    const updated = await prisma.salaryAdvance.update({
      where: { id: adv.id }, data: { status: 'CANCELLED' },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /loans/advances/:id/mark-deducted — payroll-service callback
app.post('/loans/advances/:id/mark-deducted', authenticate, authorize(...APPROVER_ROLES, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { payrollRunId } = req.body;
    const adv = await prisma.salaryAdvance.findUnique({ where: { id: req.params.id } });
    if (!adv) return res.status(404).json({ error: 'Advance not found' });
    if (adv.status !== 'APPROVED') return res.status(409).json({ error: 'Only APPROVED advances can be marked deducted' });
    const updated = await prisma.salaryAdvance.update({
      where: { id: adv.id },
      data: { status: 'DEDUCTED', deductedAt: new Date(), payrollRunId: payrollRunId || null },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║                              STAFF LOANS                                  ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

// GET /loans/dashboard — HR/Finance aggregate (BEFORE /:id to avoid shadowing)
app.get('/loans/dashboard', authenticate, authorize(...APPROVER_ROLES), async (req, res, next) => {
  try {
    const loans = await prisma.staffLoan.findMany({});
    const advances = await prisma.salaryAdvance.findMany({});
    res.json({
      loans: buildLoanDashboard(loans),
      advances: {
        total: advances.length,
        pending:   advances.filter(a => a.status === 'PENDING').length,
        approved:  advances.filter(a => a.status === 'APPROVED').length,
        deducted:  advances.filter(a => a.status === 'DEDUCTED').length,
        rejected:  advances.filter(a => a.status === 'REJECTED').length,
        totalApprovedAmount: round2(advances.filter(a => ['APPROVED','DEDUCTED'].includes(a.status))
          .reduce((s, a) => s + Number(a.amount || 0), 0)),
      },
    });
  } catch (err) { next(err); }
});

// GET /loans/termination-deductions/:employeeId — offboarding hook
app.get('/loans/termination-deductions/:employeeId', authenticate, authorize(...APPROVER_ROLES), async (req, res, next) => {
  try {
    const loans = await prisma.staffLoan.findMany({
      where: { employeeId: req.params.employeeId, status: { in: ['ACTIVE','APPROVED'] } },
    });
    const advances = await prisma.salaryAdvance.findMany({
      where: { employeeId: req.params.employeeId, status: 'APPROVED' },
    });
    const totalOutstanding = round2(
      loans.reduce((s, l) => s + Number(l.outstandingBalance || 0), 0) +
      advances.reduce((s, a) => s + Number(a.amount || 0), 0)
    );
    res.json({
      employeeId: req.params.employeeId,
      loans:    loans.map(l => ({ id: l.id, loanNumber: l.loanNumber, outstanding: l.outstandingBalance })),
      advances: advances.map(a => ({ id: a.id, advanceNumber: a.advanceNumber, amount: a.amount })),
      totalOutstanding,
      mustDeductFromFinalPay: totalOutstanding > 0,
    });
  } catch (err) { next(err); }
});

// POST /loans/staff-loans — employee requests loan
app.post('/loans/staff-loans', authenticate, async (req, res, next) => {
  try {
    const { principal, interestRate, tenureMonths, reason } = req.body;
    if (principal === undefined || tenureMonths === undefined)
      return res.status(400).json({ error: 'principal and tenureMonths are required' });
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'reason is required' });

    const principalF = parseFloat(principal);
    const rateF      = parseFloat(interestRate || 0);
    const tenureI    = parseInt(tenureMonths);

    const myId = req.user.employeeId || req.user.sub;
    const targetEmpId   = isApprover(req.user.role) && req.body.employeeId ? req.body.employeeId : myId;
    const targetEmpName = req.body.employeeName || req.user.name || 'Unknown';

    if (!isApprover(req.user.role) && targetEmpId !== myId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // SECURITY (C-17): salary must come from employee-service, not the body.
    let salaryLookup;
    try {
      salaryLookup = await fetchAuthoritativeMonthlySalary(targetEmpId);
    } catch (e) {
      return res.status(e.status === 404 ? 404 : 502).json({ error: e.message });
    }
    if (!salaryLookup.isActive) {
      return res.status(400).json({ error: 'Employee is not active — cannot request loan' });
    }
    const salF = salaryLookup.monthlySalary;
    if (!salF || salF <= 0) {
      return res.status(400).json({ error: 'Employee has no recorded basic salary' });
    }

    const v = validateLoanTerms({ principal: principalF, interestRate: rateF, tenureMonths: tenureI, monthlySalary: salF });
    if (!v.valid) return res.status(400).json({ error: v.reasons.join('; ') });

    // Prevent multiple active/pending loans
    const existingActive = await prisma.staffLoan.findFirst({
      where: { employeeId: targetEmpId, status: { in: ['PENDING','APPROVED','ACTIVE'] } },
    });
    if (existingActive) {
      return res.status(409).json({ error: 'You already have an active or pending loan' });
    }

    const monthlyInstalment = computeMonthlyInstalment(principalF, rateF, tenureI);
    const totalRepayable    = computeTotalRepayable(principalF, rateF, tenureI);

    const loanNumber = await generateLoanNumber();
    const created = await prisma.staffLoan.create({
      data: {
        id:                 uuidv4(),
        loanNumber,
        employeeId:         targetEmpId,
        employeeName:       targetEmpName,
        monthlySalary:      salF,
        principal:          principalF,
        interestRate:       rateF,
        tenureMonths:       tenureI,
        monthlyInstalment,
        totalRepayable,
        outstandingBalance: totalRepayable, // before any repayments
        reason:             reason.trim(),
        requestedBy:        req.user.sub,
      },
    });

    fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientRole: 'HR_ADMIN',
        type: 'LOAN_REQUESTED',
        title: `Staff loan requested: ${loanNumber}`,
        body:  `${targetEmpName} requested SGD ${principalF} over ${tenureI} months`,
        link:  `/loans?tab=loans`,
      }),
    }).catch(() => {});

    res.status(201).json(created);
  } catch (err) { next(err); }
});

// GET /loans/staff-loans — list
app.get('/loans/staff-loans', authenticate, async (req, res, next) => {
  try {
    const { status, employeeId } = req.query;
    const where = {};
    if (!isApprover(req.user.role)) {
      where.employeeId = req.user.employeeId || req.user.sub;
    } else if (employeeId) {
      where.employeeId = employeeId;
    }
    if (status) where.status = status;
    const loans = await prisma.staffLoan.findMany({
      where, orderBy: { requestedAt: 'desc' },
    });
    res.json({ loans, total: loans.length });
  } catch (err) { next(err); }
});

// GET /loans/staff-loans/:id — with repayment schedule + outstanding
app.get('/loans/staff-loans/:id', authenticate, async (req, res, next) => {
  try {
    const loan = await prisma.staffLoan.findUnique({
      where: { id: req.params.id },
      include: { repayments: { orderBy: { paymentNumber: 'asc' } } },
    });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (!isApprover(req.user.role) && loan.employeeId !== (req.user.employeeId || req.user.sub)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const outstanding = computeOutstandingBalance(loan, loan.repayments);
    const earlySettle = computeEarlySettlement(loan, loan.repayments);
    res.json({
      ...loan,
      outstanding,
      earlySettlement: earlySettle,
    });
  } catch (err) { next(err); }
});

// PUT /loans/staff-loans/:id/approve — creates repayment schedule + agreement
app.put('/loans/staff-loans/:id/approve', authenticate, authorize(...APPROVER_ROLES), async (req, res, next) => {
  try {
    const { startDate } = req.body;
    const loan = await prisma.staffLoan.findUnique({ where: { id: req.params.id } });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.status !== 'PENDING') return res.status(409).json({ error: `Cannot approve loan in status ${loan.status}` });

    const start = startDate
      ? new Date(startDate)
      : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1); // 1st of next month

    const schedule = buildRepaymentSchedule(loan, start);
    const expectedEnd = schedule.length ? schedule[schedule.length - 1].scheduledDate : null;
    const agreement = generateLoanAgreement({
      ...loan,
      startDate: start,
      expectedEndDate: expectedEnd,
    });

    const updated = await prisma.staffLoan.update({
      where: { id: loan.id },
      data: {
        status: 'APPROVED',
        approvedBy: req.user.sub, approvedByName: req.user.name || null,
        approvedAt: new Date(),
        startDate: start, expectedEndDate: expectedEnd,
        agreementHtml: agreement, agreementGeneratedAt: new Date(),
      },
    });

    // Create LoanRepayment rows
    await prisma.loanRepayment.createMany({
      data: schedule.map(s => ({
        id: uuidv4(),
        loanId: loan.id,
        paymentNumber: s.paymentNumber,
        scheduledDate: s.scheduledDate,
        scheduledAmount: s.scheduledAmount,
        type: 'SCHEDULED',
        status: 'PENDING',
      })),
    });

    fetch(`${NOTIFICATION_SERVICE_URL}/notifications`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientId: loan.employeeId,
        type: 'LOAN_APPROVED',
        title: `Loan approved: ${loan.loanNumber}`,
        body:  `SGD ${loan.principal} approved over ${loan.tenureMonths} months. Review and sign the agreement.`,
        link:  `/loans/${loan.id}`,
      }),
    }).catch(() => {});

    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /loans/staff-loans/:id/reject
app.put('/loans/staff-loans/:id/reject', authenticate, authorize(...APPROVER_ROLES), async (req, res, next) => {
  try {
    const { rejectionReason } = req.body;
    if (!rejectionReason || !rejectionReason.trim())
      return res.status(400).json({ error: 'rejectionReason is required' });
    const loan = await prisma.staffLoan.findUnique({ where: { id: req.params.id } });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.status !== 'PENDING') return res.status(409).json({ error: `Cannot reject loan in status ${loan.status}` });

    const updated = await prisma.staffLoan.update({
      where: { id: loan.id },
      data: {
        status: 'REJECTED',
        rejectedBy: req.user.sub, rejectedAt: new Date(),
        rejectionReason: rejectionReason.trim(),
      },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /loans/staff-loans/:id/activate — HR marks APPROVED → ACTIVE (after agreement signed)
app.put('/loans/staff-loans/:id/activate', authenticate, authorize(...APPROVER_ROLES), async (req, res, next) => {
  try {
    const { esignRequestId } = req.body;
    const loan = await prisma.staffLoan.findUnique({ where: { id: req.params.id } });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.status !== 'APPROVED') return res.status(409).json({ error: 'Only APPROVED loans can be activated' });
    const updated = await prisma.staffLoan.update({
      where: { id: loan.id },
      data: { status: 'ACTIVE', esignRequestId: esignRequestId || loan.esignRequestId },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// PUT /loans/staff-loans/:id/cancel — requester cancels PENDING
app.put('/loans/staff-loans/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const loan = await prisma.staffLoan.findUnique({ where: { id: req.params.id } });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (loan.requestedBy !== req.user.sub && !isApprover(req.user.role))
      return res.status(403).json({ error: 'Forbidden' });
    if (loan.status !== 'PENDING') return res.status(409).json({ error: `Cannot cancel loan in status ${loan.status}` });
    const updated = await prisma.staffLoan.update({
      where: { id: loan.id }, data: { status: 'CANCELLED' },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /loans/staff-loans/:id/repayments — record a monthly deduction (payroll callback or manual)
app.post('/loans/staff-loans/:id/repayments', authenticate, authorize(...APPROVER_ROLES, ROLES.PAYROLL_OFFICER), async (req, res, next) => {
  try {
    const { paymentNumber, paidAmount, paidDate, payrollRunId, type, notes } = req.body;

    const loan = await prisma.staffLoan.findUnique({
      where: { id: req.params.id },
      include: { repayments: { orderBy: { paymentNumber: 'asc' } } },
    });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (!['ACTIVE','APPROVED'].includes(loan.status))
      return res.status(409).json({ error: `Loan in status ${loan.status} cannot accept repayments` });

    // Locate the next PENDING row or by paymentNumber
    let row;
    if (paymentNumber !== undefined) {
      row = loan.repayments.find(r => r.paymentNumber === Number(paymentNumber));
      if (!row) return res.status(404).json({ error: `Repayment row #${paymentNumber} not found` });
    } else {
      row = loan.repayments.find(r => r.status === 'PENDING');
      if (!row) return res.status(409).json({ error: 'No pending repayments to record against' });
    }
    if (row.status !== 'PENDING') return res.status(409).json({ error: `Repayment #${row.paymentNumber} is already ${row.status}` });

    const amt = paidAmount !== undefined ? parseFloat(paidAmount) : row.scheduledAmount;
    const updatedRow = await prisma.loanRepayment.update({
      where: { id: row.id },
      data: {
        status: 'PAID',
        paidAmount: amt,
        paidDate: paidDate ? new Date(paidDate) : new Date(),
        payrollRunId: payrollRunId || null,
        type: type || 'SCHEDULED',
        notes: notes || null,
      },
    });

    // Recompute loan outstanding + repaid totals
    const allRows = await prisma.loanRepayment.findMany({ where: { loanId: loan.id } });
    const outstanding = computeOutstandingBalance(loan, allRows);
    const totalRepaid = (loan.totalRepayable - outstanding);
    const isSettled = outstanding <= 0.005;
    await prisma.staffLoan.update({
      where: { id: loan.id },
      data: {
        outstandingBalance: outstanding,
        totalRepaid: round2(totalRepaid),
        ...(isSettled ? { status: 'SETTLED', actualEndDate: new Date() } : {}),
      },
    });

    res.status(201).json({ repayment: updatedRow, outstanding, settled: isSettled });
  } catch (err) { next(err); }
});

// POST /loans/staff-loans/:id/settle — early payoff (creates one EARLY_SETTLEMENT row)
app.post('/loans/staff-loans/:id/settle', authenticate, async (req, res, next) => {
  try {
    const loan = await prisma.staffLoan.findUnique({
      where: { id: req.params.id },
      include: { repayments: true },
    });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    const isOwn = loan.employeeId === (req.user.employeeId || req.user.sub);
    if (!isApprover(req.user.role) && !isOwn) return res.status(403).json({ error: 'Forbidden' });
    if (!['ACTIVE','APPROVED'].includes(loan.status))
      return res.status(409).json({ error: `Loan in status ${loan.status} cannot be settled` });

    const settle = computeEarlySettlement(loan, loan.repayments);
    if (settle.outstanding <= 0) {
      return res.status(409).json({ error: 'No outstanding balance to settle' });
    }

    // Find next paymentNumber for the settlement row
    const maxRow = loan.repayments.reduce((m, r) => Math.max(m, r.paymentNumber), 0);
    const settlementRow = await prisma.loanRepayment.create({
      data: {
        id: uuidv4(),
        loanId: loan.id,
        paymentNumber: maxRow + 1,
        scheduledDate: new Date(),
        scheduledAmount: settle.settlementAmount,
        paidDate: new Date(),
        paidAmount: settle.settlementAmount,
        type: 'EARLY_SETTLEMENT',
        status: 'PAID',
      },
    });

    // Mark any remaining PENDING rows as WAIVED
    await prisma.loanRepayment.updateMany({
      where: { loanId: loan.id, status: 'PENDING' },
      data: { status: 'WAIVED' },
    });

    const updated = await prisma.staffLoan.update({
      where: { id: loan.id },
      data: {
        status: 'SETTLED',
        actualEndDate: new Date(),
        outstandingBalance: 0,
        totalRepaid: loan.totalRepayable,
      },
    });

    res.json({ loan: updated, settlement: settlementRow, settle });
  } catch (err) { next(err); }
});

// GET /loans/staff-loans/:id/agreement
app.get('/loans/staff-loans/:id/agreement', authenticate, async (req, res, next) => {
  try {
    const loan = await prisma.staffLoan.findUnique({ where: { id: req.params.id } });
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    if (!isApprover(req.user.role) && loan.employeeId !== (req.user.employeeId || req.user.sub))
      return res.status(403).json({ error: 'Forbidden' });

    let html = loan.agreementHtml;
    if (!html) {
      html = generateLoanAgreement(loan);
      await prisma.staffLoan.update({
        where: { id: loan.id }, data: { agreementHtml: html, agreementGeneratedAt: new Date() },
      });
    }
    res.json({ id: loan.id, loanNumber: loan.loanNumber, html });
  } catch (err) { next(err); }
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

if (require.main === module) {
  app.listen(PORT, () => console.log(`[loans-service] Running on port ${PORT}`));
}

module.exports = app;
