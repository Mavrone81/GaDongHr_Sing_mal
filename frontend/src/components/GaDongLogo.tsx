'use client';

import React from 'react';

/* ─────────────────────────────────────────────────────────────────────
   GaDongHR brand mark — inline SVG hexagon logo.

   Rendered inline (rather than the cream-background JPEG) so it sits cleanly
   on the dark chrome. Colours default to the Official Record tokens rather
   than frozen hexes: the mark previously hardcoded #ffffff and #cda64c, the
   latter being gold-400 from the RETIRED 2026 navy/gold palette, and the
   comment still claimed the chrome was navy — it is --shadow, a dark green.
   Using the tokens means the mark follows the theme (including dark mode)
   instead of drifting away from the product around it.

   The shape is unchanged; only the colour source moved. The cream-background
   JPEG lives at /public/gadonghr-logo.jpg and is used only on light grounds.
   ───────────────────────────────────────────────────────────────────── */

export function GaDongMark({
  size = 36,
  stroke = 'var(--paper)',
  accent = 'var(--highlight)',
  className = '',
}: {
  size?: number;
  stroke?: string;
  accent?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* Rounded hexagon outline */}
      <path
        d="M50 7 L86 28 L86 72 L50 93 L14 72 L14 28 Z"
        stroke={stroke}
        strokeWidth="7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Layered downward chevron (the 'V' / hive) */}
      <path
        d="M27 39 L50 60 L73 39"
        stroke={accent}
        strokeWidth="7.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M27 54 L50 75 L73 54"
        stroke={stroke}
        strokeWidth="7.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}

export default function GaDongLogo({
  variant = 'dark',
  showWordmark = true,
  showTagline = true,
  markSize = 36,
  className = '',
}: {
  /** 'dark' = on the --shadow chrome (paper mark) · 'light' = on paper (ink mark) */
  variant?: 'dark' | 'light';
  showWordmark?: boolean;
  showTagline?: boolean;
  markSize?: number;
  className?: string;
}) {
  const onDark = variant === 'dark';
  const stroke = onDark ? 'var(--paper)' : 'var(--ink)';
  const wordColor = onDark ? 'text-paper' : 'text-ink';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <GaDongMark size={markSize} stroke={stroke} accent="var(--highlight)" />
      {showWordmark && (
        <div className="flex flex-col min-w-0 leading-none">
          <span className={`font-black tracking-[0.18em] uppercase ${wordColor}`} style={{ fontSize: markSize * 0.46 }}>
            GaDongHR
          </span>
          {showTagline && (
            <span className="mt-1 text-[8px] font-black tracking-[0.3em] uppercase text-highlight">
              CRM · HR · Payroll
            </span>
          )}
        </div>
      )}
    </div>
  );
}
