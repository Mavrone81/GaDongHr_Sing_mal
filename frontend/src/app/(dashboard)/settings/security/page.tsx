'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  const c = document.cookie.split('; ').find(r => r.startsWith('vorkhive_token='));
  return c ? c.split('=').slice(1).join('=') : null;
}
function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:4000/api`;
}
async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const h: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string> ?? {}) };
  if (token) h['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}${path}`, { ...opts, headers: h });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${res.status}`); }
  return res.json();
}

interface OrgUser { id: string; name: string; email: string; role: string; mfaEnabled: boolean; mfaExempt: boolean; isActive: boolean; }
interface ResetMfaState { userId: string; step: 'confirm' | 'loading'; }
type MfaMethod = 'TOTP' | 'EMAIL_OTP' | 'EITHER';

const MFA_METHOD_OPTIONS: { value: MfaMethod; label: string; desc: string; badge: string; badgeColor: string }[] = [
  {
    value: 'TOTP',
    label: 'Authenticator App (TOTP)',
    desc: 'Microsoft Authenticator, Google Authenticator, Authy — 6-digit rotating code. Most secure.',
    badge: 'Recommended',
    badgeColor: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  },
  {
    value: 'EMAIL_OTP',
    label: 'Email One-Time Password',
    desc: 'A 6-digit code is emailed to the user on each login. No app required.',
    badge: 'Easy Setup',
    badgeColor: 'bg-sky-100 text-sky-700 border-sky-200',
  },
  {
    value: 'EITHER',
    label: 'Either (User\'s Choice)',
    desc: 'Users with an authenticator app use TOTP; others receive an email code. Most flexible.',
    badge: 'Flexible',
    badgeColor: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  },
];

const SSO_PROVIDERS = [
  { id: 'google',    name: 'Google Workspace', icon: '🔵', desc: 'Sign in with Google accounts from your organisation domain' },
  { id: 'microsoft', name: 'Microsoft Azure AD', icon: '🟦', desc: 'Integrate with Microsoft Entra ID (formerly Azure AD)' },
  { id: 'apple',     name: 'Apple Business Connect', icon: '⚫', desc: 'Allow Sign in with Apple for supported users' },
  { id: 'okta',      name: 'Okta',  icon: '🟠', desc: 'Connect your Okta identity provider via OIDC/SAML' },
];

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${on ? 'bg-indigo-600' : 'bg-slate-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${on ? 'translate-x-6' : 'translate-x-0'}`} />
    </button>
  );
}

