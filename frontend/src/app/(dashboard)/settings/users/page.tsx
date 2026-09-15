'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { pwStrength } from '@/lib/passwordReset';
import { Avatar, Badge, Button, Card, DataTable, EmptyState, Field, Icon, Input, Modal, SearchInput, Select, Tabs, type Column } from '@/components/ui';
import { SectionHeader } from '../_components/SectionHeader';
import { Notice, type NoticeMsg } from '../_components/Notice';
import { sentenceCase } from '../_components/format';

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

/** Admin-tier roles read as accent; everyone else neutral. The label tells roles apart, not the colour. */
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'IT_ADMIN', 'HR_ADMIN', 'FINANCE_ADMIN']);
const roleTone = (role: string) => (ADMIN_ROLES.has(role) ? 'accent' : 'neutral');

/** Strength meter segments on the token scale (pwStrength's own classes predate the tokens). */
const STRENGTH_BAR = ['', 'bg-danger', 'bg-warn', 'bg-warn', 'bg-ok', 'bg-ok'];

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });

function StatusBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? 'ok' : 'danger'}>{active ? 'Active' : 'Locked'}</Badge>;
}

function MfaBadge({ enabled }: { enabled: boolean }) {
  return enabled
    ? <Badge tone="ok"><Icon name="shield" size={13} strokeWidth={2} className="mr-1" />MFA on</Badge>
    : <Badge>MFA not set up</Badge>;
}

// ─── Password strength ────────────────────────────────────────────────────────
// pwStrength now lives in @/lib/passwordReset so the self-service reset page
// shares the identical meter.

