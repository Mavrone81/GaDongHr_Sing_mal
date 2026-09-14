import type { ReactNode } from 'react';
import { Icon } from '@/components/ui';

/**
 * Centred modal for settings forms: dimmed backdrop, one paper card, title +
 * caption, body, footer actions. `onClose` wires the close button (and the
 * backdrop only when `closeOnBackdrop` is set, matching each page's old modal).
 */
export function Dialog({ title, caption, onClose, closeOnBackdrop = false, footer, children, width = 'max-w-md' }: {
  title: ReactNode; caption?: ReactNode; onClose?: () => void; closeOnBackdrop?: boolean;
  footer?: ReactNode; children: ReactNode; width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-shadow/40 p-0 sm:items-center sm:p-6"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-card border border-rule bg-paper shadow-card`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-rule px-6 py-5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="text-[17px] font-bold text-ink">{title}</h3>
            {caption && <p className="text-[13px] text-muted">{caption}</p>}
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 flex h-9 w-9 items-center justify-center rounded-control text-muted hover:bg-pill hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-rule px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
