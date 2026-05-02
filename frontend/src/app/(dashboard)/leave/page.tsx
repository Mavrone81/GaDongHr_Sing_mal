'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';

// ─── Auth/API helpers ─────────────────────────────────────────────────────────
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

// ─── Types ────────────────────────────────────────────────────────────────────
interface LeaveType { id: string; code: string; name: string; }
interface LeaveBalance {
  type: string; label: string; total: number; used: number; balance: number; color: string; statColor: string;
}
interface LeaveRequest {
  id: string; type: string; from: string; to: string; days: number; reason: string;
  status: 'Pending' | 'Approved' | 'Rejected'; appliedOn: string;
}

const BALANCE_COLORS: Record<string, { color: string; statColor: string }> = {
  AL:   { color: 'from-indigo-500 to-indigo-600',  statColor: 'text-indigo-600' },
  SL:   { color: 'from-rose-500 to-rose-600',      statColor: 'text-rose-600' },
  CL:   { color: 'from-purple-500 to-purple-600',  statColor: 'text-purple-600' },
  COMP: { color: 'from-amber-500 to-amber-600',    statColor: 'text-amber-600' },
  ML:   { color: 'from-pink-500 to-pink-600',      statColor: 'text-pink-600' },
  PL:   { color: 'from-sky-500 to-sky-600',        statColor: 'text-sky-600' },
};
function balanceColors(code: string) {
  return BALANCE_COLORS[code] ?? { color: 'from-slate-500 to-slate-600', statColor: 'text-slate-600' };
}

function workingDays(from: string, to: string): number {
  if (!from || !to) return 0;
  let count = 0;
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) { if (cur.getDay() !== 0 && cur.getDay() !== 6) count++; cur.setDate(cur.getDate() + 1); }
  return count;
}

