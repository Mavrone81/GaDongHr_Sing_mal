'use client';

/**
 * PAY-007 — IRAS / CPF Submission Tracking
 *
 * Lists every monthly CPF e-Submit, annual IR8A / Appendix 8A / Appendix 8B,
 * and per-employee IR21 filing. Records the IRAS / CPF Board reference
 * number on submission, walks the status machine
 * DRAFT → SUBMITTED → ACKNOWLEDGED / REJECTED, and surfaces a deadline
 * dashboard with urgency banding.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { Seal } from '@/components/official';

const KINDS = ['CPF_E_SUBMIT', 'IR8A', 'APPENDIX_8A', 'APPENDIX_8B', 'IR21'] as const;
const STATUSES = ['DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'REJECTED'] as const;
const URGENCIES = ['OVERDUE', 'CRITICAL', 'WARNING', 'NOTICE', 'OK'] as const;

type Kind = typeof KINDS[number];
type Status = typeof STATUSES[number];
type Urgency = typeof URGENCIES[number] | 'UNSCHEDULED';

interface Submission {
  id: string;
  kind: Kind;
  period: string | null;
  year: number | null;
  employeeId: string | null;
  runId: string | null;
  fileName: string | null;
  fileHash: string | null;
  fileSize: number | null;
  status: Status;
  referenceNumber: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  rejectedReason: string | null;
  rejectedAt: string | null;
  deadline: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  urgency: Urgency;
  daysUntilDeadline: number | null;
}

interface ListResponse {
  total: number;
  summary: {
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
    byUrgency: Record<string, number>;
  };
  submissions: Submission[];
}

const KIND_LABELS: Record<Kind, string> = {
  CPF_E_SUBMIT: 'CPF e-Submit (Monthly)',
  IR8A: 'IR8A (Annual)',
  APPENDIX_8A: 'Appendix 8A (BIK)',
  APPENDIX_8B: 'Appendix 8B (ESOP)',
  IR21: 'IR21 (Tax Clearance)',
};

/**
 * The authority behind each deadline.
 *
 * A missed filing here is a penalty, not an inconvenience, and the date is not
 * the same rule for every row — CPF is monthly, IR8A is annual, IR21 is keyed
 * to the employee's last day. Putting the citation beside the date means the
 * person chasing the filing can check the rule without leaving the screen.
 */
const KIND_CITATIONS: Record<Kind, string> = {
  CPF_E_SUBMIT: 'CPF Act s.7 · by 14th of following month',
  IR8A:         'ITA s.68(2) · by 1 Mar',
  APPENDIX_8A:  'ITA s.68(2) · with IR8A, by 1 Mar',
  APPENDIX_8B:  'ITA s.68(2) · with IR8A, by 1 Mar',
  IR21:         'ITA s.68(6) · 1 month before cessation',
};

/**
 * Status and urgency are distinguished by WEIGHT and FILL, not by hue.
 *
 * The old screen keyed these off six different hues — blue, emerald, rose,
 * red, orange, amber, yellow. The Official Record palette has no error red and
 * no success green to spend (seal red is reserved for citations), so mapping
 * them onto tokens collapsed several states onto the same colour. Rather than
 * leave two states looking identical, the distinction is carried by fill:
 * the states that need action are FILLED and therefore heaviest on the page;
 * the settled ones are outlined; the inert ones are muted. The word is always
 * present regardless — colour never carries the meaning alone.
 */
const STATUS_STYLES: Record<Status, string> = {
  DRAFT:        'bg-transparent text-muted ring-rule',
  SUBMITTED:    'bg-transparent text-ink ring-ink font-medium',
  ACKNOWLEDGED: 'bg-transparent text-accent ring-accent font-medium',
  REJECTED:     'bg-ink text-paper ring-ink font-semibold',
};

const URGENCY_STYLES: Record<string, string> = {
  OVERDUE:     'bg-ink text-paper font-semibold',
  CRITICAL:    'bg-highlight text-ink font-semibold',
  WARNING:     'bg-transparent text-ink ring-1 ring-highlight',
  NOTICE:      'bg-transparent text-muted ring-1 ring-rule',
  OK:          'bg-transparent text-accent',
  UNSCHEDULED: 'bg-transparent text-muted',
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  try { return new Date(value).toISOString().slice(0, 10); }
  catch { return '—'; }
}

function fmtScope(s: Submission): string {
  if (s.kind === 'CPF_E_SUBMIT') return s.period ?? '—';
  if (s.kind === 'IR21')         return s.employeeId ?? '—';
  return s.year != null ? String(s.year) : '—';
}

