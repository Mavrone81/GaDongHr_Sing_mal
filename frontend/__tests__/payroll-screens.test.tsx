/**
 * Wave A — the payroll area.
 *
 * The admin payroll dashboard is the largest screen in the product and the
 * densest in statutory figures: CPF, SDL, FWL, GIRO and the IRAS deadlines. It
 * is also where the seal earns its keep — every number here is one an employer
 * may have to defend to the CPF Board or IRAS.
 *
 * Asserted at source level rather than by rendering: these screens pull in auth
 * context, seven modals and a dozen fetches, so mounting them would test the
 * harness rather than the design.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { CARD, withoutSpinners } from './helpers/vocabulary';

const dir = join(__dirname, '..', 'src', 'app', '(dashboard)', 'payroll');
const ADMIN = readFileSync(join(dir, 'page.tsx'), 'utf8');
const IRAS = readFileSync(join(dir, 'iras-submissions', 'page.tsx'), 'utf8');

const SCREENS: [string, string][] = [
  ['admin payroll dashboard', ADMIN],
  ['IRAS submissions', IRAS],
];

describe.each(SCREENS)('%s speaks the document vocabulary', (_name, src) => {
  it('uses no card vocabulary', () => {
    expect(withoutSpinners(src)).not.toMatch(CARD);
  });

  it('uses no legacy palette', () => {
    expect(src).not.toMatch(/indigo-|slate-[0-9]|emerald-|amber-/);
  });

  /**
   * Red, rose and yellow were carrying meaning on these screens — a failed run,
   * an overdue filing. The system has no error colour, and seal red is reserved,
   * so that meaning has to survive as words. If red comes back, the words are
   * about to become decoration again.
   */
  it('uses no semantic colour outside the eight tokens', () => {
    expect(src).not.toMatch(/-(red|rose|yellow|orange|green|blue|sky|violet|purple)-[0-9]/);
  });

  it('uses the Official Record tokens', () => {
    expect(src).toMatch(/bg-paper|text-ink|border-rule|text-muted/);
  });
});

describe('the payroll dashboard cites its statutory authorities', () => {
  it('uses the Official Record primitives', () => {
    expect(ADMIN).toMatch(/from '@\/components\/official'/);
  });

  // The employer-facing screen is where the SDL seal belongs — it was
  // deliberately left off the employee payslip, SDL being an employer levy.
  it('seals the SDL levy', () => {
    expect(ADMIN).toMatch(/SDL Act/);
  });

  it('seals the CPF contribution', () => {
    expect(ADMIN).toMatch(/CPF Act/);
  });

  it('seals the EA s.20 working-day basis used for pro-rating', () => {
    expect(ADMIN).toMatch(/EA s\.20/);
  });
});

describe('IRAS submissions cite their filing deadlines', () => {
  it('uses the Official Record primitives', () => {
    expect(IRAS).toMatch(/from '@\/components\/official'/);
  });

  // A deadline the user misses is a penalty; the date belongs on the screen
  // beside the authority that sets it, not in a help article.
  it('names the IR8A filing deadline', () => {
    expect(IRAS).toMatch(/ITA s\.68|1 Mar/);
  });
});
