import type { ReactNode } from 'react';

/**
 * Label left, value right, hairline between. This replaces the card as the atom
 * of the system — hairlines separate, whitespace groups.
 */
export function Field({ label, hint, value, seal }: {
  label: string;
  hint?: string;
  value: ReactNode;
  seal?: ReactNode;
}) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-2 border-b border-rule last:border-b-0">
      <span className="text-[0.9375rem]">
        {label}
        {hint && <small className="block text-muted text-xs">{hint}</small>}
        {seal && <span className="mt-1 block">{seal}</span>}
      </span>
      {/* tabular-nums is load-bearing: without it a column of figures does not
          line up, and scanning the column is the only reason it exists. */}
      <span className="font-semibold whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}
