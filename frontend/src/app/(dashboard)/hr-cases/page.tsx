'use client';

import React, { useEffect, useState } from 'react';
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
  OPEN:                'bg-blue-100 text-blue-700',
  UNDER_INVESTIGATION: 'bg-violet-100 text-violet-700',
  PENDING_DECISION:    'bg-amber-100 text-amber-700',
  RESOLVED:            'bg-emerald-100 text-emerald-700',
  CLOSED:              'bg-slate-100 text-slate-600',
  WITHDRAWN:           'bg-slate-100 text-slate-500',
};

const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  MINOR:            { bg: 'bg-slate-100', text: 'text-slate-700' },
  MODERATE:         { bg: 'bg-amber-100', text: 'text-amber-700' },
  SERIOUS:          { bg: 'bg-orange-100',text: 'text-orange-700' },
  GROSS_MISCONDUCT: { bg: 'bg-red-100',   text: 'text-red-700' },
};

const TYPE_COLORS: Record<string, string> = {
  DISCIPLINARY: 'bg-rose-50 text-rose-700',
  GRIEVANCE:    'bg-indigo-50 text-indigo-700',
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
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
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
          <h1 className="text-xl font-black text-slate-900">{isHr ? 'HR Case Management' : 'My Cases'}</h1>
          <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-widest font-bold">
            {isHr ? 'Disciplinary · Grievances · Investigations' : 'Grievances & Personal Cases'}
          </p>
        </div>
        <button
          onClick={() => setShowFileModal(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all"
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
        <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <span className="text-2xl">⚠</span>
          <div className="flex-1">
            <p className="text-sm font-black text-red-700 uppercase tracking-wider">
              {dashboard.overdueEscalation.length} case{dashboard.overdueEscalation.length > 1 ? 's' : ''} past SLA
            </p>
            <p className="text-xs text-red-600 mt-1">
              {dashboard.overdueEscalation.slice(0, 3).map((c: any) => c.caseNumber).join(', ')}
              {dashboard.overdueEscalation.length > 3 && ` + ${dashboard.overdueEscalation.length - 3} more`}
            </p>
          </div>
          <button
            onClick={() => setTab('overdue')}
            className="text-xs font-black text-red-700 hover:text-red-800 uppercase tracking-widest px-3 py-1.5 border border-red-300 rounded-lg hover:bg-red-100 transition-all"
          >
            View →
          </button>
        </div>
      )}

      {/* Filters & Tabs */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 border-b border-slate-200">
          {(['all','open','overdue'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all border-b-2 -mb-px ${
                tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg font-bold text-slate-700">
            <option value="">All types</option>
            <option value="DISCIPLINARY">Disciplinary</option>
            <option value="GRIEVANCE">Grievance</option>
          </select>
          <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} className="text-xs px-3 py-1.5 border border-slate-200 rounded-lg font-bold text-slate-700">
            <option value="">All severities</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </div>

      {/* Case List */}
      {filteredCases.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
          <p className="text-sm text-slate-500">No cases in this view.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredCases.map(c => {
            const sv = SEVERITY_COLORS[c.severity];
            return (
              <Link key={c.id} href={`/hr-cases/${c.id}`} className="block bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-indigo-200 transition-all">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="text-xs font-mono font-black text-slate-500">{c.caseNumber}</span>
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${TYPE_COLORS[c.type]}`}>
                        {c.type}
                      </span>
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${sv.bg} ${sv.text}`}>
                        {c.severity.replace(/_/g, ' ')}
                      </span>
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[c.status] || 'bg-slate-100 text-slate-600'}`}>
                        {c.status.replace(/_/g, ' ')}
                      </span>
                      {c.isTafepReportable && (
                        <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-orange-100 text-orange-700">
                          TAFEP
                        </span>
                      )}
                      {c.escalation?.shouldEscalate && (
                        <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-red-100 text-red-700 animate-pulse">
                          ⚠ Past SLA
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-black text-slate-900 mb-1">{c.title}</h3>
                    <p className="text-sm text-slate-500 truncate">{c.summary}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                      <span>Subject: <span className="font-bold text-slate-700">{c.subjectEmployeeName}</span></span>
                      <span>Opened: <span className="font-bold text-slate-700">{new Date(c.openedAt).toLocaleDateString('en-SG')}</span></span>
                      {c.escalation && (
                        <span>{c.escalation.daysOpen}d open · SLA {c.escalation.slaDays}d</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Stage</div>
                    <div className="text-xs font-black text-slate-700 mt-1">{c.currentStage}</div>
                    {c.progress && (
                      <div className="mt-2 w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${c.progress.percent}%` }} />
                      </div>
                    )}
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">
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
    slate:   'text-slate-700', blue: 'text-blue-700',
    red:     'text-red-700',   emerald: 'text-emerald-700', violet: 'text-violet-700',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-2xl font-black ${colorMap[accent] || 'text-slate-700'}`}>{value}</p>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h3 className="text-sm font-black text-slate-900">
            {isHr ? 'Open New Case' : 'File a Grievance'}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
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
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl text-xs text-orange-700">
              <strong>Note:</strong> Discrimination cases are auto-flagged for TAFEP referral.
            </div>
          )}
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
          <div className="flex gap-3 pt-1">
            <button onClick={save} disabled={saving || !form.title.trim() || !form.summary.trim()} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Filing…' : 'Submit'}
            </button>
            <button onClick={onClose} className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50">Cancel</button>
          </div>
        </div>
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
