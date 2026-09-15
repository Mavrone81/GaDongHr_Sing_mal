'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Dialog on a paper card (full-width sheet below 640px). Esc and backdrop
 * close it; focus moves into the dialog on open, Tab / Shift+Tab stay inside
 * it, and focus returns to the opener on close. `footer` is where the actions
 * go (secondary left, primary right).
 *
 * - `onClose` is read through a ref, so an inline arrow is fine: the open
 *   effect depends on `open` only and never re-runs on a keystroke.
 * - The opener is captured during the render that opens the dialog, before
 *   any child mounts, so a field with `autoFocus` inside the dialog still
 *   returns focus to the opener on close. If a child already holds focus on
 *   open, the dialog leaves it there instead of moving it to the close button.
 */
/**
 * Open dialogs in the order they registered. The one that owns the keyboard
 * is the most recent dialog that does not contain another open dialog
 * (children register before their parent when both mount together, so
 * "last pushed" alone would pick the outer one).
 */
type Entry = { panel: { current: HTMLDivElement | null } };
const OPEN_STACK: Entry[] = [];
function topmost(): Entry | undefined {
  const leaves = OPEN_STACK.filter((a) => !OPEN_STACK.some((b) => b !== a && b.panel.current && a.panel.current?.contains(b.panel.current)));
  return leaves[leaves.length - 1];
}

export function Modal({ open, onClose, title, caption, footer, size = 'md', children }: {
  open: boolean; onClose: () => void; title: ReactNode; caption?: ReactNode; footer?: ReactNode; size?: 'md' | 'lg'; children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Render-time capture: runs before children commit (and before their autoFocus).
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    returnTo.current = document.activeElement as HTMLElement | null;
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    if (!panelRef.current?.contains(document.activeElement)) closeRef.current?.focus();
    const token = { panel: panelRef };
    OPEN_STACK.push(token);
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost open dialog reacts, so Esc over a nested dialog
      // closes that one, not every dialog on the page.
      if (topmost() !== token) return;
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      // Focus trap: Tab and Shift+Tab cycle within the dialog.
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((el) => !el.closest('[hidden], [aria-hidden="true"]'));
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && panelRef.current.contains(active);
      if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      const i = OPEN_STACK.lastIndexOf(token);
      if (i >= 0) OPEN_STACK.splice(i, 1);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      returnTo.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const close = () => onCloseRef.current();

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-ink/40 sm:p-4" onMouseDown={close}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-full ${size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] flex flex-col bg-paper border border-rule rounded-t-card sm:rounded-card shadow-card overflow-hidden`}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id="modal-title" className="text-[17px] font-bold text-ink leading-tight">{title}</h2>
            {caption && <p className="mt-1 text-[13px] text-muted">{caption}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={close} aria-label="Close" className="-mr-2 -mt-1 w-9 h-9 flex items-center justify-center rounded-control text-muted hover:bg-page hover:text-ink">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto text-sm text-ink">{children}</div>
        {footer && <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 px-5 py-4 border-t border-rule bg-page">{footer}</div>}
      </div>
    </div>
  );
}
