'use client';

import { useRef, useState } from 'react';

// Six-box authenticator code, same approach as components/auth/CodeInput on the
// shell branch: ONE real <input> drawn as six boxes. The browser appends every
// keystroke to that input's own value, so fast typing and password managers
// cannot drop digits, and paste / one-time-code autofill work natively.
// The input is invisible; the box it will fill next carries the 2px focus ring.
export function CodeInput({ value, onChange, autoFocus, label = '6-digit authenticator code' }: {
  value: string; onChange: (code: string) => void; autoFocus?: boolean; label?: string;
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
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-default opacity-0"
      />
      <div className="flex justify-between gap-2" aria-hidden="true">
        {cells.map((d, i) => {
          const active = focused && i === activeIndex;
          return (
            <div
              key={i}
              className={`flex h-12 w-full min-w-0 items-center justify-center rounded-control border bg-paper font-mono text-xl text-ink transition-colors ${
                d || active ? 'border-accent' : 'border-rule'
              } ${active ? 'ring-2 ring-accent ring-offset-2 ring-offset-page' : ''}`}
            >
              {d}
            </div>
          );
        })}
      </div>
    </div>
  );
}
