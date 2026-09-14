'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import {
  PageHeader, Stat, DataTable, Button, Badge, EmptyState, Field, Input, Select, Textarea, Modal, Tabs, Icon, useToast,
  type Column, type BadgeTone,
} from '@/components/ui';

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

const STATUS_TONE: Record<string, BadgeTone> = {
  AVAILABLE: 'ok',
  ASSIGNED: 'accent',
  UNDER_REPAIR: 'warn',
  RETIRED: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Available', ASSIGNED: 'Assigned', UNDER_REPAIR: 'Under repair', RETIRED: 'Retired',
};

const CATEGORIES = ['All', 'Laptop', 'Mobile', 'Monitor', 'Accessories', 'Telecom', 'Furniture', 'Other'];

const money = (n: number) => `S$${(n ?? 0).toLocaleString()}`;

// ── Register asset ────────────────────────────────────────────────────────────
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
    <Modal
      open
      title="Register asset"
      caption="Adds it to the asset register as available."
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>{saving ? 'Registering…' : 'Register asset'}</Button>
      </>}
    >
      {err && <p role="alert" className="mb-4 text-sm text-danger">{err}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Asset name" required className="sm:col-span-2" error={err && !form.name ? 'Enter a name' : undefined}>
          <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. MacBook Pro 14" invalid={!!err && !form.name} />
        </Field>
        <Field label="Category" required>
          <Select value={form.category} onChange={e => set('category', e.target.value)}>
            {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Serial number" help="Optional">
          <Input value={form.serialNumber} onChange={e => set('serialNumber', e.target.value)} />
        </Field>
        <Field label="Purchase date">
          <Input type="date" value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)} />
        </Field>
        <Field label="Purchase value (SGD)">
          <Input type="number" min={0} value={form.purchaseValue} onChange={e => set('purchaseValue', e.target.value)} placeholder="0" />
        </Field>
        <Field label="Current value (SGD)" help="Leave blank to use the purchase value">
          <Input type="number" min={0} value={form.currentValue} onChange={e => set('currentValue', e.target.value)} />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Office level 3" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

