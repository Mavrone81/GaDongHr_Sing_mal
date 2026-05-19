'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

// ── Types ─────────────────────────────────────────────────────────────────────
type ProgramStatus   = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
type ProgramCategory = 'COMPLIANCE' | 'TECHNICAL' | 'SOFT_SKILLS' | 'LEADERSHIP' | 'ONBOARDING' | 'SAFETY';
type MaterialType    = 'VIDEO' | 'DOCUMENT' | 'QUIZ' | 'LINK';
type EnrollmentStatus = 'ENROLLED' | 'IN_PROGRESS' | 'COMPLETED' | 'DROPPED';

interface TrainingProgram {
  id: string; title: string; description?: string; category: ProgramCategory;
  status: ProgramStatus; durationMins?: number; passingScore?: number;
  isMandatory: boolean; createdBy: string; createdAt: string;
  _count?: { materials: number; enrollments: number };
  materials?: TrainingMaterial[];
  enrollments?: { id: string; status: EnrollmentStatus; progress: number }[];
}

interface TrainingMaterial {
  id: string; programId: string; title: string; type: MaterialType;
  url?: string; content?: string; orderIndex: number; durationMins?: number;
}

interface TrainingEnrollment {
  id: string; programId: string; employeeId: string; status: EnrollmentStatus;
  progress: number; score?: number; dueDate?: string;
  enrolledAt: string; startedAt?: string; completedAt?: string;
  program?: TrainingProgram;
}

