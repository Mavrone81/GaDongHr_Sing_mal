'use client';

import { useRef, useState } from 'react';

/**
 * Six-cell one-time-code input. One real <input> (so paste, autofill and
 * screen readers work) drawn as six boxes; the parent's onChange keeps its
 * own digit-only / auto-submit logic.
 */
export default function CodeInput({ value, onChange, disabled, label = 'Verification code', autoFocus = true }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; label?: string; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const cells = Array.from({ length: 6 }, (_, i) => value[i] ?? '');
  const activeIndex = Math.min(value.length, 5);

  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={label}
        className="absolute inset-0 w-full h-full opacity-0 cursor-default"
      />
      <div className="flex gap-2.5" aria-hidden="true">
        {cells.map((d, i) => {
          const active = focused && !disabled && i === activeIndex;
          return (
            <div
              key={i}
              className={`flex-1 h-[58px] rounded-control border bg-paper flex items-center justify-center text-2xl font-bold text-ink tabular-nums transition-colors ${
                d || active ? 'border-accent' : 'border-rule'
              } ${active ? 'ring-2 ring-accent ring-offset-2 ring-offset-page' : ''} ${disabled ? 'opacity-60' : ''}`}
            >
              {d}
            </div>
          );
        })}
      </div>
    </div>
  );
}
