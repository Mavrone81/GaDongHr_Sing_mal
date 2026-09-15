'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

const WIDE = '(min-width: 1280px)';
const isWide = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches;

/**
 * Approvals / inbox layout: list on the left, detail on the right at ≥1280px.
 * Below that, the list shows until something is selected, then the detail
 * takes over with a back control (`onBack`).
 *
 * Focus is managed so keyboard users never land on <body>:
 *  - below 1280px, opening the detail moves focus to it and scrolls it into view;
 *  - closing the detail (Back, or the item disappearing after Approve) returns
 *    focus to the row that opened it, or to the list if that row is gone.
 * At ≥1280px both panes are visible, so opening leaves focus on the row.
 */
export function SplitPane({ list, detail, hasDetail, onBack, backLabel = 'Back to list', className = '' }: {
  list: ReactNode; detail: ReactNode; hasDetail: boolean; onBack: () => void; backLabel?: string; className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const was = useRef(hasDetail);

  // Render-time capture: the row that opened the detail still has focus here,
  // before the list is hidden on narrow screens.
  if (hasDetail && !was.current && typeof document !== 'undefined') {
    opener.current = document.activeElement as HTMLElement | null;
  }

  useEffect(() => {
    const opened = hasDetail && !was.current;
    const closed = !hasDetail && was.current;
    was.current = hasDetail;

    if (opened && !isWide() && detailRef.current) {
      detailRef.current.focus({ preventScroll: true });
      detailRef.current.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }

    if (closed) {
      const active = document.activeElement;
      const lost = !active || active === document.body || (detailRef.current?.contains(active) ?? false);
      if (!lost) return;
      const back = opener.current;
      if (back && back.isConnected && listRef.current?.contains(back)) back.focus();
      else listRef.current?.focus();
    }
  }, [hasDetail]);

  return (
    <div className={`grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] ${className}`}>
      <div ref={listRef} tabIndex={-1} className={`${hasDetail ? 'hidden xl:block' : ''} min-w-0 rounded-card`}>{list}</div>
      <div ref={detailRef} tabIndex={-1} aria-label="Details" role="region" className={`${hasDetail ? '' : 'hidden xl:block'} min-w-0 scroll-mt-20 rounded-card`}>
        {hasDetail && (
          <button type="button" onClick={onBack} className="xl:hidden mb-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-accent hover:underline">
            <Icon name="chevronRight" size={14} className="rotate-180" />{backLabel}
          </button>
        )}
        {hasDetail ? detail : (
          <div className="h-full min-h-[240px] flex items-center justify-center text-sm text-muted bg-paper border border-rule rounded-card">Select an item to see its details.</div>
        )}
      </div>
    </div>
  );
}
