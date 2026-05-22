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
function ProgramCard({ prog, onEnroll, onStartCourse }: { prog: TrainingProgram; onEnroll: (id: string) => void; onStartCourse?: () => void }) {
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
          <button
            onClick={onStartCourse}
            className="mt-1 w-full py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95"
          >
            {enrolled.status === 'COMPLETED' ? '✓ Review Course' : enrolled.status === 'IN_PROGRESS' ? '▶ Continue' : '▶ Start Course'}
          </button>
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

// ── Quiz Builder types ────────────────────────────────────────────────────────
interface QuizQuestionDraft { id: string; text: string; options: string[]; correct: number; }

function emptyQuestion(): QuizQuestionDraft {
  return { id: crypto.randomUUID(), text: '', options: ['', ''], correct: 0 };
}

// ── Admin: Materials Modal ────────────────────────────────────────────────────
function MaterialsModal({ program, onClose }: { program: TrainingProgram; onClose: () => void }) {
  const [materials, setMaterials] = useState<TrainingMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ title: '', type: 'DOCUMENT' as MaterialType, url: '', content: '', durationMins: '' });
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestionDraft[]>([emptyQuestion()]);
  const [saving, setSaving] = useState(false);

  function loadMaterials() {
    apiFetch(`/training/programs/${program.id}`)
      .then(d => { setMaterials(d.materials ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { loadMaterials(); }, [program.id]);

  function resetForm() {
    setForm({ title: '', type: 'DOCUMENT', url: '', content: '', durationMins: '' });
    setQuizQuestions([emptyQuestion()]);
    setFormError('');
  }

  function changeType(t: MaterialType) {
    setForm(f => ({ ...f, type: t, url: '', content: '' }));
    setQuizQuestions([emptyQuestion()]);
    setFormError('');
  }

  // Quiz builder helpers
  function setQuestion(idx: number, text: string) {
    setQuizQuestions(qs => qs.map((q, i) => i === idx ? { ...q, text } : q));
  }
  function setOption(qIdx: number, oIdx: number, val: string) {
    setQuizQuestions(qs => qs.map((q, i) => i === qIdx ? { ...q, options: q.options.map((o, j) => j === oIdx ? val : o) } : q));
  }
  function addOption(qIdx: number) {
    setQuizQuestions(qs => qs.map((q, i) => i === qIdx && q.options.length < 6 ? { ...q, options: [...q.options, ''] } : q));
  }
  function removeOption(qIdx: number, oIdx: number) {
    setQuizQuestions(qs => qs.map((q, i) => {
      if (i !== qIdx || q.options.length <= 2) return q;
      const options = q.options.filter((_, j) => j !== oIdx);
      const correct = q.correct >= oIdx && q.correct > 0 ? q.correct - 1 : q.correct;
      return { ...q, options, correct: Math.min(correct, options.length - 1) };
    }));
  }
  function setCorrect(qIdx: number, oIdx: number) {
    setQuizQuestions(qs => qs.map((q, i) => i === qIdx ? { ...q, correct: oIdx } : q));
  }
  function addQuestion() { setQuizQuestions(qs => [...qs, emptyQuestion()]); }
  function removeQuestion(idx: number) {
    setQuizQuestions(qs => qs.length > 1 ? qs.filter((_, i) => i !== idx) : qs);
  }

  async function addMaterial() {
    if (!form.title.trim()) { setFormError('Lesson title is required'); return; }

    let content: string | undefined;
    if (form.type === 'QUIZ') {
      for (let i = 0; i < quizQuestions.length; i++) {
        const q = quizQuestions[i];
        if (!q.text.trim()) { setFormError(`Question ${i + 1} is missing the question text`); return; }
        if (q.options.some(o => !o.trim())) { setFormError(`Question ${i + 1} has a blank answer option`); return; }
      }
      content = JSON.stringify(quizQuestions.map(q => ({
        id: q.id, text: q.text.trim(), options: q.options.map(o => o.trim()), correct: q.correct,
      })));
    } else {
      content = form.content.trim() || undefined;
    }

    setFormError('');
    setSaving(true);
    try {
      await apiFetch(`/training/programs/${program.id}/materials`, {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          type: form.type,
          url: form.url.trim() || undefined,
          content,
          orderIndex: materials.length,
          durationMins: form.durationMins ? Number(form.durationMins) : null,
        }),
      });
      loadMaterials();
      resetForm();
    } catch (e: any) {
      setFormError(e.message || 'Failed to add lesson');
    } finally { setSaving(false); }
  }

  async function deleteMaterial(id: string) {
    try {
      await apiFetch(`/training/materials/${id}`, { method: 'DELETE' });
      setMaterials(m => m.filter(x => x.id !== id));
    } catch (e: any) { setFormError(e.message || 'Failed to remove lesson'); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-8 border-b border-slate-100 flex justify-between items-start">
          <div>
            <h2 className="text-lg font-black text-slate-900">Lessons</h2>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1 font-black">{program.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-900 text-xl font-black">✕</button>
        </div>

        <div className="p-8 flex flex-col gap-6">
          {/* Existing lessons list */}
          {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
            <div className="flex flex-col gap-3">
              {materials.length === 0 && <p className="text-[10px] text-slate-400 uppercase tracking-widest font-black">No lessons yet. Add the first one below.</p>}
              {materials.map((m, i) => (
                <div key={m.id} className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-base">{MATERIAL_ICONS[m.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-black text-slate-900">{m.title}</p>
                    <p className="text-[9px] font-black text-slate-400 uppercase">{m.type}{m.durationMins ? ` · ${fmtDuration(m.durationMins)}` : ''}</p>
                    {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="text-[9px] text-indigo-500 hover:underline truncate block">{m.url}</a>}
                    {m.type === 'QUIZ' && m.content && (() => {
                      try { const qs = JSON.parse(m.content); return <p className="text-[9px] text-slate-400 font-black">{Array.isArray(qs) ? qs.length : 0} question{qs.length !== 1 ? 's' : ''}</p>; } catch { return null; }
                    })()}
                    {m.type !== 'QUIZ' && m.content && <p className="text-[9px] text-slate-400 truncate">{m.content.slice(0, 60)}{m.content.length > 60 ? '…' : ''}</p>}
                  </div>
                  <span className="text-[9px] font-black text-slate-400 shrink-0">#{i + 1}</span>
                  <button onClick={() => deleteMaterial(m.id)} className="text-red-400 hover:text-red-600 text-[10px] font-black shrink-0">Remove</button>
                </div>
              ))}
            </div>
          )}

          {/* Add lesson form */}
          <div className="border-t border-slate-100 pt-6 flex flex-col gap-4">
            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">+ Add Lesson</p>

            <input
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
              placeholder="Lesson title *"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />

            <div className="grid grid-cols-2 gap-3">
              <select
                className="border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
                value={form.type}
                onChange={e => changeType(e.target.value as MaterialType)}
              >
                <option value="DOCUMENT">📄 Document</option>
                <option value="VIDEO">▶ Video</option>
                <option value="QUIZ">✏️ Quiz</option>
                <option value="LINK">🔗 Link</option>
              </select>
              <input
                className="border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
                placeholder="Duration (mins)"
                type="number" min={1}
                value={form.durationMins}
                onChange={e => setForm(f => ({ ...f, durationMins: e.target.value }))}
              />
            </div>

            {/* URL — VIDEO / LINK / DOCUMENT */}
            {(form.type === 'VIDEO' || form.type === 'LINK' || form.type === 'DOCUMENT') && (
              <input
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400"
                placeholder={form.type === 'VIDEO' ? 'YouTube or Vimeo URL' : form.type === 'LINK' ? 'External URL' : 'Document URL (optional)'}
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              />
            )}

            {/* Text content — DOCUMENT / VIDEO / LINK */}
            {form.type !== 'QUIZ' && (
              <textarea
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-xs font-black text-slate-700 focus:outline-none focus:border-amber-400 resize-none"
                placeholder={form.type === 'DOCUMENT' ? 'Reading material / lesson content…' : 'Description or notes (optional)…'}
                rows={4}
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              />
            )}

            {/* ── Quiz Builder ── */}
            {form.type === 'QUIZ' && (
              <div className="flex flex-col gap-5">
                {quizQuestions.map((q, qi) => (
                  <div key={q.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Question {qi + 1}</span>
                      {quizQuestions.length > 1 && (
                        <button onClick={() => removeQuestion(qi)} className="text-[9px] font-black text-red-400 hover:text-red-600 uppercase tracking-widest">Remove</button>
                      )}
                    </div>

                    <input
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 focus:outline-none focus:border-amber-400 bg-white"
                      placeholder={`Type question ${qi + 1} here…`}
                      value={q.text}
                      onChange={e => setQuestion(qi, e.target.value)}
                    />

                    <div className="flex flex-col gap-2">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Answer options — click the circle to mark the correct answer</p>
                      {q.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setCorrect(qi, oi)}
                            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${q.correct === oi ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 hover:border-amber-400'}`}
                            title="Mark as correct answer"
                          >
                            {q.correct === oi && <span className="text-white text-xs font-black">✓</span>}
                          </button>
                          <input
                            className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:border-amber-400 bg-white"
                            placeholder={`Option ${oi + 1}`}
                            value={opt}
                            onChange={e => setOption(qi, oi, e.target.value)}
                          />
                          {q.options.length > 2 && (
                            <button onClick={() => removeOption(qi, oi)} className="text-slate-300 hover:text-red-400 font-black text-sm shrink-0 transition-colors">✕</button>
                          )}
                        </div>
                      ))}
                      {q.correct < q.options.length && (
                        <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">
                          Correct answer: Option {q.correct + 1}{q.options[q.correct] ? ` — "${q.options[q.correct]}"` : ''}
                        </p>
                      )}
                    </div>

                    {q.options.length < 6 && (
                      <button
                        type="button"
                        onClick={() => addOption(qi)}
                        className="self-start text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-amber-600 transition-colors"
                      >
                        + Add option
                      </button>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addQuestion}
                  className="self-start px-5 py-2.5 border-2 border-dashed border-amber-300 text-amber-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-50 transition-all"
                >
                  + Add Another Question
                </button>
              </div>
            )}

            {formError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-[10px] font-black text-red-700">{formError}</div>
            )}

            <button
              onClick={addMaterial}
              disabled={saving || !form.title.trim()}
              className="w-full py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50 active:scale-95"
            >
              {saving ? 'Saving…' : '+ Add Lesson'}
            </button>
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
  const [progSort, setProgSort] = useState<{ col: 'title' | 'category' | 'status' | 'materials' | 'enrolled'; dir: 'asc' | 'desc' }>({ col: 'title', dir: 'asc' });

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
  const sortedPrograms = [...filteredPrograms].sort((a, b) => {
    const d = progSort.dir === 'asc' ? 1 : -1;
    switch (progSort.col) {
      case 'title':    return d * a.title.localeCompare(b.title);
      case 'category': return d * a.category.localeCompare(b.category);
      case 'status':   return d * a.status.localeCompare(b.status);
      case 'materials':return d * ((a._count?.materials ?? 0) - (b._count?.materials ?? 0));
      case 'enrolled': return d * ((a._count?.enrollments ?? 0) - (b._count?.enrollments ?? 0));
      default: return 0;
    }
  });
  function toggleProgSort(col: typeof progSort.col) {
    setProgSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function ProgSortIcon({ col }: { col: typeof progSort.col }) {
    return <span className="text-[8px] ml-1">{progSort.col === col ? (progSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

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
                {([
                  { col: 'title',    label: 'Program',   cls: 'px-6 py-5' },
                  { col: 'category', label: 'Category',  cls: 'px-6 py-5' },
                  { col: 'status',   label: 'Status',    cls: 'px-6 py-5' },
                  { col: 'materials',label: 'Materials', cls: 'px-6 py-5' },
                  { col: 'enrolled', label: 'Enrolled',  cls: 'px-6 py-5' },
                  { col: null,       label: 'Actions',   cls: 'px-6 py-5 text-right' },
                ] as const).map(h => (
                  <th key={h.label} className={h.cls}>
                    {h.col ? (
                      <button onClick={() => toggleProgSort(h.col!)} className="flex items-center hover:text-slate-600 transition-colors">
                        {h.label}<ProgSortIcon col={h.col} />
                      </button>
                    ) : h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sortedPrograms.map(p => (
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
                      {p._count?.materials ?? 0} lessons
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-black text-slate-500">{p._count?.enrollments ?? 0}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 flex-wrap">
                      <button onClick={() => setMaterialsFor(p)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-[9px] font-black uppercase hover:bg-indigo-100 transition-all">📚 Lessons</button>
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
  const [enrSort, setEnrSort] = useState<{ col: 'employee' | 'program' | 'status' | 'progress' | 'score' | 'enrolled' | 'due'; dir: 'asc' | 'desc' }>({ col: 'enrolled', dir: 'desc' });

  useEffect(() => {
    setError('');
    setLoading(true);
    const qs = filter ? `?status=${filter}` : '';
    apiFetch(`/training/enrollments${qs}`)
      .then(d => { setEnrollments(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e: any) => { setError(e.message || 'Failed to load enrollments'); setLoading(false); });
  }, [filter]);

  const sortedEnrollments = [...enrollments].sort((a, b) => {
    const d = enrSort.dir === 'asc' ? 1 : -1;
    switch (enrSort.col) {
      case 'employee': return d * a.employeeId.localeCompare(b.employeeId);
      case 'program':  return d * (a.program?.title ?? '').localeCompare(b.program?.title ?? '');
      case 'status':   return d * a.status.localeCompare(b.status);
      case 'progress': return d * (a.progress - b.progress);
      case 'score':    return d * ((a.score ?? -1) - (b.score ?? -1));
      case 'enrolled': return d * (new Date(a.enrolledAt).getTime() - new Date(b.enrolledAt).getTime());
      case 'due':      return d * ((a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity));
      default: return 0;
    }
  });
  function toggleEnrSort(col: typeof enrSort.col) {
    setEnrSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function EnrSortIcon({ col }: { col: typeof enrSort.col }) {
    return <span className="text-[8px] ml-1">{enrSort.col === col ? (enrSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

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
                {([
                  { col: 'employee', label: 'Employee ID', cls: 'px-6 py-5' },
                  { col: 'program',  label: 'Program',     cls: 'px-6 py-5' },
                  { col: 'status',   label: 'Status',      cls: 'px-6 py-5' },
                  { col: 'progress', label: 'Progress',    cls: 'px-6 py-5' },
                  { col: 'score',    label: 'Score',       cls: 'px-6 py-5' },
                  { col: 'enrolled', label: 'Enrolled',    cls: 'px-6 py-5' },
                  { col: 'due',      label: 'Due',         cls: 'px-6 py-5' },
                ] as const).map(h => (
                  <th key={h.label} className={h.cls}>
                    <button onClick={() => toggleEnrSort(h.col)} className="flex items-center hover:text-slate-600 transition-colors">
                      {h.label}<EnrSortIcon col={h.col} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sortedEnrollments.map(e => (
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

// ── Types for material-level progress ────────────────────────────────────────
interface MaterialProgress { enrollmentId: string; materialId: string; score?: number | null; completedAt: string; }
interface EnrollmentWithProgress extends TrainingEnrollment {
  materialProgress: MaterialProgress[];
}

interface QuizQuestion { id: string; text: string; options: string[]; correct: number; }

// ── Course Player ─────────────────────────────────────────────────────────────
function CoursePlayer({
  enrollment, onBack, onProgressUpdate,
}: {
  enrollment: EnrollmentWithProgress;
  onBack: () => void;
  onProgressUpdate: (updated: EnrollmentWithProgress) => void;
}) {
  const [activeMaterial, setActiveMaterial] = useState<TrainingMaterial | null>(
    enrollment.program?.materials?.[0] ?? null
  );
  const [completing, setCompleting] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizResult, setQuizResult] = useState<{ score: number; passed: boolean } | null>(null);
  const [linkVisited, setLinkVisited] = useState(false);

  const materials = enrollment.program?.materials ?? [];
  const completedIds = new Set(enrollment.materialProgress.map(p => p.materialId));
  const totalMats = materials.length;
  const doneMats = completedIds.size;
  const progress = totalMats > 0 ? Math.round((doneMats / totalMats) * 100) : 0;
  const isOverdue = enrollment.dueDate ? new Date(enrollment.dueDate) < new Date() : false;
  const passingScore = enrollment.program?.passingScore ?? 70;

  // Reset quiz state when switching materials
  function openMaterial(m: TrainingMaterial) {
    setActiveMaterial(m);
    setQuizAnswers({});
    setQuizResult(null);
    setLinkVisited(false);
  }

  async function completeMaterial(materialId: string, answers?: Record<string, number>) {
    setCompleting(true);
    try {
      const res = await apiFetch(`/training/enrollments/${enrollment.id}/materials/${materialId}/complete`, {
        method: 'POST',
        body: JSON.stringify(answers ? { quizAnswers: answers } : {}),
      });
      // Update local state optimistically
      const newProgress: MaterialProgress = { enrollmentId: enrollment.id, materialId, completedAt: new Date().toISOString(), score: res.materialScore };
      const updatedEnrollment: EnrollmentWithProgress = {
        ...enrollment,
        progress: res.progress,
        status: res.enrollment.status,
        completedAt: res.enrollment.completedAt,
        score: res.enrollment.score,
        materialProgress: [
          ...enrollment.materialProgress.filter(p => p.materialId !== materialId),
          newProgress,
        ],
      };
      if (answers !== undefined && res.materialScore !== null) {
        setQuizResult({ score: res.materialScore, passed: res.materialScore >= passingScore });
      }
      onProgressUpdate(updatedEnrollment);
    } catch { /* ignore */ }
    finally { setCompleting(false); }
  }

  function parseQuiz(content?: string | null): QuizQuestion[] {
    if (!content) return [];
    try {
      const raw = JSON.parse(content);
      return Array.isArray(raw) ? raw : (raw.questions ?? []);
    } catch { return []; }
  }

  function getVideoEmbed(url?: string | null): string | null {
    if (!url) return null;
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
    const vimeo = url.match(/vimeo\.com\/(\d+)/);
    if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
    return null;
  }

  const isMaterialDone = (id: string) => completedIds.has(id);
  const isCompleted = enrollment.status === 'COMPLETED';

  return (
    <div className="flex flex-col gap-0 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-slate-900 uppercase tracking-widest transition-colors">
          ← Back
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-black text-slate-900 truncate">{enrollment.program?.title}</h2>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {enrollment.program && (
              <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[enrollment.program.category]}`}>
                {CATEGORY_LABELS[enrollment.program.category]}
              </span>
            )}
            {enrollment.program?.isMandatory && (
              <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">Required</span>
            )}
            {enrollment.dueDate && (
              <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${isOverdue ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                {isOverdue ? 'Overdue · ' : 'Due · '}{fmtDate(enrollment.dueDate)}
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xl font-black text-slate-900">{progress}%</p>
          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{doneMats}/{totalMats} done</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <ProgressBar pct={progress} color={isCompleted ? 'bg-emerald-500' : 'bg-amber-500'} />
      </div>

      {/* Completion banner */}
      {isCompleted && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center text-white text-lg font-black shrink-0">✓</div>
          <div>
            <p className="text-sm font-black text-emerald-800">Course Completed!</p>
            <p className="text-[10px] text-emerald-600 font-black uppercase tracking-widest mt-0.5">
              Completed {fmtDate(enrollment.completedAt)}
              {enrollment.score !== null && enrollment.score !== undefined && ` · Score: ${enrollment.score}%`}
            </p>
          </div>
        </div>
      )}

      {/* No materials state */}
      {materials.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
          <p className="text-3xl mb-3">🏗️</p>
          <p className="text-sm font-black text-amber-800">Course materials are being prepared</p>
          <p className="text-[10px] text-amber-600 font-black uppercase tracking-widest mt-1">Check back soon — content will appear here once ready</p>
        </div>
      )}

      {/* Main layout: sidebar + content */}
      {materials.length > 0 && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Material list */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-50">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Course Materials</p>
          </div>
          <div className="divide-y divide-slate-50">
            {materials.length === 0 && (
              <p className="text-[10px] text-slate-400 p-5 text-center font-black uppercase tracking-widest">No materials yet</p>
            )}
            {materials.map((m, idx) => {
              const done = isMaterialDone(m.id);
              const isActive = activeMaterial?.id === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => openMaterial(m)}
                  className={`w-full flex items-center gap-3 px-5 py-4 text-left transition-all ${isActive ? 'bg-amber-50 border-l-2 border-amber-500' : 'hover:bg-slate-50'}`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border-2 transition-all ${done ? 'bg-emerald-500 border-emerald-500 text-white' : isActive ? 'border-amber-500 text-amber-600' : 'border-slate-200 text-slate-400'}`}>
                    {done ? '✓' : idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-black truncate ${isActive ? 'text-amber-700' : done ? 'text-slate-500' : 'text-slate-800'}`}>{m.title}</p>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mt-0.5">
                      {m.type}{m.durationMins ? ` · ${fmtDuration(m.durationMins)}` : ''}
                    </p>
                  </div>
                  {done && <span className="text-emerald-500 text-xs shrink-0">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content viewer */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden flex flex-col">
          {!activeMaterial ? (
            <div className="flex-1 flex items-center justify-center p-12 text-center">
              <div>
                <p className="text-4xl mb-3">📖</p>
                <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Select a material to begin</p>
              </div>
            </div>
          ) : (
            <>
              <div className="px-7 py-5 border-b border-slate-50 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{activeMaterial.type}</p>
                  <h3 className="text-sm font-black text-slate-900 mt-0.5">{activeMaterial.title}</h3>
                </div>
                {isMaterialDone(activeMaterial.id) && (
                  <span className="text-[9px] font-black px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full shrink-0">Completed ✓</span>
                )}
              </div>

              <div className="flex-1 p-7 flex flex-col gap-6">

                {/* VIDEO */}
                {activeMaterial.type === 'VIDEO' && (() => {
                  const embedUrl = getVideoEmbed(activeMaterial.url);
                  return (
                    <div className="flex flex-col gap-4">
                      {embedUrl ? (
                        <div className="relative w-full rounded-2xl overflow-hidden bg-black" style={{ paddingTop: '56.25%' }}>
                          <iframe
                            src={embedUrl}
                            className="absolute inset-0 w-full h-full"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                          />
                        </div>
                      ) : activeMaterial.url ? (
                        <div className="flex flex-col gap-3">
                          <video src={activeMaterial.url} controls className="w-full rounded-2xl bg-black max-h-80" />
                        </div>
                      ) : (
                        <div className="bg-slate-50 rounded-2xl p-8 text-center border border-slate-100">
                          <p className="text-slate-400 text-sm font-black">No video URL provided</p>
                        </div>
                      )}
                      {activeMaterial.content && <p className="text-sm text-slate-600 leading-relaxed">{activeMaterial.content}</p>}
                      {!isMaterialDone(activeMaterial.id) && (
                        <button
                          onClick={() => completeMaterial(activeMaterial.id)}
                          disabled={completing}
                          className="self-start px-6 py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50 active:scale-95"
                        >
                          {completing ? 'Saving…' : "Mark as Watched ✓"}
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* DOCUMENT */}
                {activeMaterial.type === 'DOCUMENT' && (
                  <div className="flex flex-col gap-4">
                    {activeMaterial.url && (
                      <a href={activeMaterial.url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 self-start">
                        📎 Open Document →
                      </a>
                    )}
                    {activeMaterial.content ? (
                      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-medium max-h-96 overflow-y-auto">
                        {activeMaterial.content}
                      </div>
                    ) : (
                      <div className="bg-slate-50 rounded-2xl p-8 text-center border border-slate-100">
                        <p className="text-slate-400 text-sm font-black">No document content provided</p>
                      </div>
                    )}
                    {!isMaterialDone(activeMaterial.id) && (
                      <button
                        onClick={() => completeMaterial(activeMaterial.id)}
                        disabled={completing}
                        className="self-start px-6 py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50 active:scale-95"
                      >
                        {completing ? 'Saving…' : "I've Read This ✓"}
                      </button>
                    )}
                  </div>
                )}

                {/* LINK */}
                {activeMaterial.type === 'LINK' && (
                  <div className="flex flex-col gap-4">
                    {activeMaterial.content && <p className="text-sm text-slate-600 leading-relaxed">{activeMaterial.content}</p>}
                    {activeMaterial.url && (
                      <a
                        href={activeMaterial.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setLinkVisited(true)}
                        className="flex items-center justify-between p-5 bg-indigo-50 border border-indigo-200 rounded-2xl hover:bg-indigo-100 transition-all group"
                      >
                        <div>
                          <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest">External Resource</p>
                          <p className="text-xs text-indigo-500 mt-1 truncate max-w-xs">{activeMaterial.url}</p>
                        </div>
                        <span className="text-indigo-600 font-black group-hover:translate-x-1 transition-transform">→</span>
                      </a>
                    )}
                    {!isMaterialDone(activeMaterial.id) && (linkVisited || !activeMaterial.url) && (
                      <button
                        onClick={() => completeMaterial(activeMaterial.id)}
                        disabled={completing}
                        className="self-start px-6 py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50 active:scale-95"
                      >
                        {completing ? 'Saving…' : "Mark as Visited ✓"}
                      </button>
                    )}
                    {!isMaterialDone(activeMaterial.id) && activeMaterial.url && !linkVisited && (
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Open the resource above to mark as complete</p>
                    )}
                  </div>
                )}

                {/* QUIZ */}
                {activeMaterial.type === 'QUIZ' && (() => {
                  const questions = parseQuiz(activeMaterial.content);
                  const done = isMaterialDone(activeMaterial.id);
                  const existingScore = enrollment.materialProgress.find(p => p.materialId === activeMaterial.id)?.score;

                  if (done && !quizResult) {
                    return (
                      <div className="flex flex-col gap-4">
                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
                          <p className="text-2xl font-black text-emerald-700">{existingScore ?? '—'}%</p>
                          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mt-1">Quiz Score</p>
                          {existingScore !== null && existingScore !== undefined && (
                            <p className={`text-[9px] font-black uppercase tracking-widest mt-2 ${existingScore >= passingScore ? 'text-emerald-500' : 'text-red-500'}`}>
                              {existingScore >= passingScore ? 'Passed ✓' : `Below passing score (${passingScore}%)`}
                            </p>
                          )}
                        </div>
                        {questions.length > 0 && (
                          <button
                            onClick={() => { setQuizAnswers({}); setQuizResult(null); }}
                            className="self-start px-5 py-2 border border-slate-200 text-slate-500 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-50"
                          >
                            Retake Quiz
                          </button>
                        )}
                      </div>
                    );
                  }

                  if (quizResult) {
                    return (
                      <div className="flex flex-col gap-4">
                        <div className={`rounded-2xl p-8 text-center border ${quizResult.passed ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                          <p className={`text-4xl font-black ${quizResult.passed ? 'text-emerald-700' : 'text-amber-700'}`}>{quizResult.score}%</p>
                          <p className={`text-[10px] font-black uppercase tracking-widest mt-2 ${quizResult.passed ? 'text-emerald-600' : 'text-amber-600'}`}>
                            {quizResult.passed ? 'Quiz Passed! Well done.' : `Not quite — passing score is ${passingScore}%`}
                          </p>
                        </div>
                        {!quizResult.passed && (
                          <button
                            onClick={() => { setQuizAnswers({}); setQuizResult(null); }}
                            className="self-start px-5 py-2 bg-amber-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-amber-600"
                          >
                            Retake Quiz
                          </button>
                        )}
                      </div>
                    );
                  }

                  if (questions.length === 0) {
                    return (
                      <div className="flex flex-col gap-4">
                        <div className="bg-slate-50 rounded-2xl p-8 text-center border border-slate-100">
                          <p className="text-slate-400 text-sm font-black">No quiz questions configured yet</p>
                        </div>
                        {!done && (
                          <button
                            onClick={() => completeMaterial(activeMaterial.id)}
                            disabled={completing}
                            className="self-start px-6 py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50"
                          >
                            {completing ? 'Saving…' : 'Mark as Complete ✓'}
                          </button>
                        )}
                      </div>
                    );
                  }

                  const allAnswered = questions.every(q => quizAnswers[q.id] !== undefined);
                  return (
                    <div className="flex flex-col gap-5">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{questions.length} Question{questions.length !== 1 ? 's' : ''}</p>
                      {questions.map((q, qi) => (
                        <div key={q.id} className="flex flex-col gap-3">
                          <p className="text-sm font-black text-slate-900">{qi + 1}. {q.text}</p>
                          <div className="flex flex-col gap-2">
                            {q.options.map((opt, oi) => (
                              <label
                                key={oi}
                                className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${quizAnswers[q.id] === oi ? 'bg-amber-50 border-amber-400 text-amber-800' : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'}`}
                              >
                                <input
                                  type="radio"
                                  name={`q_${q.id}`}
                                  checked={quizAnswers[q.id] === oi}
                                  onChange={() => setQuizAnswers(a => ({ ...a, [q.id]: oi }))}
                                  className="accent-amber-500"
                                />
                                <span className="text-sm font-bold">{opt}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() => completeMaterial(activeMaterial.id, quizAnswers)}
                        disabled={completing || !allAnswered}
                        className="self-start px-8 py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all disabled:opacity-50 active:scale-95"
                      >
                        {completing ? 'Submitting…' : 'Submit Quiz →'}
                      </button>
                      {!allAnswered && <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Answer all questions to submit</p>}
                    </div>
                  );
                })()}

              </div>
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// ── Employee: My Training Tab ─────────────────────────────────────────────────
function MyTrainingTab() {
  const [enrollments, setEnrollments] = useState<EnrollmentWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeEnrollment, setActiveEnrollment] = useState<EnrollmentWithProgress | null>(null);

  const load = useCallback(() => {
    setError('');
    apiFetch('/training/my-programs')
      .then(d => { setEnrollments(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e: any) => { setError(e.message || 'Failed to load training'); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleProgressUpdate(updated: EnrollmentWithProgress) {
    setEnrollments(prev => prev.map(e => e.id === updated.id ? updated : e));
    setActiveEnrollment(updated);
  }

  if (loading) return (
    <div className="flex flex-col gap-4">
      {[1,2,3].map(i => <div key={i} className="h-32 bg-white rounded-2xl border border-slate-100 animate-pulse" />)}
    </div>
  );

  if (error) return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
      <p className="text-sm font-black text-amber-700 uppercase tracking-widest mb-2">Could not load training</p>
      <p className="text-xs text-amber-600 mb-4">{error}</p>
      <button onClick={load} className="px-6 py-2 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600">Retry</button>
    </div>
  );

  // Course player view
  if (activeEnrollment) {
    return (
      <CoursePlayer
        enrollment={activeEnrollment}
        onBack={() => { setActiveEnrollment(null); load(); }}
        onProgressUpdate={handleProgressUpdate}
      />
    );
  }

  // My learning hub list view
  const inProgress  = enrollments.filter(e => e.status === 'IN_PROGRESS');
  const notStarted  = enrollments.filter(e => e.status === 'ENROLLED');
  const completed   = enrollments.filter(e => e.status === 'COMPLETED');
  const overdue     = enrollments.filter(e => e.dueDate && new Date(e.dueDate) < new Date() && e.status !== 'COMPLETED');
  const mandatory   = enrollments.filter(e => e.program?.isMandatory && e.status !== 'COMPLETED');

  if (enrollments.length === 0) {
    return (
      <div className="text-center py-20 text-slate-400">
        <p className="text-5xl mb-4">📚</p>
        <p className="text-sm font-black uppercase tracking-widest mb-1">No training assigned yet</p>
        <p className="text-xs text-slate-300">Browse available courses in the Programs tab to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'In Progress', value: inProgress.length, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-100' },
          { label: 'Completed', value: completed.length, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
          { label: 'Not Started', value: notStarted.length, color: 'text-slate-600', bg: 'bg-slate-50 border-slate-100' },
          { label: 'Overdue', value: overdue.length, color: overdue.length > 0 ? 'text-red-600' : 'text-slate-400', bg: overdue.length > 0 ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-100' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl border p-5 ${s.bg}`}>
            <p className={`text-3xl font-black tracking-tighter ${s.color}`}>{s.value}</p>
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Mandatory alert */}
      {mandatory.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-4">
          <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0">!</div>
          <div>
            <p className="text-sm font-black text-red-800">You have {mandatory.length} mandatory course{mandatory.length !== 1 ? 's' : ''} to complete</p>
            <p className="text-[10px] text-red-600 font-black uppercase tracking-widest mt-0.5">
              {mandatory.map(e => e.program?.title).join(' · ')}
            </p>
          </div>
        </div>
      )}

      {/* In progress */}
      {inProgress.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Continue Learning</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {inProgress.map(e => <EnrollmentCard key={e.id} e={e} onOpen={() => setActiveEnrollment(e)} />)}
          </div>
        </div>
      )}

      {/* Not started */}
      {notStarted.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Start Learning</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {notStarted.map(e => <EnrollmentCard key={e.id} e={e} onOpen={() => setActiveEnrollment(e)} />)}
          </div>
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Completed ({completed.length})</p>
          <div className="flex flex-col gap-3">
            {completed.map(e => (
              <div key={e.id} className="bg-white rounded-2xl border border-slate-100 p-5 flex items-center gap-4 group">
                <div className="w-10 h-10 bg-emerald-50 border border-emerald-200 rounded-full flex items-center justify-center text-emerald-600 font-black text-sm shrink-0">✓</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-slate-800 truncate">{e.program?.title}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {e.program && <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full border ${CATEGORY_COLORS[e.program.category]}`}>{CATEGORY_LABELS[e.program.category]}</span>}
                    <span className="text-[9px] font-black text-slate-400">Completed {fmtDate(e.completedAt)}</span>
                    {e.score !== null && e.score !== undefined && (
                      <span className="text-[9px] font-black text-emerald-600">Score: {e.score}%</span>
                    )}
                  </div>
                </div>
                <button onClick={() => setActiveEnrollment(e)} className="px-4 py-2 border border-slate-200 text-slate-500 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-50 shrink-0">
                  Review
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EnrollmentCard({ e, onOpen }: { e: EnrollmentWithProgress; onOpen: () => void }) {
  const total = e.program?.materials?.length ?? 0;
  const done  = e.materialProgress?.length ?? 0;
  const isOverdue = e.dueDate ? new Date(e.dueDate) < new Date() : false;
  const isNew = e.status === 'ENROLLED';

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-lg p-6 flex flex-col gap-4 hover:border-amber-200 hover:shadow-xl transition-all group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <h3 className="text-sm font-black text-slate-900 leading-tight truncate">{e.program?.title}</h3>
          {e.program?.description && <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2">{e.program.description}</p>}
          <div className="flex flex-wrap gap-2 mt-0.5">
            {e.program && <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[e.program.category]}`}>{CATEGORY_LABELS[e.program.category]}</span>}
            {e.program?.isMandatory && <span className="text-[8px] font-black px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full">Required</span>}
            {e.dueDate && <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${isOverdue ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-100'}`}>Due {fmtDate(e.dueDate)}</span>}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{done}/{total} materials</span>
          <span className="text-[10px] font-black text-slate-600">{e.progress}%</span>
        </div>
        <ProgressBar pct={e.progress} color={isOverdue ? 'bg-red-400' : 'bg-amber-500'} />
      </div>

      <button
        onClick={onOpen}
        className="w-full py-3 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all active:scale-95 shadow-lg shadow-amber-500/20"
      >
        {isNew ? '▶ Start Course' : e.status === 'COMPLETED' ? '✓ Review Course' : '▶ Continue'}
      </button>
    </div>
  );
}

// ── Employee: Browse Programs Tab ─────────────────────────────────────────────
function BrowseProgramsTab({ onGoToMyTraining }: { onGoToMyTraining?: () => void }) {
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
      onGoToMyTraining?.();
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
            <ProgramCard key={p.id} prog={p} onEnroll={handleEnroll} onStartCourse={onGoToMyTraining} />
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
          {empTab === 'Browse Programs' && <BrowseProgramsTab onGoToMyTraining={() => setEmpTab('My Training')} />}
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
        {adminTab === 'Browse Programs'&& <BrowseProgramsTab onGoToMyTraining={() => setAdminTab('My Training')} />}
      </div>
    </div>
  );
}
