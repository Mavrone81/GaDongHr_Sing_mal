'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

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

const STATUS_COLORS: Record<string, string> = {
  OPEN:                'bg-blue-100 text-blue-700',
  UNDER_INVESTIGATION: 'bg-violet-100 text-violet-700',
  PENDING_DECISION:    'bg-amber-100 text-amber-700',
  RESOLVED:            'bg-emerald-100 text-emerald-700',
  CLOSED:              'bg-slate-100 text-slate-600',
  WITHDRAWN:           'bg-slate-100 text-slate-500',
};

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

  async function loadCase() {
    setLoading(true);
    try {
      const res = await apiFetch(`/hr-cases/${id}`);
      if (!res.ok) { const e = await res.json(); setError(e.error || 'Failed'); return; }
      setCase(await res.json());
    } catch { setError('Failed to load'); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (id) loadCase(); }, [id]);

  async function escalate() {
    const reason = window.prompt('Reason for escalation?');
    if (!reason || !reason.trim()) return;
    const res = await apiFetch(`/hr-cases/${id}/escalate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (res.ok) loadCase();
    else alert((await res.json()).error || 'Failed');
  }

  async function resolve() {
    const resolution = window.prompt('Resolution / final decision?');
    if (!resolution || !resolution.trim()) return;
    const res = await apiFetch(`/hr-cases/${id}/resolve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution: resolution.trim() }),
    });
    if (res.ok) loadCase();
    else alert((await res.json()).error || 'Failed');
  }

  async function close() {
    if (!confirm('Close this case permanently?')) return;
    const res = await apiFetch(`/hr-cases/${id}/close`, { method: 'PUT' });
    if (res.ok) loadCase();
    else alert((await res.json()).error || 'Failed');
  }

  async function withdraw() {
    if (!confirm('Withdraw this case?')) return;
    const res = await apiFetch(`/hr-cases/${id}/withdraw`, { method: 'PUT' });
    if (res.ok) loadCase();
    else alert((await res.json()).error || 'Failed');
  }

  async function acknowledgeAction(actionId: string) {
    if (!confirm('Acknowledge receipt of this action?')) return;
    const res = await apiFetch(`/hr-cases/${id}/actions/${actionId}/acknowledge`, { method: 'PUT' });
    if (res.ok) loadCase();
    else alert((await res.json()).error || 'Failed');
  }

  async function decideAppeal(appealId: string) {
    const status = window.prompt('Decision (UPHELD / PARTIALLY_UPHELD / REJECTED / WITHDRAWN)?');
    if (!status) return;
    const valid = ['UPHELD', 'PARTIALLY_UPHELD', 'REJECTED', 'WITHDRAWN'];
    if (!valid.includes(status.toUpperCase())) { alert('Invalid status'); return; }
    const notes = window.prompt('Outcome notes (optional):') || '';
    const res = await apiFetch(`/hr-cases/${id}/appeals/${appealId}/decide`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status.toUpperCase(), outcomeNotes: notes.trim() }),
    });
    if (res.ok) loadCase();
    else alert((await res.json()).error || 'Failed');
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }
  if (error || !c) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <h2 className="text-lg font-black text-slate-800 mb-2">Case Not Found</h2>
        <p className="text-sm text-slate-500 mb-6">{error}</p>
        <Link href="/hr-cases" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">← Back to Cases</Link>
      </div>
    );
  }

  const isSubject = c.subjectEmployeeId === (user?.employeeId || user?.id || '');
  const canActOnCase = isHr && !['CLOSED','WITHDRAWN'].includes(c.status);
  const canResolve = isHr && !['CLOSED','RESOLVED','WITHDRAWN'].includes(c.status);
  const canFileAppeal = isSubject && c.status === 'RESOLVED' && !c.appeals.some(a => a.status === 'PENDING');
  const canWithdraw = !['CLOSED','RESOLVED','WITHDRAWN'].includes(c.status);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <Link href="/hr-cases" className="text-xs font-bold text-slate-500 hover:text-indigo-600">← Back to Cases</Link>
        <div className="flex items-center gap-2 flex-wrap">
          {c.escalation?.shouldEscalate && (
            <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-full bg-red-100 text-red-700 animate-pulse">
              ⚠ Past SLA · {c.escalation.daysOpen}d
            </span>
          )}
          {c.isTafepReportable && (
            <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-full bg-orange-100 text-orange-700">
              TAFEP Reportable
            </span>
          )}
          <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
            {c.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Case Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono font-black text-slate-400 mb-1">{c.caseNumber}</p>
            <h1 className="text-xl font-black text-slate-900 mb-2">{c.title}</h1>
            <p className="text-sm text-slate-600 whitespace-pre-wrap">{c.summary}</p>
          </div>
        </div>

        {/* Stage progress */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 mb-2">
            <span className="uppercase tracking-widest">Stage: {c.currentStage}</span>
            <span>{c.progress.percent}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all" style={{ width: `${c.progress.percent}%` }} />
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-xs">
          <Meta label="Type" value={c.type} />
          <Meta label="Severity" value={c.severity.replace(/_/g, ' ')} />
          <Meta label="Subject" value={c.subjectEmployeeName} />
          {c.respondentName && <Meta label="Respondent" value={c.respondentName} />}
          <Meta label="Opened" value={`${new Date(c.openedAt).toLocaleDateString('en-SG')} by ${c.openedByName || '—'}`} />
          <Meta label="Escalation" value={c.escalationLevel.replace(/_/g, ' ')} />
          {c.category && <Meta label="Category" value={c.category} />}
          {c.dueDate && <Meta label="Due" value={new Date(c.dueDate).toLocaleDateString('en-SG')} />}
          {c.resolvedAt && <Meta label="Resolved" value={new Date(c.resolvedAt).toLocaleDateString('en-SG')} />}
        </div>

        {c.resolution && (
          <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-xs font-black text-emerald-700 uppercase tracking-widest mb-1">Resolution</p>
            <p className="text-sm text-emerald-900">{c.resolution}</p>
          </div>
        )}

        {/* Action bar */}
        <div className="mt-6 flex flex-wrap gap-2 pt-4 border-t border-slate-100">
          {canActOnCase && (
            <>
              <button onClick={() => setShowIncidentModal(true)} className="px-3 py-1.5 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">+ Log Incident</button>
              <button onClick={() => setShowActionModal(true)}   className="px-3 py-1.5 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">+ Issue Action</button>
              {isHrMgr && !c.committee && (
                <button onClick={() => setShowInquiryModal(true)} className="px-3 py-1.5 text-xs font-bold text-violet-600 border border-violet-200 rounded-lg hover:bg-violet-50">+ Form Inquiry</button>
              )}
              <button onClick={escalate} className="px-3 py-1.5 text-xs font-bold text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50">Escalate</button>
            </>
          )}
          {canResolve && (
            <button onClick={resolve} className="px-3 py-1.5 text-xs font-bold text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50">Resolve</button>
          )}
          {isHr && c.status === 'RESOLVED' && (
            <button onClick={close} className="px-3 py-1.5 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Close</button>
          )}
          {canFileAppeal && (
            <button onClick={() => setShowAppealModal(true)} className="px-3 py-1.5 text-xs font-bold text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50">File Appeal</button>
          )}
          {canWithdraw && !isHr && (
            <button onClick={withdraw} className="px-3 py-1.5 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Withdraw</button>
          )}
        </div>
      </div>

      {/* Three-column layout: Incidents, Actions, Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Incidents */}
        <Panel title={`Incidents (${c.incidents.length})`}>
          {c.incidents.length === 0 ? <Empty text="No incidents logged" /> : (
            <div className="space-y-2">
              {c.incidents.map(i => (
                <div key={i.id} className="border border-slate-100 rounded-xl p-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">{new Date(i.occurredAt).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  <p className="text-sm text-slate-700">{i.description}</p>
                  {i.location && <p className="text-xs text-slate-500 mt-1">📍 {i.location}</p>}
                  {i.witnesses?.length > 0 && <p className="text-xs text-slate-500 mt-1">Witnesses: {i.witnesses.join(', ')}</p>}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Actions */}
        <Panel title={`Actions (${c.actions.length})`}>
          {c.actions.length === 0 ? <Empty text="No actions issued" /> : (
            <div className="space-y-2">
              {c.actions.map(a => (
                <div key={a.id} className="border border-slate-100 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-black text-slate-700 uppercase tracking-wider">{a.actionType.replace(/_/g, ' ')}</p>
                    {a.acknowledged ? (
                      <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">✓ Acked</span>
                    ) : isSubject ? (
                      <button onClick={() => acknowledgeAction(a.id)} className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 uppercase tracking-widest">Acknowledge</button>
                    ) : null}
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 mb-1">{new Date(a.actionDate).toLocaleDateString('en-SG')} · by {a.performedByName || '—'}</p>
                  {a.notes && <p className="text-xs text-slate-600 mt-1">{a.notes}</p>}
                  {a.suspensionPaid !== null && a.actionType === 'SUSPENSION' && (
                    <p className="text-xs text-slate-500 mt-1 font-bold">{a.suspensionPaid ? 'WITH pay' : 'WITHOUT pay'}</p>
                  )}
                  {a.showCauseDeadline && (
                    <p className="text-xs text-amber-600 mt-1 font-bold">Reply by: {new Date(a.showCauseDeadline).toLocaleDateString('en-SG')}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Timeline */}
        <Panel title={`Timeline (${c.timeline.length})`}>
          {c.timeline.length === 0 ? <Empty text="No timeline events" /> : (
            <div className="space-y-2">
              {c.timeline.map(t => (
                <div key={t.id} className="border-l-2 border-slate-200 pl-3 py-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{new Date(t.createdAt).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  <p className="text-xs font-bold text-slate-700">{t.event.replace(/_/g, ' ').replace(/:/g, ' · ')}</p>
                  {t.actorName && <p className="text-xs text-slate-500">by {t.actorName}</p>}
                  {t.detail && <p className="text-xs text-slate-500 mt-0.5 italic">{t.detail}</p>}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Inquiry Committee */}
      {c.committee && (
        <Panel title="Inquiry Committee">
          <div className="space-y-2">
            <p className="text-sm"><span className="font-bold">Chair:</span> {c.committee.chairName}</p>
            <p className="text-sm"><span className="font-bold">Members:</span> {(c.committee.memberNames || []).join(', ') || '—'}</p>
            <p className="text-sm"><span className="font-bold">Scope:</span> {c.committee.scope}</p>
            {c.committee.hearingDate && <p className="text-sm"><span className="font-bold">Hearing:</span> {new Date(c.committee.hearingDate).toLocaleDateString('en-SG')}</p>}
            {c.committee.reportSummary && (
              <div className="mt-2 p-3 bg-slate-50 rounded-xl">
                <p className="text-xs font-black text-slate-700 uppercase mb-1">Report</p>
                <p className="text-sm text-slate-700">{c.committee.reportSummary}</p>
                {c.committee.recommendation && <p className="text-sm text-slate-700 mt-2"><span className="font-bold">Recommendation:</span> {c.committee.recommendation}</p>}
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* Appeals */}
      {c.appeals.length > 0 && (
        <Panel title={`Appeals (${c.appeals.length})`}>
          <div className="space-y-3">
            {c.appeals.map(a => (
              <div key={a.id} className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-700">
                    Filed {new Date(a.filedAt).toLocaleDateString('en-SG')} by {a.filedByName || '—'}
                  </p>
                  <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${
                    a.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                    a.status === 'UPHELD'  ? 'bg-emerald-100 text-emerald-700' :
                    a.status === 'PARTIALLY_UPHELD' ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-slate-100 text-slate-600'
                  }`}>{a.status}</span>
                </div>
                <p className="text-sm text-slate-600 mt-1"><span className="font-bold">Grounds:</span> {a.groundsForAppeal}</p>
                {a.outcomeNotes && <p className="text-sm text-slate-600 mt-1"><span className="font-bold">Outcome:</span> {a.outcomeNotes}</p>}
                {a.status === 'PENDING' && isHrMgr && (
                  <button onClick={() => decideAppeal(a.id)} className="mt-2 text-xs font-bold text-indigo-600 hover:text-indigo-700">Decide Appeal →</button>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

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
      {showAppealModal && (
        <AppealModal caseId={c.id} onClose={() => setShowAppealModal(false)} onSuccess={() => { setShowAppealModal(false); loadCase(); }} />
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-slate-700 mt-0.5">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">{title}</h3>
      </div>
      <div className="p-4 max-h-[450px] overflow-y-auto">{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-slate-400 italic text-center py-6">{text}</p>;
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
    apiFetch(`/hr-cases/${caseId}/recommend-next-action`)
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
    const res = await apiFetch(`/hr-cases/${caseId}/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal title="Issue Action" onClose={onClose}>
      {recommended && (
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-700">
          <strong>Recommended:</strong> {recommended.replace(/_/g, ' ')} (based on severity & prior actions)
        </div>
      )}
      <Field label="Action Type" required>
        <select value={form.actionType} onChange={e => setForm({...form, actionType: e.target.value})} className="input">
          {ACTION_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </Field>
      <Field label="Notes">
        <textarea rows={3} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="input resize-none" />
      </Field>
      {form.actionType === 'SUSPENSION' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" value={form.effectiveFrom} onChange={e => setForm({...form, effectiveFrom: e.target.value})} className="input" /></Field>
          <Field label="To"><input type="date" value={form.effectiveTo} onChange={e => setForm({...form, effectiveTo: e.target.value})} className="input" /></Field>
          <label className="flex items-center gap-2 text-sm col-span-2">
            <input type="checkbox" checked={form.suspensionPaid} onChange={e => setForm({...form, suspensionPaid: e.target.checked})} />
            Suspension WITH pay
          </label>
        </div>
      )}
      {form.actionType === 'SHOW_CAUSE' && (
        <Field label="Reply deadline">
          <input type="date" value={form.showCauseDeadline} onChange={e => setForm({...form, showCauseDeadline: e.target.value})} className="input" />
        </Field>
      )}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
      <ModalFooter onSave={save} onClose={onClose} saving={saving} saveLabel="Issue Action" />
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
    const res = await apiFetch(`/hr-cases/${caseId}/incidents`, {
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
    <Modal title="Log Incident" onClose={onClose}>
      <Field label="When did it occur?" required>
        <input type="datetime-local" value={form.occurredAt} onChange={e => setForm({...form, occurredAt: e.target.value})} className="input" />
      </Field>
      <Field label="Location"><input value={form.location} onChange={e => setForm({...form, location: e.target.value})} className="input" /></Field>
      <Field label="Description" required>
        <textarea rows={4} value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="input resize-none" />
      </Field>
      <Field label="Witnesses (comma-separated)">
        <input value={form.witnesses} onChange={e => setForm({...form, witnesses: e.target.value})} className="input" placeholder="Name 1, Name 2" />
      </Field>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
      <ModalFooter onSave={save} onClose={onClose} saving={saving} saveLabel="Log Incident" />
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
    const res = await apiFetch(`/hr-cases/${caseId}/inquiry`, {
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
    <Modal title="Form Inquiry Committee" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Chair Employee ID" required><input value={form.chairId} onChange={e => setForm({...form, chairId: e.target.value})} className="input" /></Field>
        <Field label="Chair Name" required><input value={form.chairName} onChange={e => setForm({...form, chairName: e.target.value})} className="input" /></Field>
      </div>
      <Field label="Member IDs (comma-separated)"><input value={form.members} onChange={e => setForm({...form, members: e.target.value})} className="input" /></Field>
      <Field label="Member Names (comma-separated)"><input value={form.memberNames} onChange={e => setForm({...form, memberNames: e.target.value})} className="input" /></Field>
      <Field label="Scope of Inquiry" required>
        <textarea rows={3} value={form.scope} onChange={e => setForm({...form, scope: e.target.value})} className="input resize-none" />
      </Field>
      <Field label="Hearing Date"><input type="date" value={form.hearingDate} onChange={e => setForm({...form, hearingDate: e.target.value})} className="input" /></Field>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
      <ModalFooter onSave={save} onClose={onClose} saving={saving} saveLabel="Form Committee" />
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
    const res = await apiFetch(`/hr-cases/${caseId}/appeal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groundsForAppeal: grounds }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal title="File Appeal" onClose={onClose}>
      <Field label="Grounds for Appeal" required>
        <textarea rows={5} value={grounds} onChange={e => setGrounds(e.target.value)} className="input resize-none" placeholder="Explain why you are appealing this decision" />
      </Field>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
      <ModalFooter onSave={save} onClose={onClose} saving={saving} saveLabel="Submit Appeal" disabled={!grounds.trim()} />
    </Modal>
  );
}

// ─── Modal scaffolding ───────────────────────────────────────────────────────
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 sticky top-0 bg-white flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-lg">×</button>
        </div>
        <div className="p-4 sm:p-6 space-y-4">{children}</div>
      </div>
      <style jsx>{`
        :global(.input) {
          width: 100%; border: 1px solid rgb(226 232 240); border-radius: 0.75rem;
          padding: 0.6rem 0.9rem; font-size: 0.875rem; outline: none;
          transition: all 0.15s;
        }
        :global(.input:focus) {
          border-color: rgb(99 102 241); box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }
      `}</style>
    </div>
  );
}

function ModalFooter({ onSave, onClose, saving, saveLabel, disabled }: { onSave: () => void; onClose: () => void; saving: boolean; saveLabel: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-1">
      <button onClick={onSave} disabled={saving || disabled} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
        {saving ? 'Saving…' : saveLabel}
      </button>
      <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}
