import type { ReactNode } from 'react';
import GaDongLogo from '@/components/GaDongLogo';
import { Icon } from '@/components/ui';

/**
 * Sign-in / sign-up frame: dark brand panel on the left (≥1024px), form column
 * on the right; single column with a small lockup on phones.
 */
export default function AuthSplit({ headline, sub, wide = false, children }: { headline: string; sub: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="min-h-screen flex bg-page font-sans text-ink">
      <aside className="hidden lg:flex w-[44%] max-w-[560px] shrink-0 flex-col justify-between bg-shadow p-12">
        <GaDongLogo variant="dark" markSize={34} />
        <div className="flex flex-col gap-[18px]">
          <h2 className="text-[38px] font-extrabold tracking-[-0.02em] leading-[1.1] text-white">{headline}</h2>
          <p className="text-[15px] leading-normal text-white/75 max-w-[420px]">{sub}</p>
        </div>
        <p className="text-[12.5px] text-white/55">© 2026 Bevora Technologies • BT-HRMS-001 • v1.1.0-STABLE</p>
      </aside>
      <main className="flex-1 flex flex-col justify-center px-5 py-10 sm:px-12">
        <div className={`w-full mx-auto flex flex-col gap-[22px] ${wide ? 'max-w-[560px]' : 'max-w-[400px]'}`}>
          <div className="lg:hidden"><GaDongLogo variant="light" markSize={30} /></div>
          {children}
        </div>
      </main>
    </div>
  );
}

export function AuthAlert({ tone = 'danger', children }: { tone?: 'danger' | 'ok' | 'warn' | 'info'; children: ReactNode }) {
  const cls = {
    danger: 'bg-[#FEEDEA] text-danger',
    warn: 'bg-[#FFF4E5] text-warn',
    ok: 'bg-tint text-ok',
    info: 'bg-tint text-accent',
  }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`flex items-start gap-2.5 px-3.5 py-3 rounded-control text-[13px] leading-snug ${cls}`}>
      <Icon name={tone === 'danger' || tone === 'warn' ? 'alert' : tone === 'ok' ? 'check' : 'shield'} size={16} className="mt-px" />
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function AuthTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-[28px] font-extrabold tracking-[-0.02em] leading-tight text-ink">{title}</h1>
      {sub && <p className="text-sm text-muted leading-normal">{sub}</p>}
    </div>
  );
}

export const AUTH_PRIMARY = 'w-full h-[46px] rounded-control bg-accent text-on-accent text-[15px] font-bold flex items-center justify-center gap-2 hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60 disabled:cursor-not-allowed';
