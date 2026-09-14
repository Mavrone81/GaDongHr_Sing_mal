'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { validateNewPassword, tokenFromQuery, pwStrength } from '@/lib/passwordReset';
import GaDongLogo from '@/components/GaDongLogo';
import { AuthAlert, AuthTitle, AUTH_PRIMARY } from '@/components/auth/AuthSplit';
import { Field, Input, Icon } from '@/components/ui';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  // Read the token from the emailed link. Done in an effect (not at render) so
  // it only runs in the browser and avoids the Next useSearchParams Suspense
  // requirement.
  useEffect(() => {
    setToken(tokenFromQuery(window.location.search));
    setReady(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = validateNewPassword(password, confirm);
    if (!v.ok) { setError(v.error); return; }
    if (!token) { setError('This reset link is invalid or has expired.'); return; }
    setSubmitting(true); setError('');
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: password }),
      });
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch (err) {
      setError((err as Error).message || 'Reset failed. The link may have expired — request a new one.');
    }
    setSubmitting(false);
  };

  const noToken = ready && !token;
  const strength = pwStrength(password);
  const mismatch = confirm.length > 0 && password !== confirm;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-page px-5 py-10 font-sans">
      <div className="w-full max-w-[440px] flex flex-col gap-6">
        <GaDongLogo variant="light" markSize={30} />
        <div className="bg-paper border border-rule rounded-card shadow-card p-6 sm:p-8 flex flex-col gap-5">
          <AuthTitle title="Choose a new password" />

          {done ? (
            <AuthAlert tone="ok">Your password has been reset. Taking you to sign in…</AuthAlert>
          ) : noToken ? (
            <div className="flex flex-col gap-3">
              <AuthAlert tone="warn">This reset link is missing or invalid. Please request a new one.</AuthAlert>
              <a href="/auth/forgot-password" className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-accent hover:underline">Request a new link<Icon name="arrowRight" size={14} /></a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Field label="New password" help={password ? undefined : 'At least 8 characters.'}>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="new-password" placeholder="8+ characters" autoFocus />
              </Field>
              {/* Strength meter — same scoring as the admin user panel (@/lib/passwordReset) */}
              {password && (
                <div className="-mt-1">
                  <div className="flex gap-1 mb-1.5" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= strength.score ? strength.color : 'bg-rule'}`} />
                    ))}
                  </div>
                  <p className={`text-xs font-semibold ${strength.score >= 3 ? 'text-ok' : 'text-muted'}`}>{strength.label}</p>
                </div>
              )}
              <Field label="Confirm password" error={mismatch ? 'Passwords do not match.' : undefined}>
                <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" placeholder="Re-enter the password" invalid={mismatch} />
              </Field>
              {error && <AuthAlert>{error}</AuthAlert>}
              <button type="submit" disabled={submitting || !password || password !== confirm} className={AUTH_PRIMARY}>
                {submitting ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
        <a href="/login" className="self-center inline-flex items-center gap-1 text-[13.5px] font-semibold text-accent hover:underline">
          <Icon name="chevronRight" size={14} className="rotate-180" />Back to sign in
        </a>
      </div>
    </div>
  );
}
