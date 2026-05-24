'use strict';
/**
 * Unit tests for the payroll journal engine.
 * Verifies double-entry balancing, cost-centre allocation, and exporter formats.
 */
const {
  buildEntriesForEmployee, summariseEntries, allocate,
  toCsv, toXero, toQuickBooks, toSap, DEFAULTS,
} = require('../src/engines/journal.engine');

describe('allocate()', () => {
  test('no cost centres → single null-allocation entry equal to full amount', () => {
    const out = allocate(1000, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ costCentreId: null, costCentre: null, amount: 1000 });
  });

  test('split 60/40', () => {
    const out = allocate(1000, [
      { costCentreId: 'cc-a', percentage: 60 },
      { costCentreId: 'cc-b', percentage: 40 },
    ]);
    expect(out[0].amount).toBe(600);
    expect(out[1].amount).toBe(400);
  });

  test('rounding drift swept into first entry so split sums match input', () => {
    const out = allocate(1000, [
      { costCentreId: 'cc-a', percentage: 33.33 },
      { costCentreId: 'cc-b', percentage: 33.33 },
      { costCentreId: 'cc-c', percentage: 33.34 },
    ]);
    const sum = out.reduce((s, x) => s + x.amount, 0);
    expect(sum).toBeCloseTo(1000, 2);
  });

  test('off-100 percentages still normalise', () => {
    const out = allocate(1000, [
      { costCentreId: 'a', percentage: 50 },
      { costCentreId: 'b', percentage: 50 },
    ]);
    expect(out[0].amount + out[1].amount).toBeCloseTo(1000, 2);
  });
});

describe('buildEntriesForEmployee()', () => {
  const payslip = {
    employeeId: 'emp-1', period: '2026-05',
    grossPay: 6000, netPay: 4800,
    employeeCpf: 1200, employerCpf: 1020,
    sdl: 11.25, fwl: 0,
  };

  test('produces a balanced journal (debits = credits) with no allocations', () => {
    const entries = buildEntriesForEmployee(payslip, []);
    const totals = summariseEntries(entries);
    expect(totals.balanced).toBe(true);
    expect(totals.debit).toBeCloseTo(totals.credit, 2);
  });

  test('Dr salary expense = gross pay, Cr employee CPF, Cr bank = net pay', () => {
    const entries = buildEntriesForEmployee(payslip, []);
    const findOne = (acct, side) => entries.find(e => e.account === acct && e.side === side);
    expect(findOne(DEFAULTS.salaryAccount, 'DEBIT').amount).toBe(6000);
    expect(findOne(DEFAULTS.employeeCpfAccount, 'CREDIT').amount).toBe(1200);
    expect(findOne(DEFAULTS.bankAccount, 'CREDIT').amount).toBe(4800);
    expect(findOne(DEFAULTS.sdlAccount, 'CREDIT').amount).toBe(11.25);
  });

  test('split cost centre creates two debit lines for salary', () => {
    const entries = buildEntriesForEmployee(payslip, [
      { costCentreId: 'cc-a', percentage: 70, costCentre: { code: 'ENG' } },
      { costCentreId: 'cc-b', percentage: 30, costCentre: { code: 'OPS' } },
    ]);
    const salaryDebits = entries.filter(e => e.side === 'DEBIT' && e.description.startsWith('Salary expense'));
    expect(salaryDebits).toHaveLength(2);
    expect(salaryDebits[0].amount).toBeCloseTo(4200, 2);
    expect(salaryDebits[1].amount).toBeCloseTo(1800, 2);
  });

  test('zero FWL → no FWL line created', () => {
    const entries = buildEntriesForEmployee(payslip, []);
    expect(entries.find(e => e.account === DEFAULTS.fwlAccount)).toBeUndefined();
  });

  test('non-zero FWL → FWL credit line created', () => {
    const entries = buildEntriesForEmployee({ ...payslip, fwl: 50 }, []);
    const fwl = entries.find(e => e.account === DEFAULTS.fwlAccount);
    expect(fwl).toBeDefined();
    expect(fwl.side).toBe('CREDIT');
    expect(fwl.amount).toBe(50);
  });

  test('uses cost-centre GL override when present', () => {
    const entries = buildEntriesForEmployee(payslip, [
      { costCentreId: 'cc-a', percentage: 100, costCentre: { glSalaryAccount: '6100', code: 'ENG' } },
    ]);
    const salaryDr = entries.find(e => e.side === 'DEBIT' && e.description.startsWith('Salary'));
    expect(salaryDr.account).toBe('6100');
  });

  test('balancing entry posted when payslip has unmodeled deductions', () => {
    // Net = gross − empCpf − advance(500); modeled here as gross=6000, empCpf=1200, net=4300
    const ps = { ...payslip, netPay: 4300 };
    const entries = buildEntriesForEmployee(ps, []);
    const susp = entries.find(e => e.account === '9999');
    expect(susp).toBeDefined();
    expect(summariseEntries(entries).balanced).toBe(true);
  });
});

