'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { PageHeader, DataTable, Tabs, Badge, Button, Stat, Modal, Field, Input, Select, Textarea, EmptyState, Icon } from '@/components/ui';
import type { BadgeTone, Column } from '@/components/ui';

interface HrCase {
  id: string;
  caseNumber: string;
  type: 'DISCIPLINARY' | 'GRIEVANCE';
  status: string;
  severity: string;
  subjectEmployeeId: string;
  subjectEmployeeName: string;
  subjectDepartment: string | null;
  respondentName: string | null;
  title: string;
  summary: string;
  category: string | null;
  isTafepReportable: boolean;
  isUnionised: boolean;
  currentStage: string;
  escalationLevel: string;
  openedAt: string;
  closedAt: string | null;
  resolvedAt: string | null;
  dueDate: string | null;
  escalation?: { shouldEscalate: boolean; daysOpen: number; slaDays: number; nextLevel: string | null };
  progress?: { stage: string; percent: number };
}

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];

const SEVERITIES = ['MINOR', 'MODERATE', 'SERIOUS', 'GROSS_MISCONDUCT'];

/**
 * Six statuses, five appearances. The only shared one is neutral, for the two
 * settled end states; withdrawn is also struck through (see STRUCK) so it
 * never reads as closed-with-an-outcome.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  OPEN:                'accent',
  UNDER_INVESTIGATION: 'danger',
  PENDING_DECISION:    'warn',
  RESOLVED:            'ok',
  CLOSED:              'neutral',
  WITHDRAWN:           'neutral',
};
const STRUCK = new Set(['WITHDRAWN']);

/**
 * Disciplinary severity, escalating — four levels, four appearances. On a
 * disciplinary register this is the most consequential column there is, so
 * no two severities may look alike.
 */
const SEVERITY_TONE: Record<string, BadgeTone> = {
  MINOR:            'neutral',
  MODERATE:         'accent',
  SERIOUS:          'warn',
  GROSS_MISCONDUCT: 'danger',
};

const TYPE_LABEL: Record<string, string> = {
  DISCIPLINARY: 'Disciplinary',
  GRIEVANCE:    'Grievance',
};

/** GROSS_MISCONDUCT → "Gross misconduct"; HR stays HR. */
const sentence = (raw: string) => {
  const words = String(raw || '').split('_').map(w => (w === 'HR' || w === 'MOM' ? w : w.toLowerCase()));
  const first = words[0] ?? '';
  words[0] = /^[A-Z]+$/.test(first) ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(' ');
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-SG');

function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'} className={STRUCK.has(status) ? 'line-through' : ''}>{sentence(status)}</Badge>;
}

