'use client';

import React, { useEffect, useState } from 'react';
import { TONES } from '@/lib/statusTone';
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
  PENDING:     TONES.pending,
  APPROVED:    TONES.approved,
  ACTIVE:      TONES.active,     // being repaid
  DEDUCTED:    TONES.active,
  SETTLED:     TONES.done,
  REJECTED:    TONES.critical,
  WRITTEN_OFF: TONES.critical,   // money the company will not see again
  CANCELLED:   TONES.inert,
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
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-accent border-t-accent animate-spin rounded-full" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-ink">{isApprover ? 'Salary Advances & Staff Loans' : 'My Loans'}</h1>
          <p className="text-xs text-muted mt-0.5 uppercase tracking-widest font-bold">Advances · Loans · Repayments</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowAdvanceModal(true)}
            className="px-4 py-2 bg-muted text-paper text-xs font-black uppercase tracking-widest hover:bg-shadow transition-all"
          >
            + Request Advance
          </button>
          <button
            onClick={() => setShowLoanModal(true)}
            className="px-4 py-2 bg-accent text-paper text-xs font-black uppercase tracking-widest hover:bg-accent transition-all"
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
      <div className="flex gap-1 border-b border-rule">
        {(['loans', 'advances'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-black uppercase tracking-widest transition-all border-b-2 -mb-px ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t === 'loans' ? `Staff Loans (${loans.length})` : `Salary Advances (${advances.length})`}
          </button>
        ))}
      </div>

      {/* Loans list */}
      {tab === 'loans' && (
        loans.length === 0 ? (
          <div className="bg-paper border border-rule p-12 text-center">
            <p className="text-sm text-muted">No loans yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {loans.map(l => (
              <Link key={l.id} href={`/loans/${l.id}`} className="block bg-paper border border-rule p-4 sm:p-5 hover: hover:border-accent transition-all">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-black text-muted">{l.loanNumber}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest  ${STATUS_COLORS[l.status] || 'bg-page text-ink'}`}>
                      {l.status}
                    </span>
                    <span className="text-xs text-muted">·</span>
                    <span className="text-xs font-bold text-ink">{l.employeeName}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-muted uppercase tracking-widest">Principal</p>
                    <p className="text-sm font-black text-ink">SGD {l.principal.toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-sm text-ink mb-3 line-clamp-1">{l.reason}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <p className="text-[10px] font-black text-muted uppercase tracking-wider">Monthly</p>
                    <p className="text-ink font-bold mt-0.5">SGD {l.monthlyInstalment.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-muted uppercase tracking-wider">Tenure</p>
                    <p className="text-ink font-bold mt-0.5">{l.tenureMonths} months</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-muted uppercase tracking-wider">Outstanding</p>
                    <p className="text-ink font-bold mt-0.5">SGD {l.outstandingBalance.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-muted uppercase tracking-wider">Interest</p>
                    <p className="text-ink font-bold mt-0.5">{l.interestRate}% p.a.</p>
                  </div>
                </div>
                {l.status === 'ACTIVE' && (
                  <div className="mt-3 h-1.5 bg-page overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all"
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
          <div className="bg-paper border border-rule p-12 text-center">
            <p className="text-sm text-muted">No advance requests yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {advances.map(a => (
              <div key={a.id} className="bg-paper border border-rule p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-black text-muted">{a.advanceNumber}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest  ${STATUS_COLORS[a.status] || 'bg-page text-ink'}`}>
                      {a.status}
                    </span>
                    <span className="text-xs text-muted">·</span>
                    <span className="text-xs font-bold text-ink">{a.employeeName}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-muted uppercase tracking-widest">Amount</p>
                    <p className="text-sm font-black text-ink">SGD {a.amount.toLocaleString()}</p>
                  </div>
                </div>
                <p className="text-sm text-ink mb-3 italic">"{a.reason}"</p>
                <div className="flex items-center justify-between text-xs text-muted flex-wrap gap-2">
                  <div className="flex gap-3 flex-wrap">
                    <span>Requested: <span className="font-bold text-ink">{new Date(a.requestedAt).toLocaleDateString('en-SG')}</span></span>
                    {a.deductionMonth && <span>Deduct: <span className="font-bold text-ink">{a.deductionMonth}</span></span>}
                    {a.approvedByName && <span>By: <span className="font-bold text-ink">{a.approvedByName}</span></span>}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {a.status === 'PENDING' && isApprover && (
                      <>
                        <button onClick={() => approveAdvance(a.id)} className="text-xs font-bold text-accent hover:text-accent px-2 py-1">Approve</button>
                        <button onClick={() => rejectAdvance(a.id)}  className="text-xs font-bold text-ink hover:text-ink px-2 py-1">Reject</button>
                      </>
                    )}
                    {a.status === 'PENDING' && (
                      <button onClick={() => cancelAdvance(a.id)} className="text-xs font-bold text-muted hover:text-ink px-2 py-1">Cancel</button>
                    )}
                  </div>
                </div>
                {a.rejectionReason && (
                  <p className="mt-2 text-xs text-ink bg-page border border-ink px-3 py-2">
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
    amber: 'text-ink', emerald: 'text-accent', indigo: 'text-accent', teal: 'text-accent',
  };
  return (
    <div className="bg-paper border border-rule p-4">
      <p className="text-[10px] font-black text-muted uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-xl sm:text-2xl font-black ${colorMap[accent] || 'text-ink'}`}>{value}</p>
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
      <p className="text-xs text-muted">
        Salary advances are deducted in full from your next payroll. Maximum 1× monthly salary.
      </p>
      {error && <div className="p-3 bg-page border border-ink text-sm text-ink font-bold">{error}</div>}
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
        <div className="p-4 bg-page border border-accent text-xs space-y-1">
          <p><strong>Live Estimate:</strong></p>
          <p>Monthly instalment: <strong>SGD {monthly.toFixed(2)}</strong></p>
          <p>Total repayable: <strong>SGD {totalRepayable.toFixed(2)}</strong></p>
          <p>Total interest: <strong>SGD {totalInterest.toFixed(2)}</strong></p>
        </div>
      )}
      {error && <div className="p-3 bg-page border border-ink text-sm text-ink font-bold">{error}</div>}
      <ModalFooter onSave={save} onClose={onClose} saving={saving} saveLabel="Submit Application" disabled={!form.principal || !form.tenureMonths || !form.monthlySalary || !form.reason} />
    </Modal>
  );
}

// ─── Modal scaffolding ───────────────────────────────────────────────────────
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-shadow/40 backdrop- p-4">
      <div className="bg-paper w-full max-w-lg border border-rule max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-rule sticky top-0 bg-paper flex items-center justify-between">
          <h3 className="text-sm font-black text-ink">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-page text-muted text-lg">×</button>
        </div>
        <div className="p-6 space-y-4">{children}</div>
      </div>
      <style jsx>{`
        :global(.input) {
          width: 100%; border: 1px solid var(--rule);
          padding: 0.6rem 0.9rem; font-size: 0.875rem; outline: none;
          transition: all 0.15s;
        }
        :global(.input:focus) { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent); }
      `}</style>
    </div>
  );
}

function ModalFooter({ onSave, onClose, saving, saveLabel, disabled }: { onSave: () => void; onClose: () => void; saving: boolean; saveLabel: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3 pt-1">
      <button onClick={onSave} disabled={saving || disabled} className="flex-1 py-2.5 bg-accent text-paper text-xs font-black uppercase tracking-widest hover:bg-accent disabled:opacity-50">
        {saving ? 'Saving…' : saveLabel}
      </button>
      <button onClick={onClose} className="px-5 py-2.5 border border-rule text-ink text-xs font-black uppercase tracking-widest hover:bg-page">Cancel</button>
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
