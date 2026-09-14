'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, Select, Tabs, useToast } from '@/components/ui';
import { SectionHeader } from '../_components/SectionHeader';
import { Notice } from '../_components/Notice';

type Tab = 'email' | 'keys' | 'webhooks';

interface ApiKey {
  id: string;
  name: string;
  key: string;
  permissions: string[];
  expiresAt: string | null;
  createdAt: string;
  active: boolean;
}

interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  createdAt: string;
}

const WEBHOOK_EVENTS = [
  { id: 'employee.created',    label: 'Employee created',    group: 'Employees' },
  { id: 'employee.updated',    label: 'Employee updated',    group: 'Employees' },
  { id: 'employee.terminated', label: 'Employee terminated', group: 'Employees' },
  { id: 'payroll.finalized',   label: 'Payroll finalized',   group: 'Payroll' },
  { id: 'payroll.paid',        label: 'Payroll paid',        group: 'Payroll' },
  { id: 'leave.approved',      label: 'Leave approved',      group: 'Leave' },
  { id: 'leave.rejected',      label: 'Leave rejected',      group: 'Leave' },
  { id: 'claim.approved',      label: 'Claim approved',      group: 'Claims' },
  { id: 'claim.rejected',      label: 'Claim rejected',      group: 'Claims' },
  { id: 'user.created',        label: 'User created',        group: 'Users' },
  { id: 'user.deactivated',    label: 'User deactivated',    group: 'Users' },
];

const KEY_PERMISSIONS = [
  'read:employees', 'read:payroll', 'read:leave', 'read:claims',
  'write:employees', 'write:payroll', 'write:leave', 'write:claims',
];

function genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function genKey() { return 'vhk_live_' + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
function genSecret() { return 'whsec_' + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }

/**
 * The tabs report through `setToast({ msg, type })` as they always have; this
 * routes those calls to the shared toast (root layout) so the call sites stay
 * exactly as they were.
 */
function useTabToast() {
  const { toast } = useToast();
  return useCallback((t: { msg: string; type: 'ok' | 'err' } | null) => {
    if (t) toast(t.msg, t.type === 'ok' ? 'ok' : 'danger');
  }, [toast]);
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      aria-live="polite"
      onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

const spinner = <span className="h-4 w-4 border-2 border-on-accent/30 border-t-on-accent animate-spin rounded-full" />;

// ── Email tab ─────────────────────────────────────────────────────────────────
function EmailTab() {
  const [smtp, setSmtp] = useState({ host: '', port: '587', user: '', pass: '', from: '', hasPassword: false });
  const [showPass, setShowPass] = useState(false);
  const [passEditing, setPassEditing] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const setToast = useTabToast();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/notifications/smtp-config')
      .then(d => { setSmtp({ host: d.host || '', port: String(d.port || 587), user: d.user || '', pass: d.pass || '', from: d.from || '', hasPassword: d.hasPassword }); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await apiFetch('/notifications/smtp-config', {
        method: 'PUT',
        body: JSON.stringify({ host: smtp.host, port: Number(smtp.port), user: smtp.user, pass: passEditing ? smtp.pass : undefined, from: smtp.from }),
      });
      setPassEditing(false);
      setToast({ msg: 'SMTP configuration saved and applied.', type: 'ok' });
    } catch (e: any) { setToast({ msg: e.message, type: 'err' }); }
    finally { setSaving(false); }
  }

  async function handleTest() {
    if (!testEmail) return;
    setTesting(true);
    try {
      await apiFetch('/notifications/smtp-test', { method: 'POST', body: JSON.stringify({ to: testEmail }) });
      setToast({ msg: `Test email sent to ${testEmail} — check your inbox.`, type: 'ok' });
    } catch (e: any) { setToast({ msg: `Test failed: ${e.message}`, type: 'err' }); }
    finally { setTesting(false); }
  }

  if (loading) return <Card><p className="py-8 text-center text-sm text-muted">Loading email settings…</p></Card>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="SMTP server"
          caption="Every system email goes through this server. Changes apply immediately, without a restart."
          action={<Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>}
        />

        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="SMTP host" className="sm:col-span-2">
            <Input value={smtp.host} onChange={e => setSmtp(p => ({ ...p, host: e.target.value }))} placeholder="smtp.titan.email" />
          </Field>

          <Field label="Port">
            <Select value={smtp.port} onChange={e => setSmtp(p => ({ ...p, port: e.target.value }))}>
              <option value="587">587 (STARTTLS — recommended)</option>
              <option value="465">465 (SSL)</option>
              <option value="25">25 (plain — not recommended)</option>
            </Select>
          </Field>

          <Field label="From address">
            <Input value={smtp.from} onChange={e => setSmtp(p => ({ ...p, from: e.target.value }))} placeholder="no-reply@gadonghr.com" />
          </Field>

          <Field label="Username">
            <Input value={smtp.user} onChange={e => setSmtp(p => ({ ...p, user: e.target.value }))} placeholder="enquires@gadonghr.com" />
          </Field>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-muted">Password</span>
            <div className="flex gap-2">
              {passEditing ? (
                <Input
                  type={showPass ? 'text' : 'password'}
                  aria-label="New SMTP password"
                  value={smtp.pass}
                  onChange={e => setSmtp(p => ({ ...p, pass: e.target.value }))}
                  placeholder="Enter a new password"
                  className="flex-1"
                  autoFocus
                />
              ) : (
                <div className="flex h-[42px] flex-1 items-center rounded-control border border-rule bg-page px-3 text-sm text-muted">
                  {smtp.hasPassword ? '••••••••••••' : 'Not set'}
                </div>
              )}
              <Button variant="secondary" className="h-[42px]" onClick={() => { setPassEditing(e => !e); setShowPass(false); }}>
                {passEditing ? 'Cancel' : 'Change'}
              </Button>
              {passEditing && (
                <Button variant="ghost" className="h-[42px]" onClick={() => setShowPass(s => !s)}>
                  {showPass ? 'Hide' : 'Show'}
                </Button>
              )}
            </div>
          </div>
        </div>

        <Notice tone="warn" className="mt-4">
          Changes apply immediately to the running server. To keep them across container restarts, update the <code className="rounded border border-rule bg-paper px-1.5 py-0.5 font-mono text-ink">.env</code> file as well.
        </Notice>
      </Card>

      <Card>
        <CardHeader
          title="Send a test email"
          caption={<>Checks the current settings with a live message from <span className="font-semibold text-ink">{smtp.from || 'the configured from address'}</span>.</>}
        />
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Input type="email" aria-label="Send the test to" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="your@email.com" className="flex-1" />
          <Button onClick={handleTest} disabled={testing || !testEmail} className="h-[42px]">
            {testing && spinner}
            {testing ? 'Sending…' : 'Send test email'}
          </Button>
        </div>
        {!testing && !testEmail && <p className="mt-2 text-xs text-muted">Enter an address to send the test to.</p>}
      </Card>
    </div>
  );
}

// ── API keys tab ──────────────────────────────────────────────────────────────
function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPerms, setNewPerms] = useState<string[]>(['read:employees', 'read:payroll']);
  const [newExpiry, setNewExpiry] = useState('');
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  const setToast = useTabToast();
  // Stable identity: Modal re-runs its focus effect whenever onClose changes.
  const closeModal = useCallback(() => setShowModal(false), []);

  useEffect(() => {
    apiFetch('/auth/org-settings/general')
      .then(d => setKeys(d.apiKeys || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function persist(updated: ApiKey[]) {
    setKeys(updated);
    await apiFetch('/auth/org-settings/general', { method: 'PUT', body: JSON.stringify({ apiKeys: updated }) });
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    const k: ApiKey = {
      id: genId(), name: newName.trim(), key: genKey(),
      permissions: newPerms, expiresAt: newExpiry || null,
      createdAt: new Date().toISOString(), active: true,
    };
    try {
      await persist([...keys, k]);
      setJustCreated(k.key);
      setShowModal(false); setNewName(''); setNewPerms(['read:employees', 'read:payroll']); setNewExpiry('');
      setToast({ msg: "API key generated. Copy it now — it won't be shown again.", type: 'ok' });
    } catch (e: any) { setToast({ msg: e.message, type: 'err' }); }
  }

  async function handleRevoke(id: string) {
    try { await persist(keys.map(k => k.id === id ? { ...k, active: false } : k)); setToast({ msg: 'Key revoked.', type: 'ok' }); }
    catch (e: any) { setToast({ msg: e.message, type: 'err' }); }
  }

  async function handleDelete(id: string) {
    try { await persist(keys.filter(k => k.id !== id)); setToast({ msg: 'Key deleted.', type: 'ok' }); }
    catch (e: any) { setToast({ msg: e.message, type: 'err' }); }
  }

  const masked = (k: string) => k.slice(0, 12) + '•'.repeat(20) + k.slice(-4);

  return (
    <div className="flex flex-col gap-4">
      {justCreated && (
        <Card className="border-warn">
          <CardHeader title="Copy your API key now" caption="This is the only time the full key is shown after creation." />
          <div className="flex flex-col gap-2.5 rounded-control border border-rule bg-page px-3.5 py-3 sm:flex-row sm:items-center">
            <code className="flex-1 break-all font-mono text-[13px] text-ink">{justCreated}</code>
            <CopyButton value={justCreated} />
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setJustCreated(null)}>I&apos;ve copied it — dismiss</Button>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[15.5px] font-bold text-ink">API keys</h3>
          <p className="text-[13px] text-muted">Long-lived tokens for server-to-server integrations. Keys start with <code className="rounded bg-pill px-1 font-mono text-xs">vhk_live_</code>.</p>
        </div>
        <Button icon="plus" onClick={() => setShowModal(true)}>Generate key</Button>
      </div>

      {loading ? (
        <Card><p className="py-8 text-center text-sm text-muted">Loading keys…</p></Card>
      ) : keys.length === 0 ? (
        <Card padding="p-0">
          <EmptyState icon="lock" title="No API keys yet" description="Generate a key to let an external system read or write HR data." />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {keys.map(k => (
            <Card key={k.id} padding="p-4" className={!k.active ? 'opacity-70' : ''}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-ink">{k.name}</span>
                    <Badge tone={k.active ? 'ok' : 'danger'}>{k.active ? 'Active' : 'Revoked'}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="break-all font-mono text-[13px] text-muted">{revealId === k.id ? k.key : masked(k.key)}</code>
                    <Button size="sm" variant="ghost" onClick={() => setRevealId(revealId === k.id ? null : k.id)}>
                      {revealId === k.id ? 'Hide' : 'Reveal'}
                    </Button>
                    {revealId === k.id && <CopyButton value={k.key} />}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {k.permissions.map(p => (
                      <Badge key={p} className="font-mono">{p}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted tabular-nums">
                    Created {new Date(k.createdAt).toLocaleDateString()}
                    {k.expiresAt ? ` · expires ${new Date(k.expiresAt).toLocaleDateString()}` : ' · never expires'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {k.active && <Button size="sm" variant="secondary" onClick={() => handleRevoke(k.id)}>Revoke</Button>}
                  <Button size="sm" variant="danger" onClick={() => handleDelete(k.id)}>Delete</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onClose={closeModal}
        title="New API key"
        caption="The full key is shown once, right after it is created. Store it somewhere safe straight away."
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim()}>Generate key</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Key name" required help={!newName.trim() ? 'A name is required, so you can tell keys apart later.' : undefined}>
            <Input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. ERP integration, CI pipeline" />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[12.5px] font-semibold text-muted">Permissions</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {KEY_PERMISSIONS.map(p => (
                <label key={p} className="flex cursor-pointer items-center gap-2.5 rounded-control border border-rule px-3 py-2 text-[13px] text-ink hover:bg-page">
                  <input
                    type="checkbox"
                    checked={newPerms.includes(p)}
                    onChange={e => setNewPerms(e.target.checked ? [...newPerms, p] : newPerms.filter(x => x !== p))}
                    className="h-4 w-4 accent-accent"
                  />
                  <code className="font-mono text-[13px]">{p}</code>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Expiry date" help="Optional. Leave blank for a key that never expires.">
            <Input type="date" value={newExpiry} onChange={e => setNewExpiry(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

// ── Webhooks tab ──────────────────────────────────────────────────────────────
function WebhooksTab() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const setToast = useTabToast();
  // Stable identity: Modal re-runs its focus effect whenever onClose changes.
  const closeModal = useCallback(() => setShowModal(false), []);

  useEffect(() => {
    apiFetch('/auth/org-settings/general')
      .then(d => setWebhooks(d.webhooks || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function persist(updated: Webhook[]) {
    setWebhooks(updated);
    await apiFetch('/auth/org-settings/general', { method: 'PUT', body: JSON.stringify({ webhooks: updated }) });
  }

  async function handleAdd() {
    if (!newUrl.trim() || newEvents.length === 0) return;
    try { new URL(newUrl); } catch { setToast({ msg: 'Invalid URL.', type: 'err' }); return; }
    const wh: Webhook = {
      id: genId(), url: newUrl.trim(), events: newEvents,
      secret: genSecret(), active: true, createdAt: new Date().toISOString(),
    };
    try {
      await persist([...webhooks, wh]);
      setShowModal(false); setNewUrl(''); setNewEvents([]);
      setToast({ msg: 'Webhook endpoint registered.', type: 'ok' });
    } catch (e: any) { setToast({ msg: e.message, type: 'err' }); }
  }

  async function handleToggle(id: string) {
    try { await persist(webhooks.map(w => w.id === id ? { ...w, active: !w.active } : w)); }
    catch (e: any) { setToast({ msg: e.message, type: 'err' }); }
  }

  async function handleDelete(id: string) {
    try { await persist(webhooks.filter(w => w.id !== id)); setToast({ msg: 'Webhook removed.', type: 'ok' }); }
    catch (e: any) { setToast({ msg: e.message, type: 'err' }); }
  }

  async function handleTest(wh: Webhook) {
    setTesting(wh.id);
    try {
      const resp = await fetch(wh.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GaDongHR-Event': 'test', 'X-GaDongHR-Signature': `sha256=${wh.secret.slice(0, 16)}` },
        body: JSON.stringify({ event: 'test', timestamp: new Date().toISOString(), data: { message: 'GaDongHR test delivery' } }),
        signal: AbortSignal.timeout(8000),
      });
      setToast({ msg: `Delivered — HTTP ${resp.status} ${resp.statusText}`, type: resp.ok ? 'ok' : 'err' });
    } catch (e: any) { setToast({ msg: `Delivery failed: ${e.message}`, type: 'err' }); }
    finally { setTesting(null); }
  }

  const groups = WEBHOOK_EVENTS.reduce((acc, e) => { (acc[e.group] = acc[e.group] || []).push(e); return acc; }, {} as Record<string, typeof WEBHOOK_EVENTS>);
  const missingUrl = !newUrl.trim();
  const missingEvents = newEvents.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[15.5px] font-bold text-ink">Webhook endpoints</h3>
          <p className="text-[13px] text-muted">Receive HR events as they happen, by HTTP POST. Every delivery is HMAC-SHA256 signed.</p>
        </div>
        <Button icon="plus" onClick={() => setShowModal(true)}>Add endpoint</Button>
      </div>

      <Notice>
        <span className="font-semibold">Verifying signatures.</span> Each delivery carries{' '}
        <code className="rounded bg-pill px-1 font-mono">X-GaDongHR-Signature</code>. Check it with{' '}
        <code className="rounded bg-pill px-1 font-mono">HMAC-SHA256(secret, rawBody)</code>.
      </Notice>

      {loading ? (
        <Card><p className="py-8 text-center text-sm text-muted">Loading endpoints…</p></Card>
      ) : webhooks.length === 0 ? (
        <Card padding="p-0">
          <EmptyState icon="upload" title="No webhook endpoints" description="Add an endpoint to receive HR events as they happen." />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {webhooks.map(wh => (
            <Card key={wh.id} padding="p-4" className={!wh.active ? 'opacity-70' : ''}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <code className="min-w-0 truncate font-mono text-sm font-semibold text-ink">{wh.url}</code>
                    <Badge tone={wh.active ? 'ok' : 'neutral'}>{wh.active ? 'Active' : 'Paused'}</Badge>
                  </div>
                  <p className="text-xs text-muted tabular-nums">Added {new Date(wh.createdAt).toLocaleDateString()} · {wh.events.length} event{wh.events.length !== 1 ? 's' : ''}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {wh.events.map(e => (
                      <Badge key={e} tone="accent" className="font-mono">{e}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => handleTest(wh)} disabled={testing === wh.id || !wh.active}>
                    {testing === wh.id ? 'Sending…' : 'Test'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleToggle(wh.id)}>
                    {wh.active ? 'Pause' : 'Resume'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => handleDelete(wh.id)}>Delete</Button>
                </div>
              </div>
              {!wh.active && <p className="mt-2 text-xs text-muted">Paused endpoints can't be tested. Resume it first.</p>}
              <div className="mt-3 flex items-center gap-3 rounded-control bg-page px-3.5 py-2.5">
                <span className="shrink-0 text-[12.5px] font-semibold text-muted">Signing secret</span>
                <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-muted">{wh.secret.slice(0, 12)}{'•'.repeat(20)}</code>
                <CopyButton value={wh.secret} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onClose={closeModal}
        title="Add a webhook endpoint"
        caption="A signing secret is generated for you. Subscribe only to the events you need."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleAdd} disabled={missingUrl || missingEvents}>Add endpoint</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Endpoint URL" required help={missingUrl ? 'Required. Must be a full https:// address.' : undefined}>
            <Input type="url" value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://your-server.com/webhooks/gadonghr" />
          </Field>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-[12.5px] font-semibold text-muted">
              Events · <span className="tabular-nums">{newEvents.length}</span> selected{missingEvents ? ' (choose at least one)' : ''}
            </legend>
            {Object.entries(groups).map(([group, evs]) => (
              <div key={group} className="flex flex-col gap-1.5">
                <p className="text-[13px] font-semibold text-ink">{group}</p>
                <div className="flex flex-wrap gap-2">
                  {evs.map(ev => {
                    const on = newEvents.includes(ev.id);
                    return (
                      <label key={ev.id}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors focus-within:ring-2 focus-within:ring-accent/40
                          ${on ? 'border-accent bg-tint text-accent' : 'border-rule bg-paper text-ink hover:bg-page'}`}>
                        <input type="checkbox" className="sr-only" checked={on}
                          onChange={e => setNewEvents(e.target.checked ? [...newEvents, ev.id] : newEvents.filter(x => x !== ev.id))} />
                        {ev.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </fieldset>
        </div>
      </Modal>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
const TABS: { id: Tab; label: string }[] = [
  { id: 'email',    label: 'Email' },
  { id: 'keys',     label: 'API keys' },
  { id: 'webhooks', label: 'Webhooks' },
];

export default function ApiPage() {
  const [tab, setTab] = useState<Tab>('email');

  return (
    <>
      <SectionHeader
        title="API and integrations"
        description="Outgoing email, API keys and webhooks. Super Admin only."
      />

      <Tabs items={TABS} active={tab} onChange={setTab} />

      {tab === 'email'    && <EmailTab />}
      {tab === 'keys'     && <ApiKeysTab />}
      {tab === 'webhooks' && <WebhooksTab />}
    </>
  );
}
