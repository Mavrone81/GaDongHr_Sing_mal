import type { ReactNode } from 'react';

/**
 * Heading for one settings section. The settings layout owns the page's single
 * h1 ("Settings"); each section below it is an h2 with its own actions, so the
 * sub-nav, header and cards read as one area rather than a page per link.
 */
export function SectionHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="text-xl font-extrabold tracking-[-0.01em] text-ink">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5 sm:shrink-0">{actions}</div>}
    </div>
  );
}