function statusStyle(s: LeaveRequest['status']) {
  if (s === 'Approved') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (s === 'Rejected') return 'bg-red-50 text-red-600 border-red-100';
  return 'bg-amber-50 text-amber-600 border-amber-100';
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Apply Modal ──────────────────────────────────────────────────────────────
interface ApplyModalProps {
  onClose: () => void;
  onCreated: (app: LeaveRequest) => void;
  leaveTypes: LeaveType[];
  balances: LeaveBalance[];
}

function ApplyLeaveModal({ onClose, onCreated, leaveTypes, balances }: ApplyModalProps) {
  const [form, setForm] = useState({ typeId: leaveTypes[0]?.id ?? '', from: '', to: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const days = workingDays(form.from, form.to);
  const selectedType = leaveTypes.find(t => t.id === form.typeId);
  const selectedBalance = balances.find(b => b.type === selectedType?.code);

  useEffect(() => {
    if (!form.typeId && leaveTypes.length > 0) set('typeId', leaveTypes[0].id);
  }, [leaveTypes]);

  const handleSubmit = async () => {
    if (!form.from || !form.to || !form.reason.trim() || !form.typeId) return;
    setSubmitting(true); setError(null);
    try {
      const app = await apiFetch('/leave/applications', {
        method: 'POST',
        body: JSON.stringify({ leaveTypeId: form.typeId, startDate: form.from, endDate: form.to, reason: form.reason }),
      });
      onCreated({
        id: app.id,
        type: selectedType?.name ?? form.typeId,
        from: app.startDate.slice(0, 10),
        to: app.endDate.slice(0, 10),
        days: app.totalDays,
        reason: app.reason,
        status: app.status === 'PENDING' ? 'Pending' : app.status === 'APPROVED' ? 'Approved' : 'Rejected',
        appliedOn: app.createdAt.slice(0, 10),
      });
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-8 duration-300">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Apply for Leave</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Submit leave request for approval</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-red-500 hover:border-red-200 transition-all text-lg font-black">&times;</button>
        </div>

        <div className="px-8 py-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Leave Type</label>
            <select value={form.typeId} onChange={e => set('typeId', e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all appearance-none">
              {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {selectedBalance && (
            <div className={`px-4 py-3 rounded-xl border flex items-center justify-between ${selectedBalance.balance > 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
              <span className={`text-[10px] font-black uppercase tracking-widest ${selectedBalance.balance > 0 ? 'text-emerald-700' : 'text-red-600'}`}>Available balance</span>
              <span className={`text-sm font-black ${selectedBalance.balance > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{selectedBalance.balance} days</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">From</label>
              <input type="date" value={form.from} min={new Date().toISOString().slice(0, 10)} onChange={e => set('from', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">To</label>
              <input type="date" value={form.to} min={form.from || new Date().toISOString().slice(0, 10)} onChange={e => set('to', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all" />
            </div>
          </div>

          {days > 0 && (
            <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
              <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Working days</span>
              <span className="text-lg font-black text-indigo-700">{days} day{days !== 1 ? 's' : ''}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Reason / Notes</label>
            <textarea value={form.reason} onChange={e => set('reason', e.target.value)} rows={3}
              placeholder="Briefly describe the reason for your leave request…"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all resize-none placeholder:text-slate-300 placeholder:font-normal" />
          </div>

          {error && <p className="text-[10px] font-black text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">{error}</p>}
        </div>

        <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-3 bg-white border border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all">Cancel</button>
          <button onClick={handleSubmit} disabled={!form.from || !form.to || !form.reason.trim() || !form.typeId || submitting}
            className="px-8 py-3 bg-indigo-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2">
            {submitting ? <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Submitting…</> : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Employee Leave View ──────────────────────────────────────────────────────
function EmployeeLeaveView() {
  const { user } = useAuth();
  const [showApply, setShowApply] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [history, setHistory] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'balance' | 'history'>('balance');

  useEffect(() => {
    async function load() {
      try {
        const [types, appsRes] = await Promise.allSettled([
          apiFetch('/leave/types'),
          user?.employeeId
            ? apiFetch(`/leave/applications?employeeId=${user.employeeId}&limit=100`)
            : apiFetch('/leave/applications?limit=100'),
        ]);

        if (types.status === 'fulfilled') {
          const activeTypes = (types.value as LeaveType[]).filter((t: any) => t.isActive);
          setLeaveTypes(activeTypes.slice(0, 8));
        }

        if (appsRes.status === 'fulfilled') {
          const apps = appsRes.value.applications ?? [];
          setHistory(apps.map((a: any) => ({
            id: a.id,
            type: a.leaveType?.name ?? a.leaveTypeId,
            from: a.startDate.slice(0, 10),
            to: a.endDate.slice(0, 10),
            days: a.totalDays,
            reason: a.reason ?? '',
            status: a.status === 'PENDING' ? 'Pending' : a.status === 'APPROVED' ? 'Approved' : 'Rejected',
            appliedOn: a.createdAt.slice(0, 10),
          })));
        }

        // Fetch balances if employeeId is known
        if (user?.employeeId) {
          try {
            const bals = await apiFetch(`/leave/balances/${user.employeeId}`);
            if (Array.isArray(bals) && bals.length > 0) {
              setBalances(bals.map((b: any) => {
                const { color, statColor } = balanceColors(b.leaveType?.code ?? '');
                const total = b.entitledDays + (b.carryForward ?? 0);
                const used = b.usedDays ?? 0;
                const balance = total - used - (b.pendingDays ?? 0);
                return { type: b.leaveType?.code ?? b.leaveTypeId, label: b.leaveType?.name ?? '', total, used, balance, color, statColor };
              }));
            }
          } catch { /* balances not available */ }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.employeeId]);

  const pendingCount = history.filter(h => h.status === 'Pending').length;

  const handleCreated = (req: LeaveRequest) => {
    setHistory(prev => [req, ...prev]);
    setToast(`Leave request submitted for ${req.days} working day${req.days !== 1 ? 's' : ''}`);
    setTimeout(() => setToast(null), 4000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-[1100px] mx-auto pb-16 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-5">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">My <span className="text-indigo-600">Leave</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">Leave balances, applications & history</p>
        </div>
        <div className="flex gap-3">
          {pendingCount > 0 && (
            <div className="px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-xl flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
              <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest">{pendingCount} Pending</span>
            </div>
          )}
          <button onClick={() => setShowApply(true)}
            className="px-6 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2">
            <span className="text-base leading-none">+</span> Apply for Leave
          </button>
        </div>
      </div>

      {/* Balance cards */}
      {balances.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {balances.map(b => (
            <div key={b.type} className="bg-white rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5 overflow-hidden group hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300">
              <div className={`h-1.5 bg-gradient-to-r ${b.color}`} />
              <div className="p-6">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-tight mb-4">{b.label}</p>
                <div className="flex items-baseline gap-1.5 mb-3">
                  <span className={`text-4xl font-black tracking-tighter ${b.statColor}`}>{b.balance}</span>
                  <span className="text-[11px] font-black text-slate-400">/ {b.total}d</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full bg-gradient-to-r ${b.color} rounded-full transition-all`} style={{ width: `${Math.round((b.balance / (b.total || 1)) * 100)}%` }} />
                </div>
                <p className="text-[9px] font-bold text-slate-400 mt-2 uppercase tracking-widest">{b.used} used · {Math.round((b.balance / (b.total || 1)) * 100)}% remaining</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs + history */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="border-b border-slate-100 px-8 flex gap-8 bg-slate-50/50">
          {(['balance', 'history'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`py-5 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {tab === 'balance' ? 'Balance Breakdown' : `My Applications (${history.length})`}
            </button>
          ))}
        </div>

        <div className="p-8">
          {activeTab === 'balance' && balances.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] uppercase font-black tracking-[0.2em] text-slate-400">
                    <th className="pb-5">Leave Type</th>
                    <th className="pb-5 text-center">Entitlement</th>
                    <th className="pb-5 text-center">Used</th>
                    <th className="pb-5 text-center">Balance</th>
                    <th className="pb-5">Utilisation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {balances.map(b => (
                    <tr key={b.type} className="hover:bg-slate-50/50 transition-all">
                      <td className="py-5 font-black text-slate-900 text-sm">{b.label}</td>
                      <td className="py-5 text-center font-bold text-slate-500 text-sm">{b.total}d</td>
                      <td className="py-5 text-center font-bold text-rose-500 text-sm">{b.used}d</td>
                      <td className={`py-5 text-center font-black text-lg ${b.statColor}`}>{b.balance}d</td>
                      <td className="py-5 w-36">
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full bg-gradient-to-r ${b.color} rounded-full`} style={{ width: `${Math.round((b.balance / (b.total || 1)) * 100)}%` }} />
                        </div>
                        <p className="text-[9px] font-black text-slate-400 uppercase mt-1">{Math.round((b.balance / (b.total || 1)) * 100)}% left</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeTab === 'balance' && balances.length === 0 && (
            <div className="py-12 text-center"><p className="text-sm font-black text-slate-300 uppercase tracking-widest">No leave entitlements configured yet</p></div>
          )}

          {activeTab === 'history' && (
            <div className="flex flex-col gap-3">
              {history.map(req => (
                <div key={req.id} className="flex items-center gap-5 p-5 bg-slate-50/50 rounded-2xl border border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/20 transition-all">
                  <div className="flex flex-col items-center gap-1 w-16 shrink-0">
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-lg border tracking-widest ${statusStyle(req.status)}`}>{req.status}</span>
                    <span className="text-[9px] font-black text-slate-400 uppercase">{req.id.slice(0, 8)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-900">{req.type}</p>
                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">{fmtDate(req.from)} → {fmtDate(req.to)} · {req.days} day{req.days !== 1 ? 's' : ''}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-1 truncate">"{req.reason}"</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Applied</p>
                    <p className="text-[11px] font-bold text-slate-600 mt-0.5">{fmtDate(req.appliedOn)}</p>
                  </div>
                </div>
              ))}
              {history.length === 0 && (
                <div className="py-16 text-center">
                  <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No leave applications yet</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showApply && <ApplyLeaveModal onClose={() => setShowApply(false)} onCreated={handleCreated} leaveTypes={leaveTypes} balances={balances} />}

      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-8 duration-400">
          <div className="bg-slate-900 border border-slate-700 px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4">
            <div className="w-2 h-2 bg-emerald-500 rounded-full" />
            <span className="text-[10px] font-black text-white uppercase tracking-widest">{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────
export default function LeavePage() {
  return <EmployeeLeaveView />;
}
