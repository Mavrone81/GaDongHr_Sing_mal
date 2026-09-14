/**
 * Stricter rules for screens that have been rebuilt to the 2026-09 redesign.
 *
 * The vocabulary guard (hues, radii, shadows) runs on every file. This one
 * runs only on paths listed in helpers/migrated.ts, because legacy screens
 * still carry the old 8–11px eyebrows until their batch lands. A batch adds
 * its routes to MIGRATED in the same commit that rebuilds them.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { MIGRATED } from './helpers/migrated';

const ROOT = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const FILES = walk(ROOT)
  .map((f) => f.slice(ROOT.length + 1))
  .filter((rel) => MIGRATED.some((p) => rel === p || rel.startsWith(p)))
  .map((rel) => [rel, readFileSync(join(ROOT, rel), 'utf8')] as const);

/** Tailwind arbitrary sizes under 12px: text-[8px], text-[10.5px], text-[11px]… */
const SUB_12 = /\btext-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/;
/** Legacy micro-type classes and the 10.4px 2xs step. */
const LEGACY_TYPE = /\btext-2xs\b|["'\s](?:eyebrow|eyebrow-tight|label-form|panel-header|badge(?:-(?:danger|warning|success|primary|accent|neutral))?)["'\s]/;
/** Geometric dingbats and emoji used as icons in the old chrome. */
const DINGBAT = /[■-◿⬀-⯿←-⇿☀-➿]|[\u{1F300}-\u{1FAFF}]/u;
/** Old chrome copy that must not come back. */
const MARKETING = /Enterprise Intelligence|Command Cent(?:re|er)|Terminate Session|Initialize Session|Secure Portal Entry|Military-Grade/i;

describe('redesign guard covers something', () => {
  it('finds migrated files', () => {
    expect(FILES.length).toBeGreaterThan(5);
  });
});

describe('migrated screens keep to the redesign floor', () => {
  it.each(FILES)('%s has no text below 12px', (_name, src) => {
    expect(src.match(SUB_12)?.[0] ?? null).toBeNull();
  });

  it.each(FILES)('%s uses no legacy micro-type classes', (_name, src) => {
    expect(src.match(LEGACY_TYPE)?.[0] ?? null).toBeNull();
  });

  it.each(FILES)('%s uses Icon, not dingbats or emoji', (_name, src) => {
    // Allow the ⌘ glyph in keyboard hints and arrows/ellipsis/dashes in copy.
    const stripped = src.replace(/⌘|…|—|–|←|→|·|•/g, '');
    expect(stripped.match(DINGBAT)?.[0] ?? null).toBeNull();
  });

  it.each(FILES)('%s carries no old marketing copy', (_name, src) => {
    expect(src.match(MARKETING)?.[0] ?? null).toBeNull();
  });

  it.each(FILES)('%s never removes focus without a replacement', (_name, src) => {
    // outline-none is allowed only where a ring, a focus border, a focus-within
    // treatment on the wrapper, or an invisible (opacity-0) proxy input carries focus
    const bad = [...src.matchAll(/outline-none/g)].filter((m) => {
      const around = src.slice(Math.max(0, m.index! - 800), m.index! + 400);
      return !/ring-|focus:border|focus-within|opacity-0/.test(around);
    });
    expect(bad.length).toBe(0);
  });
});
