'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { Avatar, Badge, Button, Card, CardHeader, Field, Input, Modal, Select, Stat, Textarea, useToast } from '@/components/ui';
import { SectionHeader } from '../_components/SectionHeader';
import { SettingRow } from '../_components/SettingRow';
import { Toggle } from '../_components/Toggle';
import { Notice } from '../_components/Notice';

interface OrgUser { id: string; name: string; email: string; role: string; mfaEnabled: boolean; mfaExempt: boolean; isActive: boolean; }
interface ResetMfaState { userId: string; step: 'confirm' | 'loading'; }
type MfaMethod = 'TOTP' | 'EMAIL_OTP' | 'EITHER';

const MFA_METHOD_OPTIONS: { value: MfaMethod; label: string; desc: string; badge: string; recommended?: boolean }[] = [
  {
    value: 'TOTP',
    label: 'Authenticator app (TOTP)',
    desc: 'Microsoft Authenticator, Google Authenticator, Authy — 6-digit rotating code. Most secure.',
    badge: 'Recommended',
    recommended: true,
  },
  {
    value: 'EMAIL_OTP',
    label: 'Email one-time password',
    desc: 'A 6-digit code is emailed to the user on each login. No app required.',
    badge: 'Easy setup',
  },
  {
    value: 'EITHER',
    label: 'Either (user’s choice)',
    desc: 'Users with an authenticator app use TOTP; others receive an email code. Most flexible.',
    badge: 'Flexible',
  },
];

const SSO_PROVIDERS = [
  { id: 'google',    name: 'Google Workspace', mark: 'G', desc: 'Sign in with Google accounts from your organisation domain' },
  { id: 'microsoft', name: 'Microsoft Azure AD', mark: 'M', desc: 'Integrate with Microsoft Entra ID (formerly Azure AD)' },
  { id: 'apple',     name: 'Apple Business Connect', mark: 'A', desc: 'Allow Sign in with Apple for supported users' },
  { id: 'okta',      name: 'Okta', mark: 'O', desc: 'Connect your Okta identity provider via OIDC/SAML' },
];

const SESSION_OPTS = [
  { label: 'Enforce HTTPS only', desc: 'Block all non-TLS connections', defaultOn: true },
  { label: 'Log all login events', desc: 'Write to audit trail on every auth', defaultOn: true },
  { label: 'Block concurrent sessions', desc: 'One active session per user', defaultOn: false },
  { label: 'Send login alerts', desc: 'Email notification on new device login', defaultOn: false },
] as const;


