'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Icon } from '@/components/ui';

interface Sub { status: string; plan: string; trialDaysLeft: number | null; }

export default function TrialBanner() {
  const [sub, setSub] = useState<Sub | null>(null);

  useEffect(() => {
    apiFetch('/billing/subscription').then(setSub).catch(() => {});
  }, []);

  if (!sub) return null;
  const paid = sub.status === 'ACTIVE' && sub.plan !== 'trial';
  if (paid) return null;

  const expired = sub.status === 'PAST_DUE' || sub.status === 'SUSPENDED' || (sub.trialDaysLeft != null && sub.trialDaysLeft <= 0);
  const days = sub.trialDaysLeft ?? 0;
  const urgent = expired || days <= 3;

  return (
    <div className={`flex items-center justify-center gap-3 px-4 py-2 text-sm font-semibold border-b ${urgent ? 'bg-[#FFF4E5] text-warn border-[#F5D9B0]' : 'bg-tint text-accent border-rule'}`}>
      <Icon name={urgent ? 'alert' : 'clock'} size={16} />
      <span>
        {expired
          ? 'Your free trial has ended — upgrade to restore full access.'
          : `${days} day${days === 1 ? '' : 's'} left in your free trial.`}
      </span>
      <a href="/settings/billing" className="h-7 px-3 inline-flex items-center rounded-control bg-paper border border-current text-[13px] font-bold hover:opacity-90">Upgrade</a>
    </div>
  );
}
