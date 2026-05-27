'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

interface Advance {
  id: string;
  advanceNumber: string;
  employeeId: string;
  employeeName: string;
  monthlySalary: number;
  amount: number;
  reason: string;
  status: string;
  requestedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  deductionMonth: string | null;
  rejectionReason: string | null;
}

interface Loan {
  id: string;
  loanNumber: string;
  employeeId: string;
  employeeName: string;
  monthlySalary: number;
  principal: number;
  interestRate: number;
  tenureMonths: number;
  monthlyInstalment: number;
  totalRepayable: number;
  outstandingBalance: number;
  totalRepaid: number;
  status: string;
  reason: string;
  requestedAt: string;
  approvedByName: string | null;
  startDate: string | null;
  expectedEndDate: string | null;
  actualEndDate: string | null;
}

const HR_ROLES      = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];
const FINANCE_ROLES = ['FINANCE_ADMIN', 'SUPER_ADMIN'];
const APPROVER_ROLES = [...HR_ROLES, ...FINANCE_ROLES];

const STATUS_COLORS: Record<string, string> = {
  PENDING:     'bg-amber-100 text-amber-700',
  APPROVED:    'bg-blue-100 text-blue-700',
  REJECTED:    'bg-red-100 text-red-700',
  CANCELLED:   'bg-slate-100 text-slate-600',
  DEDUCTED:    'bg-teal-100 text-teal-700',
  ACTIVE:      'bg-emerald-100 text-emerald-700',
  SETTLED:     'bg-emerald-100 text-emerald-700',
  WRITTEN_OFF: 'bg-rose-100 text-rose-700',
};

