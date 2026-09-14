'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Badge, Button, Tabs, Stat, Modal, Field, Input, Select, Textarea, EmptyState, Icon } from '@/components/ui';
import type { BadgeTone } from '@/components/ui';

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];

const STATUS_TONE: Record<string, BadgeTone> = {
  DRAFT:  'neutral',
  ACTIVE: 'ok',
  CLOSED: 'accent',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', ACTIVE: 'Active', CLOSED: 'Closed',
};

/** Follow-up actions: open waits, in progress is moving, done is settled. */
const ACTION_STATUS_TONE: Record<string, BadgeTone> = {
  OPEN:        'neutral',
  IN_PROGRESS: 'accent',
  DONE:        'ok',
};

const TYPE_LABEL: Record<string, string> = {
  ANNUAL: 'Annual engagement', PULSE: 'Pulse', EXIT: 'Exit', CUSTOM: 'Custom',
};

const QUESTION_TYPES = [
  { value: 'LIKERT_5',     label: '5-point Likert scale' },
  { value: 'NPS',          label: 'NPS (0–10, how likely to recommend)' },
  { value: 'MULTI_CHOICE', label: 'Multiple choice' },
  { value: 'TEXT',         label: 'Free text' },
];

const QUESTION_TYPE_SHORT: Record<string, string> = {
  LIKERT_5: '5-point scale', NPS: 'NPS', MULTI_CHOICE: 'Multiple choice', TEXT: 'Free text',
};

