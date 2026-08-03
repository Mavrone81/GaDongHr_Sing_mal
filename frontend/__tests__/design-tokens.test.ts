/**
 * The Official Record token set — GaDong's house design system.
 *
 * Eight values. The discipline is not the palette, it is the RESERVATION:
 * --seal means exactly one thing (an authority citation) and appears nowhere
 * else. That rule is enforced separately in seal-reservation.test.ts.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const CSS = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

const TOKENS: Record<string, string> = {
  '--paper': '#FCFBF7',
  '--ink': '#171614',
  '--rule': '#DBD5C6',
  '--seal': '#A8322A',
  '--accent': '#1B4A3C',
  '--highlight': '#C08A3E',
  '--muted': '#6E685C',
  '--shadow': '#102A22',
};

describe('Official Record tokens', () => {
  it.each(Object.entries(TOKENS))('%s is %s', (name, hex) => {
    const pattern = new RegExp(`${name}\\s*:\\s*${hex}`, 'i');
    expect(CSS).toMatch(pattern);
  });

  /**
   * The 2026 rebrand aliased Tailwind's indigo scale so brand colour arrived
   * through a class named "indigo". Keeping that here would deliver Official
   * Record colours under a false name — a lie in the config that makes every
   * subsequent reader distrust it.
   */
  it('no longer defines indigo aliases', () => {
    expect(CSS).not.toMatch(/--indigo-/);
  });

  /**
   * Thai marks sit above and below the baseline. At Latin leading they clip —
   * illegible to a native reader, invisible to everyone testing in English.
   * The acquirer is a Thai company, so this costs one line and prevents a bug
   * nobody here would catch.
   */
  it('sets looser leading for Thai', () => {
    expect(CSS).toMatch(/:lang\(th\)[\s\S]{0,80}line-height:\s*1\.85/);
  });
});
