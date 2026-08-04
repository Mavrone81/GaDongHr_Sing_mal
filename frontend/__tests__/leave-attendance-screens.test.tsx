/**
 * Wave B — leave and attendance.
 *
 * These screens are where the Employment Act's floors actually bind: annual
 * leave, sick leave, and the overtime multiplier. A floor is not a house policy
 * — an employer cannot agree its way below it — so the figures carry the
 * section that sets them.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { CARD, withoutSpinners } from './helpers/vocabulary';

const dir = join(__dirname, '..', 'src', 'app', '(dashboard)');
const read = (...p: string[]) => readFileSync(join(dir, ...p), 'utf8');

const LEAVE = read('leave', 'page.tsx');
const LEAVE_REGISTRY = read('leave', 'registry', 'page.tsx');
const ATTENDANCE = read('attendance', 'page.tsx');
const ATTENDANCE_REGISTRY = read('attendance', 'registry', 'page.tsx');
const SCHEDULE = read('attendance', 'schedule', 'page.tsx');

const SCREENS: [string, string][] = [
  ['leave', LEAVE],
  ['leave registry', LEAVE_REGISTRY],
  ['attendance', ATTENDANCE],
  ['attendance registry', ATTENDANCE_REGISTRY],
  ['attendance schedule', SCHEDULE],
];

describe.each(SCREENS)('%s speaks the document vocabulary', (_name, src) => {
  it('uses no card vocabulary', () => {
    expect(withoutSpinners(src)).not.toMatch(CARD);
  });

  it('uses no legacy palette', () => {
    expect(src).not.toMatch(/indigo-|slate-[0-9]|emerald-|amber-/);
  });

  it('uses no semantic colour outside the eight tokens', () => {
    expect(src).not.toMatch(/-(red|rose|yellow|orange|green|blue|sky|violet|purple)-[0-9]/);
  });

  it('uses the Official Record tokens', () => {
    expect(src).toMatch(/bg-paper|text-ink|border-rule|text-muted/);
  });
});

describe('leave cites the Employment Act floors', () => {
  it('uses the Official Record primitives', () => {
    expect(LEAVE).toMatch(/from '@\/components\/official'/);
  });

  // s.43 sets annual leave at 7 days minimum in the first year; s.89 sets
  // 14 days outpatient sick leave. Both are floors, not defaults.
  it('cites the annual and sick leave floors', () => {
    expect(LEAVE).toMatch(/EA s\.43/);
    expect(LEAVE).toMatch(/EA s\.89/);
  });
});

/**
 * The overtime seal belongs on the REGISTRY, not on `attendance/page.tsx`.
 *
 * The plan assigned `EA s.38 · 1.5x` to the attendance area without saying which
 * screen. `attendance/page.tsx` is the clock-in/clock-out screen and shows no
 * overtime at all — `otHours` is rendered only by the registry. Sealing the
 * clock-in screen would have cited a rate for a figure that is not on it.
 */
describe('the attendance registry cites the overtime multiplier', () => {
  it('uses the Official Record primitives', () => {
    expect(ATTENDANCE_REGISTRY).toMatch(/from '@\/components\/official'/);
  });

  it('cites the 1.5x overtime rate', () => {
    expect(ATTENDANCE_REGISTRY).toMatch(/EA s\.38/);
  });

  it('does not seal the clock-in screen, which shows no overtime', () => {
    expect(ATTENDANCE).not.toMatch(/EA s\.38/);
  });
});
