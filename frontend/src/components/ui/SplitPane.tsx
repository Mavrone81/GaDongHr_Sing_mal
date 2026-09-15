'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

const FOCUSABLE = '[role="button"][tabindex="0"], button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]';

/** Below the ≥1280px breakpoint only one pane shows at a time. */
function isNarrow() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 1280px)').matches;
}

/**
 * Approvals / inbox layout: list on the left, detail on the right at ≥1280px.
 * Below that, the list shows until something is selected, then the detail
 * takes over with a back control (`onBack`).
 *
 * Focus follows the pane swap (QA, redesign/time): hiding the focused row
 * with `display:none` drops focus to <body>, so a keyboard or screen-reader
 * user restarted from the top of the document on every open and every back.
 *  - Opening below xl moves focus to the back control and scrolls the detail
 *    into view (it would otherwise sit under the page's stat cards).
 *  - Closing — back, a decision that removes the item, or a close button in
 *    the detail — returns focus to the list element last focused, or to the
 *    first row if that one is gone. At xl this only happens when focus was
 *    actually lost; it never steals focus the user put somewhere else.
 * The list stays mounted while hidden, so the row's own DOM node is restored.
 */
export function SplitPane({ list, detail, hasDetail, onBack, backLabel = 'Back to list', className = '' }: {
  list: ReactNode; detail: ReactNode; hasDetail: boolean; onBack: () => void; backLabel?: string; className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const lastListFocus = useRef<HTMLElement | null>(null);
  const was = useRef(hasDetail);

  useEffect(() => {
    if (was.current === hasDetail) return;
    was.current = hasDetail;
    const narrow = isNarrow();

    if (hasDetail) {
      if (!narrow) return;
      backRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView?.({ block: 'start' });
      return;
    }

    const active = document.activeElement;
    const lost = !active || active === document.body || !(active as HTMLElement).isConnected;
    if (!narrow && !lost) return;
    const listEl = listRef.current;
    if (!listEl) return;
    const prev = lastListFocus.current;
    const target = prev && prev.isConnected && listEl.contains(prev)
      ? prev
      : listEl.querySelector<HTMLElement>(FOCUSABLE) ?? listEl;
    target.focus();
  }, [hasDetail]);

  return (
    <div className={`grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] ${className}`}>
      <div
        ref={listRef}
        tabIndex={-1}
        onFocusCapture={(e) => { if (e.target !== e.currentTarget) lastListFocus.current = e.target as HTMLElement; }}
        className={`${hasDetail ? 'hidden xl:block' : ''} min-w-0`}
      >
        {list}
      </div>
      <div ref={detailRef} className={`${hasDetail ? '' : 'hidden xl:block'} min-w-0 scroll-mt-4`}>
        {hasDetail && (
          <button ref={backRef} type="button" onClick={onBack} className="xl:hidden mb-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-accent hover:underline">
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
