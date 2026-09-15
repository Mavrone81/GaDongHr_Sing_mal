'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Shell } from '../_components/Shell';
import { tok } from '../_lib/api';

const TITLES: [string, string][] = [
  ['/platform/companies', 'Companies'],
  ['/platform/admins', 'Platform admins'],
  ['/platform/modules', 'Modules'],
  ['/platform/pricing', 'Pricing plans'],
  ['/platform/audit', 'Audit log'],
];

// Same guard as before: no token → sign-in. Rendering waits for the check so a
// signed-out visitor never sees an empty console flash.
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!tok()) { router.push('/platform/login'); return; }
    setReady(true);
  }, [router]);
  if (!ready) return null;
  const title = TITLES.find(([p]) => pathname.startsWith(p))?.[1] ?? 'Companies';
  return <Shell title={title}>{children}</Shell>;
}
