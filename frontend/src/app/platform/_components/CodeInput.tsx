'use client';

import { useRef } from 'react';

// Six single-digit cells for an authenticator code. Typing advances, Backspace
// retreats, and a pasted 6-digit code fills every cell. `value` is the joined string.
export function CodeInput({ value, onChange, autoFocus }: { value: string; onChange: (code: string) => void; autoFocus?: boolean }) {
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  const set = (next: string[]) => onChange(next.join(''));
  const focus = (i: number) => cells.current[Math.max(0, Math.min(5, i))]?.focus();

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit authenticator code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { cells.current[i] = el; }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`Digit ${i + 1}`}
          autoFocus={autoFocus && i === 0}
          className="h-12 w-full min-w-0 rounded-control border border-rule bg-paper text-center font-mono text-xl text-ink outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (!v) { const n = [...digits]; n[i] = ''; set(n); return; }
            const n = [...digits];
            v.split('').slice(0, 6 - i).forEach((ch, k) => { n[i + k] = ch; });
            set(n);
            focus(i + v.length);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digits[i] && i > 0) { e.preventDefault(); const n = [...digits]; n[i - 1] = ''; set(n); focus(i - 1); }
            if (e.key === 'ArrowLeft') focus(i - 1);
            if (e.key === 'ArrowRight') focus(i + 1);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text').replace(/\D/g, '');
            if (!text) return;
            e.preventDefault();
            const n = [...digits];
            text.split('').slice(0, 6 - i).forEach((ch, k) => { n[i + k] = ch; });
            set(n);
            focus(i + text.length);
          }}
        />
      ))}
    </div>
  );
}
