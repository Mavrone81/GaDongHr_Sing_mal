'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────
type CycleType   = 'ANNUAL' | 'MID_YEAR' | 'PROBATION' | 'CUSTOM';
type CyclePhase  = 'GOAL_SETTING' | 'SELF_ASSESSMENT' | 'MANAGER_REVIEW' | 'CALIBRATION' | 'COMPLETED';
type CycleStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED';
type AppraisalStatus = 'PENDING' | 'SELF_SUBMITTED' | 'MANAGER_SUBMITTED' | 'FINALISED';
type GoalStatus   = 'ACTIVE' | 'ACHIEVED' | 'MISSED' | 'CANCELLED';
type GoalCategory = 'PERFORMANCE' | 'DEVELOPMENT' | 'ORGANIZATIONAL';
type PipStatus    = 'ACTIVE' | 'COMPLETED' | 'EXTENDED' | 'TERMINATED';

interface ReviewCycle {
  id: string; name: string; type: CycleType; startDate: string; endDate: string;
  currentPhase: CyclePhase; status: CycleStatus; description?: string;
  _count?: { appraisals: number };
}

interface Appraisal {
  id: string; cycleId: string; employeeId: string; managerId?: string;
  selfScore?: number; managerScore?: number; overallScore?: number;
  selfComments?: string; managerComments?: string; strengths?: string; improvements?: string;
  status: AppraisalStatus;
  cycle?: ReviewCycle;
}

interface Goal {
  id: string; employeeId: string; title: string; description?: string;
  targetDate?: string; progress: number; status: GoalStatus; category: GoalCategory;
  createdAt: string;
}

interface PipRecord {
  id: string; employeeId: string; managerId: string;
  startDate: string; endDate: string; objectives: string;
  progressNotes?: string; status: PipStatus; createdAt: string;
}

interface Summary {
  activeCycles: number; totalAppraisals: number;
  completionRate: number; avgScore: string | null; activePips: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const PHASE_LABELS: Record<CyclePhase, string> = {
  GOAL_SETTING: 'Goal Setting', SELF_ASSESSMENT: 'Self-Assessment',
  MANAGER_REVIEW: 'Manager Review', CALIBRATION: 'Calibration', COMPLETED: 'Completed',
};
const PHASE_ORDER: CyclePhase[] = ['GOAL_SETTING', 'SELF_ASSESSMENT', 'MANAGER_REVIEW', 'CALIBRATION', 'COMPLETED'];

function phaseIndex(p: CyclePhase) { return PHASE_ORDER.indexOf(p); }

function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function scoreBadge(score?: number) {
  if (!score) return null;
  const color = score >= 4.5 ? 'emerald' : score >= 3.5 ? 'indigo' : score >= 2.5 ? 'amber' : 'red';
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    indigo:  'bg-indigo-50 text-indigo-700 border-indigo-200',
    amber:   'bg-amber-50 text-amber-700 border-amber-200',
    red:     'bg-red-50 text-red-700 border-red-200',
  };
  return <span className={`inline-block px-2 py-0.5 rounded-lg text-[10px] font-black border ${colorMap[color]}`}>{score.toFixed(1)}</span>;
}

const STATUS_COLORS: Record<AppraisalStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  SELF_SUBMITTED: 'bg-amber-50 text-amber-700',
  MANAGER_SUBMITTED: 'bg-indigo-50 text-indigo-700',
  FINALISED: 'bg-emerald-50 text-emerald-700',
};

const PIP_COLORS: Record<PipStatus, string> = {
  ACTIVE: 'bg-red-50 text-red-700 border-red-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EXTENDED: 'bg-amber-50 text-amber-700 border-amber-200',
  TERMINATED: 'bg-slate-50 text-slate-500 border-slate-200',
};

