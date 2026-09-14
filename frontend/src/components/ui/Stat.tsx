import type { ReactNode } from 'react';
import { Card } from './Card';

/** KPI tile: 12.5px label, 30px extrabold value, 13px note. Use in a 4-up grid. */
export function Stat({ label, value, note, className = '' }: { label: ReactNode; value: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <Card padding="px-[22px] py-5" className={className}>
      <div className="text-[12.5px] font-semibold text-muted">{label}</div>
      <div className="text-[30px] font-extrabold tracking-[-0.02em] leading-[1.1] text-ink my-1.5 tabular-nums">{value}</div>
      {note && <div className="text-[13px] text-muted">{note}</div>}
    </Card>
  );
}
