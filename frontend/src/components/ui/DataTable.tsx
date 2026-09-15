import type React from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export type Column<Row> = {
  key: string;
  label: ReactNode;
  /** CSS grid track, e.g. 'minmax(0, 1.5fr)' or '120px'. Default 'minmax(0, 1fr)'. */
  width?: string;
  align?: 'left' | 'right' | 'center';
  /** Tabular numerals for money and dates. */
  numeric?: boolean;
  render: (row: Row) => ReactNode;
};

/**
 * The list screen. CSS-grid rows (52px), pill header, hairline dividers,
 * cells truncate rather than wrap. Provide `footer` for pagination text/controls
 * and `empty` for the zero-rows state (never leave a bare header).
 *
 * Clickable rows (`onRowClick`) are keyboard-reachable: role=button, Tab,
 * Enter/Space. Controls nested in a clickable row keep their own keys and
 * clicks (the row ignores events aimed at them). Give `mobileCard` to render
 * each row as a card below 768px instead of a horizontally scrolling grid.
 */
export function DataTable<Row>({ columns, rows, rowKey, onRowClick, mobileCard, footer, empty, rowHeight = 52, className = '', 'aria-label': ariaLabel }: {
  columns: Column<Row>[]; rows: Row[]; rowKey: (row: Row) => string | number; onRowClick?: (row: Row) => void;
  mobileCard?: (row: Row) => ReactNode; footer?: ReactNode; empty?: ReactNode; rowHeight?: number; className?: string; 'aria-label'?: string;
}) {
  const grid = columns.map((c) => c.width || 'minmax(0, 1fr)').join(' ');
  const align = (c: Column<Row>) => (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left');
  const clickable = Boolean(onRowClick);
  // Only the row itself activates on Enter/Space. Keys aimed at a control
  // nested inside the row (a button, an input) belong to that control.
  const rowKeyHandler = (row: Row) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick?.(row); }
  };
  // Clicks on a nested interactive control must not also open the row.
  const rowClick = (row: Row) => (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const interactive = t.closest('button, a, input, select, textarea, label, [role="button"], [role="switch"], [role="checkbox"]');
    if (interactive && interactive !== e.currentTarget) return;
    onRowClick?.(row);
  };
  const emptyState = <div className="px-5 py-10 text-sm text-muted text-center">{empty ?? 'Nothing here yet.'}</div>;

  return (
    <div className={`flex flex-col bg-paper border border-rule rounded-card overflow-hidden shadow-card ${className}`}>
      {/* Phone: one card per row */}
      {mobileCard && (
        <div className="md:hidden flex flex-col divide-y divide-rule" role="list" aria-label={ariaLabel}>
          {rows.length === 0 && emptyState}
          {rows.map((row) => clickable ? (
            <div key={rowKey(row)} role="listitem" className="px-4 py-3">
              <div role="button" tabIndex={0} onClick={rowClick(row)} onKeyDown={rowKeyHandler(row)} className="text-left -mx-2 px-2 py-1 rounded-control cursor-pointer hover:bg-page focus-visible:bg-page">{mobileCard(row)}</div>
            </div>
          ) : (
            <div key={rowKey(row)} className="px-4 py-3" role="listitem">{mobileCard(row)}</div>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className={`overflow-x-auto ${mobileCard ? 'hidden md:block' : ''}`}>
        <div className="min-w-[720px]" role="table" aria-label={ariaLabel}>
          <div className="grid items-center gap-4 px-5 h-[42px] bg-pill border-b border-rule" style={{ gridTemplateColumns: grid }} role="row">
            {columns.map((c) => <div key={c.key} role="columnheader" className={`text-xs font-bold text-muted whitespace-nowrap ${align(c)}`}>{c.label}</div>)}
          </div>
          {rows.length === 0 && emptyState}
          {rows.map((row) => (
            <div
              key={rowKey(row)}
              role={clickable ? 'button' : 'row'}
              tabIndex={clickable ? 0 : undefined}
              className={`grid items-center gap-4 px-5 border-b border-rule text-sm text-ink ${clickable ? 'cursor-pointer hover:bg-page focus-visible:bg-page' : ''}`}
              style={{ gridTemplateColumns: grid, height: rowHeight }}
              onClick={clickable ? rowClick(row) : undefined}
              onKeyDown={clickable ? rowKeyHandler(row) : undefined}
            >
              {columns.map((c) => (
                <div key={c.key} role="cell" className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${align(c)} ${c.numeric ? 'tabular-nums' : ''}`}>{c.render(row)}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {footer && <div className="flex items-center justify-between gap-3 px-5 min-h-[44px] py-2 text-[13px] text-muted">{footer}</div>}
    </div>
  );
}
