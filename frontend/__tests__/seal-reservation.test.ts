/**
 * "Reserve one colour for one meaning."
 *
 * The design document asks for this as a TEST, not a convention, having watched
 * its own rule erode within hours of being written down:
 *
 *   "Enforce it with a lint rule or a test — it will erode within a month
 *    otherwise, and ours did within hours of being written down."
 *
 * Seal red (#A8322A) marks an authority citation and nothing else. Never an
 * error, never a destructive action, never a validation failure. The instant it
 * appears on a delete button, the citation stops reading as special and the
 * whole language collapses into decoration.
 *
 * If this test fails, fix the SCREEN — never the test.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');

/** Where the token is legitimately allowed to appear. */
const ALLOWED = [
  'components/official/Seal.tsx', // the component itself
  'app/globals.css',              // where the token is DEFINED
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? sourceFiles(full)
      : /\.(tsx?|css)$/.test(entry) ? [full] : [];
  });
}

const USES_SEAL = /var\(--seal\)|\bborder-seal\b|\btext-seal\b|\bbg-seal\b|#A8322A/i;

describe('the seal token is reserved for authority citations', () => {
  it('appears only in Seal.tsx and the token definition', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !ALLOWED.some((a) => f.replace(/\\/g, '/').endsWith(a)))
      .filter((f) => USES_SEAL.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it('the Seal component does use it — the test is not vacuous', () => {
    const seal = readFileSync(join(SRC, 'components', 'official', 'Seal.tsx'), 'utf8');
    expect(USES_SEAL.test(seal)).toBe(true);
  });
});
