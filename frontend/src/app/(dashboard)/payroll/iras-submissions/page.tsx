'use client';

/**
 * PAY-007 — IRAS / CPF submission tracking
 *
 * Lists every monthly CPF e-Submit, annual IR8A / Appendix 8A / Appendix 8B,
 * and per-employee IR21 filing. Records the IRAS / CPF Board reference number
 * on submission, walks the status machine DRAFT → SUBMITTED → ACKNOWLEDGED /
 * REJECTED, and surfaces a deadline dashboard with urgency banding.
 *
 * Rebuilt to the "Clean workspace" kit (2026-09). Presentation only — every
 * fetch, filter and status transition below is unchanged. The Seal citations
 * stay: a missed filing here is a penalty, and the authority (ITA s.68, CPF
 * Act s.7) belongs beside the date.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { Seal } from '@/components/official';
import { PageHeader, Card, DataTable, Button, Field, Input, Select, Textarea, Modal, EmptyState, Icon } from '@/components/ui';

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
  CPF_E_SUBMIT: 'CPF e-Submit (monthly)',
  IR8A: 'IR8A (annual)',
  APPENDIX_8A: 'Appendix 8A (BIK)',
  APPENDIX_8B: 'Appendix 8B (ESOP)',
  IR21: 'IR21 (tax clearance)',
};

/**
 * The authority behind each deadline. A missed filing here is a penalty, and
 * the rule differs per row — CPF is monthly, IR8A annual, IR21 keyed to the
 * employee's last day — so the citation sits beside the date on the screen.
 */
const KIND_CITATIONS: Record<Kind, string> = {
  CPF_E_SUBMIT: 'CPF Act s.7 · by 14th of following month',
  IR8A:         'ITA s.68(2) · by 1 Mar',
  APPENDIX_8A:  'ITA s.68(2) · with IR8A, by 1 Mar',
  APPENDIX_8B:  'ITA s.68(2) · with IR8A, by 1 Mar',
  IR21:         'ITA s.68(6) · 1 month before cessation',
};

/**
 * Status and urgency are distinguished by weight and fill, not by hue — the
 * Official Record palette has no error red or success green to spend (seal red
 * is reserved). The states that need action are filled and heaviest; settled
 * ones are outlined; inert ones recede. The word is always present.
 */
