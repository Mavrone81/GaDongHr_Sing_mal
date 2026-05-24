'use strict';
/**
 * Payroll journal engine (PAY-012).
 *
 * Generates double-entry accounting journal entries from a finalised payroll
 * run. Default chart of accounts can be overridden per cost centre or globally
 * via env vars.
 *
 * Standard journal pattern per employee, per payroll run:
 *   Dr  Salary Expense     gross pay (split by cost-centre allocation %)
 *      Cr  Employee CPF Payable        employee CPF
 *      Cr  Employer CPF Payable        employer CPF
 *      Cr  SDL Payable                 sdl
 *      Cr  FWL Payable                 fwl (if any)
 *      Cr  Bank / GIRO Payable         net pay
 *
 * For each line the system records: account code, account name, side,
 * description, encrypted amount, optional employee + cost centre. Debit/Credit
 * totals must balance; the API rejects an unbalanced journal.
 */

const DEFAULTS = {
  salaryAccount:     process.env.GL_SALARY_ACCOUNT     || '5100',
  employerCpfAccount:process.env.GL_EMPLOYER_CPF_ACCOUNT|| '5110',
  employeeCpfAccount:process.env.GL_EMPLOYEE_CPF_ACCOUNT|| '2200',
  sdlAccount:        process.env.GL_SDL_ACCOUNT        || '2210',
  fwlAccount:        process.env.GL_FWL_ACCOUNT        || '2220',
  bankAccount:       process.env.GL_BANK_ACCOUNT       || '1100',
};
const ACCOUNT_NAMES = {
  salaryAccount:      'Salary Expense',
  employerCpfAccount: 'Employer CPF Expense',
  employeeCpfAccount: 'Employee CPF Payable',
  sdlAccount:         'SDL Payable',
  fwlAccount:         'FWL Payable',
  bankAccount:        'Bank / GIRO Payable',
};

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Resolve the GL account for a given purpose, preferring the cost-centre
 * override when present.
 */
function resolveAccount(purpose, costCentre) {
  if (costCentre) {
    // Override field is e.g. costCentre.glSalaryAccount when purpose='salary'
    const override = costCentre[`gl${purpose[0].toUpperCase()}${purpose.slice(1)}Account`];
    if (override) return override;
  }
  return DEFAULTS[`${purpose}Account`] || 'UNKNOWN';
}

/**
 * Allocate one amount across an array of {costCentreId, percentage, costCentre}
 * entries. If allocations is empty, returns the full amount on a single null
 * cost centre (the system default).
 */
function allocate(amount, allocations) {
  if (!allocations || allocations.length === 0) {
    return [{ costCentreId: null, costCentre: null, amount: round2(amount) }];
  }
  // Normalise percentages defensively in case they don't sum to exactly 100.
  const totalPct = allocations.reduce((s, a) => s + (a.percentage || 0), 0) || 100;
  const out = allocations.map(a => ({
    costCentreId: a.costCentreId,
    costCentre: a.costCentre || null,
    amount: round2(amount * (a.percentage || 0) / totalPct),
  }));
  // Sweep rounding drift into the first entry so totals match.
  const sum = out.reduce((s, x) => s + x.amount, 0);
  const drift = round2(amount - sum);
  if (drift !== 0 && out.length > 0) out[0].amount = round2(out[0].amount + drift);
  return out;
}

/**
 * Build journal entries for a single employee/payslip.
 * @param {Object} ps  payslip with decrypted numeric fields (grossPay, net, ...).
 * @param {Array} allocations  cost-centre allocations for this employee.
 * @returns {Array} array of journal entry objects (account, side, amount, ...)
 */
