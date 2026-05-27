'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

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
    apiFetch(`/esign/requests/${id}`)
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
      const res = await apiFetch(`/esign/requests/${id}/sign`, {
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
      const res = await apiFetch(`/esign/requests/${id}/decline`, {
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
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading document…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">◈</span>
        </div>
        <h2 className="text-lg font-black text-slate-800 mb-2">Document Not Found</h2>
        <p className="text-sm text-slate-500 mb-6">{error}</p>
        <Link href="/documents" className="inline-flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 border border-indigo-200 rounded-xl px-4 py-2 hover:bg-indigo-50 transition-all">
          ← Back to Documents
        </Link>
      </div>
    );
  }

  if (!request) return null;

  const isPending  = request.status === 'PENDING';
  const isSigned   = request.status === 'SIGNED';
  const isDeclined = request.status === 'DECLINED';
  const isExpired  = request.status === 'EXPIRED';

  const canSign = isPending;
  const isOverdue = isPending && request.dueDate && new Date(request.dueDate) < new Date();

  const statusConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
    PENDING:  { label: 'Awaiting Signature', color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200',  icon: '◌' },
    SIGNED:   { label: 'Signed',             color: 'text-emerald-700',bg: 'bg-emerald-50 border-emerald-200', icon: '◉' },
    DECLINED: { label: 'Declined',           color: 'text-red-700',    bg: 'bg-red-50 border-red-200',       icon: '◎' },
    EXPIRED:  { label: 'Expired',            color: 'text-slate-600',  bg: 'bg-slate-100 border-slate-200',  icon: '◯' },
  };
  const statusInfo = statusConfig[request.status] || statusConfig.PENDING;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link
          href="/documents"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors"
        >
          ← My Documents
        </Link>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-widest rounded-full border ${statusInfo.bg} ${statusInfo.color}`}>
          <span>{statusInfo.icon}</span> {statusInfo.label}
        </span>
      </div>

      {/* Document meta card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
              <span className="text-xl text-indigo-600">◈</span>
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900">{request.documentTitle}</h1>
              <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-wider font-bold">
                {request.documentType?.replace(/_/g, ' ')}
                {request.document?.version && <span className="ml-2 text-slate-400">v{request.document.version}</span>}
              </p>
              {request.senderMessage && (
                <p className="text-sm text-slate-600 mt-3 p-3 bg-slate-50 rounded-xl border border-slate-100 italic">
                  "{request.senderMessage}"
                </p>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            {request.dueDate && (
              <div className={`text-xs font-bold ${isOverdue ? 'text-red-600' : 'text-slate-500'}`}>
                {isOverdue ? '⚠ Overdue' : 'Due by'}
                <p className={`text-sm font-black mt-0.5 ${isOverdue ? 'text-red-700' : 'text-slate-700'}`}>
                  {new Date(request.dueDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Timeline for completed requests */}
        {(isSigned || isDeclined) && (
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-6 text-xs">
            {request.viewedAt && (
              <div>
                <span className="text-slate-400 font-bold uppercase tracking-wider">Viewed</span>
                <p className="text-slate-700 font-bold mt-0.5">
                  {new Date(request.viewedAt).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            )}
            {isSigned && request.signedAt && (
              <div>
                <span className="text-emerald-600 font-bold uppercase tracking-wider">Signed</span>
                <p className="text-slate-700 font-bold mt-0.5">
                  {new Date(request.signedAt).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            )}
            {isDeclined && request.declinedAt && (
              <div>
                <span className="text-red-600 font-bold uppercase tracking-wider">Declined</span>
                <p className="text-slate-700 font-bold mt-0.5">
                  {new Date(request.declinedAt).toLocaleString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            )}
            {isDeclined && request.declineReason && (
              <div className="w-full">
                <span className="text-red-500 font-bold uppercase tracking-wider">Reason</span>
                <p className="text-slate-600 mt-0.5">{request.declineReason}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Document Viewer */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 bg-slate-50 border-b border-slate-200">
          <span className="text-xs font-black text-slate-600 uppercase tracking-widest">Document Content</span>
          {canSign && !hasScrolled && (
            <span className="text-xs font-bold text-amber-600 animate-pulse">↓ Scroll to read the full document</span>
          )}
          {canSign && hasScrolled && (
            <span className="text-xs font-bold text-emerald-600">✓ Document read</span>
          )}
        </div>
        <div
          ref={docViewerRef}
          onScroll={handleDocScroll}
          className="h-[480px] overflow-y-auto p-8 prose prose-slate max-w-none custom-scrollbar"
          style={{ fontFamily: 'Georgia, serif' }}
          dangerouslySetInnerHTML={{ __html: request.personalizedHtml }}
        />
      </div>

      {/* Signature Block — only for PENDING */}
      {canSign && (
        <div className={`bg-white rounded-2xl border-2 shadow-sm overflow-hidden transition-all ${hasScrolled ? 'border-indigo-200' : 'border-slate-200 opacity-70'}`}>
          <div className="px-6 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center gap-2">
            <span className="text-indigo-600">◈</span>
            <span className="text-xs font-black text-indigo-700 uppercase tracking-widest">Signature Block</span>
            {!hasScrolled && <span className="ml-auto text-xs text-slate-400 font-bold">Please read the document above first</span>}
          </div>

          <div className="p-6 space-y-5">
            {signSuccess ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">◉</span>
                </div>
                <h3 className="text-lg font-black text-emerald-700 mb-1">Document Signed</h3>
                <p className="text-sm text-slate-500 mb-6">
                  Your signature has been recorded on {new Date().toLocaleString('en-SG', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.
                </p>
                <Link
                  href="/documents"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-emerald-700 transition-all"
                >
                  ← Back to My Documents
                </Link>
              </div>
            ) : (
              <>
                {/* Full name input */}
                <div>
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                    Full Legal Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={signatoryName}
                    onChange={e => setSignatoryName(e.target.value)}
                    disabled={!hasScrolled}
                    placeholder="Type your full name exactly as it appears in your ID"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50 disabled:cursor-not-allowed transition-all"
                  />
                  <p className="text-xs text-slate-400 mt-1 font-medium">
                    Signing as: <span className="font-bold text-slate-600">{signatoryName || '—'}</span>
                  </p>
                </div>

                {/* Date display */}
                <div>
                  <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">Date</label>
                  <div className="px-4 py-3 bg-slate-50 rounded-xl border border-slate-200 text-sm font-bold text-slate-700">
                    {new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </div>
                </div>

                {/* Agreement checkbox */}
                <label className={`flex items-start gap-3 cursor-pointer p-4 rounded-xl border-2 transition-all ${
                  agreed ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                } ${!hasScrolled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={e => setAgreed(e.target.checked)}
                    disabled={!hasScrolled}
                    className="mt-0.5 w-4 h-4 rounded accent-indigo-600 shrink-0"
                  />
                  <span className="text-sm text-slate-700 font-medium leading-relaxed">
                    I have read and understood the above document in its entirety. By signing, I confirm my agreement to its terms and acknowledge that this constitutes a legally binding e-signature under Singapore's Electronic Transactions Act.
                  </span>
                </label>

                {signError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">
                    <span>◎</span> {signError}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={handleSign}
                    disabled={!hasScrolled || !signatoryName.trim() || !agreed || signing}
                    className="flex-1 py-3 px-6 bg-indigo-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all shadow-lg shadow-indigo-200"
                  >
                    {signing ? 'Signing…' : '◈ Sign Document'}
                  </button>
                  <button
                    onClick={() => { setShowDeclineModal(true); setDeclineError(''); setDeclineReason(''); }}
                    disabled={!hasScrolled || signing}
                    className="py-3 px-5 border-2 border-red-200 text-red-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-red-50 hover:border-red-300 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
                  >
                    Decline
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Read-only status for signed/declined/expired */}
      {!canSign && !signSuccess && !declineSuccess && (
        <div className={`rounded-2xl border-2 p-6 ${
          isSigned   ? 'bg-emerald-50 border-emerald-200' :
          isDeclined ? 'bg-red-50 border-red-200' :
                       'bg-slate-100 border-slate-200'
        }`}>
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
              isSigned   ? 'bg-emerald-100 text-emerald-600' :
              isDeclined ? 'bg-red-100 text-red-600' :
                           'bg-slate-200 text-slate-500'
            }`}>
              <span className="text-xl">{isSigned ? '◉' : isDeclined ? '◎' : '◯'}</span>
            </div>
            <div className="flex-1">
              <h3 className={`text-sm font-black uppercase tracking-wider ${
                isSigned ? 'text-emerald-700' : isDeclined ? 'text-red-700' : 'text-slate-600'
              }`}>
                {isSigned ? 'Document Signed' : isDeclined ? 'Document Declined' : 'Request Expired'}
              </h3>
              <p className="text-sm text-slate-600 mt-1">
                {isSigned && `Signed by ${request.signatoryName} on ${request.signedAt ? new Date(request.signedAt).toLocaleString('en-SG', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}.`}
                {isDeclined && `Declined on ${request.declinedAt ? new Date(request.declinedAt).toLocaleString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}. ${request.declineReason ? `Reason: ${request.declineReason}` : ''}`}
                {isExpired && 'This signing request has expired. Contact HR if you still need to sign this document.'}
              </p>
              {isSigned && request.signedDocHash && (
                <p className="text-xs text-slate-400 mt-2 font-mono">
                  Document hash: {request.signedDocHash.substring(0, 16)}…
                </p>
              )}
            </div>
          </div>
          <div className="mt-4">
            <Link
              href="/documents"
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-indigo-600 border border-slate-300 rounded-xl px-4 py-2 hover:bg-white transition-all"
            >
              ← Back to Documents
            </Link>
          </div>
        </div>
      )}

      {declineSuccess && (
        <div className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-6 text-center">
          <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center mx-auto mb-3">
            <span className="text-xl text-slate-500">◎</span>
          </div>
          <h3 className="text-sm font-black text-slate-700 mb-1">Decline Recorded</h3>
          <p className="text-sm text-slate-500 mb-4">Your response has been submitted. HR will be notified.</p>
          <Link
            href="/documents"
            className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-indigo-600 border border-slate-300 rounded-xl px-4 py-2 hover:bg-white transition-all"
          >
            ← Back to Documents
          </Link>
        </div>
      )}

      {/* Decline Modal */}
      {showDeclineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900">Decline Document</h3>
                <p className="text-xs text-slate-500 mt-0.5">Please provide a reason for declining</p>
              </div>
              <button onClick={() => setShowDeclineModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all text-lg">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-700 uppercase tracking-wider mb-1.5">
                  Reason for Declining <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={declineReason}
                  onChange={e => setDeclineReason(e.target.value)}
                  placeholder="Explain why you are declining this document…"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent resize-none"
                />
              </div>
              {declineError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-bold">
                  {declineError}
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleDecline}
                  disabled={declining || !declineReason.trim()}
                  className="flex-1 py-2.5 bg-red-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-red-700 disabled:opacity-40 transition-all"
                >
                  {declining ? 'Submitting…' : 'Confirm Decline'}
                </button>
                <button
                  onClick={() => setShowDeclineModal(false)}
                  className="px-5 py-2.5 border border-slate-200 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
