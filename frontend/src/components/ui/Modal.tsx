'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Dialog on a paper card (full-width sheet below 640px). Esc and backdrop
 * close it; focus moves to the close button on open and returns on close.
 * `footer` is where the actions go (secondary left, primary right).
 *
 * `onClose` is read through a ref, so an inline arrow is fine: the open/close
 * effect depends on `open` only and never re-runs (and re-focuses) on a
 * re-render caused by typing in the dialog's own form.
 */
export function Modal({ open, onClose, title, caption, footer, size = 'md', children }: {
  open: boolean; onClose: () => void; title: ReactNode; caption?: ReactNode; footer?: ReactNode; size?: 'md' | 'lg'; children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
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
