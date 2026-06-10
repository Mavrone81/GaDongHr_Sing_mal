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
      <h1 className="text-2xl font-black text-slate-900">Billing & Plan</h1>

      {sub && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Current plan</div>
              <div className="text-lg font-black capitalize text-slate-900">{sub.plan}</div>
            </div>
            <span className={`rounded px-2.5 py-1 text-xs font-bold ${sub.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : sub.status === 'TRIALING' ? 'bg-indigo-100 text-indigo-700' : 'bg-rose-100 text-rose-700'}`}>{sub.status}</span>
          </div>
          {sub.status === 'TRIALING' && (
            <p className="mt-3 text-sm text-slate-600">
              {sub.trialDaysLeft != null && sub.trialDaysLeft > 0
                ? `${sub.trialDaysLeft} days left in your free trial (ends ${sub.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : '—'}).`
                : 'Your trial has ended.'}
            </p>
          )}
          {sub.currentPeriodEnd && <p className="mt-2 text-sm text-slate-600">Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}.</p>}
        </div>
      )}

      {msg && <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">{msg}</div>}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {plans.map((p) => (
          <div key={p.id} className={`relative flex flex-col rounded-xl border bg-white p-5 ${p.popular ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200'}`}>
            {p.popular && <span className="absolute -top-2.5 left-5 rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Most popular</span>}
            <div className="text-lg font-black text-slate-900">{p.name}</div>
            <div className="mt-1"><span className="text-2xl font-black text-slate-900">{p.price}</span> <span className="text-sm text-slate-500">{p.unit}</span></div>
            <p className="mt-1 text-xs text-slate-500">{p.tagline}</p>
            <ul className="mt-3 flex-1 space-y-1 text-sm text-slate-600">
              {p.features.map((f) => <li key={f}>✓ {f}</li>)}
            </ul>
            {p.contact ? (
              <button
                onClick={() => {
                  setMsg('Opening our sales assistant in a new tab — chat about Enterprise (or ask for a human).');
                  window.open('https://vorkhive.com/?chat=sales', '_blank', 'noopener');
                }}
                className="mt-4 rounded-lg border border-slate-300 py-2.5 font-bold text-slate-700 hover:bg-slate-50"
              >
                {p.cta}
              </button>
            ) : (
              <button onClick={() => upgrade(p.id)} disabled={!!busy} className={`mt-4 rounded-lg py-2.5 font-bold text-white disabled:opacity-60 ${p.popular ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-800 hover:bg-slate-900'}`}>
                {busy === p.id ? 'Starting…' : p.cta}
              </button>
            )}
          </div>
        ))}
      </div>

      {sub && !sub.billingConfigured && (
        <p className="mt-4 text-xs text-slate-400">Note: online payment isn’t configured on this workspace yet — choosing a plan will show setup instructions instead of a checkout page.</p>
      )}
    </div>
  );
}
