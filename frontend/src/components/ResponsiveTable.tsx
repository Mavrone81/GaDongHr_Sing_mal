'use client';

/**
 * ResponsiveTable — a generic table that renders as <table> on md+ and
 * as a stack of <div> cards on smaller screens.
 *
 * Usage:
 *   <ResponsiveTable
 *     data={rows}
 *     columns={[
 *       { key: 'code',   header: 'Code',   primary: true,  // shows in card title row
 *         render: (v, row) => <span className="font-mono">{v}</span> },
 *       { key: 'name',   header: 'Name',   primary: true },
 *       { key: 'dept',   header: 'Dept' },
 *       { key: 'status', header: 'Status', align: 'right',
 *         render: (v) => <StatusPill value={v} /> },
 *     ]}
 *     rowKey={(r) => r.id}
 *     onRowClick={(r) => router.push(`/employees/${r.id}`)}
 *     emptyText="No employees found."
 *   />
 *
 * Notes:
 *  • `primary` columns are concatenated (joined by ' · ') as the first line on mobile cards.
 *  • Non-primary columns are shown as label/value pairs below.
 *  • Use `mobileHidden` to skip a column on mobile entirely.
 */

import React from 'react';

export interface RtColumn<T = any> {
  key: string;
  header: string;
  primary?: boolean;          // shows in card title row on mobile
  mobileHidden?: boolean;     // hide entirely on mobile
  align?: 'left' | 'right' | 'center';
  width?: string;             // table column width (e.g. 'w-32')
  render?: (value: any, row: T) => React.ReactNode;
  // Defaults to a simple <td> with text. Use render for badges, links, etc.
}

interface ResponsiveTableProps<T> {
  data: T[];
  columns: RtColumn<T>[];
  rowKey?: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyText?: string;
  className?: string;
  // Optional small header above the table (rendered both views)
  caption?: React.ReactNode;
}

function getValue(row: any, key: string) {
  // Support dotted paths like 'plan.name'
  return key.split('.').reduce((o, k) => (o == null ? o : o[k]), row);
}

const ALIGN_CLASS: Record<string, string> = {
  left: 'text-left', right: 'text-right', center: 'text-center',
};

export function ResponsiveTable<T = any>({
  data, columns, rowKey, onRowClick, emptyText = 'No records', className = '', caption,
}: ResponsiveTableProps<T>) {
  if (!data || data.length === 0) {
    return (
      <div className={`bg-paper  border border-rule p-8 text-center ${className}`}>
        {caption && <div className="mb-4">{caption}</div>}
        <p className="text-sm text-muted">{emptyText}</p>
      </div>
    );
  }

  const primaryCols = columns.filter(c => c.primary);
  const detailCols  = columns.filter(c => !c.primary && !c.mobileHidden);

  return (
    <>
      {caption && <div className="mb-3">{caption}</div>}

      {/* ── DESKTOP TABLE ────────────────────────────────────────────────── */}
      <div className={`hidden md:block bg-paper  border border-rule overflow-hidden ${className}`}>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full">
            <thead className="bg-page border-b border-rule">
              <tr>
                {columns.map(col => (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-[10px] font-black text-muted uppercase tracking-widest ${ALIGN_CLASS[col.align || 'left']} ${col.width || ''}`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row) : i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-rule last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-page transition-colors' : ''}`}
                >
                  {columns.map(col => {
                    const v = getValue(row, col.key);
                    return (
                      <td key={col.key} className={`px-4 py-3 text-sm text-ink ${ALIGN_CLASS[col.align || 'left']}`}>
                        {col.render ? col.render(v, row) : (v ?? '—')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── MOBILE CARDS ─────────────────────────────────────────────────── */}
      <div className={`md:hidden space-y-2 ${className}`}>
        {data.map((row, i) => (
          <div
            key={rowKey ? rowKey(row) : i}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`bg-paper  border border-rule p-4 ${onRowClick ? 'cursor-pointer active:bg-page transition-colors' : ''}`}
          >
            {/* Primary row */}
            {primaryCols.length > 0 && (
              <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                <div className="flex items-center gap-2 flex-wrap text-sm font-black text-ink min-w-0">
                  {primaryCols.map((col, idx) => {
                    const v = getValue(row, col.key);
                    return (
                      <React.Fragment key={col.key}>
                        {idx > 0 && <span className="text-muted">·</span>}
                        <span>{col.render ? col.render(v, row) : (v ?? '—')}</span>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Detail rows */}
            {detailCols.length > 0 && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                {detailCols.map(col => {
                  const v = getValue(row, col.key);
                  return (
                    <div key={col.key} className="min-w-0">
                      <p className="text-[10px] font-black text-muted uppercase tracking-wider mb-0.5">{col.header}</p>
                      <div className="text-ink break-words">
                        {col.render ? col.render(v, row) : (v ?? '—')}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export default ResponsiveTable;
