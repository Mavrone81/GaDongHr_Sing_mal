'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import GaDongLogo, { GaDongMark } from '@/components/GaDongLogo';

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

  return (
    <div className="flex min-h-screen w-full bg-paper font-sans">

      {/* Full-screen navigation overlay */}
      {navigating && (
        <div className="fixed inset-0 z-50 bg-shadow backdrop- flex flex-col items-center justify-center gap-6">
          <GaDongMark size={52} />

          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-accent border-t-accent animate-spin rounded-full" />
            <span className="text-[10px] font-black text-muted uppercase tracking-[0.3em]">Loading workspace…</span>
          </div>
        </div>
      )}

      {/* Left brand panel */}
      <div className="hidden lg:flex w-[45%] bg-shadow border-r border-shadow p-16 flex-col justify-between relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-accent blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-accent blur-[100px]" />
        <div className="relative z-10 space-y-10">
          <GaDongLogo variant="dark" markSize={48} />
          <div className="space-y-6">
            <h1 className="text-5xl font-black text-paper tracking-tighter leading-[0.9]">
              Enterprise <br/><span className="text-highlight underline decoration-gold-500/40 underline-offset-8">Intelligence</span> Suite
            </h1>
            <p className="text-muted max-w-sm leading-relaxed text-[13px] font-bold uppercase tracking-widest opacity-80">
              Operational Command Center for modern personnel management, payroll terminal, and departmental auditing.
            </p>
          </div>
          <div className="flex flex-col gap-4 pt-10">
            {[{ icon: '🔒', text: 'Military-Grade Encryption' }, { icon: '📋', text: 'Section 2 RBAC Compliant' }, { icon: '⏱️', text: 'Real-time Analytics Feed' }].map((f, i) => (
              <div key={i} className="flex items-center gap-3 text-muted font-black text-[10px] tracking-widest uppercase">
                <span className="opacity-50">{f.icon}</span>{f.text}
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-[10px] text-ink font-black tracking-[0.3em] uppercase">
          © 2026 Urben Werkz Group SG • UW-HRMS-001 • v1.1.0-STABLE
        </div>
      </div>

      {/* Right auth panel */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 sm:px-12 lg:px-24 bg-page">
        <div className="w-full max-w-sm space-y-8">

          {/* ── Credentials step ── */}
          {step === 'credentials' && (
            <>
              <div>
                <h2 className="text-sm font-black text-ink tracking-[0.2em] uppercase mb-2">System Access Required</h2>
                <p className="text-xs font-bold text-muted uppercase tracking-widest">Identity verification for HRMS personnel.</p>
              </div>

              {/* SSO buttons */}
              {activeSso.length > 0 && (
                <div className="flex flex-col gap-3">
                  {activeSso.map(p => (
                    <button key={p.id} onClick={() => handleSso(p)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 bg-paper border border-rule text-xs font-black text-ink hover:border-accent hover:bg-page transition-all uppercase tracking-widest ">
                      <span className="w-6 h-6 bg-page flex items-center justify-center text-[11px] font-black">{p.icon}</span>
                      Continue with {p.name}
                    </button>
                  ))}
                  {ssoError && <p className="text-[10px] font-bold text-ink bg-page border border-highlight px-4 py-3 ">{ssoError}</p>}
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-rule" />
                    <span className="eyebrow-tight">or</span>
                    <div className="flex-1 h-px bg-rule" />
                  </div>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-5">
                {error && (
                  <div className="bg-ink border border-ink text-ink px-4 py-3 text-[11px] font-black uppercase tracking-widest">
                    ERR: {error}
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em] ml-1">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                    placeholder="e.g. admin@hrms.com"
                    className="w-full border border-rule bg-paper px-5 py-4 text-xs font-bold text-ink focus:border-accent focus:ring-4 focus:ring-accent transition-all outline-none " />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">Password</label>
                    <a href="/auth/forgot-password" className="text-[10px] font-black text-accent hover:text-accent tracking-widest">Reset</a>
                  </div>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                    placeholder="••••••••"
                    className="w-full border border-rule bg-paper px-5 py-4 text-xs font-bold text-ink focus:border-accent focus:ring-4 focus:ring-accent transition-all outline-none " />
                </div>
                <button type="submit" disabled={loading}
                  className={`w-full flex justify-center py-5 px-4    text-[11px] font-black text-paper bg-accent hover:bg-accent transition-all uppercase tracking-[0.3em] active:scale-95 ${loading ? 'opacity-70 pointer-events-none' : ''}`}>
                  {loading ? <><div className="w-3 h-3 border-2 border-paper/30 border-t-paper animate-spin mr-3 rounded-full" />Verifying…</> : 'Initialize Session'}
                </button>
              </form>
              <p className="mt-6 text-center text-xs text-muted">
                New company?{' '}
                <a href="/register" className="font-semibold text-accent hover:underline">Register &amp; start a free trial</a>
              </p>
            </>
          )}

          {/* ── MFA challenge (existing MFA users) ── */}
          {step === 'mfa-challenge' && (
            <>
              <div>
                <button onClick={() => { setStep('credentials'); setMfaCode(''); setError(''); }} className="eyebrow-tight hover:text-ink mb-4 flex items-center gap-1">← Back</button>
                <div className="w-14 h-14 flex items-center justify-center text-2xl mb-4 bg-page border-2 border-accent">
                  {mfaMethod === 'EMAIL_OTP' ? '📧' : '🔐'}
                </div>
                <h2 className="text-sm font-black text-ink tracking-[0.2em] uppercase mb-2">
                  {mfaMethod === 'EMAIL_OTP' ? 'Check Your Email' : 'Two-Factor Required'}
                </h2>
                {mfaMethod === 'EMAIL_OTP' ? (
                  <p className="text-xs font-bold text-muted uppercase tracking-widest">
                    A 6-digit code was sent to <strong className="text-ink">{email}</strong>. Enter it below.
                  </p>
                ) : mfaMethod === 'EITHER' ? (
                  <p className="text-xs font-bold text-muted uppercase tracking-widest">
                    Enter the code from your authenticator app, or from your email at <strong className="text-ink">{email}</strong>.
                  </p>
                ) : (
                  <p className="text-xs font-bold text-muted uppercase tracking-widest">
                    Open your authenticator app and enter the 6-digit code for <strong className="text-ink">{email}</strong>.
                  </p>
                )}
              </div>

              <div className="space-y-5">
                {error && <div className="bg-ink border border-ink text-ink px-4 py-3 text-[11px] font-black uppercase tracking-widest">ERR: {error}</div>}
                <div className="space-y-2">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">
                      {mfaMethod === 'EMAIL_OTP' ? 'Email Code' : 'Authenticator Code'}
                    </label>
                    {(mfaMethod === 'EMAIL_OTP' || mfaMethod === 'EITHER') && (
                      <button
                        onClick={handleResendOtp}
                        disabled={resendCooldown > 0 || loading}
                        className="text-[9px] font-black uppercase tracking-widest text-accent hover:text-accent disabled:text-muted disabled:pointer-events-none transition-colors"
                      >
                        {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={mfaCode}
                    onChange={e => handleMfaCodeChange(e.target.value)}
                    placeholder="000000"
                    autoFocus
                    disabled={loading}
                    className={`w-full  border bg-paper px-5 py-4 text-2xl font-black text-ink tracking-[0.4em] text-center transition-all outline-none  disabled:opacity-60 ${
                      mfaCode.length === 6 ? 'border-accent ring-4 ring-accent' : 'border-rule focus:border-accent focus:ring-4 focus:ring-accent'
                    }`}
                  />
                  <p className="text-[9px] font-bold text-muted uppercase tracking-widest text-center">
                    {loading ? 'Verifying…' : mfaCode.length === 6 ? 'Submitting…' : `${6 - mfaCode.length} digit${6 - mfaCode.length !== 1 ? 's' : ''} remaining`}
                  </p>
                </div>
                {loading && (
                  <div className="flex items-center justify-center gap-3 py-2">
                    <div className="w-4 h-4 border-2 border-accent border-t-accent animate-spin rounded-full" />
                    <span className="eyebrow-tight">Verifying…</span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── MFA setup: scan + verify on one screen ── */}
          {step === 'mfa-setup' && (
            <>
              <div>
                <div className="w-14 h-14 bg-page border-2 border-highlight flex items-center justify-center text-2xl mb-4">🛡️</div>
                <h2 className="text-sm font-black text-ink tracking-[0.2em] uppercase mb-2">Set Up Two-Factor Auth</h2>
                <p className="text-xs font-bold text-muted uppercase tracking-widest">
                  Scan with <strong className="text-ink">Microsoft Authenticator</strong>, Google Authenticator, Authy or any TOTP app — then enter the 6-digit code below.
                </p>
              </div>

              {/* QR code card */}
              <div className="flex flex-col items-center gap-3 p-6 bg-paper border border-rule ">
                {qrCode
                  ? <img src={qrCode} alt="MFA QR Code" className="w-44 h-44 " />
                  : <div className="w-44 h-44 bg-page animate-pulse" />
                }
                <div className="text-center">
                  <p className="label-form mb-1">Can&apos;t scan? Enter manually</p>
                  <p className="text-[10px] font-mono font-black text-ink tracking-widest break-all select-all">{mfaSecret}</p>
                </div>
              </div>

              {/* Instruction + auto-submit OTP input */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`w-5 h-5  flex items-center justify-center text-[9px] font-black transition-all ${qrScanned ? 'bg-accent text-paper' : 'bg-rule text-muted'}`}>
                    {qrScanned ? '✓' : '1'}
                  </div>
                  <p className="text-[10px] font-black text-muted uppercase tracking-widest">Scan the QR code with your authenticator</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 bg-page text-accent flex items-center justify-center text-[9px] font-black">2</div>
                  <p className="text-[10px] font-black text-muted uppercase tracking-widest">Enter the 6-digit code — auto-submits</p>
                </div>
              </div>

              {error && (
                <div className="bg-ink border border-ink text-ink px-4 py-3 text-[11px] font-black uppercase tracking-widest">
                  ERR: {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-[0.2em] ml-1">Authenticator Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={setupCode}
                  onChange={e => { setQrScanned(true); handleSetupCodeChange(e.target.value); }}
                  placeholder="000000"
                  autoFocus
                  disabled={loading}
                  className={`w-full  border bg-paper px-5 py-4 text-2xl font-black text-ink tracking-[0.4em] text-center transition-all outline-none  disabled:opacity-60 ${
                    setupCode.length === 6 ? 'border-accent ring-4 ring-accent' : 'border-rule focus:border-accent focus:ring-4 focus:ring-accent'
                  }`}
                />
                <p className="text-[9px] font-bold text-muted uppercase tracking-widest text-center">
                  {loading ? 'Verifying…' : setupCode.length === 6 ? 'Submitting…' : `${6 - setupCode.length} digit${6 - setupCode.length !== 1 ? 's' : ''} remaining`}
                </p>
              </div>

              {loading && (
                <div className="flex items-center justify-center gap-3 py-3">
                  <div className="w-4 h-4 border-2 border-accent border-t-accent animate-spin rounded-full" />
                  <span className="eyebrow-tight">Activating MFA…</span>
                </div>
              )}
            </>
          )}

          <div className="text-center text-[9px] font-black text-muted uppercase tracking-[0.4em] opacity-40">
            SECURE PORTAL ENTRY
          </div>
        </div>
      </div>
    </div>
  );
}
