'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

function apiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:4000/api`;
}

const COUNTRIES = [
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'PH', name: 'Philippines' },
  { code: 'VN', name: 'Vietnam' },
];
const SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];
const SOURCES = ['Google search', 'Social media', 'Referral from a friend', 'Online ad', 'Event / webinar', 'Other'];

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [form, setForm] = useState({
    companyName: '', fullName: '', workEmail: '', password: '',
    country: 'SG', companySize: '1-10', referralSource: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl()}/tenants/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Registration failed.'); setLoading(false); return; }
      await login(data.accessToken, data.refreshToken);
      router.push('/onboard/company');
    } catch {
      setError('Could not reach the server. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-stretch bg-slate-50">
      {/* Left brand panel */}
      <div className="hidden lg:flex w-1/2 flex-col justify-between bg-gradient-to-br from-indigo-600 to-violet-700 p-12 text-white">
        <div className="text-2xl font-black tracking-tight">GADONGHR</div>
        <div>
          <h1 className="text-4xl font-black leading-tight">Run your whole HR in one place.</h1>
          <p className="mt-4 text-indigo-100 text-lg">Payroll, leave, claims, attendance, appraisals — set up your company in minutes.</p>
          <ul className="mt-8 space-y-3 text-indigo-50">
            <li>✓ 14-day free trial</li>
            <li>✓ No credit card required</li>
            <li>✓ Your own isolated, secure workspace</li>
          </ul>
        </div>
        <div className="text-indigo-200 text-sm">© {new Date().getFullYear()} GaDongHR</div>
      </div>

      {/* Right form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-md">
          <h2 className="text-2xl font-black text-slate-900">Register your company</h2>
          <p className="mt-1 text-sm text-slate-500">Start your free trial — no credit card needed.</p>

          {error && <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 px-4 py-2.5 text-sm text-rose-700">{error}</div>}

          <div className="mt-6 space-y-4">
            <Field label="Company name" required>
              <input className={INPUT} value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="Acme Pte Ltd" required />
            </Field>
            <Field label="Your full name" required>
              <input className={INPUT} value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Jane Tan" required />
            </Field>
            <Field label="Work email" required>
              <input type="email" className={INPUT} value={form.workEmail} onChange={(e) => set('workEmail', e.target.value)} placeholder="jane@acme.com" required />
            </Field>
            <Field label="Password" required>
              <input type="password" className={INPUT} value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="At least 8 characters" required />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Country" required>
                <select className={INPUT} value={form.country} onChange={(e) => set('country', e.target.value)}>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Company size" required>
                <select className={INPUT} value={form.companySize} onChange={(e) => set('companySize', e.target.value)}>
                  {SIZES.map((s) => <option key={s} value={s}>{s} employees</option>)}
                </select>
              </Field>
            </div>
            <Field label="Where did you hear about us?">
              <select className={INPUT} value={form.referralSource} onChange={(e) => set('referralSource', e.target.value)}>
                <option value="">Select…</option>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <button type="submit" disabled={loading} className="mt-6 w-full rounded-lg bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
            {loading ? 'Creating your workspace…' : 'Start free trial'}
          </button>

          <p className="mt-4 text-center text-sm text-slate-500">
            Already have an account? <a href="/login" className="font-semibold text-indigo-600 hover:underline">Sign in</a>
          </p>
        </form>
      </div>
    </div>
  );
}

const INPUT = 'w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
    </label>
  );
}
