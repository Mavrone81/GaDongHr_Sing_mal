/**
 * Every screen under (dashboard), walked — not a hand-listed set.
 *
 * The per-wave guards each listed their own files, which is how the shared
 * chrome kept a dozen sky-400 and violet-500 classes through Task 1: its test
 * checked only indigo/slate/emerald/amber, the four hues the plan happened to
 * name, and the nav icons used none of them. A test that discovers its own
 * subjects cannot be outrun by a screen nobody thought to list.
 *
 * This is also Stage 2's exit criterion, enforced from Wave D onward rather
 * than checked once at the end.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { CARD, LEGACY_HUE, withoutSpinners, spinnerClasses } from './helpers/vocabulary';

const ROOT = join(__dirname, '..', 'src', 'app', '(dashboard)');

function screens(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? screens(full)
      : entry.endsWith('.tsx') ? [full] : [];
  });
}

const FILES = screens(ROOT).map((f) => [f.slice(ROOT.length + 1), readFileSync(f, 'utf8')] as const);

describe('every (dashboard) screen speaks the document vocabulary', () => {
  it('finds screens to check — the walk is not vacuously empty', () => {
    expect(FILES.length).toBeGreaterThan(30);
  });

  it.each(FILES)('%s uses no legacy hue', (_name, src) => {
    expect(src.match(LEGACY_HUE)?.[0] ?? null).toBeNull();
  });

  it.each(FILES)('%s uses no card vocabulary', (_name, src) => {
    expect(withoutSpinners(src).match(CARD)?.[0] ?? null).toBeNull();
  });

  it('the spinner exemption is narrow — it only covers animate-spin', () => {
    const exempted = FILES.flatMap(([, src]) => spinnerClasses(src));
    expect(exempted.every((c) => c.includes('animate-spin'))).toBe(true);
    // and it must not be hiding anything but a radius
    expect(exempted.some((c) => /shadow-(sm|md|lg|xl|2xl)|bg-white/.test(c))).toBe(false);
  });
});

/**
 * Colour can also arrive as raw CSS, where no class-based check can see it.
 *
 * Ten screens carried `border-color: rgb(99 102 241)` — indigo — inside a
 * styled-jsx block. Every class-based guard reported those files clean while
 * they rendered a legacy focus ring, because the colour never appeared as a
 * Tailwind class at all.
 */
const LEGACY_LITERAL =
  /#(?:6366f1|4f46e5|818cf8|e2e8f0|94a3b8|64748b|0f172a|1e293b|f8fafc|475569)\b|rgba?\(\s*99[\s,]+102[\s,]+241|rgba?\(\s*226[\s,]+232[\s,]+240/i;

describe('colour does not sneak in as a raw literal', () => {
  it.each(FILES)('%s uses no hardcoded legacy colour', (_name, src) => {
    expect(src.match(LEGACY_LITERAL)?.[0] ?? null).toBeNull();
  });
});

/**
 * A state map must not have two states that look identical.
 *
 * This is the failure the whole conversion kept producing: many hues mapped
 * onto eight tokens, and states with very different consequences — PENDING vs
 * REJECTED vs CANCELLED, MINOR vs GROSS_MISCONDUCT — silently became the same
 * chip. No type error, no failing test, just a screen that stopped telling
 * the user things apart.
 */
const STATE_MAP =
  /const\s+(\w*(?:STATUS|STATE|STAGE|SEVERITY|PRIORITY|URGENCY|TONE)\w*)\s*(?::[^=]*)?=\s*\{([\s\S]*?)\n\};/g;

describe('state maps keep their states distinguishable', () => {
  /**
   * Two states MAY share a tone deliberately — INTERVIEW_1 and INTERVIEW_2 are
   * the same kind of state and the label tells them apart, as do ACTIVE and
   * DEDUCTED on a loan. What must not happen is the mechanical collapse this
   * conversion kept producing, where a map of eight states rendered as three
   * appearances because many hues folded onto few tokens.
   *
   * So the rule is about DOMINANCE, not uniqueness: no single appearance may
   * cover more than two states, and a map must retain at least half as many
   * appearances as it has states. The real collapses (8 states -> 3 values,
   * one of them used six times) fail both clauses; a considered pairing passes.
   */
  it.each(FILES)('%s has no map dominated by one appearance', (_name, src) => {
    const offenders: string[] = [];
    for (const [, mapName, body] of src.matchAll(STATE_MAP)) {
      const values = [...body.matchAll(/:\s*(?:'([^']*)'|TONES\.(\w+))/g)]
        .map((m) => m[1] ?? m[2])
        .filter((v) => /bg-|text-|border-|^\w+$/.test(v));
      if (values.length < 4) continue;
      const counts = new Map<string, number>();
      values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
      const worst = Math.max(...counts.values());
      if (worst > 2) offenders.push(`${mapName}: one appearance covers ${worst} states`);
      else if (counts.size < Math.ceil(values.length / 2))
        offenders.push(`${mapName}: ${values.length} states, only ${counts.size} appearances`);
    }
    expect(offenders).toEqual([]);
  });
});
