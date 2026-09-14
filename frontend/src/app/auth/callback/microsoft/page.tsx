'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import SsoCallbackScreen from '@/components/auth/SsoCallbackScreen';

function apiUrl() {
  if (typeof window === 'undefined') return 'http://localhost:4000/api';
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${window.location.hostname}:4000/api`;
}

function getSearchParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export default function MicrosoftCallbackPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let navigating = false;

    const params = getSearchParams();
    const code = params.get('code');
    const errorParam = params.get('error');
    const errorDescription = params.get('error_description');

    if (errorParam) {
      setErrorMsg(errorParam === 'access_denied' ? 'You declined the Microsoft sign-in request.' : (errorDescription || errorParam));
      setStatus('error');
      return () => controller.abort();
    }

    if (!code) {
      setErrorMsg('No authorization code received from Microsoft.');
      setStatus('error');
      return () => controller.abort();
    }

    const redirectUri = `${window.location.origin}/auth/callback/microsoft`;

    fetch(`${apiUrl()}/auth/sso/microsoft/callback`, {
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
          // H-19: pendingToken is held in an HttpOnly cookie; do not store
          // it in JS-accessible sessionStorage. Only routing hints are kept.
          sessionStorage.setItem('sso_mfa_method', data.mfaMethod || 'TOTP');
          sessionStorage.setItem('sso_mfa_setup', data.mfaSetupRequired ? '1' : '0');
          router.replace('/login?sso_mfa=1');
          return;
        }
        await login(data.accessToken);
        router.replace('/');
      })
      .catch(err => {
        if (controller.signal.aborted || navigating) return;
        setErrorMsg(err.message || 'Sign-in failed. Please try again.');
        setStatus('error');
      });

    return () => controller.abort();
  }, []);

  return <SsoCallbackScreen provider="Microsoft" status={status} errorMsg={errorMsg} onBack={() => router.replace('/login')} />;
}
