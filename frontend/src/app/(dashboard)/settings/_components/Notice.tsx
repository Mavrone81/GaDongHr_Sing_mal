import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui';

type Tone = 'ok' | 'danger' | 'warn' | 'info';

const LOOK: Record<Tone, { icon: IconName; colour: string }> = {
  ok: { icon: 'check', colour: 'text-ok' },
  danger: { icon: 'alert', colour: 'text-danger' },
  warn: { icon: 'alert', colour: 'text-warn' },
  info: { icon: 'alert', colour: 'text-muted' },
};

/**
 * Inline result / warning line for settings forms.
 *
 * The page handlers build their messages with a leading "✓" or "✗" and style
 * off `startsWith('✓')`. That logic stays untouched; this strips the glyph for
 * display and shows the matching icon instead (no dingbats on screen), so the
 * tone is carried by icon + wording, never colour alone.
 */
export function Notice({ tone, children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  const text = typeof children === 'string' ? children.replace(/^[✓✗]\s*/, '') : children;
  const inferred: Tone = tone ?? (typeof children === 'string' && children.startsWith('✓') ? 'ok'
    : typeof children === 'string' && children.startsWith('✗') ? 'danger' : 'info');
  const look = LOOK[inferred];
  return (
    <div
      role={inferred === 'danger' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-control border border-rule bg-page px-3.5 py-2.5 text-[13px] text-ink ${className}`}
    >
      <Icon name={look.icon} size={16} strokeWidth={2} className={`mt-px ${look.colour}`} />
      <div className="min-w-0">{text}</div>
    </div>
  );
}
