import type { ReactNode } from 'react';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'brass';

const TONE: Record<Tone, string> = {
  neutral: 'bg-pill text-muted',
  ok: 'bg-tint text-ok',
  warn: 'bg-[#FFF4E5] text-warn',
  danger: 'bg-[#FEEDEA] text-danger',
  accent: 'bg-tint text-accent',
  brass: 'bg-[#F7EEDD] text-[#8A6425]', // trials / plans — dark brass text so it reads on paper
};

/** Status pill: 24px tall, 12px semibold, never all-caps. */
export function Badge({ tone = 'neutral', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap ${TONE[tone]} ${className}`}>{children}</span>;
}
