import type { ReactNode } from 'react';

/**
 * For anything with a total.
 *
 * Numbers are right-aligned with tabular figures; the total sits under a 2px
 * ink rule. Show the rate that produced a figure wherever one exists —
 * disputes are about rates, so let the user check the arithmetic without
 * calling support.
 */
export function DataTable({ columns, rows, total }: {
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: Record<string, ReactNode>[];
  total?: { label: string; value: ReactNode };
}) {
  return (
    <>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c.key}
                className={`font-mono text-[0.625rem] tracking-[0.08em] uppercase text-muted
                            font-semibold py-1.5 border-b border-rule
                            ${i === 0 ? 'text-left' : 'text-right'}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`py-1.5 border-b border-rule
                              ${i === 0 ? 'text-left' : 'text-right tabular-nums'}`}
                >
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total && (
        <div className="flex justify-between border-t-2 border-ink pt-2 mt-1 font-bold tabular-nums">
          <span>{total.label}</span>
          <span>{total.value}</span>
        </div>
      )}
    </>
  );
}
