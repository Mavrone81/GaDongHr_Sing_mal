'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { validateNewPassword, tokenFromQuery, pwStrength } from '@/lib/passwordReset';

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-md border border-rule bg-paper p-8">
        <h1 className="text-lg font-black text-ink tracking-tight">Choose a new password</h1>

        {done ? (
          <div className="mt-6 bg-page border border-accent px-4 py-4">
            <p className="text-[11px] font-black text-accent leading-relaxed">
              ✓ Your password has been reset. Redirecting you to sign in…
            </p>
          </div>
        ) : noToken ? (
          <div className="mt-6 bg-page border border-highlight px-4 py-4">
            <p className="text-[11px] font-black text-ink leading-relaxed">
              This reset link is missing or invalid. Please request a new one.
            </p>
            <a href="/auth/forgot-password" className="mt-3 inline-block text-[10px] font-black text-accent hover:text-accent tracking-widest uppercase">Request new link →</a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em] ml-1">New Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="Min. 8 characters"
                className="w-full border border-rule bg-paper px-5 py-4 text-xs font-bold text-ink focus:border-accent focus:ring-4 focus:ring-accent transition-all outline-none "
              />
              {/* Strength meter — identical to the admin user panel (@/lib/passwordReset) */}
              {password && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className={`h-1.5 flex-1  transition-all ${i <= strength.score ? strength.color : 'bg-rule'}`} />
                    ))}
                  </div>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${strength.score >= 3 ? 'text-accent' : 'text-ink'}`}>
                    {strength.label}
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em] ml-1">Confirm Password</label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                placeholder="Re-enter password"
                className={`w-full  border bg-paper px-5 py-4 text-xs font-bold text-ink focus:ring-4 focus:ring-accent transition-all outline-none  ${
                  confirm && password !== confirm ? 'border-ink focus:border-ink' : 'border-rule focus:border-accent'
                }`}
              />
            </div>

            {error && (
              <p className="text-[10px] font-black text-ink bg-page px-4 py-2.5 border border-ink">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !password || password !== confirm}
              className="w-full py-4 px-4 text-[11px] font-black text-paper bg-accent hover:bg-accent transition-all uppercase tracking-[0.3em] active:scale-95 disabled:opacity-40"
            >
              {submitting ? 'Resetting…' : 'Set new password'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <a href="/login" className="text-[10px] font-black text-accent hover:text-accent tracking-widest uppercase">← Back to sign in</a>
        </div>
      </div>
    </div>
  );
}