describe('Exporter formats', () => {
  const entries = [
    { account: '5100', accountName: 'Salary Expense', side: 'DEBIT',  description: 'Salary',  amount: 6000, costCentreCode: 'ENG', employeeId: 'emp-1', date: '2026-05-01' },
    { account: '2200', accountName: 'CPF Payable',    side: 'CREDIT', description: 'Emp CPF', amount: 1200, costCentreCode: null,  employeeId: 'emp-1', date: '2026-05-01' },
    { account: '1100', accountName: 'Bank Payable',   side: 'CREDIT', description: 'Net pay', amount: 4800, costCentreCode: null,  employeeId: 'emp-1', date: '2026-05-01' },
  ];

  test('CSV — header + rows, amounts to 2dp', () => {
    const csv = toCsv(entries);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Date,Account,AccountName,Side,Amount,Description,CostCentre,EmployeeID');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/6000\.00,"Salary",ENG,emp-1$/);
  });

  test('Xero — Debit positive, Credit negative, tracking option present for CC', () => {
    const xero = toXero(entries, '2026-05');
    expect(xero.split('\n')[0]).toBe('Narration,Date,Description,AccountCode,TaxRate,Amount,TrackingName1,TrackingOption1');
    expect(xero).toContain(',6000.00,Cost Centre,ENG');
    expect(xero).toContain(',-1200.00,,');
    expect(xero).toContain(',-4800.00,,');
  });

  test('QuickBooks IIF — header rows + SPL lines + ENDTRNS', () => {
    const iif = toQuickBooks(entries, '2026-05');
    expect(iif).toContain('!TRNS');
    expect(iif).toContain('!SPL');
    expect(iif).toContain('!ENDTRNS');
    expect(iif).toContain('SPL\tGENERAL JOURNAL\t2026-05-01\t5100\t6000.00');
    expect(iif).toContain('SPL\tGENERAL JOURNAL\t2026-05-01\t2200\t-1200.00');
    expect(iif.split('\n').pop()).toBe('ENDTRNS');
  });

  test('SAP — separate debit and credit columns', () => {
    const sap = toSap(entries, '2026-05');
    expect(sap.split('\n')[0]).toBe('PostingDate,DocType,GLAccount,Debit,Credit,Currency,ProfitCentre,Text,Reference');
    const rows = sap.split('\n').slice(1);
    expect(rows[0]).toContain(',SA,5100,6000.00,0.00,SGD,ENG,');
    expect(rows[1]).toContain(',SA,2200,0.00,1200.00,SGD,,');
  });
});

describe('summariseEntries()', () => {
  test('balanced returns true when debits == credits', () => {
    const r = summariseEntries([
      { side: 'DEBIT',  amount: 100 },
      { side: 'CREDIT', amount: 100 },
    ]);
    expect(r.balanced).toBe(true);
    expect(r.debit).toBe(100);
    expect(r.credit).toBe(100);
  });

  test('balanced returns false on mismatch beyond 1 cent', () => {
    const r = summariseEntries([
      { side: 'DEBIT',  amount: 100 },
      { side: 'CREDIT', amount: 90 },
    ]);
    expect(r.balanced).toBe(false);
  });

  test('treats 0.001 cent rounding as balanced', () => {
    const r = summariseEntries([
      { side: 'DEBIT',  amount: 100.001 },
      { side: 'CREDIT', amount: 100.0 },
    ]);
    expect(r.balanced).toBe(true);
  });
});
