'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { Seal } from '@/components/official';

// ─── Types ────────────────────────────────────────────────────────────────────
interface LeaveType { id: string; code: string; name: string; }
interface LeaveBalance {
  type: string; label: string; total: number; used: number; balance: number;
}
interface LeaveRequest {
  id: string; type: string; from: string; to: string; days: number; reason: string;
  status: 'Pending' | 'Approved' | 'Rejected'; appliedOn: string;
}

/**
 * The instrument behind each leave type, where one exists.
 *
 * This replaces a map of six decorative gradients. Hue told the reader nothing
 * the label beside it did not already say, and the Official Record palette has
 * no six-way colour vocabulary to spend on it. What a reader of a leave balance
 * actually needs to know is whether the number is a floor they cannot go below
 * or a house policy they can — so the citation replaces the colour.
 *
 * Day counts appear ONLY where the statute fixes them plainly (annual, sick).
 * For the family-leave types the governing Act is named without a day count:
 * those entitlements vary with qualifying conditions, and a wrong figure on a
 * compliance screen is worse than no figure. COMP has no statutory entitlement
 * in Singapore at all, so it carries no seal.
 */
const LEAVE_CITATIONS: Record<string, string> = {
  AL: 'EA s.43 · floor 7 in year 1',
  SL: 'EA s.89 · floor 14 outpatient',
  CL: 'CDCA · childcare leave',
  ML: 'EA s.76 · maternity leave',
  PL: 'CDCA · paternity leave',
};

function workingDays(from: string, to: string): number {
  if (!from || !to) return 0;
  let count = 0;
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) { if (cur.getDay() !== 0 && cur.getDay() !== 6) count++; cur.setDate(cur.getDate() + 1); }
  return count;
}

