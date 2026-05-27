'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface Movement {
  id: string;
  movementNumber: string;
  employeeId: string;
  employeeName: string;
  type: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'APPLIED';
  fromDepartment: string;
  toDepartment: string;
  fromDesignation: string;
  toDesignation: string;
  fromCostCentre: string | null;
  toCostCentre: string | null;
  hasSalaryRevision: boolean;
  reason: string;
  effectiveDate: string;
  initiatedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
}

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];

const MOVEMENT_TYPES = [
  'DEPARTMENT_TRANSFER', 'LOCATION_TRANSFER', 'INTER_COMPANY_TRANSFER',
  'ROLE_CHANGE', 'PROMOTION', 'REPORTING_CHANGE', 'COST_CENTRE_REALLOC',
];

const TYPE_LABELS: Record<string, string> = {
  DEPARTMENT_TRANSFER:     'Department Transfer',
  LOCATION_TRANSFER:       'Location Transfer',
  INTER_COMPANY_TRANSFER:  'Inter-Company Transfer',
  ROLE_CHANGE:             'Role Change',
  PROMOTION:               'Promotion',
  REPORTING_CHANGE:        'Reporting Change',
  COST_CENTRE_REALLOC:     'Cost Centre Realloc',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-100 text-amber-700',
  APPROVED:  'bg-blue-100 text-blue-700',
  REJECTED:  'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-600',
  APPLIED:   'bg-emerald-100 text-emerald-700',
};

