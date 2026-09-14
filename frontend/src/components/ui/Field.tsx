import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';

const CONTROL = 'w-full h-[42px] px-3 rounded-control border bg-paper text-sm text-ink placeholder:text-muted outline-none transition-colors focus:border-accent disabled:bg-pill disabled:text-muted';

/** Label above, control, optional help or error below. Wrap any control in it. */
export function Field({ label, help, error, required, children, className = '' }: { label: ReactNode; help?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[12.5px] font-semibold text-muted">{label}{required && <span className="text-danger" aria-hidden="true"> *</span>}</span>
      {children}
      {(error || help) && <span className={`text-xs ${error ? 'text-danger' : 'text-muted'}`} role={error ? 'alert' : undefined}>{error || help}</span>}
    </label>
  );
}

export function Input({ className = '', invalid, ...rest }: { invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return <input aria-invalid={invalid || undefined} className={`${CONTROL} ${invalid ? 'border-danger' : 'border-rule'} ${className}`} {...rest} />;
}

export function Textarea({ className = '', invalid, ...rest }: { invalid?: boolean } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea aria-invalid={invalid || undefined} className={`${CONTROL} h-auto min-h-[96px] py-2.5 ${invalid ? 'border-danger' : 'border-rule'} ${className}`} {...rest} />;
}

/** Native select with a token-coloured chevron (an Icon, so it follows the theme). */
export function Select({ className = '', invalid, children, ...rest }: { invalid?: boolean; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`relative block ${className}`}>
      <select aria-invalid={invalid || undefined} className={`${CONTROL} ${invalid ? 'border-danger' : 'border-rule'} appearance-none pr-9`} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </span>
  );
}