// ─── Manage-access drawer ─────────────────────────────────────────────────────
function AdjustPanel({
  user, roles, onClose, onRefresh,
}: {
  user: User; roles: Role[]; onClose: () => void; onRefresh: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>('role');

  // Role tab
  const [updateRole, setUpdateRole]   = useState(user.role);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleMsg, setRoleMsg]         = useState<NoticeMsg>(null);

  // Password tab
  const [pw, setPw]             = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg]       = useState('');
  const [pwError, setPwError]   = useState('');

  // MFA tab
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaMsg, setMfaMsg]         = useState<NoticeMsg>(null);
  const [mfaConfirm, setMfaConfirm] = useState(false);

  const handleRoleSave = async () => {
    setRoleLoading(true); setRoleMsg(null);
    try {
      await apiFetch(`/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role: updateRole }),
      });
      setRoleMsg({ tone: 'ok', text: 'Role updated successfully.' });
      onRefresh();
    } catch (e) { setRoleMsg({ tone: 'danger', text: (e as Error).message || 'Update failed.' }); }
    setRoleLoading(false);
  };

  const handleToggleActive = async () => {
    setRoleLoading(true); setRoleMsg(null);
    try {
      await apiFetch(`/users/${user.id}/toggle-active`, { method: 'PATCH' });
      setRoleMsg({ tone: 'ok', text: `Account ${user.isActive ? 'locked' : 'unlocked'}.` });
      onRefresh();
    } catch (e) { setRoleMsg({ tone: 'danger', text: (e as Error).message || 'Failed.' }); }
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
      setPwMsg('Password reset. All active sessions invalidated.');
      setPw(''); setPwConfirm('');
    } catch (e) { setPwError((e as Error).message || 'Reset failed.'); }
    setPwLoading(false);
  };

  const handleMfaReset = async () => {
    setMfaLoading(true); setMfaMsg(null);
    try {
      await apiFetch(`/users/${user.id}/reset-mfa`, { method: 'POST' });
      setMfaMsg({ tone: 'ok', text: 'MFA cleared. User must re-enrol on next login.' });
      setMfaConfirm(false); onRefresh();
    } catch (e) { setMfaMsg({ tone: 'danger', text: (e as Error).message || 'Reset failed.' }); }
    setMfaLoading(false);
  };

  // The reset button and its confirm row swap in place; move focus with the swap
  // (onto Cancel when the confirm appears, back to the button when it goes) so
  // keyboard focus never falls to <body>. Only a real change moves focus (so the
  // open render — and Strict Mode's doubled effect — leave the Modal's focus alone).
  const resetRowRef = useRef<HTMLDivElement>(null);
  const confirmRowRef = useRef<HTMLDivElement>(null);
  const prevConfirm = useRef(mfaConfirm);
  useEffect(() => {
    if (prevConfirm.current === mfaConfirm) return;
    prevConfirm.current = mfaConfirm;
    const row = mfaConfirm ? confirmRowRef.current : resetRowRef.current;
    row?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [mfaConfirm]);

  const strength = pwStrength(pw);
  const mismatch = !!pwConfirm && pw !== pwConfirm;

  const TABS: { id: PanelTab; label: string }[] = [
    { id: 'role', label: 'Access and role' },
    { id: 'password', label: 'Reset password' },
    { id: 'mfa', label: 'MFA' },
  ];

  const spinner = <svg className="w-4 h-4 animate-spin rounded-full" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>;

  // The dialog chrome (focus-in, Tab trap, Escape, focus return) is the kit Modal
  // the page wraps this in; `onClose` is kept for parity with the old drawer API.
  void onClose;

  return (
    <div className="-mx-5 flex flex-col">
        <Tabs items={TABS} active={tab} onChange={setTab} className="px-3" />

        <div className="px-5 pt-5">

          {/* ── Access and role ─────────────────────────────────────────── */}
          {tab === 'role' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-semibold text-muted">Current role</span>
                <div><Badge tone={roleTone(user.role)}>{sentenceCase(user.role)}</Badge></div>
              </div>

              <Field label="Assign a new role">
                <Select value={updateRole} onChange={e => setUpdateRole(e.target.value)}>
                  {roles.map(r => (
                    <option key={r.id} value={r.name}>{sentenceCase(r.name)}</option>
                  ))}
                </Select>
              </Field>

              <div className="flex flex-col gap-1.5">
                <Button
                  className="w-full"
                  onClick={handleRoleSave}
                  disabled={roleLoading || updateRole === user.role}
                >
                  {roleLoading ? 'Saving…' : 'Save role'}
                </Button>
                {!roleLoading && updateRole === user.role && (
                  <span className="text-xs text-muted">Choose a different role to save.</span>
                )}
              </div>

              {roleMsg && <Notice tone={roleMsg.tone}>{roleMsg.text}</Notice>}

              <div className="flex flex-col gap-3 border-t border-rule pt-5">
                <span className="text-[12.5px] font-semibold text-muted">Account status</span>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-rule bg-page p-4">
                  <div className="flex flex-col gap-1">
                    <StatusBadge active={user.isActive} />
                    {user.lastLoginAt && (
                      <p className="text-xs text-muted">
                        Last sign-in <span className="tabular-nums">{fmtDate(user.lastLoginAt)}</span>
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={user.isActive ? 'danger' : 'secondary'}
                    icon={user.isActive ? 'lock' : undefined}
                    onClick={handleToggleActive}
                    disabled={roleLoading}
                  >
                    {user.isActive ? 'Lock account' : 'Unlock account'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ── Reset password ──────────────────────────────────────────── */}
          {tab === 'password' && (
            <div className="flex flex-col gap-5">
              <Notice tone="warn">
                Setting a new password immediately signs <strong>{user.name}</strong> out of every session. They will need to sign in again.
              </Notice>

              <Field label="New password" required>
                <div className="relative">
                  <Input
                    type={showPw ? 'text' : 'password'}
                    value={pw}
                    onChange={e => setPw(e.target.value)}
                    placeholder="At least 8 characters"
                    className="pr-16"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-control px-2 py-1 text-[13px] font-semibold text-accent hover:bg-tint"
                  >
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>

              {pw && (
                <div className="-mt-3 flex flex-col gap-1.5">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= strength.score ? STRENGTH_BAR[strength.score] : 'bg-rule'}`} />
                    ))}
                  </div>
                  <p aria-live="polite" className={`text-xs font-semibold ${strength.score >= 3 ? 'text-ok' : 'text-muted'}`}>
                    Strength: {strength.label.toLowerCase()}
                  </p>
                </div>
              )}

              <Field label="Confirm password" required error={mismatch ? 'Passwords do not match.' : undefined}>
                <Input
                  type={showPw ? 'text' : 'password'}
                  value={pwConfirm}
                  onChange={e => setPwConfirm(e.target.value)}
                  placeholder="Re-enter the password"
                  invalid={mismatch}
                />
              </Field>

              {pwError && <Notice tone="danger">{pwError}</Notice>}
              {pwMsg   && <Notice tone="ok">{pwMsg}</Notice>}

              <div className="flex flex-col gap-1.5">
                <Button
                  className="w-full"
                  onClick={handlePasswordReset}
                  disabled={pwLoading || !pw || pw !== pwConfirm}
                >
                  {pwLoading && spinner}
                  {pwLoading ? 'Resetting…' : 'Set new password'}
                </Button>
                {!pwLoading && (!pw || pw !== pwConfirm) && (
                  <span className="text-xs text-muted">{!pw ? 'Enter a new password first.' : 'Both passwords must match.'}</span>
                )}
              </div>
            </div>
          )}

          {/* ── MFA ─────────────────────────────────────────────────────── */}
          {tab === 'mfa' && (
            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-4 rounded-control border border-rule bg-page p-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control ${user.mfaEnabled ? 'bg-tint text-accent' : 'bg-pill text-muted'}`}>
                  <Icon name="shield" size={20} />
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-bold text-ink">
                    MFA is {user.mfaEnabled ? 'on' : 'not set up'}
                  </p>
                  <p className="text-[13px] text-muted">
                    {user.mfaEnabled
                      ? 'Time-based one-time password (TOTP) is active for this account.'
                      : 'This user has not set up multi-factor authentication yet.'}
                  </p>
                </div>
              </div>

              {user.mfaEnabled && (
                <div className="flex flex-col gap-4">
                  <Notice tone="warn">
                    Resetting MFA <strong>clears the authenticator secret</strong> and signs the user out of every session. They re-enrol with their authenticator app at next sign-in.
                  </Notice>

                  {!mfaConfirm ? (
                    <div ref={resetRowRef}>
                      <Button variant="danger" className="w-full" onClick={() => setMfaConfirm(true)}>
                        Reset MFA for {user.name}
                      </Button>
                    </div>
                  ) : (
                    <div ref={confirmRowRef} role="group" aria-label={`Confirm MFA reset for ${user.name}`} className="flex flex-col gap-3 rounded-control border border-danger bg-paper p-4">
                      <p className="text-sm font-bold text-ink">Reset MFA for {user.name}?</p>
                      <p className="text-[13px] text-muted">This cannot be undone. The user is signed out immediately.</p>
                      <div className="flex gap-3">
                        <Button variant="secondary" className="flex-1" onClick={() => setMfaConfirm(false)}>
                          Cancel
                        </Button>
                        <Button variant="danger" className="flex-1" onClick={handleMfaReset} disabled={mfaLoading}>
                          {mfaLoading && spinner}
                          {mfaLoading ? 'Resetting…' : 'Confirm reset'}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!user.mfaEnabled && (
                <div className="flex flex-col gap-3 rounded-control border border-rule bg-page p-4">
                  <p className="text-sm font-bold text-ink">How MFA enrolment works</p>
                  <ol className="flex flex-col gap-2.5">
                    {[
                      'User logs in with their email and password',
                      'They visit Account Settings → Setup MFA',
                      'They scan the QR code with an authenticator app (Google Authenticator, Authy, etc.)',
                      'MFA is active on next login',
                    ].map((step, i) => (
                      <li key={i} className="flex items-start gap-3 text-[13px] text-ink">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tint text-xs font-bold text-accent tabular-nums">{i + 1}</span>
                        <span className="pt-0.5">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {mfaMsg && <Notice tone={mfaMsg.tone}>{mfaMsg.text}</Notice>}
            </div>
          )}
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

  // Stable identity: Modal re-runs its focus effect whenever onClose changes,
  // which would pull focus out of the inputs on every keystroke.
  const closeCreate = useCallback(() => { setIsCreateOpen(false); setCreateError(''); }, []);

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
  function SortHeader({ col, label }: { col: typeof userSort.col; label: string }) {
    const on = userSort.col === col;
    return (
      <button
        type="button"
        onClick={() => toggleUserSort(col)}
        aria-label={`Sort by ${label.toLowerCase()}${on ? (userSort.dir === 'asc' ? ', ascending' : ', descending') : ''}`}
        className={`inline-flex items-center gap-1 hover:text-ink ${on ? 'text-ink' : ''}`}
      >
        {label}
        {on && <Icon name="chevronDown" size={13} strokeWidth={2.25} className={userSort.dir === 'asc' ? 'rotate-180' : ''} />}
      </button>
    );
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center gap-4 p-24">
      <div className="h-10 w-10 border-4 border-accent border-t-transparent animate-spin rounded-full" />
      <p className="text-sm text-muted">Loading users…</p>
    </div>
  );

  if (!hasPermission('user:manage')) return (
    <Card padding="p-0">
      <EmptyState
        icon="lock"
        title="You don't have access to user management"
        description="This needs the user:manage permission. Ask a Super Admin if you should have it."
      />
    </Card>
  );

  const missingRequired = !newUser.name || !newUser.email || !newUser.password;

  const columns: Column<User>[] = [
    {
      key: 'name', label: <SortHeader col="name" label="User" />, width: 'minmax(0, 1.8fr)',
      render: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.name} size={36} tone="soft" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-ink">{u.name}</span>
            <span className="truncate text-[12.5px] text-muted">{u.email}</span>
          </div>
        </div>
      ),
    },
    { key: 'role', label: <SortHeader col="role" label="Role" />, width: '170px', render: (u) => <Badge tone={roleTone(u.role)}>{sentenceCase(u.role)}</Badge> },
    { key: 'status', label: <SortHeader col="status" label="Status" />, width: '110px', render: (u) => <StatusBadge active={u.isActive} /> },
    { key: 'mfa', label: <SortHeader col="mfa" label="MFA" />, width: '150px', render: (u) => <MfaBadge enabled={u.mfaEnabled} /> },
    { key: 'created', label: <SortHeader col="created" label="Created" />, width: '120px', numeric: true, render: (u) => <span className="text-muted">{fmtDate(u.createdAt)}</span> },
    {
      key: 'actions', label: <span className="sr-only">Actions</span>, width: '110px', align: 'right',
      render: (u) => <Button size="sm" variant="secondary" onClick={() => setSelectedUser(u)}>Manage</Button>,
    },
  ];

  return (
    <>
      <SectionHeader
        title="Users"
        description={<><span className="tabular-nums">{users.length}</span> {users.length === 1 ? 'person has' : 'people have'} a sign-in to this workspace.</>}
        actions={<Button icon="plus" onClick={() => setIsCreateOpen(true)}>New user</Button>}
      />

      <SearchInput
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, email or role…"
        aria-label="Search users"
        className="sm:max-w-sm"
      />

      <DataTable
        aria-label="Users"
        columns={columns}
        rows={filtered}
        rowKey={(u) => u.id}
        empty={
          <EmptyState
            icon="users"
            title={search ? 'No users match your search' : 'No users yet'}
            description={search ? 'Try a name, email address or role.' : 'Create the first sign-in with New user.'}
          />
        }
        footer={<span><span className="tabular-nums">{filtered.length}</span> of <span className="tabular-nums">{users.length}</span> shown</span>}
        mobileCard={(u) => (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={u.name} size={36} tone="soft" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-ink">{u.name}</span>
                <span className="truncate text-[12.5px] text-muted">{u.email}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={roleTone(u.role)}>{sentenceCase(u.role)}</Badge>
              <StatusBadge active={u.isActive} />
              <MfaBadge enabled={u.mfaEnabled} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted">Created <span className="tabular-nums">{fmtDate(u.createdAt)}</span></span>
              <Button size="sm" variant="secondary" onClick={() => setSelectedUser(u)}>Manage</Button>
            </div>
          </div>
        )}
      />

      {/* Manage access — the kit Modal stays mounted so closing returns focus to the row's Manage button */}
      <Modal
        open={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        size="lg"
        title={selectedUser ? `Manage access — ${selectedUser.name}` : 'Manage access'}
        caption={selectedUser?.email}
      >
        {selectedUser && (
          <AdjustPanel
            key={selectedUser.id}
            user={selectedUser}
            roles={roles}
            onClose={() => setSelectedUser(null)}
            onRefresh={() => { fetchData(); setSelectedUser(null); }}
          />
        )}
      </Modal>

      {/* Create user */}
      <Modal
        open={isCreateOpen}
        onClose={closeCreate}
        title="New user"
        caption="Create a sign-in for someone in this workspace."
        footer={
          <>
            <Button variant="secondary" onClick={closeCreate}>Cancel</Button>
            <Button onClick={handleCreateUser} disabled={createLoading || missingRequired}>
              {createLoading ? 'Creating…' : 'Create user'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {[
            { label: 'Full name', key: 'name',     type: 'text',     placeholder: 'Jane Smith' },
            { label: 'Email',     key: 'email',    type: 'email',    placeholder: 'jane@company.com' },
            { label: 'Password',  key: 'password', type: 'password', placeholder: 'At least 8 characters' },
          ].map(f => (
            <Field key={f.key} label={f.label} required>
              <Input
                type={f.type}
                value={(newUser as Record<string, string>)[f.key]}
                onChange={e => setNewUser({ ...newUser, [f.key]: e.target.value })}
                placeholder={f.placeholder}
              />
            </Field>
          ))}
          <Field label="Role">
            <Select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
              {roles.map(r => <option key={r.id} value={r.name}>{sentenceCase(r.name)}</option>)}
            </Select>
          </Field>
          {!createLoading && missingRequired && (
            <p className="text-xs text-muted">Name, email and password are required to create the user.</p>
          )}
          {createError && <Notice tone="danger">{createError}</Notice>}
        </div>
      </Modal>
    </>
  );
}