function statusStyle(s: LeaveRequest['status']) {
  if (s === 'Approved') return 'bg-page text-accent border-accent';
  if (s === 'Rejected') return 'bg-page text-ink border-ink';
  return 'bg-page text-ink border-highlight';
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
  const [file, setFile] = useState<File | null>(null);
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
      const fd = new FormData();
      fd.append('leaveTypeId', form.typeId);
      fd.append('startDate', form.from);
      fd.append('endDate', form.to);
      fd.append('reason', form.reason);
      if (file) fd.append('attachment', file);
      const app = await apiFetch('/leave/applications', { method: 'POST', body: fd });
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-shadow backdrop- animate-in fade-in duration-200">
      <div className="bg-paper w-full max-w-lg max-h-[90vh] flex flex-col border border-rule overflow-hidden animate-in slide-in-from-bottom-8 duration-300">
        <div className="px-4 sm:px-6 lg:px-8 py-6 border-b border-rule bg-page flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-lg font-black text-ink uppercase tracking-widest">Apply for Leave</h3>
            <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1">Submit leave request for approval</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center bg-paper border border-rule text-muted hover:text-ink hover:border-ink transition-all text-lg font-black">&times;</button>
        </div>

        <div className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-5 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest">Leave Type</label>
            <select value={form.typeId} onChange={e => set('typeId', e.target.value)}
              className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all appearance-none">
              {leaveTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          {selectedBalance && (
            <div className={`px-4 py-3  border flex items-center justify-between ${selectedBalance.balance > 0 ? 'bg-page border-accent' : 'bg-page border-ink'}`}>
              <span className={`text-[10px] font-black uppercase tracking-widest ${selectedBalance.balance > 0 ? 'text-accent' : 'text-ink'}`}>Available balance</span>
              <span className={`text-sm font-black ${selectedBalance.balance > 0 ? 'text-accent' : 'text-ink'}`}>{selectedBalance.balance} days</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest">From</label>
              <input type="date" value={form.from} min={new Date().toISOString().slice(0, 10)} onChange={e => set('from', e.target.value)}
                className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest">To</label>
              <input type="date" value={form.to} min={form.from || new Date().toISOString().slice(0, 10)} onChange={e => set('to', e.target.value)}
                className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all" />
            </div>
          </div>

          {days > 0 && (
            <div className="flex items-center justify-between px-4 py-3 bg-page border border-accent">
              <span className="text-[10px] font-black text-accent uppercase tracking-widest">Working days</span>
              <span className="text-lg font-black text-accent">{days} day{days !== 1 ? 's' : ''}</span>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest">Reason / Notes</label>
            <textarea value={form.reason} onChange={e => set('reason', e.target.value)} rows={3}
              placeholder="Briefly describe the reason for your leave request…"
              className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent transition-all resize-none placeholder:text-muted placeholder:font-normal" />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest">
              Supporting Document <span className="text-muted normal-case tracking-normal font-bold">(optional · PDF or image, max 10 MB)</span>
            </label>
            {file ? (
              <div className="flex items-center justify-between gap-3 px-4 py-3 bg-page border border-accent">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg">📎</span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-black text-accent truncate">{file.name}</p>
                    <p className="text-[9px] font-bold text-accent uppercase tracking-widest">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button onClick={() => setFile(null)} className="text-[9px] font-black text-accent hover:text-ink uppercase tracking-widest">Remove</button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 px-4 py-6 bg-page border-2 border-dashed border-rule cursor-pointer hover:border-accent hover:bg-page transition-all">
                <span className="text-xl text-muted">📎</span>
                <span className="text-[10px] font-black text-muted uppercase tracking-widest">Click to attach a file</span>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 10 * 1024 * 1024) { setError('File exceeds 10 MB limit'); return; }
                    setError(null);
                    setFile(f);
                  }}
                />
              </label>
            )}
          </div>

          {error && <p className="text-[10px] font-black text-ink bg-page border border-ink px-4 py-3">{error}</p>}
        </div>

        <div className="px-4 sm:px-6 lg:px-8 py-5 border-t border-rule bg-page flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-6 py-3 bg-paper border border-rule text-muted font-black text-[10px] uppercase tracking-widest hover:bg-page transition-all">Cancel</button>
          <button onClick={handleSubmit} disabled={!form.from || !form.to || !form.reason.trim() || !form.typeId || submitting}
            className="px-4 sm:px-6 lg:px-8 py-3 bg-accent text-paper font-black text-[10px] uppercase tracking-widest hover:bg-accent transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2">
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
  const [balSort, setBalSort] = useState<{ col: 'label' | 'total' | 'used' | 'balance' | 'pct'; dir: 'asc' | 'desc' }>({ col: 'label', dir: 'asc' });

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
                const total = b.entitledDays + (b.carryForward ?? 0);
                const used = b.usedDays ?? 0;
                const balance = total - used - (b.pendingDays ?? 0);
                return { type: b.leaveType?.code ?? b.leaveTypeId, label: b.leaveType?.name ?? '', total, used, balance };
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

  const sortedBalances = [...balances].sort((a, b) => {
    const d = balSort.dir === 'asc' ? 1 : -1;
    switch (balSort.col) {
      case 'label':   return d * a.label.localeCompare(b.label);
      case 'total':   return d * (a.total - b.total);
      case 'used':    return d * (a.used - b.used);
      case 'balance': return d * (a.balance - b.balance);
      case 'pct':     return d * ((a.balance / (a.total || 1)) - (b.balance / (b.total || 1)));
      default: return 0;
    }
  });
  function toggleBalSort(col: typeof balSort.col) {
    setBalSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function BalSortIcon({ col }: { col: typeof balSort.col }) {
    return <span className="text-[8px] ml-1">{balSort.col === col ? (balSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

  const handleCreated = (req: LeaveRequest) => {
    setHistory(prev => [req, ...prev]);
    setToast(`Leave request submitted for ${req.days} working day${req.days !== 1 ? 's' : ''}`);
    setTimeout(() => setToast(null), 4000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-accent border-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-[1100px] mx-auto pb-16 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-paper p-4 sm:p-6 lg:p-8 border border-rule flex flex-col sm:flex-row justify-between items-start sm:items-center gap-5">
        <div>
          <h1 className="text-3xl font-black text-ink tracking-tighter">My <span className="text-accent">Leave</span></h1>
          <p className="text-sm font-bold text-muted mt-1 uppercase tracking-widest">Leave balances, applications & history</p>
        </div>
        <div className="flex gap-3">
          {pendingCount > 0 && (
            <div className="px-4 py-2.5 bg-page border border-highlight flex items-center gap-2">
              <div className="w-1.5 h-1.5 bg-highlight animate-pulse" />
              <span className="text-[10px] font-black text-ink uppercase tracking-widest">{pendingCount} Pending</span>
            </div>
          )}
          <button onClick={() => setShowApply(true)}
            className="px-6 py-2.5 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all flex items-center gap-2">
            <span className="text-base leading-none">+</span> Apply for Leave
          </button>
        </div>
      </div>

      {/* Balance cards */}
      {balances.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {balances.map(b => (
            <div key={b.type} className="bg-paper border border-rule p-4 sm:p-6 flex flex-col">
              <p className="eyebrow-tight leading-tight mb-3">{b.label}</p>
              <div className="flex items-baseline gap-1.5 mb-3">
                <span className="text-4xl font-black tracking-tighter text-ink tabular-nums">{b.balance}</span>
                <span className="text-[11px] font-black text-muted tabular-nums">/ {b.total}d</span>
              </div>
              {/* Consumption, not remainder: the bar fills as the entitlement is
                  spent, so a nearly-full bar reads as "nearly out" at a glance. */}
              <div className="h-1.5 bg-page">
                <div className="h-full bg-accent transition-all"
                     style={{ width: `${Math.min(100, Math.round((b.used / (b.total || 1)) * 100))}%` }} />
              </div>
              <p className="text-[9px] font-bold text-muted mt-2 uppercase tracking-widest tabular-nums">
                {b.used} of {b.total} used · {b.balance} left
              </p>
              {LEAVE_CITATIONS[b.type] && (
                <span className="mt-2"><Seal cite={LEAVE_CITATIONS[b.type]} /></span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tabs + history */}
      <div className="bg-paper border border-rule overflow-hidden">
        <div className="border-b border-rule px-4 sm:px-6 lg:px-8 flex gap-8 bg-page">
          {(['balance', 'history'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`py-5 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${activeTab === tab ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'}`}>
              {tab === 'balance' ? 'Balance Breakdown' : `My Applications (${history.length})`}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-6 lg:p-8">
          {activeTab === 'balance' && balances.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-rule text-[10px] uppercase font-black tracking-[0.2em] text-muted">
                    {([
                      { col: 'label',   label: 'Leave Type',  cls: 'pb-5',              align: 'start' },
                      { col: 'total',   label: 'Entitlement', cls: 'pb-5 text-center',  align: 'center' },
                      { col: 'used',    label: 'Used',        cls: 'pb-5 text-center',  align: 'center' },
                      { col: 'balance', label: 'Balance',     cls: 'pb-5 text-center',  align: 'center' },
                      { col: 'pct',     label: 'Utilisation', cls: 'pb-5',              align: 'start' },
                    ] as const).map(h => (
                      <th key={h.col} className={h.cls}>
                        <button onClick={() => toggleBalSort(h.col)} className={`flex items-center hover:text-ink transition-colors ${h.align === 'center' ? 'mx-auto justify-center' : ''}`}>
                          {h.label}<BalSortIcon col={h.col} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {sortedBalances.map(b => (
                    <tr key={b.type} className="hover:bg-page transition-all">
                      <td className="py-5 font-black text-ink text-sm">
                        {b.label}
                        {LEAVE_CITATIONS[b.type] && (
                          <span className="block mt-1"><Seal cite={LEAVE_CITATIONS[b.type]} /></span>
                        )}
                      </td>
                      <td className="py-5 text-center font-bold text-muted text-sm">{b.total}d</td>
                      <td className="py-5 text-center font-bold text-ink text-sm">{b.used}d</td>
                      <td className="py-5 text-center font-black text-lg text-ink tabular-nums">{b.balance}d</td>
                      <td className="py-5 w-36">
                        <div className="h-2 bg-page overflow-hidden">
                          <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.round((b.used / (b.total || 1)) * 100))}%` }} />
                        </div>
                        <p className="text-[9px] font-black text-muted uppercase mt-1 tabular-nums">{b.used} of {b.total} used</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeTab === 'balance' && balances.length === 0 && (
            <div className="py-12 text-center"><p className="text-sm font-black text-muted uppercase tracking-widest">No leave entitlements configured yet</p></div>
          )}

          {activeTab === 'history' && (
            <div className="flex flex-col gap-3">
              {history.map(req => (
                <div key={req.id} className="flex items-center gap-5 p-5 bg-page border border-rule hover:border-accent hover:bg-page transition-all">
                  <div className="flex flex-col items-center gap-1 w-16 shrink-0">
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1  border tracking-widest ${statusStyle(req.status)}`}>{req.status}</span>
                    <span className="text-[9px] font-black text-muted uppercase">{req.id.slice(0, 8)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-ink">{req.type}</p>
                    <p className="text-[11px] font-bold text-muted mt-0.5">{fmtDate(req.from)} → {fmtDate(req.to)} · {req.days} day{req.days !== 1 ? 's' : ''}</p>
                    <p className="text-[10px] font-bold text-muted mt-1 truncate">&quot;{req.reason}&quot;</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="label-form">Applied</p>
                    <p className="text-[11px] font-bold text-ink mt-0.5">{fmtDate(req.appliedOn)}</p>
                  </div>
                </div>
              ))}
              {history.length === 0 && (
                <div className="py-16 text-center">
                  <p className="text-sm font-black text-muted uppercase tracking-widest">No leave applications yet</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showApply && <ApplyLeaveModal onClose={() => setShowApply(false)} onCreated={handleCreated} leaveTypes={leaveTypes} balances={balances} />}

      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-8 duration-400">
          <div className="bg-shadow border border-shadow px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
            <div className="w-2 h-2 bg-accent" />
            <span className="text-[10px] font-black text-paper uppercase tracking-widest">{toast}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Types for HR analytics ───────────────────────────────────────────────────
interface MCFlagged {
  employeeId: string;
  occurrences: number;
  totalSickDays: number;
  mondayCount: number;
  fridayCount: number;
  monFriRatio: number;
  patternType: 'MONDAY_PATTERN' | 'FRIDAY_PATTERN' | 'MONDAY_FRIDAY_PATTERN';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  employee: { name: string; department: string; designation: string } | null;
}
interface TrendEmployee {
  employeeId: string;
  name: string;
  department: string;
  totalDays: number;
  occurrences: number;
  monthlyBreakdown: Record<string, number>;
}
interface TrendDept {
  department: string;
  totalDays: number;
  occurrences: number;
  employeeCount: number;
}

const SEVERITY_STYLE: Record<string, string> = {
  HIGH:   'bg-page text-ink border-ink',
  MEDIUM: 'bg-page text-ink border-highlight',
  LOW:    'bg-page text-muted border-rule',
};
const PATTERN_LABEL: Record<string, string> = {
  MONDAY_PATTERN:        'Monday',
  FRIDAY_PATTERN:        'Friday',
  MONDAY_FRIDAY_PATTERN: 'Mon + Fri',
};

// ─── HR Analytics: MC Patterns + Sick Leave Trends ────────────────────────────
function HRLeaveAnalytics() {
  const [tab, setTab] = useState<'patterns' | 'trends'>('patterns');
  const [months, setMonths] = useState(12);
  const [flagged, setFlagged] = useState<MCFlagged[]>([]);
  const [byEmployee, setByEmployee] = useState<TrendEmployee[]>([]);
  const [byDept, setByDept] = useState<TrendDept[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [pRes, tRes] = await Promise.allSettled([
        apiFetch(`/leave/mc-patterns?months=${months}`),
        apiFetch(`/leave/sick-leave-trends?months=${months}`),
      ]);
      if (pRes.status === 'fulfilled') setFlagged(pRes.value.flagged ?? []);
      if (tRes.status === 'fulfilled') {
        setByEmployee(tRes.value.byEmployee ?? []);
        setByDept(tRes.value.byDepartment ?? []);
      }
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [months]);

  const maxDeptDays = byDept[0]?.totalDays || 1;

  return (
    <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-16 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-paper p-4 sm:p-6 lg:p-8 border border-rule flex flex-col sm:flex-row justify-between items-start sm:items-center gap-5">
        <div>
          <h1 className="text-3xl font-black text-ink tracking-tighter">Sick Leave <span className="text-ink">Analytics</span></h1>
          <p className="text-sm font-bold text-muted mt-1 uppercase tracking-widest">MC pattern detection &amp; sick leave trends</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={months} onChange={e => setMonths(Number(e.target.value))}
            className="px-4 py-2.5 bg-paper border border-rule text-[11px] font-black text-ink uppercase tracking-widest outline-none focus:border-ink transition-all appearance-none">
            {[3, 6, 12, 24].map(m => <option key={m} value={m}>Last {m} months</option>)}
          </select>
          <button onClick={load} disabled={loading}
            className="px-5 py-2.5 bg-ink text-paper text-[10px] font-black uppercase tracking-widest hover:bg-ink transition-all disabled:opacity-50 flex items-center gap-2">
            {loading ? <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> : '↺'}
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-paper border border-rule overflow-hidden">
        <div className="border-b border-rule px-4 sm:px-6 lg:px-8 flex gap-8 bg-page">
          {([
            { key: 'patterns', label: `MC Pattern Alerts${flagged.length ? ` (${flagged.length})` : ''}` },
            { key: 'trends',   label: 'Sick Leave Trends' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`py-5 text-[11px] font-black uppercase tracking-widest border-b-2 transition-all ${tab === t.key ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-6 lg:p-8">

          {/* ── MC Pattern Alerts ── */}
          {tab === 'patterns' && (
            <div className="flex flex-col gap-4">
              {lastUpdated && (
                <p className="text-[10px] font-black text-muted uppercase tracking-widest">
                  Updated {lastUpdated.toLocaleTimeString('en-SG')} · Pattern = Mon/Fri sick leave ratio ≥ 50% over last {months} months
                </p>
              )}
              {flagged.length === 0 && !loading && (
                <div className="py-16 text-center">
                  <p className="text-sm font-black text-accent uppercase tracking-widest">No suspicious patterns detected</p>
                  <p className="text-[11px] font-bold text-muted mt-2">Threshold: ≥3 occurrences, ≥50% Mon/Fri ratio</p>
                </div>
              )}
              {flagged.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-rule text-[10px] uppercase font-black tracking-[0.2em] text-muted">
                        <th className="pb-5">Employee</th>
                        <th className="pb-5 text-center">Pattern</th>
                        <th className="pb-5 text-center">Severity</th>
                        <th className="pb-5 text-center">Occurrences</th>
                        <th className="pb-5 text-center">Mon</th>
                        <th className="pb-5 text-center">Fri</th>
                        <th className="pb-5 text-center">Total Days</th>
                        <th className="pb-5 text-center">Ratio</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule">
                      {flagged.map(f => (
                        <tr key={f.employeeId} className="hover:bg-page transition-all">
                          <td className="py-4">
                            <p className="text-sm font-black text-ink">{f.employee?.name ?? f.employeeId}</p>
                            <p className="text-[10px] font-bold text-muted">{f.employee?.department ?? ''}{f.employee?.designation ? ` · ${f.employee.designation}` : ''}</p>
                          </td>
                          <td className="py-4 text-center">
                            <span className="text-[10px] font-black text-ink bg-page px-2.5 py-1">{PATTERN_LABEL[f.patternType] ?? f.patternType}</span>
                          </td>
                          <td className="py-4 text-center">
                            <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1  border ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
                          </td>
                          <td className="py-4 text-center font-black text-ink text-sm">{f.occurrences}</td>
                          <td className="py-4 text-center font-bold text-accent text-sm">{f.mondayCount}</td>
                          <td className="py-4 text-center font-bold text-accent text-sm">{f.fridayCount}</td>
                          <td className="py-4 text-center font-bold text-ink text-sm">{f.totalSickDays}d</td>
                          <td className="py-4 text-center">
                            <div className="flex flex-col items-center gap-1">
                              {/* This was a three-way traffic light. Mapped onto
                                  the tokens all three branches became text-ink,
                                  so the warning disappeared silently. The
                                  threshold now carries a WORD, which is what the
                                  colour was standing in for. */}
                              <span className="text-sm font-black text-ink tabular-nums">
                                {(f.monFriRatio * 100).toFixed(0)}%
                              </span>
                              {f.monFriRatio >= 0.75 && (
                                <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-ink text-paper">
                                  High
                                </span>
                              )}
                              {f.monFriRatio >= 0.5 && f.monFriRatio < 0.75 && (
                                <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 border border-highlight text-ink">
                                  Elevated
                                </span>
                              )}
                              <div className="h-1.5 w-16 bg-page overflow-hidden">
                                <div className={`h-full  ${f.monFriRatio >= 0.75 ? 'bg-ink' : 'bg-highlight'}`}
                                  style={{ width: `${Math.min(f.monFriRatio * 100, 100)}%` }} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Sick Leave Trends ── */}
          {tab === 'trends' && (
            <div className="flex flex-col gap-8">

              {/* By Department */}
              <div>
                <h3 className="text-[11px] font-black text-muted uppercase tracking-widest mb-4">By Department</h3>
                {byDept.length === 0 && !loading && (
                  <p className="text-sm font-black text-muted uppercase tracking-widest py-6 text-center">No data</p>
                )}
                <div className="flex flex-col gap-3">
                  {byDept.map(d => (
                    <div key={d.department} className="flex items-center gap-4">
                      <div className="w-36 shrink-0 text-right">
                        <p className="text-[11px] font-black text-ink truncate">{d.department}</p>
                        <p className="text-[9px] font-bold text-muted">{d.employeeCount} employee{d.employeeCount !== 1 ? 's' : ''}</p>
                      </div>
                      <div className="flex-1 h-7 bg-page overflow-hidden">
                        <div className="h-full bg-accent flex items-center px-3 transition-all"
                          style={{ width: `${Math.max((d.totalDays / maxDeptDays) * 100, 4)}%` }}>
                          <span className="text-[9px] font-black text-paper whitespace-nowrap">{d.totalDays}d</span>
                        </div>
                      </div>
                      <div className="w-16 shrink-0 text-right">
                        <span className="text-[10px] font-black text-muted">{d.occurrences} apps</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* By Employee (top 20) */}
              <div>
                <h3 className="text-[11px] font-black text-muted uppercase tracking-widest mb-4">Top Employees by Sick Days</h3>
                {byEmployee.length === 0 && !loading && (
                  <p className="text-sm font-black text-muted uppercase tracking-widest py-6 text-center">No data</p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-rule text-[10px] uppercase font-black tracking-[0.2em] text-muted">
                        <th className="pb-5">#</th>
                        <th className="pb-5">Employee</th>
                        <th className="pb-5 text-center">Dept</th>
                        <th className="pb-5 text-center">Applications</th>
                        <th className="pb-5 text-center">Total Days</th>
                        <th className="pb-5">Monthly Trend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule">
                      {byEmployee.map((e, i) => {
                        const months = Object.entries(e.monthlyBreakdown).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
                        const maxM = Math.max(...months.map(([, v]) => v), 1);
                        return (
                          <tr key={e.employeeId} className="hover:bg-page transition-all">
                            <td className="py-4 text-[11px] font-black text-muted w-8">{i + 1}</td>
                            <td className="py-4">
                              <p className="text-sm font-black text-ink">{e.name}</p>
                              <p className="text-[10px] font-bold text-muted">{e.employeeId.slice(0, 8)}</p>
                            </td>
                            <td className="py-4 text-center">
                              <span className="text-[10px] font-black text-ink bg-page px-2 py-0.5">{e.department}</span>
                            </td>
                            <td className="py-4 text-center font-black text-ink text-sm">{e.occurrences}</td>
                            <td className="py-4 text-center font-black text-ink text-lg">{e.totalDays}</td>
                            <td className="py-4">
                              <div className="flex items-end gap-0.5 h-8">
                                {months.map(([mo, v]) => (
                                  <div key={mo} className="flex flex-col items-center gap-0.5 w-6" title={`${mo}: ${v}d`}>
                                    <div className="w-4 bg-ink hover:bg-ink transition-colors cursor-default"
                                      style={{ height: `${Math.max((v / maxM) * 28, 3)}px` }} />
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────
const HR_ROLES = new Set(['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER']);

export default function LeavePage() {
  const { user } = useAuth();
  const role = (user?.role ?? '').toUpperCase();
  // "My Leave" always shows the user's own balances, applications & history —
  // admins are employees too. HR/admin roles additionally get the sick-leave
  // analytics appended below (the management view also lives under /leave/registry).
  return (
    <div className="flex flex-col gap-10">
      <EmployeeLeaveView />
      {HR_ROLES.has(role) && <HRLeaveAnalytics />}
    </div>
  );
}