export default function HrCasesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const role = (user?.role || '').toUpperCase();
  const isHr = HR_ROLES.includes(role);

  const [cases, setCases] = useState<HrCase[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showFileModal, setShowFileModal] = useState(false);
  const [tab, setTab] = useState<'all' | 'open' | 'overdue'>('all');
  const [filterType, setFilterType] = useState<string>('');
  const [filterSeverity, setFilterSeverity] = useState<string>('');

  async function loadData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType)     params.set('type', filterType);
      if (filterSeverity) params.set('severity', filterSeverity);
      const [listRes, dashRes] = await Promise.all([
        apiFetchRaw(`/hr-cases${params.toString() ? `?${params}` : ''}`).then(r => r.json()),
        isHr ? apiFetchRaw('/hr-cases/dashboard').then(r => r.json()) : Promise.resolve(null),
      ]);
      setCases(listRes.cases || []);
      setDashboard(dashRes);
    } catch (err) {
      console.error('[hr-cases] load failed', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) loadData(); }, [user, isHr, filterType, filterSeverity]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-9 h-9 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading cases" />
      </div>
    );
  }

  const isOpen = (c: HrCase) => ['OPEN','UNDER_INVESTIGATION','PENDING_DECISION'].includes(c.status);
  const filteredCases = cases.filter(c => {
    if (tab === 'open')    return isOpen(c);
    if (tab === 'overdue') return c.escalation?.shouldEscalate;
    return true;
  });

  const summary = dashboard?.summary || {};
  const overdue: any[] = dashboard?.overdueEscalation || [];
  const filtered = !!(filterType || filterSeverity);

  const columns: Column<HrCase>[] = [
    {
      key: 'case', label: 'Case', width: 'minmax(0, 2fr)',
      render: c => (
        <div className="flex flex-col min-w-0 gap-0.5">
          <span className="font-semibold text-ink truncate">{c.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted min-w-0">
            <span className="tabular-nums shrink-0">{c.caseNumber}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{TYPE_LABEL[c.type] ?? sentence(c.type)}</span>
            {c.isTafepReportable && <><span aria-hidden="true">·</span><span className="font-semibold text-ink shrink-0">TAFEP</span></>}
          </span>
        </div>
      ),
    },
    {
      key: 'subject', label: 'Subject', width: 'minmax(0, 1.2fr)',
      render: c => (
        <div className="flex flex-col min-w-0">
          <span className="text-ink truncate">{c.subjectEmployeeName}</span>
          {c.subjectDepartment && <span className="text-xs text-muted truncate">{c.subjectDepartment}</span>}
        </div>
      ),
    },
    { key: 'severity', label: 'Severity', width: '150px', render: c => <Badge tone={SEVERITY_TONE[c.severity] ?? 'neutral'}>{sentence(c.severity)}</Badge> },
    { key: 'status', label: 'Status', width: '170px', render: c => <StatusBadge status={c.status} /> },
    {
      key: 'stage', label: 'Stage', width: '140px',
      render: c => (
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[13px] text-ink truncate">{sentence(c.currentStage)}</span>
          {c.progress && (
            <div className="w-full h-1.5 rounded-full bg-pill overflow-hidden" role="progressbar" aria-valuenow={c.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Case progress">
              <div className="h-full rounded-full bg-accent" style={{ width: `${c.progress.percent}%` }} />
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'opened', label: 'Opened', width: '130px', numeric: true,
      render: c => (
        <div className="flex flex-col">
          <span>{fmt(c.openedAt)}</span>
          {c.escalation && (
            <span className={`text-xs ${c.escalation.shouldEscalate ? 'font-semibold text-danger' : 'text-muted'}`}>
              {c.escalation.shouldEscalate && <Icon name="alert" size={12} className="inline -mt-0.5 mr-1" />}
              {c.escalation.daysOpen}d of {c.escalation.slaDays}d SLA
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={isHr ? 'HR cases' : 'My cases'}
        subtitle={isHr ? 'Disciplinary cases, grievances and investigations.' : 'Grievances you have filed and cases about you.'}
        actions={<Button icon="plus" onClick={() => setShowFileModal(true)}>{isHr ? 'Open case' : 'File a grievance'}</Button>}
      />

      {isHr && dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <Stat label="Total"          value={summary.total || 0} />
          <Stat label="Open"           value={summary.open || 0} />
          <Stat label="Past SLA"       value={summary.overdueEscalation || 0} note={summary.overdueEscalation ? 'need escalating' : 'none overdue'} />
          <Stat label="Resolved"       value={summary.resolved || 0} />
          <Stat label="MOM reportable" value={summary.momReportable || 0} />
        </div>
      )}

      {isHr && overdue.length > 0 && (
        <div role="status" className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-control bg-danger-bg">
          <Icon name="alert" size={18} className="text-danger shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink">
              {overdue.length} case{overdue.length > 1 ? 's' : ''} past SLA
            </p>
            <p className="text-[13px] text-muted mt-0.5 tabular-nums">
              {overdue.slice(0, 3).map((c: any) => c.caseNumber).join(', ')}
              {overdue.length > 3 && ` and ${overdue.length - 3} more`}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setTab('overdue')}>Show them</Button>
        </div>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <Tabs
          items={[
            { id: 'all', label: 'All', count: cases.length },
            { id: 'open', label: 'Open', count: cases.filter(isOpen).length },
            { id: 'overdue', label: 'Past SLA', count: cases.filter(c => c.escalation?.shouldEscalate).length },
          ]}
          active={tab}
          onChange={setTab}
          className="lg:flex-1"
        />
        <div className="grid grid-cols-2 gap-2.5 lg:w-[420px]">
          <Select aria-label="Filter by type" value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">All types</option>
            <option value="DISCIPLINARY">Disciplinary</option>
            <option value="GRIEVANCE">Grievance</option>
          </Select>
          <Select aria-label="Filter by severity" value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
            <option value="">All severities</option>
            {SEVERITIES.map(s => <option key={s} value={s}>{sentence(s)}</option>)}
          </Select>
        </div>
      </div>

      <DataTable
        aria-label="HR cases"
        columns={columns}
        rows={filteredCases}
        rowKey={c => c.id}
        rowHeight={64}
        onRowClick={c => router.push(`/hr-cases/${c.id}`)}
        mobileCard={c => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{c.title}</p>
                <p className="text-xs text-muted tabular-nums">{c.caseNumber} · {TYPE_LABEL[c.type] ?? sentence(c.type)}</p>
              </div>
              <StatusBadge status={c.status} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <Badge tone={SEVERITY_TONE[c.severity] ?? 'neutral'}>{sentence(c.severity)}</Badge>
              {c.isTafepReportable && <Badge tone="neutral">TAFEP</Badge>}
              {c.escalation?.shouldEscalate && <Badge tone="danger">Past SLA</Badge>}
              <span>{c.subjectEmployeeName}</span>
              <span className="tabular-nums">Opened {fmt(c.openedAt)}</span>
            </div>
          </div>
        )}
        empty={
          <EmptyState
            icon="shield"
            title={tab === 'overdue' ? 'Nothing past SLA' : filtered ? 'No cases match these filters' : 'No cases in this view'}
            description={tab === 'overdue' ? 'Every open case is inside its SLA.' : filtered ? 'Clear a filter to see more.' : isHr ? 'Cases you open, and grievances employees file, appear here.' : 'If something at work needs HR’s attention, you can file a grievance.'}
          />
        }
      />

      {showFileModal && (
        <FileCaseModal
          isHr={isHr}
          onClose={() => setShowFileModal(false)}
          onSuccess={() => { setShowFileModal(false); loadData(); }}
        />
      )}
    </div>
  );
}

// ─── File Case Modal ─────────────────────────────────────────────────────────
function FileCaseModal({ isHr, onClose, onSuccess }: { isHr: boolean; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    type: isHr ? 'DISCIPLINARY' : 'GRIEVANCE',
    title: '',
    summary: '',
    severity: 'MINOR',
    subjectEmployeeId: '',
    subjectEmployeeName: '',
    respondentName: '',
    category: '',
    isUnionised: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const res = await apiFetchRaw('/hr-cases', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  const missing = !form.title.trim() || !form.summary.trim();

  return (
    <Modal
      open
      onClose={onClose}
      title={isHr ? 'Open a new case' : 'File a grievance'}
      caption={!isHr ? 'Your grievance will be handled confidentially by HR.' : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || missing} reason={!saving && missing ? 'Add a title and a summary' : undefined}>
            {saving ? 'Filing…' : 'Submit'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {isHr && (
          <Field label="Case type" required>
            <Select value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
              <option value="DISCIPLINARY">Disciplinary</option>
              <option value="GRIEVANCE">Grievance</option>
            </Select>
          </Field>
        )}
        <Field label="Title" required>
          <Input value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="A short title for this case" />
        </Field>
        <Field label="Summary" required>
          <Textarea rows={4} value={form.summary} onChange={e => setForm({...form, summary: e.target.value})} placeholder="What happened, when, and any context" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Severity" required>
            <Select value={form.severity} onChange={e => setForm({...form, severity: e.target.value})}>
              {SEVERITIES.map(s => <option key={s} value={s}>{sentence(s)}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
              <option value="">Not set</option>
              <option value="misconduct">Misconduct</option>
              <option value="harassment">Harassment</option>
              <option value="discrimination">Discrimination</option>
              <option value="attendance">Attendance</option>
              <option value="performance">Performance</option>
              <option value="workplace_bullying">Workplace bullying</option>
              <option value="policy_violation">Policy violation</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>
        {isHr && form.type === 'DISCIPLINARY' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Subject employee ID" required>
              <Input value={form.subjectEmployeeId} onChange={e => setForm({...form, subjectEmployeeId: e.target.value})} />
            </Field>
            <Field label="Subject employee name" required>
              <Input value={form.subjectEmployeeName} onChange={e => setForm({...form, subjectEmployeeName: e.target.value})} />
            </Field>
          </div>
        )}
        {form.type === 'GRIEVANCE' && (
          <Field label="Respondent" help="The person the grievance is about, if there is one.">
            <Input value={form.respondentName} onChange={e => setForm({...form, respondentName: e.target.value})} />
          </Field>
        )}
        <label className="flex items-center gap-2.5 text-sm text-ink cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-accent" checked={form.isUnionised} onChange={e => setForm({...form, isUnionised: e.target.checked})} />
          The subject is a union member
        </label>
        {form.category === 'discrimination' && (
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-control bg-warn-bg text-[13px] text-ink">
            <Icon name="alert" size={16} className="text-warn mt-px" />
            <p>Discrimination cases are flagged for TAFEP referral automatically.</p>
          </div>
        )}
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
