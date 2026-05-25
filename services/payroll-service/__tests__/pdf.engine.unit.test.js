'use strict';
/**
 * Unit tests for PAY-005 pdf.engine.js. Exercises both pure helpers
 * (splitLineItems, sgd) and a smoke test of buildPayslipPdf that
 * collects PDF bytes into a buffer.
 */

const { Writable } = require('stream');
const { buildPayslipPdf, splitLineItems, sgd } = require('../src/engines/pdf.engine');

describe('sgd formatter', () => {
  test('formats SGD with 2dp', () => {
    expect(sgd(1234)).toBe('SGD 1234.00');
    expect(sgd(0.5)).toBe('SGD 0.50');
    expect(sgd(null)).toBe('SGD 0.00');
  });
});

describe('splitLineItems', () => {
  test('routes DEDUCTION wageType into deductions (positive amount)', () => {
    const { deductions } = splitLineItems([
      { description: 'Salary advance recovery', amount: -200, wageType: 'DEDUCTION' },
    ]);
    expect(deductions[0]).toEqual({ name: 'Salary advance recovery', amount: 200 });
  });
  test('routes negative-amount items into deductions', () => {
    const { deductions } = splitLineItems([
      { description: 'CPF top-up', amount: -150, wageType: 'OW' },
    ]);
    expect(deductions[0].amount).toBe(150);
  });
  test('sums OT items into overtime', () => {
    const { overtime } = splitLineItems([
      { description: 'OT_PAY', amount: 150, wageType: 'OW', componentCode: 'OT_PAY' },
      { description: 'Overtime Allowance', amount: 50, wageType: 'OW' },
    ]);
    expect(overtime.amount).toBe(200);
  });
  test('everything else becomes an allowance', () => {
    const { allowances } = splitLineItems([
      { description: 'Transport Allowance', amount: 100, wageType: 'OW' },
      { description: 'Shift Differential',   amount: 80,  wageType: 'OW' },
    ]);
    expect(allowances.map(a => a.name)).toEqual(['Transport Allowance', 'Shift Differential']);
  });
});

describe('buildPayslipPdf — smoke test', () => {
  function collectBuffer() {
    const chunks = [];
    const stream = new Writable({
      write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
    });
    return { stream, getBuffer: () => Buffer.concat(chunks) };
  }

  function fullData() {
    return {
      company: { name: 'Test Co', uen: '202512345A', address: '1 Test Rd' },
      employee: { id: 'emp-1', fullName: 'Alice Tan', department: 'Engineering', designation: 'Senior Engineer', nric: '1234' },
      run: { period: '2026-05', paymentDate: '2026-06-07', runType: 'MONTHLY' },
      earnings: { basicSalary: 5000, grossPay: 5700 },
      allowances: [{ name: 'Transport', amount: 200 }, { name: 'Meal', amount: 100 }],
      overtime: { hours: 6, amount: 400, rate: 66.67 },
      deductions: [{ name: 'Employee CPF', amount: 1140 }, { name: 'No-Pay Leave (1 day)', amount: 230 }],
      netPay: 4330,
      employerCpf: 969,
      sdl: 14.25,
      fwl: 0,
      ytdGross: 28500, ytdEmployeeCpf: 5700, ytdEmployerCpf: 4845,
      govtPaidDays: 0, govtPaidAmount: 0,
      publishedAt: '2026-06-05T10:30:00Z',
    };
  }

  test('produces a non-empty PDF starting with %PDF-1.', (done) => {
    const { stream, getBuffer } = collectBuffer();
    stream.on('finish', () => {
      const buf = getBuffer();
      expect(buf.length).toBeGreaterThan(500);
      expect(buf.slice(0, 8).toString()).toMatch(/^%PDF-1\./);
      done();
    });
    buildPayslipPdf(stream, fullData());
  });

  test('PDF byte size scales with content (rich data > minimal data)', (done) => {
    const rich    = collectBuffer();
    const minimal = collectBuffer();
    let finished = 0;
    function checkBoth() {
      if (++finished < 2) return;
      // Rich payslip with allowances + OT + YTD should produce noticeably
      // more bytes than the minimal payload.
      expect(rich.getBuffer().length).toBeGreaterThan(minimal.getBuffer().length);
      done();
    }
    rich.stream.on('finish', checkBoth);
    minimal.stream.on('finish', checkBoth);
    buildPayslipPdf(rich.stream,    fullData());
    buildPayslipPdf(minimal.stream, {
      company: {}, employee: { id: 'e' }, run: { period: '2026-05' },
      earnings: { basicSalary: 100, grossPay: 100 }, deductions: [], netPay: 80, employerCpf: 17,
    });
  });

  test('handles minimal data without crashing', (done) => {
    const { stream, getBuffer } = collectBuffer();
    stream.on('finish', () => {
      expect(getBuffer().length).toBeGreaterThan(300);
      done();
    });
    buildPayslipPdf(stream, {
      company: {}, employee: { id: 'emp-x' }, run: { period: '2026-05' },
      earnings: { basicSalary: 1000, grossPay: 1000 },
      deductions: [], netPay: 800, employerCpf: 170,
    });
  });
});
