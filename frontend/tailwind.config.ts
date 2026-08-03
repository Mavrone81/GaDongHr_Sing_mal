import type { Config } from 'tailwindcss';

/* ─────────────────────────────────────────────────────────────────────
   GaDongHR Brand Palette — 2026 Rebrand (Navy · Gold · Cream)
   ─────────────────────────────────────────────────────────────────────
   The product was built with `indigo` as the brand-primary hue, used
   across ~70 pages. Rather than hand-edit every file, we REMAP Tailwind's
   `indigo` scale onto deep navy so every existing `bg-indigo-600`,
   `text-indigo-400`, `shadow-indigo-500/x`, etc. renders in the new brand
   colour automatically. A handful of `slate` steps are warmed toward
   cream/navy so page backgrounds and headline text match the brochure.
   New `gold` / `cream` palettes are added for accents and surfaces.
   Semantic status hues (emerald/amber/red/sky/violet) are left untouched.
   ───────────────────────────────────────────────────────────────────── */

const navy = {
  50:  '#eef2f8',
  100: '#d8e2f0',
  200: '#aec1de',
  300: '#7d9bc4',
  400: '#4d6fa3',
  500: '#2b4a7d',
  600: '#1c3a66', // brand primary
  700: '#162d50',
  800: '#11233f',
  900: '#0c1a30',
  950: '#0a1628', // dark surfaces / sidebar
};

const gold = {
  50:  '#faf6ec',
  100: '#f3e8cd',
  200: '#e8d3a0',
  300: '#dcbd72',
  400: '#cda64c',
  500: '#b8893d', // accent
  600: '#9c7132',
  700: '#7c592a',
  800: '#5f4423',
  900: '#4a361e',
};

const cream = {
  50:  '#fbf9f3',
  100: '#f7f3ea', // page background
  200: '#efe8d8',
  300: '#e4d9c2',
};

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Official Record — GaDong house design system ──────────────
        // Eight tokens. --seal is RESERVED for authority citations and is
        // enforced by frontend/__tests__/seal-reservation.test.ts.
        paper:     '#FCFBF7',
        ink:       '#171614',
        rule:      '#DBD5C6',
        seal:      '#A8322A',
        accent:    '#1B4A3C',
        highlight: '#C08A3E',
        muted:     '#6E685C',
        shadow:    '#102A22',
        page:      '#F2F1EC',

        // The 2026 `indigo: navy` remap is RETIRED, not repointed. It made
        // brand colour arrive through a class named "indigo" — a lie in the
        // config. Un-converted screens therefore render Tailwind's default
        // indigo until Stage 2 moves them onto the tokens above, which makes
        // remaining work visible rather than hiding it behind a plausible skin.
        navy,
        gold,
        cream,
        // Warm a few slate steps so backgrounds/headlines match the brochure
        // while leaving the mid neutrals (200–800) as legible cool greys.
        slate: {
          50:  '#f7f3ea', // page background → cream
          100: '#efe9dc', // soft surfaces → warm off-white
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#112440', // primary text / headlines → deep navy
          950: '#0a1628', // deepest surfaces → navy
        },
      },
      fontSize: {
        '2xs': '0.65rem',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        primary: 'var(--shadow-primary)',
      },
    },
  },
  plugins: [],
};
export default config;
