'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { GaDongMark } from '@/components/GaDongLogo';
import AuthSplit, { AuthAlert, AuthTitle, AUTH_PRIMARY } from '@/components/auth/AuthSplit';
import CodeInput from '@/components/auth/CodeInput';
import { Field, Input, Icon } from '@/components/ui';

type Step = 'credentials' | 'mfa-challenge' | 'mfa-setup';
type MfaMethod = 'TOTP' | 'EMAIL_OTP' | 'EITHER';

interface SsoProvider { id: string; name: string; icon: string; }
const ALL_SSO: SsoProvider[] = [
  { id: 'google',    name: 'Google',    icon: 'G' },
  { id: 'microsoft', name: 'Microsoft', icon: 'M' },
  { id: 'apple',     name: 'Apple',     icon: '⌘' },
  { id: 'okta',      name: 'Okta',      icon: 'O' },
];

function apiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:4000/api`;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const c = document.cookie.split('; ').find(r => r.startsWith('gadonghr_token='));
  return c ? c.split('=').slice(1).join('=') : null;
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaMethod, setMfaMethod] = useState<MfaMethod>('TOTP');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);

  // MFA setup state
  const [qrCode, setQrCode]     = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [qrScanned, setQrScanned] = useState(false);

  // SSO from settings
  const [activeSso, setActiveSso] = useState<SsoProvider[]>([]);
  const [ssoConfig, setSsoConfig] = useState<Record<string, { clientId: string; domain: string; tenantId?: string }>>({});
  const [ssoError, setSsoError] = useState('');

  // SSO MFA pending state (set by callback pages via sessionStorage + ?sso_mfa=1)
  const [ssoMfaPending, setSsoMfaPending] = useState(false);
  const [ssoPendingToken, setSsoPendingToken] = useState('');

  useEffect(() => {
    // Check if we were redirected here from an SSO callback that needs MFA.
    // H-19: the pending token now lives in an HttpOnly cookie, so we no longer
    // read it from sessionStorage. We only check the SSO MFA routing flag.
    const params = new URLSearchParams(window.location.search);
    if (params.get('sso_mfa') === '1') {
      const method = (sessionStorage.getItem('sso_mfa_method') || 'TOTP') as MfaMethod;
      setSsoMfaPending(true);
      setSsoPendingToken(''); // pendingToken not needed client-side; cookie carries it
      setMfaMethod(method);
      setStep('mfa-challenge');
    }
  }, []);

  useEffect(() => {
    // Fetch SSO configs from server for each provider
    Promise.all([
      fetch(`${apiUrl()}/auth/sso/google/config`).then(r => r.json()).catch(() => null),
      fetch(`${apiUrl()}/auth/sso/microsoft/config`).then(r => r.json()).catch(() => null),
    ]).then(([google, microsoft]) => {
      const active: SsoProvider[] = [];
      const cfg: Record<string, any> = {};
      if (google?.clientId) { cfg.google = { clientId: google.clientId, domain: google.domain }; active.push(ALL_SSO.find(p => p.id === 'google')!); }
      if (microsoft?.clientId) { cfg.microsoft = { clientId: microsoft.clientId, tenantId: microsoft.tenantId, domain: microsoft.domain }; active.push(ALL_SSO.find(p => p.id === 'microsoft')!); }
      if (Object.keys(cfg).length > 0) { setSsoConfig(cfg); setActiveSso(active.filter(Boolean)); return; }
      // Fall back to localStorage
      try {
        const saved = localStorage.getItem('gadonghr_security_settings');
        if (!saved) return;
        const settings = JSON.parse(saved);
        const enabled = (settings.ssoEnabled ?? {}) as Record<string, boolean>;
        const lsCfg = (settings.ssoConfig ?? {}) as Record<string, any>;
        setSsoConfig(lsCfg);
        setActiveSso(ALL_SSO.filter(p => enabled[p.id] && lsCfg[p.id]?.clientId?.trim()));
      } catch {}
    });
  }, []);

  const orgMfaRequired = () => {
    try {
      const s = localStorage.getItem('gadonghr_security_settings');
      return s ? JSON.parse(s).mfaRequired === true : false;
    } catch { return false; }
  };

  // ── Step 1: password login ────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${apiUrl()}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok) { setError(data.error || 'Invalid credentials'); return; }

      // Server says this account already has MFA enabled → challenge step
      if (data.mfaRequired) {
        setMfaMethod(data.mfaMethod || 'TOTP');
        setStep('mfa-challenge');
        if (data.mfaMethod === 'EMAIL_OTP' || data.mfaMethod === 'EITHER') {
          setResendCooldown(60);
        }
        return;
      }

      // Server indicates org MFA required but user not yet enrolled — run setup flow
      if (data.mfaSetupRequired) {
        await login(data.accessToken, data.refreshToken);
        const setupRes = await fetch(`${apiUrl()}/auth/mfa/setup`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        });
        if (setupRes.ok) {
          const setup = await setupRes.json();
          setQrCode(setup.qrCode);
          setMfaSecret(setup.secret);
          setStep('mfa-setup');
          return;
        }
      }

      // Successful login — no MFA required
      await login(data.accessToken, data.refreshToken);
      setNavigating(true);
      router.push('/');
    } catch {
      setError(`Cannot reach API. Is the gateway running on port 4000?`);
    } finally { setLoading(false); }
  };

  // ── Step 2a: submit TOTP for existing MFA users ───────────────────────────
  const handleMfaChallenge = async (code: string) => {
    setError(''); setLoading(true);
    try {
      // SSO MFA path — pending token is in an HttpOnly cookie set by the
      // SSO callback. credentials:'include' attaches it to the verify call.
      if (ssoMfaPending) {
        const res = await fetch(`${apiUrl()}/auth/sso/mfa-verify`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mfaCode: code }),
        });
        const data = await res.json();
        if (!res.ok) { setMfaCode(''); setError(data.error || 'Invalid MFA code'); return; }
        sessionStorage.removeItem('sso_mfa_method');
        sessionStorage.removeItem('sso_mfa_setup');
        await login(data.accessToken, data.refreshToken);
        setNavigating(true);
        router.push('/');
        return;
      }
      // Regular login MFA path
      const res = await fetch(`${apiUrl()}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, mfaCode: code }),
      });
      const data = await res.json();
      if (!res.ok) { setMfaCode(''); setError(data.error || 'Invalid MFA code'); return; }
      await login(data.accessToken, data.refreshToken);
      setNavigating(true);
      router.push('/');
    } catch { setError('Connection error'); }
    finally { setLoading(false); }
  };

  const handleMfaCodeChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 6);
    setMfaCode(digits);
    if (digits.length === 6) handleMfaChallenge(digits);
  };

  // Countdown timer for resend button
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleResendOtp = async () => {
    setError('');
    try {
      await fetch(`${apiUrl()}/auth/otp/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      setResendCooldown(60);
    } catch { setError('Failed to resend code'); }
  };

  // ── Step 2b: verify new MFA enrollment ────────────────────────────────────
  const handleMfaSetupVerify = async (code: string) => {
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${apiUrl()}/auth/mfa/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSetupCode('');
        setError(data.error || 'Invalid code — wait for the next code and try again');
        return;
      }
      setNavigating(true);
      router.push('/');
    } catch { setError('Connection error'); }
    finally { setLoading(false); }
  };

  const handleSetupCodeChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 6);
    setSetupCode(digits);
    if (digits.length === 6) handleMfaSetupVerify(digits);
  };

  // ── SSO click ─────────────────────────────────────────────────────────────
  const handleSso = (provider: SsoProvider) => {
    setSsoError('');
    const cfg = ssoConfig[provider.id];
    if (!cfg?.clientId) {
      setSsoError(`No Client ID configured for ${provider.name} SSO. Set it in Settings → Security.`);
      return;
    }

    if (provider.id === 'google') {
      const redirectUri = `${window.location.origin}/auth/callback/google`;
      const p = new URLSearchParams({
        client_id: cfg.clientId, redirect_uri: redirectUri,
        response_type: 'code', scope: 'openid email profile',
        access_type: 'offline', prompt: 'select_account',
      });
      window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    } else if (provider.id === 'microsoft') {
      const tenant = cfg.tenantId || 'common';
      const redirectUri = `${window.location.origin}/auth/callback/microsoft`;
      const p = new URLSearchParams({
        client_id: cfg.clientId, redirect_uri: redirectUri,
        response_type: 'code', response_mode: 'query',
        scope: 'openid email profile', prompt: 'select_account',
      });
      window.location.href = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${p}`;
    } else {
      setSsoError(`SSO for ${provider.name} not yet implemented.`);
    }
  };

  const remaining = (code: string) => `${6 - code.length} digit${6 - code.length === 1 ? '' : 's'} remaining`;

  return (
    <AuthSplit
      headline="HR and payroll, built for Singapore's and Malaysia's rules."
      sub="CPF, IRAS, MOM and SDL handled in one place; EPF, SOCSO, EIS and PCB for your Malaysian entities."
    >
      {navigating && (
        <div className="fixed inset-0 z-50 bg-page flex flex-col items-center justify-center gap-4" role="status">
          <GaDongMark size={44} tone="ink" className="text-accent" />
          <div className="w-7 h-7 border-[3px] border-rule border-t-accent animate-spin rounded-full" />
          <span className="text-sm text-muted">Opening your workspace…</span>
        </div>
      )}

      {step === 'credentials' && (
        <>
          <AuthTitle title="Sign in" sub="Use your work email and password." />

          <form onSubmit={handleLogin} className="flex flex-col gap-[14px]">
            {error && <AuthAlert>{error}</AuthAlert>}
            <Field label="Work email">
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@company.com" />
            </Field>
            <Field label="Password">
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" placeholder="Your password" />
            </Field>
            <div className="flex justify-end text-[13px]">
              <a href="/auth/forgot-password" className="text-accent font-semibold hover:underline">Forgot password?</a>
            </div>
            <button type="submit" disabled={loading} className={AUTH_PRIMARY}>
              {loading ? <><div className="w-4 h-4 border-2 border-on-accent/30 border-t-on-accent animate-spin rounded-full" />Signing in…</> : 'Sign in'}
            </button>
          </form>

          {activeSso.length > 0 && (
            <>
              <div className="flex items-center gap-3 text-[12.5px] text-faint">
                <div className="flex-1 h-px bg-rule" />or<div className="flex-1 h-px bg-rule" />
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5">
                {activeSso.map(p => (
                  <button key={p.id} type="button" onClick={() => handleSso(p)}
                    className="flex-1 h-11 rounded-control border border-rule bg-paper text-sm font-semibold text-ink hover:bg-page flex items-center justify-center gap-2.5">
                    <span className="w-[18px] h-[18px] rounded bg-pill border border-rule text-xs font-bold flex items-center justify-center">{p.icon}</span>
                    {p.name}
                  </button>
                ))}
              </div>
              {ssoError && <AuthAlert tone="warn">{ssoError}</AuthAlert>}
            </>
          )}

          <p className="text-[13.5px] text-muted text-center">
            New company? <a href="/register" className="text-accent font-bold hover:underline">Start your free trial</a> — 14 days, no credit card.
          </p>
        </>
      )}

      {step === 'mfa-challenge' && (
        <>
          <button type="button" onClick={() => { setStep('credentials'); setMfaCode(''); setError(''); }} className="self-start inline-flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink">
            <Icon name="chevronRight" size={14} className="rotate-180" />Back to sign in
          </button>
          <AuthTitle
            title={mfaMethod === 'EMAIL_OTP' ? 'Check your email' : 'Enter your code'}
            sub={
              mfaMethod === 'EMAIL_OTP' ? <>We sent a 6-digit code to <strong className="text-ink">{email}</strong>. Enter it below — it submits automatically.</>
              : mfaMethod === 'EITHER' ? <>Enter the code from your authenticator app, or from the email we sent to <strong className="text-ink">{email}</strong>.</>
              : <>Open your authenticator app and enter the 6-digit code for GaDongHR. It submits automatically.</>
            }
          />
          {error && <AuthAlert>{error}</AuthAlert>}
          <CodeInput value={mfaCode} onChange={handleMfaCodeChange} disabled={loading} label={mfaMethod === 'EMAIL_OTP' ? 'Email code' : 'Authenticator code'} />
          {(email || ssoMfaPending) && (
            <AuthAlert tone="info">{ssoMfaPending ? 'Signing in with single sign-on from a new browser.' : <>Signing in as <strong>{email}</strong> from a new browser.</>}</AuthAlert>
          )}
          <div className="flex items-center justify-between text-[13.5px]">
            {(mfaMethod === 'EMAIL_OTP' || mfaMethod === 'EITHER') ? (
              <button type="button" onClick={handleResendOtp} disabled={resendCooldown > 0 || loading} className="text-accent font-semibold hover:underline disabled:text-faint disabled:no-underline">
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
              </button>
            ) : <span />}
            <span className="text-muted">{loading ? 'Verifying…' : mfaCode.length === 6 ? 'Submitting…' : remaining(mfaCode)}</span>
          </div>
        </>
      )}

      {step === 'mfa-setup' && (
        <>
          <AuthTitle
            title="Set up two-factor authentication"
            sub={<>Your company requires it. Scan the code with <strong className="text-ink">Microsoft Authenticator</strong>, Google Authenticator, Authy or any TOTP app, then enter the 6-digit code — it submits automatically.</>}
          />
          <div className="flex flex-col items-center gap-3 p-5 bg-paper border border-rule rounded-card">
            {qrCode
              ? <img src={qrCode} alt="QR code for your authenticator app" className="w-44 h-44 rounded-control" />
              : <div className="w-44 h-44 bg-pill rounded-control animate-pulse" />
            }
            <div className="text-center">
              <p className="text-xs text-muted inline-flex items-center gap-1.5">{qrScanned && <Icon name="check" size={13} className="text-ok" strokeWidth={2.5} />}Can&apos;t scan? Enter this key manually</p>
              <p className="mt-1 text-[13px] font-mono font-semibold text-ink break-all select-all">{mfaSecret}</p>
            </div>
          </div>
          {error && <AuthAlert>{error}</AuthAlert>}
          <CodeInput value={setupCode} onChange={(v) => { setQrScanned(true); handleSetupCodeChange(v); }} disabled={loading} label="Authenticator code" />
          <p className="text-[13px] text-muted text-center">{loading ? 'Activating two-factor…' : setupCode.length === 6 ? 'Submitting…' : remaining(setupCode)}</p>
        </>
      )}
    </AuthSplit>
  );
}
