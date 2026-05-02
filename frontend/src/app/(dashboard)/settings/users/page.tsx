'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  mfaEnabled: boolean;
  employeeId?: string;
  lastLoginAt?: string;
  createdAt: string;
}

interface Role { id: string; name: string; }

type PanelTab = 'role' | 'password' | 'mfa';

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN:     'bg-indigo-50 text-indigo-700 border-indigo-200',
  HR_ADMIN:        'bg-violet-50 text-violet-700 border-violet-200',
  HR_MANAGER:      'bg-blue-50 text-blue-700 border-blue-200',
  PAYROLL_OFFICER: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RECRUITER:       'bg-amber-50 text-amber-700 border-amber-200',
  LINE_MANAGER:    'bg-sky-50 text-sky-700 border-sky-200',
  EMPLOYEE:        'bg-slate-50 text-slate-600 border-slate-200',
};

// ─── Password strength ────────────────────────────────────────────────────────
function pwStrength(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  const colors = ['', 'bg-red-500', 'bg-amber-500', 'bg-yellow-400', 'bg-emerald-500', 'bg-emerald-600'];
  return { score: s, label: labels[s] || '', color: colors[s] || '' };
}

// ─── Adjust Clearances Panel ──────────────────────────────────────────────────
function AdjustPanel({
  user, roles, onClose, onRefresh, apiBase,
}: {
  user: User; roles: Role[]; onClose: () => void; onRefresh: () => void; apiBase: string;
}) {
  const [tab, setTab] = useState<PanelTab>('role');

  // Role tab
  const [updateRole, setUpdateRole]   = useState(user.role);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleMsg, setRoleMsg]         = useState('');

  // Password tab
  const [pw, setPw]             = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg]       = useState('');
  const [pwError, setPwError]   = useState('');

  // MFA tab
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaMsg, setMfaMsg]         = useState('');
  const [mfaConfirm, setMfaConfirm] = useState(false);

  const token = () => document.cookie.split('vorkhive_token=')[1]?.split(';')[0];

  const handleRoleSave = async () => {
    setRoleLoading(true); setRoleMsg('');
    try {
      const res = await fetch(`${apiBase}/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ role: updateRole }),
      });
      setRoleMsg(res.ok ? '✓ Role updated successfully.' : '✗ Update failed.');
      if (res.ok) onRefresh();
    } catch { setRoleMsg('✗ Network error.'); }
    setRoleLoading(false);
  };

  const handleToggleActive = async () => {
    setRoleLoading(true); setRoleMsg('');
    try {
      const res = await fetch(`${apiBase}/users/${user.id}/toggle-active`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token()}` },
      });
      setRoleMsg(res.ok ? `✓ Account ${user.isActive ? 'locked' : 'unlocked'}.` : '✗ Failed.');
      if (res.ok) onRefresh();
    } catch { setRoleMsg('✗ Network error.'); }
    setRoleLoading(false);
  };

  const handlePasswordReset = async () => {
    setPwError(''); setPwMsg('');
    if (pw.length < 8) { setPwError('Minimum 8 characters.'); return; }
    if (pw !== pwConfirm) { setPwError('Passwords do not match.'); return; }
    setPwLoading(true);
    try {
      const res = await fetch(`${apiBase}/users/${user.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ newPassword: pw }),
      });
      if (res.ok) {
        setPwMsg('✓ Password reset. All active sessions invalidated.');
        setPw(''); setPwConfirm('');
      } else {
        const d = await res.json().catch(() => ({}));
        setPwError(d.error || '✗ Reset failed.');
      }
    } catch { setPwError('✗ Network error.'); }
    setPwLoading(false);
  };

  const handleMfaReset = async () => {
    setMfaLoading(true); setMfaMsg('');
    try {
      const res = await fetch(`${apiBase}/users/${user.id}/reset-mfa`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      });
      setMfaMsg(res.ok ? '✓ MFA cleared. User must re-enrol on next login.' : '✗ Reset failed.');
      if (res.ok) { setMfaConfirm(false); onRefresh(); }
    } catch { setMfaMsg('✗ Network error.'); }
    setMfaLoading(false);
  };

  const strength = pwStrength(pw);
  const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  const TABS: { key: PanelTab; label: string; icon: React.ReactNode }[] = [
    {
      key: 'role', label: 'Access & Role',
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
    },
    {
      key: 'password', label: 'Reset Password',
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>,
    },
    {
      key: 'mfa', label: 'MFA',
      icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" /></svg>,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative h-full w-full max-w-lg bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-7 py-6 border-b border-slate-100 shrink-0">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-sm font-black text-indigo-400 shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-slate-900 truncate">{user.name}</p>
            <p className="text-[10px] font-bold text-slate-400 truncate">{user.email}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-all text-slate-400 hover:text-slate-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-slate-100 shrink-0 px-4">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-4 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all ${
                tab === t.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-7">

          {/* ── ACCESS & ROLE ─────────────────────────────────────────────── */}
          {tab === 'role' && (
            <div className="flex flex-col gap-6">
              <div>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Current Role</p>
                <span className={`text-xs font-black px-3 py-1.5 rounded-full border ${ROLE_COLORS[user.role] ?? ROLE_COLORS.EMPLOYEE}`}>
                  {user.role.replace(/_/g, ' ')}
                </span>
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Assign New Role</label>
                <div className="relative">
                  <select
                    value={updateRole}
                    onChange={e => setUpdateRole(e.target.value)}
                    className="w-full appearance-none bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500 pr-8 cursor-pointer"
                  >
                    {roles.map(r => (
                      <option key={r.id} value={r.name}>{r.name.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                  <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              <button
                onClick={handleRoleSave}
                disabled={roleLoading || updateRole === user.role}
                className="w-full py-3 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-40 shadow-lg shadow-indigo-500/20"
              >
                {roleLoading ? 'Saving…' : 'Save Role'}
              </button>

              {roleMsg && (
                <p className={`text-[10px] font-black text-center ${roleMsg.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>{roleMsg}</p>
              )}

              <div className="border-t border-slate-100 pt-6">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Account Status</p>
                <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${user.isActive ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                    <div>
                      <p className="text-xs font-black text-slate-900 uppercase">{user.isActive ? 'Active' : 'Locked'}</p>
                      {user.lastLoginAt && (
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">
                          Last login: {new Date(user.lastLoginAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleToggleActive}
                    disabled={roleLoading}
                    className={`px-4 py-2 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all border ${
                      user.isActive
                        ? 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100'
                        : 'border-emerald-200 text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                    }`}
                  >
                    {user.isActive ? 'Lock Account' : 'Unlock Account'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── RESET PASSWORD ────────────────────────────────────────────── */}
          {tab === 'password' && (
            <div className="flex flex-col gap-5">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3">
                <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-[10px] font-bold text-amber-700 leading-relaxed">
                  Setting a new password will immediately invalidate all active sessions for <strong>{user.name}</strong>. They will need to log in again.
                </p>
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pw}
                    onChange={e => setPw(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500 pr-12 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[9px] font-black uppercase"
                  >
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>

                {/* Strength bar */}
                {pw && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1,2,3,4,5].map(i => (
                        <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= strength.score ? strength.color : 'bg-slate-200'}`} />
                      ))}
                    </div>
                    <p className={`text-[9px] font-black uppercase tracking-widest ${strength.score >= 3 ? 'text-emerald-600' : 'text-amber-500'}`}>
                      {strength.label}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Confirm Password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pwConfirm}
                  onChange={e => setPwConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  className={`w-full border rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none bg-white transition-all ${
                    pwConfirm && pw !== pwConfirm ? 'border-red-300 focus:border-red-500' : 'border-slate-200 focus:border-indigo-500'
                  }`}
                />
                {pwConfirm && pw !== pwConfirm && (
                  <p className="text-[9px] font-black text-red-500 mt-1">Passwords do not match</p>
                )}
              </div>

              {pwError && <p className="text-[10px] font-black text-red-500 bg-red-50 px-4 py-2.5 rounded-xl border border-red-200">{pwError}</p>}
              {pwMsg   && <p className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-4 py-2.5 rounded-xl border border-emerald-200">{pwMsg}</p>}

              <button
                onClick={handlePasswordReset}
                disabled={pwLoading || !pw || pw !== pwConfirm}
                className="w-full py-3 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-40 shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
              >
                {pwLoading && <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
                {pwLoading ? 'Resetting…' : 'Set New Password'}
              </button>
            </div>
          )}

          {/* ── MFA ──────────────────────────────────────────────────────── */}
          {tab === 'mfa' && (
            <div className="flex flex-col gap-6">
              {/* MFA Status card */}
              <div className={`p-5 rounded-2xl border flex items-start gap-4 ${user.mfaEnabled ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${user.mfaEnabled ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                  <svg className={`w-5 h-5 ${user.mfaEnabled ? 'text-emerald-600' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                  </svg>
                </div>
                <div>
                  <p className={`text-sm font-black ${user.mfaEnabled ? 'text-emerald-800' : 'text-slate-700'}`}>
                    MFA is {user.mfaEnabled ? 'Enabled' : 'Not Configured'}
                  </p>
                  <p className={`text-[10px] font-bold mt-0.5 ${user.mfaEnabled ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {user.mfaEnabled
                      ? 'Time-based one-time password (TOTP) is active for this account.'
                      : 'This user has not set up multi-factor authentication yet.'}
                  </p>
                </div>
              </div>

              {/* Reset MFA section */}
              {user.mfaEnabled && (
                <div className="flex flex-col gap-4">
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex gap-3">
                    <svg className="w-4 h-4 text-red-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="text-[10px] font-bold text-red-700 leading-relaxed">
                      Resetting MFA will <strong>clear the authenticator secret</strong> and invalidate all active sessions. The user will need to re-enrol using their authenticator app on next login.
                    </p>
                  </div>

                  {!mfaConfirm ? (
                    <button
                      onClick={() => setMfaConfirm(true)}
                      className="w-full py-3 border-2 border-red-300 text-red-600 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-50 transition-all"
                    >
                      Reset MFA for {user.name}
                    </button>
                  ) : (
                    <div className="flex flex-col gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                      <p className="text-[10px] font-black text-red-800 uppercase tracking-widest">Confirm MFA Reset</p>
                      <p className="text-xs font-bold text-red-600">Are you sure? This cannot be undone. The user will be logged out immediately.</p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setMfaConfirm(false)}
                          className="flex-1 py-2.5 border border-slate-200 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-slate-50 transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleMfaReset}
                          disabled={mfaLoading}
                          className="flex-1 py-2.5 bg-red-600 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {mfaLoading && <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
                          {mfaLoading ? 'Resetting…' : 'Confirm Reset'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Not enrolled state */}
              {!user.mfaEnabled && (
                <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-3">
                  <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest">How MFA enrolment works</p>
                  <ol className="flex flex-col gap-2">
                    {[
                      'User logs in with their email and password',
                      'They visit Account Settings → Setup MFA',
                      'They scan the QR code with an authenticator app (Google Authenticator, Authy, etc.)',
                      'MFA is active on next login',
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-3 text-[10px] font-bold text-slate-500">
                        <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 font-black text-[9px] flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {mfaMsg && (
                <p className={`text-[10px] font-black px-4 py-2.5 rounded-xl border ${mfaMsg.startsWith('✓') ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-red-500 bg-red-50 border-red-200'}`}>
                  {mfaMsg}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function UserManagementPage() {
  const { hasPermission } = useAuth();
  const [users, setUsers]   = useState<User[]>([]);
  const [roles, setRoles]   = useState<Role[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [search, setSearch] = useState('');

  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'EMPLOYEE' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError]     = useState('');

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  const token   = () => document.cookie.split('vorkhive_token=')[1]?.split(';')[0];

  const fetchData = useCallback(async () => {
    try {
      const [uRes, rRes] = await Promise.all([
        fetch(`${apiBase}/users`, { headers: { Authorization: `Bearer ${token()}` } }),
        fetch(`${apiBase}/roles`, { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      if (uRes.ok) { const d = await uRes.json(); setUsers(d.users ?? []); }
      if (rRes.ok) setRoles(await rRes.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [apiBase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreateUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) return;
    setCreateLoading(true); setCreateError('');
    try {
      const res = await fetch(`${apiBase}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(newUser),
      });
      if (res.ok) {
        fetchData();
        setIsCreateOpen(false);
        setNewUser({ name: '', email: '', password: '', role: 'EMPLOYEE' });
      } else {
        const d = await res.json().catch(() => ({}));
        setCreateError(d.error || 'Creation failed.');
      }
    } catch { setCreateError('Network error.'); }
    setCreateLoading(false);
  };

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-24 gap-4">
      <div className="h-10 w-10 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin" />
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Loading identities…</p>
    </div>
  );

  if (!hasPermission('user:manage')) return (
    <div className="p-24 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 text-3xl mb-6">🚫</div>
      <h2 className="text-xl font-black text-slate-900 uppercase tracking-widest">Access Denied</h2>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 pb-20">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-xl font-black text-slate-900 tracking-tight">User Management</h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            {users.length} identities registered
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New User
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email or role…"
          className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500 shadow-sm"
        />
      </div>

      {/* User table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest">
              <th className="px-6 py-4">User</th>
              <th className="px-6 py-4">Role</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">MFA</th>
              <th className="px-6 py-4">Created</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(u => (
              <tr key={u.id} className="hover:bg-slate-50/80 transition-colors group">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center text-[10px] font-black text-indigo-400 shrink-0 group-hover:scale-105 transition-transform">
                      {u.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-900 uppercase tracking-wide">{u.name}</p>
                      <p className="text-[10px] font-bold text-slate-400 mt-0.5">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-[9px] font-black px-2.5 py-1 rounded-full border uppercase tracking-widest ${ROLE_COLORS[u.role] ?? ROLE_COLORS.EMPLOYEE}`}>
                    {u.role.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${u.isActive ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                    <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">{u.isActive ? 'Active' : 'Locked'}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  {u.mfaEnabled ? (
                    <span className="flex items-center gap-1.5 text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full uppercase tracking-widest w-fit">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Enabled
                    </span>
                  ) : (
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-[10px] font-bold text-slate-400">
                  {new Date(u.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    onClick={() => setSelectedUser(u)}
                    className="text-[9px] font-black text-indigo-600 uppercase tracking-widest border border-indigo-100 bg-indigo-50 px-4 py-1.5 rounded-full hover:bg-indigo-600 hover:text-white hover:border-indigo-600 transition-all"
                  >
                    Adjust Clearances
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-400 font-bold">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Adjust Clearances side panel */}
      {selectedUser && (
        <AdjustPanel
          user={selectedUser}
          roles={roles}
          onClose={() => setSelectedUser(null)}
          onRefresh={() => { fetchData(); setSelectedUser(null); }}
          apiBase={apiBase}
        />
      )}

      {/* Create User modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-950/40 backdrop-blur-md">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-7 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900 tracking-tight">Provision New User</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Register a new system identity</p>
            </div>
            <div className="p-7 flex flex-col gap-4">
              {[
                { label: 'Full Name',  key: 'name',     type: 'text',     placeholder: 'Jane Smith' },
                { label: 'Email',      key: 'email',    type: 'email',    placeholder: 'jane@company.com' },
                { label: 'Password',   key: 'password', type: 'password', placeholder: 'Min. 8 characters' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">{f.label}</label>
                  <input
                    type={f.type}
                    value={(newUser as Record<string, string>)[f.key]}
                    onChange={e => setNewUser({ ...newUser, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500 bg-white"
                  />
                </div>
              ))}
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1.5">Role</label>
                <div className="relative">
                  <select
                    value={newUser.role}
                    onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                    className="w-full appearance-none border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-indigo-500 pr-8 bg-white cursor-pointer"
                  >
                    {roles.map(r => <option key={r.id} value={r.name}>{r.name.replace(/_/g, ' ')}</option>)}
                  </select>
                  <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              {createError && <p className="text-[10px] font-black text-red-500 bg-red-50 px-4 py-2.5 rounded-xl border border-red-200">{createError}</p>}
            </div>
            <div className="px-7 pb-7 flex justify-end gap-3">
              <button onClick={() => { setIsCreateOpen(false); setCreateError(''); }} className="px-5 py-2.5 text-[10px] font-black text-slate-500 hover:text-slate-900 uppercase tracking-widest transition-all">Cancel</button>
              <button
                onClick={handleCreateUser}
                disabled={createLoading || !newUser.name || !newUser.email || !newUser.password}
                className="px-6 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all disabled:opacity-40 shadow-lg shadow-indigo-500/20"
              >
                {createLoading ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
