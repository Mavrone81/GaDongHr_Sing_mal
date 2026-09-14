import type { ReactNode } from 'react';

/**
 * The list half of an approvals inbox (pair it with <SplitPane>). One tappable
 * row per item, the selected one carried on a tint ground with an accent
 * edge; rows are buttons so Tab / Enter / Space reach them. Narrower than a
 * DataTable on purpose — it has to fit the 5fr column beside a detail panel,
 * and it is what the phone sees.
 */
export function InboxList<Item>({ items, itemKey, selectedKey, onSelect, render, empty, footer, className = '', 'aria-label': ariaLabel }: {
  items: Item[]; itemKey: (item: Item) => string | number; selectedKey?: string | number | null; onSelect: (item: Item) => void;
  render: (item: Item, selected: boolean) => ReactNode; empty?: ReactNode; footer?: ReactNode; className?: string; 'aria-label'?: string;
}) {
  return (
    <div className={`flex flex-col bg-paper border border-rule rounded-card overflow-hidden shadow-card ${className}`}>
      <div role="list" aria-label={ariaLabel} className="flex flex-col divide-y divide-rule">
        {items.length === 0 && <div className="px-5 py-10 text-sm text-muted text-center">{empty ?? 'Nothing here yet.'}</div>}
        {items.map((item) => {
          const selected = selectedKey != null && itemKey(item) === selectedKey;
          return (
            <button
              key={itemKey(item)}
              type="button"
              role="listitem"
              aria-current={selected || undefined}
              onClick={() => onSelect(item)}
              className={`text-left w-full px-4 py-3 border-l-[3px] transition-colors ${selected ? 'bg-tint border-l-accent' : 'border-l-transparent hover:bg-page'}`}
            >
              {render(item, selected)}
            </button>
          );
        })}
      </div>
      {footer && <div className="flex items-center justify-between gap-3 px-5 min-h-[44px] py-2 border-t border-rule text-[13px] text-muted">{footer}</div>}
    </div>
  );
}