export default function LoansPage() {
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isApprover = APPROVER_ROLES.includes(role);

  const [tab, setTab] = useState<'loans' | 'advances'>('loans');
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [loans, setLoans]       = useState<Loan[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [showLoanModal, setShowLoanModal] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [advRes, loanRes, dashRes] = await Promise.all([
        apiFetch('/loans/advances').then(r => r.json()),
        apiFetch('/loans/staff-loans').then(r => r.json()),
        isApprover ? apiFetch('/loans/dashboard').then(r => r.json()) : Promise.resolve(null),
      ]);
      setAdvances(advRes.advances || []);
      setLoans(loanRes.loans || []);
      setDashboard(dashRes);
    } catch (err) {
      console.error('[loans] load failed', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) loadData(); }, [user, isApprover]);

  async function approveAdvance(id: string) {
    if (!confirm('Approve this advance request?')) return;
    const month = window.prompt('Deduction month (YYYY-MM, blank = next payroll):', '') || undefined;
    const res = await apiFetch(`/loans/advances/${id}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(month ? { deductionMonth: month } : {}),
    });
    if (res.ok) loadData(); else alert((await res.json()).error || 'Failed');
  }
  async function rejectAdvance(id: string) {
    const reason = window.prompt('Reason for rejection?');
    if (!reason || !reason.trim()) return;
    const res = await apiFetch(`/loans/advances/${id}/reject`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason: reason.trim() }),
    });
    if (res.ok) loadData(); else alert((await res.json()).error || 'Failed');
  }
  async function cancelAdvance(id: string) {
    if (!confirm('Cancel this advance?')) return;
    const res = await apiFetch(`/loans/advances/${id}/cancel`, { method: 'PUT' });
    if (res.ok) loadData(); else alert((await res.json()).error || 'Failed');
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">{isApprover ? 'Salary Advances & Staff Loans' : 'My Loans'}</h1>
          <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-widest font-bold">Advances · Loans · Repayments</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowAdvanceModal(true)}
            className="px-4 py-2 bg-slate-700 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all"
          >
            + Request Advance
          </button>
          <button
            onClick={() => setShowLoanModal(true)}
            className="px-4 py-2 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 transition-all"
          >
            + Apply for Loan
          </button>
        </div>
      </div>

      {/* Approver dashboard */}
      {isApprover && dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Active Loans"        value={dashboard.loans.activeCount}     accent="emerald" />
          <StatCard label="Pending Approvals"   value={dashboard.loans.pendingCount + dashboard.advances.pending} accent="amber" />
          <StatCard label="Outstanding Balance" value={`SGD ${dashboard.loans.totalOutstanding.toLocaleString()}`} accent="indigo" />
          <StatCard label="Advances Approved"   value={`SGD ${dashboard.advances.totalApprovedAmount.toLocaleString()}`} accent="teal" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['loans', 'advances'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all border-b-2 -mb-px ${
              tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'loans' ? `Staff Loans (${loans.length})` : `Salary Advances (${advances.length})`}
          </button>
        ))}
      </div>

      {/* Loans list */}
      {tab === 'loans' && (
        loans.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
            <p className="text-sm text-slate-500">No loans yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {loans.map(l => (
              <Link key={l.id} href={`/loans/${l.id}`} className="block bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 hover:shadow-md hover:border-indigo-200 transition-all">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-black text-slate-500">{l.loanNumber}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[l.status] || 'bg-slate-100 text-slate-600'}`}>
                      {l.status}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs font-bold text-slate-700">{l.employeeName}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Principal</p>
                    <p className="text-sm font-black text-slate-900">SGD {l.principal.toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mb-3 line-clamp-1">{l.reason}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Monthly</p>
                    <p className="text-slate-700 font-bold mt-0.5">SGD {l.monthlyInstalment.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Tenure</p>
                    <p className="text-slate-700 font-bold mt-0.5">{l.tenureMonths} months</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Outstanding</p>
                    <p className="text-slate-700 font-bold mt-0.5">SGD {l.outstandingBalance.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Interest</p>
                    <p className="text-slate-700 font-bold mt-0.5">{l.interestRate}% p.a.</p>
                  </div>
                </div>
                {l.status === 'ACTIVE' && (
                  <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.round((l.totalRepaid / Math.max(l.totalRepayable, 1)) * 100)}%` }}
                    />
                  </div>
                )}
              </Link>
            ))}
          </div>
        )
      )}

      {/* Advances list */}
      {tab === 'advances' && (
        advances.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
            <p className="text-sm text-slate-500">No advance requests yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {advances.map(a => (
              <div key={a.id} className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-black text-slate-500">{a.advanceNumber}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[a.status] || 'bg-slate-100 text-slate-600'}`}>
                      {a.status}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs font-bold text-slate-700">{a.employeeName}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</p>
                    <p className="text-sm font-black text-slate-900">SGD {a.amount.toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-600 mb-3 italic">"{a.reason}"</p>
                <div className="flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
                  <div className="flex gap-3 flex-wrap">
                    <span>Requested: <span className="font-bold text-slate-700">{new Date(a.requestedAt).toLocaleDateString('en-SG')}</span></span>
                    {a.deductionMonth && <span>Deduct: <span className="font-bold text-slate-700">{a.deductionMonth}</span></span>}
                    {a.approvedByName && <span>By: <span className="font-bold text-slate-700">{a.approvedByName}</span></span>}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {a.status === 'PENDING' && isApprover && (
                      <>
                        <button onClick={() => approveAdvance(a.id)} className="text-xs font-bold text-emerald-600 hover:text-emerald-700 px-2 py-1">Approve</button>
                        <button onClick={() => rejectAdvance(a.id)}  className="text-xs font-bold text-red-500 hover:text-red-600 px-2 py-1">Reject</button>
                      </>
                    )}
                    {a.status === 'PENDING' && (
                      <button onClick={() => cancelAdvance(a.id)} className="text-xs font-bold text-slate-500 hover:text-slate-700 px-2 py-1">Cancel</button>
                    )}
                  </div>
                </div>
                {a.rejectionReason && (
                  <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <strong>Rejected:</strong> {a.rejectionReason}
                  </p>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {showAdvanceModal && (
        <AdvanceModal onClose={() => setShowAdvanceModal(false)} onSuccess={() => { setShowAdvanceModal(false); loadData(); }} />
      )}
      {showLoanModal && (
        <LoanModal onClose={() => setShowLoanModal(false)} onSuccess={() => { setShowLoanModal(false); loadData(); }} />
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  const colorMap: Record<string, string> = {
    amber: 'text-amber-700', emerald: 'text-emerald-700', indigo: 'text-indigo-700', teal: 'text-teal-700',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-xl sm:text-2xl font-black ${colorMap[accent] || 'text-slate-700'}`}>{value}</p>
    </div>
  );
}

// ─── Advance Modal ────────────────────────────────────────────────────────────
function AdvanceModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ amount: '', monthlySalary: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetch('/loans/advances', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: parseFloat(form.amount), monthlySalary: parseFloat(form.monthlySalary), reason: form.reason,
      }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal title="Request Salary Advance" onClose={onClose}>
      <Field label="Amount (SGD)" required>
        <input type="number" step="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} className="input" />
      </Field>
      <Field label="Your Monthly Salary (SGD)" required>
        <input type="number" step="0.01" value={form.monthlySalary} onChange={e => setForm({...form, monthlySalary: e.target.value})} className="input" placeholder="Used to enforce 1× cap" />
      </Field>
      <Field label="Reason" required>
        <textarea rows={3} value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} className="input resize-none" />
      </Field>
      <p className="text-xs text-slate-500">
        Salary advances are deducted in full from your next payroll. Maximum 1× monthly salary.
      </p>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
      <ModalFooter onSave={save} onClose={onClose} saving={saving} saveLabel="Submit Request" disabled={!form.amount || !form.monthlySalary || !form.reason} />
    </Modal>
  );
}

// ─── Loan Modal ──────────────────────────────────────────────────────────────
function LoanModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    principal: '', interestRate: '0', tenureMonths: '12', monthlySalary: '', reason: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Live estimate
  const p = parseFloat(form.principal) || 0;
  const r = parseFloat(form.interestRate) || 0;
  const n = parseInt(form.tenureMonths) || 0;
  const totalInterest = p * (r / 100) * (n / 12);
  const monthly = n > 0 ? Math.round(((p + totalInterest) / n) * 100) / 100 : 0;
  const totalRepayable = Math.round((p + totalInterest) * 100) / 100;

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetch('/loans/staff-loans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        principal: p, interestRate: r, tenureMonths: n,
        monthlySalary: parseFloat(form.monthlySalary), reason: form.reason,
      }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  return (
    <Modal title="Apply for Staff Loan" onClose={onClose}>
      <Field label="Principal Amount (SGD)" required>
        <input type="number" step="0.01" value={form.principal} onChange={e => setForm({...form, principal: e.target.value})} className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tenure (months)" required>
          <input type="number" min={1} max={60} value={form.tenureMonths} onChange={e => setForm({...form, tenureMonths: e.target.value})} className="input" />
        </Field>
        <Field label="Interest %/year">
          <input type="number" min={0} max={10} step="0.1" value={form.interestRate} onChange={e => setForm({...form, interestRate: e.target.value})} className="input" />
        </Field>
      </div>
      <Field label="Your Monthly Salary (SGD)" required>
        <input type="number" step="0.01" value={form.monthlySalary} onChange={e => setForm({...form, monthlySalary: e.target.value})} className="input" placeholder="For affordability check (max 30% deduction)" />
      </Field>
      <Field label="Reason" required>
        <textarea rows={3} value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} className="input resize-none" />
      </Field>

      {p > 0 && n > 0 && (
        <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-xs space-y-1">
          <p><strong>Live Estimate:</strong></p>
          <p>Monthly instalment: <strong>SGD {monthly.toFixed(2)}</strong></p>
          <p>Total repayable: <strong>SGD {totalRepayable.toFixed(2)}</strong></p>
          <p>Total interest: <strong>SGD {totalInterest.toFixed(2)}</strong></p>
        </div>
      )}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">{error}</div>}
      <ModalFooter onSave={save} onClose={onClose} saving={saving} saveLabel="Submit Application" disabled={!form.principal || !form.tenureMonths || !form.monthlySalary || !form.reason} />
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
        <div className="p-6 space-y-4">{children}</div>
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
