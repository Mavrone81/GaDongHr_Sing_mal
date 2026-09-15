import type { ReactNode } from 'react';

/**
 * One setting inside a settings card (the Settings artboard row): 14px
 * semibold title, 13px muted explanation, the control on the right, a hairline
 * rule above. Stacks the control under the text on narrow screens.
 */
export function SettingRow({ title, description, control, first = false }: { title: ReactNode; description?: ReactNode; control?: ReactNode; first?: boolean }) {
  return (
    <div className={`flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${first ? '' : 'border-t border-rule'}`}>
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div className="text-sm font-semibold text-ink">{title}</div>
        {description && <div className="text-[13px] text-muted">{description}</div>}
      </div>
      {control && <div className="flex shrink-0 items-center gap-3">{control}</div>}
    </div>
  );
}
