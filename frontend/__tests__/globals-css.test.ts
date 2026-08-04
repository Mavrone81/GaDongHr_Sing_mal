/**
 * globals.css — the file that had no guard at all.
 *
 * Every other check in this suite reads .tsx. That left the stylesheet as a
 * blind spot, and it was hiding the single largest defect of the rebrand:
 *
 *   :root { --accent: var(--gold-500); }
 *
 * declared AFTER the Official Record tokens and therefore winning the cascade.
 * Five waves of conversion had been painting `bg-accent` everywhere while it
 * resolved to gold rather than the intended #1B4A3C. It was also still setting
 * `body { @apply bg-slate-50 text-slate-900 }` — the whole page ground.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const CSS = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

/** Declarations, not the prose in comments. */
const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('globals.css', () => {
  it('defines every Official Record token as a literal colour', () => {
    const base = code.match(/:root\s*\{[\s\S]*?\}/)?.[0] ?? '';
    const missing = ['--paper', '--ink', '--rule', '--seal', '--accent', '--muted', '--shadow', '--page']
      .filter((token) => !new RegExp(`${token}\\s*:\\s*#[0-9A-Fa-f]{3,8}`).test(base));
    expect(missing).toEqual([]);
  });

  it('never repoints a token at the retired brand palette', () => {
    expect(code).not.toMatch(/--(?:accent|ink|paper|rule|muted|page|shadow|highlight)\s*:\s*var\(--(?:gold|navy|cream|slate|indigo|emerald|amber|red)-/);
  });

  it('defines no legacy palette variables', () => {
    expect(code).not.toMatch(/--(?:gold|navy|cream|slate|indigo|emerald|amber|red|rose|sky|violet)-\d{2,3}\s*:/);
  });

  it('grounds the page on the tokens, not on a legacy hue', () => {
    const body = code.match(/body\s*\{[\s\S]*?\}/)?.[0] ?? '';
    expect(body).toMatch(/bg-page/);
    expect(body).toMatch(/text-ink/);
    expect(body).not.toMatch(/slate|white|indigo/);
  });

  it('references no variable it does not define', () => {
    const defined = new Set([...code.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]));
    const used = new Set([...code.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
    expect([...used].filter((u) => !defined.has(u))).toEqual([]);
  });
});
