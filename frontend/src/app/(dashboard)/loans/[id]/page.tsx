'use client';

import React, { useEffect, useState } from 'react';
import { TONES } from '@/lib/statusTone';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];
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

const REPAY_COLORS: Record<string, string> = {
  PENDING: 'bg-page text-ink',
  PAID:    'bg-page text-accent',
  OVERDUE: 'bg-page text-ink',
  WAIVED:  'bg-page text-ink',
};

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isApprover = APPROVER_ROLES.includes(role);

  const [loan, setLoan] = useState<any>(null);
  const [agreement, setAgreement] = useState<string>('');
  const [loadingAg, setLoadingAg] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch(`/loans/staff-loans/${id}`);
      if (!res.ok) { const e = await res.json(); setError(e.error || 'Failed'); return; }
      setLoan(await res.json());
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function approve() {
    const start = window.prompt('First deduction date (YYYY-MM-DD), blank = 1st of next month:') || '';
    if (!confirm('Approve this loan? This will generate the repayment schedule.')) return;
    const res = await apiFetch(`/loans/staff-loans/${id}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(start ? { startDate: start } : {}),
    });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function reject() {
    const reason = window.prompt('Rejection reason?');
    if (!reason || !reason.trim()) return;
    const res = await apiFetch(`/loans/staff-loans/${id}/reject`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason: reason.trim() }),
    });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function activate() {
    if (!confirm('Activate this loan? Schedule will start.')) return;
    const res = await apiFetch(`/loans/staff-loans/${id}/activate`, { method: 'PUT' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function cancelLoan() {
    if (!confirm('Cancel this loan?')) return;
    const res = await apiFetch(`/loans/staff-loans/${id}/cancel`, { method: 'PUT' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function recordRepayment(paymentNumber: number) {
    if (!confirm(`Mark payment #${paymentNumber} as paid?`)) return;
    const res = await apiFetch(`/loans/staff-loans/${id}/repayments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentNumber }),
    });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function settleEarly() {
    if (!loan) return;
    const amt = loan.earlySettlement?.settlementAmount || loan.outstandingBalance;
    if (!confirm(`Settle loan early for SGD ${amt}? All remaining scheduled payments will be waived.`)) return;
    const res = await apiFetch(`/loans/staff-loans/${id}/settle`, { method: 'POST' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function loadAgreement() {
    setLoadingAg(true);
    const res = await apiFetch(`/loans/staff-loans/${id}/agreement`).then(r => r.json());
    setAgreement(res.html || '');
    setLoadingAg(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-accent border-t-accent animate-spin rounded-full" /></div>;
  }
  if (error || !loan) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <h2 className="text-lg font-black text-ink mb-2">Loan Not Found</h2>
        <p className="text-sm text-muted mb-6">{error}</p>
        <Link href="/loans" className="text-xs font-bold text-accent hover:text-accent">← Back to Loans</Link>
      </div>
    );
  }

  const isOwn = loan.employeeId === (user?.employeeId || (user as any)?.sub);
  const canApprove  = isApprover && loan.status === 'PENDING';
  const canActivate = isApprover && loan.status === 'APPROVED';
  const canCancel   = (isOwn || isApprover) && loan.status === 'PENDING';
  const canSettle   = (isOwn || isApprover) && ['ACTIVE','APPROVED'].includes(loan.status) && loan.outstandingBalance > 0;

  const progressPct = Math.round((loan.totalRepaid / Math.max(loan.totalRepayable, 1)) * 100);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Link href="/loans" className="text-xs font-bold text-muted hover:text-accent">← Back to Loans</Link>
        <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest  ${STATUS_COLORS[loan.status] || 'bg-page text-ink'}`}>
          {loan.status}
        </span>
      </div>

      {/* Top card */}
      <div className="bg-paper border border-rule p-4 sm:p-6">
        <p className="text-xs font-mono font-black text-muted mb-1">{loan.loanNumber}</p>
        <h1 className="text-xl font-black text-ink">Staff Loan for {loan.employeeName}</h1>
        <p className="text-sm text-ink mt-2 italic">"{loan.reason}"</p>

        {/* Progress bar */}
        {['ACTIVE','SETTLED','APPROVED'].includes(loan.status) && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs font-bold text-muted mb-2">
              <span className="uppercase tracking-widest">Repayment Progress</span>
              <span>SGD {loan.totalRepaid.toLocaleString()} / SGD {loan.totalRepayable.toLocaleString()} ({progressPct}%)</span>
            </div>
            <div className="h-2 bg-page overflow-hidden">
              <div className="h-full bg-gradient-to-r from-accent to-accent transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        {/* Meta grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 text-xs">
          <Meta label="Principal"    value={`SGD ${loan.principal.toLocaleString()}`} />
          <Meta label="Interest"     value={`${loan.interestRate}% p.a.`} />
          <Meta label="Tenure"       value={`${loan.tenureMonths} months`} />
          <Meta label="Monthly"      value={`SGD ${loan.monthlyInstalment.toFixed(2)}`} />
          <Meta label="Total Repayable"  value={`SGD ${loan.totalRepayable.toLocaleString()}`} />
          <Meta label="Outstanding"      value={`SGD ${loan.outstandingBalance.toLocaleString()}`} />
          {loan.startDate       && <Meta label="First Deduction" value={new Date(loan.startDate).toLocaleDateString('en-SG')} />}
          {loan.expectedEndDate && <Meta label="Final Deduction" value={new Date(loan.expectedEndDate).toLocaleDateString('en-SG')} />}
          {loan.actualEndDate   && <Meta label="Settled" value={new Date(loan.actualEndDate).toLocaleDateString('en-SG')} />}
        </div>

        {loan.rejectionReason && (
          <div className="mt-4 p-3 bg-page border border-ink ">
            <p className="text-xs font-black text-ink uppercase tracking-widest mb-1">Rejected</p>
            <p className="text-sm text-ink">{loan.rejectionReason}</p>
          </div>
        )}

        {/* Action bar */}
        <div className="mt-5 flex flex-wrap gap-2 pt-4 border-t border-rule">
          {canApprove && (
            <>
              <button onClick={approve} className="px-4 py-2 text-xs font-bold text-accent border border-accent hover:bg-page">Approve</button>
              <button onClick={reject}  className="px-4 py-2 text-xs font-bold text-ink border border-ink hover:bg-page">Reject</button>
            </>
          )}
          {canActivate && (
            <button onClick={activate} className="px-4 py-2 text-xs font-bold text-accent border border-accent hover:bg-page">Activate Loan</button>
          )}
          {canCancel && (
            <button onClick={cancelLoan} className="px-4 py-2 text-xs font-bold text-muted border border-rule hover:bg-page">Cancel</button>
          )}
          {canSettle && (
            <button onClick={settleEarly} className="px-4 py-2 text-xs font-bold text-accent border-2 border-accent hover:bg-page">
              Settle Early (SGD {(loan.earlySettlement?.settlementAmount ?? loan.outstandingBalance).toLocaleString()})
            </button>
          )}
          {['APPROVED','ACTIVE','SETTLED'].includes(loan.status) && (
            <button onClick={loadAgreement} className="px-4 py-2 text-xs font-bold text-accent border border-accent hover:bg-page ml-auto">
              {agreement ? 'Agreement loaded ↓' : 'View Loan Agreement'}
            </button>
          )}
        </div>
      </div>

      {/* Repayment Schedule */}
      {loan.repayments?.length > 0 && (
        <div className="bg-paper border border-rule overflow-hidden">
          <div className="px-4 sm:px-6 py-3 bg-page border-b border-rule">
            <h3 className="text-xs font-black text-ink uppercase tracking-widest">Repayment Schedule ({loan.repayments.length})</h3>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-page border-b border-rule">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted uppercase tracking-widest">#</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted uppercase tracking-widest">Scheduled</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted uppercase tracking-widest">Amount</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted uppercase tracking-widest">Paid On</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black text-muted uppercase tracking-widest">Paid Amount</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-muted uppercase tracking-widest">Status</th>
                  <th className="px-4 py-2.5 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {loan.repayments.map((r: any) => (
                  <tr key={r.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-2.5 text-xs font-mono font-bold text-ink">#{r.paymentNumber}</td>
                    <td className="px-4 py-2.5 text-sm text-ink">{new Date(r.scheduledDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="px-4 py-2.5 text-sm font-bold text-right">SGD {r.scheduledAmount.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-sm text-ink">{r.paidDate ? new Date(r.paidDate).toLocaleDateString('en-SG') : '—'}</td>
                    <td className="px-4 py-2.5 text-sm font-bold text-right">{r.paidAmount ? `SGD ${r.paidAmount.toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest  ${REPAY_COLORS[r.status] || 'bg-page text-ink'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.status === 'PENDING' && isApprover && loan.status === 'ACTIVE' && (
                        <button onClick={() => recordRepayment(r.paymentNumber)} className="text-xs font-bold text-accent hover:text-accent">Mark Paid</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-rule">
            {loan.repayments.map((r: any) => (
              <div key={r.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-ink">#{r.paymentNumber}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest  ${REPAY_COLORS[r.status] || 'bg-page text-ink'}`}>
                      {r.status}
                    </span>
                  </div>
                  <p className="text-sm font-black text-ink">SGD {(r.paidAmount ?? r.scheduledAmount).toFixed(2)}</p>
                </div>
                <p className="text-xs text-muted">
                  Scheduled: <span className="font-bold text-ink">{new Date(r.scheduledDate).toLocaleDateString('en-SG')}</span>
                  {r.paidDate && <> · Paid: <span className="font-bold text-ink">{new Date(r.paidDate).toLocaleDateString('en-SG')}</span></>}
                </p>
                {r.status === 'PENDING' && isApprover && loan.status === 'ACTIVE' && (
                  <button onClick={() => recordRepayment(r.paymentNumber)} className="mt-2 text-xs font-bold text-accent hover:text-accent">Mark Paid →</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agreement Preview */}
      {agreement && (
        <div className="bg-paper border border-rule p-4 sm:p-6">
          <h3 className="text-xs font-black text-ink uppercase tracking-widest mb-3">Loan Agreement</h3>
          <div className="prose prose-slate max-w-none text-sm" dangerouslySetInnerHTML={{ __html: agreement }} />
          <div className="mt-4 flex gap-3">
            <button onClick={() => window.print()} className="px-4 py-2 text-xs font-bold text-ink border border-rule hover:bg-page">Print</button>
          </div>
        </div>
      )}
      {loadingAg && <p className="text-xs text-muted italic text-center">Loading agreement…</p>}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-black text-muted uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-ink mt-0.5">{value}</p>
    </div>
  );
}
