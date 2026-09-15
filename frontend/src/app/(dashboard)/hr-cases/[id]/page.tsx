'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Badge, Button, Modal, Field, Input, Select, Textarea, EmptyState, Icon } from '@/components/ui';
import type { BadgeTone } from '@/components/ui';

interface CaseDetail {
  id: string;
  caseNumber: string;
  type: 'DISCIPLINARY' | 'GRIEVANCE';
  status: string;
  severity: string;
  subjectEmployeeId: string;
  subjectEmployeeName: string;
  respondentName: string | null;
  title: string;
  summary: string;
  category: string | null;
  isTafepReportable: boolean;
  isUnionised: boolean;
  unionConsulted: boolean;
  currentStage: string;
  escalationLevel: string;
  openedAt: string;
  openedByName: string | null;
  closedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  dueDate: string | null;
  incidents: any[];
  actions: any[];
  timeline: any[];
  appeals: any[];
  committee: any | null;
  attachments: any[];
  escalation: { shouldEscalate: boolean; daysOpen: number; slaDays: number; nextLevel: string | null };
  progress: { stage: string; percent: number };
  momReportable: boolean;
}

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];
const HR_MGR_ROLES = ['HR_MANAGER', 'SUPER_ADMIN'];

const ACTION_TYPES = [
  'VERBAL_WARNING','WRITTEN_WARNING','FINAL_WARNING','SHOW_CAUSE',
  'SUSPENSION','TRANSFER','DEMOTION','TERMINATION_FOR_CAUSE',
  'COUNSELLING','MEDIATION','TRAINING_ORDER','APOLOGY',
  'COMPENSATION','POLICY_CLARIFICATION','NO_ACTION',
];

/** Same scheme as the case list: six statuses, five appearances, withdrawn struck through. */
const STATUS_TONE: Record<string, BadgeTone> = {
  OPEN:                'accent',
  UNDER_INVESTIGATION: 'danger',
  PENDING_DECISION:    'warn',
  RESOLVED:            'ok',
  CLOSED:              'neutral',
  WITHDRAWN:           'neutral',
};

const SEVERITY_TONE: Record<string, BadgeTone> = {
  MINOR:            'neutral',
  MODERATE:         'accent',
  SERIOUS:          'warn',
  GROSS_MISCONDUCT: 'danger',
};

/** Appeal outcomes: five states, five appearances. */
const APPEAL_STATUS_TONE: Record<string, BadgeTone> = {
  PENDING:          'warn',
  UPHELD:           'ok',
  PARTIALLY_UPHELD: 'accent',
  REJECTED:         'danger',
  WITHDRAWN:        'neutral',
};

