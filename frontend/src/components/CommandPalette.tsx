'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui';

export interface PaletteItem { name: string; path: string; icon: IconName; group: string }

/**
 * ⌘K / Ctrl+K jump box. Lists the pages the signed-in role can reach (the
 * same list as the sidebar, so it can never surface a route the role lacks),
 * filters as you type, arrow keys + Enter to go.
 */
export default function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? items.filter((it) => `${it.name} ${it.group}`.toLowerCase().includes(needle)) : items;
    return list.slice(0, 12);
  }, [q, items]);

  useEffect(() => { if (open) { setQ(''); setCursor(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => { setCursor(0); }, [q]);

  if (!open) return null;

  const go = (it: PaletteItem) => { onClose(); router.push(it.path); };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-4 bg-ink/40" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Jump to a page">
      <div className="w-full max-w-xl bg-paper border border-rule rounded-card shadow-card overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 h-14 border-b border-rule focus-within:border-accent">
          <Icon name="search" size={18} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              else if (e.key === 'Enter' && results[cursor]) { e.preventDefault(); go(results[cursor]); }
              else if (e.key === 'Escape') { onClose(); }
            }}
            placeholder="Search pages…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-ink placeholder:text-faint"
            aria-label="Search pages"
          />
          <span className="text-xs px-1.5 py-0.5 border border-rule rounded text-faint">Esc</span>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-2" role="listbox">
          {results.length === 0 && <li className="px-4 py-6 text-sm text-muted text-center">No page matches “{q}”.</li>}
          {results.map((it, i) => (
            <li key={it.path} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(it)}
                className={`w-full flex items-center gap-3 px-4 h-11 text-left text-sm ${i === cursor ? 'bg-tint text-accent' : 'text-ink hover:bg-page'}`}
              >
                <Icon name={it.icon} size={17} className={i === cursor ? 'text-accent' : 'text-muted'} />
                <span className="flex-1 font-semibold">{it.name}</span>
                <span className="text-xs text-faint">{it.group}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
