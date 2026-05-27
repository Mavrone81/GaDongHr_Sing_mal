'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];

const STATUS_COLORS: Record<string, string> = {
  DRAFT:  'bg-slate-100 text-slate-600',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-amber-100 text-amber-700',
};

const QUESTION_TYPES = [
  { value: 'LIKERT_5',     label: '5-Point Likert Scale' },
  { value: 'NPS',          label: 'NPS (0–10 Recommend)' },
  { value: 'MULTI_CHOICE', label: 'Multiple Choice' },
  { value: 'TEXT',         label: 'Free Text' },
];

export default function SurveyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isHr = HR_ROLES.includes(role);
  const isMgrOrHr = isHr || role === 'LINE_MANAGER';

  const [survey, setSurvey] = useState<any>(null);
  const [dashboard, setDashboard] = useState<any>(null);
  const [actions, setActions] = useState<any[]>([]);
  const [tab, setTab] = useState<'questions' | 'results' | 'actions'>('questions');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showQModal, setShowQModal] = useState(false);
  const [showActionModal, setShowActionModal] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch(`/surveys/${id}`);
      if (!res.ok) { const e = await res.json(); setError(e.error || 'Failed'); return; }
      const s = await res.json();
      setSurvey(s);
      if (isHr) {
        const [dashRes, actRes] = await Promise.all([
          apiFetch(`/surveys/${id}/dashboard`).then(r => r.json()).catch(() => null),
          apiFetch(`/surveys/${id}/actions`).then(r => r.json()).catch(() => ({ actions: [] })),
        ]);
        setDashboard(dashRes);
        setActions(actRes.actions || []);
      } else {
        const actRes = await apiFetch(`/surveys/${id}/actions`).then(r => r.json()).catch(() => ({ actions: [] }));
        setActions(actRes.actions || []);
      }
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id, isHr]);

  async function publish() {
    if (!confirm('Publish this survey? Employees will be able to respond.')) return;
    const res = await apiFetch(`/surveys/${id}/publish`, { method: 'POST' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }
  async function close() {
    if (!confirm('Close this survey? No further responses will be accepted.')) return;
    const res = await apiFetch(`/surveys/${id}/close`, { method: 'POST' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }
  async function deleteQuestion(qid: string) {
    if (!confirm('Delete this question?')) return;
    const res = await apiFetch(`/surveys/${id}/questions/${qid}`, { method: 'DELETE' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }
  if (error || !survey) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <h2 className="text-lg font-black text-slate-800 mb-2">Survey Not Found</h2>
        <p className="text-sm text-slate-500 mb-6">{error}</p>
        <Link href="/surveys" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">← Back</Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/surveys" className="text-xs font-bold text-slate-500 hover:text-indigo-600">← Back to Surveys</Link>
        <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[survey.status]}`}>{survey.status}</span>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
        <p className="text-xs font-mono font-black text-slate-400 mb-1">{survey.code}</p>
        <h1 className="text-xl font-black text-slate-900 mb-1">{survey.title}</h1>
        {survey.description && <p className="text-sm text-slate-600 mt-2">{survey.description}</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 text-xs">
          <Meta label="Type" value={survey.type} />
          <Meta label="Anonymous" value={survey.anonymous ? 'Yes' : 'No'} />
          <Meta label="Min Responses" value={String(survey.minResponsesToShow)} />
          {survey.openedAt && <Meta label="Opened" value={new Date(survey.openedAt).toLocaleDateString('en-SG')} />}
          {survey.closedAt && <Meta label="Closed" value={new Date(survey.closedAt).toLocaleDateString('en-SG')} />}
          {survey.dueDate && <Meta label="Due" value={new Date(survey.dueDate).toLocaleDateString('en-SG')} />}
        </div>

        {/* HR action bar */}
        {isHr && (
          <div className="mt-5 flex flex-wrap gap-2 pt-4 border-t border-slate-100">
            {survey.status === 'DRAFT' && (
              <>
                <button onClick={() => setShowQModal(true)} className="px-4 py-2 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">+ Add Question</button>
                <button onClick={publish} className="px-4 py-2 text-xs font-bold text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50">Publish</button>
              </>
            )}
            {survey.status === 'ACTIVE' && (
              <button onClick={close} className="px-4 py-2 text-xs font-bold text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50">Close Survey</button>
            )}
            {survey.status === 'ACTIVE' && (
              <Link href={`/surveys/${id}/take`} className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Take Survey →</Link>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {(['questions', 'results', 'actions'] as const).filter(t => isHr || t !== 'results').map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all border-b-2 -mb-px whitespace-nowrap ${
              tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'questions' ? `Questions (${survey.questions?.length || 0})` :
             t === 'results'   ? `Results (${dashboard?.totalResponses || 0})` :
                                 `Actions (${actions.length})`}
          </button>
        ))}
      </div>

      {/* Questions tab */}
      {tab === 'questions' && (
        <div className="space-y-3">
          {survey.questions?.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
              No questions yet. {isHr && 'Add your first question to begin.'}
            </div>
          ) : (
            survey.questions.map((q: any, i: number) => (
              <div key={q.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono font-black text-slate-400">Q{i + 1}</span>
                      <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-slate-100 text-slate-600">{q.type}</span>
                      {q.required && <span className="text-[10px] font-black text-red-500 uppercase">Required</span>}
                    </div>
                    <p className="text-sm text-slate-800 font-medium">{q.text}</p>
                    {q.choices?.length > 0 && (
                      <ul className="mt-2 text-xs text-slate-500 list-disc list-inside">
                        {q.choices.map((c: string, ci: number) => <li key={ci}>{c}</li>)}
                      </ul>
                    )}
                  </div>
                  {isHr && survey.status === 'DRAFT' && (
                    <button onClick={() => deleteQuestion(q.id)} className="text-xs font-bold text-red-500 hover:text-red-600">Delete</button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Results tab — HR only */}
      {tab === 'results' && isHr && (
        <div className="space-y-4">
          {!dashboard ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">No data yet.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Responses" value={dashboard.totalResponses} accent="indigo" />
                <StatCard label="Min Threshold" value={dashboard.minN} accent="slate" />
                {Object.entries(dashboard.segments?.byDepartment || {}).slice(0, 2).map(([k, v]) => (
                  <StatCard key={k} label={k} value={v as number} accent="emerald" />
                ))}
              </div>
              {dashboard.suppressed && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                  Aggregates are suppressed — total responses ({dashboard.totalResponses}) below the minimum threshold ({dashboard.minN}). Encourage more responses to unlock the dashboard.
                </div>
              )}
              {dashboard.perQuestion.map((qs: any, i: number) => (
                <QuestionResultCard key={qs.questionId} num={i + 1} q={qs} />
              ))}
              {dashboard.segments?.byDepartment && Object.keys(dashboard.segments.byDepartment).length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
                  <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-3">Responses by Department</h3>
                  <div className="space-y-2">
                    {Object.entries(dashboard.segments.byDepartment).map(([dept, n]) => (
                      <div key={dept} className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-700 w-32 shrink-0">{dept}</span>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, ((n as number) / dashboard.totalResponses) * 100)}%` }} />
                        </div>
                        <span className="text-xs font-bold text-slate-500 w-10 text-right">{n as number}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Actions tab */}
      {tab === 'actions' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            {isMgrOrHr && (
              <button onClick={() => setShowActionModal(true)} className="px-4 py-2 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">+ Add Action</button>
            )}
          </div>
          {actions.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">No follow-up actions yet.</div>
          ) : (
            actions.map(a => (
              <div key={a.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${
                        a.status === 'OPEN' ? 'bg-blue-100 text-blue-700' :
                        a.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700' :
                        a.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' :
                                              'bg-slate-100 text-slate-600'
                      }`}>{a.status}</span>
                      {a.department && <span className="text-xs text-slate-500">{a.department}</span>}
                    </div>
                    <h4 className="text-sm font-black text-slate-800">{a.title}</h4>
                    {a.description && <p className="text-xs text-slate-500 mt-1">{a.description}</p>}
                    <p className="text-[10px] text-slate-400 mt-2">By {a.managerName || a.managerId}{a.dueDate ? ` · Due ${new Date(a.dueDate).toLocaleDateString('en-SG')}` : ''}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {showQModal && (
        <QuestionModal surveyId={survey.id} onClose={() => setShowQModal(false)} onSuccess={() => { setShowQModal(false); load(); }} />
      )}
      {showActionModal && (
        <ActionModal surveyId={survey.id} onClose={() => setShowActionModal(false)} onSuccess={() => { setShowActionModal(false); load(); }} />
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-slate-700 mt-0.5">{value}</p>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  const colorMap: Record<string, string> = {
    indigo: 'text-indigo-700', slate: 'text-slate-700', emerald: 'text-emerald-700',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-2xl font-black ${colorMap[accent] || 'text-slate-700'}`}>{value}</p>
    </div>
  );
}

function QuestionResultCard({ num, q }: { num: number; q: any }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
      <div className="flex items-start gap-2 mb-3">
        <span className="text-xs font-mono font-black text-slate-400">Q{num}</span>
        <h4 className="text-sm font-black text-slate-800 flex-1">{q.text}</h4>
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{q.type}</span>
      </div>
      {q.stats?.suppressed ? (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
          ◍ {q.stats.reason}
        </div>
      ) : q.type === 'LIKERT_5' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-3xl font-black text-indigo-700">{q.stats.average?.toFixed(2)}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Avg / 5</p>
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-emerald-600">{q.stats.positivePct}% positive (≥ 4)</p>
              <p className="text-[10px] text-slate-400 mt-1">{q.stats.total} responses</p>
            </div>
          </div>
          <div className="space-y-1">
            {[5,4,3,2,1].map(n => {
              const count = q.stats.distribution?.[n] || 0;
              const pct = Math.round((count / Math.max(q.stats.total, 1)) * 100);
              return (
                <div key={n} className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-slate-500 w-3">{n}</span>
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="font-bold text-slate-500 w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : q.type === 'NPS' ? (
        <div>
          <div className="flex items-baseline gap-3 mb-3">
            <p className={`text-4xl font-black ${q.stats.score > 30 ? 'text-emerald-700' : q.stats.score > 0 ? 'text-amber-700' : 'text-rose-700'}`}>
              {q.stats.score}
            </p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">eNPS Score</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-2 bg-emerald-50 rounded-lg">
              <p className="font-black text-emerald-700">{q.stats.promoters}</p>
              <p className="text-[10px] text-emerald-600 font-bold">Promoters (9-10)</p>
            </div>
            <div className="p-2 bg-amber-50 rounded-lg">
              <p className="font-black text-amber-700">{q.stats.passives}</p>
              <p className="text-[10px] text-amber-600 font-bold">Passives (7-8)</p>
            </div>
            <div className="p-2 bg-rose-50 rounded-lg">
              <p className="font-black text-rose-700">{q.stats.detractors}</p>
              <p className="text-[10px] text-rose-600 font-bold">Detractors (0-6)</p>
            </div>
          </div>
        </div>
      ) : q.type === 'MULTI_CHOICE' ? (
        <div className="space-y-1">
          {(q.choices || []).map((choice: string, i: number) => {
            const count = q.stats.counts[i] || 0;
            const pct   = q.stats.percentages[i] || 0;
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-bold text-slate-700 flex-1 min-w-0 truncate">{choice}</span>
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="font-bold text-slate-500 w-12 text-right">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      ) : q.type === 'TEXT' ? (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {(q.stats.comments || []).slice(0, 20).map((c: string, i: number) => (
            <p key={i} className="p-2 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-700 italic">"{c}"</p>
          ))}
          {q.stats.total > 20 && <p className="text-[10px] text-slate-400 italic">…{q.stats.total - 20} more</p>}
        </div>
      ) : null}
    </div>
  );
}

// ─── Question Modal ──────────────────────────────────────────────────────────
function QuestionModal({ surveyId, onClose, onSuccess }: { surveyId: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    type: 'LIKERT_5', text: '', required: true, displayOrder: 0,
    choices: '', category: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const body: any = {
      type: form.type, text: form.text, required: form.required,
      displayOrder: parseInt(String(form.displayOrder)) || 0,
      category: form.category || null,
    };
    if (form.type === 'MULTI_CHOICE') {
      body.choices = form.choices.split('\n').map(s => s.trim()).filter(Boolean);
    }
    const res = await apiFetch(`/surveys/${surveyId}/questions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal title="Add Question" onClose={onClose}>
      <Field label="Question Type" required>
        <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input">
          {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>
      <Field label="Question Text" required>
        <textarea rows={3} value={form.text} onChange={e => setForm({...form, text: e.target.value})} className="input resize-none" />
      </Field>
      {form.type === 'MULTI_CHOICE' && (
        <Field label="Choices (one per line)" required>
          <textarea rows={4} value={form.choices} onChange={e => setForm({...form, choices: e.target.value})} className="input resize-none" placeholder="Option 1&#10;Option 2&#10;Option 3" />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Order">
          <input type="number" value={form.displayOrder} onChange={e => setForm({...form, displayOrder: parseInt(e.target.value) || 0})} className="input" />
        </Field>
        <Field label="Category">
          <input value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="input" placeholder="e.g. engagement" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.required} onChange={e => setForm({...form, required: e.target.checked})} />
        Required
      </label>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
      <ModalFooter onSave={save} onClose={onClose} saving={saving} saveLabel="Add Question" disabled={!form.text.trim()} />
    </Modal>
  );
}

function ActionModal({ surveyId, onClose, onSuccess }: { surveyId: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', department: '', dueDate: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const body: any = { title: form.title, description: form.description, department: form.department || null };
    if (form.dueDate) body.dueDate = form.dueDate;
    const res = await apiFetch(`/surveys/${surveyId}/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal title="Add Follow-up Action" onClose={onClose}>
      <Field label="Title" required>
        <input value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="input" />
      </Field>
      <Field label="Description">
        <textarea rows={3} value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input resize-none" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Department">
          <input value={form.department} onChange={e => setForm({...form, department: e.target.value})} className="input" />
        </Field>
        <Field label="Due Date">
          <input type="date" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} className="input" />
        </Field>
      </div>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
      <ModalFooter onSave={save} onClose={onClose} saving={saving} saveLabel="Create Action" disabled={!form.title.trim()} />
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 sticky top-0 bg-white flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-lg">×</button>
        </div>
        <div className="p-6 space-y-4">{children}</div>
      </div>
      <style jsx>{`
        :global(.input) { width: 100%; border: 1px solid rgb(226 232 240); border-radius: 0.75rem; padding: 0.6rem 0.9rem; font-size: 0.875rem; outline: none; }
        :global(.input:focus) { border-color: rgb(99 102 241); box-shadow: 0 0 0 2px rgba(99,102,241,0.15); }
      `}</style>
    </div>
  );
}
function ModalFooter({ onSave, onClose, saving, saveLabel, disabled }: any) {
  return (
    <div className="flex gap-3 pt-1">
      <button onClick={onSave} disabled={saving || disabled} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
        {saving ? 'Saving…' : saveLabel}
      </button>
      <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
    </div>
  );
}
function Field({ label, required, children }: any) {
  return (
    <div>
      <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}
