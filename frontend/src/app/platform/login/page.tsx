'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function apiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:4000/api`;
}
const INPUT = 'w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm text-white focus:border-indigo-400 focus:outline-none';

export default function PlatformLogin() {
  const router = useRouter();
  const [step, setStep] = useState<'creds' | 'mfa' | 'setup'>('creds');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [otpauth, setOtpauth] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${apiUrl()}/platform/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Login failed'); setLoading(false); return; }
      if (d.token) { localStorage.setItem('vorkhive_platform_token', d.token); router.push('/platform'); return; }
      if (d.mfaSetupRequired) {
        setSetupToken(d.setupToken);
        const sres = await fetch(`${apiUrl()}/platform/mfa/setup`, { method: 'POST', headers: { Authorization: `Bearer ${d.setupToken}` } });
        const sd = await sres.json();
        setSecret(sd.secret || ''); setOtpauth(sd.otpauth || '');
        setStep('setup');
      } else if (d.mfaRequired) {
        setStep('mfa');
      }
    } catch { setError('Could not reach the server.'); }
    setLoading(false);
  }

  async function submitMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${apiUrl()}/platform/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, mfaCode }),
      });
      const d = await res.json();
      if (!res.ok || !d.token) { setError(d.error || 'Invalid code'); setLoading(false); return; }
      localStorage.setItem('vorkhive_platform_token', d.token); router.push('/platform');
    } catch { setError('Could not reach the server.'); }
    setLoading(false);
  }

  async function enableMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${apiUrl()}/platform/mfa/enable`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${setupToken}` },
        body: JSON.stringify({ mfaCode }),
      });
      const d = await res.json();
      if (!res.ok || !d.token) { setError(d.error || 'Invalid code'); setLoading(false); return; }
      localStorage.setItem('vorkhive_platform_token', d.token); router.push('/platform');
    } catch { setError('Could not reach the server.'); }
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-xl font-black tracking-tight text-white">VORKHIVE</div>
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-indigo-400">Platform Operator</div>
        </div>
        {error && <div className="mb-4 rounded-lg bg-rose-950 border border-rose-800 px-4 py-2.5 text-sm text-rose-300">{error}</div>}

        {step === 'creds' && (
          <form onSubmit={submitCreds} className="space-y-3">
            <input className={INPUT} type="email" placeholder="Operator email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className={INPUT} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button disabled={loading} className="w-full rounded-lg bg-indigo-600 py-2.5 font-bold text-white hover:bg-indigo-500 disabled:opacity-60">{loading ? '…' : 'Sign in'}</button>
          </form>
        )}
        {step === 'mfa' && (
          <form onSubmit={submitMfa} className="space-y-3">
            <p className="text-sm text-slate-300">Enter the 6-digit code from your authenticator.</p>
            <input className={INPUT} inputMode="numeric" placeholder="123456" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} required />
            <button disabled={loading} className="w-full rounded-lg bg-indigo-600 py-2.5 font-bold text-white hover:bg-indigo-500 disabled:opacity-60">Verify</button>
          </form>
        )}
        {step === 'setup' && (
          <form onSubmit={enableMfa} className="space-y-3">
            <p className="text-sm text-slate-300">Set up MFA (mandatory). Add this secret to your authenticator, then enter a code:</p>
            <div className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 font-mono text-xs text-indigo-300 break-all">{secret}</div>
            <input className={INPUT} inputMode="numeric" placeholder="123456" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} required />
            <button disabled={loading} className="w-full rounded-lg bg-indigo-600 py-2.5 font-bold text-white hover:bg-indigo-500 disabled:opacity-60">Enable MFA &amp; continue</button>
          </form>
        )}
      </div>
    </div>
  );
}
