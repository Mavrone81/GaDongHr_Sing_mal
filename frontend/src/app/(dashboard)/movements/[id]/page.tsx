'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];

const TYPE_LABELS: Record<string, string> = {
  DEPARTMENT_TRANSFER:     'Department Transfer',
  LOCATION_TRANSFER:       'Location Transfer',
  INTER_COMPANY_TRANSFER:  'Inter-Company Transfer',
  ROLE_CHANGE:             'Role Change',
  PROMOTION:               'Promotion',
  REPORTING_CHANGE:        'Reporting Change',
  COST_CENTRE_REALLOC:     'Cost Centre Realloc',
};

/**
 * Weighted by what still needs someone's attention, since the palette has no
 * five-way hue vocabulary: rejection is filled ink and therefore loudest,
 * an applied movement is filled accent because it is now in force, approval is
 * an outline, pending carries the highlight, and a cancellation recedes.
 *
 * Straight token mapping had rendered PENDING, REJECTED and CANCELLED
 * identically — three states with very different consequences.
 */
const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-paper text-ink border border-highlight',
  APPROVED:  'bg-paper text-accent border border-accent',
  APPLIED:   'bg-accent text-paper border border-accent',
  REJECTED:  'bg-ink text-paper border border-ink',
  CANCELLED: 'bg-page text-muted border border-rule line-through',
};

