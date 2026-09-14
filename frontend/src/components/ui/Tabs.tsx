/** Underline tabs: 14px semibold, accent underline on the active one. Arrow keys move between tabs. */
export function Tabs<T extends string>({ items, active, onChange, className = '' }: { items: { id: T; label: string; count?: number }[]; active: T; onChange: (id: T) => void; className?: string }) {
  const move = (from: number, delta: number) => {
    const next = items[(from + delta + items.length) % items.length];
    if (next) onChange(next.id);
  };
  return (
    <div role="tablist" className={`flex gap-1 border-b border-rule overflow-x-auto px-0.5 pt-0.5 ${className}`}>
      {items.map((it, i) => {
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(it.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') { e.preventDefault(); move(i, 1); }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i, -1); }
            }}
            className={`-mb-px px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors rounded-t ${on ? 'text-accent border-accent' : 'text-muted border-transparent hover:text-ink'}`}
          >
            {it.label}{typeof it.count === 'number' && <span className="ml-1.5 text-xs text-muted tabular-nums">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
