'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

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
    <div className="max-w-3xl">
      <h1 className="text-2xl font-black text-ink">Billing & Plan</h1>

      {sub && (
        <div className="mt-4 border border-rule bg-paper p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted">Current plan</div>
              <div className="text-lg font-black capitalize text-ink">{sub.plan}</div>
            </div>
            <span className={` px-2.5 py-1 text-xs font-bold ${sub.status === 'ACTIVE' ? 'bg-page text-accent' : sub.status === 'TRIALING' ? 'bg-page text-accent' : 'bg-page text-ink'}`}>{sub.status}</span>
          </div>
          {sub.status === 'TRIALING' && (
            <p className="mt-3 text-sm text-ink">
              {sub.trialDaysLeft != null && sub.trialDaysLeft > 0
                ? `${sub.trialDaysLeft} days left in your free trial (ends ${sub.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : '—'}).`
                : 'Your trial has ended.'}
            </p>
          )}
          {sub.currentPeriodEnd && <p className="mt-2 text-sm text-ink">Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}.</p>}
        </div>
      )}

      {msg && <div className="mt-4 bg-page border border-highlight px-4 py-2.5 text-sm text-ink">{msg}</div>}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {plans.map((p) => (
          <div key={p.id} className={`relative flex flex-col  border bg-paper p-5 ${p.popular ? 'border-accent ring-1 ring-accent' : 'border-rule'}`}>
            {p.popular && <span className="absolute -top-2.5 left-5 bg-accent px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-paper">Most popular</span>}
            <div className="text-lg font-black text-ink">{p.name}</div>
            <div className="mt-1"><span className="text-2xl font-black text-ink">{p.price}</span> <span className="text-sm text-muted">{p.unit}</span></div>
            <p className="mt-1 text-xs text-muted">{p.tagline}</p>
            <ul className="mt-3 flex-1 space-y-1 text-sm text-ink">
              {p.features.map((f) => <li key={f}>✓ {f}</li>)}
            </ul>
            {p.contact ? (
              <button
                onClick={() => {
                  setMsg('Opening our sales assistant in a new tab — chat about Enterprise (or ask for a human).');
                  window.open('https://gadonghr.com/?chat=sales', '_blank', 'noopener');
                }}
                className="mt-4 border border-rule py-2.5 font-bold text-ink hover:bg-page"
              >
                {p.cta}
              </button>
            ) : (
              <button onClick={() => upgrade(p.id)} disabled={!!busy} className={`mt-4  py-2.5 font-bold text-paper disabled:opacity-60 ${p.popular ? 'bg-accent hover:bg-accent' : 'bg-shadow hover:bg-shadow'}`}>
                {busy === p.id ? 'Starting…' : p.cta}
              </button>
            )}
          </div>
        ))}
      </div>

      {sub && !sub.billingConfigured && (
        <p className="mt-4 text-xs text-muted">Note: online payment isn’t configured on this workspace yet — choosing a plan will show setup instructions instead of a checkout page.</p>
      )}
    </div>
  );
}
