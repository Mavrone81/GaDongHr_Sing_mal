'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeaveBalance {
  type: string;
  label: string;
  total: number;
  used: number;
  balance: number;
  color: string;
  statColor: string;
}

interface LeaveRequest {
  id: string;
  type: string;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  appliedOn: string;
}

// ─── Apply Modal ──────────────────────────────────────────────────────────────

const LEAVE_TYPES = [
  { value: 'ANNUAL', label: 'Annual Leave' },
  { value: 'SICK', label: 'Medical / Sick Leave' },
  { value: 'CHILDCARE', label: 'Childcare Leave' },
  { value: 'MATERNITY', label: 'Maternity Leave' },
  { value: 'PATERNITY', label: 'Paternity Leave' },
  { value: 'COMPASSIONATE', label: 'Compassionate Leave' },
  { value: 'UNPAID', label: 'Unpaid Leave' },
];

function workingDays(from: string, to: string): number {
  if (!from || !to) return 0;
  let count = 0;
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

interface ApplyModalProps {
  onClose: () => void;
  onSubmit: (req: Omit<LeaveRequest, 'id' | 'status' | 'appliedOn'>) => void;
  balances: LeaveBalance[];
}

function ApplyLeaveModal({ onClose, onSubmit, balances }: ApplyModalProps) {
  const [form, setForm] = useState({ type: 'ANNUAL', from: '', to: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const days = workingDays(form.from, form.to);
  const selectedBalance = balances.find(b => b.type === form.type);

  const handleSubmit = async () => {
    if (!form.from || !form.to || !form.reason.trim()) return;
    setSubmitting(true);
    await new Promise(r => setTimeout(r, 800));
    onSubmit({
      type: LEAVE_TYPES.find(t => t.value === form.type)?.label ?? form.type,
      from: form.from,
      to: form.to,
      days,
      reason: form.reason,
    });
    setSubmitting(false);
    onClose();
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
          {/* Leave type */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Leave Type</label>
            <select
              value={form.type}
              onChange={e => set('type', e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all appearance-none"
            >
              {LEAVE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Balance indicator */}
          {selectedBalance && (
            <div className={`px-4 py-3 rounded-xl border flex items-center justify-between ${
              selectedBalance.balance > 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'
            }`}>
              <span className={`text-[10px] font-black uppercase tracking-widest ${selectedBalance.balance > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                Available balance
              </span>
              <span className={`text-sm font-black ${selectedBalance.balance > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                {selectedBalance.balance} days
              </span>
            </div>
          )}

          {/* Date range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">From</label>
              <input
                type="date"
                value={form.from}
                min={new Date().toISOString().slice(0, 10)}
                onChange={e => set('from', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">To</label>
              <input
                type="date"
                value={form.to}
                min={form.from || new Date().toISOString().slice(0, 10)}
                onChange={e => set('to', e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all"
              />
            </div>
          </div>

          {/* Working days count */}
          {days > 0 && (
            <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
              <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Working days</span>
              <span className="text-lg font-black text-indigo-700">{days} day{days !== 1 ? 's' : ''}</span>
            </div>
          )}

          {/* Reason */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Reason / Notes</label>
            <textarea
              value={form.reason}
              onChange={e => set('reason', e.target.value)}
              rows={3}
              placeholder="Briefly describe the reason for your leave request…"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all resize-none placeholder:text-slate-300 placeholder:font-normal"
            />
          </div>
        </div>

        <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-3 bg-white border border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!form.from || !form.to || !form.reason.trim() || submitting}
            className="px-8 py-3 bg-indigo-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
          >
            {submitting ? (
              <><svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Submitting…</>
            ) : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Employee leave view ──────────────────────────────────────────────────────

const INITIAL_BALANCES: LeaveBalance[] = [
  { type: 'ANNUAL',      label: 'Annual Leave',     total: 21, used: 6.5, balance: 14.5, color: 'from-indigo-500 to-indigo-600',  statColor: 'text-indigo-600' },
  { type: 'SICK',        label: 'Sick Leave',        total: 14, used: 2,   balance: 12,   color: 'from-rose-500 to-rose-600',     statColor: 'text-rose-600' },
  { type: 'CHILDCARE',   label: 'Childcare Leave',   total: 6,  used: 0,   balance: 6,    color: 'from-purple-500 to-purple-600', statColor: 'text-purple-600' },
  { type: 'COMPASSIONATE', label: 'Compassionate',   total: 3,  used: 0,   balance: 3,    color: 'from-amber-500 to-amber-600',   statColor: 'text-amber-600' },
];

const INITIAL_HISTORY: LeaveRequest[] = [
  { id: 'LV-001', type: 'Annual Leave', from: '2026-03-24', to: '2026-03-28', days: 5, reason: 'Family vacation', status: 'Approved', appliedOn: '2026-03-10' },
  { id: 'LV-002', type: 'Sick Leave',   from: '2026-04-08', to: '2026-04-09', days: 2, reason: 'Fever and flu', status: 'Approved', appliedOn: '2026-04-07' },
  { id: 'LV-003', type: 'Annual Leave', from: '2026-04-25', to: '2026-04-30', days: 4, reason: 'Personal time off', status: 'Pending', appliedOn: '2026-04-18' },
];

function statusStyle(s: LeaveRequest['status']) {
  if (s === 'Approved') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (s === 'Rejected') return 'bg-red-50 text-red-600 border-red-100';
  return 'bg-amber-50 text-amber-600 border-amber-100';
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function EmployeeLeaveView() {
  const [showApply, setShowApply] = useState(false);
  const [balances, setBalances] = useState<LeaveBalance[]>(INITIAL_BALANCES);
  const [history, setHistory] = useState<LeaveRequest[]>(INITIAL_HISTORY);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'balance' | 'history'>('balance');

  const pendingCount = history.filter(h => h.status === 'Pending').length;

  const handleSubmit = (req: Omit<LeaveRequest, 'id' | 'status' | 'appliedOn'>) => {
    const newReq: LeaveRequest = {
      ...req,
      id: `LV-${String(history.length + 4).padStart(3, '0')}`,
      status: 'Pending',
      appliedOn: new Date().toISOString().slice(0, 10),
    };
    setHistory(prev => [newReq, ...prev]);
    setToast(`Leave request submitted for ${req.days} working day${req.days !== 1 ? 's' : ''}`);
    setTimeout(() => setToast(null), 4000);
  };

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
          <button
            onClick={() => setShowApply(true)}
            className="px-6 py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
          >
            <span className="text-base leading-none">+</span> Apply for Leave
          </button>
        </div>
      </div>

      {/* Balance cards */}
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
              {/* Progress bar */}
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${b.color} rounded-full transition-all`}
                  style={{ width: `${Math.round((b.balance / b.total) * 100)}%` }}
                />
              </div>
              <p className="text-[9px] font-bold text-slate-400 mt-2 uppercase tracking-widest">{b.used} used · {Math.round((b.balance / b.total) * 100)}% remaining</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs + history */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="border-b border-slate-100 px-8 flex gap-8 bg-slate-50/50">
          {(['balance', 'history'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-5 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${
                activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {tab === 'balance' ? 'Balance Breakdown' : `My Applications (${history.length})`}
            </button>
          ))}
        </div>

        <div className="p-8">
          {activeTab === 'balance' && (
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
                          <div className={`h-full bg-gradient-to-r ${b.color} rounded-full`} style={{ width: `${Math.round((b.balance / b.total) * 100)}%` }} />
                        </div>
                        <p className="text-[9px] font-black text-slate-400 uppercase mt-1">{Math.round((b.balance / b.total) * 100)}% left</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="flex flex-col gap-3">
              {history.map(req => (
                <div key={req.id} className="flex items-center gap-5 p-5 bg-slate-50/50 rounded-2xl border border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/20 transition-all">
                  <div className="flex flex-col items-center gap-1 w-16 shrink-0">
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-lg border tracking-widest ${statusStyle(req.status)}`}>
                      {req.status}
                    </span>
                    <span className="text-[9px] font-black text-slate-400 uppercase">{req.id}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-slate-900">{req.type}</p>
                    <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                      {fmtDate(req.from)} → {fmtDate(req.to)} · {req.days} day{req.days !== 1 ? 's' : ''}
                    </p>
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

      {showApply && <ApplyLeaveModal onClose={() => setShowApply(false)} onSubmit={handleSubmit} balances={balances} />}

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

// ─── Admin leave management view ──────────────────────────────────────────────

function AdminLeaveView() {
  const [activeTab, setActiveTab] = useState<'approvals' | 'calendar'>('approvals');
  const pending = [
    { name: 'Sarah Chen', dept: 'Engineering', type: 'Annual', from: '2026-04-25', to: '2026-04-30', days: 4, avatar: 'SC', urgency: false },
    { name: 'Marcus Tan', dept: 'Operations', type: 'Sick', from: '2026-04-20', to: '2026-04-21', days: 2, avatar: 'MT', urgency: true },
    { name: 'Linda Low', dept: 'HR', type: 'Childcare', from: '2026-04-22', to: '2026-04-22', days: 1, avatar: 'LL', urgency: false },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-[1600px] mx-auto pb-12 animate-in fade-in duration-700">
      <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">Leave <span className="text-indigo-600">Management</span></h1>
          <p className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-widest">Organizational leave portal · Statutory compliance</p>
        </div>
        <button className="px-6 py-2.5 rounded-xl text-[10px] font-black text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-all uppercase tracking-widest">
          Export Data
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white p-7 rounded-[1.5rem] border border-slate-100 shadow-lg shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Pending Approval</p>
          <p className="text-4xl font-black text-amber-500">{pending.length}</p>
          <p className="text-[9px] font-black text-amber-600 mt-4 uppercase tracking-widest flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
            {pending.filter(p => p.urgency).length} urgent
          </p>
        </div>
        <div className="bg-slate-900 p-7 rounded-[1.5rem] border border-slate-800 shadow-xl">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">Currently on Leave</p>
          <p className="text-4xl font-black text-white">8</p>
          <p className="text-[9px] font-black text-slate-500 mt-4 uppercase tracking-widest italic">4% operational impact</p>
        </div>
        <div className="bg-emerald-50/60 p-7 rounded-[1.5rem] border border-emerald-100">
          <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-3 text-center">Avg. Review Time</p>
          <p className="text-4xl font-black text-emerald-800 text-center">1.2d</p>
        </div>
      </div>

      <div className="bg-white border border-slate-100 rounded-[2rem] shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="border-b border-slate-100 px-8 flex gap-8 bg-slate-50/50">
          {(['approvals', 'calendar'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`py-5 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {tab === 'approvals' ? `Authorization Queue (${pending.length})` : 'Team Calendar'}
            </button>
          ))}
        </div>
        <div className="p-8">
          {activeTab === 'approvals' && (
            <div className="flex flex-col gap-3">
              {pending.map((req, i) => (
                <div key={i} className={`flex items-center gap-5 p-5 rounded-2xl border ${req.urgency ? 'bg-red-50/50 border-red-100' : 'bg-slate-50/50 border-slate-100'}`}>
                  <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-[11px] font-black text-white shrink-0">{req.avatar}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-black text-slate-900 uppercase tracking-tight text-sm">{req.name}</p>
                      {req.urgency && <span className="text-[8px] font-black uppercase px-2 py-0.5 bg-red-500 text-white rounded-full animate-pulse">Urgent</span>}
                    </div>
                    <p className="text-[10px] font-bold text-slate-500 mt-0.5 uppercase tracking-widest">{req.dept} · {req.type} Leave · {req.days} day{req.days > 1 ? 's' : ''}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">{fmtDate(req.from)} → {fmtDate(req.to)}</p>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button className="px-5 py-2 border border-slate-200 text-slate-600 bg-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-slate-50 transition-all">View</button>
                    <button className="px-5 py-2 bg-red-50 text-red-600 border border-red-100 text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-red-100 transition-all">Reject</button>
                    <button className="px-5 py-2 bg-indigo-600 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-500/15 transition-all">Approve</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {activeTab === 'calendar' && (
            <div className="h-80 flex flex-col items-center justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-xl mb-4 shadow-xl border border-slate-800">📅</div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Team Availability Calendar</h3>
              <p className="text-[10px] font-bold mt-2 text-slate-400 uppercase tracking-widest text-center max-w-xs">Integrating leave data for team overlap visualization</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Entry point — always the employee self-service view ─────────────────────

export default function LeavePage() {
  return <EmployeeLeaveView />;
}