export default function MovementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isHr = HR_ROLES.includes(role);

  const [m, setMovement] = useState<any>(null);
  const [letter, setLetter] = useState<string>('');
  const [loadingLetter, setLoadingLetter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await apiFetch(`/movements/${id}`);
      if (!res.ok) { const e = await res.json(); setError(e.error || 'Failed'); return; }
      setMovement(await res.json());
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function loadLetter() {
    setLoadingLetter(true);
    const res = await apiFetch(`/movements/${id}/letter`).then(r => r.json());
    setLetter(res.html || '');
    setLoadingLetter(false);
  }

  async function approve() {
    if (!confirm('Approve this movement?')) return;
    const res = await apiFetch(`/movements/${id}/approve`, { method: 'PUT' });
    if (res.ok) load();
    else alert((await res.json()).error || 'Failed');
  }

  async function reject() {
    const reason = window.prompt('Reason for rejection?');
    if (!reason || !reason.trim()) return;
    const res = await apiFetch(`/movements/${id}/reject`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason: reason.trim() }),
    });
    if (res.ok) load();
    else alert((await res.json()).error || 'Failed');
  }

  async function cancelMov() {
    if (!confirm('Cancel this movement?')) return;
    const res = await apiFetch(`/movements/${id}/cancel`, { method: 'PUT' });
    if (res.ok) load();
    else alert((await res.json()).error || 'Failed');
  }

  async function apply() {
    if (!confirm('Apply this movement to the employee record now?')) return;
    const res = await apiFetch(`/movements/${id}/apply`, { method: 'POST' });
    if (res.ok) load();
    else alert((await res.json()).error || 'Failed');
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><div className="w-10 h-10 border-4 border-accent border-accent animate-spin" /></div>;
  }
  if (error || !m) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <h2 className="text-lg font-black text-ink mb-2">Movement Not Found</h2>
        <p className="text-sm text-muted mb-6">{error}</p>
        <Link href="/movements" className="text-xs font-bold text-accent hover:text-accent">← Back to Movements</Link>
      </div>
    );
  }

  const now = new Date();
  const effectivePast = new Date(m.effectiveDate) <= now;
  const canApprove = isHr && m.status === 'PENDING';
  const canApply   = isHr && m.status === 'APPROVED' && effectivePast;
  const canCancel  = (m.initiatedBy === (user?.id || (user as any)?.sub) || isHr) && ['PENDING','APPROVED'].includes(m.status);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/movements" className="text-xs font-bold text-muted hover:text-accent">← Back to Movements</Link>
        <div className="flex items-center gap-2 flex-wrap">
          {m.additionalApproval?.required && m.status === 'PENDING' && (
            <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest bg-page text-ink">
              Needs HR_MANAGER
            </span>
          )}
          <span className={`px-2.5 py-1 text-[10px] font-black uppercase tracking-widest  ${STATUS_COLORS[m.status] || 'bg-page text-ink'}`}>
            {m.status}
          </span>
        </div>
      </div>

      {/* Top Card */}
      <div className="bg-paper border border-rule p-4 sm:p-6">
        <p className="text-xs font-mono font-black text-muted mb-1">{m.movementNumber}</p>
        <h1 className="text-xl font-black text-ink mb-1">
          {TYPE_LABELS[m.type] || m.type}
        </h1>
        <p className="text-sm text-muted mb-4">for <span className="font-bold text-ink">{m.employeeName}</span></p>

        <p className="text-sm text-ink mb-5 p-3 bg-page italic">"{m.reason}"</p>

        {/* Before / After grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ChangeCard label="Department"  from={m.fromDepartment}  to={m.toDepartment} />
          <ChangeCard label="Designation" from={m.fromDesignation} to={m.toDesignation} />
          {(m.fromCostCentre || m.toCostCentre) && <ChangeCard label="Cost Centre" from={m.fromCostCentre} to={m.toCostCentre} />}
          {(m.fromLocation   || m.toLocation)   && <ChangeCard label="Location"    from={m.fromLocation}   to={m.toLocation} />}
          {(m.fromCompany    || m.toCompany)    && <ChangeCard label="Company"     from={m.fromCompany}    to={m.toCompany} />}
          {(m.fromReportingManagerId || m.toReportingManagerId) && <ChangeCard label="Reporting Manager" from={m.fromReportingManagerId} to={m.toReportingManagerId} />}
          {(m.fromEmploymentType || m.toEmploymentType) && <ChangeCard label="Employment Type" from={m.fromEmploymentType} to={m.toEmploymentType} />}
        </div>

        {m.hasSalaryRevision && (
          <div className="mt-4 p-4 bg-page border border-accent">
            <p className="text-xs font-black text-accent uppercase tracking-widest mb-1">Salary Revision</p>
            <p className="text-sm text-accent">Reason: {m.salaryReasonCode || '—'} · {isHr ? '(salary visible to HR via approved record)' : 'New salary applied on effective date'}</p>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-rule grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <Meta label="Effective" value={new Date(m.effectiveDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })} />
          <Meta label="Initiated" value={`${new Date(m.createdAt).toLocaleDateString('en-SG')} by ${m.initiatedByName || '—'}`} />
          {m.approvedAt && <Meta label="Approved"  value={`${new Date(m.approvedAt).toLocaleDateString('en-SG')} by ${m.approvedByName || '—'}`} />}
          {m.rejectedAt && <Meta label="Rejected"  value={new Date(m.rejectedAt).toLocaleDateString('en-SG')} />}
          {m.appliedAt  && <Meta label="Applied"   value={new Date(m.appliedAt).toLocaleDateString('en-SG')} />}
          {m.cancelledAt && <Meta label="Cancelled" value={new Date(m.cancelledAt).toLocaleDateString('en-SG')} />}
        </div>

        {m.rejectionReason && (
          <div className="mt-4 p-3 bg-page border border-ink">
            <p className="text-xs font-black text-ink uppercase tracking-widest mb-1">Rejection Reason</p>
            <p className="text-sm text-ink">{m.rejectionReason}</p>
          </div>
        )}

        {/* Action bar */}
        <div className="mt-6 pt-4 border-t border-rule flex flex-wrap gap-2">
          {canApprove && (
            <>
              <button onClick={approve} className="px-4 py-2 text-xs font-bold text-accent border border-accent hover:bg-page">Approve</button>
              <button onClick={reject}  className="px-4 py-2 text-xs font-bold text-ink border border-ink hover:bg-page">Reject</button>
            </>
          )}
          {canApply && (
            <button onClick={apply} className="px-4 py-2 text-xs font-bold text-accent border border-accent hover:bg-page">Apply Now</button>
          )}
          {canCancel && (
            <button onClick={cancelMov} className="px-4 py-2 text-xs font-bold text-muted border border-rule hover:bg-page">Cancel Movement</button>
          )}
          {['APPROVED','APPLIED'].includes(m.status) && (
            <button onClick={() => { if (!letter) loadLetter(); }} className="px-4 py-2 text-xs font-bold text-accent border border-accent hover:bg-page ml-auto">
              {letter ? 'Letter loaded ↓' : 'View Transfer Letter'}
            </button>
          )}
        </div>
      </div>

      {/* Letter Preview */}
      {letter && (
        <div className="bg-paper border border-rule p-4 sm:p-6">
          <h3 className="text-xs font-black text-ink uppercase tracking-widest mb-3">Transfer Letter</h3>
          <div className="prose prose-slate max-w-none text-sm" dangerouslySetInnerHTML={{ __html: letter }} />
          <div className="mt-4 flex gap-3">
            <button onClick={() => window.print()} className="px-4 py-2 text-xs font-bold text-ink border border-rule hover:bg-page">Print</button>
          </div>
        </div>
      )}
      {loadingLetter && <p className="text-xs text-muted italic text-center">Loading letter…</p>}
    </div>
  );
}

function ChangeCard({ label, from, to }: { label: string; from: any; to: any }) {
  const changed = (from || '') !== (to || '');
  return (
    <div className={`p-3  border ${changed ? 'border-accent bg-page' : 'border-rule bg-page'}`}>
      <p className="text-[10px] font-black text-muted uppercase tracking-widest mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <p className="text-sm font-bold text-muted line-through">{from || '—'}</p>
        <span className="text-muted">→</span>
        <p className="text-sm font-black text-ink">{to || '—'}</p>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-black text-muted uppercase tracking-wider">{label}</p>
      <p className="text-xs font-bold text-ink mt-0.5">{value}</p>
    </div>
  );
}