function buildEntriesForEmployee(ps, allocations) {
  const entries = [];

  // Helper to push a balanced pair of allocations
  const pushSplit = (purpose, side, amount, descPrefix) => {
    if (amount <= 0) return;
    const splits = allocate(amount, allocations);
    for (const s of splits) {
      entries.push({
        account: resolveAccount(purpose, s.costCentre),
        accountName: ACCOUNT_NAMES[`${purpose}Account`],
        side,
        description: `${descPrefix} — ${ps.employeeId} (${ps.period})`,
        amount: s.amount,
        costCentreId: s.costCentreId,
        employeeId: ps.employeeId,
      });
    }
  };

  // Dr Salary Expense — gross pay, by cost-centre
  pushSplit('salary',      'DEBIT',  ps.grossPay,     'Salary expense');
  // Dr Employer CPF Expense (an expense line that lands in P&L, balanced by Cr CPF Payable below)
  pushSplit('employerCpf', 'DEBIT',  ps.employerCpf,  'Employer CPF expense');

  // Cr Employee CPF Payable (statutory liability)
  if (ps.employeeCpf > 0) {
    entries.push({
      account: DEFAULTS.employeeCpfAccount, accountName: ACCOUNT_NAMES.employeeCpfAccount,
      side: 'CREDIT', description: `Employee CPF payable — ${ps.employeeId} (${ps.period})`,
      amount: round2(ps.employeeCpf), costCentreId: null, employeeId: ps.employeeId,
    });
  }
  // Cr Employer CPF Payable (the same amount we expensed as a debit above)
  if (ps.employerCpf > 0) {
    entries.push({
      account: DEFAULTS.employerCpfAccount + '-PAYABLE', accountName: 'Employer CPF Payable',
      side: 'CREDIT', description: `Employer CPF payable — ${ps.employeeId} (${ps.period})`,
      amount: round2(ps.employerCpf), costCentreId: null, employeeId: ps.employeeId,
    });
  }
  if (ps.sdl > 0) {
    entries.push({
      account: DEFAULTS.sdlAccount, accountName: ACCOUNT_NAMES.sdlAccount,
      side: 'CREDIT', description: `SDL payable — ${ps.employeeId} (${ps.period})`,
      amount: round2(ps.sdl), costCentreId: null, employeeId: ps.employeeId,
    });
  }
  if (ps.fwl > 0) {
    entries.push({
      account: DEFAULTS.fwlAccount, accountName: ACCOUNT_NAMES.fwlAccount,
      side: 'CREDIT', description: `FWL payable — ${ps.employeeId} (${ps.period})`,
      amount: round2(ps.fwl), costCentreId: null, employeeId: ps.employeeId,
    });
  }
  // Cr Bank / GIRO Payable — net pay
  if (ps.netPay > 0) {
    entries.push({
      account: DEFAULTS.bankAccount, accountName: ACCOUNT_NAMES.bankAccount,
      side: 'CREDIT', description: `Net pay (GIRO) — ${ps.employeeId} (${ps.period})`,
      amount: round2(ps.netPay), costCentreId: null, employeeId: ps.employeeId,
    });
  }
  // Note: we don't add a CR for employer CPF expense from a different perspective —
  // the dr+cr Employer CPF pair above already balances. We treat the employer CPF
  // as both an expense (P&L) and a liability (BS), which is the standard pattern.
  // Plug for unmodeled deductions (claims reimbursements, advances) so the journal
  // balances against gross. Difference = gross − employeeCpf − netPay (− others ≈ 0).
  const debits  = entries.filter(e => e.side === 'DEBIT').reduce((s, e) => s + e.amount, 0);
  const credits = entries.filter(e => e.side === 'CREDIT').reduce((s, e) => s + e.amount, 0);
  const diff = round2(debits - credits);
  if (Math.abs(diff) >= 0.01) {
    entries.push({
      account: '9999', accountName: 'Payroll Suspense',
      side: diff > 0 ? 'CREDIT' : 'DEBIT',
      description: `Balancing entry — ${ps.employeeId} (${ps.period})`,
      amount: Math.abs(diff), costCentreId: null, employeeId: ps.employeeId,
    });
  }

  return entries;
}

