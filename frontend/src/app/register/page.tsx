'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import AuthSplit, { AuthAlert, AuthTitle, AUTH_PRIMARY } from '@/components/auth/AuthSplit';
import { Field, Input, Select, Icon } from '@/components/ui';

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

  const pwShort = form.password.length > 0 && form.password.length < 8;

  return (
    <AuthSplit
      wide
      headline="Set up your company in ten minutes."
      sub="14-day free trial, no credit card required. Your first payroll can run this month."
    >
      <AuthTitle title="Start your free trial" sub="Your company details first. You'll add employees afterwards." />

      <form onSubmit={submit} className="flex flex-col gap-[22px]">
        {error && <AuthAlert>{error}</AuthAlert>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[14px]">
          <Field label="Company name" required className="sm:col-span-2">
            <Input value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="Acme Pte. Ltd." autoComplete="organization" required />
          </Field>
          <Field label="Country of registration" required>
            <Select value={form.country} onChange={(e) => set('country', e.target.value)}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Company size" required>
            <Select value={form.companySize} onChange={(e) => set('companySize', e.target.value)}>
              {SIZES.map((s) => <option key={s} value={s}>{s} employees</option>)}
            </Select>
          </Field>
          <Field label="Your name" required>
            <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Jane Tan" autoComplete="name" required />
          </Field>
          <Field label="Work email" required>
            <Input type="email" value={form.workEmail} onChange={(e) => set('workEmail', e.target.value)} placeholder="you@company.com" autoComplete="email" required />
          </Field>
          <Field label="Password" required className="sm:col-span-2" help="At least 8 characters. You can turn on two-factor authentication after signing in." error={pwShort ? 'Password must be at least 8 characters.' : undefined}>
            <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="8+ characters" autoComplete="new-password" invalid={pwShort} required />
          </Field>
          <Field label="Where did you hear about us?" className="sm:col-span-2">
            <Select value={form.referralSource} onChange={(e) => set('referralSource', e.target.value)}>
              <option value="">Select…</option>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        </div>

        <button type="submit" disabled={loading} className={AUTH_PRIMARY}>
          {loading ? <><div className="w-4 h-4 border-2 border-on-accent/30 border-t-on-accent animate-spin rounded-full" />Creating your workspace…</> : 'Create company and continue'}
        </button>

        <div className="flex flex-wrap gap-x-[18px] gap-y-2 text-[13px] text-muted">
          {['14-day free trial', 'No credit card required', 'Your own isolated, secure workspace'].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5"><Icon name="check" size={14} className="text-ok" strokeWidth={2.5} />{t}</span>
          ))}
        </div>
      </form>

      <p className="text-[13px] text-muted">
        Already have an account? <a href="/login" className="text-accent font-bold hover:underline">Sign in</a>
      </p>
    </AuthSplit>
  );
}
