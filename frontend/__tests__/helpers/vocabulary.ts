/**
 * One definition of the Official Record vocabulary rules, shared by every
 * guard test.
 *
 * These lived separately in each per-wave test, which is how they drifted: the
 * Task 1 chrome guard checked only indigo/slate/emerald/amber — the four hues
 * the plan happened to name — and so kept a dozen sky-400 and violet-500
 * classes in the shared layout through three waves. A rule with one home cannot
 * drift between the screens that enforce it.
 */

/** Any Tailwind hue that is not one of the Official Record tokens. */
export const LEGACY_HUE =
  /\b(?:bg|text|border|ring|divide|from|via|to|accent|fill|stroke|shadow|placeholder|caret|outline)(?:-[tblrxyse])?-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|navy|gold|cream)-\d{2,3}\b/;

/**
 * Ad-hoc surface vocabulary.
 *
 * 2026-09 redesign: cards ARE rounded now (12px) and controls too (8px), but
 * only through the named radii `rounded-card` / `rounded-control`, plus
 * `rounded-full` for pills and avatars, and the single `shadow-card`. What
 * stays forbidden is the Tailwind scale of arbitrary radii and shadows — that
 * is how surfaces drift from the system one class at a time — and `bg-white`,
 * because the surface colour is `bg-paper` (it follows the theme; white does not).
 */
export const CARD =
  /\brounded-(?:sm|md|lg|xl|2xl|3xl)\b|\bshadow-(?:sm|md|lg|xl|2xl|primary|soft|glow)\b|\bbg-white\b/;

const SPINNER_CLASSES = /className=(["'`])[^"'`]*animate-spin[^"'`]*\1/g;

/**
 * Drop spinner class strings before checking card vocabulary.
 *
 * "Nothing but buttons and seals is rounded" is a rule about CARDS — it exists
 * so surfaces stop looking like floating tiles. A loading spinner is a circle
 * because it rotates, and stripping its radius makes it a spinning square,
 * which is what happened to 58 of them during the mechanical conversion.
 *
 * The exemption is deliberately narrow: only strings carrying `animate-spin`,
 * and `spinnerClasses` is exported so a test can prove the loophole has not
 * widened into a way of smuggling shadows back in.
 */
export const withoutSpinners = (src: string) => src.replace(SPINNER_CLASSES, '');

export const spinnerClasses = (src: string) => src.match(SPINNER_CLASSES) ?? [];
