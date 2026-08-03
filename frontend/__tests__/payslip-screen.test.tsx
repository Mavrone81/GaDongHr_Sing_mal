/**
 * The payslip is the reference implementation for the whole conversion.
 *
 * A payslip is exactly the artefact the Official Record system was built for: a
 * figure someone may one day have to defend to an auditor, an employee, or the
 * CPF Board. Every later screen copies the recipe established here, so it is
 * pinned harder than the screens that follow.
 *
 * NOTE ON THE FILE PATH — the plan named `payroll/me/page.tsx`, but that file
 * was a 7-line re-export; the actual view lived inside the 2,048-line
 * `payroll/page.tsx`. It has been extracted to its own module so the screen can
 * be asserted (and read) in isolation, and so Task 3's conversion of the admin
 * dashboard cannot silently regress it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SCREEN = readFileSync(
  join(__dirname, '..', 'src', 'app', '(dashboard)', 'payroll', 'EmployeePayslipsView.tsx'),
  'utf8',
);

describe('payslip screen', () => {
  it('uses the Official Record primitives', () => {
    expect(SCREEN).toMatch(/from '@\/components\/official'/);
  });

  // Conversion is "use the component", never "invent the markup" — a hand-rolled
  // <table> here would be copied into 73 more screens before anyone noticed.
  it('renders the payslip rows through DataTable, not a hand-rolled table', () => {
    expect(SCREEN).toMatch(/<DataTable/);
    expect(SCREEN).not.toMatch(/<table/);
  });

  it('cites the statutory authority for CPF', () => {
    expect(SCREEN).toMatch(/Seal[\s\S]{0,120}CPF Act/);
  });

  it('carries the form number in an eyebrow', () => {
    expect(SCREEN).toMatch(/eyebrow[\s\S]{0,200}IR8A/);
  });

  it('uses no card vocabulary', () => {
    expect(SCREEN).not.toMatch(/rounded-(lg|xl|2xl|full|\[)|shadow-(sm|md|lg|xl|2xl)|bg-white/);
  });

  it('uses no legacy palette', () => {
    expect(SCREEN).not.toMatch(/indigo-|slate-[0-9]|emerald-|amber-/);
  });

  /**
   * Bulk download was hidden behind `filtered.length > 0`. A blocked action
   * stays visible with its reason — the user should learn "nothing to download
   * yet", not that the feature does not exist.
   */
  it('disables the bulk download rather than hiding it', () => {
    expect(SCREEN).toMatch(/reason=/);
  });

  // The re-export must keep pointing somewhere real, or the route 404s at build.
  it('is what the /payroll/me route renders', () => {
    const route = readFileSync(
      join(__dirname, '..', 'src', 'app', '(dashboard)', 'payroll', 'me', 'page.tsx'),
      'utf8',
    );
    expect(route).toMatch(/EmployeePayslipsView/);
    expect(route).not.toMatch(/from '\.\.\/page'/);
  });
});
