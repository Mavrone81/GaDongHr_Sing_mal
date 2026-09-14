import type { ReactNode } from 'react';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'brass';

const TONE: Record<Tone, string> = {
  neutral: 'bg-pill text-muted',
  ok: 'bg-tint text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-tint text-accent',
  brass: 'bg-brass-soft text-brass-ink', // trials / plans — tokens, so it reads on paper and in the dark console
};

/** Status pill: 24px tall, 12px semibold, never all-caps. */
export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap ${TONE[tone]} ${className}`}>{children}</span>;
}
