import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'brass';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-pill text-muted',
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  accent: 'bg-tint text-accent',
  brass: 'bg-brass-bg text-brass-fg', // trials / plans
};

/** Status pill: 24px tall, 12px semibold, never all-caps. Grounds are tokens, so they follow the theme. */
export function Badge({ tone = 'neutral', children, className = '' }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap ${TONE[tone]} ${className}`}>{children}</span>;
}
