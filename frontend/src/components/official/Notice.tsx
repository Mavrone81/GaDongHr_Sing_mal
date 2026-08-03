import type { ReactNode } from 'react';

/**
 * The border is INK, not seal red — even when the notice carries a citation.
 *
 * The seal marks the authority; the notice is only a container. Using red for
 * both dilutes the reservation, which is the one rule carrying the system.
 */
export function Notice({ heading, children, seal }: {
  heading: string;
  children: ReactNode;
  seal?: ReactNode;
}) {
  return (
    <div className="border border-ink p-3 my-3 text-sm">
      <div className="font-mono text-[0.625rem] tracking-[0.09em] uppercase font-semibold mb-1">
        {heading}
      </div>
      {children}
      {seal && <div className="mt-2">{seal}</div>}
    </div>
  );
}
