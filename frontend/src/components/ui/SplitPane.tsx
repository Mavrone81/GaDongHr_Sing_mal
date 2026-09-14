import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Approvals / inbox layout: list on the left, detail on the right at ≥1280px.
 * Below that, the list shows until something is selected, then the detail
 * takes over with a back control (`onBack`).
 */
export function SplitPane({ list, detail, hasDetail, onBack, backLabel = 'Back to list', className = '' }: {
  list: ReactNode; detail: ReactNode; hasDetail: boolean; onBack: () => void; backLabel?: string; className?: string;
}) {
  return (
    <div className={`grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] ${className}`}>
      <div className={`${hasDetail ? 'hidden xl:block' : ''} min-w-0`}>{list}</div>
      <div className={`${hasDetail ? '' : 'hidden xl:block'} min-w-0`}>
        {hasDetail && (
          <button type="button" onClick={onBack} className="xl:hidden mb-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-accent hover:underline">
            <Icon name="chevronRight" size={14} className="rotate-180" />{backLabel}
          </button>
        )}
        {hasDetail ? detail : (
          <div className="h-full min-h-[240px] flex items-center justify-center text-sm text-muted bg-paper border border-rule rounded-card">Select an item to see its details.</div>
        )}
      </div>
    </div>
  );
}
