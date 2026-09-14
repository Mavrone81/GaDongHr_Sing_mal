'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button, Icon, type IconName } from '@/components/ui';
import { signOut } from '../_lib/api';

// Direction C shell: 220px sidebar, 56px top bar; on phones the sidebar becomes a
// bottom bar of the same items. Only routes that exist are listed.
const NAV: { href: string; label: string; short: string; icon: IconName }[] = [
  { href: '/platform', label: 'Companies', short: 'Companies', icon: 'building' },
  { href: '/platform/admins', label: 'Platform admins', short: 'Admins', icon: 'users' },
  { href: '/platform/modules', label: 'Modules', short: 'Modules', icon: 'grid' },
  { href: '/platform/pricing', label: 'Pricing plans', short: 'Pricing', icon: 'tag' },
  { href: '/platform/audit', label: 'Audit log', short: 'Audit', icon: 'list' },
];

// Carapace mark — the same geometry as the product logo and the marketing site.
function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="shrink-0">
      <polygon points="50,6 82.91,28 82.91,72 50,94 17.09,72 17.09,28" fill="#102A22" stroke="#FCFBF7" strokeWidth="3.5" strokeLinejoin="round" />
      <g fill="none" stroke="#C08A3E" strokeWidth="2.3" strokeLinejoin="round">
        <polygon points="50,14 62.99,20.5 62.99,33.5 50,40 37.01,33.5 37.01,20.5" />
        <polygon points="50,37 62.99,43.5 62.99,56.5 50,63 37.01,56.5 37.01,43.5" />
        <polygon points="50,60 62.99,66.5 62.99,79.5 50,86 37.01,79.5 37.01,66.5" />
        <polygon points="27,24 38.26,30 38.26,42 27,48 15.74,42 15.74,30" />
        <polygon points="73,24 84.26,30 84.26,42 73,48 61.74,42 61.74,30" />
        <polygon points="27,52 38.26,58 38.26,70 27,76 15.74,70 15.74,58" />
        <polygon points="73,52 84.26,58 84.26,70 73,76 61.74,70 61.74,58" />
      </g>
    </svg>
  );
}

export function Lockup({ caption = 'Platform operator' }: { caption?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Mark />
      <div className="flex flex-col leading-tight">
        <div className="text-base font-bold"><span className="text-ink">GaDong</span><span className="text-highlight">HR</span></div>
        <div className="text-xs text-muted">{caption}</div>
      </div>
    </div>
  );
}

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isActive = (href: string) => (href === '/platform' ? pathname === '/platform' || pathname.startsWith('/platform/companies') : pathname.startsWith(href));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:flex w-[220px] shrink-0 flex-col border-r border-rule bg-page px-3 pt-[18px] pb-3.5">
        <div className="px-2 pb-1.5"><Lockup /></div>
        <nav aria-label="Platform" className="mt-3.5 flex flex-col gap-0.5">
          {NAV.map((n) => {
            const on = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? 'page' : undefined}
                className={`flex h-[38px] items-center gap-[11px] rounded-control px-3 text-[13.5px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? 'bg-tint font-semibold text-ink' : 'font-medium text-muted hover:bg-pill hover:text-ink'}`}
              >
                <Icon name={n.icon} size={17} className={on ? 'text-accent' : 'text-faint'} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        <div className="border-t border-rule pt-3">
          <Button variant="ghost" size="sm" icon="logout" onClick={() => signOut(router)} className="w-full justify-start">Sign out</Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-rule bg-paper px-4 md:px-7">
          <div className="md:hidden"><Lockup caption="Platform" /></div>
          <div className="hidden text-sm font-semibold text-ink md:block">{title}</div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[12.5px] text-muted lg:inline">Operator console</span>
            <Button variant="ghost" size="sm" icon="logout" onClick={() => signOut(router)} className="md:hidden">Sign out</Button>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-[18px] px-4 pb-24 pt-5 md:px-7 md:pb-8 md:pt-6">{children}</main>
      </div>

      <nav aria-label="Platform" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-rule bg-paper md:hidden">
        {NAV.map((n) => {
          const on = isActive(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs ${on ? 'font-semibold text-accent' : 'text-muted'}`}>
              <Icon name={n.icon} size={20} />
              <span className="truncate">{n.short}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
