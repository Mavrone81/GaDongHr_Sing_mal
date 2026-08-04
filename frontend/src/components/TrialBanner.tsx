'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

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

  return (
    <div className={`flex items-center justify-center gap-3 px-4 py-2 text-sm font-semibold ${expired ? 'bg-ink text-paper' : days <= 3 ? 'bg-highlight text-paper' : 'bg-accent text-paper'}`}>
      <span>
        {expired
          ? 'Your free trial has ended — upgrade to restore full access.'
          : `${days} day${days === 1 ? '' : 's'} left in your free trial.`}
      </span>
      <a href="/settings/billing" className=" bg-paper/20 px-3 py-1 font-bold hover:bg-paper/30">Upgrade</a>
    </div>
  );
}