// ── Star rating ───────────────────────────────────────────────────────────────
function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button"
          onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(n)}
          className="text-2xl transition-transform hover:scale-110 active:scale-95">
          {n <= (hovered || value) ? '★' : '☆'}
        </button>
      ))}
      <span className="ml-2 text-sm font-black text-slate-500 self-center">{value ? `${value}/5` : 'Select'}</span>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ msg, onClear }: { msg: string; onClear: () => void }) {
  useEffect(() => { const t = setTimeout(onClear, 3500); return () => clearTimeout(t); }, [msg, onClear]);
  return (
    <div className="fixed bottom-8 right-8 z-50 bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-2xl text-[11px] font-black uppercase tracking-widest max-w-sm animate-in slide-in-from-bottom-2 duration-300">
      {msg}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type AdminTab    = 'overview' | 'cycles' | 'myappraisal' | 'team' | 'goals' | 'pip';
type EmployeeTab = 'myappraisal' | 'goals';

export default function PerformancePage() {
  const { user, loading } = useAuth();
  const [toast, setToast] = useState('');

  const role = user?.role?.toUpperCase() ?? 'EMPLOYEE';
  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'].includes(role);
  const isManager    = role === 'MANAGER' || isPrivileged;
  const isEmployee   = !isPrivileged && !isManager;

  const [adminTab, setAdminTab]       = useState<AdminTab>('overview');
  const [employeeTab, setEmployeeTab] = useState<EmployeeTab>('myappraisal');
  // "My Appraisal" nav links to /performance?view=me — show admins/managers their
  // OWN appraisal; the admin "Performance" nav (no param) keeps the mgmt view.
  const [forceMy, setForceMy] = useState(false);
  useEffect(() => { setForceMy(new URLSearchParams(window.location.search).get('view') === 'me'); }, []);

  function notify(msg: string) { setToast(msg); }

  if (loading) {
    return <div className="h-40 bg-white rounded-[2rem] border border-slate-100 animate-pulse max-w-[1400px] mx-auto" />;
  }

  // ── Personal "My Appraisal" view (employees always; admins via ?view=me) ────
  if (isEmployee || forceMy) {
    return (
      <div className="flex flex-col gap-8 max-w-[900px] mx-auto pb-20 animate-in fade-in duration-700">
        {/* Header */}
        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-violet-500/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-violet-600/5 rounded-full blur-3xl" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-2 h-2 bg-violet-600 rounded-full animate-pulse" />
              <span className="text-[9px] font-black text-violet-600 uppercase tracking-[0.4em]">My Performance</span>
            </div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter">
              {user?.name ? `Hi, ${user.name.split(' ')[0]}` : 'My Performance'}
            </h1>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2">
              Submit your self-assessment · Track your goals
            </p>
          </div>
        </div>

        {/* Employee tabs */}
        <div className="flex gap-2">
          {([['myappraisal', 'My Appraisal'], ['goals', 'My Goals']] as [EmployeeTab, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setEmployeeTab(key)}
              className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${employeeTab === key ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20' : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {employeeTab === 'myappraisal' && <MyAppraisalTab notify={notify} />}
        {employeeTab === 'goals'       && <GoalsTab notify={notify} />}

        {toast && <Toast msg={toast} onClear={() => setToast('')} />}
      </div>
    );
  }

  // ── Admin / Manager view ───────────────────────────────────────────────────
  const adminTabs: [AdminTab, string][] = [
    ['overview',    'Overview'],
    ['cycles',      'Cycles'],
    ['myappraisal', 'My Appraisal'],
    ['team',        'Team Reviews'],
    ['goals',       'Goals'],
    ...(isPrivileged ? [['pip', 'PIP'] as [AdminTab, string]] : []),
  ];

  return (
    <div className="flex flex-col gap-8 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-violet-600/5 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-violet-600 rounded-full" />
            <span className="text-[10px] font-black text-violet-600 uppercase tracking-[0.4em]">Talent Intelligence</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Performance <span className="text-violet-600">Management</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest">
            Appraisal cycles · Goals · 360° feedback · PIP governance
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {adminTabs.map(([key, label]) => (
          <button key={key} onClick={() => setAdminTab(key)}
            className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${adminTab === key ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20' : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {adminTab === 'overview'    && <OverviewTab notify={notify} />}
      {adminTab === 'cycles'      && <CyclesTab notify={notify} />}
      {adminTab === 'myappraisal' && <MyAppraisalTab notify={notify} />}
      {adminTab === 'team'        && <TeamTab notify={notify} />}
      {adminTab === 'goals'       && <GoalsTab notify={notify} />}
      {adminTab === 'pip'         && <PipTab notify={notify} />}

      {toast && <Toast msg={toast} onClear={() => setToast('')} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ─────────────────────────────────────────────────────────────────────────────
function OverviewTab({ notify }: { notify: (m: string) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [cycSort, setCycSort] = useState<{ col: 'name' | 'type' | 'period' | 'phase' | 'enrolled'; dir: 'asc' | 'desc' }>({ col: 'period', dir: 'desc' });

  useEffect(() => {
    apiFetch('/performance/summary').then(setSummary).catch(() => {});
    apiFetch('/performance/cycles?status=ACTIVE').then(setCycles).catch(() => {});
  }, []);

  const sortedCycles = [...cycles].sort((a, b) => {
    const d = cycSort.dir === 'asc' ? 1 : -1;
    switch (cycSort.col) {
      case 'name':     return d * a.name.localeCompare(b.name);
      case 'type':     return d * a.type.localeCompare(b.type);
      case 'period':   return d * a.startDate.localeCompare(b.startDate);
      case 'phase':    return d * (phaseIndex(a.currentPhase) - phaseIndex(b.currentPhase));
      case 'enrolled': return d * ((a._count?.appraisals ?? 0) - (b._count?.appraisals ?? 0));
      default: return 0;
    }
  });
  function toggleCycSort(col: typeof cycSort.col) {
    setCycSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function CycSortIcon({ col }: { col: typeof cycSort.col }) {
    return <span className="text-[8px] ml-1">{cycSort.col === col ? (cycSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

  const kpis = summary ? [
    { label: 'Active Cycles',    value: String(summary.activeCycles),      sub: 'In Progress', color: 'violet' },
    { label: 'Avg Score',        value: summary.avgScore ? `${summary.avgScore} / 5.0` : '—', sub: 'Finalised Reviews', color: 'indigo' },
    { label: 'Completion Rate',  value: `${summary.completionRate}%`,       sub: 'Self-Assessment', color: 'emerald' },
    { label: 'PIP Active',       value: String(summary.activePips),         sub: 'Employees', color: 'amber' },
  ] : [];

  const colorMap: Record<string, string> = {
    violet: 'text-violet-600', indigo: 'text-indigo-600', emerald: 'text-emerald-600', amber: 'text-amber-600',
  };

  return (
    <div className="flex flex-col gap-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {kpis.map(k => (
          <div key={k.label} className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5">
            <p className="label-form mb-4">{k.label}</p>
            <h3 className={`text-3xl font-black tracking-tighter ${colorMap[k.color]}`}>{k.value}</h3>
            <p className="text-[9px] font-black text-slate-400 uppercase mt-6">{k.sub}</p>
          </div>
        ))}
        {!summary && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white p-8 rounded-[2rem] border border-slate-100 h-36 animate-pulse" />
        ))}
      </div>

      {/* Active Cycles */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-50">
          <div className="flex items-center gap-4">
            <div className="w-2 h-8 bg-violet-600 rounded-full" />
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Active Appraisal Cycles</h3>
          </div>
        </div>
        {cycles.length === 0 ? (
          <div className="p-12 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">
            No active cycles — go to Cycles tab to create one
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="eyebrow-tight border-b border-slate-50">
                <tr>
                  {([
                    { col: 'name',     label: 'Cycle' },
                    { col: 'type',     label: 'Type' },
                    { col: 'period',   label: 'Period' },
                    { col: 'phase',    label: 'Current Phase' },
                    { col: 'phase',    label: 'Progress' },
                    { col: 'enrolled', label: 'Enrolled' },
                  ] as const).map((h, i) => (
                    <th key={i} className="px-8 py-5">
                      <button onClick={() => toggleCycSort(h.col)} className="flex items-center hover:text-slate-600 transition-colors">
                        {h.label}<CycSortIcon col={h.col} />
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sortedCycles.map(c => {
                  const pct = Math.round((phaseIndex(c.currentPhase) / (PHASE_ORDER.length - 1)) * 100);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50/50 transition-all">
                      <td className="px-8 py-5 font-black text-slate-900 text-sm">{c.name}</td>
                      <td className="px-8 py-5"><span className="text-[10px] font-black text-violet-600 bg-violet-50 px-3 py-1 rounded-lg uppercase">{c.type}</span></td>
                      <td className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</td>
                      <td className="px-8 py-5"><span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg uppercase">{PHASE_LABELS[c.currentPhase]}</span></td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-violet-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] font-black text-slate-500">{pct}%</span>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-[10px] font-black text-slate-500">{c._count?.appraisals ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CYCLES TAB (HR/Admin)
// ─────────────────────────────────────────────────────────────────────────────
interface EmployeeLite {
  id: string; fullName: string; employeeCode: string; department?: string; designation?: string;
}

function CyclesTab({ notify }: { notify: (m: string) => void }) {
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'ANNUAL' as CycleType, startDate: '', endDate: '', description: '' });
  const [enrollModal, setEnrollModal] = useState<ReviewCycle | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [allEmployees, setAllEmployees] = useState<EmployeeLite[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [enrollSearch, setEnrollSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try { setCycles(await apiFetch('/performance/cycles')); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openEnrollModal(cycle: ReviewCycle) {
    setEnrollModal(cycle);
    setSelectedIds(new Set());
    setEnrollSearch('');
    if (allEmployees.length === 0) {
      setEmployeesLoading(true);
      try {
        const data = await apiFetch('/employees?limit=500&isActive=true');
        setAllEmployees(data.employees ?? []);
      } catch { notify('Could not load employees'); }
      finally { setEmployeesLoading(false); }
    }
  }

  async function createCycle() {
    if (!form.name || !form.startDate || !form.endDate) { notify('Fill all required fields'); return; }
    setSaving(true);
    try {
      await apiFetch('/performance/cycles', { method: 'POST', body: JSON.stringify(form) });
      notify('Cycle created'); setShowCreate(false); setForm({ name: '', type: 'ANNUAL', startDate: '', endDate: '', description: '' });
      load();
    } catch (e: any) { notify(e.message || 'Failed'); }
    finally { setSaving(false); }
  }

  async function activate(id: string) {
    try { await apiFetch(`/performance/cycles/${id}/activate`, { method: 'POST' }); notify('Cycle activated'); load(); }
    catch (e: any) { notify(e.message || 'Failed'); }
  }

  async function advancePhase(id: string) {
    try { await apiFetch(`/performance/cycles/${id}/advance-phase`, { method: 'POST' }); notify('Phase advanced'); load(); }
    catch (e: any) { notify(e.message || 'Failed'); }
  }

  async function deleteCycle(id: string) {
    if (!confirm('Delete this cycle and all its appraisals?')) return;
    try { await apiFetch(`/performance/cycles/${id}`, { method: 'DELETE' }); notify('Deleted'); load(); }
    catch (e: any) { notify(e.message || 'Failed'); }
  }

  async function enrollEmployees() {
    if (!enrollModal) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { notify('Select at least one employee'); return; }
    setEnrolling(true);
    try {
      const r = await apiFetch(`/performance/cycles/${enrollModal.id}/enroll`, { method: 'POST', body: JSON.stringify({ employeeIds: ids }) });
      notify(`Enrolled ${r.enrolled}, skipped ${r.skipped}`);
      setEnrollModal(null); setSelectedIds(new Set()); load();
    } catch (e: any) { notify(e.message || 'Failed'); }
    finally { setEnrolling(false); }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="px-8 py-4 bg-violet-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 shadow-xl shadow-violet-500/20 transition-all active:scale-95">
          + New Appraisal Cycle
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-[2rem] p-10 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900 mb-6 uppercase tracking-tight">New Appraisal Cycle</h3>
            <div className="flex flex-col gap-4">
              <div>
                <label className="label-form mb-1 block">Cycle Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Annual Review 2026" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-form mb-1 block">Type *</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as CycleType }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600">
                    <option value="ANNUAL">Annual</option>
                    <option value="MID_YEAR">Mid-Year</option>
                    <option value="PROBATION">Probation</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
                <div></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-form mb-1 block">Start Date *</label>
                  <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
                </div>
                <div>
                  <label className="label-form mb-1 block">End Date *</label>
                  <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
                </div>
              </div>
              <div>
                <label className="label-form mb-1 block">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-8">
              <button onClick={() => setShowCreate(false)} className="px-6 py-3 border border-slate-200 rounded-xl text-[10px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-50">Cancel</button>
              <button onClick={createCycle} disabled={saving} className="px-8 py-3 bg-violet-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-60">
                {saving ? 'Creating…' : 'Create Cycle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enroll modal */}
      {enrollModal && (() => {
        const filtered = allEmployees.filter(e => {
          const q = enrollSearch.toLowerCase();
          return !q || e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q) || (e.department ?? '').toLowerCase().includes(q);
        });
        const allFilteredSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.id));
        return (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setEnrollModal(null)}>
            <div className="bg-white rounded-[2rem] p-8 w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Enroll Employees</h3>
              <p className="eyebrow-tight mt-1 mb-5">{enrollModal.name}</p>

              {/* Search */}
              <input
                value={enrollSearch}
                onChange={e => setEnrollSearch(e.target.value)}
                placeholder="Search by name, code, or department…"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600 mb-3"
              />

              {/* Select all row */}
              <div className="flex items-center justify-between px-1 mb-2">
                <button
                  type="button"
                  onClick={() => {
                    if (allFilteredSelected) {
                      setSelectedIds(prev => { const next = new Set(prev); filtered.forEach(e => next.delete(e.id)); return next; });
                    } else {
                      setSelectedIds(prev => { const next = new Set(prev); filtered.forEach(e => next.add(e.id)); return next; });
                    }
                  }}
                  className="text-[10px] font-black text-violet-600 uppercase tracking-widest hover:underline"
                >
                  {allFilteredSelected ? 'Deselect All' : 'Select All'}
                </button>
                <span className="eyebrow-tight">
                  {selectedIds.size} selected
                </span>
              </div>

              {/* Employee list */}
              <div className="flex-1 overflow-y-auto border border-slate-100 rounded-2xl divide-y divide-slate-50 min-h-0">
                {employeesLoading ? (
                  <div className="p-8 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest animate-pulse">Loading employees…</div>
                ) : filtered.length === 0 ? (
                  <div className="p-8 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">No employees found</div>
                ) : filtered.map(emp => {
                  const checked = selectedIds.has(emp.id);
                  return (
                    <label key={emp.id} className={`flex items-center gap-4 px-5 py-3 cursor-pointer transition-colors ${checked ? 'bg-violet-50' : 'hover:bg-slate-50'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedIds(prev => {
                            const next = new Set(prev);
                            checked ? next.delete(emp.id) : next.add(emp.id);
                            return next;
                          });
                        }}
                        className="w-4 h-4 rounded accent-violet-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-slate-900 truncate">{emp.fullName}</p>
                        <p className="label-form">{emp.employeeCode}{emp.department ? ` · ${emp.department}` : ''}</p>
                      </div>
                      {emp.designation && <span className="text-[9px] font-bold text-slate-400 truncate max-w-28">{emp.designation}</span>}
                    </label>
                  );
                })}
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-50">
                <button onClick={() => setEnrollModal(null)} className="px-6 py-3 border border-slate-200 rounded-xl text-[10px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-50">Cancel</button>
                <button onClick={enrollEmployees} disabled={enrolling || selectedIds.size === 0} className="px-8 py-3 bg-violet-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-50">
                  {enrolling ? 'Enrolling…' : `Enroll ${selectedIds.size > 0 ? `(${selectedIds.size})` : ''}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Cycle cards */}
      {loading ? (
        <div className="grid gap-4">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 bg-white rounded-[2rem] border border-slate-100 animate-pulse" />)}
        </div>
      ) : cycles.length === 0 ? (
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-16 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">
          No cycles yet — create one above
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {cycles.map(c => {
            const pct = Math.round((phaseIndex(c.currentPhase) / (PHASE_ORDER.length - 1)) * 100);
            return (
              <div key={c.id} className="bg-white rounded-[2rem] border border-slate-100 shadow-lg shadow-indigo-500/3 p-8">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest border ${c.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : c.status === 'COMPLETED' ? 'bg-slate-50 text-slate-500 border-slate-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{c.status}</span>
                      <span className="text-[9px] font-black text-slate-400 uppercase">{c.type}</span>
                    </div>
                    <h4 className="text-lg font-black text-slate-900">{c.name}</h4>
                    {c.description && <p className="text-[11px] text-slate-400 mt-1">{c.description}</p>}
                    <p className="eyebrow-tight mt-3">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</p>
                  </div>

                  <div className="flex flex-col gap-3 min-w-60">
                    <div className="flex items-center gap-2">
                      {PHASE_ORDER.map((ph, i) => (
                        <div key={ph} className="flex-1 flex flex-col items-center gap-1">
                          <div className={`w-full h-1.5 rounded-full ${i <= phaseIndex(c.currentPhase) ? 'bg-violet-600' : 'bg-slate-100'}`} />
                          {ph === c.currentPhase && <div className="w-1.5 h-1.5 bg-violet-600 rounded-full" />}
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] font-black text-violet-600 uppercase tracking-widest text-center">{PHASE_LABELS[c.currentPhase]}</p>
                    <p className="text-[9px] font-black text-slate-400 text-center">{c._count?.appraisals ?? 0} enrolled</p>
                  </div>

                  <div className="flex gap-2 flex-wrap lg:flex-col">
                    {c.status === 'DRAFT' && (
                      <button onClick={() => activate(c.id)} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all">
                        Activate
                      </button>
                    )}
                    {c.status === 'ACTIVE' && c.currentPhase !== 'COMPLETED' && (
                      <button onClick={() => advancePhase(c.id)} className="px-4 py-2 bg-violet-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-violet-700 transition-all">
                        Advance Phase
                      </button>
                    )}
                    <button onClick={() => openEnrollModal(c)} className="px-4 py-2 border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase tracking-widest hover:border-violet-600 hover:text-violet-600 transition-all">
                      Enroll
                    </button>
                    <button onClick={() => deleteCycle(c.id)} className="px-4 py-2 border border-red-200 rounded-xl text-[9px] font-black text-red-500 uppercase tracking-widest hover:bg-red-50 transition-all">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MY APPRAISAL TAB — employee's own workflow only, no admin actions
// Used by both employee-only view AND the admin/manager "My Appraisal" tab
// ─────────────────────────────────────────────────────────────────────────────
const STEP_LABELS: Record<AppraisalStatus, string> = {
  PENDING:           'Not started',
  SELF_SUBMITTED:    'Self-assessment submitted',
  MANAGER_SUBMITTED: 'Manager has reviewed',
  FINALISED:         'Appraisal finalised',
};

const STEP_ORDER: AppraisalStatus[] = ['PENDING', 'SELF_SUBMITTED', 'MANAGER_SUBMITTED', 'FINALISED'];

function stepIndex(s: AppraisalStatus) { return STEP_ORDER.indexOf(s); }

function MyAppraisalTab({ notify }: { notify: (m: string) => void }) {
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Appraisal | null>(null);
  const [form, setForm] = useState({ selfScore: 0, selfComments: '', strengths: '', improvements: '' });
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setAppraisals(await apiFetch('/performance/appraisals/me')); }
    catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  function select(a: Appraisal) {
    setSelected(a);
    setForm({
      selfScore:    a.selfScore    ?? 0,
      selfComments: a.selfComments ?? '',
      strengths:    a.strengths    ?? '',
      improvements: a.improvements ?? '',
    });
  }

  async function submitSelf() {
    if (!selected || !form.selfScore) { notify('Please select a rating before submitting'); return; }
    setSubmitting(true);
    try {
      const updated = await apiFetch(`/performance/appraisals/${selected.id}/self-submit`, {
        method: 'POST', body: JSON.stringify(form),
      });
      notify('Self-assessment submitted successfully');
      await reload();
      setSelected(updated);
    } catch (e: any) { notify(e.message || 'Submission failed'); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div className="h-40 bg-white rounded-[2rem] border border-slate-100 animate-pulse" />;

  if (appraisals.length === 0) {
    return (
      <div className="bg-white rounded-[2.5rem] border border-slate-100 p-16 text-center flex flex-col items-center gap-4">
        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-3xl">📋</div>
        <p className="eyebrow-tight">No appraisals yet</p>
        <p className="text-[11px] text-slate-300 font-medium">You have not been enrolled in any review cycle yet.<br />Contact your HR admin to get enrolled.</p>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Cycle list */}
      <div className="flex flex-col gap-3">
        <p className="label-form px-1 mb-1">Your Review Cycles</p>
        {appraisals.map(a => {
          const done = stepIndex(a.status);
          const isActive = a.status === 'PENDING' || a.status === 'SELF_SUBMITTED';
          return (
            <button key={a.id} onClick={() => select(a)}
              className={`w-full text-left bg-white p-5 rounded-2xl border transition-all ${selected?.id === a.id ? 'border-violet-500 shadow-lg shadow-violet-500/10 ring-1 ring-violet-500/20' : 'border-slate-100 hover:border-slate-200'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-slate-900 leading-tight">{a.cycle?.name ?? a.cycleId}</p>
                  <p className="label-form mt-1">{a.cycle?.type ?? ''}</p>
                </div>
                {isActive && <span className="w-2 h-2 bg-violet-500 rounded-full mt-1 animate-pulse shrink-0" />}
              </div>
              {/* Mini progress dots */}
              <div className="flex items-center gap-1.5 mt-3">
                {STEP_ORDER.map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= done ? 'bg-violet-500' : 'bg-slate-100'}`} />
                ))}
              </div>
              <p className="text-[9px] font-bold text-slate-400 mt-1.5">{STEP_LABELS[a.status]}</p>
            </button>
          );
        })}
      </div>

      {/* Detail panel */}
      <div className="lg:col-span-2">
        {!selected ? (
          <div className="bg-white rounded-[2rem] border border-slate-100 p-12 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">
            Select a cycle to view your appraisal
          </div>
        ) : (
          <div className="bg-white rounded-[2rem] border border-slate-100 overflow-hidden">
            {/* Cycle banner */}
            <div className="bg-gradient-to-r from-violet-600 to-indigo-600 p-8 text-white">
              <p className="text-[9px] font-black uppercase tracking-widest opacity-70 mb-1">{selected.cycle?.type ?? 'Review'}</p>
              <h3 className="text-xl font-black">{selected.cycle?.name}</h3>
              <p className="text-[10px] font-bold opacity-70 mt-1 uppercase tracking-wide">
                {fmtDate(selected.cycle?.startDate)} – {fmtDate(selected.cycle?.endDate)}
              </p>
            </div>

            <div className="p-8 flex flex-col gap-8">
              {/* Workflow progress */}
              <div>
                <p className="label-form mb-4">Progress</p>
                <div className="flex items-start gap-0">
                  {STEP_ORDER.map((step, i) => {
                    const done = stepIndex(selected.status);
                    const isCurrent = step === selected.status;
                    const isPast    = i < done;
                    const isFuture  = i > done;
                    return (
                      <div key={step} className="flex flex-col items-center flex-1">
                        <div className="flex items-center w-full">
                          {i > 0 && <div className={`flex-1 h-0.5 ${isPast || isCurrent ? 'bg-violet-500' : 'bg-slate-100'}`} />}
                          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-[11px] font-black shrink-0 transition-all
                            ${isPast    ? 'bg-violet-500 border-violet-500 text-white'
                            : isCurrent ? 'bg-white border-violet-500 text-violet-600 shadow-md shadow-violet-500/20'
                            : 'bg-white border-slate-200 text-slate-300'}`}>
                            {isPast ? '✓' : i + 1}
                          </div>
                          {i < 3 && <div className={`flex-1 h-0.5 ${isPast ? 'bg-violet-500' : 'bg-slate-100'}`} />}
                        </div>
                        <p className={`text-[8px] font-black uppercase tracking-wide mt-2 text-center max-w-16 leading-tight
                          ${isCurrent ? 'text-violet-600' : isPast ? 'text-slate-500' : 'text-slate-300'}`}>
                          {step.replace('_', ' ')}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Scores (visible once something has been submitted) */}
              {selected.status !== 'PENDING' && (
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-violet-50 rounded-2xl p-5 text-center border border-violet-100">
                    <p className="text-[9px] font-black text-violet-400 uppercase tracking-widest mb-2">Your Score</p>
                    <p className="text-3xl font-black text-violet-700">{selected.selfScore?.toFixed(1) ?? '—'}</p>
                    <p className="text-[8px] font-bold text-violet-400 mt-1">out of 5.0</p>
                  </div>
                  <div className={`rounded-2xl p-5 text-center border ${selected.managerScore ? 'bg-indigo-50 border-indigo-100' : 'bg-slate-50 border-slate-100'}`}>
                    <p className="label-form mb-2">Manager Score</p>
                    <p className={`text-3xl font-black ${selected.managerScore ? 'text-indigo-700' : 'text-slate-300'}`}>
                      {selected.managerScore?.toFixed(1) ?? '—'}
                    </p>
                    {!selected.managerScore && <p className="text-[8px] font-bold text-slate-300 mt-1">Pending review</p>}
                  </div>
                  <div className={`rounded-2xl p-5 text-center border ${selected.overallScore ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'}`}>
                    <p className="label-form mb-2">Final Score</p>
                    <p className={`text-3xl font-black ${selected.overallScore ? 'text-emerald-700' : 'text-slate-300'}`}>
                      {selected.overallScore?.toFixed(1) ?? '—'}
                    </p>
                    {!selected.overallScore && <p className="text-[8px] font-bold text-slate-300 mt-1">Not yet finalised</p>}
                  </div>
                </div>
              )}

              {/* ── Self-assessment form (PENDING or SELF_SUBMITTED = can update) ── */}
              {(selected.status === 'PENDING' || selected.status === 'SELF_SUBMITTED') && (
                <div className="flex flex-col gap-5 border-t border-slate-50 pt-6">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Self-Assessment</h4>
                    {selected.status === 'SELF_SUBMITTED' && (
                      <span className="text-[8px] font-black px-2 py-1 bg-amber-50 text-amber-600 border border-amber-200 rounded-lg uppercase tracking-widest">Submitted — you can update until manager reviews</span>
                    )}
                  </div>

                  <div>
                    <p className="label-form mb-3">Your Overall Rating *</p>
                    <StarRating value={form.selfScore} onChange={v => setForm(f => ({ ...f, selfScore: v }))} />
                    <p className="text-[8px] font-bold text-slate-300 mt-2">1 = Needs improvement · 3 = Meets expectations · 5 = Exceptional</p>
                  </div>

                  <div>
                    <label className="label-form mb-1 block">Key Achievements & Highlights</label>
                    <textarea value={form.selfComments} onChange={e => setForm(f => ({ ...f, selfComments: e.target.value }))}
                      rows={4} placeholder="Describe your key contributions, wins, and achievements this period…"
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500 resize-none placeholder:text-slate-300" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label-form mb-1 block">Strengths</label>
                      <textarea value={form.strengths} onChange={e => setForm(f => ({ ...f, strengths: e.target.value }))}
                        rows={3} placeholder="What did you do really well?"
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500 resize-none placeholder:text-slate-300" />
                    </div>
                    <div>
                      <label className="label-form mb-1 block">Development Areas</label>
                      <textarea value={form.improvements} onChange={e => setForm(f => ({ ...f, improvements: e.target.value }))}
                        rows={3} placeholder="What would you like to develop or improve?"
                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-500 resize-none placeholder:text-slate-300" />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button onClick={submitSelf} disabled={submitting || !form.selfScore}
                      className="px-10 py-4 bg-violet-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 shadow-xl shadow-violet-500/20 disabled:opacity-40 transition-all active:scale-95">
                      {submitting ? 'Submitting…' : selected.status === 'SELF_SUBMITTED' ? 'Update Submission' : 'Submit Self-Assessment'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Read-only view of own submission after manager has reviewed ── */}
              {selected.status !== 'PENDING' && selected.selfComments && (
                <div className="border-t border-slate-50 pt-6 flex flex-col gap-4">
                  <h4 className="label-form">Your Submission</h4>
                  <div className="bg-slate-50 rounded-2xl p-5 flex flex-col gap-3">
                    <p className="text-sm text-slate-700 leading-relaxed">{selected.selfComments}</p>
                    {selected.strengths && (
                      <div>
                        <p className="label-form mb-1">Strengths</p>
                        <p className="text-sm text-slate-600">{selected.strengths}</p>
                      </div>
                    )}
                    {selected.improvements && (
                      <div>
                        <p className="label-form mb-1">Development Areas</p>
                        <p className="text-sm text-slate-600">{selected.improvements}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Manager feedback (only shown once manager has submitted) ── */}
              {selected.managerComments && (
                <div className="border-t border-slate-50 pt-6">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center text-[10px]">👤</div>
                    <h4 className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">Manager Feedback</h4>
                  </div>
                  <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
                    <p className="text-sm text-slate-700 leading-relaxed">{selected.managerComments}</p>
                  </div>
                </div>
              )}

              {/* ── Waiting message when self-submitted, no manager review yet ── */}
              {selected.status === 'SELF_SUBMITTED' && !selected.managerScore && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex items-center gap-4">
                  <div className="w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center text-base shrink-0">⏳</div>
                  <div>
                    <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Waiting for manager review</p>
                    <p className="text-[11px] text-amber-600 mt-0.5">Your self-assessment has been submitted. Your manager will review it shortly.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM REVIEWS TAB (manager view)
// ─────────────────────────────────────────────────────────────────────────────
function TeamTab({ notify }: { notify: (m: string) => void }) {
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Appraisal | null>(null);
  const [form, setForm] = useState({ managerScore: 0, managerComments: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAppraisals(await apiFetch('/performance/appraisals/team')); }
    catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitManager() {
    if (!selected || !form.managerScore) { notify('Select a score'); return; }
    setSubmitting(true);
    try {
      await apiFetch(`/performance/appraisals/${selected.id}/manager-submit`, {
        method: 'POST', body: JSON.stringify(form),
      });
      notify('Manager review submitted'); load();
      setSelected(null);
    } catch (e: any) { notify(e.message || 'Failed'); }
    finally { setSubmitting(false); }
  }

  async function finalise(id: string) {
    try { await apiFetch(`/performance/appraisals/${id}/finalise`, { method: 'POST' }); notify('Appraisal finalised'); load(); }
    catch (e: any) { notify(e.message || 'Failed'); }
  }

  if (loading) return <div className="h-40 bg-white rounded-[2rem] border border-slate-100 animate-pulse" />;

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="flex flex-col gap-3">
        {appraisals.length === 0 ? (
          <div className="bg-white rounded-[2rem] border border-slate-100 p-10 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">
            No team appraisals assigned
          </div>
        ) : appraisals.map(a => (
          <button key={a.id} onClick={() => { setSelected(a); setForm({ managerScore: a.managerScore ?? 0, managerComments: a.managerComments ?? '' }); }}
            className={`w-full text-left bg-white p-6 rounded-2xl border transition-all ${selected?.id === a.id ? 'border-violet-600 shadow-lg shadow-violet-500/10' : 'border-slate-100 hover:border-slate-200'}`}>
            <p className="label-form">EMP: {a.employeeId.slice(0, 8)}…</p>
            <p className="text-sm font-black text-slate-900 mt-1">{a.cycle?.name ?? a.cycleId}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase ${STATUS_COLORS[a.status]}`}>{a.status.replace('_', ' ')}</span>
              {a.selfScore && scoreBadge(a.selfScore)}
            </div>
          </button>
        ))}
      </div>

      <div className="lg:col-span-2">
        {!selected ? (
          <div className="bg-white rounded-[2rem] border border-slate-100 p-12 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">
            Select an appraisal to review
          </div>
        ) : (
          <div className="bg-white rounded-[2rem] border border-slate-100 p-8 flex flex-col gap-6">
            <div>
              <p className="label-form">Employee: {selected.employeeId}</p>
              <h3 className="text-xl font-black text-slate-900 mt-1">{selected.cycle?.name}</h3>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-50 rounded-2xl p-4 text-center">
                <p className="label-form mb-2">Self Score</p>
                <p className="text-2xl font-black text-indigo-600">{selected.selfScore?.toFixed(1) ?? '—'}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-4 text-center">
                <p className="label-form mb-2">Mgr Score</p>
                <p className="text-2xl font-black text-violet-600">{selected.managerScore?.toFixed(1) ?? '—'}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-4 text-center">
                <p className="label-form mb-2">Overall</p>
                <p className="text-2xl font-black text-emerald-600">{selected.overallScore?.toFixed(1) ?? '—'}</p>
              </div>
            </div>

            {selected.selfComments && (
              <div>
                <h4 className="label-form mb-2">Employee&apos;s Self-Assessment</h4>
                <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-4">{selected.selfComments}</p>
                {selected.strengths && <p className="text-sm text-slate-500 mt-2"><strong className="text-[9px] uppercase tracking-widest">Strengths:</strong> {selected.strengths}</p>}
                {selected.improvements && <p className="text-sm text-slate-500 mt-1"><strong className="text-[9px] uppercase tracking-widest">Improvements:</strong> {selected.improvements}</p>}
              </div>
            )}

            {selected.status === 'SELF_SUBMITTED' && (
              <div className="flex flex-col gap-4 border-t border-slate-50 pt-6">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Manager Review</h4>
                <div>
                  <p className="label-form mb-2">Manager Rating *</p>
                  <StarRating value={form.managerScore} onChange={v => setForm(f => ({ ...f, managerScore: v }))} />
                </div>
                <div>
                  <label className="label-form mb-1 block">Manager Feedback</label>
                  <textarea value={form.managerComments} onChange={e => setForm(f => ({ ...f, managerComments: e.target.value }))} rows={4} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-600 resize-none" />
                </div>
                <div className="flex justify-end">
                  <button onClick={submitManager} disabled={submitting || !form.managerScore} className="px-8 py-3 bg-violet-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 shadow-lg shadow-violet-500/20 disabled:opacity-50">
                    {submitting ? 'Submitting…' : 'Submit Manager Review'}
                  </button>
                </div>
              </div>
            )}

            {selected.status === 'MANAGER_SUBMITTED' && (
              <div className="flex justify-end border-t border-slate-50 pt-6">
                <button onClick={() => finalise(selected.id)} className="px-8 py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-500/20">
                  Finalise Appraisal
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GOALS TAB
// ─────────────────────────────────────────────────────────────────────────────
function GoalsTab({ notify }: { notify: (m: string) => void }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', targetDate: '', category: 'PERFORMANCE' as GoalCategory });
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [editProgress, setEditProgress] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try { setGoals(await apiFetch('/performance/goals')); }
    catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createGoal() {
    if (!form.title) { notify('Title is required'); return; }
    setSaving(true);
    try {
      await apiFetch('/performance/goals', { method: 'POST', body: JSON.stringify(form) });
      notify('Goal created'); setShowCreate(false); setForm({ title: '', description: '', targetDate: '', category: 'PERFORMANCE' }); load();
    } catch (e: any) { notify(e.message || 'Failed'); }
    finally { setSaving(false); }
  }

  async function updateProgress(goal: Goal) {
    try {
      await apiFetch(`/performance/goals/${goal.id}`, { method: 'PUT', body: JSON.stringify({ progress: editProgress, status: editProgress === 100 ? 'ACHIEVED' : goal.status }) });
      notify('Progress updated'); setEditGoal(null); load();
    } catch (e: any) { notify(e.message || 'Failed'); }
  }

  async function updateStatus(id: string, status: GoalStatus) {
    try { await apiFetch(`/performance/goals/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); notify(`Marked ${status.toLowerCase()}`); load(); }
    catch (e: any) { notify(e.message || 'Failed'); }
  }

  async function deleteGoal(id: string) {
    if (!confirm('Delete this goal?')) return;
    try { await apiFetch(`/performance/goals/${id}`, { method: 'DELETE' }); notify('Deleted'); load(); }
    catch (e: any) { notify(e.message || 'Failed'); }
  }

  const CAT_COLORS: Record<GoalCategory, string> = {
    PERFORMANCE: 'bg-indigo-50 text-indigo-700', DEVELOPMENT: 'bg-violet-50 text-violet-700', ORGANIZATIONAL: 'bg-emerald-50 text-emerald-700',
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)} className="px-8 py-4 bg-violet-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 shadow-xl shadow-violet-500/20 transition-all active:scale-95">
          + Add Goal
        </button>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-[2rem] p-10 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900 mb-6 uppercase tracking-tight">New Goal</h3>
            <div className="flex flex-col gap-4">
              <div>
                <label className="label-form mb-1 block">Title *</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Goal title" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
              </div>
              <div>
                <label className="label-form mb-1 block">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-form mb-1 block">Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as GoalCategory }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600">
                    <option value="PERFORMANCE">Performance</option>
                    <option value="DEVELOPMENT">Development</option>
                    <option value="ORGANIZATIONAL">Organizational</option>
                  </select>
                </div>
                <div>
                  <label className="label-form mb-1 block">Target Date</label>
                  <input type="date" value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-8">
              <button onClick={() => setShowCreate(false)} className="px-6 py-3 border border-slate-200 rounded-xl text-[10px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-50">Cancel</button>
              <button onClick={createGoal} disabled={saving} className="px-8 py-3 bg-violet-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-60">
                {saving ? 'Saving…' : 'Create Goal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-white rounded-2xl border border-slate-100 animate-pulse" />)}</div>
      ) : goals.length === 0 ? (
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-16 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">No goals yet</div>
      ) : (
        <div className="grid gap-4">
          {goals.map(g => (
            <div key={g.id} className="bg-white rounded-[2rem] border border-slate-100 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg uppercase tracking-widest ${CAT_COLORS[g.category]}`}>{g.category}</span>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg uppercase tracking-widest ${g.status === 'ACHIEVED' ? 'bg-emerald-50 text-emerald-700' : g.status === 'MISSED' ? 'bg-red-50 text-red-700' : g.status === 'CANCELLED' ? 'bg-slate-100 text-slate-400' : 'bg-amber-50 text-amber-700'}`}>{g.status}</span>
                  </div>
                  <h4 className="text-base font-black text-slate-900">{g.title}</h4>
                  {g.description && <p className="text-[11px] text-slate-400 mt-1">{g.description}</p>}
                  {g.targetDate && <p className="label-form mt-2">Target: {fmtDate(g.targetDate)}</p>}

                  {/* Progress bar */}
                  <div className="flex items-center gap-3 mt-3">
                    {editGoal?.id === g.id ? (
                      <div className="flex items-center gap-3 flex-1">
                        <input type="range" min={0} max={100} value={editProgress} onChange={e => setEditProgress(Number(e.target.value))} className="flex-1" />
                        <span className="text-[10px] font-black text-slate-600 w-10">{editProgress}%</span>
                        <button onClick={() => updateProgress(g)} className="px-4 py-1.5 bg-violet-600 text-white rounded-lg text-[9px] font-black uppercase">Save</button>
                        <button onClick={() => setEditGoal(null)} className="px-4 py-1.5 border border-slate-200 rounded-lg text-[9px] font-black text-slate-400 uppercase">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden max-w-48">
                          <div className={`h-full rounded-full transition-all ${g.progress === 100 ? 'bg-emerald-500' : 'bg-violet-600'}`} style={{ width: `${g.progress}%` }} />
                        </div>
                        <span className="text-[10px] font-black text-slate-500">{g.progress}%</span>
                        {g.status === 'ACTIVE' && (
                          <button onClick={() => { setEditGoal(g); setEditProgress(g.progress); }} className="text-[9px] font-black text-violet-600 hover:underline">Update</button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  {g.status === 'ACTIVE' && (
                    <>
                      <button onClick={() => updateStatus(g.id, 'ACHIEVED')} className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-[9px] font-black uppercase hover:bg-emerald-100">Done</button>
                      <button onClick={() => updateStatus(g.id, 'CANCELLED')} className="px-3 py-1.5 bg-slate-50 border border-slate-200 text-slate-400 rounded-lg text-[9px] font-black uppercase hover:bg-slate-100">Cancel</button>
                    </>
                  )}
                  <button onClick={() => deleteGoal(g.id)} className="px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 rounded-lg text-[9px] font-black uppercase hover:bg-red-100">Del</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PIP TAB
// ─────────────────────────────────────────────────────────────────────────────
function PipTab({ notify }: { notify: (m: string) => void }) {
  const [pips, setPips] = useState<PipRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employeeId: '', startDate: '', endDate: '', objectives: '' });
  const [selected, setSelected] = useState<PipRecord | null>(null);
  const [notes, setNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPips(await apiFetch('/performance/pips')); }
    catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createPip() {
    if (!form.employeeId || !form.startDate || !form.endDate || !form.objectives) { notify('All fields are required'); return; }
    setSaving(true);
    try {
      await apiFetch('/performance/pips', { method: 'POST', body: JSON.stringify(form) });
      notify('PIP created'); setShowCreate(false); setForm({ employeeId: '', startDate: '', endDate: '', objectives: '' }); load();
    } catch (e: any) { notify(e.message || 'Failed'); }
    finally { setSaving(false); }
  }

  async function updatePip(id: string, data: Partial<PipRecord>) {
    setUpdatingStatus(true);
    try {
      const updated = await apiFetch(`/performance/pips/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      notify('PIP updated'); setSelected(updated); load();
    } catch (e: any) { notify(e.message || 'Failed'); }
    finally { setUpdatingStatus(false); }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Create + list */}
      <div className="flex flex-col gap-4">
        <button onClick={() => setShowCreate(true)} className="px-6 py-4 bg-violet-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 shadow-xl shadow-violet-500/20 transition-all active:scale-95">
          + New PIP
        </button>

        {loading ? (
          <div className="h-32 bg-white rounded-2xl border border-slate-100 animate-pulse" />
        ) : pips.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">No PIPs</div>
        ) : pips.map(p => (
          <button key={p.id} onClick={() => { setSelected(p); setNotes(p.progressNotes ?? ''); }}
            className={`w-full text-left bg-white p-5 rounded-2xl border transition-all ${selected?.id === p.id ? 'border-violet-600 shadow-lg shadow-violet-500/10' : 'border-slate-100 hover:border-slate-200'}`}>
            <p className="label-form">EMP: {p.employeeId.slice(0, 12)}…</p>
            <div className="flex items-center justify-between mt-2">
              <p className="text-[10px] font-black text-slate-600 uppercase">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</p>
              <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border uppercase ${PIP_COLORS[p.status]}`}>{p.status}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Detail */}
      <div className="lg:col-span-2">
        {!selected ? (
          <div className="bg-white rounded-[2rem] border border-slate-100 p-12 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">
            Select a PIP to view
          </div>
        ) : (
          <div className="bg-white rounded-[2rem] border border-slate-100 p-8 flex flex-col gap-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="label-form">Employee ID: {selected.employeeId}</p>
                <p className="label-form mt-1">Period: {fmtDate(selected.startDate)} – {fmtDate(selected.endDate)}</p>
              </div>
              <span className={`text-[9px] font-black px-3 py-1.5 rounded-xl border ${PIP_COLORS[selected.status]}`}>{selected.status}</span>
            </div>

            <div>
              <h4 className="label-form mb-2">Objectives</h4>
              <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-4 leading-relaxed">{selected.objectives}</p>
            </div>

            <div>
              <h4 className="label-form mb-2">Progress Notes</h4>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} placeholder="Add progress notes…" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-600 resize-none" />
              <div className="flex justify-end mt-2">
                <button onClick={() => updatePip(selected.id, { progressNotes: notes })} disabled={updatingStatus} className="px-6 py-2 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-indigo-600 transition-all disabled:opacity-50">
                  Save Notes
                </button>
              </div>
            </div>

            {selected.status === 'ACTIVE' && (
              <div className="flex gap-3 border-t border-slate-50 pt-6 flex-wrap">
                <button onClick={() => updatePip(selected.id, { status: 'COMPLETED' })} className="px-6 py-3 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-500/20">Mark Completed</button>
                <button onClick={() => updatePip(selected.id, { status: 'EXTENDED' })} className="px-6 py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 shadow-lg shadow-amber-500/20">Extend</button>
                <button onClick={() => updatePip(selected.id, { status: 'TERMINATED' })} className="px-6 py-3 border border-red-200 text-red-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-50">Terminate</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-[2rem] p-10 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-black text-slate-900 mb-6 uppercase tracking-tight">New PIP</h3>
            <div className="flex flex-col gap-4">
              <div>
                <label className="label-form mb-1 block">Employee ID *</label>
                <input value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} placeholder="emp-..." className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label-form mb-1 block">Start Date *</label>
                  <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
                </div>
                <div>
                  <label className="label-form mb-1 block">End Date *</label>
                  <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
                </div>
              </div>
              <div>
                <label className="label-form mb-1 block">Objectives *</label>
                <textarea value={form.objectives} onChange={e => setForm(f => ({ ...f, objectives: e.target.value }))} rows={4} placeholder="Describe measurable objectives and expectations…" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600 resize-none" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-8">
              <button onClick={() => setShowCreate(false)} className="px-6 py-3 border border-slate-200 rounded-xl text-[10px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-50">Cancel</button>
              <button onClick={createPip} disabled={saving} className="px-8 py-3 bg-violet-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-60">
                {saving ? 'Creating…' : 'Create PIP'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
