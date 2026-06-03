'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { canSubmitEmail } from '@/lib/passwordReset';

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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl p-8">
        <h1 className="text-lg font-black text-slate-900 tracking-tight">Reset your password</h1>
        <p className="mt-1 text-xs font-bold text-slate-500 leading-relaxed">
          Enter the email on your account and we&apos;ll send you a link to set a new password.
        </p>

        {done ? (
          <div className="mt-6 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-4">
            <p className="text-[11px] font-black text-emerald-700 leading-relaxed">
              If that email is registered, a password-reset link is on its way. Check your inbox (and spam) — the link expires in 1 hour.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="e.g. you@company.com"
                className="w-full rounded-xl border border-slate-200 bg-white px-5 py-4 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all outline-none shadow-sm"
              />
            </div>

            {error && (
              <p className="text-[10px] font-black text-red-500 bg-red-50 px-4 py-2.5 rounded-xl border border-red-200">{error}</p>
            )}

            <button
              type="submit"
              disabled={!canSubmitEmail(email, submitting)}
              className="w-full py-4 px-4 rounded-xl shadow-lg shadow-indigo-600/20 text-[11px] font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-all uppercase tracking-[0.3em] active:scale-95 disabled:opacity-40"
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <a href="/login" className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 tracking-widest uppercase">← Back to sign in</a>
        </div>
      </div>
    </div>
  );
}
