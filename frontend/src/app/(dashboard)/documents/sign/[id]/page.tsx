'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, Badge, Button, Modal, Field, Input, Textarea, EmptyState, Icon } from '@/components/ui';
import type { BadgeTone } from '@/components/ui';

interface SignRequest {
  id: string;
  status: 'PENDING' | 'SIGNED' | 'DECLINED' | 'EXPIRED';
  documentTitle: string;
  documentType: string;
  dueDate: string | null;
  signatoryName: string;
  signatoryEmail?: string;
  personalizedHtml: string;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  viewedAt: string | null;
  signedDocHash: string | null;
  senderMessage: string | null;
  document?: {
    title: string;
    type: string;
    version: string;
  };
}

/** Four request states, four appearances. */
const SIGN_STATUS_TONE: Record<SignRequest['status'], BadgeTone> = {
  PENDING:  'warn',
  SIGNED:   'ok',
  DECLINED: 'danger',
  EXPIRED:  'neutral',
};

const SIGN_STATUS_LABEL: Record<SignRequest['status'], string> = {
  PENDING: 'Awaiting signature', SIGNED: 'Signed', DECLINED: 'Declined', EXPIRED: 'Expired',
};

/**
 * The document body is HR-authored HTML. There is no typography plugin in
 * this build and preflight strips heading sizes and paragraph margins, so
 * without these rules a contract's headings render the same as its body text.
 * Scoped to the viewer; the serif face is deliberate — it reads as the
 * document, not as the app around it.
 */
const DOC_BODY = [
  'text-[15px] leading-7 text-ink',
  '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:mb-4',
  '[&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_h2]:mb-3',
  '[&_h3]:text-base [&_h3]:font-bold [&_h3]:mt-5 [&_h3]:mb-2',
  '[&_p]:mb-3 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_ul]:mb-3 [&_ol]:mb-3 [&_li]:mb-1',
  '[&_strong]:font-bold [&_a]:text-accent [&_a]:underline',
  '[&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-rule [&_td]:p-2 [&_th]:border [&_th]:border-rule [&_th]:p-2 [&_th]:bg-page',
].join(' ');

const LINK_BUTTON = 'inline-flex items-center justify-center gap-2 h-10 px-4 rounded-control border border-rule bg-paper text-sm font-semibold text-ink whitespace-nowrap hover:bg-pill';