// ── Manage: assign / return / status / history ────────────────────────────────
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

  const tabs = ([
    { id: 'assign' as const, label: 'Assign', show: asset.status === 'AVAILABLE' },
    { id: 'return' as const, label: 'Return', show: asset.status === 'ASSIGNED' },
    { id: 'status' as const, label: 'Change status', show: true },
    { id: 'history' as const, label: 'History', show: true },
  ]).filter(t => t.show !== false);

  const footer =
    tab === 'assign' ? <Button onClick={handleAssign} disabled={saving}>{saving ? 'Assigning…' : 'Confirm assignment'}</Button>
    : tab === 'return' ? <Button onClick={handleReturn} disabled={saving}>{saving ? 'Processing…' : 'Confirm return'}</Button>
    : tab === 'status' ? <Button onClick={handleStatusChange} disabled={saving}>{saving ? 'Updating…' : 'Update status'}</Button>
    : undefined;

  return (
    <Modal
      open
      title={asset.name}
      caption={<span className="inline-flex items-center gap-2"><span className="tabular-nums">{asset.assetCode}</span><Badge tone={STATUS_TONE[asset.status]}>{STATUS_LABEL[asset.status]}</Badge></span>}
      onClose={onClose}
      footer={footer}
    >
      <div className="flex flex-col gap-4 min-h-[200px]">
      <Tabs items={tabs.map(({ id, label }) => ({ id, label }))} active={tab} onChange={(id) => { setTab(id); setErr(''); }} />
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}

      {tab === 'assign' && (
        <>
          <Field label="Assign to employee" required error={err === 'Select an employee' ? err : undefined}>
            <Select value={employeeId} onChange={e => setEmployeeId(e.target.value)} invalid={err === 'Select an employee'}>
              <option value="">Select employee</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.fullName} · {e.employeeCode}</option>)}
            </Select>
          </Field>
          <Field label="Handover notes" help="Optional">
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </Field>
        </>
      )}

      {tab === 'return' && (
        <>
          <p className="text-sm text-muted">Marks this asset as returned and sets it back to available.</p>
          <Field label="Return notes" help="Condition, damage, missing accessories">
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </Field>
        </>
      )}

      {tab === 'status' && (
        <>
          <Field label="New status">
            <Select value={newStatus} onChange={e => setNewStatus(e.target.value)}>
              {['AVAILABLE', 'UNDER_REPAIR', 'RETIRED'].map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Reason">
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </Field>
        </>
      )}

      {tab === 'history' && (
        history.length === 0 ? (
          <EmptyState icon="clock" title="No assignment history" description="Assignments and returns will be listed here." className="py-8" />
        ) : (
          <div className="flex flex-col divide-y divide-rule border border-rule rounded-card">
            {history.map(h => (
              <div key={h.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold text-ink truncate">{h.employeeId}</span>
                  <span className="text-xs text-muted tabular-nums">
                    {new Date(h.assignedAt).toLocaleDateString('en-SG')} to {h.returnedAt ? new Date(h.returnedAt).toLocaleDateString('en-SG') : 'now'}
                  </span>
                </div>
                <Badge tone={h.isActive ? 'accent' : 'neutral'}>{h.isActive ? 'Active' : 'Returned'}</Badge>
              </div>
            ))}
          </div>
        )
      )}
      </div>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const { toast } = useToast();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [managing, setManaging] = useState<Asset | null>(null);
  const [assetSort, setAssetSort] = useState<{ col: 'name' | 'category' | 'location' | 'value' | 'status'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });

  const showToast = useCallback((msg: string, type: 'ok' | 'err') => toast(msg, type === 'err' ? 'danger' : 'ok'), [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/assets?limit=200');
      setAssets(data.assets ?? []);
    } catch (e: any) { showToast(e.message, 'err'); }
    finally { setLoading(false); }
  }, [showToast]);

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
  const sortHead = (col: typeof assetSort.col, label: string, alignEnd = false) => (
    <button type="button" onClick={() => toggleAssetSort(col)}
      aria-sort={assetSort.col === col ? (assetSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`inline-flex items-center gap-1 hover:text-ink ${alignEnd ? 'justify-end w-full' : ''}`}>
      {label}
      {assetSort.col === col && <Icon name="chevronDown" size={13} strokeWidth={2.25} className={assetSort.dir === 'asc' ? 'rotate-180' : ''} />}
    </button>
  );

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

  const assignedCount = assets.filter(a => a.status === 'ASSIGNED').length;
  const availableCount = assets.filter(a => a.status === 'AVAILABLE').length;

  const columns: Column<Asset>[] = [
    {
      key: 'name', label: sortHead('name', 'Asset'), width: 'minmax(0, 1.6fr)',
      render: a => (
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-ink truncate">{a.name}</span>
          <span className="text-xs text-muted truncate tabular-nums">{a.assetCode}{a.serialNumber ? ` · ${a.serialNumber}` : ''}</span>
        </div>
      ),
    },
    { key: 'category', label: sortHead('category', 'Category'), render: a => a.category },
    { key: 'location', label: sortHead('location', 'Location'), render: a => a.location || <span className="text-faint">Not set</span> },
    { key: 'value', label: sortHead('value', 'Value', true), width: '120px', align: 'right', numeric: true, render: a => money(a.currentValue) },
    { key: 'status', label: sortHead('status', 'Status'), width: '130px', render: a => <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge> },
    {
      key: 'act', label: '', width: '96px', align: 'right',
      render: a => <Button size="sm" variant="secondary" onClick={() => setManaging(a)}>{a.status === 'AVAILABLE' ? 'Assign' : 'Manage'}</Button>,
    },
  ];

  const empty = (
    <EmptyState
      icon="briefcase"
      title={filter === 'All' ? 'No assets registered' : `No ${filter.toLowerCase()} assets`}
      description={filter === 'All' ? 'Register laptops, phones and other equipment to track who holds them.' : 'Try another category, or register one.'}
      action={<Button icon="plus" onClick={() => setRegisterOpen(true)}>Register asset</Button>}
      className="py-6"
    />
  );

  return (
    <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-24 lg:pb-10">
      <PageHeader
        title="Assets"
        subtitle={loading ? 'Loading the register…' : `${assets.length} registered · ${assignedCount} assigned · ${availableCount} available`}
        actions={<>
          <Button variant="secondary" icon="download" onClick={handleExport} disabled={filtered.length === 0} className="hidden sm:inline-flex">Export</Button>
          <Button icon="plus" onClick={() => setRegisterOpen(true)}>Register asset</Button>
        </>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Total assets" value={loading ? '—' : assets.length} />
        <Stat label="Assigned" value={loading ? '—' : assignedCount} />
        <Stat label="Available" value={loading ? '—' : availableCount} />
        <Stat label="Current value" value={loading ? '—' : money(totalValue)} note="SGD, all categories" />
      </div>

      {/* Category filter — chips on desktop, a select on the phone */}
      <div className="flex items-center justify-between gap-3">
        <div className="hidden sm:flex flex-wrap gap-2" role="group" aria-label="Category">
          {CATEGORIES.map(c => {
            const on = filter === c;
            return (
              <button key={c} type="button" onClick={() => setFilter(c)} aria-pressed={on}
                className={`h-[34px] px-3 rounded-control border text-[13px] font-semibold transition-colors ${on ? 'border-accent bg-tint text-accent' : 'border-rule bg-paper text-ink hover:bg-pill'}`}>
                {c}
              </button>
            );
          })}
        </div>
        <Field label="Category" className="sm:hidden flex-1">
          <Select value={filter} onChange={e => setFilter(e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <span className="hidden sm:block text-[13px] text-muted whitespace-nowrap tabular-nums">{loading ? '' : `Showing ${filtered.length} of ${assets.length}`}</span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-[52px] bg-pill rounded-card animate-pulse" />)}
        </div>
      ) : (
        <DataTable
          aria-label="Asset register"
          columns={columns}
          rows={filtered}
          rowKey={a => a.id}
          empty={empty}
          mobileCard={a => (
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-1 min-w-0">
                <span className="font-semibold text-ink truncate">{a.name}</span>
                <span className="text-xs text-muted truncate tabular-nums">{a.assetCode} · {a.category}{a.location ? ` · ${a.location}` : ''}</span>
                <span className="text-sm text-ink tabular-nums">{money(a.currentValue)}</span>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                <Button size="sm" variant="secondary" onClick={() => setManaging(a)}>{a.status === 'AVAILABLE' ? 'Assign' : 'Manage'}</Button>
              </div>
            </div>
          )}
          footer={filtered.length > 0 ? <><span className="tabular-nums">{filtered.length} item{filtered.length === 1 ? '' : 's'}</span><span className="tabular-nums">{money(filtered.reduce((s, a) => s + (a.currentValue ?? 0), 0))} shown</span></> : undefined}
        />
      )}

      {registerOpen && <RegisterModal onClose={() => setRegisterOpen(false)} onSaved={handleSaved} />}
      {managing && <ManageModal asset={managing} onClose={() => setManaging(null)} onUpdated={handleUpdated} />}
    </div>
  );
}
