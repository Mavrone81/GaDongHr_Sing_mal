'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];
const FINANCE_ROLES = ['FINANCE_ADMIN', 'SUPER_ADMIN'];
const APPROVER_ROLES = [...HR_ROLES, ...FINANCE_ROLES];

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-100 text-amber-700',
  APPROVED:  'bg-blue-100 text-blue-700',
  REJECTED:  'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-600',
  ACTIVE:    'bg-emerald-100 text-emerald-700',
  SETTLED:   'bg-emerald-100 text-emerald-700',
  WRITTEN_OFF: 'bg-rose-100 text-rose-700',
};

const REPAY_COLORS: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  PAID:    'bg-emerald-100 text-emerald-700',
  OVERDUE: 'bg-red-100 text-red-700',
  WAIVED:  'bg-amber-100 text-amber-700',
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
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>;
  }
  if (error || !loan) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <h2 className="text-lg font-black text-slate-800 mb-2">Loan Not Found</h2>
        <p className="text-sm text-slate-500 mb-6">{error}</p>
        <Link href="/loans" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">← Back to Loans</Link>
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
        <Link href="/loans" className="text-xs font-bold text-slate-500 hover:text-indigo-600">← Back to Loans</Link>
        <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${STATUS_COLORS[loan.status] || 'bg-slate-100 text-slate-600'}`}>
          {loan.status}
        </span>
      </div>

      {/* Top card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
        <p className="text-xs font-mono font-black text-slate-400 mb-1">{loan.loanNumber}</p>
        <h1 className="text-xl font-black text-slate-900">Staff Loan for {loan.employeeName}</h1>
        <p className="text-sm text-slate-600 mt-2 italic">"{loan.reason}"</p>

        {/* Progress bar */}
        {['ACTIVE','SETTLED','APPROVED'].includes(loan.status) && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 mb-2">
              <span className="uppercase tracking-widest">Repayment Progress</span>
              <span>SGD {loan.totalRepaid.toLocaleString()} / SGD {loan.totalRepayable.toLocaleString()} ({progressPct}%)</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
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
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-xs font-black text-red-700 uppercase tracking-widest mb-1">Rejected</p>
            <p className="text-sm text-red-700">{loan.rejectionReason}</p>
          </div>
        )}

        {/* Action bar */}
        <div className="mt-5 flex flex-wrap gap-2 pt-4 border-t border-slate-100">
          {canApprove && (
            <>
              <button onClick={approve} className="px-4 py-2 text-xs font-bold text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50">Approve</button>
              <button onClick={reject}  className="px-4 py-2 text-xs font-bold text-red-500 border border-red-200 rounded-lg hover:bg-red-50">Reject</button>
            </>
          )}
          {canActivate && (
            <button onClick={activate} className="px-4 py-2 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50">Activate Loan</button>
          )}
          {canCancel && (
            <button onClick={cancelLoan} className="px-4 py-2 text-xs font-bold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">Cancel</button>
          )}
          {canSettle && (
            <button onClick={settleEarly} className="px-4 py-2 text-xs font-bold text-emerald-600 border-2 border-emerald-200 rounded-lg hover:bg-emerald-50">
              Settle Early (SGD {(loan.earlySettlement?.settlementAmount ?? loan.outstandingBalance).toLocaleString()})
            </button>
          )}
          {['APPROVED','ACTIVE','SETTLED'].includes(loan.status) && (
            <button onClick={loadAgreement} className="px-4 py-2 text-xs font-bold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 ml-auto">
              {agreement ? 'Agreement loaded ↓' : 'View Loan Agreement'}
            </button>
          )}
        </div>
      </div>

      {/* Repayment Schedule */}
      {loan.repayments?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 sm:px-6 py-3 bg-slate-50 border-b border-slate-200">
            <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">Repayment Schedule ({loan.repayments.length})</h3>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50/50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">#</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Scheduled</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Amount</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Paid On</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-black text-slate-500 uppercase tracking-widest">Paid Amount</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                  <th className="px-4 py-2.5 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {loan.repayments.map((r: any) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5 text-xs font-mono font-bold text-slate-700">#{r.paymentNumber}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{new Date(r.scheduledDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="px-4 py-2.5 text-sm font-bold text-right">SGD {r.scheduledAmount.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-600">{r.paidDate ? new Date(r.paidDate).toLocaleDateString('en-SG') : '—'}</td>
                    <td className="px-4 py-2.5 text-sm font-bold text-right">{r.paidAmount ? `SGD ${r.paidAmount.toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${REPAY_COLORS[r.status] || 'bg-slate-100 text-slate-600'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.status === 'PENDING' && isApprover && loan.status === 'ACTIVE' && (
                        <button onClick={() => recordRepayment(r.paymentNumber)} className="text-xs font-bold text-indigo-600 hover:text-indigo-700">Mark Paid</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {loan.repayments.map((r: any) => (
              <div key={r.id} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-slate-700">#{r.paymentNumber}</span>
                    <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${REPAY_COLORS[r.status] || 'bg-slate-100 text-slate-600'}`}>
                      {r.status}
                    </span>
                  </div>
                  <p className="text-sm font-black text-slate-900">SGD {(r.paidAmount ?? r.scheduledAmount).toFixed(2)}</p>
                </div>
                <p className="text-xs text-slate-500">
                  Scheduled: <span className="font-bold text-slate-700">{new Date(r.scheduledDate).toLocaleDateString('en-SG')}</span>
                  {r.paidDate && <> · Paid: <span className="font-bold text-slate-700">{new Date(r.paidDate).toLocaleDateString('en-SG')}</span></>}
                </p>
                {r.status === 'PENDING' && isApprover && loan.status === 'ACTIVE' && (
                  <button onClick={() => recordRepayment(r.paymentNumber)} className="mt-2 text-xs font-bold text-indigo-600 hover:text-indigo-700">Mark Paid →</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agreement Preview */}
      {agreement && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
          <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest mb-3">Loan Agreement</h3>
          <div className="prose prose-slate max-w-none text-sm" dangerouslySetInnerHTML={{ __html: agreement }} />
          <div className="mt-4 flex gap-3">
            <button onClick={() => window.print()} className="px-4 py-2 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">Print</button>
          </div>
        </div>
      )}
      {loadingAg && <p className="text-xs text-slate-500 italic text-center">Loading agreement…</p>}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold text-slate-700 mt-0.5">{value}</p>
    </div>
  );
}
