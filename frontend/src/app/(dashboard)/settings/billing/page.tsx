'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface Sub {
  status: string; plan: string; subStatus: string;
  trialEndsAt: string | null; trialDaysLeft: number | null;
  currentPeriodEnd: string | null; billingConfigured: boolean;
}

const PLANS = [
  { id: 'starter', name: 'Starter', price: 'S$8 / employee / mo', features: ['Core HR', 'Leave & Claims', 'Payroll', 'Email support'] },
  { id: 'pro', name: 'Pro', price: 'S$14 / employee / mo', features: ['Everything in Starter', 'Attendance & Recruitment', 'Performance & Training', 'Priority support'] },
];

export default function BillingPage() {
  const [sub, setSub] = useState<Sub | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => { apiFetch('/billing/subscription').then(setSub).catch(() => {}); }, []);

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

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {PLANS.map((p) => (
          <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col">
            <div className="text-lg font-black text-slate-900">{p.name}</div>
            <div className="text-sm font-semibold text-indigo-600">{p.price}</div>
            <ul className="mt-3 flex-1 space-y-1 text-sm text-slate-600">
              {p.features.map((f) => <li key={f}>✓ {f}</li>)}
            </ul>
            <button onClick={() => upgrade(p.id)} disabled={!!busy} className="mt-4 rounded-lg bg-indigo-600 py-2.5 font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
              {busy === p.id ? 'Starting…' : `Choose ${p.name}`}
            </button>
          </div>
        ))}
      </div>

      {sub && !sub.billingConfigured && (
        <p className="mt-4 text-xs text-slate-400">Note: online payment isn’t configured on this workspace yet — choosing a plan will show setup instructions instead of a checkout page.</p>
      )}
    </div>
  );
}
