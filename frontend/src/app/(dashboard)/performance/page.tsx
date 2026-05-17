'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';

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
type Tab = 'overview' | 'cycles' | 'myreview' | 'team' | 'goals' | 'pip';

export default function PerformancePage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [toast, setToast] = useState('');

  function notify(msg: string) { setToast(msg); }

  return (
    <div className="flex flex-col gap-8 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
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
        {([
          ['overview', 'Overview'],
          ['cycles',   'Cycles'],
          ['myreview', 'My Review'],
          ['team',     'Team Reviews'],
          ['goals',    'Goals'],
          ['pip',      'PIP'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${tab === key ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20' : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview'  && <OverviewTab notify={notify} />}
      {tab === 'cycles'    && <CyclesTab notify={notify} />}
      {tab === 'myreview'  && <MyReviewTab notify={notify} />}
      {tab === 'team'      && <TeamTab notify={notify} />}
      {tab === 'goals'     && <GoalsTab notify={notify} />}
      {tab === 'pip'       && <PipTab notify={notify} />}

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

  useEffect(() => {
    apiFetch('/performance/summary').then(setSummary).catch(() => {});
    apiFetch('/performance/cycles?status=ACTIVE').then(setCycles).catch(() => {});
  }, []);

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
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">{k.label}</p>
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
              <thead className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                <tr>
                  <th className="px-8 py-5">Cycle</th>
                  <th className="px-8 py-5">Type</th>
                  <th className="px-8 py-5">Period</th>
                  <th className="px-8 py-5">Current Phase</th>
                  <th className="px-8 py-5">Progress</th>
                  <th className="px-8 py-5">Enrolled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {cycles.map(c => {
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
function CyclesTab({ notify }: { notify: (m: string) => void }) {
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'ANNUAL' as CycleType, startDate: '', endDate: '', description: '' });
  const [enrollModal, setEnrollModal] = useState<ReviewCycle | null>(null);
  const [enrollIds, setEnrollIds] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCycles(await apiFetch('/performance/cycles')); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

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
    const ids = enrollIds.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) { notify('Enter at least one employee ID'); return; }
    setEnrolling(true);
    try {
      const r = await apiFetch(`/performance/cycles/${enrollModal.id}/enroll`, { method: 'POST', body: JSON.stringify({ employeeIds: ids }) });
      notify(`Enrolled ${r.enrolled}, skipped ${r.skipped}`);
      setEnrollModal(null); setEnrollIds(''); load();
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
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Cycle Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Annual Review 2026" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Type *</label>
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
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Start Date *</label>
                  <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">End Date *</label>
                  <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Description</label>
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
      {enrollModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6" onClick={() => setEnrollModal(null)}>
          <div className="bg-white rounded-[2rem] p-10 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900 mb-2 uppercase tracking-tight">Enroll Employees</h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">{enrollModal.name}</p>
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Employee IDs (comma or newline separated)</label>
            <textarea value={enrollIds} onChange={e => setEnrollIds(e.target.value)} rows={5} placeholder="emp-001&#10;emp-002&#10;emp-003" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold font-mono outline-none focus:border-violet-600 resize-none" />
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setEnrollModal(null)} className="px-6 py-3 border border-slate-200 rounded-xl text-[10px] font-black text-slate-500 uppercase tracking-widest hover:bg-slate-50">Cancel</button>
              <button onClick={enrollEmployees} disabled={enrolling} className="px-8 py-3 bg-violet-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 disabled:opacity-60">
                {enrolling ? 'Enrolling…' : 'Enroll'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-3">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</p>
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
                    <button onClick={() => setEnrollModal(c)} className="px-4 py-2 border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase tracking-widest hover:border-violet-600 hover:text-violet-600 transition-all">
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
// MY REVIEW TAB (employee self-assessment)
// ─────────────────────────────────────────────────────────────────────────────
function MyReviewTab({ notify }: { notify: (m: string) => void }) {
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Appraisal | null>(null);
  const [form, setForm] = useState({ selfScore: 0, selfComments: '', strengths: '', improvements: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch('/performance/appraisals/me')
      .then(data => { setAppraisals(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function submitSelf() {
    if (!selected || !form.selfScore) { notify('Please select a score'); return; }
    setSubmitting(true);
    try {
      await apiFetch(`/performance/appraisals/${selected.id}/self-submit`, {
        method: 'POST', body: JSON.stringify(form),
      });
      notify('Self-assessment submitted');
      const updated = await apiFetch('/performance/appraisals/me');
      setAppraisals(updated);
      const refreshed = updated.find((a: Appraisal) => a.id === selected.id);
      if (refreshed) setSelected(refreshed);
    } catch (e: any) { notify(e.message || 'Failed'); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div className="h-40 bg-white rounded-[2rem] border border-slate-100 animate-pulse" />;

  if (appraisals.length === 0) {
    return (
      <div className="bg-white rounded-[2.5rem] border border-slate-100 p-16 text-center">
        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">You have not been enrolled in any review cycle yet.</p>
        <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mt-2">Contact your HR admin to get enrolled.</p>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* List */}
      <div className="flex flex-col gap-3">
        {appraisals.map(a => (
          <button key={a.id} onClick={() => { setSelected(a); setForm({ selfScore: a.selfScore ?? 0, selfComments: a.selfComments ?? '', strengths: a.strengths ?? '', improvements: a.improvements ?? '' }); }}
            className={`w-full text-left bg-white p-6 rounded-2xl border transition-all ${selected?.id === a.id ? 'border-violet-600 shadow-lg shadow-violet-500/10' : 'border-slate-100 hover:border-slate-200'}`}>
            <p className="text-sm font-black text-slate-900">{a.cycle?.name ?? a.cycleId}</p>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">{a.cycle?.type ?? ''}</p>
            <div className="mt-3">
              <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase ${STATUS_COLORS[a.status]}`}>{a.status.replace('_', ' ')}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Detail / form */}
      <div className="lg:col-span-2">
        {!selected ? (
          <div className="bg-white rounded-[2rem] border border-slate-100 p-12 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">
            Select a review to view or submit
          </div>
        ) : (
          <div className="bg-white rounded-[2rem] border border-slate-100 p-8 flex flex-col gap-6">
            <div>
              <h3 className="text-xl font-black text-slate-900">{selected.cycle?.name}</h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                {PHASE_LABELS[selected.cycle?.currentPhase ?? 'SELF_ASSESSMENT']} · {fmtDate(selected.cycle?.startDate)} – {fmtDate(selected.cycle?.endDate)}
              </p>
            </div>

            {/* Status timeline */}
            <div className="flex gap-3 items-center">
              {(['PENDING', 'SELF_SUBMITTED', 'MANAGER_SUBMITTED', 'FINALISED'] as AppraisalStatus[]).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full border-2 ${['SELF_SUBMITTED', 'MANAGER_SUBMITTED', 'FINALISED'].includes(selected.status) && i > 0 ? 'bg-violet-600 border-violet-600' : selected.status === s ? 'bg-violet-600 border-violet-600' : 'bg-white border-slate-200'}`} />
                  <span className="text-[8px] font-black text-slate-400 uppercase hidden sm:block">{s.replace('_', ' ')}</span>
                  {i < 3 && <div className="w-8 h-px bg-slate-100" />}
                </div>
              ))}
            </div>

            {/* Scores display if submitted */}
            {selected.status !== 'PENDING' && (
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-2xl p-4 text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Self Score</p>
                  <p className="text-2xl font-black text-indigo-600">{selected.selfScore?.toFixed(1) ?? '—'}</p>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4 text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Manager Score</p>
                  <p className="text-2xl font-black text-violet-600">{selected.managerScore?.toFixed(1) ?? '—'}</p>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4 text-center">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Overall</p>
                  <p className="text-2xl font-black text-emerald-600">{selected.overallScore?.toFixed(1) ?? '—'}</p>
                </div>
              </div>
            )}

            {/* Self-assessment form */}
            {(selected.status === 'PENDING' || selected.status === 'SELF_SUBMITTED') && (
              <div className="flex flex-col gap-5 border-t border-slate-50 pt-6">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Self-Assessment</h4>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Overall Rating *</p>
                  <StarRating value={form.selfScore} onChange={v => setForm(f => ({ ...f, selfScore: v }))} />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Key Achievements & Comments</label>
                  <textarea value={form.selfComments} onChange={e => setForm(f => ({ ...f, selfComments: e.target.value }))} rows={3} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-600 resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Strengths</label>
                    <textarea value={form.strengths} onChange={e => setForm(f => ({ ...f, strengths: e.target.value }))} rows={3} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-600 resize-none" />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Areas for Improvement</label>
                    <textarea value={form.improvements} onChange={e => setForm(f => ({ ...f, improvements: e.target.value }))} rows={3} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-violet-600 resize-none" />
                  </div>
                </div>
                <div className="flex justify-end">
                  <button onClick={submitSelf} disabled={submitting || !form.selfScore} className="px-8 py-3 bg-violet-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700 shadow-lg shadow-violet-500/20 disabled:opacity-50 transition-all">
                    {submitting ? 'Submitting…' : 'Submit Self-Assessment'}
                  </button>
                </div>
              </div>
            )}

            {/* Submitted view */}
            {selected.status !== 'PENDING' && selected.selfComments && (
              <div className="border-t border-slate-50 pt-6 flex flex-col gap-3">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Your Assessment</h4>
                <p className="text-sm text-slate-600">{selected.selfComments}</p>
                {selected.strengths && <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Strengths</p><p className="text-sm text-slate-600 mt-1">{selected.strengths}</p></div>}
                {selected.improvements && <div><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Improvements</p><p className="text-sm text-slate-600 mt-1">{selected.improvements}</p></div>}
              </div>
            )}
            {selected.managerComments && (
              <div className="border-t border-slate-50 pt-6">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Manager Feedback</h4>
                <p className="text-sm text-slate-600">{selected.managerComments}</p>
              </div>
            )}
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
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">EMP: {a.employeeId.slice(0, 8)}…</p>
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
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Employee: {selected.employeeId}</p>
              <h3 className="text-xl font-black text-slate-900 mt-1">{selected.cycle?.name}</h3>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-50 rounded-2xl p-4 text-center">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Self Score</p>
                <p className="text-2xl font-black text-indigo-600">{selected.selfScore?.toFixed(1) ?? '—'}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-4 text-center">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Mgr Score</p>
                <p className="text-2xl font-black text-violet-600">{selected.managerScore?.toFixed(1) ?? '—'}</p>
              </div>
              <div className="bg-slate-50 rounded-2xl p-4 text-center">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Overall</p>
                <p className="text-2xl font-black text-emerald-600">{selected.overallScore?.toFixed(1) ?? '—'}</p>
              </div>
            </div>

            {selected.selfComments && (
              <div>
                <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Employee's Self-Assessment</h4>
                <p className="text-sm text-slate-600 bg-slate-50 rounded-xl p-4">{selected.selfComments}</p>
                {selected.strengths && <p className="text-sm text-slate-500 mt-2"><strong className="text-[9px] uppercase tracking-widest">Strengths:</strong> {selected.strengths}</p>}
                {selected.improvements && <p className="text-sm text-slate-500 mt-1"><strong className="text-[9px] uppercase tracking-widest">Improvements:</strong> {selected.improvements}</p>}
              </div>
            )}

            {selected.status === 'SELF_SUBMITTED' && (
              <div className="flex flex-col gap-4 border-t border-slate-50 pt-6">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Manager Review</h4>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Manager Rating *</p>
                  <StarRating value={form.managerScore} onChange={v => setForm(f => ({ ...f, managerScore: v }))} />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Manager Feedback</label>
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
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Title *</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Goal title" className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as GoalCategory }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600">
                    <option value="PERFORMANCE">Performance</option>
                    <option value="DEVELOPMENT">Development</option>
                    <option value="ORGANIZATIONAL">Organizational</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Target Date</label>
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
                  {g.targetDate && <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-2">Target: {fmtDate(g.targetDate)}</p>}

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
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">EMP: {p.employeeId.slice(0, 12)}…</p>
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
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Employee ID: {selected.employeeId}</p>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Period: {fmtDate(selected.startDate)} – {fmtDate(selected.endDate)}</p>
              </div>
              <span className={`text-[9px] font-black px-3 py-1.5 rounded-xl border ${PIP_COLORS[selected.status]}`}>{selected.status}</span>
            </div>

            <div>
              <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Objectives</h4>
              <p className="text-sm text-slate-700 bg-slate-50 rounded-xl p-4 leading-relaxed">{selected.objectives}</p>
            </div>

            <div>
              <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Progress Notes</h4>
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
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Employee ID *</label>
                <input value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} placeholder="emp-..." className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Start Date *</label>
                  <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
                </div>
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">End Date *</label>
                  <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-violet-600" />
                </div>
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Objectives *</label>
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