function fmtBytes(n: number | null | undefined): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function IrasSubmissionsPage() {
  const { user } = useAuth();
  const role = String(user?.role || '').toUpperCase();
  const isAdmin = ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER'].includes(role);

  // ── Filters ─────────────────────────────────────────────────────────────
  const [kindFilter,   setKindFilter]   = useState<Kind | ''>('');
  const [statusFilter, setStatusFilter] = useState<Status | ''>('');
  const [periodFilter, setPeriodFilter] = useState<string>('');
  const [yearFilter,   setYearFilter]   = useState<string>('');

  // ── Data ────────────────────────────────────────────────────────────────
  const [list,      setList]      = useState<ListResponse | null>(null);
  const [deadlines, setDeadlines] = useState<ListResponse | null>(null);
  const [loading,   setLoading]   = useState<boolean>(true);
  const [error,     setError]     = useState<string | null>(null);

  // ── Modal state ─────────────────────────────────────────────────────────
  const [editing,  setEditing]   = useState<Submission | null>(null);
  const [creating, setCreating]  = useState<boolean>(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (kindFilter)   params.set('kind',   kindFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (periodFilter) params.set('period', periodFilter);
      if (yearFilter)   params.set('year',   yearFilter);
      const qs = params.toString();
      const [l, d] = await Promise.all([
        apiFetch(`/payroll/iras-submissions${qs ? `?${qs}` : ''}`),
        apiFetch(`/payroll/iras-submissions/deadlines?withinDays=60`),
      ]);
      setList(l as ListResponse);
      setDeadlines(d as ListResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load submissions');
    } finally {
      setLoading(false);
    }
  }, [kindFilter, statusFilter, periodFilter, yearFilter]);

  useEffect(() => { reload(); }, [reload]);

  const summary = list?.summary;
  const dlSummary = deadlines?.summary;

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-xs text-muted mb-1">
            <Link href="/payroll" className="hover:underline">Payroll</Link>
            <span className="mx-1">/</span>
            <span>IRAS Submissions</span>
          </div>
          <h1 className="text-2xl font-semibold text-ink">IRAS / CPF Submission Tracking</h1>
          <p className="text-sm text-ink mt-1">
            Records every CPF e-Submit, annual IR8A / Appendix 8A / 8B, and per-employee IR21 filing.
            Capture the IRAS / CPF Board reference number when submitted, then mark ACKNOWLEDGED on confirmation.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="px-4 py-2 bg-accent text-paper text-sm shadow hover:bg-accent"
            onClick={() => setCreating(true)}
          >
            + New Submission
          </button>
        )}
      </div>

      {/* ── Deadline KPI band ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {URGENCIES.map(u => {
          const n = dlSummary?.byUrgency?.[u] ?? 0;
          const styles = URGENCY_STYLES[u] ?? 'bg-page text-ink';
          return (
            <div key={u} className={` px-4 py-3 ${styles}`}>
              <div className="text-xs uppercase tracking-wide opacity-80">{u}</div>
              <div className="text-2xl font-bold mt-1">{n}</div>
            </div>
          );
        })}
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Kind</label>
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as Kind | '')}
            className="border border-rule px-2 py-1 text-sm"
          >
            <option value="">All kinds</option>
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as Status | '')}
            className="border border-rule px-2 py-1 text-sm"
          >
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Period (YYYY-MM)</label>
          <input
            type="text" placeholder="2026-05"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="border border-rule px-2 py-1 text-sm w-28"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink mb-1">Year</label>
          <input
            type="number" placeholder="2026"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="border border-rule px-2 py-1 text-sm w-24"
          />
        </div>
        <button
          type="button"
          onClick={() => { setKindFilter(''); setStatusFilter(''); setPeriodFilter(''); setYearFilter(''); }}
          className="text-xs text-ink hover:text-ink underline ml-2 pb-2"
        >
          Clear
        </button>
        {summary && (
          <div className="ml-auto text-xs text-ink pb-2">
            {list?.total ?? 0} total ·
            {' '}{summary.byStatus?.DRAFT ?? 0} draft ·
            {' '}{summary.byStatus?.SUBMITTED ?? 0} submitted ·
            {' '}{summary.byStatus?.ACKNOWLEDGED ?? 0} acknowledged
            {summary.byStatus?.REJECTED ? ` · ${summary.byStatus.REJECTED} rejected` : ''}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-page border border-ink text-ink px-3 py-2 text-sm mb-4">
          {error}
        </div>
      )}

      {/* ── Submissions table ──────────────────────────────────────────── */}
      <div className="bg-paper border border-rule overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-page text-ink text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Kind</th>
              <th className="text-left px-3 py-2">Scope</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Deadline</th>
              <th className="text-left px-3 py-2">Urgency</th>
              <th className="text-left px-3 py-2">Reference #</th>
              <th className="text-left px-3 py-2">File</th>
              <th className="text-left px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted">Loading…</td></tr>
            )}
            {!loading && (list?.submissions?.length ?? 0) === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-muted">
                No submissions match the current filters. Generating a CPF or IR8A file from the Payroll page will
                auto-create a DRAFT row here.
              </td></tr>
            )}
            {list?.submissions?.map(s => (
              <tr key={s.id} className="border-t border-rule hover:bg-page">
                <td className="px-3 py-2 text-ink font-medium">{KIND_LABELS[s.kind]}</td>
                <td className="px-3 py-2 text-ink font-mono text-xs">{fmtScope(s)}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5  text-xs ring-1 ${STATUS_STYLES[s.status]}`}>
                    {s.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink text-xs">
                  <span className="tabular-nums">{fmtDate(s.deadline)}</span>
                  <span className="block mt-0.5"><Seal cite={KIND_CITATIONS[s.kind]} /></span>
                </td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-0.5  text-xs font-medium ${URGENCY_STYLES[s.urgency] ?? ''}`}>
                    {s.urgency}{s.daysUntilDeadline != null ? ` (${s.daysUntilDeadline}d)` : ''}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-ink">{s.referenceNumber ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-ink">
                  {s.fileName ? (
                    <div>
                      <div>{s.fileName}</div>
                      <div className="text-muted">{fmtBytes(s.fileSize)} · {s.fileHash ? `${s.fileHash.slice(0, 8)}…` : 'no hash'}</div>
                    </div>
                  ) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {isAdmin && s.status !== 'ACKNOWLEDGED' && (
                    <button
                      type="button"
                      onClick={() => setEditing(s)}
                      className="text-accent hover:text-accent text-xs font-medium"
                    >
                      Manage
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {editing && (
        <ManageSubmissionModal
          submission={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {creating && (
        <CreateSubmissionModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); reload(); }}
        />
      )}
    </div>
  );
}

// ─── Manage modal ────────────────────────────────────────────────────────────

interface ManageProps {
  submission: Submission;
  onClose: () => void;
  onSaved: () => void;
}

function ManageSubmissionModal({ submission, onClose, onSaved }: ManageProps) {
  const allowed: Status[] = (() => {
    if (submission.status === 'DRAFT')     return ['SUBMITTED', 'REJECTED'];
    if (submission.status === 'SUBMITTED') return ['ACKNOWLEDGED', 'REJECTED'];
    if (submission.status === 'REJECTED')  return ['DRAFT']; // resubmission
    return [];
  })();

  const [targetStatus, setTargetStatus] = useState<Status | ''>('');
  const [referenceNumber, setReferenceNumber] = useState<string>(submission.referenceNumber ?? '');
  const [rejectedReason, setRejectedReason] = useState<string>('');
  const [notes, setNotes] = useState<string>(submission.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const requiresRef    = targetStatus === 'SUBMITTED';
  const requiresReason = targetStatus === 'REJECTED';

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (targetStatus) body.status = targetStatus;
      if (referenceNumber !== (submission.referenceNumber ?? '')) body.referenceNumber = referenceNumber || null;
      if (requiresReason && rejectedReason.trim()) body.rejectedReason = rejectedReason.trim();
      if (notes !== (submission.notes ?? '')) body.notes = notes || null;
      if (!Object.keys(body).length) { onClose(); return; }
      await apiFetch(`/payroll/iras-submissions/${submission.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-shadow flex items-center justify-center z-50 p-4">
      <div className="bg-paper max-w-lg w-full">
        <div className="px-5 py-4 border-b border-rule flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Manage submission</h2>
            <div className="text-xs text-muted mt-0.5">
              {KIND_LABELS[submission.kind]} · {fmtScope(submission)} · currently {submission.status}
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink text-lg">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {error && (
            <div className="bg-page border border-ink text-ink px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {/* Status transition */}
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Transition to</label>
            <select
              value={targetStatus}
              onChange={(e) => setTargetStatus(e.target.value as Status | '')}
              className="border border-rule px-2 py-1 text-sm w-full"
            >
              <option value="">(no status change)</option>
              {allowed.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {allowed.length === 0 && (
              <p className="text-xs text-muted mt-1">
                {submission.status === 'ACKNOWLEDGED'
                  ? 'ACKNOWLEDGED is terminal — no further transitions allowed.'
                  : 'No transitions available from this status.'}
              </p>
            )}
          </div>

          {/* Reference number (always editable) */}
          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              IRAS / CPF reference number {requiresRef && <span className="text-ink">*</span>}
            </label>
            <input
              type="text"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="e.g. CPF-2026-12345"
              className="border border-rule px-2 py-1 text-sm w-full font-mono"
            />
            {requiresRef && <p className="text-xs text-muted mt-1">Required when marking SUBMITTED.</p>}
          </div>

          {/* Rejection reason */}
          {requiresReason && (
            <div>
              <label className="block text-xs font-medium text-ink mb-1">
                Rejection reason <span className="text-ink">*</span>
              </label>
              <textarea
                rows={3}
                value={rejectedReason}
                onChange={(e) => setRejectedReason(e.target.value)}
                placeholder="Why did IRAS / CPF reject the filing?"
                className="border border-rule px-2 py-1 text-sm w-full"
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="border border-rule px-2 py-1 text-sm w-full"
            />
          </div>

          {/* Submission metadata */}
          <details className="bg-page px-3 py-2 text-xs text-ink">
            <summary className="cursor-pointer text-ink font-medium">Submission metadata</summary>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
              <dt>Deadline</dt><dd className="font-mono">{fmtDate(submission.deadline)}</dd>
              <dt>Submitted</dt><dd className="font-mono">{fmtDate(submission.submittedAt)}</dd>
              <dt>Acknowledged</dt><dd className="font-mono">{fmtDate(submission.acknowledgedAt)}</dd>
              {submission.rejectedAt && (
                <>
                  <dt>Rejected</dt><dd className="font-mono">{fmtDate(submission.rejectedAt)}</dd>
                  <dt>Reason</dt><dd>{submission.rejectedReason ?? '—'}</dd>
                </>
              )}
              {submission.fileHash && (
                <>
                  <dt>File hash</dt><dd className="font-mono break-all">{submission.fileHash}</dd>
                </>
              )}
            </dl>
          </details>
        </div>
        <div className="px-5 py-3 border-t border-rule flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-ink hover:bg-page"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (requiresRef && !referenceNumber.trim()) || (requiresReason && !rejectedReason.trim())}
            className="px-3 py-1.5 text-sm bg-accent text-paper hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Create modal ────────────────────────────────────────────────────────────

interface CreateProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateSubmissionModal({ onClose, onCreated }: CreateProps) {
  const [kind, setKind] = useState<Kind>('CPF_E_SUBMIT');
  const [period, setPeriod] = useState<string>('');
  const [year, setYear]     = useState<string>(String(new Date().getUTCFullYear()));
  const [employeeId, setEmployeeId] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const needsPeriod    = kind === 'CPF_E_SUBMIT';
  const needsYear      = kind === 'IR8A' || kind === 'APPENDIX_8A' || kind === 'APPENDIX_8B';
  const needsEmployee  = kind === 'IR21';

  async function handleCreate() {
    setError(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = { kind };
      if (needsPeriod)   body.period = period;
      if (needsYear)     body.year   = Number(year);
      if (needsEmployee) body.employeeId = employeeId;
      if (fileName) body.fileName = fileName;
      if (notes)    body.notes    = notes;
      await apiFetch('/payroll/iras-submissions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-shadow flex items-center justify-center z-50 p-4">
      <div className="bg-paper max-w-lg w-full">
        <div className="px-5 py-4 border-b border-rule flex items-start justify-between">
          <h2 className="text-lg font-semibold text-ink">New IRAS / CPF submission</h2>
          <button onClick={onClose} className="text-muted hover:text-ink text-lg">×</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {error && (
            <div className="bg-page border border-ink text-ink px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-ink mb-1">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              className="border border-rule px-2 py-1 text-sm w-full"
            >
              {KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </div>

          {needsPeriod && (
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Period (YYYY-MM) <span className="text-ink">*</span></label>
              <input
                type="text" placeholder="2026-05"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="border border-rule px-2 py-1 text-sm w-full"
              />
            </div>
          )}
          {needsYear && (
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Income year <span className="text-ink">*</span></label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="border border-rule px-2 py-1 text-sm w-full"
              />
            </div>
          )}
          {needsEmployee && (
            <div>
              <label className="block text-xs font-medium text-ink mb-1">Employee ID <span className="text-ink">*</span></label>
              <input
                type="text"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="border border-rule px-2 py-1 text-sm w-full font-mono"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-ink mb-1">File name (optional)</label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="border border-rule px-2 py-1 text-sm w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="border border-rule px-2 py-1 text-sm w-full"
            />
          </div>

          <p className="text-xs text-muted">
            Tip: generating a CPF or IR8A file from the Payroll page auto-creates a DRAFT row here —
            you only need this dialog for manual entries (e.g. amendments).
          </p>
        </div>
        <div className="px-5 py-3 border-t border-rule flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-ink hover:bg-page">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || (needsPeriod && !period) || (needsYear && !year) || (needsEmployee && !employeeId)}
            className="px-3 py-1.5 text-sm bg-accent text-paper hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Creating…' : 'Create DRAFT'}
          </button>
        </div>
      </div>
    </div>
  );
}