const STATUS_TONE: Record<Status, string> = {
  DRAFT:        'bg-pill text-muted',
  SUBMITTED:    'bg-paper text-ink border border-ink',
  ACKNOWLEDGED: 'bg-tint text-accent',
  REJECTED:     'bg-ink text-paper',
};
const URGENCY_TONE: Record<string, string> = {
  OVERDUE:     'bg-ink text-paper',
  CRITICAL:    'bg-highlight text-ink',
  WARNING:     'bg-paper text-ink border border-highlight',
  NOTICE:      'bg-pill text-muted',
  OK:          'bg-tint text-accent',
  UNSCHEDULED: 'bg-pill text-muted',
};
const URGENCY_LABEL: Record<string, string> = {
  OVERDUE: 'Overdue', CRITICAL: 'Critical', WARNING: 'Warning', NOTICE: 'Notice', OK: 'On track', UNSCHEDULED: 'Unscheduled',
};
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function Chip({ label, cls }: { label: string; cls: string }) {
  return <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs whitespace-nowrap ${cls}`}>{label}</span>;
}

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

  const [kindFilter,   setKindFilter]   = useState<Kind | ''>('');
  const [statusFilter, setStatusFilter] = useState<Status | ''>('');
  const [periodFilter, setPeriodFilter] = useState<string>('');
  const [yearFilter,   setYearFilter]   = useState<string>('');

  const [list,      setList]      = useState<ListResponse | null>(null);
  const [deadlines, setDeadlines] = useState<ListResponse | null>(null);
  const [loading,   setLoading]   = useState<boolean>(true);
  const [error,     setError]     = useState<string | null>(null);

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
    <div className="max-w-7xl mx-auto flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-muted">
          <Link href="/payroll" className="hover:text-ink">Payroll</Link>
          <span className="mx-1" aria-hidden>·</span>
          <span>IRAS submissions</span>
        </p>
        <PageHeader
          title="IRAS / CPF submission tracking"
          subtitle="Every CPF e-Submit, annual IR8A / Appendix 8A / 8B and per-employee IR21. Capture the IRAS / CPF Board reference when submitted, then mark acknowledged on confirmation."
          actions={isAdmin ? <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New submission</Button> : undefined}
        />
      </div>

      {/* Deadline band */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {URGENCIES.map(u => {
          const n = dlSummary?.byUrgency?.[u] ?? 0;
          return (
            <Card key={u} padding="px-4 py-4">
              <Chip label={URGENCY_LABEL[u]} cls={URGENCY_TONE[u]} />
              <div className="text-[28px] font-extrabold tracking-[-0.02em] text-ink mt-2 tabular-nums">{n}</div>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <Field label="Kind" className="w-56">
          <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as Kind | '')}>
            <option value="">All kinds</option>
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </Select>
        </Field>
        <Field label="Status" className="w-44">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Status | '')}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{sentence(s)}</option>)}
          </Select>
        </Field>
        <Field label="Period (YYYY-MM)" className="w-36">
          <Input type="text" placeholder="2026-05" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} />
        </Field>
        <Field label="Year" className="w-28">
          <Input type="number" placeholder="2026" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} />
        </Field>
        <Button variant="ghost" onClick={() => { setKindFilter(''); setStatusFilter(''); setPeriodFilter(''); setYearFilter(''); }}>Clear</Button>
        {summary && (
          <div className="ml-auto text-[13px] text-muted tabular-nums self-center">
            {list?.total ?? 0} total · {summary.byStatus?.DRAFT ?? 0} draft · {summary.byStatus?.SUBMITTED ?? 0} submitted · {summary.byStatus?.ACKNOWLEDGED ?? 0} acknowledged
            {summary.byStatus?.REJECTED ? ` · ${summary.byStatus.REJECTED} rejected` : ''}
          </div>
        )}
      </div>

      {error && (
        <Card><p className="text-sm text-danger font-semibold">{error}</p></Card>
      )}

      {/* Submissions */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted">Loading…</div>
      ) : (list?.submissions?.length ?? 0) === 0 ? (
        <EmptyState
          icon="receipt"
          title="No submissions match the current filters"
          description="Generating a CPF or IR8A file from the Payroll page auto-creates a draft row here."
        />
      ) : (
        <DataTable<Submission>
          aria-label="IRAS submissions"
          columns={[
            { key: 'kind', label: 'Kind', width: 'minmax(0, 1.6fr)', render: (s) => <span className="font-semibold text-ink">{KIND_LABELS[s.kind]}</span> },
            { key: 'scope', label: 'Scope', render: (s) => <span className="tabular-nums">{fmtScope(s)}</span> },
            { key: 'status', label: 'Status', width: '132px', render: (s) => <Chip label={sentence(s.status)} cls={STATUS_TONE[s.status]} /> },
            { key: 'deadline', label: 'Deadline', width: 'minmax(0, 1.4fr)', render: (s) => (
              <span className="flex flex-col gap-0.5">
                <span className="tabular-nums">{fmtDate(s.deadline)}</span>
                <Seal cite={KIND_CITATIONS[s.kind]} />
              </span>
            ) },
            { key: 'urgency', label: 'Urgency', width: '150px', render: (s) => (
              <Chip label={`${URGENCY_LABEL[s.urgency] ?? sentence(String(s.urgency))}${s.daysUntilDeadline != null ? ` · ${s.daysUntilDeadline}d` : ''}`} cls={URGENCY_TONE[s.urgency] ?? 'bg-pill text-muted'} />
            ) },
            { key: 'ref', label: 'Reference', render: (s) => <span className="tabular-nums">{s.referenceNumber ?? '—'}</span> },
            { key: 'file', label: 'File', render: (s) => s.fileName
              ? <span className="flex flex-col gap-0.5"><span className="truncate">{s.fileName}</span><span className="text-[12.5px] text-muted tabular-nums">{fmtBytes(s.fileSize)}{s.fileHash ? ` · ${s.fileHash.slice(0, 8)}…` : ''}</span></span>
              : '—' },
            { key: 'action', label: '', width: '104px', align: 'right', render: (s) => (
              isAdmin && s.status !== 'ACKNOWLEDGED'
                ? <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>Manage</Button>
                : null
            ) },
          ]}
          rows={list!.submissions}
          rowKey={(s) => s.id}
          mobileCard={(s) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{KIND_LABELS[s.kind]}</span>
                <Chip label={sentence(s.status)} cls={STATUS_TONE[s.status]} />
              </div>
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <span className="tabular-nums">{fmtScope(s)}</span>
                <Chip label={URGENCY_LABEL[s.urgency] ?? sentence(String(s.urgency))} cls={URGENCY_TONE[s.urgency] ?? 'bg-pill text-muted'} />
              </div>
              <div className="flex items-center gap-1.5 text-[13px] text-muted">
                <span className="tabular-nums">{fmtDate(s.deadline)}</span><Seal cite={KIND_CITATIONS[s.kind]} />
              </div>
              {isAdmin && s.status !== 'ACKNOWLEDGED' && <Button variant="secondary" size="sm" className="mt-1 w-fit" onClick={() => setEditing(s)}>Manage</Button>}
            </div>
          )}
        />
      )}

      {editing && (
        <ManageSubmissionModal submission={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      )}
      {creating && (
        <CreateSubmissionModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />
      )}
    </div>
  );
}

// ─── Manage modal ────────────────────────────────────────────────────────────

function ManageSubmissionModal({ submission, onClose, onSaved }: { submission: Submission; onClose: () => void; onSaved: () => void }) {
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

  const disabled = saving || (requiresRef && !referenceNumber.trim()) || (requiresReason && !rejectedReason.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title="Manage submission"
      caption={`${KIND_LABELS[submission.kind]} · ${fmtScope(submission)} · currently ${sentence(submission.status)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={disabled}
            reason={disabled && !saving ? (requiresRef ? 'Reference number required to mark submitted' : requiresReason ? 'Rejection reason required' : undefined) : undefined}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}

        <Field label="Transition to" help={allowed.length === 0 ? (submission.status === 'ACKNOWLEDGED' ? 'Acknowledged is terminal — no further transitions.' : 'No transitions available from this status.') : undefined}>
          <Select value={targetStatus} onChange={(e) => setTargetStatus(e.target.value as Status | '')} disabled={allowed.length === 0}>
            <option value="">No status change</option>
            {allowed.map(s => <option key={s} value={s}>{sentence(s)}</option>)}
          </Select>
        </Field>

        <Field label="IRAS / CPF reference number" required={requiresRef} help={requiresRef ? 'Required when marking submitted.' : undefined}>
          <Input type="text" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="e.g. CPF-2026-12345" />
        </Field>

        {requiresReason && (
          <Field label="Rejection reason" required>
            <Textarea rows={3} value={rejectedReason} onChange={(e) => setRejectedReason(e.target.value)} placeholder="Why did IRAS / CPF reject the filing?" />
          </Field>
        )}

        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <details className="rounded-control bg-page border border-rule px-3 py-2 text-[13px] text-ink">
          <summary className="cursor-pointer font-semibold">Submission metadata</summary>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
            <dt className="text-muted">Deadline</dt><dd className="tabular-nums">{fmtDate(submission.deadline)}</dd>
            <dt className="text-muted">Submitted</dt><dd className="tabular-nums">{fmtDate(submission.submittedAt)}</dd>
            <dt className="text-muted">Acknowledged</dt><dd className="tabular-nums">{fmtDate(submission.acknowledgedAt)}</dd>
            {submission.rejectedAt && (
              <>
                <dt className="text-muted">Rejected</dt><dd className="tabular-nums">{fmtDate(submission.rejectedAt)}</dd>
                <dt className="text-muted">Reason</dt><dd>{submission.rejectedReason ?? '—'}</dd>
              </>
            )}
            {submission.fileHash && (
              <><dt className="text-muted">File hash</dt><dd className="tabular-nums break-all">{submission.fileHash}</dd></>
            )}
          </dl>
        </details>
      </div>
    </Modal>
  );
}

// ─── Create modal ────────────────────────────────────────────────────────────

function CreateSubmissionModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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

  const disabled = saving || (needsPeriod && !period) || (needsYear && !year) || (needsEmployee && !employeeId);

  return (
    <Modal
      open
      onClose={onClose}
      title="New IRAS / CPF submission"
      caption="Most rows are auto-created when you generate a CPF or IR8A file from the Payroll page; use this for manual entries such as amendments."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleCreate} disabled={disabled}
            reason={disabled && !saving ? 'Fill in the required scope field' : undefined}>
            {saving ? 'Creating…' : 'Create draft'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <p className="text-sm text-danger font-semibold">{error}</p>}

        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </Select>
        </Field>

        {needsPeriod && (
          <Field label="Period (YYYY-MM)" required>
            <Input type="text" placeholder="2026-05" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
        )}
        {needsYear && (
          <Field label="Income year" required>
            <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
          </Field>
        )}
        {needsEmployee && (
          <Field label="Employee ID" required>
            <Input type="text" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
          </Field>
        )}

        <Field label="File name (optional)">
          <Input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