/**
 * Aggregate to journal-level totals.
 */
function summariseEntries(entries) {
  const totals = entries.reduce((acc, e) => {
    if (e.side === 'DEBIT')  acc.debit  += e.amount;
    if (e.side === 'CREDIT') acc.credit += e.amount;
    return acc;
  }, { debit: 0, credit: 0 });
  totals.debit = round2(totals.debit);
  totals.credit = round2(totals.credit);
  totals.balanced = Math.abs(totals.debit - totals.credit) < 0.01;
  return totals;
}

// ─── Export formatters ────────────────────────────────────────────────────────

function toCsv(entries) {
  const header = 'Date,Account,AccountName,Side,Amount,Description,CostCentre,EmployeeID';
  const rows = entries.map(e => [
    e.date || '',
    e.account,
    `"${(e.accountName || '').replace(/"/g, '""')}"`,
    e.side,
    e.amount.toFixed(2),
    `"${(e.description || '').replace(/"/g, '""')}"`,
    e.costCentreCode || '',
    e.employeeId || '',
  ].join(','));
  return [header, ...rows].join('\n');
}

/**
 * Xero "Manual journal" CSV import format.
 * Columns expected by Xero: Narration, Date, Description, AccountCode, TaxRate, Amount, TrackingName1, TrackingOption1.
 * Debit = positive, Credit = negative.
 */
function toXero(entries, period) {
  const header = 'Narration,Date,Description,AccountCode,TaxRate,Amount,TrackingName1,TrackingOption1';
  const date = `${period}-${String(new Date(period + '-01').getDate()).padStart(2, '0')}`;
  const rows = entries.map(e => {
    const signedAmount = (e.side === 'DEBIT' ? e.amount : -e.amount).toFixed(2);
    return [
      `Payroll ${period}`,
      e.date || period + '-01',
      `"${(e.description || '').replace(/"/g, '""')}"`,
      e.account,
      'No Tax',
      signedAmount,
      e.costCentreCode ? 'Cost Centre' : '',
      e.costCentreCode || '',
    ].join(',');
  });
  return [header, ...rows].join('\n');
}

/**
 * QuickBooks IIF format (single transaction per row pair).
 */
function toQuickBooks(entries, period) {
  const lines = [
    '!TRNS\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO',
    '!SPL\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO\tCLASS',
    '!ENDTRNS',
    `TRNS\tGENERAL JOURNAL\t${period}-01\tPayroll Clearing\t0.00\tPAY-${period}\tPayroll ${period}`,
  ];
  for (const e of entries) {
    const amt = (e.side === 'DEBIT' ? e.amount : -e.amount).toFixed(2);
    lines.push(`SPL\tGENERAL JOURNAL\t${period}-01\t${e.account}\t${amt}\tPAY-${period}\t${e.description}\t${e.costCentreCode || ''}`);
  }
  lines.push('ENDTRNS');
  return lines.join('\n');
}

/**
 * SAP standard journal import (GL account, debit/credit columns, profit centre).
 */
function toSap(entries, period) {
  const header = 'PostingDate,DocType,GLAccount,Debit,Credit,Currency,ProfitCentre,Text,Reference';
  const rows = entries.map(e => [
    period + '-01', 'SA', e.account,
    e.side === 'DEBIT'  ? e.amount.toFixed(2) : '0.00',
    e.side === 'CREDIT' ? e.amount.toFixed(2) : '0.00',
    'SGD',
    e.costCentreCode || '',
    `"${(e.description || '').replace(/"/g, '""')}"`,
    `PAY-${period}`,
  ].join(','));
  return [header, ...rows].join('\n');
}

module.exports = {
  buildEntriesForEmployee,
  summariseEntries,
  allocate,
  resolveAccount,
  toCsv,
  toXero,
  toQuickBooks,
  toSap,
  DEFAULTS,
};
