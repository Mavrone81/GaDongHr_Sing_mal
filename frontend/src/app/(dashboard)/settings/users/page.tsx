'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { pwStrength } from '@/lib/passwordReset';

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
  SUPER_ADMIN:      'bg-page text-accent border-accent',
  ADMIN:            'bg-page text-accent border-accent',
  IT_ADMIN:         'bg-page text-ink border-ink',
  HR_ADMIN:         'bg-page text-accent border-accent',
  HR_MANAGER:       'bg-page text-accent border-accent',
  PAYROLL_OFFICER:  'bg-page text-accent border-accent',
  FINANCE_ADMIN:    'bg-page text-accent border-accent',
  RECRUITER:        'bg-page text-ink border-highlight',
  TRAINING_MANAGER: 'bg-page text-ink border-highlight',
  LINE_MANAGER:     'bg-page text-accent border-accent',
  EMPLOYEE:         'bg-page text-ink border-rule',
};

// ─── Password strength ────────────────────────────────────────────────────────
// pwStrength now lives in @/lib/passwordReset so the self-service reset page
// shares the identical meter.

// ─── Adjust Clearances Panel ──────────────────────────────────────────────────
function AdjustPanel({
  user, roles, onClose, onRefresh,
}: {
  user: User; roles: Role[]; onClose: () => void; onRefresh: () => void;
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

  const handleRoleSave = async () => {
    setRoleLoading(true); setRoleMsg('');
    try {
      await apiFetch(`/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: updateRole }),
      });
      setRoleMsg('✓ Role updated successfully.');
      onRefresh();
    } catch (e) { setRoleMsg(`✗ ${(e as Error).message || 'Update failed.'}`); }
    setRoleLoading(false);
  };

  const handleToggleActive = async () => {
    setRoleLoading(true); setRoleMsg('');
    try {
      await apiFetch(`/users/${user.id}/toggle-active`, { method: 'PATCH' });
      setRoleMsg(`✓ Account ${user.isActive ? 'locked' : 'unlocked'}.`);
      onRefresh();
    } catch (e) { setRoleMsg(`✗ ${(e as Error).message || 'Failed.'}`); }
    setRoleLoading(false);
  };

  const handlePasswordReset = async () => {
    setPwError(''); setPwMsg('');
    if (pw.length < 8) { setPwError('Minimum 8 characters.'); return; }
    if (pw !== pwConfirm) { setPwError('Passwords do not match.'); return; }
    setPwLoading(true);
    try {
      await apiFetch(`/users/${user.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: pw }),
      });
      setPwMsg('✓ Password reset. All active sessions invalidated.');
      setPw(''); setPwConfirm('');
    } catch (e) { setPwError((e as Error).message || '✗ Reset failed.'); }
    setPwLoading(false);
  };

  const handleMfaReset = async () => {
    setMfaLoading(true); setMfaMsg('');
    try {
      await apiFetch(`/users/${user.id}/reset-mfa`, { method: 'POST' });
      setMfaMsg('✓ MFA cleared. User must re-enrol on next login.');
      setMfaConfirm(false); onRefresh();
    } catch (e) { setMfaMsg(`✗ ${(e as Error).message || 'Reset failed.'}`); }
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
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-shadow backdrop-" onClick={onClose}>
      <div
        className="relative h-full w-full max-w-lg bg-paper flex flex-col animate-in slide-in-from-right duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-7 py-6 border-b border-rule shrink-0">
          <div className="w-12 h-12 bg-shadow flex items-center justify-center text-sm font-black text-accent shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-ink truncate">{user.name}</p>
            <p className="text-[10px] font-bold text-muted truncate">{user.email}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-page transition-all text-muted hover:text-ink">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-rule shrink-0 px-4">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-4 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all ${
                tab === t.key ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
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
                <p className="label-form mb-1.5">Current Role</p>
                <span className={`text-xs font-black px-3 py-1.5  border ${ROLE_COLORS[user.role] ?? ROLE_COLORS.EMPLOYEE}`}>
                  {user.role.replace(/_/g, ' ')}
                </span>
              </div>

              <div>
                <label className="label-form block mb-1.5">Assign New Role</label>
                <div className="relative">
                  <select
                    value={updateRole}
                    onChange={e => setUpdateRole(e.target.value)}
                    className="w-full appearance-none bg-paper border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:border-accent pr-8 cursor-pointer"
                  >
                    {roles.map(r => (
                      <option key={r.id} value={r.name}>{r.name.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                  <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              <button
                onClick={handleRoleSave}
                disabled={roleLoading || updateRole === user.role}
                className="w-full py-3 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all disabled:opacity-40 "
              >
                {roleLoading ? 'Saving…' : 'Save Role'}
              </button>

              {roleMsg && (
                <p className={`text-[10px] font-black text-center ${roleMsg.startsWith('✓') ? 'text-accent' : 'text-ink'}`}>{roleMsg}</p>
              )}

              <div className="border-t border-rule pt-6">
                <p className="label-form mb-3">Account Status</p>
                <div className="flex items-center justify-between p-4 border border-rule bg-page">
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5  ${user.isActive ? 'bg-accent shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-ink'}`} />
                    <div>
                      <p className="text-xs font-black text-ink uppercase">{user.isActive ? 'Active' : 'Locked'}</p>
                      {user.lastLoginAt && (
                        <p className="text-[9px] font-bold text-muted mt-0.5">
                          Last login: {new Date(user.lastLoginAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleToggleActive}
                    disabled={roleLoading}
                    className={`px-4 py-2 text-[9px] font-black uppercase tracking-widest  transition-all border ${
                      user.isActive
                        ? 'border-ink text-ink bg-page hover:bg-page'
                        : 'border-accent text-accent bg-page hover:bg-page'
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
              <div className="p-4 bg-page border border-highlight flex gap-3">
                <svg className="w-4 h-4 text-ink shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-[10px] font-bold text-ink leading-relaxed">
                  Setting a new password will immediately invalidate all active sessions for <strong>{user.name}</strong>. They will need to log in again.
                </p>
              </div>

              <div>
                <label className="label-form block mb-1.5">New Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pw}
                    onChange={e => setPw(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="w-full border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:border-accent pr-12 bg-paper"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-[9px] font-black uppercase"
                  >
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>

                {/* Strength bar */}
                {pw && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1,2,3,4,5].map(i => (
                        <div key={i} className={`h-1.5 flex-1  transition-all ${i <= strength.score ? strength.color : 'bg-rule'}`} />
                      ))}
                    </div>
                    <p className={`text-[9px] font-black uppercase tracking-widest ${strength.score >= 3 ? 'text-accent' : 'text-ink'}`}>
                      {strength.label}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="label-form block mb-1.5">Confirm Password</label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={pwConfirm}
                  onChange={e => setPwConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  className={`w-full border  px-4 py-3 text-sm font-bold text-ink focus:outline-none bg-paper transition-all ${
                    pwConfirm && pw !== pwConfirm ? 'border-ink focus:border-ink' : 'border-rule focus:border-accent'
                  }`}
                />
                {pwConfirm && pw !== pwConfirm && (
                  <p className="text-[9px] font-black text-ink mt-1">Passwords do not match</p>
                )}
              </div>

              {pwError && <p className="text-[10px] font-black text-ink bg-page px-4 py-2.5 border border-ink">{pwError}</p>}
              {pwMsg   && <p className="text-[10px] font-black text-accent bg-page px-4 py-2.5 border border-accent">{pwMsg}</p>}

              <button
                onClick={handlePasswordReset}
                disabled={pwLoading || !pw || pw !== pwConfirm}
                className="w-full py-3 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {pwLoading && <svg className="w-3.5 h-3.5 animate-spin rounded-full" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
                {pwLoading ? 'Resetting…' : 'Set New Password'}
              </button>
            </div>
          )}

          {/* ── MFA ──────────────────────────────────────────────────────── */}
          {tab === 'mfa' && (
            <div className="flex flex-col gap-6">
              {/* MFA Status card */}
              <div className={`p-5  border flex items-start gap-4 ${user.mfaEnabled ? 'bg-page border-accent' : 'bg-page border-rule'}`}>
                <div className={`w-10 h-10  flex items-center justify-center shrink-0 ${user.mfaEnabled ? 'bg-page' : 'bg-page'}`}>
                  <svg className={`w-5 h-5 ${user.mfaEnabled ? 'text-accent' : 'text-muted'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                  </svg>
                </div>
                <div>
                  <p className={`text-sm font-black ${user.mfaEnabled ? 'text-accent' : 'text-ink'}`}>
                    MFA is {user.mfaEnabled ? 'Enabled' : 'Not Configured'}
                  </p>
                  <p className={`text-[10px] font-bold mt-0.5 ${user.mfaEnabled ? 'text-accent' : 'text-muted'}`}>
                    {user.mfaEnabled
                      ? 'Time-based one-time password (TOTP) is active for this account.'
                      : 'This user has not set up multi-factor authentication yet.'}
                  </p>
                </div>
              </div>

              {/* Reset MFA section */}
              {user.mfaEnabled && (
                <div className="flex flex-col gap-4">
                  <div className="p-4 bg-page border border-ink flex gap-3">
                    <svg className="w-4 h-4 text-ink shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="text-[10px] font-bold text-ink leading-relaxed">
                      Resetting MFA will <strong>clear the authenticator secret</strong> and invalidate all active sessions. The user will need to re-enrol using their authenticator app on next login.
                    </p>
                  </div>

                  {!mfaConfirm ? (
                    <button
                      onClick={() => setMfaConfirm(true)}
                      className="w-full py-3 border-2 border-ink text-ink text-[10px] font-black uppercase tracking-widest hover:bg-page transition-all"
                    >
                      Reset MFA for {user.name}
                    </button>
                  ) : (
                    <div className="flex flex-col gap-3 p-4 bg-page border border-ink ">
                      <p className="text-[10px] font-black text-ink uppercase tracking-widest">Confirm MFA Reset</p>
                      <p className="text-xs font-bold text-ink">Are you sure? This cannot be undone. The user will be logged out immediately.</p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setMfaConfirm(false)}
                          className="flex-1 py-2.5 border border-rule text-ink text-[9px] font-black uppercase tracking-widest hover:bg-page transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleMfaReset}
                          disabled={mfaLoading}
                          className="flex-1 py-2.5 bg-ink text-paper text-[9px] font-black uppercase tracking-widest hover:bg-ink transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {mfaLoading && <svg className="w-3 h-3 animate-spin rounded-full" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>}
                          {mfaLoading ? 'Resetting…' : 'Confirm Reset'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Not enrolled state */}
              {!user.mfaEnabled && (
                <div className="p-5 bg-page border border-rule flex flex-col gap-3">
                  <p className="text-[10px] font-black text-ink uppercase tracking-widest">How MFA enrolment works</p>
                  <ol className="flex flex-col gap-2">
                    {[
                      'User logs in with their email and password',
                      'They visit Account Settings → Setup MFA',
                      'They scan the QR code with an authenticator app (Google Authenticator, Authy, etc.)',
                      'MFA is active on next login',
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-3 text-[10px] font-bold text-muted">
                        <span className="w-5 h-5 bg-page text-accent font-black text-[9px] flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {mfaMsg && (
                <p className={`text-[10px] font-black px-4 py-2.5  border ${mfaMsg.startsWith('✓') ? 'text-accent bg-page border-accent' : 'text-ink bg-page border-ink'}`}>
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
  const [userSort, setUserSort] = useState<{ col: 'name' | 'role' | 'status' | 'mfa' | 'created'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });

  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'EMPLOYEE' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError]     = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [uRes, rRes] = await Promise.allSettled([
        apiFetch('/users'),
        apiFetch('/roles'),
      ]);
      if (uRes.status === 'fulfilled') setUsers(uRes.value.users ?? []);
      if (rRes.status === 'fulfilled') setRoles(rRes.value ?? []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreateUser = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) return;
    setCreateLoading(true); setCreateError('');
    try {
      await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      fetchData();
      setIsCreateOpen(false);
      setNewUser({ name: '', email: '', password: '', role: 'EMPLOYEE' });
    } catch (e) { setCreateError((e as Error).message || 'Creation failed.'); }
    setCreateLoading(false);
  };

  const base = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.role.toLowerCase().includes(search.toLowerCase())
  );
  const filtered = [...base].sort((a, b) => {
    const d = userSort.dir === 'asc' ? 1 : -1;
    switch (userSort.col) {
      case 'name':    return d * a.name.localeCompare(b.name);
      case 'role':    return d * a.role.localeCompare(b.role);
      case 'status':  return d * (Number(a.isActive) - Number(b.isActive));
      case 'mfa':     return d * (Number(a.mfaEnabled) - Number(b.mfaEnabled));
      case 'created': return d * a.createdAt.localeCompare(b.createdAt);
      default: return 0;
    }
  });
  function toggleUserSort(col: typeof userSort.col) {
    setUserSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function UserSortIcon({ col }: { col: typeof userSort.col }) {
    return <span className="text-[8px] ml-1">{userSort.col === col ? (userSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-24 gap-4">
      <div className="h-10 w-10 border-4 border-accent border-t-transparent animate-spin rounded-full" />
      <p className="eyebrow-tight animate-pulse">Loading identities…</p>
    </div>
  );

  if (!hasPermission('user:manage')) return (
    <div className="p-24 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-page text-3xl mb-6">🚫</div>
      <h2 className="text-xl font-black text-ink uppercase tracking-widest">Access Denied</h2>
    </div>
  );

  return (
    <div className="flex flex-col gap-6 pb-20">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-paper p-6 border border-rule ">
        <div>
          <h1 className="text-xl font-black text-ink tracking-tight">User Management</h1>
          <p className="eyebrow-tight mt-0.5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-accent animate-pulse" />
            {users.length} identities registered
          </p>
        </div>
        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-2 bg-accent hover:bg-accent text-paper px-5 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all "
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          New User
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email or role…"
          className="w-full pl-11 pr-4 py-3 bg-paper border border-rule text-sm font-bold text-ink focus:outline-none focus:border-accent "
        />
      </div>

      {/* User table */}
      <div className="bg-paper border border-rule overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-page border-b border-rule label-form">
              {([
                { col: 'name',    label: 'User' },
                { col: 'role',    label: 'Role' },
                { col: 'status',  label: 'Status' },
                { col: 'mfa',     label: 'MFA' },
                { col: 'created', label: 'Created' },
              ] as const).map(h => (
                <th key={h.col} className="px-6 py-4">
                  <button onClick={() => toggleUserSort(h.col)} className="flex items-center hover:text-ink transition-colors">
                    {h.label}<UserSortIcon col={h.col} />
                  </button>
                </th>
              ))}
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {filtered.map(u => (
              <tr key={u.id} className="hover:bg-page transition-colors group">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-shadow flex items-center justify-center text-[10px] font-black text-accent shrink-0 group-hover:scale-105 transition-transform">
                      {u.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-black text-ink uppercase tracking-wide">{u.name}</p>
                      <p className="text-[10px] font-bold text-muted mt-0.5">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`text-[9px] font-black px-2.5 py-1  border uppercase tracking-widest ${ROLE_COLORS[u.role] ?? ROLE_COLORS.EMPLOYEE}`}>
                    {u.role.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2  shrink-0 ${u.isActive ? 'bg-accent shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-ink'}`} />
                    <span className="text-[10px] font-black text-ink uppercase tracking-widest">{u.isActive ? 'Active' : 'Locked'}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  {u.mfaEnabled ? (
                    <span className="badge badge-success w-fit">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Enabled
                    </span>
                  ) : (
                    <span className="label-form">—</span>
                  )}
                </td>
                <td className="px-6 py-4 text-[10px] font-bold text-muted">
                  {new Date(u.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-6 py-4 text-right">
                  <button
                    onClick={() => setSelectedUser(u)}
                    className="text-[9px] font-black text-accent uppercase tracking-widest border border-accent bg-page px-4 py-1.5 hover:bg-accent hover:text-paper hover:border-accent transition-all"
                  >
                    Adjust Clearances
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-muted font-bold">No users found</td></tr>
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
        />
      )}

      {/* Create User modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-shadow backdrop-">
          <div className="bg-paper w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-7 border-b border-rule">
              <h3 className="text-lg font-black text-ink tracking-tight">Provision New User</h3>
              <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-0.5">Register a new system identity</p>
            </div>
            <div className="p-7 flex flex-col gap-4">
              {[
                { label: 'Full Name',  key: 'name',     type: 'text',     placeholder: 'Jane Smith' },
                { label: 'Email',      key: 'email',    type: 'email',    placeholder: 'jane@company.com' },
                { label: 'Password',   key: 'password', type: 'password', placeholder: 'Min. 8 characters' },
              ].map(f => (
                <div key={f.key}>
                  <label className="label-form block mb-1.5">{f.label}</label>
                  <input
                    type={f.type}
                    value={(newUser as Record<string, string>)[f.key]}
                    onChange={e => setNewUser({ ...newUser, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="w-full border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:border-accent bg-paper"
                  />
                </div>
              ))}
              <div>
                <label className="label-form block mb-1.5">Role</label>
                <div className="relative">
                  <select
                    value={newUser.role}
                    onChange={e => setNewUser({ ...newUser, role: e.target.value })}
                    className="w-full appearance-none border border-rule px-4 py-3 text-sm font-bold text-ink focus:outline-none focus:border-accent pr-8 bg-paper cursor-pointer"
                  >
                    {roles.map(r => <option key={r.id} value={r.name}>{r.name.replace(/_/g, ' ')}</option>)}
                  </select>
                  <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              {createError && <p className="text-[10px] font-black text-ink bg-page px-4 py-2.5 border border-ink">{createError}</p>}
            </div>
            <div className="px-7 pb-7 flex justify-end gap-3">
              <button onClick={() => { setIsCreateOpen(false); setCreateError(''); }} className="px-5 py-2.5 text-[10px] font-black text-muted hover:text-ink uppercase tracking-widest transition-all">Cancel</button>
              <button
                onClick={handleCreateUser}
                disabled={createLoading || !newUser.name || !newUser.email || !newUser.password}
                className="px-6 py-2.5 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all disabled:opacity-40 "
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
