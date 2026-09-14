'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetchRaw } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import {
  Badge, Button, DataTable, EmptyState, Field, Input, Modal, PageHeader, Select, Stat, Tabs, Textarea, type Column,
} from '@/components/ui';
import { Notice, PageLoading } from '@/components/employee/RecordParts';

interface Movement {
  id: string;
  movementNumber: string;
  employeeId: string;
  employeeName: string;
  type: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'APPLIED';
  fromDepartment: string;
  toDepartment: string;
  fromDesignation: string;
  toDesignation: string;
  fromCostCentre: string | null;
  toCostCentre: string | null;
  hasSalaryRevision: boolean;
  reason: string;
  effectiveDate: string;
  initiatedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
}

const HR_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'];

const MOVEMENT_TYPES = [
  'DEPARTMENT_TRANSFER', 'LOCATION_TRANSFER', 'INTER_COMPANY_TRANSFER',
  'ROLE_CHANGE', 'PROMOTION', 'REPORTING_CHANGE', 'COST_CENTRE_REALLOC',
];

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

type TabId = 'all' | 'pending' | 'upcoming' | 'history';
const TAB_LABEL: Record<TabId, string> = { all: 'All', pending: 'Pending', upcoming: 'Upcoming', history: 'History' };
const TAB_EMPTY: Record<TabId, string> = {
  all: 'Transfers, role changes and promotions will be listed here once one is raised.',
  pending: 'Nothing is waiting for approval.',
  upcoming: 'No approved movements take effect in the future.',
  history: 'Applied, rejected and cancelled movements will be listed here.',
};

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });

/** The one line that says what actually moves. */
function changeSummary(m: Movement) {
  if (m.fromDepartment !== m.toDepartment) return `${m.fromDepartment || '—'} → ${m.toDepartment || '—'}`;
  if (m.fromDesignation !== m.toDesignation) return `${m.fromDesignation || '—'} → ${m.toDesignation || '—'}`;
  if ((m.fromCostCentre || '') !== (m.toCostCentre || '')) return `Cost centre ${m.fromCostCentre || '—'} → ${m.toCostCentre || '—'}`;
  return '—';
}

export default function MovementsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const role = (user?.role || '').toUpperCase();
  const isHr = HR_ROLES.includes(role);

  const [movements, setMovements] = useState<Movement[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'pending' | 'upcoming' | 'history'>('all');
  const [showInitiateModal, setShowInitiateModal] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await apiFetchRaw('/movements').then(r => r.json());
      setMovements(res.movements || []);
      setSummary(res.summary);
    } catch (err) {
      console.error('[movements] load failed', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (user) loadData(); }, [user]);

  if (loading) return <PageLoading label="Loading movements…" />;

  const now = new Date();
  const inTab = (m: Movement, t: TabId) => {
    if (t === 'pending')  return m.status === 'PENDING';
    if (t === 'upcoming') return m.status === 'APPROVED' && new Date(m.effectiveDate) > now;
    if (t === 'history')  return ['APPLIED', 'REJECTED', 'CANCELLED'].includes(m.status);
    return true;
  };
  const filteredMovements = movements.filter(m => inTab(m, tab));

  const columns: Column<Movement>[] = [
    {
      key: 'employee', label: 'Employee', width: 'minmax(0, 1.5fr)',
      render: m => (
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-ink truncate">{m.employeeName}</span>
          <span className="text-xs text-muted tabular-nums">{m.movementNumber}</span>
        </div>
      ),
    },
    { key: 'type', label: 'Type', width: 'minmax(0, 1.1fr)', render: m => <span className="text-ink">{TYPE_LABELS[m.type] || m.type}</span> },
    {
      key: 'change', label: 'Change', width: 'minmax(0, 1.6fr)',
      render: m => (
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate text-ink">{changeSummary(m)}</span>
          {m.hasSalaryRevision && <Badge tone="neutral">Salary</Badge>}
        </span>
      ),
    },
    { key: 'effective', label: 'Effective', width: '120px', numeric: true, render: m => fmtDate(m.effectiveDate) },
    { key: 'by', label: 'Raised by', width: 'minmax(0, 0.9fr)', render: m => <span className="text-muted">{m.initiatedByName || '—'}</span> },
    { key: 'status', label: 'Status', width: '110px', render: m => <Badge tone={STATUS_TONE[m.status] ?? 'neutral'}>{STATUS_LABEL[m.status] ?? m.status}</Badge> },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={isHr ? 'Staff movements' : 'My transfers'}
        subtitle="Transfers, role changes and promotions"
        actions={
          <Button icon="plus" onClick={() => setShowInitiateModal(true)}>
            {isHr ? 'New movement' : 'Request transfer'}
          </Button>
        }
      />

      {isHr && summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Stat label="Pending approval" value={summary.pending || 0} />
          <Stat label="Approved" value={summary.approved || 0} />
          <Stat label="Effective today" value={summary.effectiveToday || 0} />
          <Stat label="Next 30 days" value={summary.upcoming30d || 0} />
          <Stat label="Applied this year" value={summary.applied || 0} />
        </div>
      )}

      <Tabs<TabId>
        items={(['all', 'pending', 'upcoming', 'history'] as const).map(t => ({ id: t, label: TAB_LABEL[t], count: movements.filter(m => inTab(m, t)).length }))}
        active={tab}
        onChange={setTab}
      />

      <DataTable
        aria-label="Movements"
        columns={columns}
        rows={filteredMovements}
        rowKey={m => m.id}
        onRowClick={m => router.push(`/movements/${m.id}`)}
        mobileCard={m => (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold text-ink">{m.employeeName}</span>
              <Badge tone={STATUS_TONE[m.status] ?? 'neutral'}>{STATUS_LABEL[m.status] ?? m.status}</Badge>
            </div>
            <span className="text-[13px] text-ink">{TYPE_LABELS[m.type] || m.type} · {changeSummary(m)}</span>
            <span className="text-xs text-muted tabular-nums">{m.movementNumber} · effective {fmtDate(m.effectiveDate)}{m.hasSalaryRevision ? ' · salary revision' : ''}</span>
          </div>
        )}
        empty={<EmptyState icon="arrowRight" title="No movements in this view" description={TAB_EMPTY[tab]} />}
        footer={<span className="tabular-nums">{filteredMovements.length} of {movements.length} movements</span>}
      />

      {showInitiateModal && (
        <InitiateModal
          isHr={isHr}
          defaultEmployeeId={!isHr ? (user?.employeeId || user?.id || '') : ''}
          onClose={() => setShowInitiateModal(false)}
          onSuccess={() => { setShowInitiateModal(false); loadData(); }}
        />
      )}
    </div>
  );
}