interface Stats {
  totalPrograms: number; published: number; mandatory: number;
  totalEnrollments: number; completed: number; inProgress: number; completionRate: number;
  byCategory: { category: ProgramCategory; _count: { id: number } }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<ProgramCategory, string> = {
  COMPLIANCE: 'Compliance', TECHNICAL: 'Technical', SOFT_SKILLS: 'Soft Skills',
  LEADERSHIP: 'Leadership', ONBOARDING: 'Onboarding', SAFETY: 'Safety',
};

const CATEGORY_COLORS: Record<ProgramCategory, string> = {
  COMPLIANCE: 'bg-red-50 text-red-700 border-red-200',
  TECHNICAL:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  SOFT_SKILLS:'bg-pink-50 text-pink-700 border-pink-200',
  LEADERSHIP: 'bg-purple-50 text-purple-700 border-purple-200',
  ONBOARDING: 'bg-amber-50 text-amber-700 border-amber-200',
  SAFETY:     'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const STATUS_COLORS: Record<ProgramStatus, string> = {
  DRAFT:     'bg-slate-100 text-slate-500',
  PUBLISHED: 'bg-emerald-50 text-emerald-700',
  ARCHIVED:  'bg-slate-50 text-slate-400',
};

const ENR_COLORS: Record<EnrollmentStatus, string> = {
  ENROLLED:    'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-amber-50 text-amber-700',
  COMPLETED:   'bg-emerald-50 text-emerald-700',
  DROPPED:     'bg-red-50 text-red-600',
};

const MATERIAL_ICONS: Record<MaterialType, string> = {
  VIDEO: '▶', DOCUMENT: '📄', QUIZ: '✏️', LINK: '🔗',
};

function fmtDuration(mins?: number) {
  if (!mins) return null;
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? (mins % 60) + 'm' : ''}`.trim();
}

function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ProgressBar({ pct, color = 'bg-amber-500' }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Shared: Program Card (employee browse view) ───────────────────────────────
function ProgramCard({ prog, onEnroll }: { prog: TrainingProgram; onEnroll: (id: string) => void }) {
  const [enrolling, setEnrolling] = useState(false);
  const enrolled = prog.enrollments?.[0];

  async function handleEnroll() {
    setEnrolling(true);
    await onEnroll(prog.id);
    setEnrolling(false);
  }

  return (
    <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 p-6 flex flex-col gap-4 hover:shadow-2xl transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-black text-slate-900 leading-tight">{prog.title}</h3>
          {prog.description && <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2">{prog.description}</p>}
        </div>
        {prog.isMandatory && (
          <span className="shrink-0 text-[8px] font-black px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full uppercase tracking-widest">Required</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[prog.category]}`}>
          {CATEGORY_LABELS[prog.category]}
        </span>
        {prog.durationMins && (
          <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-200">
            {fmtDuration(prog.durationMins)}
          </span>
        )}
        {prog.passingScore && (
          <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-200">
            Pass: {prog.passingScore}%
          </span>
        )}
      </div>

      <div className="text-[9px] text-slate-400 uppercase tracking-widest font-black">
        {prog._count?.materials ?? 0} materials · {prog._count?.enrollments ?? 0} enrolled
      </div>

      {enrolled ? (
        <div className="flex flex-col gap-2 mt-auto">
          <div className="flex justify-between items-center">
            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${ENR_COLORS[enrolled.status]}`}>{enrolled.status.replace('_', ' ')}</span>
            <span className="text-[9px] font-black text-slate-400">{enrolled.progress}%</span>
          </div>
          <ProgressBar pct={enrolled.progress} color={enrolled.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-amber-500'} />
        </div>
      ) : (
        <button
          onClick={handleEnroll}
          disabled={enrolling}
          className="mt-auto w-full py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95 disabled:opacity-50"
        >
          {enrolling ? 'Enrolling…' : 'Enroll Now'}
        </button>
      )}
    </div>
  );
}

// ── Admin: Stats Tab ──────────────────────────────────────────────────────────
function StatsTab({ stats }: { stats: Stats | null }) {
  if (!stats) return <p className="text-sm text-slate-400 p-8">Loading stats…</p>;

  const kpis = [
    { label: 'Total Programs', value: stats.totalPrograms, color: 'text-slate-900' },
    { label: 'Published', value: stats.published, color: 'text-emerald-600' },
    { label: 'Mandatory', value: stats.mandatory, color: 'text-red-600' },
    { label: 'Total Enrollments', value: stats.totalEnrollments, color: 'text-amber-600' },
    { label: 'Completed', value: stats.completed, color: 'text-emerald-600' },
    { label: 'In Progress', value: stats.inProgress, color: 'text-indigo-600' },
    { label: 'Completion Rate', value: `${stats.completionRate}%`, color: stats.completionRate >= 70 ? 'text-emerald-600' : 'text-amber-600' },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-slate-100 p-6 shadow-lg shadow-indigo-500/5">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">{k.label}</p>
            <p className={`text-3xl font-black tracking-tighter ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-lg shadow-indigo-500/5">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-5">Programs by Category</p>
        <div className="flex flex-col gap-4">
          {stats.byCategory.map(b => (
            <div key={b.category} className="flex items-center gap-4">
              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border w-28 text-center ${CATEGORY_COLORS[b.category as ProgramCategory]}`}>
                {CATEGORY_LABELS[b.category as ProgramCategory]}
              </span>
              <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full"
                  style={{ width: `${Math.min(100, (b._count.id / stats.totalPrograms) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-black text-slate-500 w-8 text-right">{b._count.id}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Admin: Materials Modal ────────────────────────────────────────────────────
function MaterialsModal({ program, onClose }: { program: TrainingProgram; onClose: () => void }) {
  const [materials, setMaterials] = useState<TrainingMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: '', type: 'DOCUMENT' as MaterialType, url: '', durationMins: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch(`/training/programs/${program.id}`)
      .then(d => { setMaterials(d.materials ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [program.id]);

  async function addMaterial() {
    if (!form.title) return;
    setSaving(true);
    try {
      await apiFetch(`/training/programs/${program.id}/materials`, {
        method: 'POST',
        body: JSON.stringify({ ...form, orderIndex: materials.length, durationMins: form.durationMins ? Number(form.durationMins) : null }),
      });
      const d = await apiFetch(`/training/programs/${program.id}`);
      setMaterials(d.materials ?? []);
      setForm({ title: '', type: 'DOCUMENT', url: '', durationMins: '' });
    } catch { /* swallow */ }
    finally { setSaving(false); }
  }

  async function deleteMaterial(id: string) {
    try {
      await apiFetch(`/training/materials/${id}`, { method: 'DELETE' });
      setMaterials(m => m.filter(x => x.id !== id));
    } catch { /* swallow */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-8 border-b border-slate-100 flex justify-between items-start">
          <div>
            <h2 className="text-lg font-black text-slate-900">Materials</h2>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1 font-black">{program.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 text-xl font-black">✕</button>
        </div>

        <div className="p-8 flex flex-col gap-6">
          {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
            <div className="flex flex-col gap-3">
              {materials.length === 0 && <p className="text-[10px] text-slate-400 uppercase tracking-widest">No materials yet.</p>}
              {materials.map((m, i) => (
                <div key={m.id} className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-base">{MATERIAL_ICONS[m.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-slate-900">{m.title}</p>
                    {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="text-[9px] text-indigo-500 hover:underline truncate block">{m.url}</a>}
                    {m.durationMins && <p className="text-[9px] text-slate-400 font-black">{fmtDuration(m.durationMins)}</p>}
                  </div>
                  <span className="text-[9px] font-black text-slate-400 shrink-0">#{i + 1}</span>
                  <button onClick={() => deleteMaterial(m.id)} className="text-red-400 hover:text-red-600 text-[10px] font-black shrink-0">Remove</button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 pt-6">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Add Material</p>
            <div className="flex flex-col gap-3">
              <input
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
                placeholder="Title *"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  className="border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value as MaterialType }))}
                >
                  {(['VIDEO', 'DOCUMENT', 'QUIZ', 'LINK'] as MaterialType[]).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  className="border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
                  placeholder="Duration (mins)"
                  type="number"
                  value={form.durationMins}
                  onChange={e => setForm(f => ({ ...f, durationMins: e.target.value }))}
                />
              </div>
              <input
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
                placeholder="URL (optional)"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              />
              <button
                onClick={addMaterial}
                disabled={saving || !form.title}
                className="w-full py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50"
              >
                {saving ? 'Adding…' : '+ Add Material'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Admin: Enroll Modal ───────────────────────────────────────────────────────
interface EmployeeLite { id: string; fullName: string; employeeCode: string; department?: string; designation?: string; }

function EnrollModal({ program, onClose, onDone }: { program: TrainingProgram; onClose: () => void; onDone: () => void }) {
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [allEmployees, setAllEmployees] = useState<EmployeeLite[]>([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setEmpLoading(true);
    apiFetch('/employees?limit=500&isActive=true')
      .then(d => setAllEmployees(d.employees ?? []))
      .catch(() => {})
      .finally(() => setEmpLoading(false));
  }, []);

  async function submit() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setSaving(true);
    try {
      const data = await apiFetch(`/training/programs/${program.id}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ employeeIds: ids, dueDate: dueDate || null }),
      });
      setResult(`Enrolled ${data.enrolled}/${ids.length} employees`);
      onDone();
    } catch (e: any) { setResult(`Error: ${e.message || 'Failed to enroll'}`); }
    finally { setSaving(false); }
  }

  const filtered = allEmployees.filter(e => {
    const q = search.toLowerCase();
    return !q || e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q) || (e.department ?? '').toLowerCase().includes(q);
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">
        <div className="p-8 border-b border-slate-100 flex justify-between items-start shrink-0">
          <div>
            <h2 className="text-lg font-black text-slate-900">Enroll Employees</h2>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1 font-black">{program.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 text-xl font-black">✕</button>
        </div>
        <div className="p-6 flex flex-col gap-4 min-h-0 flex-1">
          {result ? (
            <div className="p-4 bg-emerald-50 text-emerald-700 text-xs font-black rounded-xl border border-emerald-200">{result}</div>
          ) : (
            <>
              {/* Search */}
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name, code, or department…"
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-amber-400 shrink-0"
              />

              {/* Select all / count */}
              <div className="flex items-center justify-between px-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (allFilteredSelected) {
                      setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(e => n.delete(e.id)); return n; });
                    } else {
                      setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(e => n.add(e.id)); return n; });
                    }
                  }}
                  className="text-[10px] font-black text-amber-600 uppercase tracking-widest hover:underline"
                >
                  {allFilteredSelected ? 'Deselect All' : 'Select All'}
                </button>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{selectedIds.size} selected</span>
              </div>

              {/* Employee list */}
              <div className="flex-1 overflow-y-auto border border-slate-100 rounded-2xl divide-y divide-slate-50 min-h-0">
                {empLoading ? (
                  <div className="p-8 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest animate-pulse">Loading employees…</div>
                ) : filtered.length === 0 ? (
                  <div className="p-8 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">No employees found</div>
                ) : filtered.map(emp => {
                  const checked = selectedIds.has(emp.id);
                  return (
                    <label key={emp.id} className={`flex items-center gap-4 px-5 py-3 cursor-pointer transition-colors ${checked ? 'bg-amber-50' : 'hover:bg-slate-50'}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedIds(prev => { const n = new Set(prev); checked ? n.delete(emp.id) : n.add(emp.id); return n; })}
                        className="w-4 h-4 rounded accent-amber-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-slate-900 truncate">{emp.fullName}</p>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{emp.employeeCode}{emp.department ? ` · ${emp.department}` : ''}</p>
                      </div>
                      {emp.designation && <span className="text-[9px] font-bold text-slate-400 truncate max-w-28">{emp.designation}</span>}
                    </label>
                  );
                })}
              </div>

              {/* Due date */}
              <div className="shrink-0">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Due Date (optional)</label>
                <input
                  type="date"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              </div>

              <button
                onClick={submit}
                disabled={saving || selectedIds.size === 0}
                className="w-full py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50 shrink-0"
              >
                {saving ? 'Enrolling…' : `Enroll${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
              </button>
            </>
          )}
          <button onClick={onClose} className="w-full py-3 border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 shrink-0">
            {result ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Admin: Programs Tab ───────────────────────────────────────────────────────
function AdminProgramsTab({ onRefreshStats }: { onRefreshStats: () => void }) {
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [materialsFor, setMaterialsFor] = useState<TrainingProgram | null>(null);
  const [enrollFor, setEnrollFor] = useState<TrainingProgram | null>(null);
  const [filter, setFilter] = useState<ProgramStatus | ''>('');
  const [form, setForm] = useState({ title: '', description: '', category: 'TECHNICAL' as ProgramCategory, durationMins: '', passingScore: '', isMandatory: false });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError('');
    const qs = filter ? `?status=${filter}` : '';
    apiFetch(`/training/programs${qs}`)
      .then(d => { setPrograms(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e: any) => { setError(e.message || 'Failed to load programs'); setLoading(false); });
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function createProgram() {
    if (!form.title) return;
    setSaving(true);
    try {
      await apiFetch('/training/programs', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          durationMins: form.durationMins ? Number(form.durationMins) : null,
          passingScore: form.passingScore ? Number(form.passingScore) : null,
        }),
      });
      setForm({ title: '', description: '', category: 'TECHNICAL', durationMins: '', passingScore: '', isMandatory: false });
      setShowCreate(false);
      load();
      onRefreshStats();
    } catch (e: any) { setError(e.message || 'Failed to create program'); }
    finally { setSaving(false); }
  }

  async function updateStatus(id: string, status: ProgramStatus) {
    try {
      await apiFetch(`/training/programs/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      load();
      onRefreshStats();
    } catch (e: any) { setError(e.message || 'Failed to update status'); }
  }

  async function archiveProgram(id: string) {
    try {
      await apiFetch(`/training/programs/${id}`, { method: 'DELETE' });
      load();
      onRefreshStats();
    } catch (e: any) { setError(e.message || 'Failed to archive program'); }
  }

  const filteredPrograms = programs.filter(p => p.status !== 'ARCHIVED' || filter === 'ARCHIVED');

  return (
    <div className="flex flex-col gap-6">
      {materialsFor && <MaterialsModal program={materialsFor} onClose={() => { setMaterialsFor(null); load(); }} />}
      {enrollFor && <EnrollModal program={enrollFor} onClose={() => setEnrollFor(null)} onDone={load} />}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex gap-2">
          {(['', 'DRAFT', 'PUBLISHED', 'ARCHIVED'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${filter === s ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-amber-300'}`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="px-6 py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95"
        >
          {showCreate ? '✕ Cancel' : '+ New Program'}
        </button>
      </div>

      {showCreate && (
        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-6 flex flex-col gap-4">
          <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Create Training Program</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <input
              className="border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400 col-span-2"
              placeholder="Program Title *"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
            <textarea
              className="border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400 col-span-2 resize-none h-20"
              placeholder="Description"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
            <select
              className="border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value as ProgramCategory }))}
            >
              {(Object.keys(CATEGORY_LABELS) as ProgramCategory[]).map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
            <input
              className="border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
              placeholder="Duration (mins)"
              type="number"
              value={form.durationMins}
              onChange={e => setForm(f => ({ ...f, durationMins: e.target.value }))}
            />
            <input
              className="border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
              placeholder="Passing Score % (optional)"
              type="number"
              min={0} max={100}
              value={form.passingScore}
              onChange={e => setForm(f => ({ ...f, passingScore: e.target.value }))}
            />
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isMandatory}
                onChange={e => setForm(f => ({ ...f, isMandatory: e.target.checked }))}
                className="w-4 h-4 accent-amber-500"
              />
              <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Mandatory for all employees</span>
            </label>
          </div>
          <button
            onClick={createProgram}
            disabled={saving || !form.title}
            className="self-start px-8 py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Program'}
          </button>
        </div>
      )}

      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 flex items-center justify-between gap-4">
          <p className="text-sm font-black text-amber-700">{error}</p>
          <button onClick={load} className="px-5 py-2 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 shrink-0">Retry</button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 p-4">Loading programs…</p>
      ) : filteredPrograms.length === 0 ? (
        <p className="text-sm text-slate-400 p-4 text-center">No programs found.</p>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
              <tr>
                <th className="px-6 py-5">Program</th>
                <th className="px-6 py-5">Category</th>
                <th className="px-6 py-5">Status</th>
                <th className="px-6 py-5">Materials</th>
                <th className="px-6 py-5">Enrolled</th>
                <th className="px-6 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredPrograms.map(p => (
                <tr key={p.id} className="hover:bg-slate-50/50 transition-all group">
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-black text-slate-900 group-hover:text-amber-600 transition-colors">{p.title}</span>
                      <div className="flex items-center gap-2">
                        {p.isMandatory && <span className="text-[8px] font-black px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full uppercase">Required</span>}
                        {p.durationMins && <span className="text-[9px] text-slate-400 font-black">{fmtDuration(p.durationMins)}</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[p.category]}`}>
                      {CATEGORY_LABELS[p.category]}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status]}`}>{p.status}</span>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => setMaterialsFor(p)}
                      className="text-[10px] font-black text-indigo-600 hover:underline"
                    >
                      {p._count?.materials ?? 0} materials
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-black text-slate-500">{p._count?.enrollments ?? 0}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 flex-wrap">
                      {p.status === 'DRAFT' && (
                        <button onClick={() => updateStatus(p.id, 'PUBLISHED')} className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[9px] font-black uppercase hover:bg-emerald-100 transition-all">Publish</button>
                      )}
                      {p.status === 'PUBLISHED' && (
                        <>
                          <button onClick={() => setEnrollFor(p)} className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[9px] font-black uppercase hover:bg-amber-100 transition-all">Enroll</button>
                          <button onClick={() => updateStatus(p.id, 'DRAFT')} className="px-3 py-1.5 bg-slate-50 text-slate-600 border border-slate-200 rounded-lg text-[9px] font-black uppercase hover:bg-slate-100 transition-all">Unpublish</button>
                        </>
                      )}
                      {p.status !== 'ARCHIVED' && (
                        <button onClick={() => archiveProgram(p.id)} className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-[9px] font-black uppercase hover:bg-red-100 transition-all">Archive</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Admin: All Enrollments Tab ─────────────────────────────────────────────────
function AdminEnrollmentsTab() {
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<EnrollmentStatus | ''>('');

  useEffect(() => {
    setError('');
    setLoading(true);
    const qs = filter ? `?status=${filter}` : '';
    apiFetch(`/training/enrollments${qs}`)
      .then(d => { setEnrollments(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e: any) => { setError(e.message || 'Failed to load enrollments'); setLoading(false); });
  }, [filter]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2 flex-wrap">
        {(['', 'ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'DROPPED'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${filter === s ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-amber-300'}`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 flex items-center justify-between gap-4">
          <p className="text-sm font-black text-amber-700">{error}</p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400 p-4">Loading enrollments…</p>
      ) : enrollments.length === 0 ? (
        <p className="text-sm text-slate-400 p-4 text-center">No enrollments found.</p>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
              <tr>
                <th className="px-6 py-5">Employee ID</th>
                <th className="px-6 py-5">Program</th>
                <th className="px-6 py-5">Status</th>
                <th className="px-6 py-5">Progress</th>
                <th className="px-6 py-5">Score</th>
                <th className="px-6 py-5">Enrolled</th>
                <th className="px-6 py-5">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {enrollments.map(e => (
                <tr key={e.id} className="hover:bg-slate-50/50">
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-black text-slate-500 font-mono">{e.employeeId.slice(0, 8)}…</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs font-black text-slate-800">{e.program?.title ?? '—'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${ENR_COLORS[e.status]}`}>{e.status.replace('_', ' ')}</span>
                  </td>
                  <td className="px-6 py-4 w-32">
                    <div className="flex items-center gap-2">
                      <ProgressBar pct={e.progress} color={e.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-amber-500'} />
                      <span className="text-[9px] font-black text-slate-400 shrink-0">{e.progress}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-black text-slate-500">{e.score !== null && e.score !== undefined ? `${e.score}%` : '—'}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-black text-slate-400">{fmtDate(e.enrolledAt)}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-[10px] font-black ${e.dueDate && new Date(e.dueDate) < new Date() ? 'text-red-500' : 'text-slate-400'}`}>
                      {fmtDate(e.dueDate)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Employee: My Training Tab ─────────────────────────────────────────────────
function MyTrainingTab() {
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    apiFetch('/training/my-programs')
      .then(d => { setEnrollments(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e: any) => { setError(e.message || 'Failed to load training data'); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateProgress(enrollmentId: string, progress: number) {
    setUpdating(enrollmentId);
    try {
      await apiFetch(`/training/enrollments/${enrollmentId}/progress`, {
        method: 'PUT', body: JSON.stringify({ progress }),
      });
      load();
    } catch { /* swallow — stale UI, user can retry */ }
    finally { setUpdating(null); }
  }

  async function dropEnrollment(enrollmentId: string) {
    try {
      await apiFetch(`/training/enrollments/${enrollmentId}`, { method: 'DELETE' });
      load();
    } catch { /* swallow */ }
  }

  if (loading) return <p className="text-sm text-slate-400 p-8">Loading your programs…</p>;
  if (error) return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
      <p className="text-sm font-black text-amber-700 uppercase tracking-widest mb-2">Could not load training data</p>
      <p className="text-xs text-amber-600 mb-4">{error}</p>
      <button onClick={load} className="px-6 py-2 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600">Retry</button>
    </div>
  );

  const active = enrollments.filter(e => e.status !== 'COMPLETED' && e.status !== 'DROPPED');
  const completed = enrollments.filter(e => e.status === 'COMPLETED');

  return (
    <div className="flex flex-col gap-8">
      {active.length === 0 && completed.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <p className="text-3xl mb-3">📚</p>
          <p className="text-sm font-black uppercase tracking-widest">No active training programs.</p>
          <p className="text-xs text-slate-300 mt-1">Browse the Programs tab to enroll.</p>
        </div>
      )}

      {active.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Active Programs ({active.length})</p>
          <div className="flex flex-col gap-4">
            {active.map(e => (
              <div key={e.id} className="bg-white rounded-2xl border border-slate-100 shadow-lg p-6 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-black text-slate-900">{e.program?.title ?? 'Unknown'}</h3>
                    {e.program?.description && <p className="text-[10px] text-slate-400 leading-relaxed">{e.program.description}</p>}
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {e.program && <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[e.program.category]}`}>{CATEGORY_LABELS[e.program.category]}</span>}
                      {e.dueDate && <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${new Date(e.dueDate) < new Date() ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>Due {fmtDate(e.dueDate)}</span>}
                    </div>
                  </div>
                  <span className={`shrink-0 text-[9px] font-black px-2 py-0.5 rounded-full ${ENR_COLORS[e.status]}`}>{e.status.replace('_', ' ')}</span>
                </div>

                <div className="flex items-center gap-3">
                  <ProgressBar pct={e.progress} />
                  <span className="text-[10px] font-black text-slate-500 shrink-0 w-12 text-right">{e.progress}%</span>
                </div>

                <div className="flex gap-3 flex-wrap">
                  {[25, 50, 75, 100].filter(p => p > e.progress).slice(0, 3).map(p => (
                    <button
                      key={p}
                      onClick={() => updateProgress(e.id, p)}
                      disabled={updating === e.id}
                      className="px-4 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[9px] font-black uppercase hover:bg-amber-100 transition-all disabled:opacity-50"
                    >
                      {updating === e.id ? '…' : `Mark ${p}%`}
                    </button>
                  ))}
                  {e.progress < 100 && (
                    <button
                      onClick={() => updateProgress(e.id, 100)}
                      disabled={updating === e.id}
                      className="px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[9px] font-black uppercase hover:bg-emerald-100 transition-all disabled:opacity-50"
                    >
                      Mark Complete
                    </button>
                  )}
                  <button
                    onClick={() => dropEnrollment(e.id)}
                    className="ml-auto px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg text-[9px] font-black uppercase hover:bg-red-100 transition-all"
                  >
                    Drop
                  </button>
                </div>

                {e.program?.materials && e.program.materials.length > 0 && (
                  <div className="border-t border-slate-50 pt-4">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Materials</p>
                    <div className="flex flex-col gap-2">
                      {e.program.materials.map(m => (
                        <div key={m.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                          <span>{MATERIAL_ICONS[m.type]}</span>
                          <span className="text-[10px] font-black text-slate-700 flex-1">{m.title}</span>
                          {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="text-[9px] font-black text-indigo-600 hover:underline">Open →</a>}
                          {m.durationMins && <span className="text-[9px] text-slate-400 font-black">{fmtDuration(m.durationMins)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Completed ({completed.length})</p>
          <div className="flex flex-col gap-3">
            {completed.map(e => (
              <div key={e.id} className="bg-white rounded-2xl border border-slate-100 p-5 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-emerald-50 rounded-full flex items-center justify-center text-sm">✓</div>
                  <div>
                    <p className="text-xs font-black text-slate-800">{e.program?.title ?? 'Unknown'}</p>
                    <p className="text-[9px] text-slate-400 font-black">Completed {fmtDate(e.completedAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {e.score !== null && e.score !== undefined && (
                    <span className="text-[10px] font-black px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
                      Score: {e.score}%
                    </span>
                  )}
                  <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">COMPLETED</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Employee: Browse Programs Tab ─────────────────────────────────────────────
function BrowseProgramsTab() {
  const [programs, setPrograms] = useState<TrainingProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState<ProgramCategory | ''>('');

  const load = useCallback(() => {
    setError('');
    const qs = category ? `?category=${category}` : '';
    apiFetch(`/training/programs${qs}`)
      .then(d => { setPrograms(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e: any) => { setError(e.message || 'Failed to load programs'); setLoading(false); });
  }, [category]);

  useEffect(() => { load(); }, [load]);

  async function handleEnroll(programId: string) {
    try {
      await apiFetch(`/training/programs/${programId}/self-enroll`, { method: 'POST' });
      load();
    } catch { /* swallow */ }
  }

  if (error) return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
      <p className="text-sm font-black text-amber-700 uppercase tracking-widest mb-2">Could not load programs</p>
      <p className="text-xs text-amber-600 mb-4">{error}</p>
      <button onClick={load} className="px-6 py-2 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600">Retry</button>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setCategory('')}
          className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${category === '' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-amber-300'}`}
        >
          All
        </button>
        {(Object.keys(CATEGORY_LABELS) as ProgramCategory[]).map(c => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${category === c ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-amber-300'}`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 p-4">Loading programs…</p>
      ) : programs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-3xl mb-3">🎓</p>
          <p className="text-sm font-black uppercase tracking-widest">No programs available.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {programs.map(p => (
            <ProgramCard key={p.id} prog={p} onEnroll={handleEnroll} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root page ─────────────────────────────────────────────────────────────────
export default function TrainingPage() {
  const { user, loading: authLoading } = useAuth();
  const role = user?.role ?? '';
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'].includes(role);
  const isManager = role === 'MANAGER';
  const isEmployee = !isPrivileged && !isManager;

  const adminTabs = ['Programs', 'Enrollments', 'Stats', 'My Training', 'Browse Programs'] as const;
  const empTabs   = ['My Training', 'Browse Programs'] as const;

  type AdminTab = typeof adminTabs[number];
  type EmpTab   = typeof empTabs[number];

  const [adminTab, setAdminTab] = useState<AdminTab>('Programs');
  const [empTab, setEmpTab]     = useState<EmpTab>('My Training');
  const [stats, setStats]       = useState<Stats | null>(null);

  const loadStats = useCallback(() => {
    if (isPrivileged || isManager) {
      apiFetch('/training/stats').then(setStats).catch(() => {});
    }
  }, [isPrivileged, isManager]);

  useEffect(() => { loadStats(); }, [loadStats]);

  if (authLoading) {
    return <div className="h-40 bg-white rounded-[2rem] border border-slate-100 animate-pulse max-w-[1400px] mx-auto" />;
  }

  // ── Employee layout ─────────────────────────────────────────────────────────
  if (isEmployee) {
    return (
      <div className="flex flex-col gap-10 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">
        <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-amber-500/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-amber-500 rounded-full" />
              <span className="text-[10px] font-black text-amber-600 uppercase tracking-[0.4em]">Learning & Development</span>
            </div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tighter">
              Hi, {firstName} <span className="text-amber-600">— Your Training</span>
            </h1>
            <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest">
              Track progress on enrolled programs and discover new learning opportunities.
            </p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-slate-100 pb-0">
          {empTabs.map(t => (
            <button
              key={t}
              onClick={() => setEmpTab(t)}
              className={`px-6 py-3 text-[10px] font-black uppercase tracking-widest rounded-t-xl transition-all ${empTab === t ? 'bg-white border border-slate-200 border-b-white text-amber-600' : 'text-slate-400 hover:text-slate-700'}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div>
          {empTab === 'My Training'     && <MyTrainingTab />}
          {empTab === 'Browse Programs' && <BrowseProgramsTab />}
        </div>
      </div>
    );
  }

  // ── Admin / Manager layout ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-10 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">
      <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-amber-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-amber-500 rounded-full" />
              <span className="text-[10px] font-black text-amber-600 uppercase tracking-[0.4em]">Learning & Development</span>
            </div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tighter">
              Training <span className="text-amber-600">Management</span>
            </h1>
            <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest max-w-xl">
              Create training programs, manage materials, track enrollments and completion rates.
            </p>
          </div>
          {stats && (
            <div className="flex gap-6">
              {[
                { label: 'Published', value: stats.published, color: 'text-emerald-600' },
                { label: 'Mandatory', value: stats.mandatory, color: 'text-red-600' },
                { label: 'Completion', value: `${stats.completionRate}%`, color: 'text-amber-600' },
              ].map(k => (
                <div key={k.label} className="text-center">
                  <p className={`text-2xl font-black tracking-tighter ${k.color}`}>{k.value}</p>
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{k.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-100">
        {adminTabs.map(t => (
          <button
            key={t}
            onClick={() => setAdminTab(t)}
            className={`px-6 py-3 text-[10px] font-black uppercase tracking-widest rounded-t-xl transition-all ${adminTab === t ? 'bg-white border border-slate-200 border-b-white text-amber-600' : 'text-slate-400 hover:text-slate-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div>
        {adminTab === 'Programs'       && <AdminProgramsTab onRefreshStats={loadStats} />}
        {adminTab === 'Enrollments'    && <AdminEnrollmentsTab />}
        {adminTab === 'Stats'          && <StatsTab stats={stats} />}
        {adminTab === 'My Training'    && <MyTrainingTab />}
        {adminTab === 'Browse Programs'&& <BrowseProgramsTab />}
      </div>
    </div>
  );
}
