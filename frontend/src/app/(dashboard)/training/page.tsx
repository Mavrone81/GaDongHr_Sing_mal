'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import {
  PageHeader, Stat, DataTable, Card, CardHeader, Button, Badge, EmptyState, Field, Input, Select, Textarea, Modal, Tabs,
  SearchInput, Icon, useToast,
  type Column, type BadgeTone, type IconName,
} from '@/components/ui';

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
  COMPLIANCE: 'Compliance', TECHNICAL: 'Technical', SOFT_SKILLS: 'Soft skills',
  LEADERSHIP: 'Leadership', ONBOARDING: 'Onboarding', SAFETY: 'Safety',
};

// State maps are written one entry per line: the vocabulary guard reads a map
// up to the first `};` at the start of a line, so a one-line map would be read
// together with whatever follows it.
const PROGRAM_STATUS_TONE: Record<ProgramStatus, BadgeTone> = {
  DRAFT: 'brass',
  PUBLISHED: 'ok',
  ARCHIVED: 'neutral',
};
const PROGRAM_STATUS_LABEL: Record<ProgramStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
};

/** Enrolment states: not started, under way, done, dropped — four distinct appearances. */
const ENR_TONE: Record<EnrollmentStatus, BadgeTone> = {
  ENROLLED:    'neutral',
  IN_PROGRESS: 'accent',
  COMPLETED:   'ok',
  DROPPED:     'warn',
};
const ENR_LABEL: Record<EnrollmentStatus, string> = {
  ENROLLED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  DROPPED: 'Dropped',
};

const MATERIAL_ICONS: Record<MaterialType, IconName> = {
  VIDEO: 'camera', DOCUMENT: 'file', QUIZ: 'list', LINK: 'arrowRight',
};
const MATERIAL_LABEL: Record<MaterialType, string> = { VIDEO: 'Video', DOCUMENT: 'Document', QUIZ: 'Quiz', LINK: 'Link' };

