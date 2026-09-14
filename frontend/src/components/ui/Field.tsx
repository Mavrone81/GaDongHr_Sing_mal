import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const CONTROL = 'w-full h-[42px] px-3 rounded-control border bg-paper text-sm text-ink placeholder:text-faint outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-pill disabled:text-muted';

/** Label above, control, optional help or error below. Wrap any control in it. */
export function Field({ label, help, error, required, children, className = '' }: { label: ReactNode; help?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[12.5px] font-semibold text-muted">{label}{required && <span className="text-danger"> *</span>}</span>
      {children}
      {(error || help) && <span className={`text-xs ${error ? 'text-danger' : 'text-muted'}`}>{error || help}</span>}
    </label>
  );
}

export function Input({ className = '', invalid, ...rest }: { invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL} ${invalid ? 'border-danger' : 'border-rule'} ${className}`} {...rest} />;
}

export function Select({ className = '', invalid, children, ...rest }: { invalid?: boolean; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${CONTROL} ${invalid ? 'border-danger' : 'border-rule'} appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%236B6960%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27><path d=%27M6 9l6 6 6-6%27/></svg>")] bg-no-repeat bg-[right_12px_center] pr-9 ${className}`} {...rest}>
      {children}
    </select>
  );
}
