import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'sm';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-white border-accent hover:opacity-95',
  secondary: 'bg-paper text-ink border-rule hover:bg-pill',
  ghost: 'bg-transparent text-accent border-transparent hover:bg-tint',
  danger: 'bg-transparent text-danger border-rule hover:bg-pill',
};
const SIZE: Record<Size, string> = { md: 'h-10 px-4 text-sm', sm: 'h-8 px-3 text-[13px]' };

/**
 * Buttons are 40px tall (32px for `sm`), 8px radius, semibold 14px.
 * A disabled action stays visible; give it a `reason` and it renders beside.
 */
export function Button({ variant = 'primary', size = 'md', icon, reason, disabled, className = '', children, ...rest }: {
  variant?: Variant; size?: Size; icon?: IconName; reason?: string; children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <>
      <button
        type={rest.type ?? 'button'}
        className={`inline-flex items-center justify-center gap-2 rounded-control border font-semibold whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${SIZE[size]} ${VARIANT[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        {...rest}
      >
        {icon && <Icon name={icon} size={size === 'sm' ? 15 : 16} strokeWidth={2} />}
        {children}
      </button>
      {disabled && reason && <span className="ml-2 text-xs text-muted">{reason}</span>}
    </>
  );
}
