'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

function apiUrl() {
  if (typeof window === 'undefined') return 'http://localhost:4000/api';
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${window.location.hostname}:4000/api`;
}

function getSearchParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export default function GoogleCallbackPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    // Once we start navigating away, suppress any late error state updates
    // (covers Strict Mode double-invoke and login() internal failures)
    let navigating = false;

    const params = getSearchParams();
    const code = params.get('code');
    const errorParam = params.get('error');
    const errorDescription = params.get('error_description');

    if (errorParam) {
      setErrorMsg(errorParam === 'access_denied' ? 'You declined the Google sign-in request.' : (errorDescription || errorParam));
      setStatus('error');
      return () => controller.abort();
    }

    if (!code) {
      setErrorMsg('No authorization code received from Google.');
      setStatus('error');
      return () => controller.abort();
    }

    const redirectUri = `${window.location.origin}/auth/callback/google`;

    fetch(`${apiUrl()}/auth/sso/google/callback`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
      signal: controller.signal,
    })
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
      })
      .then(async data => {
        navigating = true;
        if (data.ssoMfaPending) {
          // H-19: pendingToken is in an HttpOnly cookie set by auth-service.
          // We deliberately do NOT store it in sessionStorage; only stash
          // non-secret routing flags (which MFA method, whether setup is
          // required) so the /login MFA step knows what UI to render.
          sessionStorage.setItem('sso_mfa_method', data.mfaMethod || 'TOTP');
          sessionStorage.setItem('sso_mfa_setup', data.mfaSetupRequired ? '1' : '0');
          router.replace('/login?sso_mfa=1');
          return;
        }
        await login(data.accessToken);
        router.replace('/');
      })
      .catch(err => {
        // Ignore aborted requests (Strict Mode cleanup) and post-navigation errors
        if (controller.signal.aborted || navigating) return;
        setErrorMsg(err.message || 'Sign-in failed. Please try again.');
        setStatus('error');
      });

    return () => controller.abort();
  }, []);

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="bg-paper border border-rule p-10 w-full max-w-sm text-center flex flex-col items-center gap-5">
          <div className="w-14 h-14 bg-page border-2 border-ink flex items-center justify-center text-2xl">✕</div>
          <div>
            <h2 className="text-sm font-black text-ink tracking-tighter mb-1">Sign-In Failed</h2>
            <p className="text-xs font-bold text-muted">{errorMsg}</p>
          </div>
          <button onClick={() => router.replace('/login')}
            className="px-6 py-3 bg-accent hover:bg-accent text-paper text-xs font-black uppercase tracking-widest transition-all">
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-6">
      <div className="bg-paper border border-rule p-10 w-full max-w-sm text-center flex flex-col items-center gap-5">
        <div className="w-14 h-14 bg-page border-2 border-accent flex items-center justify-center">
          <svg className="w-6 h-6 text-accent animate-spin rounded-full" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-black text-ink tracking-tighter mb-1">Completing Sign-In</h2>
          <p className="text-xs font-bold text-muted uppercase tracking-widest">Verifying your Google account…</p>
        </div>
      </div>
    </div>
  );
}