const fmtDateTime = (iso: string, month: 'short' | 'long' = 'short') =>
  new Date(iso).toLocaleString('en-SG', { day: 'numeric', month, year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function SignDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [request, setRequest]       = useState<SignRequest | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  // Signing state
  const [signatoryName, setSignatoryName] = useState('');
  const [agreed, setAgreed]               = useState(false);
  const [hasScrolled, setHasScrolled]     = useState(false);
  const [signing, setSigning]             = useState(false);
  const [signError, setSignError]         = useState('');
  const [signSuccess, setSignSuccess]     = useState(false);

  // Decline state
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [declineReason, setDeclineReason]       = useState('');
  const [declining, setDeclining]               = useState(false);
  const [declineError, setDeclineError]         = useState('');
  const [declineSuccess, setDeclineSuccess]     = useState(false);

  const docViewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    apiFetchRaw(`/esign/requests/${id}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) { setError(data.error); return; }
        setRequest(data.request || data);
        if (data.request?.signatoryName || data.signatoryName) {
          setSignatoryName(data.request?.signatoryName || data.signatoryName);
        } else if (user?.name) {
          setSignatoryName(user.name);
        }
      })
      .catch(() => setError('Failed to load document'))
      .finally(() => setLoading(false));
  }, [id, user]);

  const handleDocScroll = () => {
    const el = docViewerRef.current;
    if (!el) return;
    const threshold = el.scrollHeight - el.clientHeight - 40;
    if (el.scrollTop >= threshold) setHasScrolled(true);
  };

  const handleSign = async () => {
    if (!signatoryName.trim()) { setSignError('Please enter your full name to sign.'); return; }
    if (!agreed) { setSignError('Please check the agreement checkbox.'); return; }
    setSigning(true);
    setSignError('');
    try {
      const res = await apiFetchRaw(`/esign/requests/${id}/sign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatoryName: signatoryName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setSignError(data.error || 'Signing failed.'); return; }
      setSignSuccess(true);
      setRequest(prev => prev ? { ...prev, status: 'SIGNED', signedAt: new Date().toISOString() } : prev);
    } catch {
      setSignError('Network error. Please try again.');
    } finally {
      setSigning(false);
    }
  };

  const handleDecline = async () => {
    if (!declineReason.trim()) { setDeclineError('Please provide a reason for declining.'); return; }
    setDeclining(true);
    setDeclineError('');
    try {
      const res = await apiFetchRaw(`/esign/requests/${id}/decline`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declineReason: declineReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setDeclineError(data.error || 'Decline failed.'); return; }
      setDeclineSuccess(true);
      setShowDeclineModal(false);
      setRequest(prev => prev ? { ...prev, status: 'DECLINED', declinedAt: new Date().toISOString(), declineReason: declineReason.trim() } : prev);
    } catch {
      setDeclineError('Network error. Please try again.');
    } finally {
      setDeclining(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-9 h-9 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading document" />
      </div>
    );
  }

  if (error) {
    return (
      <Card padding="p-0" className="max-w-2xl mx-auto mt-10">
        <EmptyState
          icon="alert"
          title="Document not found"
          description={error}
          action={<Link href="/documents" className={LINK_BUTTON}>Back to documents</Link>}
        />
      </Card>
    );
  }

  if (!request) return null;

  const isPending  = request.status === 'PENDING';
  const isSigned   = request.status === 'SIGNED';
  const isDeclined = request.status === 'DECLINED';
  const isExpired  = request.status === 'EXPIRED';

  const canSign = isPending;
  const isOverdue = isPending && request.dueDate && new Date(request.dueDate) < new Date();

  // Why the Sign button is off, in the order the person has to fix it.
  const signBlockedReason =
    !hasScrolled ? 'Read the document to the end first'
    : !signatoryName.trim() ? 'Type your full name'
    : !agreed ? 'Tick the agreement to continue'
    : undefined;

  return (
    <div className="flex flex-col gap-5 max-w-4xl mx-auto w-full pb-10">
      <Link href="/documents" className="self-start inline-flex items-center gap-1.5 h-8 -ml-1 px-1 rounded-control text-[13px] font-semibold text-muted hover:text-accent">
        <Icon name="chevronRight" size={16} className="rotate-180" /> My documents
      </Link>

      {/* Document identity */}
      <Card padding="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <span className="flex items-center justify-center w-12 h-12 rounded-control bg-tint text-accent shrink-0" aria-hidden="true">
              <Icon name="file" size={22} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <Badge tone={SIGN_STATUS_TONE[request.status] ?? 'warn'}>{SIGN_STATUS_LABEL[request.status] ?? request.status}</Badge>
                {isOverdue && <Badge tone="danger">Overdue</Badge>}
              </div>
              <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-[-0.02em] leading-[1.15] text-ink">{request.documentTitle}</h1>
              <p className="text-[13px] text-muted mt-1">
                {request.documentType?.replace(/_/g, ' ').toLowerCase().replace(/^\w/, ch => ch.toUpperCase())}
                {request.document?.version && <span className="tabular-nums"> · Version {request.document.version}</span>}
              </p>
            </div>
          </div>
          {request.dueDate && (
            <div className="sm:text-right shrink-0">
              <p className={`text-[12.5px] font-semibold ${isOverdue ? 'text-danger' : 'text-muted'}`}>{isOverdue ? 'Was due' : 'Due by'}</p>
              <p className="text-sm font-bold text-ink tabular-nums mt-0.5">
                {new Date(request.dueDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
          )}
        </div>

        {request.senderMessage && (
          <blockquote className="mt-4 px-4 py-3 rounded-control bg-page border border-rule text-sm text-ink">
            <p className="text-[12.5px] font-semibold text-muted mb-1">Message from HR</p>
            {request.senderMessage}
          </blockquote>
        )}

        {(isSigned || isDeclined) && (
          <dl className="mt-5 pt-5 border-t border-rule grid grid-cols-1 sm:grid-cols-3 gap-4">
            {request.viewedAt && (
              <div>
                <dt className="text-[12.5px] font-semibold text-muted">Viewed</dt>
                <dd className="text-sm font-semibold text-ink mt-0.5 tabular-nums">{fmtDateTime(request.viewedAt)}</dd>
              </div>
            )}
            {isSigned && request.signedAt && (
              <div>
                <dt className="text-[12.5px] font-semibold text-muted">Signed</dt>
                <dd className="text-sm font-semibold text-ink mt-0.5 tabular-nums">{fmtDateTime(request.signedAt)}</dd>
              </div>
            )}
            {isDeclined && request.declinedAt && (
              <div>
                <dt className="text-[12.5px] font-semibold text-muted">Declined</dt>
                <dd className="text-sm font-semibold text-ink mt-0.5 tabular-nums">{fmtDateTime(request.declinedAt)}</dd>
              </div>
            )}
            {isDeclined && request.declineReason && (
              <div className="sm:col-span-3">
                <dt className="text-[12.5px] font-semibold text-muted">Reason</dt>
                <dd className="text-sm text-ink mt-0.5">{request.declineReason}</dd>
              </div>
            )}
          </dl>
        )}
      </Card>

      {/* Document viewer */}
      <Card padding="p-0" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-rule">
          <span className="text-[15.5px] font-bold text-ink">Document</span>
          {canSign && !hasScrolled && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-warn">
              <Icon name="chevronDown" size={15} /> Scroll to the end to continue
            </span>
          )}
          {canSign && hasScrolled && (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ok">
              <Icon name="check" size={15} strokeWidth={2.5} /> Read to the end
            </span>
          )}
        </div>
        <div
          ref={docViewerRef}
          onScroll={handleDocScroll}
          tabIndex={0}
          aria-label="Document content"
          className={`h-[480px] overflow-y-auto px-5 py-6 sm:px-8 custom-scrollbar ${DOC_BODY}`}
          style={{ fontFamily: 'Georgia, serif' }}
          dangerouslySetInnerHTML={{ __html: request.personalizedHtml }}
        />
      </Card>

      {/* Signature block — only for PENDING */}
      {canSign && (
        <Card padding="p-0" className={`overflow-hidden ${hasScrolled ? 'border-accent' : ''}`}>
          <div className="px-5 pt-5">
            <CardHeader
              title="Sign this document"
              caption={!hasScrolled ? 'Read the document above to the end first. The fields unlock once you have.' : undefined}
            />
          </div>

          <div className="px-5 pb-5">
            {signSuccess ? (
              <div className="flex flex-col items-center text-center py-6">
                <span className="flex items-center justify-center w-12 h-12 rounded-full bg-ok-bg text-ok mb-3" aria-hidden="true">
                  <Icon name="check" size={24} strokeWidth={2.5} />
                </span>
                <h3 className="text-lg font-bold text-ink">Document signed</h3>
                <p className="text-sm text-muted mt-1 mb-5">
                  Your signature was recorded on {fmtDateTime(new Date().toISOString(), 'long')}.
                </p>
                <Link href="/documents" className={LINK_BUTTON}>Back to my documents</Link>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Full legal name" required help={<>Signing as <span className="font-semibold text-ink">{signatoryName || '—'}</span></>}>
                    <Input
                      type="text"
                      value={signatoryName}
                      onChange={e => setSignatoryName(e.target.value)}
                      disabled={!hasScrolled}
                      placeholder="Exactly as it appears on your ID"
                    />
                  </Field>
                  <Field label="Date">
                    <div className="flex items-center h-[42px] px-3 rounded-control bg-page border border-rule text-sm font-semibold text-ink">
                      {new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                  </Field>
                </div>

                <label className={`flex items-start gap-3 p-4 rounded-control border transition-colors ${
                  agreed ? 'border-accent bg-tint' : 'border-rule bg-page'
                } ${!hasScrolled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={e => setAgreed(e.target.checked)}
                    disabled={!hasScrolled}
                    className="mt-0.5 w-4 h-4 accent-accent shrink-0"
                  />
                  <span className="text-sm text-ink leading-relaxed">
                    I have read and understood the above document in its entirety. By signing, I confirm my agreement to its terms and acknowledge that this constitutes a legally binding e-signature under Singapore's Electronic Transactions Act.
                  </span>
                </label>

                {signError && (
                  <div role="alert" className="flex items-start gap-2.5 px-3.5 py-3 rounded-control bg-danger-bg text-[13px] text-danger">
                    <Icon name="alert" size={16} className="mt-px" />{signError}
                  </div>
                )}

                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-1">
                  <Button
                    variant="danger"
                    onClick={() => { setShowDeclineModal(true); setDeclineError(''); setDeclineReason(''); }}
                    disabled={!hasScrolled || signing}
                    reason={!hasScrolled ? 'Read the document first' : undefined}
                  >
                    Decline
                  </Button>
                  <Button
                    icon="check"
                    onClick={handleSign}
                    disabled={!hasScrolled || !signatoryName.trim() || !agreed || signing}
                    reason={!signing ? signBlockedReason : undefined}
                  >
                    {signing ? 'Signing…' : 'Sign document'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Read-only status for signed/declined/expired */}
      {!canSign && !signSuccess && !declineSuccess && (
        <Card>
          <div className="flex items-start gap-4">
            <span className={`flex items-center justify-center w-11 h-11 rounded-full shrink-0 ${
              isSigned ? 'bg-ok-bg text-ok' : isDeclined ? 'bg-danger-bg text-danger' : 'bg-pill text-muted'
            }`} aria-hidden="true">
              <Icon name={isSigned ? 'check' : isDeclined ? 'x' : 'clock'} size={20} strokeWidth={2.25} />
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15.5px] font-bold text-ink">
                {isSigned ? 'Document signed' : isDeclined ? 'Document declined' : 'Request expired'}
              </h3>
              <p className="text-sm text-ink mt-1">
                {isSigned && `Signed by ${request.signatoryName} on ${request.signedAt ? fmtDateTime(request.signedAt, 'long') : '—'}.`}
                {isDeclined && `Declined on ${request.declinedAt ? new Date(request.declinedAt).toLocaleString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}. ${request.declineReason ? `Reason: ${request.declineReason}` : ''}`}
                {isExpired && 'This signing request has expired. Contact HR if you still need to sign this document.'}
              </p>
              {isSigned && request.signedDocHash && (
                <p className="text-xs text-muted mt-2 font-mono">
                  Document hash {request.signedDocHash.substring(0, 16)}…
                </p>
              )}
              <div className="mt-4">
                <Link href="/documents" className={LINK_BUTTON}>Back to documents</Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      {declineSuccess && (
        <Card padding="p-0">
          <EmptyState
            icon="check"
            title="Your decline has been recorded"
            description="Your response has been submitted. HR will be notified."
            action={<Link href="/documents" className={LINK_BUTTON}>Back to documents</Link>}
          />
        </Card>
      )}

      {/* Decline modal */}
      <Modal
        open={showDeclineModal}
        onClose={() => setShowDeclineModal(false)}
        title="Decline this document"
        caption="HR will see your reason."
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDeclineModal(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={handleDecline}
              disabled={declining || !declineReason.trim()}
              reason={!declining && !declineReason.trim() ? 'Give a reason first' : undefined}
            >
              {declining ? 'Submitting…' : 'Confirm decline'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Reason for declining" required error={declineError || undefined}>
            <Textarea
              rows={4}
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              placeholder="Explain why you are declining this document…"
              invalid={!!declineError}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
