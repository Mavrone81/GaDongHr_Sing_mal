'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui';

/**
 * Settings area shell (redesign, screen type 5): one "Settings" page header,
 * a left sub-nav, and the section's cards on the right. Every settings page
 * renders inside this, so the pages only supply their own section content.
 *
 * The sub-nav mirrors the dashboard sidebar's RBAC matrix (SUPER_ADMIN_NAV,
 * IT_ADMIN_NAV and HR_ADMIN_NAV in `(dashboard)/layout.tsx`) — it must never
 * show a role a settings link its sidebar hides (M-07: admin chrome is itself
 * a disclosure). The server still enforces every permission; this list only
 * decides what is rendered.
 */

type Section = { href: string; label: string };

const SECTIONS: Section[] = [
  { href: '/settings', label: 'Overview' },
  { href: '/settings/users', label: 'Users' },
  { href: '/settings/roles', label: 'Roles & permissions' },
  { href: '/settings/security', label: 'Security' },
  { href: '/settings/audit', label: 'Audit log' },
  { href: '/settings/rates', label: 'Statutory tables' },
  { href: '/settings/pdpa', label: 'PDPA & retention' },
  { href: '/settings/api', label: 'API & integrations' },
  { href: '/settings/overrides', label: 'System overrides' },
  { href: '/settings/billing', label: 'Billing' },
];

const IT_ADMIN_SECTIONS = ['/settings', '/settings/users', '/settings/roles', '/settings/security', '/settings/audit'];
const USERS_ONLY = ['/settings/users'];

/** Settings links each role's sidebar shows. SUPER_ADMIN has unrestricted access to every module. */
const VISIBLE_BY_ROLE: Record<string, readonly string[]> = {
  SUPER_ADMIN: SECTIONS.map((s) => s.href),
  IT_ADMIN: IT_ADMIN_SECTIONS,
  HR_ADMIN: USERS_ONLY,
  HR_MANAGER: USERS_ONLY,
};

const isActive = (href: string, pathname: string) =>
  href === '/settings' ? pathname === '/settings' : pathname === href || pathname.startsWith(`${href}/`);

/**
 * The role's sections, plus the page the user is already on when it is not in
 * that list (e.g. Billing, reached from the trial banner) — so the sub-nav
 * always says where you are without advertising anything else.
 */
function visibleSections(role: string, pathname: string): Section[] {
  const allowed = new Set(VISIBLE_BY_ROLE[role] ?? []);
  return SECTIONS.filter((s) => allowed.has(s.href) || isActive(s.href, pathname));
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/settings';
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase().trim();
  const sections = user ? visibleSections(role, pathname) : [];

  // Below lg the sub-nav is a horizontal pill row; keep the current section in view.
  const activeRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname, sections.length]);

  return (
    <div className="flex flex-col gap-6 pb-16">
      <PageHeader title="Settings" subtitle="Company, access, security and statutory configuration for this workspace." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-6">
          <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
            {sections.map((s) => {
              const on = isActive(s.href, pathname);
              return (
                <li key={s.href} className="shrink-0">
                  <Link
                    href={s.href}
                    ref={on ? activeRef : undefined}
                    aria-current={on ? 'page' : undefined}
                    className={`flex items-center rounded-control px-3 py-[9px] text-sm whitespace-nowrap transition-colors ${
                      on ? 'bg-tint font-bold text-accent' : 'font-medium text-muted hover:bg-pill hover:text-ink'
                    }`}
                  >
                    {s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
