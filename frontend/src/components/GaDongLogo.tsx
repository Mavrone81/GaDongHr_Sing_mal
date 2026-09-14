'use client';

import React, { useId } from 'react';

/* ─────────────────────────────────────────────────────────────────────
   GaDongHR brand mark — the CARAPACE mark, shared with GaDongHR Thailand.

   Ported from the Thailand web app (Mavrone81/GaDongHR,
   web/src/components/CarapaceMark.tsx) so both GaDongHR products carry
   one identical logo. Keep the geometry in step with that file: a rounded
   hexagonal shell with seven scutes — three down the centre, two flanking
   pairs. A shell, not a turtle: no head, legs or eyes.

   Colours map one-to-one onto Thailand's tokens, which hold the same
   values in this app's palette:
     Thailand --carapace-shadow  = --shadow     #102A22
     Thailand --paper            = --paper      #FCFBF7
     Thailand --brass            = --highlight  #C08A3E

   Tones:
     'reversed' (default) — paper rim, brass scutes on a dark shell. The
                            chosen form; looks right on any ground.
     'ink'                — same drawing in currentColor on a paper shell,
                            for light or printed contexts.
   ───────────────────────────────────────────────────────────────────── */

/** Vertex-up hexagon stretched on x/y; corners rounded by strokeLinejoin. */
function hexPoints(cx: number, cy: number, rx: number, ry: number): string {
  return [-90, -30, 30, 90, 150, 210]
    .map((deg) => {
      const rad = (deg * Math.PI) / 180;
      return `${(cx + rx * Math.cos(rad)).toFixed(1)},${(cy + ry * Math.sin(rad)).toFixed(1)}`;
    })
    .join(' ');
}

const OUTER_RIM = hexPoints(50, 50, 38, 44);

const SCUTES: readonly string[] = [
  hexPoints(50, 27, 15, 13), // centre — top
  hexPoints(50, 50, 15, 13), // centre — middle
  hexPoints(50, 73, 15, 13), // centre — bottom
  hexPoints(27, 36, 13, 12), // upper pair — left
  hexPoints(73, 36, 13, 12), // upper pair — right
  hexPoints(27, 64, 13, 12), // lower pair — left
  hexPoints(73, 64, 13, 12), // lower pair — right
];

/** Thicker linework at small sizes so the scutes stay legible. */
function strokeWidthFor(size: number): number {
  if (size <= 24) return 4.5;
  if (size <= 40) return 3.5;
  return 2.5;
}

export function GaDongMark({
  size = 36,
  tone = 'reversed',
  title = 'GaDongHR',
  className = '',
}: {
  size?: number;
  tone?: 'reversed' | 'ink';
  title?: string;
  className?: string;
}) {
  const titleId = useId();
  const reversed = tone === 'reversed';
  const sw = strokeWidthFor(size);

  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <title id={titleId}>{title}</title>
      <polygon
        points={OUTER_RIM}
        fill={reversed ? 'var(--shadow)' : 'var(--paper)'}
        stroke={reversed ? 'var(--paper)' : 'currentColor'}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      {SCUTES.map((points) => (
        <polygon
          key={points}
          points={points}
          fill="none"
          stroke={reversed ? 'var(--highlight)' : 'currentColor'}
          strokeWidth={sw * 0.65}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/**
 * Mark + two-tone wordmark — the same lockup as Thailand's sign-in page:
 * "GaDong" in the ground's text colour, "HR" in brass.
 */
export default function GaDongLogo({
  variant = 'dark',
  showWordmark = true,
  markSize = 36,
  className = '',
}: {
  /** 'dark' = on a dark ground (paper "GaDong") · 'light' = on paper (ink "GaDong") */
  variant?: 'dark' | 'light';
  showWordmark?: boolean;
  markSize?: number;
  className?: string;
}) {
  const onDark = variant === 'dark';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <GaDongMark size={markSize} />
      {showWordmark && (
        <span
          className="leading-none font-bold whitespace-nowrap"
          style={{ fontSize: Math.round(markSize * 0.58), letterSpacing: '-0.01em' }}
        >
          <span className={onDark ? 'text-paper' : 'text-ink'}>GaDong</span>
          <span className="text-highlight">HR</span>
        </span>
      )}
    </div>
  );
}
