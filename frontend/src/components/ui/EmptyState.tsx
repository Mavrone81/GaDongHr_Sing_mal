import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Zero-data state: icon, one-line title, one-line explanation, one action. */
export function EmptyState({ icon = 'file', title, description, action, className = '' }: { icon?: IconName; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-14 px-6 text-center ${className}`}>
      <div className="flex items-center justify-center w-11 h-11 rounded-control bg-tint text-accent"><Icon name={icon} size={22} /></div>
      <div className="text-[15.5px] font-bold text-ink">{title}</div>
      {description && <div className="text-sm text-muted max-w-md">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
