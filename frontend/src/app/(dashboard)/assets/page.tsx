'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';

interface Asset {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  serialNumber?: string;
  purchaseDate?: string;
  purchaseValue: number;
  currentValue: number;
  status: 'AVAILABLE' | 'ASSIGNED' | 'UNDER_REPAIR' | 'RETIRED';
  location?: string;
  notes?: string;
  assignments?: { employeeId: string; assignedAt: string; isActive: boolean }[];
}

const STATUS_STYLE: Record<string, string> = {
  AVAILABLE:    'bg-emerald-50 text-emerald-700 border-emerald-100',
  ASSIGNED:     'bg-indigo-50 text-indigo-700 border-indigo-100',
  UNDER_REPAIR: 'bg-amber-50 text-amber-700 border-amber-100',
  RETIRED:      'bg-slate-100 text-slate-400 border-slate-200',
};
const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Available', ASSIGNED: 'Assigned', UNDER_REPAIR: 'Under Repair', RETIRED: 'Retired',
};

const CATEGORIES = ['All', 'Laptop', 'Mobile', 'Monitor', 'Accessories', 'Telecom', 'Furniture', 'Other'];

function Toast({ msg, type, onClose }: { msg: string; type: 'ok' | 'err'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-6 duration-300">
      <div className={`px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-3 ${type === 'ok' ? 'bg-slate-900 border border-slate-700' : 'bg-red-900 border border-red-700'}`}>
        <div className={`w-2 h-2 rounded-full ${type === 'ok' ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className="text-[11px] font-black text-white uppercase tracking-widest">{msg}</span>
        <button onClick={onClose} className="ml-4 text-white/50 hover:text-white text-xs">✕</button>
      </div>
    </div>
  );
}

// ── Register Asset Modal ──────────────────────────────────────────────────────
function RegisterModal({ onClose, onSaved }: { onClose: () => void; onSaved: (a: Asset) => void }) {
  const [form, setForm] = useState({ name: '', category: 'Laptop', serialNumber: '', purchaseDate: '', purchaseValue: '', currentValue: '', location: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.name || !form.category) return setErr('Name and category are required');
    setSaving(true); setErr('');
    try {
      const asset = await apiFetch('/assets', { method: 'POST', body: JSON.stringify(form) });
      onSaved(asset);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-[2rem] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-black text-slate-900 tracking-tighter">Register New Asset</h2>
            <p className="eyebrow-tight mt-0.5">Add to the asset registry</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all">✕</button>
        </div>
        <div className="p-8 flex flex-col gap-4 overflow-y-auto max-h-[65vh]">
          {err && <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-xl">{err}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Asset Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. MacBook Pro 14"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Category *</label>
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500">
                {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Serial Number</label>
              <input value={form.serialNumber} onChange={e => set('serialNumber', e.target.value)} placeholder="Optional"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Purchase Date</label>
              <input type="date" value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Purchase Value (SGD)</label>
              <input type="number" min={0} value={form.purchaseValue} onChange={e => set('purchaseValue', e.target.value)} placeholder="0"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Current Value (SGD)</label>
              <input type="number" min={0} value={form.currentValue} onChange={e => set('currentValue', e.target.value)} placeholder="Same as purchase"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500" />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Location</label>
              <input value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Office Level 3"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500" />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Notes</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} placeholder="Optional notes"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500 resize-none" />
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-8 py-5 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="flex-1 py-3 text-[10px] font-black text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-100 uppercase tracking-widest">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-3 text-[10px] font-black text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-xl uppercase tracking-widest transition-all">
            {saving ? 'Registering…' : 'Register Asset'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Manage / Assign / Return Modal ────────────────────────────────────────────
function ManageModal({ asset, onClose, onUpdated }: { asset: Asset; onClose: () => void; onUpdated: (a: Asset) => void }) {
  const [tab, setTab] = useState<'assign' | 'return' | 'status' | 'history'>(asset.status === 'ASSIGNED' ? 'return' : 'assign');
  const [employeeId, setEmployeeId] = useState('');
  const [employees, setEmployees] = useState<{ id: string; fullName: string; employeeCode: string }[]>([]);
  const [notes, setNotes] = useState('');
  const [newStatus, setNewStatus] = useState<string>(asset.status);
  const [history, setHistory] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch('/employees?limit=500').then(d => setEmployees(d.employees ?? d ?? [])).catch(() => {});
    if (tab === 'history') {
      apiFetch(`/assets/${asset.id}/history`).then(setHistory).catch(() => {});
    }
  }, [asset.id, tab]);

  const handleAssign = async () => {
    if (!employeeId) return setErr('Select an employee');
    setSaving(true); setErr('');
    try {
      await apiFetch(`/assets/${asset.id}/assign`, { method: 'POST', body: JSON.stringify({ employeeId, notes }) });
      const updated = { ...asset, status: 'ASSIGNED' as const };
      onUpdated(updated);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleReturn = async () => {
    setSaving(true); setErr('');
    try {
      await apiFetch(`/assets/${asset.id}/return`, { method: 'POST', body: JSON.stringify({ notes, status: 'AVAILABLE' }) });
      const updated = { ...asset, status: 'AVAILABLE' as const };
      onUpdated(updated);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const handleStatusChange = async () => {
    setSaving(true); setErr('');
    try {
      const updated = await apiFetch(`/assets/${asset.id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus, notes }) });
      onUpdated(updated);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-[2rem] shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100">
          <div>
            <h2 className="text-base font-black text-slate-900 tracking-tighter">{asset.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="label-form">{asset.assetCode}</span>
              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border uppercase ${STATUS_STYLE[asset.status]}`}>{STATUS_LABEL[asset.status]}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 bg-slate-50/50">
          {([
            { key: 'assign' as const, label: 'Assign', show: asset.status === 'AVAILABLE' },
            { key: 'return' as const, label: 'Return', show: asset.status === 'ASSIGNED' },
            { key: 'status' as const, label: 'Change Status', show: true },
            { key: 'history' as const, label: 'History', show: true },
          ]).filter(t => t.show !== false).map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setErr(''); }}
              className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest border-b-2 transition-all ${tab === t.key ? 'border-teal-500 text-teal-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-8 flex flex-col gap-4 min-h-[200px]">
          {err && <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-xl">{err}</div>}

          {tab === 'assign' && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Assign To Employee *</label>
                <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500">
                  <option value="">— Select employee —</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.fullName} · {e.employeeCode}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional handover notes"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500 resize-none" />
              </div>
              <button onClick={handleAssign} disabled={saving} className="w-full py-3 text-[10px] font-black text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-xl uppercase tracking-widest transition-all">
                {saving ? 'Assigning…' : 'Confirm Assignment'}
              </button>
            </>
          )}

          {tab === 'return' && (
            <>
              <p className="text-xs font-bold text-slate-500">Mark this asset as returned and set it back to Available.</p>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Return Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Condition notes, damages, etc."
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500 resize-none" />
              </div>
              <button onClick={handleReturn} disabled={saving} className="w-full py-3 text-[10px] font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl uppercase tracking-widest transition-all">
                {saving ? 'Processing…' : 'Confirm Return'}
              </button>
            </>
          )}

          {tab === 'status' && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">New Status</label>
                <select value={newStatus} onChange={e => setNewStatus(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500">
                  {['AVAILABLE', 'UNDER_REPAIR', 'RETIRED'].map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Reason for status change"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-teal-500 resize-none" />
              </div>
              <button onClick={handleStatusChange} disabled={saving} className="w-full py-3 text-[10px] font-black text-white bg-slate-800 hover:bg-slate-900 disabled:opacity-50 rounded-xl uppercase tracking-widest transition-all">
                {saving ? 'Updating…' : 'Update Status'}
              </button>
            </>
          )}

          {tab === 'history' && (
            <div className="flex flex-col gap-2">
              {history.length === 0 ? (
                <p className="text-xs font-bold text-slate-400 text-center py-8">No assignment history</p>
              ) : history.map(h => (
                <div key={h.id} className="flex items-center justify-between px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div>
                    <p className="text-xs font-black text-slate-800">{h.employeeId}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">
                      {new Date(h.assignedAt).toLocaleDateString('en-SG')} → {h.returnedAt ? new Date(h.returnedAt).toLocaleDateString('en-SG') : 'Active'}
                    </p>
                  </div>
                  <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border uppercase ${h.isActive ? 'bg-indigo-50 text-indigo-700 border-indigo-100' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                    {h.isActive ? 'Active' : 'Returned'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [managing, setManaging] = useState<Asset | null>(null);
  const [assetSort, setAssetSort] = useState<{ col: 'name' | 'category' | 'location' | 'value' | 'status'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });

  const showToast = (msg: string, type: 'ok' | 'err') => setToast({ msg, type });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/assets?limit=200');
      setAssets(data.assets ?? []);
    } catch (e: any) { showToast(e.message, 'err'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const base = filter === 'All' ? assets : assets.filter(a => a.category === filter);
  const filtered = [...base].sort((a, b) => {
    const d = assetSort.dir === 'asc' ? 1 : -1;
    switch (assetSort.col) {
      case 'name':     return d * a.name.localeCompare(b.name);
      case 'category': return d * a.category.localeCompare(b.category);
      case 'location': return d * (a.location ?? '').localeCompare(b.location ?? '');
      case 'value':    return d * (a.currentValue - b.currentValue);
      case 'status':   return d * a.status.localeCompare(b.status);
      default: return 0;
    }
  });
  const totalValue = assets.reduce((s, a) => s + (a.currentValue ?? 0), 0);
  function toggleAssetSort(col: typeof assetSort.col) {
    setAssetSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function AssetSortIcon({ col }: { col: typeof assetSort.col }) {
    return <span className="text-[8px] ml-1">{assetSort.col === col ? (assetSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

  const handleSaved = (a: Asset) => {
    setAssets(prev => [a, ...prev]);
    setRegisterOpen(false);
    showToast(`${a.name} registered as ${a.assetCode}`, 'ok');
  };

  const handleUpdated = (updated: Asset) => {
    setAssets(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a));
    setManaging(null);
    showToast('Asset updated', 'ok');
  };

  const handleExport = () => {
    const headers = ['Asset Code', 'Name', 'Category', 'Status', 'Serial No', 'Purchase Value', 'Current Value', 'Location'];
    const rows = filtered.map(a => [a.assetCode, a.name, a.category, STATUS_LABEL[a.status], a.serialNumber ?? '', a.purchaseValue, a.currentValue, a.location ?? '']);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `asset-register-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-8 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-teal-500/5 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-teal-500 rounded-full" />
            <span className="text-[10px] font-black text-teal-600 uppercase tracking-[0.4em]">Asset &amp; Logistics Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Asset <span className="text-teal-600">Registry</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest max-w-xl">
            Corporate asset register, employee assignments, logistics requests, and inventory management.
          </p>
        </div>
        <div className="flex flex-wrap gap-4 relative z-10">
          <button onClick={() => setRegisterOpen(true)}
            className="px-8 py-4 bg-teal-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-teal-700 shadow-xl shadow-teal-500/20 transition-all active:scale-95">
            + Register Asset
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Assets',      value: loading ? '—' : String(assets.length),                                          color: 'text-slate-900' },
          { label: 'Assigned',          value: loading ? '—' : String(assets.filter(a => a.status === 'ASSIGNED').length),     color: 'text-indigo-600' },
          { label: 'Available',         value: loading ? '—' : String(assets.filter(a => a.status === 'AVAILABLE').length),    color: 'text-emerald-600' },
          { label: 'Total Value (SGD)', value: loading ? '—' : `$${totalValue.toLocaleString()}`,                              color: 'text-teal-600' },
        ].map(k => (
          <div key={k.label} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5">
            <p className="label-form mb-4">{k.label}</p>
            <h3 className={`text-3xl font-black tracking-tighter ${k.color}`}>{k.value}</h3>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => setFilter(c)}
            className={`px-5 py-2.5 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all ${
              filter === c ? 'bg-slate-950 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-500 hover:border-teal-400 hover:text-teal-600'
            }`}>
            {c}
          </button>
        ))}
      </div>

      {/* Asset Table */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-2 h-8 bg-teal-500 rounded-full" />
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Asset Register</h3>
            <span className="text-[9px] font-black px-3 py-1 bg-slate-100 text-slate-500 rounded-full uppercase">{filtered.length} items</span>
          </div>
          <button onClick={handleExport} className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest rounded-xl hover:bg-slate-50 hover:border-teal-400 hover:text-teal-600 transition-all">
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 flex flex-col gap-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-14 bg-slate-50 rounded-2xl animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No assets found</p>
              <button onClick={() => setRegisterOpen(true)} className="mt-4 px-6 py-2.5 bg-teal-600 text-white text-[10px] font-black rounded-xl uppercase tracking-widest hover:bg-teal-700 transition-all">
                Register First Asset
              </button>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50">
                <tr>
                  {([
                    { col: 'name',     label: 'Asset',       cls: 'px-8 py-6',            align: 'start' },
                    { col: 'category', label: 'Category',    cls: 'px-8 py-6',            align: 'start' },
                    { col: 'location', label: 'Location',    cls: 'px-8 py-6',            align: 'start' },
                    { col: 'value',    label: 'Value (SGD)', cls: 'px-8 py-6 text-right', align: 'end' },
                    { col: 'status',   label: 'Status',      cls: 'px-8 py-6',            align: 'start' },
                  ] as const).map(h => (
                    <th key={h.col} className={h.cls}>
                      <button onClick={() => toggleAssetSort(h.col)} className={`flex items-center hover:text-slate-600 transition-colors ${h.align === 'end' ? 'ml-auto justify-end' : ''}`}>
                        {h.label}<AssetSortIcon col={h.col} />
                      </button>
                    </th>
                  ))}
                  <th className="px-8 py-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(a => (
                  <tr key={a.id} className="group hover:bg-slate-50/50 transition-all">
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-slate-900 uppercase tracking-tight group-hover:text-teal-600 transition-colors">{a.name}</span>
                        <span className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{a.assetCode}{a.serialNumber ? ` · ${a.serialNumber}` : ''}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{a.category}</span>
                    </td>
                    <td className="px-8 py-5">
                      <span className="text-[10px] font-black text-slate-400">{a.location || '—'}</span>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <span className="text-sm font-black text-slate-900 tracking-tight">${(a.currentValue ?? 0).toLocaleString()}</span>
                    </td>
                    <td className="px-8 py-5">
                      <span className={`text-[9px] font-black px-3 py-1.5 rounded-full border uppercase tracking-widest ${STATUS_STYLE[a.status]}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <button onClick={() => setManaging(a)}
                        className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase hover:border-teal-500 hover:text-teal-600 hover:bg-teal-50 transition-all">
                        {a.status === 'AVAILABLE' ? 'Assign' : 'Manage'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {registerOpen && <RegisterModal onClose={() => setRegisterOpen(false)} onSaved={handleSaved} />}
      {managing && <ManageModal asset={managing} onClose={() => setManaging(null)} onUpdated={handleUpdated} />}
      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
