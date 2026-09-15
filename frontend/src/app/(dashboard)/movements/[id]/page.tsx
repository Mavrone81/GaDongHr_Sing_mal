'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Icon, Modal, Textarea } from '@/components/ui';
import { KeyValue, Notice, PageLoading, Spinner } from '@/components/employee/RecordParts';

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];

const TYPE_LABELS: Record<string, string> = {
  DEPARTMENT_TRANSFER:     'Department transfer',
  LOCATION_TRANSFER:       'Location transfer',
  INTER_COMPANY_TRANSFER:  'Inter-company transfer',
  ROLE_CHANGE:             'Role change',
  PROMOTION:               'Promotion',
  REPORTING_CHANGE:        'Reporting change',
  COST_CENTRE_REALLOC:     'Cost centre reallocation',
};

/**
 * Five states, five tones. Pending waits on someone (warn); approved is agreed
 * but not in force (accent); applied is in force (ok); rejected is the loud
 * one (danger); a cancellation recedes (neutral). The label is always printed.
 */
const STATUS_TONE: Record<string, 'warn' | 'accent' | 'ok' | 'danger' | 'neutral'> = {
  PENDING:   'warn',
  APPROVED:  'accent',
  APPLIED:   'ok',
  REJECTED:  'danger',
  CANCELLED: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', APPLIED: 'Applied', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });

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
      const res = await apiFetchRaw(`/movements/${id}`);
      if (!res.ok) { const e = await res.json(); setError(e.error || 'Failed'); return; }
      setMovement(await res.json());
    } catch { setError('Network error'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (id) load(); }, [id]);

  async function loadLetter() {
    setLoadingLetter(true);
    const res = await apiFetchRaw(`/movements/${id}/letter`).then(r => r.json());
    setLetter(res.html || '');
    setLoadingLetter(false);
  }

  // The four actions below send exactly the requests they always have. What
  // changed is the gate in front of them: a kit Modal (with a required reason
  // for rejection) instead of the browser's confirm() / prompt().
  type Action = 'approve' | 'reject' | 'cancel' | 'apply';
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');

  function ask(action: Action) {
    setActionError('');
    if (action === 'reject') setRejectReason('');
    setConfirming(action);
  }

  async function runAction(action: Action) {
    if (action === 'reject' && !rejectReason.trim()) return;
    setActing(true);
    setActionError('');
    try {
      let res: Response;
      if (action === 'approve') {
        res = await apiFetchRaw(`/movements/${id}/approve`, { method: 'PUT' });
      } else if (action === 'reject') {
        res = await apiFetchRaw(`/movements/${id}/reject`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rejectionReason: rejectReason.trim() }),
        });
      } else if (action === 'cancel') {
        res = await apiFetchRaw(`/movements/${id}/cancel`, { method: 'PUT' });
      } else {
        res = await apiFetchRaw(`/movements/${id}/apply`, { method: 'POST' });
      }
      if (res.ok) { setConfirming(null); load(); }
      else setActionError((await res.json()).error || 'Failed');
    } catch {
      setActionError('Network error — nothing was changed. Please try again.');
    } finally {
      setActing(false);
    }
  }

  if (loading) return <PageLoading label="Loading movement…" />;
  if (error || !m) {
    return (
      <Card padding="p-0" className="max-w-2xl mx-auto mt-10">
        <EmptyState
          icon="alert"
          title="Movement not found"
          description={error || 'It may have been removed, or you may not have access to it.'}
          action={<Link href="/movements" className="text-sm font-semibold text-accent hover:underline">Back to movements</Link>}
        />
      </Card>
    );
  }

  const now = new Date();
  const effectivePast = new Date(m.effectiveDate) <= now;
  const canApprove = isHr && m.status === 'PENDING';
  const canApply   = isHr && m.status === 'APPROVED' && effectivePast;
  const canCancel  = (m.initiatedBy === (user?.id || (user as any)?.sub) || isHr) && ['PENDING','APPROVED'].includes(m.status);
  // Shown disabled so HR can see why "Apply" is not available yet.
  const applyLater = isHr && m.status === 'APPROVED' && !effectivePast;
  const hasLetter  = ['APPROVED','APPLIED'].includes(m.status);

  const changes: { label: string; from: any; to: any }[] = [
    { label: 'Department',  from: m.fromDepartment,  to: m.toDepartment },
    { label: 'Designation', from: m.fromDesignation, to: m.toDesignation },
    ...((m.fromCostCentre || m.toCostCentre) ? [{ label: 'Cost centre', from: m.fromCostCentre, to: m.toCostCentre }] : []),
    ...((m.fromLocation   || m.toLocation)   ? [{ label: 'Location',    from: m.fromLocation,   to: m.toLocation }] : []),
    ...((m.fromCompany    || m.toCompany)    ? [{ label: 'Company',     from: m.fromCompany,    to: m.toCompany }] : []),
    ...((m.fromReportingManagerId || m.toReportingManagerId) ? [{ label: 'Reporting manager', from: m.fromReportingManagerId, to: m.toReportingManagerId }] : []),
    ...((m.fromEmploymentType || m.toEmploymentType) ? [{ label: 'Employment type', from: m.fromEmploymentType, to: m.toEmploymentType }] : []),
  ];

  return (
    <div className="flex flex-col gap-5 pb-24 sm:pb-10">
      <Link href="/movements" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-accent w-fit focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-control">
        <Icon name="chevronRight" size={14} className="rotate-180" /> Movements
      </Link>

      {/* Identity band */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <div className="hidden sm:flex w-14 h-14 shrink-0 items-center justify-center rounded-full bg-tint text-accent">
            <Icon name="arrowRight" size={24} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">{m.employeeName}</h1>
              <Badge tone={STATUS_TONE[m.status] ?? 'neutral'}>{STATUS_LABEL[m.status] ?? m.status}</Badge>
              {m.additionalApproval?.required && m.status === 'PENDING' && (
                <Badge tone="neutral">Needs HR manager approval</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
              {TYPE_LABELS[m.type] || m.type} · <span className="tabular-nums">{m.movementNumber}</span> · effective <span className="tabular-nums">{fmtDate(m.effectiveDate)}</span>
            </p>
          </div>
        </div>

        {/* Actions — a sticky bar on phones */}
        {(canApprove || canApply || applyLater || canCancel || hasLetter) && (
          <div className="fixed inset-x-0 bottom-16 z-20 flex flex-wrap items-center justify-end gap-2 border-t border-rule bg-paper px-4 py-3 sm:static sm:border-0 sm:bg-transparent sm:p-0">
            {canCancel && <Button variant="danger" onClick={() => ask('cancel')}>Cancel movement</Button>}
            {hasLetter && (
              <Button variant="secondary" icon="file" onClick={() => { if (!letter) loadLetter(); }} disabled={!!letter || loadingLetter}>
                {letter ? 'Letter shown below' : loadingLetter ? 'Loading letter…' : 'View transfer letter'}
              </Button>
            )}
            {canApprove && (
              <>
                <Button variant="secondary" onClick={() => ask('reject')}>Reject</Button>
                <Button icon="check" onClick={() => ask('approve')}>Approve</Button>
              </>
            )}
            {canApply && <Button icon="check" onClick={() => ask('apply')}>Apply now</Button>}
            {applyLater && <Button disabled reason={`Can be applied from ${fmtDate(m.effectiveDate)}`}>Apply now</Button>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Main */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <CardHeader title="What changes" caption="Changed fields are marked; the rest carry over as they are." />
            <div className="flex flex-col">
              {changes.map(c => <ChangeRow key={c.label} {...c} />)}
            </div>
          </Card>

          <Card>
            <CardHeader title="Reason" />
            <p className="text-sm text-ink whitespace-pre-wrap">{m.reason || '—'}</p>
          </Card>

          {m.hasSalaryRevision && (
            <Card>
              <CardHeader title="Salary revision" caption="Included with this movement" />
              <KeyValue label="Reason code" value={m.salaryReasonCode || '—'} />
              <KeyValue label="When it applies" value={isHr ? 'Salary is visible to HR on the approved record' : 'New salary applies on the effective date'} />
            </Card>
          )}

          {letter && (
            <Card>
              <CardHeader
                title="Transfer letter"
                action={<Button variant="secondary" size="sm" icon="download" onClick={() => window.print()}>Print</Button>}
              />
              <div className="prose max-w-none text-sm text-ink" dangerouslySetInnerHTML={{ __html: letter }} />
            </Card>
          )}
        </div>

        {/* Side */}
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Timeline" />
            <KeyValue label="Effective" value={<span className="tabular-nums">{fmtDate(m.effectiveDate)}</span>} />
            <KeyValue label="Initiated" value={<span className="tabular-nums">{new Date(m.createdAt).toLocaleDateString('en-SG')} by {m.initiatedByName || '—'}</span>} />
            {m.approvedAt && <KeyValue label="Approved" value={<span className="tabular-nums">{new Date(m.approvedAt).toLocaleDateString('en-SG')} by {m.approvedByName || '—'}</span>} />}
            {m.rejectedAt && <KeyValue label="Rejected" tone="danger" value={<span className="tabular-nums">{new Date(m.rejectedAt).toLocaleDateString('en-SG')}</span>} />}
            {m.appliedAt  && <KeyValue label="Applied" tone="ok" value={<span className="tabular-nums">{new Date(m.appliedAt).toLocaleDateString('en-SG')}</span>} />}
            {m.cancelledAt && <KeyValue label="Cancelled" value={<span className="tabular-nums">{new Date(m.cancelledAt).toLocaleDateString('en-SG')}</span>} />}
          </Card>

          {m.rejectionReason && (
            <Notice tone="danger" title="Rejection reason">{m.rejectionReason}</Notice>
          )}
        </div>
      </div>
      <Modal
        open={confirming !== null}
        onClose={() => { if (!acting) setConfirming(null); }}
        title={
          confirming === 'approve' ? 'Approve this movement?'
          : confirming === 'reject' ? 'Reject this movement?'
          : confirming === 'cancel' ? 'Cancel this movement?'
          : 'Apply this movement now?'
        }
        caption={`${TYPE_LABELS[m.type] || m.type} for ${m.employeeName}, effective ${fmtDate(m.effectiveDate)}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)} disabled={acting}>
              {confirming === 'cancel' ? 'Keep it' : 'Go back'}
            </Button>
            <Button
              variant={confirming === 'reject' || confirming === 'cancel' ? 'danger' : 'primary'}
              icon={!acting && (confirming === 'approve' || confirming === 'apply') ? 'check' : undefined}
              onClick={() => { if (confirming) runAction(confirming); }}
              disabled={acting || (confirming === 'reject' && !rejectReason.trim())}
              reason={confirming === 'reject' && !rejectReason.trim() && !acting ? 'Give a reason to reject' : undefined}
            >
              {acting && <Spinner />}
              {confirming === 'approve' ? 'Approve'
                : confirming === 'reject' ? 'Reject movement'
                : confirming === 'cancel' ? 'Cancel movement'
                : 'Apply now'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {confirming === 'approve' && (
            <p>Once approved it takes effect on {fmtDate(m.effectiveDate)}, and HR then applies it to the employee record.</p>
          )}
          {confirming === 'apply' && (
            <p>The employee record is updated with the new details straight away.</p>
          )}
          {confirming === 'cancel' && (
            <p>The movement will not take effect. This cannot be undone — a new movement would have to be raised.</p>
          )}
          {confirming === 'reject' && (
            <Field label="Reason for rejection" required help="The person who raised it will see this.">
              <Textarea
                rows={3}
                autoFocus
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
            </Field>
          )}
          {actionError && <Notice tone="danger" title="Not done">{actionError}</Notice>}
        </div>
      </Modal>
    </div>
  );
}

function ChangeRow({ label, from, to }: { label: string; from: any; to: any }) {
  const changed = (from || '') !== (to || '');
  return (
    <div className="grid grid-cols-1 gap-1 py-3 border-t border-rule first:border-t-0 sm:grid-cols-[160px_1fr] sm:gap-4 sm:items-center">
      <div className="flex items-center gap-2 text-[13.5px] text-muted">
        {label}
        {changed && <Badge tone="accent">Changed</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {changed ? (
          <>
            <span className="text-muted line-through">{from || '—'}</span>
            <Icon name="arrowRight" size={14} className="text-faint" />
            <span className="font-semibold text-ink">{to || '—'}</span>
          </>
        ) : (
          <span className="text-ink">{to || '—'} <span className="text-faint">· no change</span></span>
        )}
      </div>
    </div>
  );
}
