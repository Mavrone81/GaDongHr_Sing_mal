/** Underline tabs: 14px semibold, accent underline on the active one. */
export function Tabs<T extends string>({ items, active, onChange, className = '' }: { items: { id: T; label: string; count?: number }[]; active: T; onChange: (id: T) => void; className?: string }) {
  return (
    <div role="tablist" className={`flex gap-1 border-b border-rule overflow-x-auto ${className}`}>
      {items.map((it) => {
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.id)}
            className={`-mb-px px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${on ? 'text-accent border-accent' : 'text-muted border-transparent hover:text-ink'}`}
          >
            {it.label}{typeof it.count === 'number' && <span className="ml-1.5 text-xs text-faint">{it.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