// ─── Initiate Modal ──────────────────────────────────────────────────────────
function InitiateModal({ isHr, defaultEmployeeId, onClose, onSuccess }: { isHr: boolean; defaultEmployeeId: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    employeeId: defaultEmployeeId,
    type: 'DEPARTMENT_TRANSFER',
    toDepartment: '',
    toDesignation: '',
    toCostCentre: '',
    toLocation: '',
    toReportingManagerId: '',
    toCompany: '',
    reason: '',
    effectiveDate: '',
    hasSalaryRevision: false,
    toSalary: '',
    salaryReasonCode: 'ROLE_CHANGE',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true); setError('');
    const body: any = { ...form };
    Object.keys(body).forEach(k => body[k] === '' && delete body[k]);
    if (form.hasSalaryRevision) {
      body.toSalary = parseFloat(form.toSalary);
    } else {
      delete body.toSalary;
      delete body.salaryReasonCode;
    }
    const res = await apiFetchRaw('/movements', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) onSuccess();
    else { const e = await res.json(); setError(e.error || 'Failed'); }
    setSaving(false);
  }

  const showDept = ['DEPARTMENT_TRANSFER'].includes(form.type);
  const showRole = ['ROLE_CHANGE','PROMOTION'].includes(form.type);
  const showCC   = ['COST_CENTRE_REALLOC'].includes(form.type);
  const showLoc  = ['LOCATION_TRANSFER'].includes(form.type);
  const showMgr  = ['REPORTING_CHANGE'].includes(form.type);
  const showCo   = ['INTER_COMPANY_TRANSFER'].includes(form.type);

  const missing = !form.reason.trim() ? 'Add a reason to submit' : !form.effectiveDate ? 'Pick an effective date to submit' : '';

  return (
    <Modal
      open
      onClose={onClose}
      title={isHr ? 'New staff movement' : 'Request a transfer'}
      caption={isHr ? 'Raise a transfer, role change or promotion for approval.' : 'Your request goes to HR for approval.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !form.reason.trim() || !form.effectiveDate} reason={saving ? undefined : missing || undefined}>
            {saving ? 'Submitting…' : 'Submit'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {isHr && (
          <Field label="Employee ID" required help="The employee's system ID">
            <Input value={form.employeeId} onChange={e => setForm({...form, employeeId: e.target.value})} />
          </Field>
        )}
        <Field label="Movement type" required>
          <Select value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
            {MOVEMENT_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>

        {showDept && (
          <Field label="New department" required>
            <Input value={form.toDepartment} onChange={e => setForm({...form, toDepartment: e.target.value})} />
          </Field>
        )}
        {showRole && (
          <Field label="New designation" required>
            <Input value={form.toDesignation} onChange={e => setForm({...form, toDesignation: e.target.value})} />
          </Field>
        )}
        {showCC && (
          <Field label="New cost centre" required>
            <Input value={form.toCostCentre} onChange={e => setForm({...form, toCostCentre: e.target.value})} />
          </Field>
        )}
        {showLoc && (
          <Field label="New location" required>
            <Input value={form.toLocation} onChange={e => setForm({...form, toLocation: e.target.value})} />
          </Field>
        )}
        {showMgr && (
          <Field label="New reporting manager" required help="Their employee ID">
            <Input value={form.toReportingManagerId} onChange={e => setForm({...form, toReportingManagerId: e.target.value})} />
          </Field>
        )}
        {showCo && (
          <Field label="New company" required>
            <Input value={form.toCompany} onChange={e => setForm({...form, toCompany: e.target.value})} />
          </Field>
        )}

        <Field label="Effective date" required>
          <Input type="date" value={form.effectiveDate} onChange={e => setForm({...form, effectiveDate: e.target.value})} />
        </Field>

        <Field label="Reason" required>
          <Textarea rows={3} value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} />
        </Field>

        {isHr && showRole && (
          <>
            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input type="checkbox" className="w-4 h-4 accent-accent" checked={form.hasSalaryRevision} onChange={e => setForm({...form, hasSalaryRevision: e.target.checked})} />
              Include a salary revision
            </label>
            {form.hasSalaryRevision && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="New monthly salary (SGD)" required>
                  <Input type="number" inputMode="decimal" className="tabular-nums" value={form.toSalary} onChange={e => setForm({...form, toSalary: e.target.value})} />
                </Field>
                <Field label="Reason code">
                  <Select value={form.salaryReasonCode} onChange={e => setForm({...form, salaryReasonCode: e.target.value})}>
                    <option value="PROMOTION">Promotion</option>
                    <option value="ROLE_CHANGE">Role change</option>
                    <option value="MARKET_ADJUSTMENT">Market adjustment</option>
                    <option value="OTHER">Other</option>
                  </Select>
                </Field>
              </div>
            )}
          </>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}
