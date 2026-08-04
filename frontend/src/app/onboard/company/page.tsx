'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function apiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:4000/api`;
}

const INDUSTRIES = ['Technology', 'Finance', 'Retail', 'Manufacturing', 'Healthcare', 'F&B', 'Logistics', 'Professional Services', 'Construction', 'Education', 'Other'];

export default function CompanySetupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    legalName: '', registrationNo: '', industry: 'Technology',
    addressLine1: '', addressLine2: '', postalCode: '', city: '', country: 'SG',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.legalName) { setError('Legal company name is required.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl()}/tenants/me/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not save profile.'); setLoading(false); return; }
      router.push('/');
    } catch {
      setError('Could not reach the server. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-page p-6">
      <form onSubmit={submit} className="w-full max-w-xl border border-rule bg-paper p-8 ">
        <div className="text-xs font-black uppercase tracking-[0.2em] text-accent">Step 1 of 1</div>
        <h1 className="mt-1 text-2xl font-black text-ink">Set up your company</h1>
        <p className="mt-1 text-sm text-muted">A few details so we can tailor payroll & statutory config to {form.country}.</p>

        {error && <div className="mt-4 bg-page border border-ink px-4 py-2.5 text-sm text-ink">{error}</div>}

        <div className="mt-6 grid grid-cols-2 gap-4">
          <Field label="Legal company name" required full>
            <input className={INPUT} value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Acme Pte Ltd" required />
          </Field>
          <Field label="Registration no. (UEN / SSM)">
            <input className={INPUT} value={form.registrationNo} onChange={(e) => set('registrationNo', e.target.value)} placeholder="201912345A" />
          </Field>
          <Field label="Industry">
            <select className={INPUT} value={form.industry} onChange={(e) => set('industry', e.target.value)}>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </Field>
          <Field label="Address line 1" full>
            <input className={INPUT} value={form.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} placeholder="1 Raffles Place" />
          </Field>
          <Field label="Address line 2" full>
            <input className={INPUT} value={form.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} placeholder="#20-01" />
          </Field>
          <Field label="Postal code">
            <input className={INPUT} value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} placeholder="048616" />
          </Field>
          <Field label="City">
            <input className={INPUT} value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Singapore" />
          </Field>
        </div>

        <button type="submit" disabled={loading} className="mt-6 w-full bg-accent py-3 font-bold text-paper hover:bg-accent disabled:opacity-60">
          {loading ? 'Saving…' : 'Finish & enter dashboard'}
        </button>
        <button type="button" onClick={() => router.push('/')} className="mt-2 w-full py-2 text-sm font-semibold text-muted hover:text-ink">
          Skip for now
        </button>
      </form>
    </div>
  );
}

const INPUT = 'w-full border border-rule px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';

function Field({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-semibold text-ink">{label}{required && <span className="text-ink"> *</span>}</span>
      {children}
    </label>
  );
}
