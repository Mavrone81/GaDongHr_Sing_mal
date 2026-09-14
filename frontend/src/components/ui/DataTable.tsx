import type { ReactNode } from 'react';

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
 */
export function DataTable<Row>({ columns, rows, rowKey, onRowClick, footer, empty, rowHeight = 52, className = '' }: {
  columns: Column<Row>[]; rows: Row[]; rowKey: (row: Row) => string | number; onRowClick?: (row: Row) => void;
  footer?: ReactNode; empty?: ReactNode; rowHeight?: number; className?: string;
}) {
  const grid = columns.map((c) => c.width || 'minmax(0, 1fr)').join(' ');
  const align = (c: Column<Row>) => (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left');
  return (
    <div className={`flex flex-col bg-paper border border-rule rounded-card overflow-hidden shadow-card ${className}`}>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid items-center gap-4 px-5 h-[42px] bg-pill border-b border-rule" style={{ gridTemplateColumns: grid }}>
            {columns.map((c) => <div key={c.key} className={`text-xs font-bold text-muted whitespace-nowrap ${align(c)}`}>{c.label}</div>)}
          </div>
          {rows.length === 0 && <div className="px-5 py-10 text-sm text-muted text-center">{empty ?? 'Nothing here yet.'}</div>}
          {rows.map((row) => (
            <div
              key={rowKey(row)}
              className={`grid items-center gap-4 px-5 border-b border-rule text-sm text-ink ${onRowClick ? 'cursor-pointer hover:bg-page' : ''}`}
              style={{ gridTemplateColumns: grid, height: rowHeight }}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <div key={c.key} className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${align(c)} ${c.numeric ? 'tabular-nums' : ''}`}>{c.render(row)}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {footer && <div className="flex items-center justify-between px-5 h-11 text-[13px] text-muted">{footer}</div>}
    </div>
  );
}
