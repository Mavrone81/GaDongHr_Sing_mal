'use strict';
/**
 * Unit tests for payroll consolidation helper logic.
 *
 * Tests pure functions used in the payroll UI:
 *   - dedupPayslipsByPeriod: given multiple payslips for same period, returns one (highest netPay)
 *   - buildVarianceSummary: given variance rows, returns total delta
 */

// ── Pure function implementations (mirror the inline logic in payroll page) ────

interface PayslipEntry {
  id: string;
  period: string;
  netPay: number;
  grossPay: number;
  basicSalary: number;
  employeeCpf: number;
}

function dedupPayslipsByPeriod(payslips: PayslipEntry[]): PayslipEntry[] {
  const map = new Map<string, PayslipEntry>();
  for (const ps of payslips) {
    const existing = map.get(ps.period);
    if (!existing || ps.netPay > existing.netPay) map.set(ps.period, ps);
  }
  return Array.from(map.values()).sort((a, b) => b.period.localeCompare(a.period));
}

interface VarianceRow {
  employeeId: string;
  existingNet: number;
  delta: number;
  combinedNet: number;
  hasExisting: boolean;
}

function buildVarianceSummary(rows: VarianceRow[]) {
  const totalDelta    = rows.reduce((s, r) => s + r.delta, 0);
  const totalCombined = rows.reduce((s, r) => s + r.combinedNet, 0);
  const conflictCount = rows.filter(r => r.hasExisting).length;
  return { totalDelta, totalCombined, conflictCount };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('dedupPayslipsByPeriod', () => {
  const base: PayslipEntry = { id: 'ps-1', period: '2026-05', netPay: 4000, grossPay: 5000, basicSalary: 5000, employeeCpf: 1000 };

  test('returns single payslip unchanged', () => {
    const result = dedupPayslipsByPeriod([base]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ps-1');
  });

  test('deduplicates two entries for same period — keeps highest netPay', () => {
    const second: PayslipEntry = { ...base, id: 'ps-2', netPay: 6000 };
    const result = dedupPayslipsByPeriod([base, second]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ps-2');
    expect(result[0].netPay).toBe(6000);
  });

  test('deduplicates three entries for same period — keeps highest netPay', () => {
    const a: PayslipEntry = { ...base, id: 'ps-a', period: '2026-05', netPay: 2000 };
    const b: PayslipEntry = { ...base, id: 'ps-b', period: '2026-05', netPay: 8000 };
    const c: PayslipEntry = { ...base, id: 'ps-c', period: '2026-05', netPay: 4000 };
    const result = dedupPayslipsByPeriod([a, b, c]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ps-b');
  });

  test('preserves distinct periods', () => {
    const may: PayslipEntry  = { ...base, id: 'ps-may',  period: '2026-05', netPay: 4000 };
    const apr: PayslipEntry  = { ...base, id: 'ps-apr',  period: '2026-04', netPay: 3800 };
    const result = dedupPayslipsByPeriod([may, apr]);
    expect(result).toHaveLength(2);
  });

  test('sorts by period descending', () => {
    const jan: PayslipEntry  = { ...base, id: 'ps-jan', period: '2026-01', netPay: 3500 };
    const mar: PayslipEntry  = { ...base, id: 'ps-mar', period: '2026-03', netPay: 3800 };
    const result = dedupPayslipsByPeriod([jan, mar]);
    expect(result[0].period).toBe('2026-03');
    expect(result[1].period).toBe('2026-01');
  });

  test('handles empty array', () => {
    expect(dedupPayslipsByPeriod([])).toHaveLength(0);
  });
});

describe('buildVarianceSummary', () => {
  test('returns zero totals for empty rows', () => {
    const summary = buildVarianceSummary([]);
    expect(summary.totalDelta).toBe(0);
    expect(summary.totalCombined).toBe(0);
    expect(summary.conflictCount).toBe(0);
  });

  test('sums delta across all rows', () => {
    const rows: VarianceRow[] = [
      { employeeId: 'emp-1', existingNet: 4000, delta: 2000, combinedNet: 6000, hasExisting: true },
      { employeeId: 'emp-2', existingNet: 3500, delta: 1500, combinedNet: 5000, hasExisting: true },
    ];
    const summary = buildVarianceSummary(rows);
    expect(summary.totalDelta).toBe(3500);
    expect(summary.totalCombined).toBe(11000);
    expect(summary.conflictCount).toBe(2);
  });

  test('counts only rows with hasExisting=true as conflicts', () => {
    const rows: VarianceRow[] = [
      { employeeId: 'emp-1', existingNet: 4000, delta: 2000, combinedNet: 6000, hasExisting: true },
      { employeeId: 'emp-new', existingNet: 0, delta: 3000, combinedNet: 3000, hasExisting: false },
    ];
    const summary = buildVarianceSummary(rows);
    expect(summary.conflictCount).toBe(1);
    expect(summary.totalDelta).toBe(5000);
  });

  test('handles single row with no existing payslip', () => {
    const rows: VarianceRow[] = [
      { employeeId: 'emp-1', existingNet: 0, delta: 5000, combinedNet: 5000, hasExisting: false },
    ];
    const summary = buildVarianceSummary(rows);
    expect(summary.totalDelta).toBe(5000);
    expect(summary.conflictCount).toBe(0);
  });
});
