'use strict';
/**
 * PAY-005 MOM-compliant payslip PDF engine.
 *
 * Pure-ish — wraps PDFKit. Caller passes a fully-decrypted payslip dataset
 * and a writable stream (HTTP response, file stream, or buffer collector).
 * Produces an MOM EA s.96 itemised payslip with all mandatory fields:
 *
 *   1. Full name of employer (UEN)
 *   2. Full name of employee + employee ID
 *   3. Pay period start + end dates (or month)
 *   4. Date of payment (payment date)
 *   5. Basic salary (with units worked + rate when hourly)
 *   6. Allowances itemised (transport, meal, shift, etc.)
 *   7. Overtime hours + pay
 *   8. Deductions itemised (CPF, NPL, advance, claim recovery, etc.)
 *   9. Net pay
 *   10. Employer CPF contribution
 *   11. Other authorised deductions (SDL, FWL, donations) — informational
 *
 * Also includes YTD figures (Gross + Employee CPF), MOM compliance footer,
 * and a "PAYSLIP GENERATED" timestamp.
 */

const PDFDocument = require('pdfkit');

const PAGE_OPTS = { size: 'A4', margins: { top: 40, bottom: 40, left: 50, right: 50 } };
const NUM_COL_X = 420;

function sgd(n) {
  const v = Number(n) || 0;
  return `SGD ${v.toFixed(2)}`;
}

function drawHr(doc) {
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#999').lineWidth(0.5).stroke().strokeColor('#000');
  doc.moveDown(0.3);
}

function drawRow(doc, label, value, opts = {}) {
  const y = doc.y;
  const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
  const size = opts.size || 10;
  doc.font(font).fontSize(size);
  doc.text(label, 50, y, { width: 340, continued: false });
  doc.text(value, NUM_COL_X, y, { width: 125, align: 'right' });
  doc.moveDown(0.3);
}

function drawSectionHeading(doc, title) {
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a365d');
  doc.text(title, 50, doc.y);
  doc.fillColor('#000');
  drawHr(doc);
}

/**
 * Build a MOM-compliant payslip into the provided writable stream.
 *
 * @param {object} stream  writable (e.g. HTTP res, fs writeStream, or memory)
 * @param {object} data    decrypted payslip + run + employee + line items
 *   data.company = { name, uen, address }
 *   data.employee = { id, fullName, nric (last4), department, designation, jobTitle? }
 *   data.run = { period, periodStart, periodEnd, paymentDate, runType }
 *   data.earnings.basicSalary, .grossPay
 *   data.allowances = [{ name, amount }]
 *   data.overtime = { hours, amount, rate? }
 *   data.deductions = [{ name, amount }]    // already includes Employee CPF, NPL
 *   data.netPay
 *   data.employerCpf, data.sdl?, data.fwl?
 *   data.ytdGross?, data.ytdEmployeeCpf?, data.ytdEmployerCpf?
 *   data.govtPaidDays?, data.govtPaidAmount?
 *   data.publishedAt? (ISO string for footer)
 * @returns {PDFDocument}
 */
