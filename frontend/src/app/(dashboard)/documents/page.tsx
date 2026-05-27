'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ESignRequest {
  id: string;
  documentId: string;
  documentVersion: string;
  signatoryId: string;
  requestedById: string;
  title: string;
  status: 'PENDING' | 'SIGNED' | 'DECLINED' | 'EXPIRED' | 'REVOKED';
  dueDate: string | null;
  message: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  declineReason: string | null;
  remindersSent: number;
  createdAt: string;
  isOverdue: boolean;
}

interface ESignDocument {
  id: string;
  code: string;
  title: string;
  description: string | null;
  documentType: string;
  templateHtml: string;
  version: string;
  isActive: boolean;
  annualRenewal: boolean;
  placeholders: string[];
  createdAt: string;
}

interface DashboardSummary {
  total: number;
  pending: number;
  signed: number;
  declined: number;
  expired: number;
  revoked: number;
  complianceRate: number;
}

interface ByDocument {
  id: string;
  title: string;
  code: string;
  documentType: string;
  total: number;
  pending: number;
  signed: number;
  declined: number;
  expired: number;
  complianceRate: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusBadge(status: ESignRequest['status'], isOverdue: boolean) {
  if (isOverdue && status === 'PENDING')
    return { label: 'Overdue', cls: 'bg-red-100 text-red-700 border-red-200' };
  const map: Record<string, { label: string; cls: string }> = {
    PENDING:  { label: 'Pending',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    SIGNED:   { label: 'Signed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    DECLINED: { label: 'Declined', cls: 'bg-red-50 text-red-600 border-red-200' },
    EXPIRED:  { label: 'Expired',  cls: 'bg-slate-100 text-slate-500 border-slate-200' },
    REVOKED:  { label: 'Revoked',  cls: 'bg-slate-100 text-slate-400 border-slate-200' },
  };
  return map[status] || { label: status, cls: 'bg-slate-100 text-slate-500 border-slate-200' };
}

function docTypeLabel(t: string) {
  const m: Record<string, string> = {
    EMPLOYMENT_CONTRACT:  'Employment Contract',
    POLICY_ACKNOWLEDGEMENT: 'Policy',
    CUSTOM:               'Custom',
  };
  return m[t] || t;
}

// ─── Template Modal (HR) ──────────────────────────────────────────────────────
function TemplateModal({ onClose, onSaved, editDoc }: {
  onClose: () => void;
  onSaved: () => void;
  editDoc: ESignDocument | null;
}) {
  const [form, setForm] = useState({
    code:         editDoc?.code         || '',
    title:        editDoc?.title        || '',
    description:  editDoc?.description  || '',
    documentType: editDoc?.documentType || 'POLICY_ACKNOWLEDGEMENT',
    templateHtml: editDoc?.templateHtml || '',
    version:      editDoc?.version      || '1.0',
    annualRenewal: editDoc?.annualRenewal ?? false,
    expiresInDays: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.code || !form.title || !form.templateHtml) {
      setError('Code, title, and template content are required.'); return;
    }
    setSaving(true); setError(null);
    try {
      if (editDoc) {
        await apiFetch(`/esign/documents/${editDoc.id}`, { method: 'PUT', body: JSON.stringify(form) });
      } else {
        await apiFetch('/esign/documents', { method: 'POST', body: JSON.stringify(form) });
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message || 'Failed to save template');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">
            {editDoc ? 'Edit Template' : 'New Document Template'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 sm:p-6 space-y-4">
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Code *</label>
              <input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())}
                placeholder="e.g. HANDBOOK_2026" disabled={!!editDoc}
                className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-400 font-mono" />
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Version</label>
              <input value={form.version} onChange={e => set('version', e.target.value)}
                placeholder="1.0"
                className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="Employee Handbook 2026"
              className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Document Type *</label>
              <select value={form.documentType} onChange={e => set('documentType', e.target.value)}
                className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="POLICY_ACKNOWLEDGEMENT">Policy Acknowledgement</option>
                <option value="EMPLOYMENT_CONTRACT">Employment Contract</option>
                <option value="CUSTOM">Custom</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Expires In (days)</label>
              <input value={form.expiresInDays} onChange={e => set('expiresInDays', e.target.value)}
                placeholder="30 (leave blank = no expiry)" type="number" min="1"
                className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Description</label>
            <input value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Brief description shown to signatories"
              className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Template HTML *</label>
              <span className="text-[9px] text-slate-400">Use {'{{name}}'}, {'{{start_date}}'} for placeholders</span>
            </div>
            <textarea value={form.templateHtml} onChange={e => set('templateHtml', e.target.value)}
              rows={8} placeholder="<h1>Employee Handbook</h1><p>Dear {{name}},...</p>"
              className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-y" />
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div onClick={() => set('annualRenewal', !form.annualRenewal)}
              className={`w-10 h-5 rounded-full transition-colors relative ${form.annualRenewal ? 'bg-indigo-600' : 'bg-slate-200'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.annualRenewal ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-xs font-semibold text-slate-700">Annual renewal — re-sign required every calendar year</span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 text-xs font-black text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : editDoc ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Send Request Modal (HR) ──────────────────────────────────────────────────
function SendRequestModal({ doc, onClose, onSent }: {
  doc: ESignDocument;
  onClose: () => void;
  onSent: () => void;
}) {
  const [signatoryIds, setSignatoryIds] = useState('');
  const [dueDate, setDueDate]           = useState('');
  const [message, setMessage]           = useState('');
  const [sending, setSending]           = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [result, setResult]             = useState<{ created: number; skipped: number } | null>(null);

  const handleSend = async () => {
    const ids = signatoryIds.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!ids.length) { setError('Enter at least one employee ID or email.'); return; }
    setSending(true); setError(null);
    try {
      const data = await apiFetch('/esign/requests', {
        method: 'POST',
        body: JSON.stringify({ documentId: doc.id, signatoryIds: ids, dueDate: dueDate || undefined, message: message || undefined }),
      });
      setResult({ created: data.created, skipped: data.skipped });
    } catch (e: any) {
      setError(e?.message || 'Failed to send requests');
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Send for Signature</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">×</button>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
            <p className="text-[10px] font-black text-indigo-700 uppercase tracking-widest mb-0.5">Document</p>
            <p className="text-xs font-bold text-indigo-900">{doc.title}</p>
            <p className="text-[10px] text-indigo-600 mt-0.5">v{doc.version} · {docTypeLabel(doc.documentType)}</p>
          </div>

          {result ? (
            <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-4 text-center">
              <div className="text-2xl font-black text-emerald-600 mb-1">{result.created}</div>
              <p className="text-xs font-bold text-emerald-700">Request{result.created !== 1 ? 's' : ''} sent</p>
              {result.skipped > 0 && <p className="text-[10px] text-emerald-600 mt-1">{result.skipped} already have a pending/signed request</p>}
              <button onClick={() => { onSent(); onClose(); }} className="mt-4 px-5 py-2 text-xs font-black text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors">Done</button>
            </div>
          ) : (
            <>
              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</div>}

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Employee IDs *</label>
                <textarea value={signatoryIds} onChange={e => setSignatoryIds(e.target.value)}
                  rows={4} placeholder="One employee ID per line (or comma-separated)&#10;emp-001&#10;emp-002"
                  className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono resize-none" />
              </div>

              {doc.placeholders.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-1">Template placeholders</p>
                  <div className="flex flex-wrap gap-1.5">
                    {doc.placeholders.map(p => (
                      <span key={p} className="text-[10px] font-mono bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md">{`{{${p}}}`}</span>
                    ))}
                  </div>
                  <p className="text-[10px] text-amber-600 mt-1.5">{'{{signatoryId}}'} is auto-filled. Add other values via the API variables field if needed.</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Due Date</label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                    className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Message to signatories</label>
                <textarea value={message} onChange={e => setMessage(e.target.value)}
                  rows={2} placeholder="Optional note shown to each signatory…"
                  className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800">Cancel</button>
                <button onClick={handleSend} disabled={sending}
                  className="px-5 py-2.5 text-xs font-black text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50">
                  {sending ? 'Sending…' : 'Send for Signature'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DocumentsPage() {
  const { user } = useAuth();
  const router   = useRouter();
  const role     = (user?.role || '').toUpperCase();
  const isHr     = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'].includes(role);

  const [tab, setTab]               = useState<'pending' | 'signed' | 'templates' | 'compliance'>(isHr ? 'pending' : 'pending');
  const [requests, setRequests]     = useState<ESignRequest[]>([]);
  const [docs, setDocs]             = useState<ESignDocument[]>([]);
  const [dashboard, setDashboard]   = useState<{ summary: DashboardSummary; byDocument: ByDocument[] } | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editDoc, setEditDoc]                     = useState<ESignDocument | null>(null);
  const [sendDoc, setSendDoc]                     = useState<ESignDocument | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const data = await apiFetch('/esign/requests');
      setRequests(data.requests || []);
    } catch { setError('Failed to load documents'); }
  }, []);

  const loadTemplates = useCallback(async () => {
    if (!isHr) return;
    try {
      const data = await apiFetch('/esign/documents');
      setDocs(data.documents || []);
    } catch { /* swallow */ }
  }, [isHr]);

  const loadDashboard = useCallback(async () => {
    if (!isHr) return;
    try {
      const data = await apiFetch('/esign/dashboard');
      setDashboard({ summary: data.summary, byDocument: data.byDocument || [] });
    } catch { /* swallow */ }
  }, [isHr]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadRequests(), loadTemplates(), loadDashboard()])
      .finally(() => setLoading(false));
  }, [loadRequests, loadTemplates, loadDashboard]);

  const pending = requests.filter(r => r.status === 'PENDING');
  const signed  = requests.filter(r => r.status === 'SIGNED');
  const other   = requests.filter(r => !['PENDING', 'SIGNED'].includes(r.status));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin border-[3px]" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading Documents…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Documents</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isHr ? 'Manage document templates and track e-signature compliance' : 'View and sign your pending documents'}
          </p>
        </div>
        {isHr && (
          <button onClick={() => { setEditDoc(null); setShowTemplateModal(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-xs font-black rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">
            <span>+</span> New Template
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-5 py-4 text-xs text-red-600">{error}</div>
      )}

      {/* Pending alert banner for employees */}
      {!isHr && pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 flex items-center gap-4">
          <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
            <span className="text-amber-600 text-lg">◭</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-black text-amber-900">{pending.length} document{pending.length > 1 ? 's' : ''} awaiting your signature</p>
            <p className="text-xs text-amber-700 mt-0.5">Please review and sign at your earliest convenience.</p>
          </div>
        </div>
      )}

      {/* HR Compliance Stats */}
      {isHr && dashboard?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Pending', value: dashboard.summary.pending, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-100' },
            { label: 'Signed',  value: dashboard.summary.signed,  color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
            { label: 'Overdue', value: requests.filter(r => r.isOverdue).length, color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
            { label: 'Compliance', value: `${dashboard.summary.complianceRate}%`, color: 'text-indigo-600', bg: 'bg-indigo-50 border-indigo-100' },
          ].map(stat => (
            <div key={stat.label} className={`rounded-2xl border p-5 ${stat.bg}`}>
              <div className={`text-2xl font-black ${stat.color}`}>{stat.value}</div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex border-b border-slate-100 px-6 pt-4 gap-1 overflow-x-auto">
          {[
            { key: 'pending',    label: `Pending${pending.length > 0 ? ` (${pending.length})` : ''}` },
            { key: 'signed',     label: `Signed${signed.length > 0 ? ` (${signed.length})` : ''}` },
            ...(isHr ? [
              { key: 'compliance', label: 'Compliance' },
              { key: 'templates',  label: 'Templates' },
            ] : []),
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
              className={`pb-3 px-4 text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap border-b-2 ${
                tab === t.key
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Pending Tab ─────────────────────────────────────────────────── */}
        {tab === 'pending' && (
          <div className="p-4 sm:p-6">
            {pending.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <span className="text-emerald-500 text-2xl">✓</span>
                </div>
                <p className="text-sm font-black text-slate-700">All caught up!</p>
                <p className="text-xs text-slate-400 mt-1">No documents awaiting your signature.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pending.map(req => {
                  const badge = statusBadge(req.status, req.isOverdue);
                  return (
                    <div key={req.id} className={`border rounded-xl p-5 flex items-center gap-4 transition-all hover:shadow-sm ${req.isOverdue ? 'border-red-200 bg-red-50/30' : 'border-slate-200 bg-white'}`}>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${req.isOverdue ? 'bg-red-100' : 'bg-indigo-50'}`}>
                        <span className={`text-lg ${req.isOverdue ? 'text-red-500' : 'text-indigo-500'}`}>◭</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{req.title}</p>
                        {req.message && <p className="text-xs text-slate-500 mt-0.5 truncate">{req.message}</p>}
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
                          {req.dueDate && (
                            <span className="text-[10px] text-slate-400">Due {fmtDate(req.dueDate)}</span>
                          )}
                          {req.viewedAt && (
                            <span className="text-[10px] text-slate-400">Viewed {fmtDate(req.viewedAt)}</span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => router.push(`/documents/sign/${req.id}`)}
                        className="shrink-0 px-4 py-2 text-xs font-black text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors">
                        Review & Sign
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Signed Tab ──────────────────────────────────────────────────── */}
        {tab === 'signed' && (
          <div className="p-4 sm:p-6">
            {signed.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm font-black text-slate-700">No signed documents yet</p>
                <p className="text-xs text-slate-400 mt-1">Completed signatures will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {[...signed, ...other].map(req => {
                  const badge = statusBadge(req.status, req.isOverdue);
                  return (
                    <div key={req.id} className="border border-slate-200 rounded-xl p-5 flex items-center gap-4 hover:shadow-sm transition-all">
                      <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center shrink-0">
                        <span className="text-emerald-500 text-lg">◆</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{req.title}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
                          {req.signedAt && (
                            <span className="text-[10px] text-slate-400">Signed {fmtDate(req.signedAt)}</span>
                          )}
                          {req.declineReason && (
                            <span className="text-[10px] text-slate-400 truncate max-w-[200px]">Reason: {req.declineReason}</span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => router.push(`/documents/sign/${req.id}`)}
                        className="shrink-0 px-3 py-1.5 text-[10px] font-black text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                        View
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Compliance Tab (HR) ──────────────────────────────────────────── */}
        {tab === 'compliance' && isHr && (
          <div className="p-4 sm:p-6 space-y-6">
            {dashboard?.byDocument.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-sm font-black text-slate-700">No sign requests dispatched yet</p>
                <p className="text-xs text-slate-400 mt-1">Create a template and send for signature to see compliance data.</p>
              </div>
            ) : (
              <>
                {/* Overdue requests */}
                {requests.filter(r => r.isOverdue).length > 0 && (
                  <div>
                    <h3 className="text-xs font-black text-red-600 uppercase tracking-widest mb-3">Overdue ({requests.filter(r => r.isOverdue).length})</h3>
                    <div className="space-y-2">
                      {requests.filter(r => r.isOverdue).map(req => (
                        <div key={req.id} className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                          <span className="text-red-500 text-sm">⚠</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-800 truncate">{req.title}</p>
                            <p className="text-[10px] text-red-600">Due {fmtDate(req.dueDate)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* By document breakdown */}
                <div>
                  <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">By Document</h3>
                  <div className="space-y-3">
                    {dashboard?.byDocument.map(doc => (
                      <div key={doc.id} className="border border-slate-200 rounded-xl p-5">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-sm font-bold text-slate-900">{doc.title}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{docTypeLabel(doc.documentType)}</p>
                          </div>
                          <div className="text-right">
                            <div className="text-xl font-black text-indigo-600">{doc.complianceRate}%</div>
                            <div className="text-[9px] text-slate-400 uppercase tracking-widest">Compliance</div>
                          </div>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${doc.complianceRate}%` }} />
                        </div>
                        <div className="flex items-center gap-4 mt-3">
                          {[
                            { label: 'Signed',   v: doc.signed,   c: 'text-emerald-600' },
                            { label: 'Pending',  v: doc.pending,  c: 'text-amber-600' },
                            { label: 'Declined', v: doc.declined, c: 'text-red-500' },
                            { label: 'Expired',  v: doc.expired,  c: 'text-slate-400' },
                          ].map(s => (
                            <div key={s.label} className="text-center">
                              <div className={`text-sm font-black ${s.c}`}>{s.v}</div>
                              <div className="text-[8px] text-slate-400 uppercase tracking-widest">{s.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Templates Tab (HR) ──────────────────────────────────────────── */}
        {tab === 'templates' && isHr && (
          <div className="p-4 sm:p-6">
            {docs.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <span className="text-slate-400 text-2xl">◭</span>
                </div>
                <p className="text-sm font-black text-slate-700">No templates yet</p>
                <p className="text-xs text-slate-400 mt-1 mb-4">Create your first document template to start collecting e-signatures.</p>
                <button onClick={() => { setEditDoc(null); setShowTemplateModal(true); }}
                  className="px-4 py-2.5 text-xs font-black text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition-colors">
                  Create Template
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {docs.map(doc => (
                  <div key={doc.id} className="border border-slate-200 rounded-xl p-5 flex items-center gap-4 hover:shadow-sm transition-all">
                    <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                      <span className="text-slate-500 text-sm">◭</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-900 truncate">{doc.title}</p>
                        {doc.annualRenewal && (
                          <span className="text-[8px] font-black px-1.5 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-md uppercase tracking-wide">Annual</span>
                        )}
                        {!doc.isActive && (
                          <span className="text-[8px] font-black px-1.5 py-0.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-md uppercase tracking-wide">Inactive</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] font-mono text-slate-400">{doc.code}</span>
                        <span className="text-[10px] text-slate-400">v{doc.version}</span>
                        <span className="text-[10px] text-slate-400">{docTypeLabel(doc.documentType)}</span>
                        {doc.placeholders.length > 0 && (
                          <span className="text-[10px] text-slate-400">{doc.placeholders.length} placeholder{doc.placeholders.length > 1 ? 's' : ''}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => setSendDoc(doc)}
                        className="px-3 py-1.5 text-[10px] font-black text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors">
                        Send
                      </button>
                      <button onClick={() => { setEditDoc(doc); setShowTemplateModal(true); }}
                        className="px-3 py-1.5 text-[10px] font-black text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {showTemplateModal && (
        <TemplateModal
          editDoc={editDoc}
          onClose={() => setShowTemplateModal(false)}
          onSaved={() => { setShowTemplateModal(false); loadTemplates(); }}
        />
      )}
      {sendDoc && (
        <SendRequestModal
          doc={sendDoc}
          onClose={() => setSendDoc(null)}
          onSent={() => { setSendDoc(null); loadRequests(); loadDashboard(); }}
        />
      )}
    </div>
  );
}
