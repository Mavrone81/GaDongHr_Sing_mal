import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Disabled actions stay VISIBLE with the reason beside them — never hidden.
 *
 * Hiding an action teaches the user the feature is missing; a server rejection
 * after clicking teaches them the product is unreliable. Neither is what you
 * want from software someone has to defend to an auditor.
 */
export function Button({
  variant = 'accent', disabled, reason, children, className = '', ...rest
}: {
  variant?: 'accent' | 'secondary' | 'quiet';
  disabled?: boolean;
  reason?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'inline-block rounded-[2px] px-3.5 py-2 text-sm font-semibold border';
  const styles = disabled
    ? 'bg-transparent text-muted border-rule cursor-not-allowed'
    : variant === 'accent'
      ? 'bg-accent text-paper border-accent'
      : variant === 'secondary'
        ? 'bg-transparent text-accent border-accent'
        : 'bg-transparent text-muted border-rule';

  return (
    <>
      <button
        className={`${base} ${styles} ${className}`}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        {...rest}
      >
        {children}
      </button>
      {disabled && reason && <span className="ml-2 text-xs text-muted">{reason}</span>}
    </>
  );
}