/** TERMINATION_FOR_CAUSE → "Termination for cause"; acronyms stay upper case. */
const sentence = (raw: string) => {
  const words = String(raw || '').split('_').map(w => (w === 'HR' || w === 'MOM' || w === 'TAFEP' ? w : w.toLowerCase()));
  const first = words[0] ?? '';
  words[0] = /^[A-Z]+$/.test(first) ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ');
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-SG');

const LINK_BUTTON = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-control border border-rule bg-paper text-sm font-semibold text-ink whitespace-nowrap hover:bg-pill';

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isHr = HR_ROLES.includes(role);
  const isHrMgr = HR_MGR_ROLES.includes(role);

  const [c, setCase] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showActionModal, setShowActionModal]     = useState(false);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showInquiryModal, setShowInquiryModal]   = useState(false);
  const [showAppealModal, setShowAppealModal]     = useState(false);
  const [reasonDialog, setReasonDialog]           = useState<'escalate' | 'resolve' | null>(null);

  async function loadCase() {
    setLoading(true);
    try {
      const res = await apiFetchRaw(`/hr-cases/${id}`);
      if (!res.ok) { const e = await res.json(); setError(e.error || 'Failed'); return; }
      setCase(await res.json());
    } catch { setError('Failed to load'); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (id) loadCase(); }, [id]);

  // Escalate and Resolve used to collect their text with window.prompt(). They
  // now take it from ReasonModal; the request is unchanged (same endpoint,
  // method and trimmed body, and an empty reason still sends nothing — the
  // dialog will not submit one). A failure is shown in the dialog instead of
  // alert(); returns the error text, or null on success.
  async function escalate(reason: string): Promise<string | null> {
    const res = await apiFetchRaw(`/hr-cases/${id}/escalate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (res.ok) { loadCase(); return null; }
    return (await res.json()).error || 'Failed';
  }

  async function resolve(resolution: string): Promise<string | null> {
    const res = await apiFetchRaw(`/hr-cases/${id}/resolve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: resolution.trim() }),
    });
    if (res.ok) { loadCase(); return null; }
    return (await res.json()).error || 'Failed';
  }

  async function close() {
    if (!confirm('Close this case permanently?')) return;
    const res = await apiFetchRaw(`/hr-cases/${id}/close`, { method: 'PUT' });
    if (res.ok) loadCase();
    else alert((await res.json()).error || 'Failed');
  }

  async function withdraw() {
    if (!confirm('Withdraw this case?')) return;
    const res = await apiFetchRaw(`/hr-cases/${id}/withdraw`, { method: 'PUT' });
    if (res.ok) loadCase();
    else alert((await res.json()).error || 'Failed');
  }

  async function acknowledgeAction(actionId: string) {
    if (!confirm('Acknowledge receipt of this action?')) return;
    const res = await apiFetchRaw(`/hr-cases/${id}/actions/${actionId}/acknowledge`, { method: 'PUT' });
    if (res.ok) loadCase();
    else alert((await res.json()).error || 'Failed');
  }

  async function decideAppeal(appealId: string) {
    const status = window.prompt('Decision (UPHELD / PARTIALLY_UPHELD / REJECTED / WITHDRAWN)?');
    if (!status) return;
    const valid = ['UPHELD', 'PARTIALLY_UPHELD', 'REJECTED', 'WITHDRAWN'];
    if (!valid.includes(status.toUpperCase())) { alert('Invalid status'); return; }
    const notes = window.prompt('Outcome notes (optional):') || '';
    const res = await apiFetchRaw(`/hr-cases/${id}/appeals/${appealId}/decide`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status.toUpperCase(), outcomeNotes: notes.trim() }),
    });
    if (res.ok) loadCase();
    else alert((await res.json()).error || 'Failed');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-9 h-9 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading case" />
      </div>
    );
  }
  if (error || !c) {
    return (
      <Card padding="p-0" className="max-w-2xl mx-auto mt-10">
        <EmptyState
          icon="alert"
          title="Case not found"
          description={error || 'It may have been removed, or you may not have access to it.'}
          action={<Link href="/hr-cases" className={LINK_BUTTON}>Back to cases</Link>}
        />
      </Card>
    );
  }

  const isSubject = c.subjectEmployeeId === (user?.employeeId || user?.id || '');
  const canActOnCase = isHr && !['CLOSED','WITHDRAWN'].includes(c.status);
  const canResolve = isHr && !['CLOSED','RESOLVED','WITHDRAWN'].includes(c.status);
  const canFileAppeal = isSubject && c.status === 'RESOLVED' && !c.appeals.some(a => a.status === 'PENDING');
  const canWithdraw = !['CLOSED','RESOLVED','WITHDRAWN'].includes(c.status);

  const hasActions = canActOnCase || canResolve || (isHr && c.status === 'RESOLVED') || canFileAppeal || (canWithdraw && !isHr);

  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto w-full pb-10">
      <Link href="/hr-cases" className="self-start inline-flex items-center gap-1.5 h-8 -ml-1 px-1 rounded-control text-[13px] font-semibold text-muted hover:text-accent">
        <Icon name="chevronRight" size={16} className="rotate-180" /> All cases
      </Link>

      {/* Identity band */}
      <Card padding="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Badge tone={STATUS_TONE[c.status] ?? 'neutral'} className={c.status === 'WITHDRAWN' ? 'line-through' : ''}>{sentence(c.status)}</Badge>
          <Badge tone={SEVERITY_TONE[c.severity] ?? 'neutral'}>{sentence(c.severity)}</Badge>
          {c.escalation?.shouldEscalate && (
            <Badge tone="danger"><Icon name="alert" size={13} className="mr-1" />Past SLA · {c.escalation.daysOpen}d open</Badge>
          )}
          {c.isTafepReportable && <Badge tone="neutral">TAFEP reportable</Badge>}
          <span className="text-[13px] text-muted tabular-nums">{c.caseNumber}</span>
        </div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.02em] leading-[1.15] text-ink">{c.title}</h1>
        <p className="text-sm text-ink mt-2 whitespace-pre-wrap max-w-3xl">{c.summary}</p>

        {/* Stage progress */}
        <div className="mt-5 max-w-xl">
          <div className="flex items-center justify-between text-[13px] mb-1.5">
            <span className="text-muted">Stage: <span className="font-semibold text-ink">{sentence(c.currentStage)}</span></span>
            <span className="font-semibold text-ink tabular-nums">{c.progress.percent}%</span>
          </div>
          <div className="h-2 rounded-full bg-pill overflow-hidden" role="progressbar" aria-valuenow={c.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Case progress">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${c.progress.percent}%` }} />
          </div>
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-4 mt-5 pt-5 border-t border-rule">
          <Meta label="Type" value={sentence(c.type)} />
          <Meta label="Subject" value={c.subjectEmployeeName} />
          {c.respondentName && <Meta label="Respondent" value={c.respondentName} />}
          <Meta label="Opened" value={`${fmtDate(c.openedAt)} by ${c.openedByName || '—'}`} />
          <Meta label="Escalation level" value={sentence(c.escalationLevel)} />
          {c.category && <Meta label="Category" value={sentence(c.category)} />}
          {c.dueDate && <Meta label="Due" value={fmtDate(c.dueDate)} />}
          {c.resolvedAt && <Meta label="Resolved" value={fmtDate(c.resolvedAt)} />}
        </dl>

        {c.resolution && (
          <div className="mt-5 px-4 py-3 rounded-control bg-tint">
            <p className="text-[12.5px] font-semibold text-accent mb-1">Resolution</p>
            <p className="text-sm text-ink whitespace-pre-wrap">{c.resolution}</p>
          </div>
        )}

        {hasActions && (
          <div className="mt-5 pt-5 border-t border-rule flex flex-wrap gap-2.5">
            {canResolve && <Button onClick={() => setReasonDialog('resolve')} icon="check">Resolve</Button>}
            {canFileAppeal && <Button onClick={() => setShowAppealModal(true)}>File an appeal</Button>}
            {canActOnCase && (
              <>
                <Button variant="secondary" icon="plus" onClick={() => setShowIncidentModal(true)}>Log incident</Button>
                <Button variant="secondary" icon="plus" onClick={() => setShowActionModal(true)}>Issue action</Button>
                {isHrMgr && !c.committee && (
                  <Button variant="secondary" icon="users" onClick={() => setShowInquiryModal(true)}>Form inquiry</Button>
                )}
                <Button variant="secondary" icon="arrowRight" onClick={() => setReasonDialog('escalate')}>Escalate</Button>
              </>
            )}
            {isHr && c.status === 'RESOLVED' && <Button variant="secondary" onClick={close}>Close case</Button>}
            {canWithdraw && !isHr && <Button variant="danger" onClick={withdraw}>Withdraw</Button>}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Main column */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          <Card>
            <CardHeader title="Incidents" caption={`${c.incidents.length} logged`} />
            {c.incidents.length === 0 ? <Empty text="No incidents logged yet." /> : (
              <ul className="flex flex-col">
                {c.incidents.map(i => (
                  <li key={i.id} className="py-3 border-t border-rule first:border-t-0 first:pt-0">
                    <p className="text-xs text-muted tabular-nums mb-1">
                      {new Date(i.occurredAt).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-sm text-ink">{i.description}</p>
                    {i.location && <p className="text-[13px] text-muted mt-1">Location: {i.location}</p>}
                    {i.witnesses?.length > 0 && <p className="text-[13px] text-muted mt-0.5">Witnesses: {i.witnesses.join(', ')}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Actions" caption={`${c.actions.length} issued`} />
            {c.actions.length === 0 ? <Empty text="No actions issued yet." /> : (
              <ul className="flex flex-col">
                {c.actions.map(a => (
                  <li key={a.id} className="py-3 border-t border-rule first:border-t-0 first:pt-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">{sentence(a.actionType)}</p>
                        <p className="text-xs text-muted mt-0.5 tabular-nums">{fmtDate(a.actionDate)} · by {a.performedByName || '—'}</p>
                      </div>
                      {a.acknowledged ? (
                        <Badge tone="ok"><Icon name="check" size={13} strokeWidth={2.5} className="mr-1" />Acknowledged</Badge>
                      ) : isSubject ? (
                        <Button size="sm" variant="secondary" onClick={() => acknowledgeAction(a.id)}>Acknowledge</Button>
                      ) : (
                        <Badge tone="warn">Not acknowledged</Badge>
                      )}
                    </div>
                    {a.notes && <p className="text-[13px] text-ink mt-2">{a.notes}</p>}
                    {a.suspensionPaid !== null && a.actionType === 'SUSPENSION' && (
                      <p className="text-[13px] font-semibold text-ink mt-1">{a.suspensionPaid ? 'With pay' : 'Without pay'}</p>
                    )}
                    {a.showCauseDeadline && (
                      <p className="text-[13px] font-semibold text-ink mt-1 tabular-nums">Reply by {fmtDate(a.showCauseDeadline)}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {c.committee && (
            <Card>
              <CardHeader title="Inquiry committee" />
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Meta label="Chair" value={c.committee.chairName} />
                <Meta label="Members" value={(c.committee.memberNames || []).join(', ') || '—'} />
                {c.committee.hearingDate && <Meta label="Hearing" value={fmtDate(c.committee.hearingDate)} />}
                <div className="sm:col-span-2">
                  <dt className="text-[12.5px] font-semibold text-muted">Scope</dt>
                  <dd className="text-sm text-ink mt-0.5">{c.committee.scope}</dd>
                </div>
              </dl>
              {c.committee.reportSummary && (
                <div className="mt-4 px-4 py-3 rounded-control bg-page border border-rule">
                  <p className="text-[12.5px] font-semibold text-muted mb-1">Report</p>
                  <p className="text-sm text-ink">{c.committee.reportSummary}</p>
                  {c.committee.recommendation && (
                    <p className="text-sm text-ink mt-2"><span className="font-semibold">Recommendation:</span> {c.committee.recommendation}</p>
                  )}
                </div>
              )}
            </Card>
          )}

          {c.appeals.length > 0 && (
            <Card>
              <CardHeader title="Appeals" caption={`${c.appeals.length} filed`} />
              <ul className="flex flex-col">
                {c.appeals.map(a => (
                  <li key={a.id} className="py-3 border-t border-rule first:border-t-0 first:pt-0">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <p className="text-[13px] text-muted tabular-nums">Filed {fmtDate(a.filedAt)} by {a.filedByName || '—'}</p>
                      <Badge tone={APPEAL_STATUS_TONE[a.status] ?? 'neutral'}>{sentence(a.status)}</Badge>
                    </div>
                    <p className="text-sm text-ink"><span className="font-semibold">Grounds:</span> {a.groundsForAppeal}</p>
                    {a.outcomeNotes && <p className="text-sm text-ink mt-1"><span className="font-semibold">Outcome:</span> {a.outcomeNotes}</p>}
                    {a.status === 'PENDING' && isHrMgr && (
                      <Button size="sm" variant="ghost" className="mt-2 -ml-3" onClick={() => decideAppeal(a.id)}>Decide appeal</Button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* Side column */}
        <Card className="lg:sticky lg:top-4">
          <CardHeader title="Timeline" caption={`${c.timeline.length} event${c.timeline.length === 1 ? '' : 's'}`} />
          {c.timeline.length === 0 ? <Empty text="Nothing has happened on this case yet." /> : (
            <ol className="flex flex-col max-h-[560px] overflow-y-auto -mr-2 pr-2">
              {c.timeline.map((t, i) => (
                <li key={t.id} className="relative pl-5 pb-4 last:pb-0">
                  <span className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
                  {i < c.timeline.length - 1 && <span className="absolute left-[3px] top-4 bottom-0 w-0.5 bg-rule" aria-hidden="true" />}
                  <p className="text-xs text-muted tabular-nums">
                    {new Date(t.createdAt).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <p className="text-[13px] font-semibold text-ink">{sentence(t.event.replace(/:/g, ' · '))}</p>
                  {t.actorName && <p className="text-xs text-muted">by {t.actorName}</p>}
                  {t.detail && <p className="text-xs text-muted mt-0.5">{t.detail}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* Modals */}
      {showActionModal && (
        <ActionModal caseId={c.id} severity={c.severity} stage={c.currentStage} onClose={() => setShowActionModal(false)} onSuccess={() => { setShowActionModal(false); loadCase(); }} />
      )}
      {showIncidentModal && (
        <IncidentModal caseId={c.id} onClose={() => setShowIncidentModal(false)} onSuccess={() => { setShowIncidentModal(false); loadCase(); }} />
      )}
      {showInquiryModal && (
        <InquiryModal caseId={c.id} onClose={() => setShowInquiryModal(false)} onSuccess={() => { setShowInquiryModal(false); loadCase(); }} />
      )}
      {reasonDialog === 'escalate' && (
        <ReasonModal
          title="Escalate this case"
          caption={c.escalation?.nextLevel ? `It moves up to ${sentence(c.escalation.nextLevel)}.` : undefined}
          label="Reason for escalation"
          submitLabel="Escalate"
          onSubmit={escalate}
          onClose={() => setReasonDialog(null)}
        />
      )}
      {reasonDialog === 'resolve' && (
        <ReasonModal
          title="Resolve this case"
          label="Resolution or final decision"
          submitLabel="Resolve case"
          onSubmit={resolve}
          onClose={() => setReasonDialog(null)}
        />
      )}
      {showAppealModal && (
        <AppealModal caseId={c.id} onClose={() => setShowAppealModal(false)} onSuccess={() => { setShowAppealModal(false); loadCase(); }} />
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] font-semibold text-muted">{label}</dt>
      <dd className="text-sm font-semibold text-ink mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[13px] text-muted py-4">{text}</p>;
}

function ErrorText({ error }: { error: string }) {
  return error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null;
}

function ModalActions({ onSave, onClose, saving, saveLabel, disabled, reason }: { onSave: () => void; onClose: () => void; saving: boolean; saveLabel: string; disabled?: boolean; reason?: string }) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button onClick={onSave} disabled={saving || disabled} reason={!saving && disabled ? reason : undefined}>
        {saving ? 'Saving…' : saveLabel}
      </Button>
    </>
  );
}

// ─── Reason Modal (escalate / resolve) ───────────────────────────────────────
function ReasonModal({ title, caption, label, submitLabel, onSubmit, onClose }: {
  title: string; caption?: string; label: string; submitLabel: string;
  onSubmit: (text: string) => Promise<string | null>; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!text.trim()) return;
    setSaving(true); setError('');
    try {
      const err = await onSubmit(text);
      if (err) setError(err); else onClose();
    } catch { setError('Network error. Please try again.'); }
    finally { setSaving(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      caption={caption}
      footer={<ModalActions onSave={submit} onClose={onClose} saving={saving} saveLabel={submitLabel} disabled={!text.trim()} reason="Write a reason first" />}
    >
      <div className="flex flex-col gap-4">
        <Field label={label} required>
          <Textarea rows={4} value={text} onChange={e => setText(e.target.value)} autoFocus />
        </Field>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

// ─── Action Modal ────────────────────────────────────────────────────────────
function ActionModal({ caseId, severity, stage, onClose, onSuccess }: { caseId: string; severity: string; stage: string; onClose: () => void; onSuccess: () => void }) {
  const [recommended, setRecommended] = useState('');
  const [form, setForm] = useState({
    actionType: 'VERBAL_WARNING',
    notes: '',
    effectiveFrom: '',
    effectiveTo: '',
    suspensionPaid: false,
    showCauseDeadline: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetchRaw(`/hr-cases/${caseId}/recommend-next-action`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.recommended) { setRecommended(d.recommended); setForm(f => ({ ...f, actionType: d.recommended })); } })
      .catch(() => {});
  }, [caseId]);

  async function save() {
    setSaving(true); setError('');
    const body: any = {
      actionType: form.actionType,
      notes: form.notes,
    };
    if (form.effectiveFrom) body.effectiveFrom = form.effectiveFrom;
    if (form.effectiveTo)   body.effectiveTo   = form.effectiveTo;
    if (form.actionType === 'SUSPENSION')   body.suspensionPaid    = form.suspensionPaid;
    if (form.actionType === 'SHOW_CAUSE' && form.showCauseDeadline) body.showCauseDeadline = form.showCauseDeadline;
    const res = await apiFetchRaw(`/hr-cases/${caseId}/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal open onClose={onClose} title="Issue an action" footer={<ModalActions onSave={save} onClose={onClose} saving={saving} saveLabel="Issue action" />}>
      <div className="flex flex-col gap-4">
        {recommended && (
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-control bg-tint text-[13px] text-ink">
            <Icon name="star" size={16} className="text-accent mt-px" />
            <p><span className="font-semibold">Recommended: {sentence(recommended)}</span>, based on the severity and earlier actions.</p>
          </div>
        )}
        <Field label="Action type" required>
          <Select value={form.actionType} onChange={e => setForm({...form, actionType: e.target.value})}>
            {ACTION_TYPES.map(t => <option key={t} value={t}>{sentence(t)}</option>)}
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea rows={3} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
        </Field>
        {form.actionType === 'SUSPENSION' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="From"><Input type="date" value={form.effectiveFrom} onChange={e => setForm({...form, effectiveFrom: e.target.value})} /></Field>
            <Field label="To"><Input type="date" value={form.effectiveTo} onChange={e => setForm({...form, effectiveTo: e.target.value})} /></Field>
            <label className="sm:col-span-2 flex items-center gap-2.5 text-sm text-ink cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-accent" checked={form.suspensionPaid} onChange={e => setForm({...form, suspensionPaid: e.target.checked})} />
              Suspension with pay
            </label>
          </div>
        )}
        {form.actionType === 'SHOW_CAUSE' && (
          <Field label="Reply deadline">
            <Input type="date" value={form.showCauseDeadline} onChange={e => setForm({...form, showCauseDeadline: e.target.value})} />
          </Field>
        )}
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

// ─── Incident Modal ──────────────────────────────────────────────────────────
function IncidentModal({ caseId, onClose, onSuccess }: { caseId: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ occurredAt: '', location: '', description: '', witnesses: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetchRaw(`/hr-cases/${caseId}/incidents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        occurredAt: form.occurredAt,
        location: form.location,
        description: form.description,
        witnesses: form.witnesses.split(',').map(s => s.trim()).filter(Boolean),
      }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal open onClose={onClose} title="Log an incident" footer={<ModalActions onSave={save} onClose={onClose} saving={saving} saveLabel="Log incident" />}>
      <div className="flex flex-col gap-4">
        <Field label="When did it happen?" required>
          <Input type="datetime-local" value={form.occurredAt} onChange={e => setForm({...form, occurredAt: e.target.value})} />
        </Field>
        <Field label="Location"><Input value={form.location} onChange={e => setForm({...form, location: e.target.value})} /></Field>
        <Field label="Description" required>
          <Textarea rows={4} value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
        </Field>
        <Field label="Witnesses" help="Separate names with commas.">
          <Input value={form.witnesses} onChange={e => setForm({...form, witnesses: e.target.value})} placeholder="Name 1, Name 2" />
        </Field>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

// ─── Inquiry Modal ───────────────────────────────────────────────────────────
function InquiryModal({ caseId, onClose, onSuccess }: { caseId: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    chairId: '', chairName: '', members: '', memberNames: '', scope: '', hearingDate: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetchRaw(`/hr-cases/${caseId}/inquiry`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chairId: form.chairId, chairName: form.chairName,
        members: form.members.split(',').map(s => s.trim()).filter(Boolean),
        memberNames: form.memberNames.split(',').map(s => s.trim()).filter(Boolean),
        scope: form.scope, hearingDate: form.hearingDate || null,
      }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal open onClose={onClose} title="Form an inquiry committee" footer={<ModalActions onSave={save} onClose={onClose} saving={saving} saveLabel="Form committee" />}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Chair employee ID" required><Input value={form.chairId} onChange={e => setForm({...form, chairId: e.target.value})} /></Field>
          <Field label="Chair name" required><Input value={form.chairName} onChange={e => setForm({...form, chairName: e.target.value})} /></Field>
        </div>
        <Field label="Member IDs" help="Separate IDs with commas."><Input value={form.members} onChange={e => setForm({...form, members: e.target.value})} /></Field>
        <Field label="Member names" help="Separate names with commas, in the same order as the IDs."><Input value={form.memberNames} onChange={e => setForm({...form, memberNames: e.target.value})} /></Field>
        <Field label="Scope of the inquiry" required>
          <Textarea rows={3} value={form.scope} onChange={e => setForm({...form, scope: e.target.value})} />
        </Field>
        <Field label="Hearing date"><Input type="date" value={form.hearingDate} onChange={e => setForm({...form, hearingDate: e.target.value})} /></Field>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

// ─── Appeal Modal ────────────────────────────────────────────────────────────
function AppealModal({ caseId, onClose, onSuccess }: { caseId: string; onClose: () => void; onSuccess: () => void }) {
  const [grounds, setGrounds] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetchRaw(`/hr-cases/${caseId}/appeal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groundsForAppeal: grounds }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="File an appeal"
      footer={<ModalActions onSave={save} onClose={onClose} saving={saving} saveLabel="Submit appeal" disabled={!grounds.trim()} reason="Explain your grounds first" />}
    >
      <div className="flex flex-col gap-4">
        <Field label="Grounds for appeal" required>
          <Textarea rows={5} value={grounds} onChange={e => setGrounds(e.target.value)} placeholder="Explain why you are appealing this decision" />
        </Field>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}