export default function MovementsPage() {
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isHr = HR_ROLES.includes(role);

  const [movements, setMovements] = useState<Movement[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'pending' | 'upcoming' | 'history'>('all');
  const [showInitiateModal, setShowInitiateModal] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await apiFetch('/movements').then(r => r.json());
      setMovements(res.movements || []);
      setSummary(res.summary);
    } catch (err) {
      console.error('[movements] load failed', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) loadData(); }, [user]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }

  const now = new Date();
  const filteredMovements = movements.filter(m => {
    if (tab === 'pending')  return m.status === 'PENDING';
    if (tab === 'upcoming') return m.status === 'APPROVED' && new Date(m.effectiveDate) > now;
    if (tab === 'history')  return ['APPLIED', 'REJECTED', 'CANCELLED'].includes(m.status);
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">{isHr ? 'Staff Movements' : 'My Transfers'}</h1>
          <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-widest font-bold">
            Internal transfers · Role changes · Promotions
          </p>
        </div>
        <button
          onClick={() => setShowInitiateModal(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all"
        >
          + {isHr ? 'New Movement' : 'Request Transfer'}
        </button>
      </div>

      {/* HR Stats */}
      {isHr && summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Pending"          value={summary.pending || 0}        accent="amber"   />
          <StatCard label="Approved"         value={summary.approved || 0}       accent="blue"    />
          <StatCard label="Effective Today"  value={summary.effectiveToday || 0} accent="violet"  />
          <StatCard label="Next 30 Days"     value={summary.upcoming30d || 0}    accent="indigo"  />
          <StatCard label="Applied YTD"      value={summary.applied || 0}        accent="emerald" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {(['all', 'pending', 'upcoming', 'history'] as const).map(t => (
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

      {/* List */}
      {filteredMovements.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
          <p className="text-sm text-slate-500">No movements in this view.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMovements.map(m => (
            <Link key={m.id} href={`/movements/${m.id}`} className="block bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-indigo-200 transition-all">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-xs font-mono font-black text-slate-500">{m.movementNumber}</span>
                    <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-indigo-50 text-indigo-700">
                      {TYPE_LABELS[m.type] || m.type}
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[m.status] || 'bg-slate-100 text-slate-600'}`}>
                      {m.status}
                    </span>
                    {m.hasSalaryRevision && (
                      <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full bg-emerald-50 text-emerald-700">
                        $ Salary Revision
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-black text-slate-900 mb-1">{m.employeeName}</h3>
                  <div className="text-sm text-slate-600 space-y-0.5">
                    {m.fromDepartment !== m.toDepartment && (
                      <p><span className="text-slate-400 font-bold">Dept:</span> {m.fromDepartment} → <span className="font-bold text-slate-700">{m.toDepartment}</span></p>
                    )}
                    {m.fromDesignation !== m.toDesignation && (
                      <p><span className="text-slate-400 font-bold">Role:</span> {m.fromDesignation} → <span className="font-bold text-slate-700">{m.toDesignation}</span></p>
                    )}
                    {(m.fromCostCentre || '') !== (m.toCostCentre || '') && (
                      <p><span className="text-slate-400 font-bold">CC:</span> {m.fromCostCentre || '—'} → <span className="font-bold text-slate-700">{m.toCostCentre || '—'}</span></p>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Effective</div>
                  <div className="text-sm font-black text-slate-700 mt-1">
                    {new Date(m.effectiveDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                  {m.initiatedByName && (
                    <div className="text-[10px] font-bold text-slate-500 mt-1">by {m.initiatedByName}</div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showInitiateModal && (
        <InitiateModal
          isHr={isHr}
          defaultEmployeeId={!isHr ? (user?.employeeId || user?.id || '') : ''}
          onClose={() => setShowInitiateModal(false)}
          onSuccess={() => { setShowInitiateModal(false); loadData(); }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  const colorMap: Record<string, string> = {
    amber:   'text-amber-700', blue: 'text-blue-700',
    violet:  'text-violet-700', indigo: 'text-indigo-700', emerald: 'text-emerald-700',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-2xl font-black ${colorMap[accent] || 'text-slate-700'}`}>{value}</p>
    </div>
  );
}

// ─── Initiate Modal ──────────────────────────────────────────────────────────
function InitiateModal({ isHr, defaultEmployeeId, onClose, onSuccess }: { isHr: boolean; defaultEmployeeId: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    employeeId: defaultEmployeeId,
    type: 'DEPARTMENT_TRANSFER',
    toDepartment: '',
    toDesignation: '',
    toCostCentre: '',
    toLocation: '',
    toReportingManagerId: '',
    toCompany: '',
    reason: '',
    effectiveDate: '',
    hasSalaryRevision: false,
    toSalary: '',
    salaryReasonCode: 'ROLE_CHANGE',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const body: any = { ...form };
    Object.keys(body).forEach(k => body[k] === '' && delete body[k]);
    if (form.hasSalaryRevision) {
      body.toSalary = parseFloat(form.toSalary);
    } else {
      delete body.toSalary;
      delete body.salaryReasonCode;
    }
    const res = await apiFetch('/movements', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  const showDept = ['DEPARTMENT_TRANSFER'].includes(form.type);
  const showRole = ['ROLE_CHANGE','PROMOTION'].includes(form.type);
  const showCC   = ['COST_CENTRE_REALLOC'].includes(form.type);
  const showLoc  = ['LOCATION_TRANSFER'].includes(form.type);
  const showMgr  = ['REPORTING_CHANGE'].includes(form.type);
  const showCo   = ['INTER_COMPANY_TRANSFER'].includes(form.type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 sticky top-0 bg-white flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">{isHr ? 'New Staff Movement' : 'Request a Transfer'}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 text-lg">×</button>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          {isHr && (
            <Field label="Employee ID" required>
              <input value={form.employeeId} onChange={e => setForm({...form, employeeId: e.target.value})} className="input" />
            </Field>
          )}
          <Field label="Movement Type" required>
            <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="input">
              {MOVEMENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </Field>

          {showDept && (
            <Field label="To Department" required>
              <input value={form.toDepartment} onChange={e => setForm({...form, toDepartment: e.target.value})} className="input" />
            </Field>
          )}
          {showRole && (
            <Field label="To Designation" required>
              <input value={form.toDesignation} onChange={e => setForm({...form, toDesignation: e.target.value})} className="input" />
            </Field>
          )}
          {showCC && (
            <Field label="To Cost Centre" required>
              <input value={form.toCostCentre} onChange={e => setForm({...form, toCostCentre: e.target.value})} className="input" />
            </Field>
          )}
          {showLoc && (
            <Field label="To Location" required>
              <input value={form.toLocation} onChange={e => setForm({...form, toLocation: e.target.value})} className="input" />
            </Field>
          )}
          {showMgr && (
            <Field label="New Reporting Manager (Employee ID)" required>
              <input value={form.toReportingManagerId} onChange={e => setForm({...form, toReportingManagerId: e.target.value})} className="input" />
            </Field>
          )}
          {showCo && (
            <Field label="To Company" required>
              <input value={form.toCompany} onChange={e => setForm({...form, toCompany: e.target.value})} className="input" />
            </Field>
          )}

          <Field label="Effective Date" required>
            <input type="date" value={form.effectiveDate} onChange={e => setForm({...form, effectiveDate: e.target.value})} className="input" />
          </Field>

          <Field label="Reason" required>
            <textarea rows={3} value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} className="input resize-none" />
          </Field>

          {isHr && showRole && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.hasSalaryRevision} onChange={e => setForm({...form, hasSalaryRevision: e.target.checked})} />
                Include salary revision
              </label>
              {form.hasSalaryRevision && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="New Monthly Salary (SGD)" required>
                    <input type="number" value={form.toSalary} onChange={e => setForm({...form, toSalary: e.target.value})} className="input" />
                  </Field>
                  <Field label="Reason Code">
                    <select value={form.salaryReasonCode} onChange={e => setForm({...form, salaryReasonCode: e.target.value})} className="input">
                      <option value="PROMOTION">Promotion</option>
                      <option value="ROLE_CHANGE">Role Change</option>
                      <option value="MARKET_ADJUSTMENT">Market Adjustment</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </Field>
                </div>
              )}
            </>
          )}

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
          <div className="flex gap-3 pt-1">
            <button onClick={save} disabled={saving || !form.reason.trim() || !form.effectiveDate} className="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Submitting…' : 'Submit'}
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
        :global(.input:focus) { border-color: rgb(99 102 241); box-shadow: 0 0 0 2px rgba(99,102,241,0.15); }
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