function fmtDuration(mins?: number) {
  if (!mins) return null;
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60 > 0 ? (mins % 60) + 'm' : ''}`.trim();
}

function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ProgressBar({ pct, color = 'bg-accent', label }: { pct: number; color?: string; label?: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-pill overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Skeleton({ h = 'h-32' }: { h?: string }) {
  return <div className={`${h} rounded-card bg-pill animate-pulse`} aria-busy="true" />;
}

function FilterChips<T extends string>({ items, active, onChange, label }: { items: { id: T; label: string }[]; active: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {items.map(it => {
        const on = it.id === active;
        return (
          <button key={it.id || 'all'} type="button" onClick={() => onChange(it.id)} aria-pressed={on}
            className={`h-[34px] px-3 rounded-control border text-[13px] font-semibold transition-colors ${on ? 'border-accent bg-tint text-accent' : 'border-rule bg-paper text-ink hover:bg-pill'}`}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function ErrorPanel({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 p-3.5 rounded-control border border-rule bg-danger-bg text-danger">
      <Icon name="alert" size={18} className="mt-0.5" />
      <div className="flex flex-col gap-1 flex-1">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-[13px] text-ink">{message}</span>
      </div>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
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
    <Card className="gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h3 className="text-[15.5px] font-bold text-ink leading-snug">{prog.title}</h3>
          {prog.description && <p className="text-[13px] text-muted leading-relaxed line-clamp-2">{prog.description}</p>}
        </div>
        {prog.isMandatory && <Badge tone="danger" className="shrink-0">Required</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
        <span>{CATEGORY_LABELS[prog.category]}</span>
        {prog.durationMins && <span className="tabular-nums">· {fmtDuration(prog.durationMins)}</span>}
        {prog.passingScore && <span className="tabular-nums">· pass mark {prog.passingScore}%</span>}
        <span className="tabular-nums">· {prog._count?.materials ?? 0} lessons · {prog._count?.enrollments ?? 0} enrolled</span>
      </div>

      {enrolled ? (
        <div className="flex flex-col gap-2.5 mt-auto">
          <div className="flex justify-between items-center">
            <Badge tone={ENR_TONE[enrolled.status]}>{ENR_LABEL[enrolled.status]}</Badge>
            <span className="text-xs text-muted tabular-nums">{enrolled.progress}%</span>
          </div>
          <ProgressBar pct={enrolled.progress} color={enrolled.status === 'COMPLETED' ? 'bg-ok' : 'bg-accent'} label={`${prog.title} progress`} />
          <Button variant={enrolled.status === 'COMPLETED' ? 'secondary' : 'primary'} onClick={onStartCourse} className="w-full"
            icon={enrolled.status === 'COMPLETED' ? 'check' : 'arrowRight'}>
            {enrolled.status === 'COMPLETED' ? 'Review course' : enrolled.status === 'IN_PROGRESS' ? 'Continue' : 'Start course'}
          </Button>
        </div>
      ) : (
        <Button onClick={handleEnroll} disabled={enrolling} className="w-full mt-auto">
          {enrolling ? 'Enrolling…' : 'Enrol'}
        </Button>
      )}
    </Card>
  );
}

// ── Admin: Stats Tab ──────────────────────────────────────────────────────────
function StatsTab({ stats }: { stats: Stats | null }) {
  if (!stats) return <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} h="h-[118px]" />)}</div>;

  const kpis = [
    { label: 'Total programmes', value: stats.totalPrograms },
    { label: 'Published', value: stats.published },
    { label: 'Mandatory', value: stats.mandatory },
    { label: 'Total enrolments', value: stats.totalEnrollments },
    { label: 'Completed', value: stats.completed },
    { label: 'In progress', value: stats.inProgress },
    { label: 'Completion rate', value: `${stats.completionRate}%`, note: stats.completionRate >= 70 ? 'On target (70%+)' : 'Below the 70% mark' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {kpis.map(k => <Stat key={k.label} label={k.label} value={k.value} note={k.note} />)}
      </div>

      <Card>
        <CardHeader title="Programmes by category" />
        {stats.byCategory.length === 0 ? <p className="text-sm text-muted">No programmes yet.</p> : (
          <div className="flex flex-col gap-3">
            {stats.byCategory.map(b => (
              <div key={b.category} className="grid grid-cols-[120px_minmax(0,1fr)_40px] items-center gap-3">
                <span className="text-[13px] text-ink">{CATEGORY_LABELS[b.category as ProgramCategory]}</span>
                <div className="h-2 rounded-full bg-pill overflow-hidden">
                  <div className="h-full bg-accent" style={{ width: `${Math.min(100, (b._count.id / stats.totalPrograms) * 100)}%` }} />
                </div>
                <span className="text-[13px] text-muted text-right tabular-nums">{b._count.id}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
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

  const noTitle = !form.title.trim();

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Lessons"
      caption={program.title}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Done</Button>
        <Button icon="plus" onClick={addMaterial} disabled={saving || noTitle} reason={noTitle && !saving ? 'Give the lesson a title' : undefined}>{saving ? 'Saving…' : 'Add lesson'}</Button>
      </>}
    >
      <div className="flex flex-col gap-6">
        {/* Existing lessons */}
        {loading ? <Skeleton h="h-20" /> : materials.length === 0 ? (
          <p className="p-4 rounded-control bg-page text-sm text-muted text-center">No lessons yet. Add the first one below.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-rule border border-rule rounded-card">
            {materials.map((m, i) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex items-center justify-center w-9 h-9 rounded-control bg-pill text-muted shrink-0"><Icon name={MATERIAL_ICONS[m.type]} size={17} /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate"><span className="text-muted tabular-nums">{i + 1}.</span> {m.title}</p>
                  <p className="text-xs text-muted">
                    {MATERIAL_LABEL[m.type]}{m.durationMins ? ` · ${fmtDuration(m.durationMins)}` : ''}
                    {m.type === 'QUIZ' && m.content && (() => {
                      try { const qs = JSON.parse(m.content); return ` · ${Array.isArray(qs) ? qs.length : 0} question${qs.length !== 1 ? 's' : ''}`; } catch { return null; }
                    })()}
                  </p>
                  {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline truncate block">{m.url}</a>}
                  {m.type !== 'QUIZ' && m.content && <p className="text-xs text-muted truncate">{m.content.slice(0, 60)}{m.content.length > 60 ? '…' : ''}</p>}
                </div>
                <Button size="sm" variant="danger" onClick={() => deleteMaterial(m.id)}>Remove</Button>
              </li>
            ))}
          </ol>
        )}

        {/* Add lesson */}
        <div className="flex flex-col gap-4 pt-5 border-t border-rule">
          <h3 className="text-[15.5px] font-bold text-ink">Add a lesson</h3>

          <Field label="Lesson title" required>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Type">
              <Select value={form.type} onChange={e => changeType(e.target.value as MaterialType)}>
                <option value="DOCUMENT">Document</option>
                <option value="VIDEO">Video</option>
                <option value="QUIZ">Quiz</option>
                <option value="LINK">Link</option>
              </Select>
            </Field>
            <Field label="Duration (minutes)">
              <Input type="number" min={1} value={form.durationMins} onChange={e => setForm(f => ({ ...f, durationMins: e.target.value }))} />
            </Field>
          </div>

          {/* URL — VIDEO / LINK / DOCUMENT */}
          {(form.type === 'VIDEO' || form.type === 'LINK' || form.type === 'DOCUMENT') && (
            <Field label={form.type === 'VIDEO' ? 'YouTube or Vimeo URL' : form.type === 'LINK' ? 'External URL' : 'Document URL'} help={form.type === 'DOCUMENT' ? 'Optional' : undefined}>
              <Input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
            </Field>
          )}

          {/* Text content — DOCUMENT / VIDEO / LINK */}
          {form.type !== 'QUIZ' && (
            <Field label={form.type === 'DOCUMENT' ? 'Reading material' : 'Description or notes'} help={form.type === 'DOCUMENT' ? undefined : 'Optional'}>
              <Textarea rows={4} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
            </Field>
          )}

          {/* ── Quiz builder ── */}
          {form.type === 'QUIZ' && (
            <div className="flex flex-col gap-4">
              {quizQuestions.map((q, qi) => (
                <fieldset key={q.id} className="flex flex-col gap-3 p-4 rounded-card border border-rule bg-page">
                  <div className="flex items-center justify-between gap-3">
                    <legend className="text-sm font-bold text-ink">Question {qi + 1}</legend>
                    {quizQuestions.length > 1 && <Button size="sm" variant="ghost" onClick={() => removeQuestion(qi)}>Remove question</Button>}
                  </div>

                  <Field label="Question">
                    <Input value={q.text} onChange={e => setQuestion(qi, e.target.value)} />
                  </Field>

                  <div className="flex flex-col gap-2">
                    <span className="text-[12.5px] font-semibold text-muted">Answers. Select the correct one.</span>
                    {q.options.map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2.5">
                        <input type="radio" name={`correct_${q.id}`} checked={q.correct === oi} onChange={() => setCorrect(qi, oi)}
                          aria-label={`Option ${oi + 1} is the correct answer`} className="w-4 h-4 accent-accent shrink-0" />
                        <Input value={opt} onChange={e => setOption(qi, oi, e.target.value)} placeholder={`Option ${oi + 1}`} aria-label={`Option ${oi + 1}`} className="flex-1" />
                        {q.options.length > 2 && (
                          <button type="button" onClick={() => removeOption(qi, oi)} aria-label={`Remove option ${oi + 1}`}
                            className="flex items-center justify-center w-9 h-9 rounded-control text-muted hover:text-danger hover:bg-pill shrink-0">
                            <Icon name="x" size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    {q.correct < q.options.length && (
                      <span className="text-xs text-ok">Correct answer: option {q.correct + 1}{q.options[q.correct] ? ` — “${q.options[q.correct]}”` : ''}</span>
                    )}
                  </div>

                  {q.options.length < 6 && (
                    <Button size="sm" variant="ghost" icon="plus" onClick={() => addOption(qi)} className="self-start">Add option</Button>
                  )}
                </fieldset>
              ))}

              <Button variant="secondary" icon="plus" onClick={addQuestion} className="self-start">Add another question</Button>
            </div>
          )}

          {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
        </div>
      </div>
    </Modal>
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
  const failed = !!result && result.startsWith('Error:');

  return (
    <Modal
      open
      onClose={onClose}
      title="Enrol employees"
      caption={program.title}
      footer={result ? <Button onClick={onClose}>Close</Button> : <>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving || selectedIds.size === 0} reason={selectedIds.size === 0 && !saving ? 'Select at least one person' : undefined}>
          {saving ? 'Enrolling…' : selectedIds.size > 0 ? `Enrol ${selectedIds.size}` : 'Enrol'}
        </Button>
      </>}
    >
      {result ? (
        <div role="status" className={`flex items-center gap-2.5 p-4 rounded-control ${failed ? 'bg-danger-bg text-danger' : 'bg-ok-bg text-ok'}`}>
          <Icon name={failed ? 'alert' : 'check'} size={18} strokeWidth={2} />
          <span className="text-sm font-semibold">{result}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <SearchInput value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, code or department…" aria-label="Search employees" />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (allFilteredSelected) {
                  setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(e => n.delete(e.id)); return n; });
                } else {
                  setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(e => n.add(e.id)); return n; });
                }
              }}
              className="text-[13px] font-semibold text-accent hover:underline"
            >
              {allFilteredSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span className="text-[13px] text-muted tabular-nums">{selectedIds.size} selected</span>
          </div>
          <div className="max-h-[40vh] overflow-y-auto border border-rule rounded-control divide-y divide-rule">
            {empLoading ? (
              <div className="p-6 flex flex-col gap-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-pill rounded-control animate-pulse" />)}</div>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">{search ? 'No one matches that search.' : 'No active employees found.'}</p>
            ) : filtered.map(emp => {
              const checked = selectedIds.has(emp.id);
              return (
                <label key={emp.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${checked ? 'bg-tint' : 'hover:bg-page'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSelectedIds(prev => { const n = new Set(prev); checked ? n.delete(emp.id) : n.add(emp.id); return n; })}
                    className="w-4 h-4 accent-accent shrink-0"
                  />
                  <span className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-semibold text-ink truncate">{emp.fullName}</span>
                    <span className="text-xs text-muted truncate tabular-nums">{emp.employeeCode}{emp.department ? ` · ${emp.department}` : ''}</span>
                  </span>
                  {emp.designation && <span className="hidden sm:block text-xs text-muted truncate max-w-[140px]">{emp.designation}</span>}
                </label>
              );
            })}
          </div>
          <Field label="Due date" help="Optional. Overdue enrolments are flagged to the employee.">
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
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
  const head = (col: typeof progSort.col, label: string, alignEnd = false) => (
    <button type="button" onClick={() => toggleProgSort(col)} aria-sort={progSort.col === col ? (progSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`inline-flex items-center gap-1 hover:text-ink ${alignEnd ? 'justify-end w-full' : ''}`}>
      {label}{progSort.col === col && <Icon name="chevronDown" size={13} strokeWidth={2.25} className={progSort.dir === 'asc' ? 'rotate-180' : ''} />}
    </button>
  );

  const actions = (p: TrainingProgram) => (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button size="sm" variant="ghost" onClick={() => setMaterialsFor(p)}>Lessons</Button>
      {p.status === 'DRAFT' && <Button size="sm" variant="ghost" onClick={() => updateStatus(p.id, 'PUBLISHED')}>Publish</Button>}
      {p.status === 'PUBLISHED' && (
        <>
          <Button size="sm" variant="ghost" onClick={() => setEnrollFor(p)}>Enrol</Button>
          <Button size="sm" variant="ghost" onClick={() => updateStatus(p.id, 'DRAFT')}>Unpublish</Button>
        </>
      )}
      {p.status !== 'ARCHIVED' && <Button size="sm" variant="danger" onClick={() => archiveProgram(p.id)}>Archive</Button>}
    </span>
  );

  const columns: Column<TrainingProgram>[] = [
    {
      key: 'title', label: head('title', 'Programme'), width: 'minmax(0, 1.6fr)',
      render: p => (
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-ink truncate">{p.title}</span>
          {p.isMandatory && <Badge tone="danger">Required</Badge>}
          {p.durationMins && <span className="text-xs text-muted tabular-nums shrink-0">{fmtDuration(p.durationMins)}</span>}
        </div>
      ),
    },
    { key: 'category', label: head('category', 'Category'), width: '120px', render: p => CATEGORY_LABELS[p.category] },
    { key: 'status', label: head('status', 'Status'), width: '110px', render: p => <Badge tone={PROGRAM_STATUS_TONE[p.status]}>{PROGRAM_STATUS_LABEL[p.status]}</Badge> },
    {
      key: 'materials', label: head('materials', 'Lessons'), width: '100px',
      render: p => <button type="button" onClick={() => setMaterialsFor(p)} className="text-[13px] font-semibold text-accent hover:underline tabular-nums">{p._count?.materials ?? 0} lessons</button>,
    },
    { key: 'enrolled', label: head('enrolled', 'Enrolled', true), width: '90px', align: 'right', numeric: true, render: p => p._count?.enrollments ?? 0 },
    { key: 'act', label: '', width: '300px', align: 'right', render: actions },
  ];

  return (
    <div className="flex flex-col gap-4">
      {materialsFor && <MaterialsModal program={materialsFor} onClose={() => { setMaterialsFor(null); load(); }} />}
      {enrollFor && <EnrollModal program={enrollFor} onClose={() => setEnrollFor(null)} onDone={load} />}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <FilterChips<ProgramStatus | ''>
          label="Status"
          items={[{ id: '', label: 'All' }, { id: 'DRAFT', label: 'Draft' }, { id: 'PUBLISHED', label: 'Published' }, { id: 'ARCHIVED', label: 'Archived' }]}
          active={filter}
          onChange={setFilter}
        />
        <Button icon="plus" onClick={() => setShowCreate(true)}>New programme</Button>
      </div>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New training programme"
        caption="Starts as a draft. Add lessons, then publish."
        footer={<>
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={createProgram} disabled={saving || !form.title} reason={!form.title && !saving ? 'Give it a title' : undefined}>{saving ? 'Creating…' : 'Create programme'}</Button>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Title" required className="sm:col-span-2">
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as ProgramCategory }))}>
              {(Object.keys(CATEGORY_LABELS) as ProgramCategory[]).map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
            </Select>
          </Field>
          <Field label="Duration (minutes)">
            <Input type="number" value={form.durationMins} onChange={e => setForm(f => ({ ...f, durationMins: e.target.value }))} />
          </Field>
          <Field label="Pass mark (%)" help="Optional. Quizzes below this are marked as not passed.">
            <Input type="number" min={0} max={100} value={form.passingScore} onChange={e => setForm(f => ({ ...f, passingScore: e.target.value }))} />
          </Field>
          <label className="flex items-center gap-3 self-center cursor-pointer">
            <input type="checkbox" checked={form.isMandatory} onChange={e => setForm(f => ({ ...f, isMandatory: e.target.checked }))} className="w-4 h-4 accent-accent" />
            <span className="text-sm text-ink">Mandatory for all employees</span>
          </label>
        </div>
      </Modal>

      {error && <ErrorPanel title="Something went wrong" message={error} onRetry={load} />}

      {loading ? (
        <div className="flex flex-col gap-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} h="h-[52px]" />)}</div>
      ) : (
        <DataTable
          aria-label="Training programmes"
          columns={columns}
          rows={sortedPrograms}
          rowKey={p => p.id}
          empty={<EmptyState icon="book" title={filter ? `No ${PROGRAM_STATUS_LABEL[filter].toLowerCase()} programmes` : 'No programmes yet'} description="Create a programme, add lessons, then publish it so people can enrol." action={<Button icon="plus" onClick={() => setShowCreate(true)}>New programme</Button>} className="py-6" />}
          mobileCard={p => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-ink">{p.title}</span>
                <Badge tone={PROGRAM_STATUS_TONE[p.status]}>{PROGRAM_STATUS_LABEL[p.status]}</Badge>
              </div>
              <span className="text-xs text-muted tabular-nums">{CATEGORY_LABELS[p.category]} · {p._count?.materials ?? 0} lessons · {p._count?.enrollments ?? 0} enrolled{p.isMandatory ? ' · required' : ''}</span>
              <div className="-ml-3">{actions(p)}</div>
            </div>
          )}
          footer={<span className="tabular-nums">{filteredPrograms.length} programme{filteredPrograms.length === 1 ? '' : 's'}</span>}
        />
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
  const head = (col: typeof enrSort.col, label: string, alignEnd = false) => (
    <button type="button" onClick={() => toggleEnrSort(col)} aria-sort={enrSort.col === col ? (enrSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`inline-flex items-center gap-1 hover:text-ink ${alignEnd ? 'justify-end w-full' : ''}`}>
      {label}{enrSort.col === col && <Icon name="chevronDown" size={13} strokeWidth={2.25} className={enrSort.dir === 'asc' ? 'rotate-180' : ''} />}
    </button>
  );
  const overdue = (e: TrainingEnrollment) => !!e.dueDate && new Date(e.dueDate) < new Date();

  const columns: Column<TrainingEnrollment>[] = [
    { key: 'employee', label: head('employee', 'Employee'), width: '120px', numeric: true, render: e => <span className="text-muted">{e.employeeId.slice(0, 8)}…</span> },
    { key: 'program', label: head('program', 'Programme'), width: 'minmax(0, 1.5fr)', render: e => <span className="font-semibold">{e.program?.title ?? '—'}</span> },
    { key: 'status', label: head('status', 'Status'), width: '120px', render: e => <Badge tone={ENR_TONE[e.status]}>{ENR_LABEL[e.status]}</Badge> },
    {
      key: 'progress', label: head('progress', 'Progress'), width: '150px',
      render: e => <div className="flex items-center gap-2"><ProgressBar pct={e.progress} color={e.status === 'COMPLETED' ? 'bg-ok' : 'bg-accent'} /><span className="text-xs text-muted tabular-nums w-9 text-right">{e.progress}%</span></div>,
    },
    { key: 'score', label: head('score', 'Score', true), width: '70px', align: 'right', numeric: true, render: e => e.score !== null && e.score !== undefined ? `${e.score}%` : '—' },
    { key: 'enrolled', label: head('enrolled', 'Enrolled'), width: '110px', numeric: true, render: e => fmtDate(e.enrolledAt) },
    {
      key: 'due', label: head('due', 'Due'), width: '150px', numeric: true,
      render: e => <span className="inline-flex items-center gap-1.5">{fmtDate(e.dueDate)}{overdue(e) && e.status !== 'COMPLETED' && <Badge tone="danger">Overdue</Badge>}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <FilterChips<EnrollmentStatus | ''>
        label="Status"
        items={[{ id: '', label: 'All' }, { id: 'ENROLLED', label: 'Not started' }, { id: 'IN_PROGRESS', label: 'In progress' }, { id: 'COMPLETED', label: 'Completed' }, { id: 'DROPPED', label: 'Dropped' }]}
        active={filter}
        onChange={setFilter}
      />

      {error && <ErrorPanel title="Enrolments did not load" message={error} />}

      {loading ? (
        <div className="flex flex-col gap-2">{[1, 2, 3, 4].map(i => <Skeleton key={i} h="h-[52px]" />)}</div>
      ) : (
        <DataTable
          aria-label="Enrolments"
          columns={columns}
          rows={sortedEnrollments}
          rowKey={e => e.id}
          empty={<EmptyState icon="users" title="No enrolments" description={filter ? 'Nothing matches this filter.' : 'Enrol people from a published programme.'} className="py-6" />}
          mobileCard={e => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-ink">{e.program?.title ?? '—'}</span>
                <Badge tone={ENR_TONE[e.status]}>{ENR_LABEL[e.status]}</Badge>
              </div>
              <ProgressBar pct={e.progress} color={e.status === 'COMPLETED' ? 'bg-ok' : 'bg-accent'} />
              <span className="text-xs text-muted tabular-nums">
                {e.employeeId.slice(0, 8)}… · {e.progress}%{e.score != null ? ` · score ${e.score}%` : ''} · due {fmtDate(e.dueDate)}{overdue(e) && e.status !== 'COMPLETED' ? ' (overdue)' : ''}
              </span>
            </div>
          )}
          footer={enrollments.length > 0 ? <span className="tabular-nums">{enrollments.length} enrolment{enrollments.length === 1 ? '' : 's'}</span> : undefined}
        />
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

  const markDone = (label: string) => activeMaterial && !isMaterialDone(activeMaterial.id) && (
    <Button icon="check" onClick={() => completeMaterial(activeMaterial.id)} disabled={completing} className="self-start">
      {completing ? 'Saving…' : label}
    </Button>
  );
  const blank = (text: string) => <p className="p-6 rounded-control bg-page text-sm text-muted text-center">{text}</p>;

  return (
    <div className="flex flex-col gap-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline self-start">
        <Icon name="chevronRight" size={15} strokeWidth={2} className="rotate-180" />Back to my training
      </button>

      {/* Identity band */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2 min-w-0">
          <h2 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">{enrollment.program?.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {enrollment.program && <Badge>{CATEGORY_LABELS[enrollment.program.category]}</Badge>}
            {enrollment.program?.isMandatory && <Badge tone="danger">Required</Badge>}
            {enrollment.dueDate && <Badge tone={isOverdue && !isCompleted ? 'danger' : 'neutral'}>{isOverdue && !isCompleted ? 'Overdue · ' : 'Due '}{fmtDate(enrollment.dueDate)}</Badge>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 sm:w-[220px] shrink-0">
          <div className="flex items-baseline justify-between">
            <span className="text-[26px] font-extrabold text-ink tabular-nums leading-none">{progress}%</span>
            <span className="text-xs text-muted tabular-nums">{doneMats} of {totalMats} done</span>
          </div>
          <ProgressBar pct={progress} color={isCompleted ? 'bg-ok' : 'bg-accent'} label="Course progress" />
        </div>
      </div>

      {isCompleted && (
        <div className="flex items-center gap-3 p-4 rounded-control bg-ok-bg">
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-ok text-on-accent shrink-0"><Icon name="check" size={18} strokeWidth={2.5} /></span>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-ok">Course completed</span>
            <span className="text-[13px] text-ink tabular-nums">
              {fmtDate(enrollment.completedAt)}
              {enrollment.score !== null && enrollment.score !== undefined && ` · score ${enrollment.score}%`}
            </span>
          </div>
        </div>
      )}

      {materials.length === 0 && (
        <Card><EmptyState icon="book" title="Course materials are being prepared" description="Check back soon. Lessons appear here once they are added." /></Card>
      )}

      {materials.length > 0 && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Lesson list */}
        <Card padding="p-0" className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-rule text-[15.5px] font-bold text-ink">Lessons</div>
          <ol className="flex flex-col divide-y divide-rule">
            {materials.map((m, idx) => {
              const done = isMaterialDone(m.id);
              const isActive = activeMaterial?.id === m.id;
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => openMaterial(m)} aria-current={isActive ? 'step' : undefined}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${isActive ? 'bg-tint' : 'hover:bg-page'}`}>
                    <span className={`flex items-center justify-center w-6 h-6 rounded-full border-2 text-xs font-bold shrink-0 ${done ? 'bg-accent border-accent text-on-accent' : isActive ? 'border-accent text-accent' : 'border-rule text-muted'}`}>
                      {done ? <Icon name="check" size={13} strokeWidth={3} /> : idx + 1}
                    </span>
                    <span className="flex flex-col flex-1 min-w-0">
                      <span className={`text-sm truncate ${isActive ? 'font-bold text-ink' : done ? 'text-muted' : 'font-medium text-ink'}`}>{m.title}</span>
                      <span className="text-xs text-muted">{MATERIAL_LABEL[m.type]}{m.durationMins ? ` · ${fmtDuration(m.durationMins)}` : ''}{done ? ' · done' : ''}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>

        {/* Content viewer */}
        <Card className="lg:col-span-2 gap-5">
          {!activeMaterial ? (
            <EmptyState icon="book" title="Pick a lesson to begin" />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-rule">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-muted"><Icon name={MATERIAL_ICONS[activeMaterial.type]} size={14} />{MATERIAL_LABEL[activeMaterial.type]}</span>
                  <h3 className="text-lg font-bold text-ink">{activeMaterial.title}</h3>
                </div>
                {isMaterialDone(activeMaterial.id) && <Badge tone="ok">Completed</Badge>}
              </div>

              {/* VIDEO */}
              {activeMaterial.type === 'VIDEO' && (() => {
                const embedUrl = getVideoEmbed(activeMaterial.url);
                return (
                  <div className="flex flex-col gap-4">
                    {embedUrl ? (
                      <div className="relative w-full overflow-hidden rounded-control bg-shadow" style={{ paddingTop: '56.25%' }}>
                        <iframe
                          src={embedUrl}
                          title={activeMaterial.title}
                          className="absolute inset-0 w-full h-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    ) : activeMaterial.url ? (
                      <video src={activeMaterial.url} controls className="w-full rounded-control bg-shadow max-h-80" />
                    ) : blank('No video link was provided for this lesson.')}
                    {activeMaterial.content && <p className="text-sm text-ink leading-relaxed">{activeMaterial.content}</p>}
                    {markDone('Mark as watched')}
                  </div>
                );
              })()}

              {/* DOCUMENT */}
              {activeMaterial.type === 'DOCUMENT' && (
                <div className="flex flex-col gap-4">
                  {activeMaterial.url && (
                    <a href={activeMaterial.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 h-10 px-4 rounded-control border border-rule bg-paper text-sm font-semibold text-ink hover:bg-pill self-start">
                      <Icon name="file" size={16} />Open document
                    </a>
                  )}
                  {activeMaterial.content ? (
                    <div className="p-5 rounded-control bg-page border border-rule text-sm text-ink leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {activeMaterial.content}
                    </div>
                  ) : blank('No reading material was added to this lesson.')}
                  {markDone('I have read this')}
                </div>
              )}

              {/* LINK */}
              {activeMaterial.type === 'LINK' && (
                <div className="flex flex-col gap-4">
                  {activeMaterial.content && <p className="text-sm text-ink leading-relaxed">{activeMaterial.content}</p>}
                  {activeMaterial.url && (
                    <a
                      href={activeMaterial.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setLinkVisited(true)}
                      className="flex items-center justify-between gap-3 p-4 rounded-control border border-rule bg-page hover:border-accent"
                    >
                      <span className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold text-accent">Open the external resource</span>
                        <span className="text-xs text-muted truncate">{activeMaterial.url}</span>
                      </span>
                      <Icon name="arrowRight" size={18} className="text-accent" />
                    </a>
                  )}
                  {(linkVisited || !activeMaterial.url) && markDone('Mark as visited')}
                  {!isMaterialDone(activeMaterial.id) && activeMaterial.url && !linkVisited && (
                    <p className="text-[13px] text-muted">Open the resource above, then mark it as visited.</p>
                  )}
                </div>
              )}

              {/* QUIZ */}
              {activeMaterial.type === 'QUIZ' && (() => {
                const questions = parseQuiz(activeMaterial.content);
                const done = isMaterialDone(activeMaterial.id);
                const existingScore = enrollment.materialProgress.find(p => p.materialId === activeMaterial.id)?.score;

                if (done && !quizResult) {
                  const passed = existingScore !== null && existingScore !== undefined && existingScore >= passingScore;
                  return (
                    <div className="flex flex-col gap-4">
                      <div className={`flex flex-col items-center gap-1 p-6 rounded-control ${passed ? 'bg-ok-bg' : 'bg-page'}`}>
                        <span className="text-3xl font-extrabold text-ink tabular-nums">{existingScore ?? '—'}%</span>
                        <span className="text-[13px] text-muted">Quiz score</span>
                        {existingScore !== null && existingScore !== undefined && (
                          <span className={`text-sm font-semibold ${passed ? 'text-ok' : 'text-danger'}`}>
                            {passed ? 'Passed' : `Below the pass mark (${passingScore}%)`}
                          </span>
                        )}
                      </div>
                      {questions.length > 0 && (
                        <Button variant="secondary" onClick={() => { setQuizAnswers({}); setQuizResult(null); }} className="self-start">Retake quiz</Button>
                      )}
                    </div>
                  );
                }

                if (quizResult) {
                  return (
                    <div className="flex flex-col gap-4">
                      <div role="status" className={`flex flex-col items-center gap-1.5 p-8 rounded-control ${quizResult.passed ? 'bg-ok-bg' : 'bg-danger-bg'}`}>
                        <span className="text-4xl font-extrabold text-ink tabular-nums">{quizResult.score}%</span>
                        <span className={`text-sm font-semibold ${quizResult.passed ? 'text-ok' : 'text-danger'}`}>
                          {quizResult.passed ? 'Quiz passed. Well done.' : `Not quite. The pass mark is ${passingScore}%.`}
                        </span>
                      </div>
                      {!quizResult.passed && (
                        <Button onClick={() => { setQuizAnswers({}); setQuizResult(null); }} className="self-start">Retake quiz</Button>
                      )}
                    </div>
                  );
                }

                if (questions.length === 0) {
                  return (
                    <div className="flex flex-col gap-4">
                      {blank('No quiz questions have been set up yet.')}
                      {!done && markDone('Mark as complete')}
                    </div>
                  );
                }

                const allAnswered = questions.every(q => quizAnswers[q.id] !== undefined);
                return (
                  <div className="flex flex-col gap-5">
                    <span className="text-[13px] text-muted tabular-nums">{questions.length} question{questions.length !== 1 ? 's' : ''} · pass mark {passingScore}%</span>
                    {questions.map((q, qi) => (
                      <fieldset key={q.id} className="flex flex-col gap-2.5">
                        <legend className="text-sm font-semibold text-ink mb-1"><span className="tabular-nums">{qi + 1}.</span> {q.text}</legend>
                        {q.options.map((opt, oi) => {
                          const on = quizAnswers[q.id] === oi;
                          return (
                            <label key={oi} className={`flex items-center gap-3 p-3.5 rounded-control border cursor-pointer transition-colors ${on ? 'border-accent bg-tint' : 'border-rule bg-paper hover:bg-page'}`}>
                              <input
                                type="radio"
                                name={`q_${q.id}`}
                                checked={on}
                                onChange={() => setQuizAnswers(a => ({ ...a, [q.id]: oi }))}
                                className="w-4 h-4 accent-accent shrink-0"
                              />
                              <span className="text-sm text-ink">{opt}</span>
                            </label>
                          );
                        })}
                      </fieldset>
                    ))}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button onClick={() => completeMaterial(activeMaterial.id, quizAnswers)} disabled={completing || !allAnswered}
                        reason={!allAnswered && !completing ? 'Answer every question to submit' : undefined}>
                        {completing ? 'Submitting…' : 'Submit quiz'}
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </Card>
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
    <div className="flex flex-col gap-3">
      {[1, 2, 3].map(i => <Skeleton key={i} />)}
    </div>
  );

  if (error) return <ErrorPanel title="Could not load your training" message={error} onRetry={load} />;

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
      <Card>
        <EmptyState icon="book" title="No training assigned yet" description="Browse the available programmes to enrol in one." />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="In progress" value={inProgress.length} />
        <Stat label="Completed" value={completed.length} />
        <Stat label="Not started" value={notStarted.length} />
        <Stat label="Overdue" value={overdue.length} note={overdue.length > 0 ? 'Past the due date' : 'Nothing overdue'} />
      </div>

      {mandatory.length > 0 && (
        <div role="note" className="flex items-start gap-3 p-4 rounded-control border border-rule bg-danger-bg">
          <Icon name="alert" size={18} className="text-danger mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-danger">{mandatory.length} mandatory course{mandatory.length !== 1 ? 's' : ''} to complete</span>
            <span className="text-[13px] text-ink">{mandatory.map(e => e.program?.title).join(' · ')}</span>
          </div>
        </div>
      )}

      {inProgress.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15.5px] font-bold text-ink">Continue learning</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {inProgress.map(e => <EnrollmentCard key={e.id} e={e} onOpen={() => setActiveEnrollment(e)} />)}
          </div>
        </section>
      )}

      {notStarted.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15.5px] font-bold text-ink">Start learning</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {notStarted.map(e => <EnrollmentCard key={e.id} e={e} onOpen={() => setActiveEnrollment(e)} />)}
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[15.5px] font-bold text-ink">Completed <span className="text-muted font-semibold tabular-nums">{completed.length}</span></h2>
          <Card padding="p-0" className="divide-y divide-rule overflow-hidden">
            {completed.map(e => (
              <div key={e.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-ok-bg text-ok shrink-0"><Icon name="check" size={17} strokeWidth={2.5} /></span>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-sm font-semibold text-ink truncate">{e.program?.title}</span>
                  <span className="text-xs text-muted tabular-nums">
                    {e.program ? `${CATEGORY_LABELS[e.program.category]} · ` : ''}completed {fmtDate(e.completedAt)}
                    {e.score !== null && e.score !== undefined && ` · score ${e.score}%`}
                  </span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setActiveEnrollment(e)}>Review</Button>
              </div>
            ))}
          </Card>
        </section>
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
    <Card className="gap-4">
      <div className="flex flex-col gap-1.5 min-w-0">
        <h3 className="text-[15.5px] font-bold text-ink leading-snug">{e.program?.title}</h3>
        {e.program?.description && <p className="text-[13px] text-muted leading-relaxed line-clamp-2">{e.program.description}</p>}
        <div className="flex flex-wrap gap-1.5 mt-0.5">
          {e.program && <Badge>{CATEGORY_LABELS[e.program.category]}</Badge>}
          {e.program?.isMandatory && <Badge tone="danger">Required</Badge>}
          {e.dueDate && <Badge tone={isOverdue ? 'danger' : 'neutral'}>{isOverdue ? 'Overdue · ' : 'Due '}{fmtDate(e.dueDate)}</Badge>}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center text-xs text-muted tabular-nums">
          <span>{done} of {total} lessons</span>
          <span className="font-semibold text-ink">{e.progress}%</span>
        </div>
        <ProgressBar pct={e.progress} color={isOverdue ? 'bg-danger' : 'bg-accent'} label={`${e.program?.title ?? 'Course'} progress`} />
      </div>

      <Button onClick={onOpen} className="w-full mt-auto" icon={e.status === 'COMPLETED' ? 'check' : 'arrowRight'} variant={e.status === 'COMPLETED' ? 'secondary' : 'primary'}>
        {isNew ? 'Start course' : e.status === 'COMPLETED' ? 'Review course' : 'Continue'}
      </Button>
    </Card>
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

  if (error) return <ErrorPanel title="Could not load programmes" message={error} onRetry={load} />;

  return (
    <div className="flex flex-col gap-4">
      <FilterChips<ProgramCategory | ''>
        label="Category"
        items={[{ id: '', label: 'All' }, ...(Object.keys(CATEGORY_LABELS) as ProgramCategory[]).map(c => ({ id: c, label: CATEGORY_LABELS[c] }))]}
        active={category}
        onChange={setCategory}
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[1, 2, 3].map(i => <Skeleton key={i} h="h-56" />)}</div>
      ) : programs.length === 0 ? (
        <Card><EmptyState icon="book" title="No programmes available" description={category ? 'Nothing in this category yet. Try another.' : 'Published programmes will appear here.'} /></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {programs.map(p => (
            <ProgramCard key={p.id} prog={p} onEnroll={handleEnroll} onStartCourse={onGoToMyTraining} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── CertificationsTab ─────────────────────────────────────────────────────────
type CertStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'REVOKED';

interface EmployeeCertification {
  id: string; employeeId: string; certName: string; issuingBody?: string;
  certNumber?: string; issuedAt?: string; expiresAt?: string;
  status: CertStatus; documentUrl?: string; notes?: string; createdAt: string;
}

const CERT_STATUS_TONE: Record<CertStatus, BadgeTone> = {
  ACTIVE:         'ok',
  EXPIRING_SOON:  'warn',
  EXPIRED:        'danger',
  REVOKED:        'neutral',
};
const CERT_STATUS_LABEL: Record<CertStatus, string> = {
  ACTIVE: 'Active',
  EXPIRING_SOON: 'Expiring soon',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};

function CertificationsTab() {
  const [certs, setCerts] = useState<EmployeeCertification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ employeeId: '', certName: '', issuingBody: '', certNumber: '', issuedAt: '', expiresAt: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const { toast } = useToast();

  // Same messages as before; failures now read as failures.
  function showToast(msg: string, tone: 'ok' | 'danger' = 'ok') { toast(msg, tone); }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filterStatus ? `?status=${filterStatus}` : '';
      const data = await apiFetch(`/training/certifications${params}`);
      setCerts(Array.isArray(data) ? data : []);
    } catch {}
    finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!form.employeeId || !form.certName) return;
    setSubmitting(true);
    try {
      await apiFetch('/training/certifications', {
        method: 'POST',
        body: JSON.stringify({ ...form, issuedAt: form.issuedAt || null, expiresAt: form.expiresAt || null }),
      });
      setShowAdd(false);
      setForm({ employeeId: '', certName: '', issuingBody: '', certNumber: '', issuedAt: '', expiresAt: '', notes: '' });
      showToast('Certification added');
      await load();
    } catch { showToast('Failed to add certification', 'danger'); }
    finally { setSubmitting(false); }
  }

  async function handleRevoke(id: string) {
    try {
      await apiFetch(`/training/certifications/${id}`, { method: 'DELETE' });
      showToast('Certification revoked');
      await load();
    } catch { showToast('Failed to revoke', 'danger'); }
  }

  const expiringSoon = certs.filter(c => c.status === 'EXPIRING_SOON').length;
  const addMissing = !form.employeeId || !form.certName;

  const columns: Column<EmployeeCertification>[] = [
    { key: 'emp', label: 'Employee', width: '110px', numeric: true, render: c => <span className="text-muted">{c.employeeId.slice(0, 8)}…</span> },
    {
      key: 'cert', label: 'Certificate', width: 'minmax(0, 1.6fr)',
      render: c => (
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-ink truncate">{c.certName}</span>
          {c.notes && <span className="text-xs text-muted truncate">{c.notes}</span>}
        </div>
      ),
    },
    { key: 'body', label: 'Issued by', width: 'minmax(0, 1fr)', render: c => c.issuingBody || <span className="text-muted">—</span> },
    { key: 'num', label: 'Number', width: '120px', numeric: true, render: c => c.certNumber || <span className="text-muted">—</span> },
    { key: 'issued', label: 'Issued', width: '110px', numeric: true, render: c => fmtDate(c.issuedAt) },
    { key: 'exp', label: 'Expires', width: '110px', numeric: true, render: c => fmtDate(c.expiresAt) },
    { key: 'status', label: 'Status', width: '130px', render: c => <Badge tone={CERT_STATUS_TONE[c.status]}>{CERT_STATUS_LABEL[c.status]}</Badge> },
    { key: 'act', label: '', width: '90px', align: 'right', render: c => c.status !== 'REVOKED' ? <Button size="sm" variant="danger" onClick={() => handleRevoke(c.id)}>Revoke</Button> : null },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[15.5px] font-bold text-ink">Certifications</h2>
          {expiringSoon > 0 && <Badge tone="warn">{expiringSoon} expiring soon</Badge>}
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          <Field label="Status" className="w-[180px]">
            <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="EXPIRING_SOON">Expiring soon</option>
              <option value="EXPIRED">Expired</option>
              <option value="REVOKED">Revoked</option>
            </Select>
          </Field>
          <Button icon="plus" onClick={() => setShowAdd(true)}>Add certification</Button>
        </div>
      </div>

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add certification"
        footer={<>
          <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={submitting || addMissing} reason={addMissing && !submitting ? 'Employee and certificate name are required' : undefined}>{submitting ? 'Adding…' : 'Add'}</Button>
        </>}
      >
        <div className="flex flex-col gap-4">
          {[
            { label: 'Employee ID', key: 'employeeId', placeholder: 'Employee UUID', required: true },
            { label: 'Certificate name', key: 'certName', placeholder: 'e.g. WSH Officer Certificate', required: true },
            { label: 'Issuing body', key: 'issuingBody', placeholder: 'e.g. MOM Singapore' },
            { label: 'Certificate number', key: 'certNumber', placeholder: 'Optional' },
          ].map(f => (
            <Field key={f.key} label={f.label} required={f.required}>
              <Input type="text" placeholder={f.placeholder} value={(form as any)[f.key]}
                onChange={e => setForm(fm => ({ ...fm, [f.key]: e.target.value }))} />
            </Field>
          ))}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Issued on">
              <Input type="date" value={form.issuedAt} onChange={e => setForm(f => ({ ...f, issuedAt: e.target.value }))} />
            </Field>
            <Field label="Expires on">
              <Input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>
        </div>
      </Modal>

      {loading ? (
        <div className="flex flex-col gap-2">{[1, 2, 3].map(i => <Skeleton key={i} h="h-[52px]" />)}</div>
      ) : (
        <DataTable
          aria-label="Certifications"
          columns={columns}
          rows={certs}
          rowKey={c => c.id}
          empty={<EmptyState icon="shield" title="No certifications" description={filterStatus ? 'Nothing with this status.' : 'Record licences and certificates so expiries are tracked.'} action={<Button icon="plus" onClick={() => setShowAdd(true)}>Add certification</Button>} className="py-6" />}
          mobileCard={c => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-ink">{c.certName}</span>
                <Badge tone={CERT_STATUS_TONE[c.status]}>{CERT_STATUS_LABEL[c.status]}</Badge>
              </div>
              <span className="text-xs text-muted tabular-nums">{c.issuingBody || 'Issuer not recorded'} · expires {fmtDate(c.expiresAt)} · {c.employeeId.slice(0, 8)}…</span>
              {c.status !== 'REVOKED' && <div><Button size="sm" variant="danger" onClick={() => handleRevoke(c.id)}>Revoke</Button></div>}
            </div>
          )}
        />
      )}
    </div>
  );
}

// ── Root page ─────────────────────────────────────────────────────────────────
const TAB_LABEL: Record<string, string> = {
  'Programs': 'Programmes', 'Enrollments': 'Enrolments', 'Certifications': 'Certifications',
  'Stats': 'Stats', 'My Training': 'My training', 'Browse Programs': 'Browse programmes',
};

export default function TrainingPage() {
  const { user, loading: authLoading } = useAuth();
  const role = user?.role ?? '';
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'].includes(role);
  const isManager = role === 'MANAGER';
  const isEmployee = !isPrivileged && !isManager;

  const adminTabs = ['Programs', 'Enrollments', 'Certifications', 'Stats', 'My Training', 'Browse Programs'] as const;
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

  // "My Training" nav links to /training?view=me — land admins on their own
  // training tab; the admin "Training" nav (no param) keeps the Programs view.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'me') setAdminTab('My Training');
  }, []);

  if (authLoading) {
    return <div className="max-w-[1400px] mx-auto"><Skeleton h="h-40" /></div>;
  }

  // ── Employee layout ─────────────────────────────────────────────────────────
  if (isEmployee) {
    return (
      <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-24 lg:pb-10">
        <PageHeader title="My training" subtitle={`${firstName}, here are your enrolled courses and the programmes you can join.`} />
        <Tabs items={empTabs.map(t => ({ id: t, label: TAB_LABEL[t] }))} active={empTab} onChange={setEmpTab} />
        <div>
          {empTab === 'My Training'     && <MyTrainingTab />}
          {empTab === 'Browse Programs' && <BrowseProgramsTab onGoToMyTraining={() => setEmpTab('My Training')} />}
        </div>
      </div>
    );
  }

  // ── Admin / Manager layout ──────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-24 lg:pb-10">
      <PageHeader
        title="Training"
        subtitle={stats ? `${stats.published} published · ${stats.mandatory} mandatory · ${stats.completionRate}% completion` : 'Programmes, lessons, enrolments and certifications.'}
      />
      <Tabs items={adminTabs.map(t => ({ id: t, label: TAB_LABEL[t] }))} active={adminTab} onChange={setAdminTab} />
      <div>
        {adminTab === 'Programs'        && <AdminProgramsTab onRefreshStats={loadStats} />}
        {adminTab === 'Enrollments'     && <AdminEnrollmentsTab />}
        {adminTab === 'Certifications'  && <CertificationsTab />}
        {adminTab === 'Stats'           && <StatsTab stats={stats} />}
        {adminTab === 'My Training'     && <MyTrainingTab />}
        {adminTab === 'Browse Programs' && <BrowseProgramsTab onGoToMyTraining={() => setAdminTab('My Training')} />}
      </div>
    </div>
  );
}
