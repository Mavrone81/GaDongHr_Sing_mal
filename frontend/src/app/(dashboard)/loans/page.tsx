'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { TONES } from '@/lib/statusTone';
import { PageHeader, Card, Stat, Tabs, Button, EmptyState, Field, Input, Textarea, Modal, Icon } from '@/components/ui';

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

const STATUS_TONE: Record<string, string> = {
  PENDING:     TONES.pending,
  APPROVED:    TONES.approved,
  ACTIVE:      TONES.active,     // being repaid
  DEDUCTED:    TONES.active,
  SETTLED:     TONES.done,
  REJECTED:    TONES.critical,
  WRITTEN_OFF: TONES.critical,   // money the company will not see again
  CANCELLED:   TONES.inert,
};

/** Status word in sentence case — the tone makes the list scannable, the word carries the meaning. */
function statusLabel(s: string) {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}
function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs whitespace-nowrap ${STATUS_TONE[status] || 'bg-pill text-muted'}`}>
      {statusLabel(status)}
    </span>
  );
}

const sgd = (n: number) => `SGD ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function LoansPage() {
  const { user } = useAuth();
  const router = useRouter();
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
        apiFetchRaw('/loans/advances').then(r => r.json()),
        apiFetchRaw('/loans/staff-loans').then(r => r.json()),
        isApprover ? apiFetchRaw('/loans/dashboard').then(r => r.json()) : Promise.resolve(null),
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
    const res = await apiFetchRaw(`/loans/advances/${id}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(month ? { deductionMonth: month } : {}),
    });
    if (res.ok) loadData(); else alert((await res.json()).error || 'Failed');
  }
  async function rejectAdvance(id: string) {
    const reason = window.prompt('Reason for rejection?');
    if (!reason || !reason.trim()) return;
    const res = await apiFetchRaw(`/loans/advances/${id}/reject`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason: reason.trim() }),
    });
    if (res.ok) loadData(); else alert((await res.json()).error || 'Failed');
  }
  async function cancelAdvance(id: string) {
    if (!confirm('Cancel this advance?')) return;
    const res = await apiFetchRaw(`/loans/advances/${id}/cancel`, { method: 'PUT' });
    if (res.ok) loadData(); else alert((await res.json()).error || 'Failed');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 rounded-full border-2 border-rule border-t-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={isApprover ? 'Salary advances & staff loans' : 'My loans'}
        subtitle="Advances, loans and repayments"
        actions={
          <>
            <Button variant="secondary" icon="plus" onClick={() => setShowAdvanceModal(true)}>Request advance</Button>
            <Button variant="primary" icon="plus" onClick={() => setShowLoanModal(true)}>Apply for loan</Button>
          </>
        }
      />

      {/* Approver dashboard */}
      {isApprover && dashboard && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat label="Active loans" value={dashboard.loans.activeCount} />
          <Stat label="Pending approvals" value={dashboard.loans.pendingCount + dashboard.advances.pending} />
          <Stat label="Outstanding balance" value={sgd(dashboard.loans.totalOutstanding)} />
          <Stat label="Advances approved" value={sgd(dashboard.advances.totalApprovedAmount)} />
        </div>
      )}

      <Tabs
        items={[
          { id: 'loans', label: 'Staff loans', count: loans.length },
          { id: 'advances', label: 'Salary advances', count: advances.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* Loans */}
      {tab === 'loans' && (
        loans.length === 0 ? (
          <EmptyState icon="wallet" title="No loans yet" description="Staff loan applications appear here once submitted." />
        ) : (
          <div className="flex flex-col gap-3">
            {loans.map(l => {
              const pct = Math.round((l.totalRepaid / Math.max(l.totalRepayable, 1)) * 100);
              return (
                <Card key={l.id} padding="p-0" className="overflow-hidden">
                  <button
                    type="button"
                    onClick={() => router.push(`/loans/${l.id}`)}
                    className="text-left p-4 sm:p-5 hover:bg-page transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="text-[13px] font-semibold text-muted tabular-nums">{l.loanNumber}</span>
                        <StatusChip status={l.status} />
                        <span className="text-muted" aria-hidden>·</span>
                        <span className="text-sm font-semibold text-ink truncate">{l.employeeName}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-[12.5px] font-semibold text-muted">Principal</p>
                        <p className="text-sm font-bold text-ink tabular-nums">{sgd(l.principal)}</p>
                      </div>
                    </div>
                    <p className="text-sm text-ink mb-3 line-clamp-1">{l.reason}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <p className="text-[12.5px] font-semibold text-muted">Monthly</p>
                        <p className="text-ink font-semibold mt-0.5 tabular-nums">{sgd(l.monthlyInstalment)}</p>
                      </div>
                      <div>
                        <p className="text-[12.5px] font-semibold text-muted">Tenure</p>
                        <p className="text-ink font-semibold mt-0.5 tabular-nums">{l.tenureMonths} months</p>
                      </div>
                      <div>
                        <p className="text-[12.5px] font-semibold text-muted">Outstanding</p>
                        <p className="text-ink font-semibold mt-0.5 tabular-nums">{sgd(l.outstandingBalance)}</p>
                      </div>
                      <div>
                        <p className="text-[12.5px] font-semibold text-muted">Interest</p>
                        <p className="text-ink font-semibold mt-0.5 tabular-nums">{l.interestRate}% p.a.</p>
                      </div>
                    </div>
                    {l.status === 'ACTIVE' && (
                      <div className="mt-3">
                        <div className="h-1.5 bg-pill rounded-full overflow-hidden">
                          <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 text-[12.5px] text-muted tabular-nums">{pct}% repaid</p>
                      </div>
                    )}
                  </button>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* Advances */}
      {tab === 'advances' && (
        advances.length === 0 ? (
          <EmptyState icon="wallet" title="No advance requests yet" description="Salary advance requests appear here once submitted." />
        ) : (
          <div className="flex flex-col gap-3">
            {advances.map(a => (
              <Card key={a.id}>
                <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-[13px] font-semibold text-muted tabular-nums">{a.advanceNumber}</span>
                    <StatusChip status={a.status} />
                    <span className="text-muted" aria-hidden>·</span>
                    <span className="text-sm font-semibold text-ink truncate">{a.employeeName}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-[12.5px] font-semibold text-muted">Amount</p>
                    <p className="text-sm font-bold text-ink tabular-nums">{sgd(a.amount)}</p>
                  </div>
                </div>
                <p className="text-sm text-ink mb-3">{a.reason}</p>
                <div className="flex items-center justify-between text-[13px] text-muted flex-wrap gap-2">
                  <div className="flex gap-3 flex-wrap">
                    <span>Requested <span className="font-semibold text-ink tabular-nums">{new Date(a.requestedAt).toLocaleDateString('en-SG')}</span></span>
                    {a.deductionMonth && <span>Deduct <span className="font-semibold text-ink tabular-nums">{a.deductionMonth}</span></span>}
                    {a.approvedByName && <span>By <span className="font-semibold text-ink">{a.approvedByName}</span></span>}
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {a.status === 'PENDING' && isApprover && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => approveAdvance(a.id)}>Approve</Button>
                        <Button variant="ghost" size="sm" onClick={() => rejectAdvance(a.id)}>Reject</Button>
                      </>
                    )}
                    {a.status === 'PENDING' && (
                      <Button variant="ghost" size="sm" onClick={() => cancelAdvance(a.id)}>Cancel</Button>
                    )}
                  </div>
                </div>
                {a.rejectionReason && (
                  <p className="mt-3 text-[13px] text-ink bg-page border border-rule rounded-control px-3 py-2">
                    <span className="font-semibold">Rejected:</span> {a.rejectionReason}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )
      )}

      <AdvanceModal open={showAdvanceModal} onClose={() => setShowAdvanceModal(false)} onSuccess={() => { setShowAdvanceModal(false); loadData(); }} />
      <LoanModal open={showLoanModal} onClose={() => setShowLoanModal(false)} onSuccess={() => { setShowLoanModal(false); loadData(); }} />
    </div>
  );
}

// ─── Advance modal ───────────────────────────────────────────────────────────
function AdvanceModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ amount: '', monthlySalary: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetchRaw('/loans/advances', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: parseFloat(form.amount), monthlySalary: parseFloat(form.monthlySalary), reason: form.reason,
      }),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  const disabled = !form.amount || !form.monthlySalary || !form.reason;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request salary advance"
      caption="Deducted in full from your next payroll. Maximum 1× monthly salary."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || disabled}
            reason={disabled && !saving ? 'Fill in amount, salary and reason' : undefined}>
            {saving ? 'Saving…' : 'Submit request'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Amount (SGD)" required>
          <Input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
        </Field>
        <Field label="Your monthly salary (SGD)" required help="Used to enforce the 1× cap">
          <Input type="number" step="0.01" value={form.monthlySalary} onChange={e => setForm({ ...form, monthlySalary: e.target.value })} />
        </Field>
        <Field label="Reason" required>
          <Textarea rows={3} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
        </Field>
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}
      </div>
    </Modal>
  );
}

// ─── Loan modal ──────────────────────────────────────────────────────────────
function LoanModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
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
    const res = await apiFetchRaw('/loans/staff-loans', {
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

  const disabled = !form.principal || !form.tenureMonths || !form.monthlySalary || !form.reason;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply for staff loan"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || disabled}
            reason={disabled && !saving ? 'Fill in the required fields' : undefined}>
            {saving ? 'Saving…' : 'Submit application'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Principal amount (SGD)" required>
          <Input type="number" step="0.01" value={form.principal} onChange={e => setForm({ ...form, principal: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tenure (months)" required>
            <Input type="number" min={1} max={60} value={form.tenureMonths} onChange={e => setForm({ ...form, tenureMonths: e.target.value })} />
          </Field>
          <Field label="Interest %/year">
            <Input type="number" min={0} max={10} step="0.1" value={form.interestRate} onChange={e => setForm({ ...form, interestRate: e.target.value })} />
          </Field>
        </div>
        <Field label="Your monthly salary (SGD)" required help="For the affordability check (max 30% deduction)">
          <Input type="number" step="0.01" value={form.monthlySalary} onChange={e => setForm({ ...form, monthlySalary: e.target.value })} />
        </Field>
        <Field label="Reason" required>
          <Textarea rows={3} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
        </Field>

        {p > 0 && n > 0 && (
          <div className="rounded-control bg-tint border border-rule px-4 py-3 text-sm">
            <p className="font-semibold text-ink mb-1">Live estimate</p>
            <div className="grid grid-cols-3 gap-3">
              <div><p className="text-[12.5px] text-muted">Monthly</p><p className="font-semibold text-ink tabular-nums">{sgd(monthly)}</p></div>
              <div><p className="text-[12.5px] text-muted">Total repayable</p><p className="font-semibold text-ink tabular-nums">{sgd(totalRepayable)}</p></div>
              <div><p className="text-[12.5px] text-muted">Total interest</p><p className="font-semibold text-ink tabular-nums">{sgd(totalInterest)}</p></div>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}
      </div>
    </Modal>
  );
}
