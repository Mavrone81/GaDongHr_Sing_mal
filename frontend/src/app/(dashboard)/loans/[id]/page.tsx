'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TONES } from '@/lib/statusTone';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, DataTable, Button, EmptyState, Icon } from '@/components/ui';

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];
const FINANCE_ROLES = ['FINANCE_ADMIN', 'SUPER_ADMIN'];
const APPROVER_ROLES = [...HR_ROLES, ...FINANCE_ROLES];

const STATUS_TONE: Record<string, string> = {
  PENDING:     TONES.pending,
  APPROVED:    TONES.approved,
  ACTIVE:      TONES.active,
  DEDUCTED:    TONES.active,
  SETTLED:     TONES.done,
  REJECTED:    TONES.critical,
  WRITTEN_OFF: TONES.critical,
  CANCELLED:   TONES.inert,
};
const REPAY_TONE: Record<string, string> = {
  PENDING: TONES.pending,
  PAID:    TONES.done,
  OVERDUE: TONES.critical,
  WAIVED:  TONES.inert,
};

const sgd = (n: number) => `SGD ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
function Chip({ status, tones }: { status: string; tones: Record<string, string> }) {
  return (
    <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs whitespace-nowrap ${tones[status] || 'bg-pill text-muted'}`}>
      {label(status)}
    </span>
  );
}
function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[12.5px] font-semibold text-muted">{label}</p>
      <p className="text-sm font-semibold text-ink mt-0.5 tabular-nums">{value}</p>
    </div>
  );
}

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
      const res = await apiFetchRaw(`/loans/staff-loans/${id}`);
      if (!res.ok) { const e = await res.json(); setError(e.error || 'Failed'); return; }
      setLoan(await res.json());
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function approve() {
    const start = window.prompt('First deduction date (YYYY-MM-DD), blank = 1st of next month:') || '';
    if (!confirm('Approve this loan? This will generate the repayment schedule.')) return;
    const res = await apiFetchRaw(`/loans/staff-loans/${id}/approve`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(start ? { startDate: start } : {}),
    });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function reject() {
    const reason = window.prompt('Rejection reason?');
    if (!reason || !reason.trim()) return;
    const res = await apiFetchRaw(`/loans/staff-loans/${id}/reject`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason: reason.trim() }),
    });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function activate() {
    if (!confirm('Activate this loan? Schedule will start.')) return;
    const res = await apiFetchRaw(`/loans/staff-loans/${id}/activate`, { method: 'PUT' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function cancelLoan() {
    if (!confirm('Cancel this loan?')) return;
    const res = await apiFetchRaw(`/loans/staff-loans/${id}/cancel`, { method: 'PUT' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function recordRepayment(paymentNumber: number) {
    if (!confirm(`Mark payment #${paymentNumber} as paid?`)) return;
    const res = await apiFetchRaw(`/loans/staff-loans/${id}/repayments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentNumber }),
    });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function settleEarly() {
    if (!loan) return;
    const amt = loan.earlySettlement?.settlementAmount || loan.outstandingBalance;
    if (!confirm(`Settle loan early for SGD ${amt}? All remaining scheduled payments will be waived.`)) return;
    const res = await apiFetchRaw(`/loans/staff-loans/${id}/settle`, { method: 'POST' });
    if (res.ok) load(); else alert((await res.json()).error || 'Failed');
  }

  async function loadAgreement() {
    setLoadingAg(true);
    const res = await apiFetchRaw(`/loans/staff-loans/${id}/agreement`).then(r => r.json());
    setAgreement(res.html || '');
    setLoadingAg(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 rounded-full border-2 border-rule border-t-accent animate-spin" />
      </div>
    );
  }
  if (error || !loan) {
    return (
      <div className="max-w-2xl mx-auto mt-16">
        <EmptyState
          icon="wallet"
          title="Loan not found"
          description={error || 'This loan could not be loaded.'}
          action={<Link href="/loans"><Button variant="secondary">Back to loans</Button></Link>}
        />
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
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <Link href="/loans" className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink w-fit">
        <Icon name="chevronRight" size={14} className="rotate-180" /> Back to loans
      </Link>

      {/* Identity + summary */}
      <Card padding="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-muted tabular-nums">{loan.loanNumber}</p>
            <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-ink leading-tight mt-0.5">Staff loan · {loan.employeeName}</h1>
            <p className="text-sm text-ink mt-2">{loan.reason}</p>
          </div>
          <Chip status={loan.status} tones={STATUS_TONE} />
        </div>

        {['ACTIVE','SETTLED','APPROVED'].includes(loan.status) && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-[13px] text-muted mb-2">
              <span className="font-semibold">Repayment progress</span>
              <span className="tabular-nums">{sgd(loan.totalRepaid)} / {sgd(loan.totalRepayable)} · {progressPct}%</span>
            </div>
            <div className="h-2 bg-pill rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
          <Meta label="Principal"       value={sgd(loan.principal)} />
          <Meta label="Interest"        value={`${loan.interestRate}% p.a.`} />
          <Meta label="Tenure"          value={`${loan.tenureMonths} months`} />
          <Meta label="Monthly"         value={sgd(loan.monthlyInstalment)} />
          <Meta label="Total repayable" value={sgd(loan.totalRepayable)} />
          <Meta label="Outstanding"     value={sgd(loan.outstandingBalance)} />
          {loan.startDate       && <Meta label="First deduction" value={new Date(loan.startDate).toLocaleDateString('en-SG')} />}
          {loan.expectedEndDate && <Meta label="Final deduction" value={new Date(loan.expectedEndDate).toLocaleDateString('en-SG')} />}
          {loan.actualEndDate   && <Meta label="Settled" value={new Date(loan.actualEndDate).toLocaleDateString('en-SG')} />}
        </div>

        {loan.rejectionReason && (
          <div className="mt-4 rounded-control bg-page border border-rule px-3 py-2">
            <p className="text-[12.5px] font-semibold text-muted">Rejected</p>
            <p className="text-sm text-ink mt-0.5">{loan.rejectionReason}</p>
          </div>
        )}

        {(canApprove || canActivate || canCancel || canSettle || ['APPROVED','ACTIVE','SETTLED'].includes(loan.status)) && (
          <div className="mt-5 flex flex-wrap gap-2 pt-4 border-t border-rule">
            {canApprove && (
              <>
                <Button variant="primary" onClick={approve}>Approve</Button>
                <Button variant="danger" onClick={reject}>Reject</Button>
              </>
            )}
            {canActivate && <Button variant="primary" onClick={activate}>Activate loan</Button>}
            {canCancel && <Button variant="ghost" onClick={cancelLoan}>Cancel</Button>}
            {canSettle && (
              <Button variant="secondary" onClick={settleEarly}>
                Settle early · {sgd(loan.earlySettlement?.settlementAmount ?? loan.outstandingBalance)}
              </Button>
            )}
            {['APPROVED','ACTIVE','SETTLED'].includes(loan.status) && (
              <Button variant="secondary" icon="file" onClick={loadAgreement} className="ml-auto">
                {agreement ? 'Agreement loaded' : 'View loan agreement'}
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* Repayment schedule */}
      {loan.repayments?.length > 0 && (
        <div className="flex flex-col gap-3">
          <CardHeader title="Repayment schedule" caption={`${loan.repayments.length} instalment${loan.repayments.length === 1 ? '' : 's'}`} />
          <DataTable<any>
            aria-label="Repayment schedule"
            columns={[
              { key: 'no', label: '#', width: '64px', render: (r) => <span className="tabular-nums">#{r.paymentNumber}</span> },
              { key: 'scheduled', label: 'Scheduled', render: (r) => new Date(r.scheduledDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) },
              { key: 'amount', label: 'Amount', numeric: true, align: 'right', render: (r) => sgd(r.scheduledAmount) },
              { key: 'paidOn', label: 'Paid on', render: (r) => r.paidDate ? new Date(r.paidDate).toLocaleDateString('en-SG') : '—' },
              { key: 'paidAmt', label: 'Paid amount', numeric: true, align: 'right', render: (r) => r.paidAmount ? sgd(r.paidAmount) : '—' },
              { key: 'status', label: 'Status', width: '120px', render: (r) => <Chip status={r.status} tones={REPAY_TONE} /> },
              { key: 'action', label: '', width: '120px', align: 'right', render: (r) => (
                r.status === 'PENDING' && isApprover && loan.status === 'ACTIVE'
                  ? <Button variant="ghost" size="sm" onClick={() => recordRepayment(r.paymentNumber)}>Mark paid</Button>
                  : null
              ) },
            ]}
            rows={loan.repayments}
            rowKey={(r) => r.id}
            mobileCard={(r) => (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink tabular-nums">#{r.paymentNumber}</span>
                    <Chip status={r.status} tones={REPAY_TONE} />
                  </div>
                  <span className="text-sm font-bold text-ink tabular-nums">{sgd(r.paidAmount ?? r.scheduledAmount)}</span>
                </div>
                <p className="text-[13px] text-muted">
                  Scheduled <span className="font-semibold text-ink tabular-nums">{new Date(r.scheduledDate).toLocaleDateString('en-SG')}</span>
                  {r.paidDate && <> · paid <span className="font-semibold text-ink tabular-nums">{new Date(r.paidDate).toLocaleDateString('en-SG')}</span></>}
                </p>
                {r.status === 'PENDING' && isApprover && loan.status === 'ACTIVE' && (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => recordRepayment(r.paymentNumber)}>Mark paid</Button>
                )}
              </div>
            )}
          />
        </div>
      )}

      {/* Agreement */}
      {agreement && (
        <Card padding="p-5 sm:p-6">
          <CardHeader title="Loan agreement" action={<button type="button" onClick={() => window.print()} className="text-[13px] font-semibold text-accent">Print</button>} />
          <div className="prose max-w-none text-sm" dangerouslySetInnerHTML={{ __html: agreement }} />
        </Card>
      )}
      {loadingAg && <p className="text-[13px] text-muted text-center">Loading agreement…</p>}
    </div>
  );
}
