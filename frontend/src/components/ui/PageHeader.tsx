import type { ReactNode } from 'react';

/**
 * Every page starts with this: 26px extrabold title, optional 14px subtitle,
 * actions on the right (primary button last). Replaces the old tracked
 * all-caps page titles.
 */
export function PageHeader({ title, subtitle, actions, className = '' }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="flex flex-col gap-1 min-w-0">
        <h1 className="text-[26px] font-extrabold tracking-[-0.02em] leading-[1.1] text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
}
