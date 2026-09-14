/** Initials disc. `name` becomes up to two initials; pass `initials` to override. */
export function Avatar({ name, initials, size = 32, tone = 'accent', className = '' }: { name?: string; initials?: string; size?: number; tone?: 'accent' | 'soft' | 'brass'; className?: string }) {
  const derived = (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const text = initials ?? (derived || '?');
  const cls = tone === 'soft' ? 'bg-tint text-accent' : tone === 'brass' ? 'bg-brass-bg text-brass-fg' : 'bg-accent text-on-accent';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-bold shrink-0 ${cls} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden={name ? undefined : true}
      title={name}
    >
      {text}
    </span>
  );
}
