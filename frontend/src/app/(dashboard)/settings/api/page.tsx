'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';

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
  { id: 'employee.created',    label: 'Employee Created',    group: 'Employees' },
  { id: 'employee.updated',    label: 'Employee Updated',    group: 'Employees' },
  { id: 'employee.terminated', label: 'Employee Terminated', group: 'Employees' },
  { id: 'payroll.finalized',   label: 'Payroll Finalized',   group: 'Payroll' },
  { id: 'payroll.paid',        label: 'Payroll Paid',        group: 'Payroll' },
  { id: 'leave.approved',      label: 'Leave Approved',      group: 'Leave' },
  { id: 'leave.rejected',      label: 'Leave Rejected',      group: 'Leave' },
  { id: 'claim.approved',      label: 'Claim Approved',      group: 'Claims' },
  { id: 'claim.rejected',      label: 'Claim Rejected',      group: 'Claims' },
  { id: 'user.created',        label: 'User Created',        group: 'Users' },
  { id: 'user.deactivated',    label: 'User Deactivated',    group: 'Users' },
];

const KEY_PERMISSIONS = [
  'read:employees', 'read:payroll', 'read:leave', 'read:claims',
  'write:employees', 'write:payroll', 'write:leave', 'write:claims',
];

function genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function genKey() { return 'vhk_live_' + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
function genSecret() { return 'whsec_' + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }

function Toast({ msg, type, onClose }: { msg: string; type: 'ok' | 'err'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3   text-sm font-bold
      ${type === 'ok' ? 'bg-page border border-accent text-accent' : 'bg-page border border-ink text-ink'}`}>
      <span>{type === 'ok' ? '✓' : '✕'}</span>
      {msg}
      <button onClick={onClose} className="ml-2 opacity-50 hover:opacity-100">✕</button>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest  transition-all
        ${copied ? 'bg-page text-accent' : 'bg-page text-muted hover:bg-rule'}`}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Email Tab ─────────────────────────────────────────────────────────────────
function EmailTab() {
  const [smtp, setSmtp] = useState({ host: '', port: '587', user: '', pass: '', from: '', hasPassword: false });
  const [showPass, setShowPass] = useState(false);
  const [passEditing, setPassEditing] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
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

  if (loading) return <div className="p-12 text-center text-muted text-sm font-bold">Loading…</div>;

  return (
    <div className="flex flex-col gap-6">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* SMTP Server Config */}
      <div className="bg-paper border border-rule p-6 flex flex-col gap-5">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-base font-black text-ink tracking-tighter">SMTP Server Configuration</h3>
            <p className="text-xs text-muted mt-1">All system emails are sent through this mail server. Changes apply immediately without a restart.</p>
          </div>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 bg-accent hover:bg-accent disabled:opacity-50 text-paper text-sm font-black transition-all flex-shrink-0">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 flex flex-col gap-1.5">
            <label className="text-[9px] font-black text-muted uppercase tracking-widest">SMTP Host</label>
            <input value={smtp.host} onChange={e => setSmtp(p => ({ ...p, host: e.target.value }))}
              placeholder="smtp.titan.email"
              className="border border-rule px-4 py-2.5 text-sm font-medium text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-black text-muted uppercase tracking-widest">Port</label>
            <select value={smtp.port} onChange={e => setSmtp(p => ({ ...p, port: e.target.value }))}
              className="border border-rule px-4 py-2.5 text-sm font-medium text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent">
              <option value="587">587 (STARTTLS — recommended)</option>
              <option value="465">465 (SSL)</option>
              <option value="25">25 (Plain — not recommended)</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-black text-muted uppercase tracking-widest">From Address</label>
            <input value={smtp.from} onChange={e => setSmtp(p => ({ ...p, from: e.target.value }))}
              placeholder="no-reply@gadonghr.com"
              className="border border-rule px-4 py-2.5 text-sm font-medium text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-black text-muted uppercase tracking-widest">Username</label>
            <input value={smtp.user} onChange={e => setSmtp(p => ({ ...p, user: e.target.value }))}
              placeholder="enquires@gadonghr.com"
              className="border border-rule px-4 py-2.5 text-sm font-medium text-ink focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-black text-muted uppercase tracking-widest">Password</label>
            <div className="flex gap-2">
              {passEditing ? (
                <input
                  type={showPass ? 'text' : 'password'}
                  value={smtp.pass}
                  onChange={e => setSmtp(p => ({ ...p, pass: e.target.value }))}
                  placeholder="Enter new password"
                  className="flex-1 border border-accent px-4 py-2.5 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                  autoFocus
                />
              ) : (
                <div className="flex-1 border border-rule px-4 py-2.5 text-sm text-muted bg-page flex items-center">
                  {smtp.hasPassword ? '••••••••••••' : <span className="text-muted">Not set</span>}
                </div>
              )}
              <button onClick={() => { setPassEditing(e => !e); setShowPass(false); }}
                className="px-3 py-2.5 border border-rule text-[10px] font-black text-muted hover:bg-page uppercase tracking-widest transition-all">
                {passEditing ? 'Cancel' : 'Change'}
              </button>
              {passEditing && (
                <button onClick={() => setShowPass(s => !s)}
                  className="px-3 py-2.5 border border-rule text-[10px] font-black text-muted hover:bg-page uppercase tracking-widest transition-all">
                  {showPass ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-page border border-rule px-4 py-3 text-[10px] font-bold text-muted">
          <span className="w-1.5 h-1.5 bg-highlight" />
          Changes apply immediately to the running server. To persist across container restarts, update the <code className="font-mono bg-paper border border-rule px-1.5 py-0.5 text-ink">.env</code> file as well.
        </div>
      </div>

      {/* Send Test Email */}
      <div className="bg-paper border border-rule p-6 flex flex-col gap-4">
        <div>
          <h3 className="text-base font-black text-ink tracking-tighter">Send Test Email</h3>
          <p className="text-xs text-muted mt-1">Verify the current SMTP configuration by sending a live test message. The email will arrive from <span className="font-bold text-ink">{smtp.from || 'the configured From address'}</span>.</p>
        </div>
        <div className="flex gap-3">
          <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)}
            placeholder="your@email.com"
            className="flex-1 px-4 py-2.5 border border-rule text-sm font-medium text-ink placeholder:text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent"
          />
          <button onClick={handleTest} disabled={testing || !testEmail}
            className="px-6 py-2.5 bg-shadow hover:bg-shadow disabled:opacity-40 text-paper text-sm font-black transition-all flex items-center gap-2">
            {testing && <span className="w-3.5 h-3.5 border-2 border-paper/30 border-t-paper animate-spin rounded-full" />}
            {testing ? 'Sending…' : 'Send Test Email'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── API Keys Tab ──────────────────────────────────────────────────────────────
function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPerms, setNewPerms] = useState<string[]>(['read:employees', 'read:payroll']);
  const [newExpiry, setNewExpiry] = useState('');
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

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
    <div className="flex flex-col gap-6">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {justCreated && (
        <div className="bg-page border border-highlight p-4 flex flex-col gap-2">
          <p className="text-xs font-black uppercase tracking-widest text-ink">Copy Your API Key — Shown Once</p>
          <div className="flex items-center gap-3 bg-paper border border-highlight px-4 py-3">
            <code className="flex-1 text-xs font-mono text-ink break-all">{justCreated}</code>
            <CopyButton value={justCreated} />
          </div>
          <button onClick={() => setJustCreated(null)} className="self-end text-xs text-ink font-bold hover:underline">I&apos;ve copied it — dismiss</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-black text-ink tracking-tighter">API Keys</h3>
          <p className="text-xs text-muted mt-0.5">Long-lived tokens for server-to-server integrations. Keys are prefixed <code className="bg-page px-1 font-mono text-[11px]">vhk_live_</code>.</p>
        </div>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-accent hover:bg-accent text-paper text-xs font-black transition-all">
          + Generate Key
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted text-sm">Loading…</div>
      ) : keys.length === 0 ? (
        <div className="bg-page border border-rule p-12 text-center">
          <p className="text-3xl mb-3">🔑</p>
          <p className="text-sm font-black text-ink">No API keys yet</p>
          <p className="text-xs text-muted mt-1">Generate a key to enable external integrations.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {keys.map(k => (
            <div key={k.id} className={`bg-paper border border-rule  p-4 flex items-start gap-4 ${!k.active ? 'opacity-60' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-black text-ink">{k.name}</span>
                  <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest  ${k.active ? 'bg-page text-accent' : 'bg-page text-ink'}`}>
                    {k.active ? 'Active' : 'Revoked'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <code className="text-xs font-mono text-muted">{revealId === k.id ? k.key : masked(k.key)}</code>
                  <button onClick={() => setRevealId(revealId === k.id ? null : k.id)} className="text-[10px] font-black uppercase tracking-widest text-accent hover:text-accent">
                    {revealId === k.id ? 'Hide' : 'Reveal'}
                  </button>
                  {revealId === k.id && <CopyButton value={k.key} />}
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {k.permissions.map(p => (
                    <span key={p} className="px-2 py-0.5 bg-page text-ink text-[10px] font-black font-mono">{p}</span>
                  ))}
                </div>
                <p className="text-[10px] text-muted">
                  Created {new Date(k.createdAt).toLocaleDateString()}
                  {k.expiresAt ? ` · Expires ${new Date(k.expiresAt).toLocaleDateString()}` : ' · Never expires'}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {k.active && (
                  <button onClick={() => handleRevoke(k.id)} className="px-3 py-1.5 bg-page hover:bg-page text-ink text-xs font-black ">Revoke</button>
                )}
                <button onClick={() => handleDelete(k.id)} className="px-3 py-1.5 bg-page hover:bg-page text-ink text-xs font-black ">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-shadow/40 backdrop- z-50 flex items-center justify-center p-4">
          <div className="bg-paper w-full max-w-lg p-8 flex flex-col gap-6">
            <div>
              <h3 className="text-xl font-black text-ink tracking-tighter">New API Key</h3>
              <p className="text-xs text-muted mt-1">The full key is only shown once at creation. Store it somewhere safe immediately.</p>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-muted mb-1.5 block">Key Name</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. ERP Integration, CI Pipeline"
                  className="w-full px-4 py-2.5 border border-rule text-sm font-medium focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-muted mb-2 block">Permissions</label>
                <div className="grid grid-cols-2 gap-2">
                  {KEY_PERMISSIONS.map(p => (
                    <label key={p} className="flex items-center gap-2 text-xs font-medium text-ink cursor-pointer">
                      <input type="checkbox" checked={newPerms.includes(p)}
                        onChange={e => setNewPerms(e.target.checked ? [...newPerms, p] : newPerms.filter(x => x !== p))}
                        className=" text-accent" />
                      <code className="font-mono text-[11px]">{p}</code>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-muted mb-1.5 block">Expiry Date (optional)</label>
                <input type="date" value={newExpiry} onChange={e => setNewExpiry(e.target.value)}
                  className="w-full px-4 py-2.5 border border-rule text-sm font-medium focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-5 py-2.5 bg-page hover:bg-rule text-ink text-sm font-black ">Cancel</button>
              <button onClick={handleCreate} disabled={!newName.trim()}
                className="px-5 py-2.5 bg-accent hover:bg-accent disabled:opacity-40 text-paper text-sm font-black ">
                Generate Key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Webhooks Tab ──────────────────────────────────────────────────────────────
function WebhooksTab() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

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

  return (
    <div className="flex flex-col gap-6">
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-black text-ink tracking-tighter">Webhook Endpoints</h3>
          <p className="text-xs text-muted mt-0.5">Receive real-time HR events via HTTP POST. All deliveries are HMAC-SHA256 signed.</p>
        </div>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-accent hover:bg-accent text-paper text-xs font-black transition-all">
          + Add Endpoint
        </button>
      </div>

      <div className="bg-page border border-accent p-4 flex items-start gap-3">
        <span className="text-lg shrink-0">📬</span>
        <div>
          <p className="text-xs font-black text-accent">Signature Verification</p>
          <p className="text-xs text-accent mt-0.5">Each delivery includes <code className="bg-page px-1 font-mono">X-GaDongHR-Signature</code>. Verify with <code className="bg-page px-1 font-mono">HMAC-SHA256(secret, rawBody)</code>.</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted text-sm">Loading…</div>
      ) : webhooks.length === 0 ? (
        <div className="bg-page border border-rule p-12 text-center">
          <p className="text-3xl mb-3">📡</p>
          <p className="text-sm font-black text-ink">No webhook endpoints</p>
          <p className="text-xs text-muted mt-1">Add an endpoint to receive real-time HR events.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {webhooks.map(wh => (
            <div key={wh.id} className={`bg-paper border border-rule  p-5 flex flex-col gap-3 ${!wh.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm font-mono font-bold text-ink truncate">{wh.url}</code>
                    <span className={`shrink-0 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest  ${wh.active ? 'bg-page text-accent' : 'bg-page text-muted'}`}>
                      {wh.active ? 'Active' : 'Paused'}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted mb-2">Added {new Date(wh.createdAt).toLocaleDateString()} · {wh.events.length} event{wh.events.length !== 1 ? 's' : ''}</p>
                  <div className="flex flex-wrap gap-1">
                    {wh.events.map(e => (
                      <span key={e} className="px-2 py-0.5 bg-page text-accent text-[10px] font-black ">{e}</span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleTest(wh)} disabled={testing === wh.id || !wh.active}
                    className="px-3 py-1.5 bg-page hover:bg-page disabled:opacity-40 text-accent text-xs font-black ">
                    {testing === wh.id ? '…' : 'Test'}
                  </button>
                  <button onClick={() => handleToggle(wh.id)} className="px-3 py-1.5 bg-page hover:bg-page text-ink text-xs font-black ">
                    {wh.active ? 'Pause' : 'Resume'}
                  </button>
                  <button onClick={() => handleDelete(wh.id)} className="px-3 py-1.5 bg-page hover:bg-page text-ink text-xs font-black ">Delete</button>
                </div>
              </div>
              <div className="bg-page p-3 flex items-center gap-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted shrink-0">Signing Secret</p>
                <code className="flex-1 text-xs font-mono text-muted truncate">{wh.secret.slice(0, 12)}{'•'.repeat(20)}</code>
                <CopyButton value={wh.secret} />
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-shadow/40 backdrop- z-50 flex items-center justify-center p-4">
          <div className="bg-paper w-full max-w-lg p-8 flex flex-col gap-6 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-xl font-black text-ink tracking-tighter">Add Webhook Endpoint</h3>
              <p className="text-xs text-muted mt-1">A signing secret will be auto-generated. Subscribe to the events you need.</p>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-muted mb-1.5 block">Endpoint URL</label>
                <input type="url" value={newUrl} onChange={e => setNewUrl(e.target.value)}
                  placeholder="https://your-server.com/webhooks/gadonghr"
                  className="w-full px-4 py-2.5 border border-rule text-sm font-medium focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent" />
              </div>
              <div>
                <label className="text-xs font-black uppercase tracking-widest text-muted mb-2 block">
                  Events ({newEvents.length} selected)
                </label>
                <div className="flex flex-col gap-3">
                  {Object.entries(groups).map(([group, evs]) => (
                    <div key={group}>
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-1.5">{group}</p>
                      <div className="flex flex-wrap gap-2">
                        {evs.map(ev => (
                          <label key={ev.id}
                            className={`flex items-center gap-1.5 px-3 py-1.5  border cursor-pointer transition-all text-xs font-bold
                              ${newEvents.includes(ev.id) ? 'bg-page border-accent text-accent' : 'bg-page border-rule text-ink hover:border-rule'}`}>
                            <input type="checkbox" className="sr-only" checked={newEvents.includes(ev.id)}
                              onChange={e => setNewEvents(e.target.checked ? [...newEvents, ev.id] : newEvents.filter(x => x !== ev.id))} />
                            {ev.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-5 py-2.5 bg-page hover:bg-rule text-ink text-sm font-black ">Cancel</button>
              <button onClick={handleAdd} disabled={!newUrl.trim() || newEvents.length === 0}
                className="px-5 py-2.5 bg-accent hover:bg-accent disabled:opacity-40 text-paper text-sm font-black ">
                Add Endpoint
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'email',    label: 'Email Configuration', icon: '✉' },
  { id: 'keys',     label: 'API Keys',             icon: '🔑' },
  { id: 'webhooks', label: 'Webhooks',             icon: '📡' },
];

export default function ApiPage() {
  const [tab, setTab] = useState<Tab>('email');

  return (
    <div className="flex flex-col gap-6 p-8 bg-paper border border-rule ">
      <div className="flex items-center gap-3">
        <div className="w-2 h-8 bg-accent " />
        <div>
          <h1 className="text-2xl font-black text-ink tracking-tighter">API & Webhooks</h1>
          <p className="eyebrow-tight mt-1">SuperAdmin Only · Integration & Connectivity</p>
        </div>
      </div>

      <div className="flex gap-2 bg-page p-1.5 w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2  text-xs font-black transition-all
              ${tab === t.id ? 'bg-paper text-ink ' : 'text-muted hover:text-ink'}`}>
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'email'    && <EmailTab />}
      {tab === 'keys'     && <ApiKeysTab />}
      {tab === 'webhooks' && <WebhooksTab />}
    </div>
  );
}
