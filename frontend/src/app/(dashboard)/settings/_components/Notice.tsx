import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui';

export type NoticeTone = 'ok' | 'danger' | 'warn' | 'info';
/** A form's result line: tone carried explicitly, never inferred from a glyph. */
export type NoticeMsg = { tone: NoticeTone; text: string } | null;

const LOOK: Record<NoticeTone, { icon: IconName; colour: string }> = {
  ok: { icon: 'check', colour: 'text-ok' },
  danger: { icon: 'alert', colour: 'text-danger' },
  warn: { icon: 'alert', colour: 'text-warn' },
  info: { icon: 'alert', colour: 'text-muted' },
};

/**
 * Inline result / warning line inside a settings card or drawer (the kit's
 * toast is for transient feedback; this stays next to the form it explains).
 * Icon + wording carry the tone, never colour alone.
 */
export function Notice({ tone = 'info', children, className = '' }: { tone?: NoticeTone; children: ReactNode; className?: string }) {
  const look = LOOK[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-control border border-rule bg-page px-3.5 py-2.5 text-[13px] text-ink ${className}`}
    >
      <Icon name={look.icon} size={16} strokeWidth={2} className={`mt-px ${look.colour}`} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
