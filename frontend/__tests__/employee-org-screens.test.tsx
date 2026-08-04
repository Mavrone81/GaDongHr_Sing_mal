/**
 * Wave C — employee and org.
 *
 * These screens hold the record of the person: the employment terms, the work
 * pass, the notice period, the exit. The statutory content is thinner than
 * payroll's but sharper — a wrong notice period is a wrongful-dismissal claim.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..', 'src', 'app', '(dashboard)');
const read = (...p: string[]) => readFileSync(join(dir, ...p), 'utf8');

const EMPLOYEES = read('employees', 'page.tsx');
const EMPLOYEE_DETAIL = read('employees', '[id]', 'page.tsx');
const STAFF = read('staff', 'page.tsx');
const MOVEMENTS = read('movements', 'page.tsx');
const MOVEMENT_DETAIL = read('movements', '[id]', 'page.tsx');
const OFFBOARDING = read('offboarding', 'page.tsx');

const SCREENS: [string, string][] = [
  ['employees', EMPLOYEES],
  ['employee detail', EMPLOYEE_DETAIL],
  ['staff', STAFF],
  ['movements', MOVEMENTS],
  ['movement detail', MOVEMENT_DETAIL],
  ['offboarding', OFFBOARDING],
];

describe.each(SCREENS)('%s speaks the document vocabulary', (_name, src) => {
  it('uses no card vocabulary', () => {
    expect(src).not.toMatch(/rounded-(lg|xl|2xl|3xl|full)|shadow-(sm|md|lg|xl|2xl)|bg-white/);
  });

  it('uses no legacy palette', () => {
    expect(src).not.toMatch(/indigo-|slate-[0-9]|emerald-|amber-/);
  });

  it('uses no semantic colour outside the eight tokens', () => {
    expect(src).not.toMatch(/-(red|rose|yellow|orange|green|blue|sky|violet|purple|pink)-[0-9]/);
  });

  it('uses the Official Record tokens', () => {
    expect(src).toMatch(/bg-paper|text-ink|border-rule|text-muted/);
  });
});

describe('offboarding cites the notice period', () => {
  it('uses the Official Record primitives', () => {
    expect(OFFBOARDING).toMatch(/from '@\/components\/official'/);
  });

  /**
   * s.10 sets notice by length of service and — critically — requires it to be
   * the SAME either way. A notice period entered here that is below the floor
   * is a wrongful-dismissal claim, so the rule sits beside the input rather
   * than in a policy document nobody opens.
   */
  it('cites EA s.10 beside the notice period', () => {
    expect(OFFBOARDING).toMatch(/EA s\.10/);
  });
});
