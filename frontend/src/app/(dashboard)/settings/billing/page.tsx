'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Badge, Button, Card, CardHeader, Icon } from '@/components/ui';
import { SectionHeader } from '../_components/SectionHeader';

interface Sub {
  status: string; plan: string; subStatus: string;
  trialEndsAt: string | null; trialDaysLeft: number | null;
  currentPeriodEnd: string | null; billingConfigured: boolean;
}

// Fallback only — live plans come from the control plane (/api/pricing), edited
// by the platform operator. Keeps the page working if that fetch fails.
const FALLBACK_PLANS = [
  {
    id: 'starter', name: 'Starter', price: 'S$5', unit: '/ user / mo',
    tagline: 'For small teams putting HR on autopilot.',
    features: ['Up to 5 users', 'Leave & staff directory', 'Claims & attendance', 'Community support'],
    cta: 'Choose Starter',
  },
  {
    id: 'growth', name: 'Growth', price: 'S$9', unit: '/ user / mo', popular: true,
    tagline: 'For growing teams that need payroll & compliance.',
    features: ['Unlimited users', 'Full payroll with CPF', 'Digital payslips & IRAS export', 'Training & appraisals', 'Priority support'],
    cta: 'Choose Growth',
  },
  {
    id: 'enterprise', name: 'Enterprise', price: 'S$15', unit: '/ user / mo', contact: true,
    tagline: 'Advanced security and control for larger organizations.',
    features: ['Everything in Growth', 'Single Sign-On (SSO)', 'Dedicated success manager', 'Full API access'],
    cta: 'Contact sales',
  },
];

/** Subscription status → pill colour. Trials are brass (the plan colour), not green. */
const SUB_STATUS_TONE: Record<string, 'ok' | 'brass' | 'warn' | 'danger' | 'neutral'> = {
  ACTIVE: 'ok',
  TRIALING: 'brass',
  PAST_DUE: 'warn',
  SUSPENDED: 'danger',
  CANCELED: 'neutral',
  EXPIRED: 'neutral',
};

/** "PAST_DUE" → "Past due". */
const sentence = (s: string) => {
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export default function BillingPage() {
  const [sub, setSub] = useState<Sub | null>(null);
  const [plans, setPlans] = useState<typeof FALLBACK_PLANS>(FALLBACK_PLANS);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    apiFetch('/billing/subscription').then(setSub).catch(() => {});
    apiFetch('/pricing').then((d) => { if (Array.isArray(d?.plans) && d.plans.length) setPlans(d.plans); }).catch(() => {});
  }, []);

  async function upgrade(plan: string) {
    setBusy(plan); setMsg('');
    try {
      const r = await apiFetch('/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }) });
      if (r.checkoutUrl) { window.location.href = r.checkoutUrl; return; }
      setMsg(r.message || 'Billing is not configured yet. Please contact your administrator.');
    } catch { setMsg('Could not start checkout.'); }
    setBusy('');
  }

  return (
    <>
      <SectionHeader title="Billing" description="Your plan, trial and renewal." />

      {sub && (
        <Card>
          <CardHeader
            title="Current plan"
            action={<Badge tone={SUB_STATUS_TONE[sub.status] ?? 'neutral'}>{sentence(sub.status)}</Badge>}
          />
          <div className="text-[22px] font-extrabold capitalize tracking-[-0.01em] text-ink">{sub.plan}</div>
          {sub.status === 'TRIALING' && (
            <p className="mt-2 text-sm text-ink">
              {sub.trialDaysLeft != null && sub.trialDaysLeft > 0
                ? <><span className="tabular-nums">{sub.trialDaysLeft}</span> days left in your free trial (ends <span className="tabular-nums">{sub.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : '—'}</span>).</>
                : 'Your trial has ended.'}
            </p>
          )}
          {sub.currentPeriodEnd && <p className="mt-1 text-sm text-muted">Renews <span className="tabular-nums">{new Date(sub.currentPeriodEnd).toLocaleDateString()}</span>.</p>}
        </Card>
      )}

      {msg && (
        <div role="status" className="flex items-start gap-3 rounded-control border border-rule bg-paper px-4 py-3 text-sm text-ink">
          <Icon name="alert" size={18} className="mt-0.5 text-warn" />
          <span>{msg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className={`relative ${p.popular ? 'ring-2 ring-accent' : ''}`}>
            {p.popular && <Badge tone="accent" className="absolute -top-3 left-5">Most popular</Badge>}
            <div className="text-[15.5px] font-bold text-ink">{p.name}</div>
            <div className="mt-1.5">
              <span className="text-[26px] font-extrabold tracking-[-0.02em] text-ink tabular-nums">{p.price}</span>{' '}
              <span className="text-sm text-muted">{p.unit}</span>
            </div>
            <p className="mt-1 text-[13px] text-muted">{p.tagline}</p>
            <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm text-ink">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Icon name="check" size={16} strokeWidth={2} className="mt-0.5 text-accent" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {p.contact ? (
              <Button
                variant="secondary"
                className="mt-5 w-full"
                onClick={() => {
                  setMsg('Opening our sales assistant in a new tab — chat about Enterprise (or ask for a human).');
                  window.open('https://gadonghr.com/?chat=sales', '_blank', 'noopener');
                }}
              >
                {p.cta}
              </Button>
            ) : (
              <Button
                variant={p.popular ? 'primary' : 'secondary'}
                className="mt-5 w-full"
                onClick={() => upgrade(p.id)}
                disabled={!!busy}
              >
                {busy === p.id ? 'Starting…' : p.cta}
              </Button>
            )}
          </Card>
        ))}
      </div>

      {sub && !sub.billingConfigured && (
        <p className="text-[13px] text-muted">Online payment isn’t configured on this workspace yet — choosing a plan will show setup instructions instead of a checkout page.</p>
      )}
    </>
  );
}
