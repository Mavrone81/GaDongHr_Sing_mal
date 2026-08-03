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
  // ReactNode, not string: the payslip register sorts by column, and a sort
  // control belongs in its own header rather than in a parallel row of buttons
  // floating above the table.
  columns: { key: string; label: ReactNode; numeric?: boolean }[];
  rows: Record<string, ReactNode>[];
  total?: { label: string; value: ReactNode };
}) {
  return (
    <>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`font-mono text-[0.625rem] tracking-[0.08em] uppercase text-muted
                            font-semibold py-1.5 border-b border-rule
                            ${c.numeric ? 'text-right' : 'text-left'}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  // Right-aligned tabular figures are for NUMBERS. Aligning a
                  // text or action column that way just because it is not
                  // first makes a column of words look like a column of money.
                  className={`py-1.5 border-b border-rule
                              ${c.numeric ? 'text-right tabular-nums' : 'text-left'}`}
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