/** IN_PROGRESS → "In progress"; anything unmapped still reads as a word. */
const sentence = (raw: string) => {
  const s = String(raw || '').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-SG');

const LINK_BUTTON = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-control border border-rule bg-paper text-sm font-semibold text-ink whitespace-nowrap hover:bg-pill';

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
      const res = await apiFetchRaw(`/surveys/${id}`);
      if (!res.ok) { const e = await res.json(); setError(e.error || 'Failed'); return; }
      const s = await res.json();
      setSurvey(s);
      if (isHr) {
        const [dashRes, actRes] = await Promise.all([
          apiFetchRaw(`/surveys/${id}/dashboard`).then(r => r.json()).catch(() => null),
          apiFetchRaw(`/surveys/${id}/actions`).then(r => r.json()).catch(() => ({ actions: [] })),
        ]);
        setDashboard(dashRes);
        setActions(actRes.actions || []);
      } else {
        const actRes = await apiFetchRaw(`/surveys/${id}/actions`).then(r => r.json()).catch(() => ({ actions: [] }));
        setActions(actRes.actions || []);
      }
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id, isHr]);

  async function publish() {
    if (!confirm('Publish this survey? Employees will be able to respond.')) return;
    const res = await apiFetchRaw(`/surveys/${id}/publish`, { method: 'POST' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }
  async function close() {
    if (!confirm('Close this survey? No further responses will be accepted.')) return;
    const res = await apiFetchRaw(`/surveys/${id}/close`, { method: 'POST' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }
  async function deleteQuestion(qid: string) {
    if (!confirm('Delete this question?')) return;
    const res = await apiFetchRaw(`/surveys/${id}/questions/${qid}`, { method: 'DELETE' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-9 h-9 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading survey" />
      </div>
    );
  }
  if (error || !survey) {
    return (
      <Card padding="p-0" className="max-w-2xl mx-auto mt-10">
        <EmptyState
          icon="alert"
          title="Survey not found"
          description={error || 'It may have been deleted, or you may not have access to it.'}
          action={<Link href="/surveys" className={LINK_BUTTON}>Back to surveys</Link>}
        />
      </Card>
    );
  }

  const questionCount = survey.questions?.length || 0;
  const tabs = [
    { id: 'questions' as const, label: 'Questions', count: questionCount },
    ...(isHr ? [{ id: 'results' as const, label: 'Results', count: dashboard?.totalResponses || 0 }] : []),
    { id: 'actions' as const, label: 'Actions', count: actions.length },
  ];

  return (
    <div className="flex flex-col gap-5 max-w-5xl mx-auto w-full pb-10">
      <Link href="/surveys" className="self-start inline-flex items-center gap-1.5 h-8 -ml-1 px-1 rounded-control text-[13px] font-semibold text-muted hover:text-accent">
        <Icon name="chevronRight" size={16} className="rotate-180" /> All surveys
      </Link>

      {/* Identity band */}
      <Card padding="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Badge tone={STATUS_TONE[survey.status] ?? 'neutral'}>{STATUS_LABEL[survey.status] ?? sentence(survey.status)}</Badge>
              <span className="text-[13px] text-muted">{survey.code}</span>
            </div>
            <h1 className="text-[26px] font-extrabold tracking-[-0.02em] leading-[1.15] text-ink">{survey.title}</h1>
            {survey.description && <p className="text-sm text-muted mt-2 max-w-2xl">{survey.description}</p>}
          </div>

          {isHr && (
            <div className="flex flex-wrap gap-2.5 shrink-0">
              {survey.status === 'DRAFT' && (
                <>
                  <Button variant="secondary" icon="plus" onClick={() => setShowQModal(true)}>Add question</Button>
                  <Button onClick={publish}>Publish</Button>
                </>
              )}
              {survey.status === 'ACTIVE' && (
                <>
                  <Link href={`/surveys/${id}/take`} className={LINK_BUTTON}>Take survey</Link>
                  <Button variant="danger" onClick={close}>Close survey</Button>
                </>
              )}
            </div>
          )}
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-5 pt-5 border-t border-rule">
          <Meta label="Type" value={TYPE_LABEL[survey.type] ?? sentence(survey.type)} />
          <Meta label="Anonymous" value={survey.anonymous ? 'Yes' : 'No'} />
          <Meta label="Minimum responses" value={String(survey.minResponsesToShow)} />
          {survey.openedAt && <Meta label="Opened" value={fmt(survey.openedAt)} />}
          {survey.closedAt && <Meta label="Closed" value={fmt(survey.closedAt)} />}
          {survey.dueDate && <Meta label="Due" value={fmt(survey.dueDate)} />}
        </dl>
      </Card>

      <Tabs items={tabs} active={tab} onChange={setTab} />

      {/* Questions tab */}
      {tab === 'questions' && (
        survey.questions?.length === 0 ? (
          <Card padding="p-0">
            <EmptyState
              icon="list"
              title="No questions yet"
              description={isHr && survey.status === 'DRAFT' ? 'Add the first question to this draft.' : 'This survey has no questions.'}
              action={isHr && survey.status === 'DRAFT' ? <Button variant="secondary" icon="plus" onClick={() => setShowQModal(true)}>Add question</Button> : undefined}
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {survey.questions.map((q: any, i: number) => (
              <Card key={q.id} padding="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-[13px] font-bold text-muted tabular-nums">Q{i + 1}</span>
                      <Badge tone="neutral">{QUESTION_TYPE_SHORT[q.type] ?? sentence(q.type)}</Badge>
                      {q.required && <Badge tone="accent">Required</Badge>}
                    </div>
                    <p className="text-sm font-semibold text-ink">{q.text}</p>
                    {q.choices?.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1 text-[13px] text-muted list-disc list-inside">
                        {q.choices.map((c: string, ci: number) => <li key={ci}>{c}</li>)}
                      </ul>
                    )}
                  </div>
                  {isHr && survey.status === 'DRAFT' && (
                    <Button variant="danger" size="sm" onClick={() => deleteQuestion(q.id)} aria-label={`Delete question ${i + 1}`}>Delete</Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {/* Results tab — HR only */}
      {tab === 'results' && isHr && (
        !dashboard ? (
          <Card padding="p-0">
            <EmptyState icon="chart" title="No results yet" description="Results appear here once people start responding." />
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Responses" value={dashboard.totalResponses} />
              <Stat label="Minimum to show" value={dashboard.minN} />
              {Object.entries(dashboard.segments?.byDepartment || {}).slice(0, 2).map(([k, v]) => (
                <Stat key={k} label={k} value={v as number} note="responses" />
              ))}
            </div>
            {dashboard.suppressed && (
              <div role="status" className="flex items-start gap-3 px-4 py-3 rounded-control bg-warn-bg text-sm text-ink">
                <Icon name="alert" size={18} className="text-warn mt-px" />
                <p>
                  Results are hidden: {dashboard.totalResponses} response{dashboard.totalResponses === 1 ? '' : 's'} so far,
                  below the minimum of {dashboard.minN}. They unlock once more people respond.
                </p>
              </div>
            )}
            {dashboard.perQuestion.map((qs: any, i: number) => (
              <QuestionResultCard key={qs.questionId} num={i + 1} q={qs} />
            ))}
            {dashboard.segments?.byDepartment && Object.keys(dashboard.segments.byDepartment).length > 0 && (
              <Card>
                <CardHeader title="Responses by department" />
                <div className="flex flex-col gap-2.5">
                  {Object.entries(dashboard.segments.byDepartment).map(([dept, n]) => (
                    <div key={dept} className="flex items-center gap-3">
                      <span className="text-[13px] font-semibold text-ink w-32 shrink-0 truncate">{dept}</span>
                      <Bar pct={Math.min(100, ((n as number) / dashboard.totalResponses) * 100)} />
                      <span className="text-[13px] font-semibold text-muted w-10 text-right tabular-nums">{n as number}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )
      )}

      {/* Actions tab */}
      {tab === 'actions' && (
        <div className="flex flex-col gap-3">
          {isMgrOrHr && actions.length > 0 && (
            <div className="flex justify-end">
              <Button variant="secondary" icon="plus" onClick={() => setShowActionModal(true)}>Add action</Button>
            </div>
          )}
          {actions.length === 0 ? (
            <Card padding="p-0">
              <EmptyState
                icon="check"
                title="No follow-up actions yet"
                description="Actions record what managers commit to doing about the results."
                action={isMgrOrHr ? <Button variant="secondary" icon="plus" onClick={() => setShowActionModal(true)}>Add action</Button> : undefined}
              />
            </Card>
          ) : (
            actions.map(a => (
              <Card key={a.id} padding="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Badge tone={ACTION_STATUS_TONE[a.status] ?? 'neutral'}>{sentence(a.status)}</Badge>
                  {a.department && <span className="text-[13px] text-muted">{a.department}</span>}
                </div>
                <h4 className="text-sm font-bold text-ink">{a.title}</h4>
                {a.description && <p className="text-[13px] text-muted mt-1">{a.description}</p>}
                <p className="text-xs text-muted mt-2">
                  By {a.managerName || a.managerId}{a.dueDate ? <> · <span className="tabular-nums">Due {fmt(a.dueDate)}</span></> : ''}
                </p>
              </Card>
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
    <div className="min-w-0">
      <dt className="text-[12.5px] font-semibold text-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink mt-0.5 tabular-nums">{value}</dd>
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="flex-1 h-2 rounded-full bg-pill overflow-hidden" aria-hidden="true">
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

function QuestionResultCard({ num, q }: { num: number; q: any }) {
  return (
    <Card>
      <div className="flex items-start gap-3 mb-4">
        <span className="text-[13px] font-bold text-muted tabular-nums mt-0.5">Q{num}</span>
        <h4 className="text-[15px] font-bold text-ink flex-1">{q.text}</h4>
        <Badge tone="neutral">{QUESTION_TYPE_SHORT[q.type] ?? sentence(q.type)}</Badge>
      </div>
      {q.stats?.suppressed ? (
        <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-control bg-warn-bg text-[13px] text-ink">
          <Icon name="lock" size={16} className="text-warn mt-px" />
          {q.stats.reason}
        </div>
      ) : q.type === 'LIKERT_5' ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-6">
            <div>
              <p className="text-[30px] font-extrabold leading-none text-ink tabular-nums">{q.stats.average?.toFixed(2)}</p>
              <p className="text-[13px] text-muted mt-1">average out of 5</p>
            </div>
            <div>
              <p className="text-sm font-bold text-accent tabular-nums">{q.stats.positivePct}% positive</p>
              <p className="text-[13px] text-muted mt-0.5 tabular-nums">4 or 5, from {q.stats.total} responses</p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {[5,4,3,2,1].map(n => {
              const count = q.stats.distribution?.[n] || 0;
              const pct = Math.round((count / Math.max(q.stats.total, 1)) * 100);
              return (
                <div key={n} className="flex items-center gap-3 text-[13px]">
                  <span className="font-semibold text-muted w-4 tabular-nums">{n}</span>
                  <Bar pct={pct} />
                  <span className="font-semibold text-muted w-8 text-right tabular-nums">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : q.type === 'NPS' ? (
        <div>
          <div className="flex items-baseline gap-3 mb-4">
            <p className={`text-[36px] font-extrabold leading-none tabular-nums ${q.stats.score > 30 ? 'text-accent' : 'text-ink'}`}>
              {q.stats.score}
            </p>
            <p className="text-[13px] text-muted">eNPS score</p>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <NpsTile value={q.stats.promoters} label="Promoters" range="9–10" />
            <NpsTile value={q.stats.passives} label="Passives" range="7–8" />
            <NpsTile value={q.stats.detractors} label="Detractors" range="0–6" />
          </div>
        </div>
      ) : q.type === 'MULTI_CHOICE' ? (
        <div className="flex flex-col gap-2">
          {(q.choices || []).map((choice: string, i: number) => {
            const count = q.stats.counts[i] || 0;
            const pct   = q.stats.percentages[i] || 0;
            return (
              <div key={i} className="flex items-center gap-3 text-[13px]">
                <span className="font-semibold text-ink w-40 shrink-0 truncate" title={choice}>{choice}</span>
                <Bar pct={pct} />
                <span className="font-semibold text-muted w-20 text-right tabular-nums">{count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
      ) : q.type === 'TEXT' ? (
        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
          {(q.stats.comments || []).slice(0, 20).map((c: string, i: number) => (
            <blockquote key={i} className="px-3.5 py-2.5 rounded-control bg-page border border-rule text-[13px] text-ink">{c}</blockquote>
          ))}
          {q.stats.total > 20 && <p className="text-[13px] text-muted tabular-nums">and {q.stats.total - 20} more</p>}
        </div>
      ) : null}
    </Card>
  );
}

function NpsTile({ value, label, range }: { value: number; label: string; range: string }) {
  return (
    <div className="px-3 py-2.5 rounded-control bg-page border border-rule">
      <p className="text-lg font-extrabold text-ink tabular-nums">{value}</p>
      <p className="text-[13px] text-muted">{label} <span className="tabular-nums">({range})</span></p>
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
    const res = await apiFetchRaw(`/surveys/${surveyId}/questions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add question"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.text.trim()} reason={!saving && !form.text.trim() ? 'Write the question first' : undefined}>
            {saving ? 'Saving…' : 'Add question'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Question type" required>
          <Select value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
            {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Question" required>
          <Textarea rows={3} value={form.text} onChange={e => setForm({...form, text: e.target.value})} />
        </Field>
        {form.type === 'MULTI_CHOICE' && (
          <Field label="Choices" required help="One per line.">
            <Textarea rows={4} value={form.choices} onChange={e => setForm({...form, choices: e.target.value})} placeholder={'Option 1\nOption 2\nOption 3'} />
          </Field>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Order">
            <Input type="number" value={form.displayOrder} onChange={e => setForm({...form, displayOrder: parseInt(e.target.value) || 0})} />
          </Field>
          <Field label="Category">
            <Input value={form.category} onChange={e => setForm({...form, category: e.target.value})} placeholder="For example, engagement" />
          </Field>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-ink cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-accent" checked={form.required} onChange={e => setForm({...form, required: e.target.checked})} />
          Required
        </label>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
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
    const res = await apiFetchRaw(`/surveys/${surveyId}/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add follow-up action"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.title.trim()} reason={!saving && !form.title.trim() ? 'Add a title first' : undefined}>
            {saving ? 'Saving…' : 'Create action'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Title" required>
          <Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Department">
            <Input value={form.department} onChange={e => setForm({...form, department: e.target.value})} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} />
          </Field>
        </div>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
