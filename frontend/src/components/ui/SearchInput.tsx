import type { InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

/** 40px search box with a leading icon; put a keyboard hint in `hint` (e.g. "⌘K"). */
export function SearchInput({ hint, className = '', ...rest }: { hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={`flex items-center gap-2.5 h-10 px-3 rounded-control bg-page border border-rule text-muted focus-within:border-accent ${className}`}>
      <Icon name="search" size={16} />
      <input type="search" className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px] text-ink placeholder:text-muted" {...rest} />
      {hint && <span className="text-xs px-1.5 py-0.5 border border-rule rounded text-muted" aria-hidden="true">{hint}</span>}
    </div>
  );
}
