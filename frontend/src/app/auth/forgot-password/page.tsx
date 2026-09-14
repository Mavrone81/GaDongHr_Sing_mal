'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { canSubmitEmail } from '@/lib/passwordReset';
import GaDongLogo from '@/components/GaDongLogo';
import { AuthAlert, AuthTitle, AUTH_PRIMARY } from '@/components/auth/AuthSplit';
import { Field, Input, Icon } from '@/components/ui';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitEmail(email, submitting)) return;
    setSubmitting(true); setError('');
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      });
      // Server always returns the same generic message (no account enumeration).
      setDone(true);
    } catch (err) {
      setError((err as Error).message || 'Something went wrong. Please try again.');
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-page px-5 py-10 font-sans">
      <div className="w-full max-w-[440px] flex flex-col gap-6">
        <GaDongLogo variant="light" markSize={30} />
        <div className="bg-paper border border-rule rounded-card shadow-card p-6 sm:p-8 flex flex-col gap-5">
          <AuthTitle title="Reset your password" sub="Enter the email on your account and we'll send you a link to set a new password." />

          {done ? (
            <AuthAlert tone="ok">If that email is registered, a password-reset link is on its way. Check your inbox and spam folder — the link expires in 1 hour.</AuthAlert>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Field label="Work email">
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@company.com" autoFocus />
              </Field>
              {error && <AuthAlert>{error}</AuthAlert>}
              <button type="submit" disabled={!canSubmitEmail(email, submitting)} className={AUTH_PRIMARY}>
                {submitting ? 'Sending…' : 'Send reset link'}
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