export default function SecurityPage() {
  const { user } = useAuth();

  // MFA policy
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaMethod, setMfaMethod] = useState<MfaMethod>('TOTP');
  const [savingMfaMethod, setSavingMfaMethod] = useState(false);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [disablingMfa, setDisablingMfa] = useState<string | null>(null);
  const [resetMfa, setResetMfa] = useState<ResetMfaState | null>(null);
  const [resetMfaMode, setResetMfaMode] = useState<'disable' | 'reset'>('reset');

  // SSO
  const [ssoEnabled, setSsoEnabled] = useState<Record<string, boolean>>({});
  const [ssoConfig, setSsoConfig] = useState<Record<string, { clientId: string; domain: string }>>({});
  const [expandedSso, setExpandedSso] = useState<string | null>(null);

  // Session policy
  const [sessionTimeout, setSessionTimeout] = useState('60');
  const [ipWhitelist, setIpWhitelist] = useState('');

  // UI
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [saving, setSaving] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Load persisted settings from localStorage + MFA method from API
  useEffect(() => {
    const saved = localStorage.getItem('vorkhive_security_settings');
    if (saved) {
      try {
        const s = JSON.parse(saved);
        if (s.mfaRequired !== undefined) setMfaRequired(s.mfaRequired);
        if (s.ssoEnabled) setSsoEnabled(s.ssoEnabled);
        if (s.ssoConfig) setSsoConfig(s.ssoConfig);
        if (s.sessionTimeout) setSessionTimeout(s.sessionTimeout);
        if (s.ipWhitelist !== undefined) setIpWhitelist(s.ipWhitelist);
      } catch {}
    }

    // Load live MFA settings from server (overrides localStorage)
    apiFetch('/auth/org-settings/mfa').then(d => {
      if (d?.mfaMethod) setMfaMethod(d.mfaMethod as MfaMethod);
      if (d?.mfaRequired !== undefined) setMfaRequired(d.mfaRequired);
    }).catch(() => {});
  }, []);

  // Fetch user MFA status
  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch('/users?limit=200');
        const list: OrgUser[] = (data.users ?? data ?? []).map((u: any) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          mfaEnabled: u.mfaEnabled ?? false,
          mfaExempt: u.mfaExempt ?? false,
          isActive: u.isActive ?? true,
        }));
        setUsers(list);
      } catch { /* non-critical */ }
      finally { setUsersLoading(false); }
    }
    load();
  }, []);

  const mfaCount = users.filter(u => u.mfaEnabled).length;

  const handleDisableMfa = async (userId: string, userName: string) => {
    setDisablingMfa(userId);
    try {
      await apiFetch('/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ userId }) });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, mfaEnabled: false } : u));
      showToast(`MFA disabled for ${userName} — they can re-enable without re-scanning`);
    } catch (e: any) {
      showToast(e.message || 'Failed to disable MFA', 'error');
    } finally {
      setDisablingMfa(null);
    }
  };

  const handleResetMfa = (userId: string, mode: 'disable' | 'reset') => {
    setResetMfaMode(mode);
    setResetMfa({ userId, step: 'confirm' });
  };

  const confirmResetMfa = async () => {
    if (!resetMfa) return;
    const { userId } = resetMfa;
    const u = users.find(x => x.id === userId);
    setResetMfa({ userId, step: 'loading' });
    try {
      const endpoint = resetMfaMode === 'reset' ? '/auth/mfa/reset' : '/auth/mfa/disable';
      await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ userId }) });
      setUsers(prev => prev.map(x => x.id === userId ? { ...x, mfaEnabled: false } : x));
      if (resetMfaMode === 'reset') {
        showToast(`MFA reset for ${u?.name ?? 'user'} — they must re-enroll on next setup`);
      } else {
        showToast(`MFA disabled for ${u?.name ?? 'user'} — they can re-enable without re-scanning`);
      }
    } catch (e: any) {
      showToast(e.message || 'Failed to update MFA', 'error');
    } finally {
      setResetMfa(null);
    }
  };

  const handleEnableMfa = async (userId: string, userName: string) => {
    try {
      const res = await apiFetch('/auth/mfa/enable', { method: 'POST', body: JSON.stringify({ userId }) });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, mfaEnabled: res.mfaEnabled ?? u.mfaEnabled, mfaExempt: false } : u));
      showToast(res.message || `MFA enabled for ${userName}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to enable MFA', 'error');
    }
  };

  const handleToggleExempt = async (userId: string, userName: string, currentExempt: boolean) => {
    const newExempt = !currentExempt;
    try {
      await apiFetch('/auth/mfa/exempt', { method: 'POST', body: JSON.stringify({ userId, exempt: newExempt }) });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, mfaExempt: newExempt } : u));
      showToast(newExempt ? `${userName} exempted from org MFA requirement` : `MFA exemption removed for ${userName}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to update exemption', 'error');
    }
  };

  const handleSaveMfaMethod = async (method: MfaMethod) => {
    setSavingMfaMethod(true);
    try {
      await apiFetch('/auth/org-settings/mfa', { method: 'PUT', body: JSON.stringify({ mfaMethod: method }) });
      setMfaMethod(method);
      showToast(`MFA method updated to: ${MFA_METHOD_OPTIONS.find(o => o.value === method)?.label}`);
    } catch (e: any) {
      showToast(e.message || 'Failed to update MFA method', 'error');
    } finally {
      setSavingMfaMethod(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const settings = { mfaRequired, ssoEnabled, ssoConfig, sessionTimeout, ipWhitelist };
    localStorage.setItem('vorkhive_security_settings', JSON.stringify(settings));
    await new Promise(r => setTimeout(r, 600));
    setSaving(false);
    showToast('Security settings saved');
  };

  const role = user?.role?.toUpperCase() ?? '';
  const canEdit = role === 'SUPER_ADMIN' || role === 'IT_ADMIN';

  return (
    <div className="flex flex-col gap-8 max-w-[1100px] mx-auto pb-16 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-violet-500/5 flex justify-between items-center">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-violet-600 rounded-full" />
            <span className="text-[10px] font-black text-violet-600 uppercase tracking-[0.4em]">Identity & Access Management</span>
          </div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">Security <span className="text-violet-600">Settings</span></h1>
          <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-widest">MFA enforcement · SSO configuration · Session policy</p>
        </div>
        {canEdit && (
          <button onClick={handleSave} disabled={saving}
            className="px-6 py-3 bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-violet-700 shadow-lg shadow-violet-500/20 transition-all disabled:opacity-60 disabled:pointer-events-none flex items-center gap-2">
            {saving ? <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Saving…</> : 'Save Settings'}
          </button>
        )}
      </div>

      {!canEdit && (
        <div className="px-5 py-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3">
          <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
          <p className="text-[11px] font-black text-amber-700 uppercase tracking-widest">Read-only — Super Admin or IT Admin required to make changes</p>
        </div>
      )}

      {/* MFA Policy */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Multi-Factor Authentication</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">TOTP-based 2FA enforcement policy</p>
        </div>
        <div className="p-8 flex flex-col gap-6">

          {/* Org-wide MFA toggle */}
          <div className="flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100">
            <div>
              <p className="text-sm font-black text-slate-900 uppercase tracking-tight">Require MFA for all users</p>
              <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">
                All accounts must enroll in MFA before accessing the system · Individual users can be exempted below
              </p>
            </div>
            <Toggle on={mfaRequired} onChange={async v => {
              if (!canEdit) return;
              setMfaRequired(v);
              try {
                await apiFetch('/auth/org-settings/mfa', { method: 'PUT', body: JSON.stringify({ mfaRequired: v }) });
                showToast(`Org-wide MFA requirement ${v ? 'enabled' : 'disabled'}`);
              } catch (e: any) {
                setMfaRequired(!v); // revert on error
                showToast(e.message || 'Failed to update MFA policy', 'error');
              }
            }} />
          </div>

          {/* MFA Method selector */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-slate-900 uppercase tracking-tight">MFA Method</p>
                <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">How users verify their identity at login</p>
              </div>
              {savingMfaMethod && (
                <div className="flex items-center gap-2">
                  <svg className="animate-spin h-3.5 w-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Saving…</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3">
              {MFA_METHOD_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  disabled={!canEdit || savingMfaMethod}
                  onClick={() => canEdit && handleSaveMfaMethod(opt.value)}
                  className={`relative text-left p-4 rounded-2xl border-2 transition-all disabled:opacity-60 disabled:pointer-events-none ${
                    mfaMethod === opt.value
                      ? 'border-indigo-500 bg-indigo-50/60'
                      : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                      mfaMethod === opt.value ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'
                    }`}>
                      {mfaMethod === opt.value && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className={`text-[11px] font-black uppercase tracking-tight ${mfaMethod === opt.value ? 'text-indigo-900' : 'text-slate-900'}`}>
                          {opt.label}
                        </p>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border uppercase tracking-widest ${opt.badgeColor}`}>
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400 leading-relaxed">{opt.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Microsoft note */}
            <div className="flex items-start gap-2.5 p-3.5 bg-blue-50 border border-blue-100 rounded-xl">
              <span className="text-blue-500 text-sm shrink-0 mt-0.5">ℹ</span>
              <div>
                <p className="text-[10px] font-black text-blue-800 uppercase tracking-widest mb-0.5">Microsoft Authenticator push notifications</p>
                <p className="text-[10px] font-bold text-blue-600 leading-relaxed">
                  Number matching (pick 1 of 3) and approve/deny push require <strong>Azure AD / Microsoft Entra ID</strong> — enable via the SSO section below using your Microsoft tenant.
                </p>
              </div>
            </div>
          </div>

          {/* MFA stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-5 bg-emerald-50/60 rounded-2xl border border-emerald-100">
              <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-2">MFA Enabled</p>
              {usersLoading ? <div className="h-8 w-10 bg-emerald-100 rounded-lg animate-pulse" /> : <p className="text-3xl font-black text-emerald-700">{mfaCount}</p>}
            </div>
            <div className="p-5 bg-amber-50/60 rounded-2xl border border-amber-100">
              <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2">Not Enrolled</p>
              {usersLoading ? <div className="h-8 w-10 bg-amber-100 rounded-lg animate-pulse" /> : <p className="text-3xl font-black text-amber-600">{users.length - mfaCount}</p>}
            </div>
            <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Coverage</p>
              {usersLoading ? <div className="h-8 w-14 bg-slate-100 rounded-lg animate-pulse" /> : (
                <p className="text-3xl font-black text-slate-900">
                  {users.length > 0 ? Math.round((mfaCount / users.length) * 100) : 0}%
                </p>
              )}
            </div>
          </div>

          {/* User MFA list */}
          {!usersLoading && users.length > 0 && (
            <div className="border border-slate-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 grid grid-cols-2 gap-y-1 gap-x-4">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest col-span-2 mb-1">User MFA Status — overrides apply even when org policy is active</p>
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-indigo-500 rounded-full" /><p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Enable = force MFA on</p></div>
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-amber-400 rounded-full" /><p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Disable = off, secret kept</p></div>
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-violet-500 rounded-full" /><p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Exempt = skip org requirement</p></div>
                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-red-400 rounded-full" /><p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Reset = wipe &amp; re-enroll</p></div>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
                {users.filter(u => u.isActive).slice(0, 50).map(u => {
                  const isBusy = disablingMfa === u.id || resetMfa?.userId === u.id;
                  return (
                    <div key={u.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50 transition-all">
                      <div className="w-8 h-8 bg-slate-900 rounded-xl flex items-center justify-center text-[10px] font-black text-white shrink-0">
                        {u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-black text-slate-900 truncate">{u.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate">{u.email}</p>
                      </div>

                      {/* Status badge */}
                      <span className={`text-[8px] font-black uppercase px-2 py-1 rounded-lg border tracking-widest shrink-0 ${
                        u.mfaExempt
                          ? 'bg-violet-50 text-violet-600 border-violet-100'
                          : u.mfaEnabled
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : 'bg-slate-100 text-slate-400 border-slate-200'
                      }`}>
                        {u.mfaExempt ? 'Exempt' : u.mfaEnabled ? '✓ MFA On' : 'No MFA'}
                      </span>

                      {/* Action buttons */}
                      {canEdit && (
                        <div className="flex items-center gap-2.5 shrink-0">
                          {/* Enable — show when MFA is off and not exempt */}
                          {!u.mfaEnabled && !u.mfaExempt && (
                            <button
                              onClick={() => handleEnableMfa(u.id, u.name)}
                              disabled={isBusy}
                              className="text-[8px] font-black uppercase text-indigo-500 hover:text-indigo-700 tracking-widest disabled:opacity-40 transition-colors"
                            >
                              Enable
                            </button>
                          )}
                          {/* Disable — show when MFA is on */}
                          {u.mfaEnabled && (
                            <button
                              onClick={() => handleDisableMfa(u.id, u.name)}
                              disabled={isBusy}
                              className="text-[8px] font-black uppercase text-amber-500 hover:text-amber-700 tracking-widest disabled:opacity-40 transition-colors"
                            >
                              {disablingMfa === u.id ? '…' : 'Disable'}
                            </button>
                          )}
                          {/* Exempt toggle */}
                          <button
                            onClick={() => handleToggleExempt(u.id, u.name, u.mfaExempt)}
                            disabled={isBusy}
                            className={`text-[8px] font-black uppercase tracking-widest disabled:opacity-40 transition-colors ${u.mfaExempt ? 'text-violet-600 hover:text-violet-800' : 'text-violet-400 hover:text-violet-600'}`}
                          >
                            {u.mfaExempt ? 'Remove Exempt' : 'Exempt'}
                          </button>
                          {/* Reset */}
                          <button
                            onClick={() => handleResetMfa(u.id, 'reset')}
                            disabled={isBusy}
                            className="text-[8px] font-black uppercase text-red-400 hover:text-red-600 tracking-widest disabled:opacity-40 transition-colors"
                          >
                            {resetMfa?.userId === u.id && resetMfa.step === 'loading' ? '…' : 'Reset'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {users.filter(u => u.isActive).length > 50 && (
                <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Showing 50 of {users.filter(u => u.isActive).length} active users</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SSO Configuration */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Single Sign-On (SSO)</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">OIDC / SAML 2.0 identity provider integrations</p>
        </div>
        <div className="p-8 flex flex-col gap-4">
          {SSO_PROVIDERS.map(provider => {
            const enabled = ssoEnabled[provider.id] ?? false;
            const cfg = ssoConfig[provider.id] ?? { clientId: '', domain: '' };
            const expanded = expandedSso === provider.id;

            return (
              <div key={provider.id} className={`border rounded-2xl transition-all overflow-hidden ${enabled ? 'border-violet-200 bg-violet-50/30' : 'border-slate-100 bg-white'}`}>
                <div className="flex items-center gap-4 p-5">
                  <span className="text-2xl shrink-0">{provider.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{provider.name}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">{provider.desc}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {enabled && (
                      <button
                        onClick={() => setExpandedSso(expanded ? null : provider.id)}
                        className="text-[9px] font-black uppercase text-violet-600 tracking-widest hover:text-violet-800 transition-all"
                      >
                        {expanded ? 'Hide Config' : 'Configure'}
                      </button>
                    )}
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-lg border tracking-widest ${enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                      {enabled ? 'Active' : 'Off'}
                    </span>
                    <Toggle on={enabled} onChange={v => {
                      if (!canEdit) return;
                      setSsoEnabled(prev => ({ ...prev, [provider.id]: v }));
                      if (v) setExpandedSso(provider.id);
                      else setExpandedSso(null);
                    }} />
                  </div>
                </div>

                {enabled && expanded && (
                  <div className="px-5 pb-5 border-t border-violet-100 pt-4 flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Client ID / App ID</label>
                        <input
                          type="text"
                          value={cfg.clientId}
                          onChange={e => setSsoConfig(prev => ({ ...prev, [provider.id]: { ...cfg, clientId: e.target.value } }))}
                          placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                          disabled={!canEdit}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10 transition-all placeholder:font-normal placeholder:text-slate-300 disabled:opacity-60"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Organisation Domain</label>
                        <input
                          type="text"
                          value={cfg.domain}
                          onChange={e => setSsoConfig(prev => ({ ...prev, [provider.id]: { ...cfg, domain: e.target.value } }))}
                          placeholder="e.g. yourcompany.com"
                          disabled={!canEdit}
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10 transition-all placeholder:font-normal placeholder:text-slate-300 disabled:opacity-60"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 px-4 py-3 bg-violet-50 border border-violet-100 rounded-xl">
                      <svg className="w-4 h-4 text-violet-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      <p className="text-[10px] font-bold text-violet-700 uppercase tracking-widest">
                        Callback URL: <span className="font-black select-all">{typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback/{provider.id}</span>
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Session Policy */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Session & Access Policy</h2>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Token expiry · IP restrictions</p>
        </div>
        <div className="p-8 flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Session Timeout (minutes)</label>
              <select
                value={sessionTimeout}
                onChange={e => setSessionTimeout(e.target.value)}
                disabled={!canEdit}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10 transition-all appearance-none disabled:opacity-60"
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour (default)</option>
                <option value="120">2 hours</option>
                <option value="480">8 hours</option>
                <option value="1440">24 hours</option>
              </select>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Users are logged out after this period of inactivity</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Current Token Expiry</label>
              <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-sm font-black text-slate-700">60 min (JWT RS256)</span>
              </div>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Set in auth service configuration</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">IP Whitelist (one per line, leave blank to allow all)</label>
            <textarea
              value={ipWhitelist}
              onChange={e => setIpWhitelist(e.target.value)}
              rows={4}
              disabled={!canEdit}
              placeholder={'e.g.\n203.0.113.0/24\n192.168.1.0/24'}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-bold text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/10 transition-all resize-none placeholder:font-normal placeholder:text-slate-300 disabled:opacity-60"
            />
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">CIDR notation supported · Only applies to admin roles</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Enforce HTTPS only', desc: 'Block all non-TLS connections', defaultOn: true },
              { label: 'Log all login events', desc: 'Write to audit trail on every auth', defaultOn: true },
              { label: 'Block concurrent sessions', desc: 'One active session per user', defaultOn: false },
              { label: 'Send login alerts', desc: 'Email notification on new device login', defaultOn: false },
            ].map(opt => {
              const key = `session_${opt.label.replace(/\s/g, '_')}`;
              const stored = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
              const [on, setOn] = useState(stored !== null ? stored === 'true' : opt.defaultOn);
              return (
                <div key={opt.label} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div>
                    <p className="text-[11px] font-black text-slate-900 uppercase tracking-tight">{opt.label}</p>
                    <p className="text-[9px] font-bold text-slate-400 mt-0.5 uppercase tracking-widest">{opt.desc}</p>
                  </div>
                  <Toggle on={on} onChange={v => {
                    if (!canEdit) return;
                    setOn(v);
                    if (typeof window !== 'undefined') localStorage.setItem(key, String(v));
                  }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Disable / Reset MFA Confirmation Modal */}
      {resetMfa?.step === 'confirm' && (() => {
        const u = users.find(x => x.id === resetMfa.userId);
        const isReset = resetMfaMode === 'reset';
        return (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl p-8 max-w-md w-full mx-4">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${isReset ? 'bg-red-100' : 'bg-amber-100'}`}>
                  <svg className={`w-5 h-5 ${isReset ? 'text-red-500' : 'text-amber-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">
                    {isReset ? 'Reset MFA' : 'Disable MFA'}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {isReset ? 'Wipes authenticator — requires re-enrollment' : 'Turns off MFA — secret is preserved'}
                  </p>
                </div>
              </div>
              <p className="text-sm font-bold text-slate-700 mb-1">
                {isReset ? 'Reset' : 'Disable'} MFA for <span className="text-slate-900 font-black">{u?.name}</span>?
              </p>
              <p className="text-[11px] font-bold text-slate-400 mb-6 uppercase tracking-widest leading-relaxed">
                {isReset
                  ? 'Their authenticator app entry will be unlinked. They must scan a new QR code to re-enroll.'
                  : 'MFA will be turned off but their authenticator app stays linked. An admin can re-enable it without a new QR scan.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={confirmResetMfa}
                  className={`flex-1 py-3 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-lg ${isReset ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20'}`}
                >
                  Confirm {isReset ? 'Reset' : 'Disable'}
                </button>
                <button
                  onClick={() => setResetMfa(null)}
                  className="flex-1 py-3 bg-slate-100 text-slate-700 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-200 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-8 duration-300">
          <div className={`px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4 ${toast.type === 'success' ? 'bg-slate-900 border border-slate-700' : 'bg-red-900 border border-red-700'}`}>
            <div className={`w-2 h-2 rounded-full ${toast.type === 'success' ? 'bg-emerald-500' : 'bg-red-400'}`} />
            <span className="text-[10px] font-black text-white uppercase tracking-widest">{toast.msg}</span>
          </div>
        </div>
      )}
    </div>
  );
}