function buildPayslipPdf(stream, data) {
  const doc = new PDFDocument(PAGE_OPTS);
  doc.pipe(stream);

  const company = data.company || {};
  const emp     = data.employee || {};
  const run     = data.run || {};

  // ── Header ─────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(18).text('PAYSLIP', { align: 'center' });
  doc.font('Helvetica').fontSize(11).text(company.name || 'GaDongHR Pte Ltd', { align: 'center' });
  if (company.uen) doc.fontSize(9).text(`UEN: ${company.uen}`, { align: 'center' });
  if (company.address) doc.fontSize(9).text(company.address, { align: 'center' });
  doc.moveDown(0.6);
  drawHr(doc);

  // ── Employee block ────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(10).text('EMPLOYEE', 50, doc.y);
  doc.font('Helvetica').fontSize(9);
  doc.text(`Name:        ${emp.fullName || emp.id}`, 50, doc.y + 2);
  doc.text(`Employee ID: ${emp.id || '—'}`);
  if (emp.nric)        doc.text(`NRIC/FIN:    XXXX${emp.nric}`);
  if (emp.department)  doc.text(`Department:  ${emp.department}`);
  if (emp.designation) doc.text(`Designation: ${emp.designation}`);
  doc.moveDown(0.4);

  // ── Run block ─────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(10).text('PAY DETAILS', 50, doc.y);
  doc.font('Helvetica').fontSize(9);
  doc.text(`Pay Period:    ${run.period}${run.periodStart && run.periodEnd ? `  (${run.periodStart} → ${run.periodEnd})` : ''}`, 50, doc.y + 2);
  if (run.paymentDate) doc.text(`Payment Date:  ${String(run.paymentDate).slice(0, 10)}`);
  if (run.runType)     doc.text(`Run Type:      ${run.runType}`);
  doc.moveDown(0.4);
  drawHr(doc);

  // ── Earnings ─────────────────────────────────────────────────────────────
  drawSectionHeading(doc, 'EARNINGS');
  drawRow(doc, 'Basic Salary', sgd(data.earnings?.basicSalary));
  if (Array.isArray(data.allowances)) {
    for (const a of data.allowances) {
      drawRow(doc, a.name || 'Allowance', sgd(a.amount));
    }
  }
  if (data.overtime && (data.overtime.hours > 0 || data.overtime.amount > 0)) {
    const otLabel = data.overtime.hours
      ? `Overtime (${Number(data.overtime.hours).toFixed(2)}h${data.overtime.rate ? ` @ ${sgd(data.overtime.rate)}/h` : ''})`
      : 'Overtime';
    drawRow(doc, otLabel, sgd(data.overtime.amount));
  }
  if (data.govtPaidAmount && data.govtPaidAmount > 0) {
    drawRow(doc, `Government-Paid Leave (${data.govtPaidDays || 0} day(s))`, sgd(data.govtPaidAmount));
  }
  drawHr(doc);
  drawRow(doc, 'GROSS PAY', sgd(data.earnings?.grossPay), { bold: true, size: 11 });

  // ── Deductions ───────────────────────────────────────────────────────────
  drawSectionHeading(doc, 'DEDUCTIONS');
  if (Array.isArray(data.deductions) && data.deductions.length) {
    for (const d of data.deductions) {
      drawRow(doc, d.name || 'Deduction', sgd(d.amount));
    }
  } else {
    drawRow(doc, '(no deductions)', '—');
  }
  drawHr(doc);
  drawRow(doc, 'NET PAY', sgd(data.netPay), { bold: true, size: 11 });

  // ── Statutory + employer-side info (not deducted from net) ──────────────
  drawSectionHeading(doc, 'EMPLOYER CONTRIBUTIONS & STATUTORY');
  drawRow(doc, 'Employer CPF Contribution', sgd(data.employerCpf));
  if (data.sdl != null) drawRow(doc, 'Skills Development Levy (SDL)', sgd(data.sdl));
  if (data.fwl != null && data.fwl > 0) drawRow(doc, 'Foreign Worker Levy (FWL)', sgd(data.fwl));

  // ── YTD ──────────────────────────────────────────────────────────────────
  if (data.ytdGross != null || data.ytdEmployeeCpf != null) {
    drawSectionHeading(doc, 'YEAR-TO-DATE');
    if (data.ytdGross != null)       drawRow(doc, 'YTD Gross Pay',       sgd(data.ytdGross));
    if (data.ytdEmployeeCpf != null) drawRow(doc, 'YTD Employee CPF',    sgd(data.ytdEmployeeCpf));
    if (data.ytdEmployerCpf != null) drawRow(doc, 'YTD Employer CPF',    sgd(data.ytdEmployerCpf));
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  doc.moveDown(1.5);
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666');
  doc.text('Issued in compliance with Singapore Employment Act s.96 (Itemised Pay Slip).', 50, doc.y, { align: 'center' });
  if (data.publishedAt) {
    doc.text(`Published: ${String(data.publishedAt).slice(0, 19).replace('T', ' ')} UTC`, { align: 'center' });
  } else {
    doc.text(`Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, { align: 'center' });
  }
  doc.fillColor('#000');

  doc.end();
  return doc;
}

/**
 * Translate raw line items (with wageType + isCpfApplicable hints) into the
 * data shape the PDF builder expects. Caller has already decrypted amounts.
 *
 * @param {Array<object>} lineItems  [{ description, amount, wageType, isCpfApplicable, isDeduction }]
 * @returns {{ allowances: Array, deductions: Array, overtime: { hours, amount } }}
 */
function splitLineItems(lineItems = []) {
  const allowances = [];
  const deductions = [];
  let otAmount = 0;
  for (const li of lineItems) {
    const amount = Number(li.amount) || 0;
    if (li.wageType === 'DEDUCTION' || amount < 0 || li.isDeduction) {
      deductions.push({ name: li.description, amount: Math.abs(amount) });
    } else if (/^OT(_|$)|OVERTIME/i.test(li.description || '') || (li.componentCode || '').startsWith('OT_')) {
      otAmount += amount;
    } else {
      allowances.push({ name: li.description, amount });
    }
  }
  return { allowances, deductions, overtime: { hours: 0, amount: otAmount } };
}

module.exports = {
  buildPayslipPdf,
  splitLineItems,
  sgd,
};
