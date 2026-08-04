'use client';

import React, { useEffect, useState } from 'react';
import { TONES } from '@/lib/statusTone';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface HrCase {
  id: string;
  caseNumber: string;
  type: 'DISCIPLINARY' | 'GRIEVANCE';
  status: string;
  severity: string;
  subjectEmployeeId: string;
  subjectEmployeeName: string;
  subjectDepartment: string | null;
  respondentName: string | null;
  title: string;
  summary: string;
  category: string | null;
  isTafepReportable: boolean;
  isUnionised: boolean;
  currentStage: string;
  escalationLevel: string;
  openedAt: string;
  closedAt: string | null;
  resolvedAt: string | null;
  dueDate: string | null;
  escalation?: { shouldEscalate: boolean; daysOpen: number; slaDays: number; nextLevel: string | null };
  progress?: { stage: string; percent: number };
}

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];

const SEVERITIES = ['MINOR', 'MODERATE', 'SERIOUS', 'GROSS_MISCONDUCT'];

const STATUS_COLORS: Record<string, string> = {
  OPEN: TONES.active,
  UNDER_INVESTIGATION: TONES.critical,
  PENDING_DECISION: TONES.pending,
  RESOLVED: TONES.warning,
  CLOSED: TONES.done,
  WITHDRAWN: TONES.inert,
};

/**
 * Disciplinary severity, escalating. The nested {bg,text} shape meant the
 * automatic tone reassignment skipped this map, so all four severities — from
 * MINOR to GROSS_MISCONDUCT — were rendering as the same grey chip on the case
 * list. On a disciplinary register that is the most consequential column there
 * is.
 */
const SEVERITY_COLORS: Record<string, string> = {
  MINOR:            TONES.neutral,
  MODERATE:         TONES.pending,
  SERIOUS:          TONES.warning,
  GROSS_MISCONDUCT: TONES.critical,
};

const TYPE_COLORS: Record<string, string> = {
  DISCIPLINARY: 'bg-page text-ink',
  GRIEVANCE:    'bg-page text-accent',
};

