'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export type ToastTone = 'ok' | 'danger' | 'warn' | 'info';
interface ToastItem { id: number; tone: ToastTone; text: ReactNode }

const ToastCtx = createContext<{ toast: (text: ReactNode, tone?: ToastTone) => void } | null>(null);

/**
 * Mounted once in the root layout. `const { toast } = useToast(); toast('Saved', 'ok')`.
 * Auto-dismisses after 3.5s (errors stay 6s); polite live region.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback((text: ReactNode, tone: ToastTone = 'ok') => {
    const id = ++seq.current;
    setItems((l) => [...l, { id, tone, text }]);
    setTimeout(() => dismiss(id), tone === 'danger' ? 6000 : 3500);
  }, [dismiss]);
  const value = useMemo(() => ({ toast }), [toast]);

  const TONE: Record<ToastTone, string> = {
    ok: 'border-ok text-ok', danger: 'border-danger text-danger', warn: 'border-warn text-warn', info: 'border-accent text-accent',
  };
  const ICON: Record<ToastTone, 'check' | 'alert' | 'shield'> = { ok: 'check', danger: 'alert', warn: 'alert', info: 'shield' };

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[90] flex flex-col gap-2 pointer-events-none" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex items-start gap-2.5 w-full sm:w-[360px] px-4 py-3 bg-paper border-l-4 border border-rule rounded-card shadow-card text-sm ${TONE[t.tone]}`}>
            <Icon name={ICON[t.tone]} size={16} className="mt-0.5" />
            <div className="flex-1 text-ink">{t.text}</div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-mr-1 text-muted hover:text-ink"><Icon name="x" size={16} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  // Without a provider (tests, isolated renders) fall back to a no-op rather than crashing.
  return ctx ?? { toast: () => {} };
}
