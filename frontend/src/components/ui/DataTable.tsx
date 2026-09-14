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
 * Enter/Space. Give `mobileCard` to render each row as a card below 768px
 * (the spec's phone rule) instead of a horizontally scrolling grid.
 */
export function DataTable<Row>({ columns, rows, rowKey, onRowClick, mobileCard, footer, empty, rowHeight = 52, className = '', 'aria-label': ariaLabel }: {
  columns: Column<Row>[]; rows: Row[]; rowKey: (row: Row) => string | number; onRowClick?: (row: Row) => void;
  mobileCard?: (row: Row) => ReactNode; footer?: ReactNode; empty?: ReactNode; rowHeight?: number; className?: string; 'aria-label'?: string;
}) {
  const grid = columns.map((c) => c.width || 'minmax(0, 1fr)').join(' ');
  const align = (c: Column<Row>) => (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left');
  const clickable = Boolean(onRowClick);
  const rowKeyHandler = (row: Row) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick?.(row); }
  };
  const emptyState = <div className="px-5 py-10 text-sm text-muted text-center">{empty ?? 'Nothing here yet.'}</div>;

  return (
    <div className={`flex flex-col bg-paper border border-rule rounded-card overflow-hidden shadow-card ${className}`}>
      {/* Phone: one card per row */}
      {mobileCard && (
        <div className="md:hidden flex flex-col divide-y divide-rule" role="list" aria-label={ariaLabel}>
          {rows.length === 0 && emptyState}
          {rows.map((row) => clickable ? (
            <button key={rowKey(row)} type="button" onClick={() => onRowClick?.(row)} className="text-left px-4 py-3 hover:bg-page" role="listitem">{mobileCard(row)}</button>
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
              onClick={clickable ? () => onRowClick?.(row) : undefined}
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
