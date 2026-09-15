'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Icon, Input } from '@/components/ui';
import { apiUrl, TOKEN_KEY } from '../_lib/api';
import { Lockup } from '../_components/Shell';
import { CodeInput } from '../_components/CodeInput';

export default function PlatformLogin() {
  const router = useRouter();
  const [step, setStep] = useState<'creds' | 'mfa' | 'setup'>('creds');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [qr, setQr] = useState('');
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
      if (d.token) { localStorage.setItem(TOKEN_KEY, d.token); router.push('/platform'); return; }
      if (d.mfaSetupRequired) {
        setSetupToken(d.setupToken);
        const sres = await fetch(`${apiUrl()}/platform/mfa/setup`, { method: 'POST', headers: { Authorization: `Bearer ${d.setupToken}` } });
        const sd = await sres.json();
        setSecret(sd.secret || ''); setQr(sd.qrCode || '');
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
      localStorage.setItem(TOKEN_KEY, d.token); router.push('/platform');
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
      localStorage.setItem(TOKEN_KEY, d.token); router.push('/platform');
    } catch { setError('Could not reach the server.'); }
    setLoading(false);
  }

  const codeReady = mfaCode.length === 6;

  return (
    <div className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="flex w-full max-w-[420px] flex-col gap-[22px] rounded-card border border-rule bg-paper p-6 sm:p-9">
        <Lockup />

        {step === 'creds' && (
          <form onSubmit={submitCreds} className="flex flex-col gap-[22px]">
            <div className="flex flex-col gap-1">
              <h1 className="text-[22px] font-semibold text-ink">Operator sign-in</h1>
              <p className="text-[13.5px] leading-relaxed text-muted">For Bevora staff only. Every sign-in is recorded in the platform audit log.</p>
            </div>
            <div className="flex flex-col gap-3">
              <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} invalid={!!error} required autoFocus /></Field>
              <Field label="Password" error={error || undefined}><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} invalid={!!error} required /></Field>
            </div>
            <Button type="submit" disabled={loading} className="h-11 w-full">{loading ? 'Signing in…' : 'Continue'}</Button>
            <div className="flex items-center gap-2 text-[12.5px] text-muted"><Icon name="lock" size={14} />Authenticator code required after the password.</div>
          </form>
        )}

        {step === 'mfa' && (
          <form onSubmit={submitMfa} className="flex flex-col gap-[22px]">
            <div className="flex flex-col gap-1">
              <h1 className="text-[22px] font-semibold text-ink">Enter your code</h1>
              <p className="text-[13.5px] leading-relaxed text-muted">The 6-digit code from your authenticator app for <span className="font-mono text-ink">{email}</span>.</p>
            </div>
            <CodeInput value={mfaCode} onChange={setMfaCode} autoFocus />
            {error && <p className="text-xs text-danger" role="alert">{error}</p>}
            <Button type="submit" disabled={loading || !codeReady} className="h-11 w-full">{loading ? 'Verifying…' : 'Verify and sign in'}</Button>
            <button type="button" onClick={() => { setStep('creds'); setMfaCode(''); setError(''); }} className="text-[13px] font-semibold text-accent hover:text-ink">Use a different account</button>
          </form>
        )}

        {step === 'setup' && (
          <form onSubmit={enableMfa} className="flex flex-col gap-[22px]">
            <div className="flex flex-col gap-1">
              <h1 className="text-[22px] font-semibold text-ink">Set up your authenticator</h1>
              <p className="text-[13.5px] leading-relaxed text-muted">MFA is required for every operator. Scan the QR code with your authenticator app, or enter the key by hand, then type the code it shows.</p>
            </div>
            {qr && <img src={qr} alt="QR code for the authenticator app" className="mx-auto h-44 w-44 rounded-control bg-paper p-2" />}
            <Field label="Setup key" help="For entering by hand.">
              <div className="break-all rounded-control border border-rule bg-pill px-3 py-2.5 font-mono text-xs text-ink">{secret}</div>
            </Field>
            <CodeInput value={mfaCode} onChange={setMfaCode} />
            {error && <p className="text-xs text-danger" role="alert">{error}</p>}
            <Button type="submit" disabled={loading || !codeReady} className="h-11 w-full">{loading ? 'Enabling…' : 'Enable MFA and continue'}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
