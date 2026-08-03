/**
 * Formatting shared by the payroll screens.
 *
 * Extracted so `EmployeePayslipsView` does not have to import from `page.tsx`.
 * Importing one route module from another works, but it drags the whole admin
 * dashboard into the employee bundle and reads as a mistake.
 */

export function fmtSGD(n: number) {
  return n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPeriod(period: string) {
  const [y, m] = period.split('-');
  const d = new Date(parseInt(y), parseInt(m) - 1);
  return d.toLocaleString('en-SG', { month: 'long', year: 'numeric' });
}