export default function HrCasesPage() {
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isHr = HR_ROLES.includes(role);

  const [cases, setCases] = useState<HrCase[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showFileModal, setShowFileModal] = useState(false);
  const [tab, setTab] = useState<'all' | 'open' | 'overdue'>('all');
  const [filterType, setFilterType] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');

  async function loadData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType)     params.set('type', filterType);
      if (filterSeverity) params.set('severity', filterSeverity);
      const [listRes, dashRes] = await Promise.all([
        apiFetch(`/hr-cases${params.toString() ? `?${params}` : ''}`).then(r => r.json()),
        isHr ? apiFetch('/hr-cases/dashboard').then(r => r.json()) : Promise.resolve(null),
      ]);
      setCases(listRes.cases || []);
      setDashboard(dashRes);
    } catch (err) {
      console.error('[hr-cases] load failed', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) loadData(); }, [user, isHr, filterType, filterSeverity]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-10 h-10 border-4 border-accent border-t-accent animate-spin rounded-full" />
      </div>
    );
  }

  const filteredCases = cases.filter(c => {
    if (tab === 'open')    return ['OPEN','UNDER_INVESTIGATION','PENDING_DECISION'].includes(c.status);
    if (tab === 'overdue') return c.escalation?.shouldEscalate;
    return true;
  });

  const summary = dashboard?.summary || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-ink">{isHr ? 'HR Case Management' : 'My Cases'}</h1>
          <p className="text-xs text-muted mt-0.5 uppercase tracking-widest font-bold">
            {isHr ? 'Disciplinary · Grievances · Investigations' : 'Grievances & Personal Cases'}
          </p>
        </div>
        <button
          onClick={() => setShowFileModal(true)}
          className="px-4 py-2 bg-accent text-paper text-xs font-black uppercase tracking-widest hover:bg-accent transition-all"
        >
          {isHr ? '+ Open Case' : '+ File Grievance'}
        </button>
      </div>

      {/* HR Stats */}
      {isHr && dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total"          value={summary.total || 0}            accent="slate"   />
          <StatCard label="Open"           value={summary.open || 0}             accent="blue"    />
          <StatCard label="Overdue"        value={summary.overdueEscalation || 0} accent="red"    />
          <StatCard label="Resolved"       value={summary.resolved || 0}         accent="emerald" />
          <StatCard label="MOM Reportable" value={summary.momReportable || 0}    accent="violet"  />
        </div>
      )}

      {/* Overdue alert banner */}
      {isHr && dashboard?.overdueEscalation?.length > 0 && (
        <div className="bg-page border-2 border-ink p-4 flex items-start gap-3">
          <span className="text-2xl">⚠</span>
          <div className="flex-1">
            <p className="text-sm font-black text-ink uppercase tracking-wider">
              {dashboard.overdueEscalation.length} case{dashboard.overdueEscalation.length > 1 ? 's' : ''} past SLA
            </p>
            <p className="text-xs text-ink mt-1">
              {dashboard.overdueEscalation.slice(0, 3).map((c: any) => c.caseNumber).join(', ')}
              {dashboard.overdueEscalation.length > 3 && ` + ${dashboard.overdueEscalation.length - 3} more`}
            </p>
          </div>
          <button
            onClick={() => setTab('overdue')}
            className="text-xs font-black text-ink hover:text-ink uppercase tracking-widest px-3 py-1.5 border border-ink hover:bg-page transition-all"
          >
            View →
          </button>
        </div>
      )}

      {/* Filters & Tabs */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 border-b border-rule">
          {(['all','open','overdue'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all border-b-2 -mb-px ${
                tab === t ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-xs px-3 py-1.5 border border-rule font-bold text-ink">
            <option value="">All types</option>
            <option value="DISCIPLINARY">Disciplinary</option>
            <option value="GRIEVANCE">Grievance</option>
          </select>
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} className="text-xs px-3 py-1.5 border border-rule font-bold text-ink">
            <option value="">All severities</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </div>

      {/* Case List */}
      {filteredCases.length === 0 ? (
        <div className="bg-paper border border-rule p-12 text-center">
          <p className="text-sm text-muted">No cases in this view.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCases.map(c => {
            return (
              <Link key={c.id} href={`/hr-cases/${c.id}`} className="block bg-paper border border-rule p-5 hover: hover:border-accent transition-all">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-xs font-mono font-black text-muted">{c.caseNumber}</span>
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest  ${TYPE_COLORS[c.type]}`}>
                        {c.type}
                      </span>
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${SEVERITY_COLORS[c.severity] ?? TONES.neutral}`}>
                        {c.severity.replace(/_/g, ' ')}
                      </span>
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest  ${STATUS_COLORS[c.status] || 'bg-page text-ink'}`}>
                        {c.status.replace(/_/g, ' ')}
                      </span>
                      {c.isTafepReportable && (
                        <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-widest bg-page text-ink">
                          TAFEP
                        </span>
                      )}
                      {c.escalation?.shouldEscalate && (
                        <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-widest bg-page text-ink animate-pulse">
                          ⚠ Past SLA
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-black text-ink mb-1">{c.title}</h3>
                    <p className="text-sm text-muted truncate">{c.summary}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted">
                      <span>Subject: <span className="font-bold text-ink">{c.subjectEmployeeName}</span></span>
                      <span>Opened: <span className="font-bold text-ink">{new Date(c.openedAt).toLocaleDateString('en-SG')}</span></span>
                      {c.escalation && (
                        <span>{c.escalation.daysOpen}d open · SLA {c.escalation.slaDays}d</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] font-black text-muted uppercase tracking-widest">Stage</div>
                    <div className="text-xs font-black text-ink mt-1">{c.currentStage}</div>
                    {c.progress && (
                      <div className="mt-2 w-24 h-1.5 bg-rule overflow-hidden">
                        <div className="h-full bg-accent transition-all" style={{ width: `${c.progress.percent}%` }} />
                      </div>
                    )}
                    <div className="text-[10px] font-black text-muted uppercase tracking-widest mt-2">
                      {c.escalationLevel.replace(/_/g, ' ')}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {showFileModal && (
        <FileCaseModal
          isHr={isHr}
          onClose={() => setShowFileModal(false)}
          onSuccess={() => { setShowFileModal(false); loadData(); }}
        />
      )}
    </div>
  );
}

// ─── StatCard ────────────────────────────────────────────────────────────────
function StatCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  const colorMap: Record<string, string> = {
    slate:   'text-ink', blue: 'text-accent',
    red:     'text-ink',   emerald: 'text-accent', violet: 'text-accent',
  };
  return (
    <div className="bg-paper border border-rule p-4">
      <p className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-2xl font-black ${colorMap[accent] || 'text-ink'}`}>{value}</p>
    </div>
  );
}

// ─── File Case Modal ─────────────────────────────────────────────────────────
function FileCaseModal({ isHr, onClose, onSuccess }: { isHr: boolean; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    type: isHr ? 'DISCIPLINARY' : 'GRIEVANCE',
    title: '',
    summary: '',
    severity: 'MINOR',
    subjectEmployeeId: '',
    subjectEmployeeName: '',
    respondentName: '',
    category: '',
    isUnionised: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetch('/hr-cases', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-shadow/40 backdrop- p-4">
      <div className="bg-paper w-full max-w-lg border border-rule max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-rule sticky top-0 bg-paper">
          <h3 className="text-sm font-black text-ink">
            {isHr ? 'Open New Case' : 'File a Grievance'}
          </h3>
          <p className="text-xs text-muted mt-0.5">
            {!isHr && 'Your grievance will be handled confidentially by HR.'}
          </p>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          {isHr && (
            <Field label="Case Type" required>
              <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input">
                <option value="DISCIPLINARY">Disciplinary</option>
                <option value="GRIEVANCE">Grievance</option>
              </select>
            </Field>
          )}
          <Field label="Title" required>
            <input value={form.title} onChange={e => setForm({...form, title: e.target.value})} className="input" placeholder="Short title for this case" />
          </Field>
          <Field label="Summary" required>
            <textarea rows={4} value={form.summary} onChange={e => setForm({...form, summary: e.target.value})} className="input resize-none" placeholder="Describe what happened, when, and any context" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Severity" required>
              <select value={form.severity} onChange={e => setForm({...form, severity: e.target.value})} className="input">
                {SEVERITIES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className="input">
                <option value="">—</option>
                <option value="misconduct">Misconduct</option>
                <option value="harassment">Harassment</option>
                <option value="discrimination">Discrimination</option>
                <option value="attendance">Attendance</option>
                <option value="performance">Performance</option>
                <option value="workplace_bullying">Workplace Bullying</option>
                <option value="policy_violation">Policy Violation</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
          {isHr && form.type === 'DISCIPLINARY' && (
            <>
              <Field label="Subject Employee ID" required>
                <input value={form.subjectEmployeeId} onChange={e => setForm({...form, subjectEmployeeId: e.target.value})} className="input" />
              </Field>
              <Field label="Subject Employee Name" required>
                <input value={form.subjectEmployeeName} onChange={e => setForm({...form, subjectEmployeeName: e.target.value})} className="input" />
              </Field>
            </>
          )}
          {form.type === 'GRIEVANCE' && (
            <Field label="Respondent (if any)">
              <input value={form.respondentName} onChange={e => setForm({...form, respondentName: e.target.value})} className="input" placeholder="Name of person being complained about" />
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isUnionised} onChange={e => setForm({...form, isUnionised: e.target.checked})} />
            Subject is a union member
          </label>
          {form.category === 'discrimination' && (
            <div className="p-3 bg-page border border-highlight text-xs text-ink">
              <strong>Note:</strong> Discrimination cases are auto-flagged for TAFEP referral.
            </div>
          )}
          {error && <div className="p-3 bg-page border border-ink text-sm text-ink font-bold">{error}</div>}
          <div className="flex gap-3 pt-1">
            <button onClick={save} disabled={saving || !form.title.trim() || !form.summary.trim()} className="flex-1 py-2.5 bg-accent text-paper text-xs font-black uppercase tracking-widest hover:bg-accent disabled:opacity-50">
              {saving ? 'Filing…' : 'Submit'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-rule text-ink text-xs font-black uppercase tracking-widest hover:bg-page">Cancel</button>
          </div>
        </div>
      </div>
      <style jsx>{`
        :global(.input) {
          width: 100%; border: 1px solid var(--rule);
          padding: 0.6rem 0.9rem; font-size: 0.875rem; outline: none;
          transition: all 0.15s;
        }
        :global(.input:focus) {
          border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-black text-ink uppercase tracking-wider mb-1.5">
        {label}{required && <span className="text-ink"> *</span>}
      </label>
      {children}
    </div>
  );
}
