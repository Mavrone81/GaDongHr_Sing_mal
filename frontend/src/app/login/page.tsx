'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

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
  const c = document.cookie.split('; ').find(r => r.startsWith('vorkhive_token='));
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

  // MFA setup state
  const [qrCode, setQrCode]     = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [qrScanned, setQrScanned] = useState(false);

  // SSO from settings
  const [activeSso, setActiveSso] = useState<SsoProvider[]>([]);
  const [ssoError, setSsoError] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('vorkhive_security_settings');
      if (!saved) return;
      const settings = JSON.parse(saved);
      const enabled = (settings.ssoEnabled ?? {}) as Record<string, boolean>;
      const cfg = (settings.ssoConfig ?? {}) as Record<string, { clientId: string }>;
      setActiveSso(ALL_SSO.filter(p => enabled[p.id] && cfg[p.id]?.clientId?.trim()));
    } catch {}
  }, []);

  const orgMfaRequired = () => {
    try {
      const s = localStorage.getItem('vorkhive_security_settings');
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
        await login(data.accessToken);
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
      await login(data.accessToken);
      router.push('/');
    } catch {
      setError(`Cannot reach API. Is the gateway running on port 4000?`);
    } finally { setLoading(false); }
  };

  // ── Step 2a: submit TOTP for existing MFA users ───────────────────────────
  const handleMfaChallenge = async (code: string) => {
    setError(''); setLoading(true);
    try {
      const res = await fetch(`${apiUrl()}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, mfaCode: code }),
      });
      const data = await res.json();
      if (!res.ok) { setMfaCode(''); setError(data.error || 'Invalid MFA code'); return; }
      await login(data.accessToken);
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
    // In production this would redirect to OAuth authorization URL.
    // For local dev, redirect to callback placeholder with provider hint.
    const callbackUrl = `${window.location.origin}/auth/callback/${provider.id}`;
    setSsoError(`SSO redirect → ${callbackUrl} (configure OAuth app in your ${provider.name} console to complete)`);
  };

  return (
    <div className="flex min-h-screen w-full bg-white font-sans">

      {/* Left brand panel */}
      <div className="hidden lg:flex w-[45%] bg-slate-950 border-r border-slate-900 p-16 flex-col justify-between relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-[100px]" />
        <div className="relative z-10 space-y-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center shadow-2xl shadow-indigo-500/40">
              <img src="/logo.png" alt="Vorkhive" className="w-8 h-8 object-contain brightness-0 invert" />
            </div>
            <span className="text-2xl font-black text-white tracking-[0.2em] uppercase">Vorkhive</span>
          </div>
          <div className="space-y-6">
            <h1 className="text-5xl font-black text-white tracking-tighter leading-[0.9]">
              Enterprise <br/><span className="text-indigo-500 underline decoration-indigo-500/30 underline-offset-8">Intelligence</span> Suite
            </h1>
            <p className="text-slate-400 max-w-sm leading-relaxed text-[13px] font-bold uppercase tracking-widest opacity-80">
              Operational Command Center for modern personnel management, payroll terminal, and departmental auditing.
            </p>
          </div>
          <div className="flex flex-col gap-4 pt-10">
            {[{ icon: '🔒', text: 'Military-Grade Encryption' }, { icon: '📋', text: 'Section 2 RBAC Compliant' }, { icon: '⏱️', text: 'Real-time Analytics Feed' }].map((f, i) => (
              <div key={i} className="flex items-center gap-3 text-slate-500 font-black text-[10px] tracking-widest uppercase">
                <span className="opacity-50">{f.icon}</span>{f.text}
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-[10px] text-slate-600 font-black tracking-[0.3em] uppercase">
          © 2026 RMA Group SG • RM-HRMS-001 • v1.1.0-STABLE
        </div>
      </div>

      {/* Right auth panel */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 sm:px-12 lg:px-24 bg-slate-50/30">
        <div className="w-full max-w-sm space-y-8">

          {/* ── Credentials step ── */}
          {step === 'credentials' && (
            <>
              <div>
                <h2 className="text-sm font-black text-slate-900 tracking-[0.2em] uppercase mb-2">System Access Required</h2>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Identity verification for HRMS personnel.</p>
              </div>

              {/* SSO buttons */}
              {activeSso.length > 0 && (
                <div className="flex flex-col gap-3">
                  {activeSso.map(p => (
                    <button key={p.id} onClick={() => handleSso(p)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 hover:border-indigo-400 hover:bg-indigo-50/50 transition-all uppercase tracking-widest shadow-sm">
                      <span className="w-6 h-6 bg-slate-100 rounded-lg flex items-center justify-center text-[11px] font-black">{p.icon}</span>
                      Continue with {p.name}
                    </button>
                  ))}
                  {ssoError && <p className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-4 py-3 rounded-xl">{ssoError}</p>}
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">or</span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-5">
                {error && (
                  <div className="bg-red-500/5 border border-red-500/20 text-red-600 px-4 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest">
                    ERR: {error}
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                    placeholder="e.g. admin@hrms.com"
                    className="w-full rounded-xl border border-slate-200 bg-white px-5 py-4 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all outline-none shadow-sm" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Password</label>
                    <a href="#" className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 tracking-widest">Reset</a>
                  </div>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-slate-200 bg-white px-5 py-4 text-xs font-bold text-slate-900 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all outline-none shadow-sm" />
                </div>
                <button type="submit" disabled={loading}
                  className={`w-full flex justify-center py-5 px-4 rounded-xl shadow-xl shadow-indigo-600/20 text-[11px] font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-all uppercase tracking-[0.3em] active:scale-95 ${loading ? 'opacity-70 pointer-events-none' : ''}`}>
                  {loading ? <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin mr-3" />Verifying…</> : 'Initialize Session'}
                </button>
              </form>
            </>
          )}

          {/* ── MFA challenge (existing MFA users) ── */}
          {step === 'mfa-challenge' && (
            <>
              <div>
                <button onClick={() => { setStep('credentials'); setMfaCode(''); setError(''); }} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 mb-4 flex items-center gap-1">← Back</button>
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-4 ${mfaMethod === 'EMAIL_OTP' ? 'bg-sky-50 border-2 border-sky-200' : 'bg-indigo-50 border-2 border-indigo-200'}`}>
                  {mfaMethod === 'EMAIL_OTP' ? '📧' : '🔐'}
                </div>
                <h2 className="text-sm font-black text-slate-900 tracking-[0.2em] uppercase mb-2">
                  {mfaMethod === 'EMAIL_OTP' ? 'Check Your Email' : 'Two-Factor Required'}
                </h2>
                {mfaMethod === 'EMAIL_OTP' ? (
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    A 6-digit code was sent to <strong className="text-slate-600">{email}</strong>. Enter it below.
                  </p>
                ) : mfaMethod === 'EITHER' ? (
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    Enter the code from your authenticator app, or from your email at <strong className="text-slate-600">{email}</strong>.
                  </p>
                ) : (
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                    Open your authenticator app and enter the 6-digit code for <strong className="text-slate-600">{email}</strong>.
                  </p>
                )}
              </div>

              <div className="space-y-5">
                {error && <div className="bg-red-500/5 border border-red-500/20 text-red-600 px-4 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest">ERR: {error}</div>}
                <div className="space-y-2">
                  <div className="flex items-center justify-between ml-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                      {mfaMethod === 'EMAIL_OTP' ? 'Email Code' : 'Authenticator Code'}
                    </label>
                    {(mfaMethod === 'EMAIL_OTP' || mfaMethod === 'EITHER') && (
                      <button
                        onClick={handleResendOtp}
                        disabled={resendCooldown > 0 || loading}
                        className="text-[9px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-700 disabled:text-slate-300 disabled:pointer-events-none transition-colors"
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
                    className={`w-full rounded-xl border bg-white px-5 py-4 text-2xl font-black text-slate-900 tracking-[0.4em] text-center transition-all outline-none shadow-sm disabled:opacity-60 ${
                      mfaCode.length === 6 ? 'border-indigo-500 ring-4 ring-indigo-500/10' : 'border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5'
                    }`}
                  />
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center">
                    {loading ? 'Verifying…' : mfaCode.length === 6 ? 'Submitting…' : `${6 - mfaCode.length} digit${6 - mfaCode.length !== 1 ? 's' : ''} remaining`}
                  </p>
                </div>
                {loading && (
                  <div className="flex items-center justify-center gap-3 py-2">
                    <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Verifying…</span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── MFA setup: scan + verify on one screen ── */}
          {step === 'mfa-setup' && (
            <>
              <div>
                <div className="w-14 h-14 bg-amber-50 border-2 border-amber-200 rounded-2xl flex items-center justify-center text-2xl mb-4">🛡️</div>
                <h2 className="text-sm font-black text-slate-900 tracking-[0.2em] uppercase mb-2">Set Up Two-Factor Auth</h2>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  Scan with <strong className="text-slate-600">Microsoft Authenticator</strong>, Google Authenticator, Authy or any TOTP app — then enter the 6-digit code below.
                </p>
              </div>

              {/* QR code card */}
              <div className="flex flex-col items-center gap-3 p-6 bg-white border border-slate-200 rounded-2xl">
                {qrCode
                  ? <img src={qrCode} alt="MFA QR Code" className="w-44 h-44 rounded-xl" />
                  : <div className="w-44 h-44 rounded-xl bg-slate-100 animate-pulse" />
                }
                <div className="text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Can't scan? Enter manually</p>
                  <p className="text-[10px] font-mono font-black text-slate-600 tracking-widest break-all select-all">{mfaSecret}</p>
                </div>
              </div>

              {/* Instruction + auto-submit OTP input */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black transition-all ${qrScanned ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {qrScanned ? '✓' : '1'}
                  </div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Scan the QR code with your authenticator</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[9px] font-black">2</div>
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Enter the 6-digit code — auto-submits</p>
                </div>
              </div>

              {error && (
                <div className="bg-red-500/5 border border-red-500/20 text-red-600 px-4 py-3 rounded-xl text-[11px] font-black uppercase tracking-widest">
                  ERR: {error}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Authenticator Code</label>
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
                  className={`w-full rounded-xl border bg-white px-5 py-4 text-2xl font-black text-slate-900 tracking-[0.4em] text-center transition-all outline-none shadow-sm disabled:opacity-60 ${
                    setupCode.length === 6 ? 'border-indigo-500 ring-4 ring-indigo-500/10' : 'border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5'
                  }`}
                />
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-center">
                  {loading ? 'Verifying…' : setupCode.length === 6 ? 'Submitting…' : `${6 - setupCode.length} digit${6 - setupCode.length !== 1 ? 's' : ''} remaining`}
                </p>
              </div>

              {loading && (
                <div className="flex items-center justify-center gap-3 py-3">
                  <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Activating MFA…</span>
                </div>
              )}
            </>
          )}

          <div className="text-center text-[9px] font-black text-slate-400 uppercase tracking-[0.4em] opacity-40">
            SECURE PORTAL ENTRY
          </div>
        </div>
      </div>
    </div>
  );
}
