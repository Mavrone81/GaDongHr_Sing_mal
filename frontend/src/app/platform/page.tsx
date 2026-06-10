'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

function apiUrl() {
  return process.env.NEXT_PUBLIC_API_URL || `http://${window.location.hostname}:4000/api`;
}
function tok() { return typeof window !== 'undefined' ? localStorage.getItem('vorkhive_platform_token') : null; }

interface Tenant { id: string; name: string; slug: string; country: string; status: string; trialEndsAt: string; plan?: string; users: number; }
interface Mod { moduleCode: string; enabled: boolean; }

export default function PlatformConsole() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ modules: Mod[] } | null>(null);
  const [allModules, setAllModules] = useState<{ code: string; name: string; isCore: boolean }[]>([]);
  const [audit, setAudit] = useState<{ action: string; tenantId: string | null; createdAt: string }[]>([]);
  const [err, setErr] = useState('');

  const api = useCallback(async (path: string, opts: RequestInit = {}) => {
    const res = await fetch(`${apiUrl()}/platform${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}`, ...(opts.headers || {}) },
    });
    if (res.status === 401 || res.status === 403) { router.push('/platform/login'); throw new Error('auth'); }
    return res.json();
  }, [router]);

  const loadTenants = useCallback(async () => {
    try { const d = await api('/tenants'); setTenants(d.tenants || []); } catch { /* */ }
  }, [api]);

  useEffect(() => {
    if (!tok()) { router.push('/platform/login'); return; }
    loadTenants();
    api('/modules').then((d) => setAllModules(d.modules || [])).catch(() => {});
    api('/audit').then((d) => setAudit(d.logs || [])).catch(() => {});
  }, [api, loadTenants, router]);

  async function openDetail(id: string) {
    setSel(id);
    try { const d = await api(`/tenants/${id}`); setDetail({ modules: d.modules || [] }); } catch { /* */ }
  }
  async function action(id: string, path: string, body?: object) {
    setErr('');
    try { await api(`/tenants/${id}${path}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }); await loadTenants(); if (sel === id) await openDetail(id); api('/audit').then((d) => setAudit(d.logs || [])); }
    catch (e) { setErr(String(e)); }
  }
  function isDisabled(code: string) { return detail?.modules.find((m) => m.moduleCode === code && !m.enabled); }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <div>
          <span className="font-black tracking-tight">VORKHIVE</span>
          <span className="ml-2 text-xs font-bold uppercase tracking-[0.2em] text-indigo-400">Platform Operator</span>
        </div>
        <button onClick={() => { localStorage.removeItem('vorkhive_platform_token'); router.push('/platform/login'); }} className="text-sm text-slate-400 hover:text-white">Sign out</button>
      </header>

      {err && <div className="m-4 rounded bg-rose-950 border border-rose-800 px-4 py-2 text-sm text-rose-300">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
        {/* Tenants */}
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-400">Companies ({tenants.length})</h2>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50 text-xs uppercase text-slate-400">
                <tr><th className="px-4 py-2 text-left">Company</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Users</th><th className="px-3 py-2">Trial ends</th><th className="px-3 py-2">Actions</th></tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className={`border-t border-slate-800 ${sel === t.id ? 'bg-slate-800/40' : ''}`}>
                    <td className="px-4 py-2.5"><button onClick={() => openDetail(t.id)} className="font-semibold hover:text-indigo-300">{t.name}</button><div className="text-xs text-slate-500">{t.slug} · {t.country}</div></td>
                    <td className="px-3 py-2.5 text-center"><Badge status={t.status} /></td>
                    <td className="px-3 py-2.5 text-center">{t.users}</td>
                    <td className="px-3 py-2.5 text-center text-xs text-slate-400">{t.trialEndsAt ? new Date(t.trialEndsAt).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2.5 text-center text-xs">
                      <div className="flex justify-center gap-1">
                        {t.status === 'SUSPENDED'
                          ? <Btn onClick={() => action(t.id, '/resume')}>Resume</Btn>
                          : <Btn onClick={() => action(t.id, '/suspend')} danger>Suspend</Btn>}
                        <Btn onClick={() => action(t.id, '/extend-trial', { days: 14 })}>+14d</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Detail: module toggles */}
          {sel && detail && (
            <div className="mt-6 rounded-xl border border-slate-800 p-4">
              <h3 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-400">Modules — {tenants.find((t) => t.id === sel)?.name}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {allModules.map((m) => {
                  const off = isDisabled(m.code);
                  return (
                    <button key={m.code} disabled={m.isCore}
                      onClick={() => action(sel!, `/modules/${m.code}/toggle`, { enabled: !!off })}
                      className={`rounded-lg border px-3 py-2 text-left text-xs ${m.isCore ? 'border-slate-700 bg-slate-800/40 opacity-60 cursor-not-allowed' : off ? 'border-rose-800 bg-rose-950/40 text-rose-300' : 'border-emerald-800 bg-emerald-950/30 text-emerald-300'}`}>
                      <div className="font-semibold">{m.name}</div>
                      <div>{m.isCore ? 'core · always on' : off ? 'disabled' : 'enabled'}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Audit */}
        <div>
          <h2 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-400">Recent platform audit</h2>
          <div className="space-y-2">
            {audit.slice(0, 25).map((a, i) => (
              <div key={i} className="rounded-lg border border-slate-800 px-3 py-2 text-xs">
                <span className="font-mono font-semibold text-indigo-300">{a.action}</span>
                <div className="text-slate-500">{new Date(a.createdAt).toLocaleString()}{a.tenantId ? ` · ${a.tenantId.slice(0, 8)}` : ''}</div>
              </div>
            ))}
            {!audit.length && <div className="text-xs text-slate-600">No audit entries yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const c: Record<string, string> = { ACTIVE: 'bg-emerald-900 text-emerald-300', TRIALING: 'bg-indigo-900 text-indigo-300', SUSPENDED: 'bg-rose-900 text-rose-300', PAST_DUE: 'bg-amber-900 text-amber-300', CANCELED: 'bg-slate-700 text-slate-300' };
  return <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${c[status] || 'bg-slate-700'}`}>{status}</span>;
}
function Btn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={`rounded px-2 py-1 font-semibold ${danger ? 'bg-rose-900/60 text-rose-300 hover:bg-rose-900' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}>{children}</button>;
}