const spinner = (cls = 'h-4 w-4') => <svg className={`animate-spin rounded-full ${cls}`} fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>;

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
  const [ssoSecrets, setSsoSecrets] = useState<Record<string, string>>({});
  const [ssoSecretStatus, setSsoSecretStatus] = useState<Record<string, boolean>>({});

  // Session policy
  const [sessionTimeout, setSessionTimeout] = useState('60');
  const [ipWhitelist, setIpWhitelist] = useState('');
  const [securityToggles, setSecurityToggles] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const opt of SESSION_OPTS) {
      const key = `session_${opt.label.replace(/\s/g, '_')}`;
      const stored = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
      init[key] = stored !== null ? stored === 'true' : opt.defaultOn;
    }
    return init;
  });

  // UI
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    // Same call shape as before; the shared toast (root layout) does the display and timing.
    toast(msg, type === 'success' ? 'ok' : 'danger');
  };

  // Load persisted settings from localStorage + MFA method from API
  useEffect(() => {
    const saved = localStorage.getItem('gadonghr_security_settings');
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

    // Load SSO secret status (booleans only — never the actual secrets)
    apiFetch('/auth/org-settings/sso-secrets/status').then(d => {
      if (d) setSsoSecretStatus({ google: !!d.google?.hasSecret, microsoft: !!d.microsoft?.hasSecret });
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

  // Stable identity: Modal re-runs its focus effect whenever onClose changes.
  const closeResetMfa = useCallback(() => setResetMfa(null), []);

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
    try {
      const settings = { mfaRequired, ssoEnabled, ssoConfig, sessionTimeout, ipWhitelist };
      localStorage.setItem('gadonghr_security_settings', JSON.stringify(settings));

      // Persist public SSO config (clientId, domain, tenantId) to server
      await apiFetch('/auth/org-settings/general', { method: 'PUT', body: JSON.stringify({ ssoConfig }) }).catch(() => {});

      // Persist secrets separately if the admin typed any — never stored locally
      const secretsPayload: Record<string, { clientSecret: string }> = {};
      for (const [id, secret] of Object.entries(ssoSecrets)) {
        if (secret.trim()) secretsPayload[id] = { clientSecret: secret.trim() };
      }
      if (Object.keys(secretsPayload).length > 0) {
        await apiFetch('/auth/org-settings/sso-secrets', { method: 'PUT', body: JSON.stringify(secretsPayload) });
        // Mark those providers as having a secret now, clear the typed values
        setSsoSecretStatus(prev => {
          const next = { ...prev };
          for (const id of Object.keys(secretsPayload)) next[id] = true;
          return next;
        });
        setSsoSecrets({});
      }

      showToast('Security settings saved');
    } catch (e: any) {
      showToast(e.message || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const role = user?.role?.toUpperCase() ?? '';
  const canEdit = role === 'SUPER_ADMIN' || role === 'IT_ADMIN';

  const activeUsers = users.filter(u => u.isActive);

  return (
    <>
      <SectionHeader
        title="Security"
        description="Multi-factor authentication, single sign-on and session policy."
        actions={canEdit ? (
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <>{spinner()}Saving…</> : 'Save settings'}
          </Button>
        ) : undefined}
      />

      {!canEdit && (
        <Notice tone="warn">Read-only. A Super Admin or IT Admin is needed to change these settings.</Notice>
      )}

      {/* Multi-factor authentication */}
      <Card padding="px-[22px] pt-5 pb-5">
        <CardHeader title="Multi-factor authentication" caption="How people prove it's them at sign-in." />

        <SettingRow
          title="Require MFA for all users"
          description="Every account must enrol in MFA before using the system. You can exempt individual people below."
          control={
            <Toggle
              label="Require MFA for all users"
              on={mfaRequired}
              disabled={!canEdit}
              onChange={async v => {
                if (!canEdit) return;
                setMfaRequired(v);
                try {
                  await apiFetch('/auth/org-settings/mfa', { method: 'PUT', body: JSON.stringify({ mfaRequired: v }) });
                  showToast(`Org-wide MFA requirement ${v ? 'enabled' : 'disabled'}`);
                } catch (e: any) {
                  setMfaRequired(!v); // revert on error
                  showToast(e.message || 'Failed to update MFA policy', 'error');
                }
              }}
            />
          }
        />

        <div className="flex flex-col gap-3 border-t border-rule pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-[3px]">
              <span className="text-sm font-semibold text-ink">MFA method</span>
              <span className="text-[13px] text-muted">How users verify their identity at sign-in.</span>
            </div>
            {savingMfaMethod && (
              <span className="flex items-center gap-2 text-[13px] text-muted">{spinner('h-3.5 w-3.5 text-accent')}Saving…</span>
            )}
          </div>

          <div role="radiogroup" aria-label="MFA method" className="flex flex-col gap-2.5">
            {MFA_METHOD_OPTIONS.map(opt => {
              const on = mfaMethod === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!canEdit || savingMfaMethod}
                  onClick={() => canEdit && handleSaveMfaMethod(opt.value)}
                  className={`flex items-start gap-3 rounded-control border p-3.5 text-left transition-colors disabled:cursor-not-allowed ${
                    on ? 'border-accent bg-tint' : 'border-rule bg-paper hover:bg-page'
                  } ${!canEdit ? 'opacity-60' : ''}`}
                >
                  <span className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-accent' : 'border-rule'}`}>
                    {on && <span className="h-2 w-2 rounded-full bg-accent" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-semibold ${on ? 'text-accent' : 'text-ink'}`}>{opt.label}</span>
                      <Badge tone={opt.recommended ? 'accent' : 'neutral'}>{opt.badge}</Badge>
                    </span>
                    <span className="text-[13px] text-muted">{opt.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <Notice>
            <strong className="font-semibold">Microsoft Authenticator push notifications.</strong>{' '}
            Number matching (pick 1 of 3) and approve/deny push need <strong className="font-semibold">Azure AD / Microsoft Entra ID</strong> — turn it on in Single sign-on below with your Microsoft tenant.
          </Notice>
        </div>
      </Card>

      {/* MFA coverage */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="MFA on" value={usersLoading ? '—' : mfaCount} note="accounts enrolled" />
        <Stat label="Not enrolled" value={usersLoading ? '—' : users.length - mfaCount} note="will be prompted if MFA is required" />
        <Stat label="Coverage" value={usersLoading ? '—' : `${users.length > 0 ? Math.round((mfaCount / users.length) * 100) : 0}%`} note="of all accounts" />
      </div>

      {/* Per-user MFA */}
      <Card padding="px-[22px] pt-5 pb-2">
        <CardHeader title="People" caption="Per-person overrides apply even while the org-wide requirement is on." />
        <dl className="mb-3 grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-control bg-page px-4 py-3 text-[13px] sm:grid-cols-2">
          <div className="flex gap-1.5"><dt className="font-semibold text-ink">Enable</dt><dd className="text-muted">forces MFA on</dd></div>
          <div className="flex gap-1.5"><dt className="font-semibold text-ink">Disable</dt><dd className="text-muted">turns it off, keeps the secret</dd></div>
          <div className="flex gap-1.5"><dt className="font-semibold text-ink">Exempt</dt><dd className="text-muted">skips the org requirement</dd></div>
          <div className="flex gap-1.5"><dt className="font-semibold text-ink">Reset</dt><dd className="text-muted">wipes it; they re-enrol</dd></div>
        </dl>

        {usersLoading && <p className="py-6 text-center text-sm text-muted">Loading people…</p>}
        {!usersLoading && users.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">No user accounts could be loaded.</p>
        )}

        {!usersLoading && users.length > 0 && (
          <div className="max-h-[420px] overflow-y-auto">
            {activeUsers.slice(0, 50).map(u => {
              const isBusy = disablingMfa === u.id || resetMfa?.userId === u.id;
              return (
                <div key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-rule py-3">
                  <Avatar name={u.name} size={32} tone="soft" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{u.name}</p>
                    <p className="truncate text-[12.5px] text-muted">{u.email}</p>
                  </div>

                  <Badge tone={u.mfaExempt ? 'warn' : u.mfaEnabled ? 'ok' : 'neutral'}>
                    {u.mfaExempt ? 'Exempt' : u.mfaEnabled ? 'MFA on' : 'No MFA'}
                  </Badge>

                  {canEdit && (
                    <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto">
                      {!u.mfaEnabled && !u.mfaExempt && (
                        <Button size="sm" variant="ghost" onClick={() => handleEnableMfa(u.id, u.name)} disabled={isBusy}>
                          Enable
                        </Button>
                      )}
                      {u.mfaEnabled && (
                        <Button size="sm" variant="ghost" onClick={() => handleDisableMfa(u.id, u.name)} disabled={isBusy}>
                          {disablingMfa === u.id ? 'Disabling…' : 'Disable'}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => handleToggleExempt(u.id, u.name, u.mfaExempt)} disabled={isBusy}>
                        {u.mfaExempt ? 'Remove exemption' : 'Exempt'}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => handleResetMfa(u.id, 'reset')} disabled={isBusy}>
                        {resetMfa?.userId === u.id && resetMfa.step === 'loading' ? 'Resetting…' : 'Reset'}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {activeUsers.length > 50 && (
          <p className="border-t border-rule py-3 text-[13px] text-muted">
            Showing <span className="tabular-nums">50</span> of <span className="tabular-nums">{activeUsers.length}</span> active users.
          </p>
        )}
      </Card>

      {/* Single sign-on */}
      <Card padding="px-[22px] pt-5 pb-5">
        <CardHeader title="Single sign-on" caption="OIDC / SAML 2.0 identity providers." />
        <div className="flex flex-col gap-3">
          {SSO_PROVIDERS.map(provider => {
            const enabled = ssoEnabled[provider.id] ?? false;
            const cfg = ssoConfig[provider.id] ?? { clientId: '', domain: '' };
            const expanded = expandedSso === provider.id;

            return (
              <div key={provider.id} className={`overflow-hidden rounded-control border transition-colors ${enabled ? 'border-accent' : 'border-rule'}`}>
                <div className={`flex flex-wrap items-center gap-x-4 gap-y-3 p-4 ${enabled ? 'bg-tint' : 'bg-paper'}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-rule bg-paper text-sm font-bold text-ink" aria-hidden="true">
                    {provider.mark}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{provider.name}</p>
                    <p className="text-[13px] text-muted">{provider.desc}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {enabled && (
                      <Button size="sm" variant="ghost" onClick={() => setExpandedSso(expanded ? null : provider.id)} aria-expanded={expanded}>
                        {expanded ? 'Hide settings' : 'Configure'}
                      </Button>
                    )}
                    <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? 'On' : 'Off'}</Badge>
                    <Toggle
                      label={`${provider.name} sign-in`}
                      on={enabled}
                      disabled={!canEdit}
                      onChange={v => {
                        if (!canEdit) return;
                        setSsoEnabled(prev => ({ ...prev, [provider.id]: v }));
                        if (v) setExpandedSso(provider.id);
                        else setExpandedSso(null);
                      }}
                    />
                  </div>
                </div>

                {enabled && expanded && (
                  <div className="flex flex-col gap-4 border-t border-rule bg-paper p-4">
                    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${provider.id === 'microsoft' ? 'lg:grid-cols-3' : ''}`}>
                      <Field label="Client ID / app ID">
                        <Input
                          type="text"
                          value={cfg.clientId}
                          onChange={e => setSsoConfig(prev => ({ ...prev, [provider.id]: { ...cfg, clientId: e.target.value } }))}
                          placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                          disabled={!canEdit}
                        />
                      </Field>
                      {provider.id === 'microsoft' && (
                        <Field label="Tenant ID">
                          <Input
                            type="text"
                            value={(cfg as { clientId: string; domain: string; tenantId?: string }).tenantId ?? ''}
                            onChange={e => setSsoConfig(prev => ({ ...prev, [provider.id]: { ...cfg, tenantId: e.target.value } }))}
                            placeholder="common (or your tenant UUID)"
                            disabled={!canEdit}
                          />
                        </Field>
                      )}
                      <Field label="Organisation domain">
                        <Input
                          type="text"
                          value={cfg.domain}
                          onChange={e => setSsoConfig(prev => ({ ...prev, [provider.id]: { ...cfg, domain: e.target.value } }))}
                          placeholder="e.g. yourcompany.com"
                          disabled={!canEdit}
                        />
                      </Field>
                    </div>

                    {/* Client secret — server-side only, never returned */}
                    <Field
                      label={
                        <span className="flex items-center gap-2">
                          Client secret
                          {ssoSecretStatus[provider.id] && <Badge tone="ok">Secret saved</Badge>}
                        </span>
                      }
                      help="Stored encrypted on the server and never shown again after saving."
                    >
                      <Input
                        type="password"
                        value={ssoSecrets[provider.id] ?? ''}
                        onChange={e => setSsoSecrets(prev => ({ ...prev, [provider.id]: e.target.value }))}
                        placeholder={ssoSecretStatus[provider.id] ? 'Enter a new value to replace the saved secret' : 'Paste your client secret'}
                        disabled={!canEdit}
                        autoComplete="new-password"
                      />
                    </Field>

                    <div className="flex flex-col gap-1 rounded-control bg-page px-3.5 py-2.5 text-[13px]">
                      <span className="font-semibold text-ink">Callback URL</span>
                      <span className="select-all break-all font-mono text-muted">{typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback/{provider.id}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Sessions and access */}
      <Card padding="px-[22px] pt-5 pb-3">
        <CardHeader title="Sessions and access" caption="Token expiry and network restrictions." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Session timeout" help="People are signed out after this long without activity.">
            <Select value={sessionTimeout} onChange={e => setSessionTimeout(e.target.value)} disabled={!canEdit}>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour (default)</option>
              <option value="120">2 hours</option>
              <option value="480">8 hours</option>
              <option value="1440">24 hours</option>
            </Select>
          </Field>
          <Field label="Current token expiry" help="Set in the auth service configuration.">
            <div className="flex h-[42px] items-center rounded-control border border-rule bg-page px-3 text-sm text-ink tabular-nums">60 min (JWT RS256)</div>
          </Field>
        </div>

        <Field label="IP allow-list" help="One per line; CIDR supported. Leave blank to allow all. Applies to admin roles only." className="mt-4">
          <Textarea
            value={ipWhitelist}
            onChange={e => setIpWhitelist(e.target.value)}
            rows={4}
            disabled={!canEdit}
            placeholder={'e.g.\n203.0.113.0/24\n192.168.1.0/24'}
            className="resize-none font-mono"
          />
        </Field>

        <div className="mt-2">
          {SESSION_OPTS.map(opt => {
            const key = `session_${opt.label.replace(/\s/g, '_')}`;
            return (
              <SettingRow
                key={opt.label}
                title={opt.label}
                description={opt.desc}
                control={
                  <Toggle
                    label={opt.label}
                    on={securityToggles[key]}
                    disabled={!canEdit}
                    onChange={v => {
                      if (!canEdit) return;
                      setSecurityToggles(prev => ({ ...prev, [key]: v }));
                      if (typeof window !== 'undefined') localStorage.setItem(key, String(v));
                    }}
                  />
                }
              />
            );
          })}
        </div>
      </Card>

      {/* Disable / reset MFA confirmation */}
      {(() => {
        const u = users.find(x => x.id === resetMfa?.userId);
        const isReset = resetMfaMode === 'reset';
        return (
          <Modal
            open={resetMfa?.step === 'confirm'}
            title={isReset ? 'Reset MFA' : 'Disable MFA'}
            caption={isReset ? 'Wipes the authenticator; they must enrol again.' : 'Turns MFA off; the secret is kept.'}
            onClose={closeResetMfa}
            footer={
              <>
                <Button variant="secondary" onClick={closeResetMfa}>Cancel</Button>
                <Button variant={isReset ? 'danger' : 'primary'} onClick={confirmResetMfa}>
                  Confirm {isReset ? 'reset' : 'disable'}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink">
                {isReset ? 'Reset' : 'Disable'} MFA for <strong className="font-semibold">{u?.name}</strong>?
              </p>
              <p className="text-[13px] text-muted">
                {isReset
                  ? 'Their authenticator app entry will be unlinked. They must scan a new QR code to re-enroll.'
                  : 'MFA will be turned off but their authenticator app stays linked. An admin can re-enable it without a new QR scan.'}
              </p>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
