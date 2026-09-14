import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui';

/**
 * Small record-screen pieces shared by the employee, movement and succession
 * pages. Anything a second batch needs should move up into components/ui.
 */

/**
 * One label/value line inside a record card: muted label left, semibold value
 * right, hairline between rows. Stack several in a Card; the first row's top
 * rule is dropped so the card header sits clean.
 */
export function KeyValue({ label, value, tone, className = '' }: {
  label: ReactNode; value: ReactNode; tone?: 'danger' | 'warn' | 'ok' | 'accent' | 'muted'; className?: string;
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok'
    : tone === 'accent' ? 'text-accent' : tone === 'muted' ? 'text-muted' : 'text-ink';
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2.5 border-t border-rule first:border-t-0 text-[13.5px] ${className}`}>
      <span className="text-muted shrink-0">{label}</span>
      <span className={`font-semibold text-right min-w-0 break-words ${toneClass}`}>{value}</span>
    </div>
  );
}

/** Label above value — for dense grids (review panels, timelines). */
export function Detail({ label, value, className = '' }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 min-w-0 ${className}`}>
      <span className="text-[12.5px] font-semibold text-muted">{label}</span>
      <span className="text-sm text-ink break-words">{value}</span>
    </div>
  );
}

/** Inline loading spinner. */
export function Spinner({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin ${className}`} />;
}

/** Full-area loading state for a page body. */
export function PageLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 min-h-[320px] text-sm text-muted">
      <Spinner className="text-accent" />{label}
    </div>
  );
}

/** A message box for an error or a notice. The words carry the meaning; tone only supports it. */
export function Notice({ tone = 'neutral', title, children, className = '' }: {
  tone?: 'neutral' | 'danger' | 'warn' | 'ok' | 'accent'; title?: ReactNode; children?: ReactNode; className?: string;
}) {
  const box = tone === 'danger' ? 'bg-danger-bg text-danger'
    : tone === 'warn' ? 'bg-warn-bg text-warn'
    : tone === 'ok' ? 'bg-ok-bg text-ok'
    : tone === 'accent' ? 'bg-tint text-accent'
    : 'bg-pill text-ink';
  return (
    <div role={tone === 'danger' ? 'alert' : undefined} className={`rounded-control px-4 py-3 text-[13.5px] ${box} ${className}`}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={title ? 'mt-0.5 text-ink' : ''}>{children}</div>}
    </div>
  );
}

/** The kit's initials Avatar, or the person's photo when there is one. */
export function PersonAvatar({ name, photoUrl, size = 32 }: { name: string; photoUrl?: string | null; size?: number }) {
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt="" width={size} height={size} className="rounded-full object-cover shrink-0 bg-pill" style={{ width: size, height: size }} />;
  }
  return <Avatar name={name} size={size} tone="soft" />;
}
