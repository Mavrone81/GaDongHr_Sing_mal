import type { HTMLAttributes, ReactNode } from 'react';

/** White surface, 1px rule border, 12px radius, 20/22px padding. */
export function Card({ className = '', padding = 'p-5', children, ...rest }: { padding?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex flex-col bg-paper border border-rule rounded-card shadow-card ${padding} ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** Title row for a card: 15.5px bold title, optional caption, optional action on the right. */
export function CardHeader({ title, caption, action, className = '' }: { title: ReactNode; caption?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-start justify-between gap-3 ${caption ? 'mb-3' : 'mb-2'} ${className}`}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="text-[15.5px] font-bold text-ink">{title}</div>
        {caption && <div className="text-[13px] text-muted">{caption}</div>}
      </div>
      {action && <div className="text-[13px] font-semibold text-accent whitespace-nowrap">{action}</div>}
    </div>
  );
}
