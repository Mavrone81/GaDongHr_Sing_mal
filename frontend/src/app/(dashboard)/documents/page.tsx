'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { PageHeader, Card, CardHeader, Tabs, Badge, Button, Stat, Modal, Field, Input, Select, Textarea, EmptyState, Icon } from '@/components/ui';
import type { BadgeTone } from '@/components/ui';

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

/**
 * Five request states, four appearances: the two that ended without a
 * signature and without anyone refusing (expired, revoked) share the quiet
 * neutral. An overdue PENDING request is shown as its own "Overdue" state.
 */
const REQUEST_STATUS_TONE: Record<ESignRequest['status'], BadgeTone> = {
  PENDING:  'warn',
  SIGNED:   'ok',
  DECLINED: 'danger',
  EXPIRED:  'neutral',
  REVOKED:  'neutral',
};

const REQUEST_STATUS_LABEL: Record<ESignRequest['status'], string> = {
  PENDING: 'Pending', SIGNED: 'Signed', DECLINED: 'Declined', EXPIRED: 'Expired', REVOKED: 'Revoked',
};

function RequestStatus({ status, isOverdue }: { status: ESignRequest['status']; isOverdue: boolean }) {
  if (isOverdue && status === 'PENDING') return <Badge tone="danger">Overdue</Badge>;
  return (
    <Badge tone={REQUEST_STATUS_TONE[status] ?? 'neutral'} className={status === 'REVOKED' ? 'line-through' : ''}>
      {REQUEST_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function docTypeLabel(t: string) {
  const m: Record<string, string> = {
    EMPLOYMENT_CONTRACT:    'Employment contract',
    POLICY_ACKNOWLEDGEMENT: 'Policy',
    CUSTOM:                 'Custom',
  };
  return m[t] || t;
}

function DocTile({ tone = 'accent' }: { tone?: 'accent' | 'danger' | 'muted' }) {
  const cls = tone === 'danger' ? 'bg-danger-bg text-danger' : tone === 'muted' ? 'bg-pill text-muted' : 'bg-tint text-accent';
  return (
    <span className={`flex items-center justify-center w-10 h-10 rounded-control shrink-0 ${cls}`} aria-hidden="true">
      <Icon name="file" size={19} />
    </span>
  );
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
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={editDoc ? 'Edit template' : 'New document template'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : editDoc ? 'Save changes' : 'Create template'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div role="alert" className="flex items-start gap-2.5 px-3.5 py-3 rounded-control bg-danger-bg text-[13px] text-danger">
            <Icon name="alert" size={16} className="mt-px" />{error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Code" required help={editDoc ? 'The code cannot be changed after creation.' : 'Letters are converted to upper case.'}>
            <Input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())}
              placeholder="HANDBOOK_2026" disabled={!!editDoc} invalid={!!error && !form.code} />
          </Field>
          <Field label="Version">
            <Input value={form.version} onChange={e => set('version', e.target.value)} placeholder="1.0" />
          </Field>
        </div>

        <Field label="Title" required>
          <Input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Employee handbook 2026" invalid={!!error && !form.title} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Document type" required>
            <Select value={form.documentType} onChange={e => set('documentType', e.target.value)}>
              <option value="POLICY_ACKNOWLEDGEMENT">Policy acknowledgement</option>
              <option value="EMPLOYMENT_CONTRACT">Employment contract</option>
              <option value="CUSTOM">Custom</option>
            </Select>
          </Field>
          <Field label="Expires in (days)" help="Leave blank for no expiry.">
            <Input value={form.expiresInDays} onChange={e => set('expiresInDays', e.target.value)} placeholder="30" type="number" min="1" />
          </Field>
        </div>

        <Field label="Description" help="Shown to people who are asked to sign.">
          <Input value={form.description} onChange={e => set('description', e.target.value)} />
        </Field>

        <Field label="Template HTML" required help={<>Use {'{{name}}'} and {'{{start_date}}'} style placeholders.</>}>
          <Textarea value={form.templateHtml} onChange={e => set('templateHtml', e.target.value)}
            rows={8} placeholder="<h1>Employee handbook</h1><p>Dear {{name}}, …</p>"
            className="font-mono text-[13px] resize-y" invalid={!!error && !form.templateHtml} />
        </Field>

        <div className="flex items-start gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.annualRenewal}
            aria-labelledby="annual-renewal-label"
            onClick={() => set('annualRenewal', !form.annualRenewal)}
            className={`relative w-10 h-[22px] rounded-full shrink-0 transition-colors ${form.annualRenewal ? 'bg-accent' : 'bg-rule'}`}
          >
            <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-paper transition-transform ${form.annualRenewal ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
          <span id="annual-renewal-label" className="text-sm text-ink">
            Annual renewal <span className="text-muted">— everyone signs again each calendar year</span>
          </span>
        </div>
      </div>
    </Modal>
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
    <Modal
      open
      onClose={onClose}
      title="Send for signature"
      footer={result ? (
        <Button onClick={() => { onSent(); onClose(); }}>Done</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending} icon="mail">{sending ? 'Sending…' : 'Send for signature'}</Button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 px-3.5 py-3 rounded-control bg-tint">
          <Icon name="file" size={18} className="text-accent mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{doc.title}</p>
            <p className="text-[13px] text-muted mt-0.5">Version {doc.version} · {docTypeLabel(doc.documentType)}</p>
          </div>
        </div>

        {result ? (
          <div className="flex flex-col items-center text-center py-4">
            <span className="flex items-center justify-center w-11 h-11 rounded-full bg-ok-bg text-ok mb-3" aria-hidden="true">
              <Icon name="check" size={22} strokeWidth={2.5} />
            </span>
            <p className="text-[30px] font-extrabold leading-none text-ink tabular-nums">{result.created}</p>
            <p className="text-sm font-semibold text-ink mt-1">Request{result.created !== 1 ? 's' : ''} sent</p>
            {result.skipped > 0 && (
              <p className="text-[13px] text-muted mt-1 tabular-nums">{result.skipped} skipped — they already have a pending or signed request</p>
            )}
          </div>
        ) : (
          <>
            <Field label="Employee IDs" required help="One per line, or separated by commas." error={error || undefined}>
              <Textarea value={signatoryIds} onChange={e => setSignatoryIds(e.target.value)}
                rows={4} placeholder={'emp-001\nemp-002'} className="font-mono text-[13px]" invalid={!!error} />
            </Field>

            {doc.placeholders.length > 0 && (
              <div className="px-3.5 py-3 rounded-control bg-page border border-rule">
                <p className="text-[12.5px] font-semibold text-muted mb-2">Template placeholders</p>
                <div className="flex flex-wrap gap-1.5">
                  {doc.placeholders.map(p => (
                    <code key={p} className="text-xs font-mono bg-pill text-ink px-2 py-0.5 rounded-control">{`{{${p}}}`}</code>
                  ))}
                </div>
                <p className="text-xs text-muted mt-2">{'{{signatoryId}}'} is filled in automatically. Other values can be passed through the API variables field.</p>
              </div>
            )}

            <Field label="Due date" className="sm:max-w-[240px]">
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </Field>

            <Field label="Message to signatories" help="Optional. Shown to each person with the document.">
              <Textarea value={message} onChange={e => setMessage(e.target.value)} rows={2} />
            </Field>
          </>
        )}
      </div>
    </Modal>
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
  const overdue = requests.filter(r => r.isOverdue);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading documents" />
      </div>
    );
  }

  const openNewTemplate = () => { setEditDoc(null); setShowTemplateModal(true); };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Documents"
        subtitle={isHr ? 'Document templates, signature requests and how many have been signed.' : 'Documents waiting for your signature, and the ones you have signed.'}
        actions={isHr ? <Button icon="plus" onClick={openNewTemplate}>New template</Button> : undefined}
      />

      {error && (
        <div role="alert" className="flex items-start gap-2.5 px-4 py-3 rounded-control bg-danger-bg text-sm text-danger">
          <Icon name="alert" size={18} className="mt-px" />{error}
        </div>
      )}

      {!isHr && pending.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-control bg-warn-bg">
          <Icon name="alert" size={18} className="text-warn shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink">{pending.length} document{pending.length > 1 ? 's' : ''} waiting for your signature</p>
            <p className="text-[13px] text-muted mt-0.5">Please review and sign when you can.</p>
          </div>
        </div>
      )}

      {isHr && dashboard?.summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Pending"    value={dashboard.summary.pending} />
          <Stat label="Signed"     value={dashboard.summary.signed} />
          <Stat label="Overdue"    value={overdue.length} note={overdue.length ? 'past their due date' : 'none past due'} />
          <Stat label="Compliance" value={`${dashboard.summary.complianceRate}%`} note="of requests signed" />
        </div>
      )}

      <Tabs
        items={[
          { id: 'pending' as const, label: 'Pending', count: pending.length },
          { id: 'signed' as const,  label: 'Signed', count: signed.length },
          ...(isHr ? [
            { id: 'compliance' as const, label: 'Compliance' },
            { id: 'templates' as const,  label: 'Templates', count: docs.length },
          ] : []),
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ── Pending Tab ─────────────────────────────────────────────────── */}
      {tab === 'pending' && (
        <Card padding="p-0" className="overflow-hidden">
          {pending.length === 0 ? (
            <EmptyState icon="check" title="All caught up" description="No documents are waiting for a signature." />
          ) : (
            <ul>
              {pending.map((req, i) => (
                <li key={req.id} className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-5 py-4 ${i > 0 ? 'border-t border-rule' : ''} ${req.isOverdue ? 'bg-danger-bg/40' : ''}`}>
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    <DocTile tone={req.isOverdue ? 'danger' : 'accent'} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{req.title}</p>
                      {req.message && <p className="text-[13px] text-muted mt-0.5 truncate">{req.message}</p>}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                        <RequestStatus status={req.status} isOverdue={req.isOverdue} />
                        {req.dueDate && <span className="text-[13px] text-muted tabular-nums">Due {fmtDate(req.dueDate)}</span>}
                        {req.viewedAt && <span className="text-[13px] text-muted tabular-nums">Viewed {fmtDate(req.viewedAt)}</span>}
                      </div>
                    </div>
                  </div>
                  <Button className="self-start sm:self-auto" onClick={() => router.push(`/documents/sign/${req.id}`)}>Review and sign</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── Signed Tab ──────────────────────────────────────────────────── */}
      {tab === 'signed' && (
        <Card padding="p-0" className="overflow-hidden">
          {signed.length === 0 ? (
            <EmptyState icon="file" title="No signed documents yet" description="Documents appear here once they are signed." />
          ) : (
            <ul>
              {[...signed, ...other].map((req, i) => (
                <li key={req.id} className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? 'border-t border-rule' : ''}`}>
                  <DocTile tone={req.status === 'SIGNED' ? 'accent' : 'muted'} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{req.title}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                      <RequestStatus status={req.status} isOverdue={req.isOverdue} />
                      {req.signedAt && <span className="text-[13px] text-muted tabular-nums">Signed {fmtDate(req.signedAt)}</span>}
                      {req.declineReason && <span className="text-[13px] text-muted truncate max-w-[260px]">Reason: {req.declineReason}</span>}
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => router.push(`/documents/sign/${req.id}`)}>View</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── Compliance Tab (HR) ──────────────────────────────────────────── */}
      {tab === 'compliance' && isHr && (
        dashboard?.byDocument.length === 0 ? (
          <Card padding="p-0">
            <EmptyState
              icon="chart"
              title="No signature requests sent yet"
              description="Create a template and send it for signature to see who has signed."
              action={<Button variant="secondary" icon="plus" onClick={openNewTemplate}>New template</Button>}
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-5">
            {overdue.length > 0 && (
              <Card padding="p-0" className="overflow-hidden">
                <div className="px-5 pt-5"><CardHeader title="Overdue" caption={`${overdue.length} past their due date`} /></div>
                <ul>
                  {overdue.map(req => (
                    <li key={req.id} className="flex items-center gap-3 px-5 py-3 border-t border-rule">
                      <Icon name="alert" size={16} className="text-danger shrink-0" />
                      <p className="flex-1 min-w-0 text-sm font-semibold text-ink truncate">{req.title}</p>
                      <span className="text-[13px] text-danger tabular-nums shrink-0">Due {fmtDate(req.dueDate)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {dashboard?.byDocument.map(doc => (
                <Card key={doc.id}>
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                      <p className="text-[15.5px] font-bold text-ink">{doc.title}</p>
                      <p className="text-[13px] text-muted mt-0.5">{docTypeLabel(doc.documentType)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-extrabold text-ink tabular-nums">{doc.complianceRate}%</p>
                      <p className="text-xs text-muted">signed</p>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-pill overflow-hidden" role="progressbar" aria-valuenow={doc.complianceRate} aria-valuemin={0} aria-valuemax={100} aria-label={`${doc.title} compliance`}>
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${doc.complianceRate}%` }} />
                  </div>
                  <dl className="grid grid-cols-4 gap-2 mt-4">
                    {[
                      { label: 'Signed',   v: doc.signed },
                      { label: 'Pending',  v: doc.pending },
                      { label: 'Declined', v: doc.declined },
                      { label: 'Expired',  v: doc.expired },
                    ].map(s => (
                      <div key={s.label}>
                        <dt className="text-xs text-muted">{s.label}</dt>
                        <dd className="text-base font-bold text-ink tabular-nums">{s.v}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              ))}
            </div>
          </div>
        )
      )}

      {/* ── Templates Tab (HR) ──────────────────────────────────────────── */}
      {tab === 'templates' && isHr && (
        <Card padding="p-0" className="overflow-hidden">
          {docs.length === 0 ? (
            <EmptyState
              icon="file"
              title="No templates yet"
              description="Create a document template to start collecting e-signatures."
              action={<Button icon="plus" onClick={openNewTemplate}>Create template</Button>}
            />
          ) : (
            <ul>
              {docs.map((doc, i) => (
                <li key={doc.id} className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-5 py-4 ${i > 0 ? 'border-t border-rule' : ''}`}>
                  <div className="flex items-start gap-3.5 flex-1 min-w-0">
                    <DocTile tone={doc.isActive ? 'accent' : 'muted'} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-ink truncate">{doc.title}</p>
                        {doc.annualRenewal && <Badge tone="accent">Annual</Badge>}
                        {!doc.isActive && <Badge tone="neutral">Inactive</Badge>}
                      </div>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[13px] text-muted">
                        <span className="font-mono text-xs">{doc.code}</span>
                        <span className="tabular-nums">Version {doc.version}</span>
                        <span>{docTypeLabel(doc.documentType)}</span>
                        {doc.placeholders.length > 0 && (
                          <span className="tabular-nums">{doc.placeholders.length} placeholder{doc.placeholders.length > 1 ? 's' : ''}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" icon="mail" onClick={() => setSendDoc(doc)}>Send</Button>
                    <Button size="sm" variant="secondary" onClick={() => { setEditDoc(doc); setShowTemplateModal(true); }}>Edit</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

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
