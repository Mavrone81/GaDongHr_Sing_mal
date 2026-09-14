import type { ReactNode } from 'react';
import { Card, DataTable, type Column } from '@/components/ui';

/**
 * A DataTable at md and up; a stack of cards below it (redesign rule 8:
 * "tables become card lists" at 375px). Same rows, same empty state, same
 * footer — only the layout of each row changes.
 */
export function ResponsiveTable<Row>({ columns, rows, rowKey, onRowClick, footer, empty, rowHeight, mobileRow }: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  onRowClick?: (row: Row) => void;
  footer?: ReactNode;
  empty?: ReactNode;
  rowHeight?: number;
  /** One row rendered as the body of a mobile card. */
  mobileRow: (row: Row) => ReactNode;
}) {
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        onRowClick={onRowClick}
        footer={footer}
        empty={empty}
        rowHeight={rowHeight}
        className="hidden md:flex"
      />
      <div className="flex flex-col gap-3 md:hidden">
        {rows.length === 0 && <Card padding="p-0">{empty ?? <div className="px-5 py-10 text-center text-sm text-muted">Nothing here yet.</div>}</Card>}
        {rows.map((row) => (
          <Card
            key={rowKey(row)}
            padding="p-4"
            className={onRowClick ? 'cursor-pointer' : ''}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {mobileRow(row)}
          </Card>
        ))}
        {footer && <div className="flex items-center justify-between px-1 text-[13px] text-muted">{footer}</div>}
      </div>
    </>
  );
}
