'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import {
  PageHeader, Stat, DataTable, Card, Button, Badge, EmptyState, Field, Input, Select, Textarea, Modal, Tabs,
  SearchInput, Icon, Stepper, SplitPane, useToast,
  type Column, type BadgeTone, type ToastTone,
} from '@/components/ui';

// ── Types ─────────────────────────────────────────────────────────────────────
type CycleType   = 'ANNUAL' | 'MID_YEAR' | 'PROBATION' | 'CUSTOM';
type CyclePhase  = 'GOAL_SETTING' | 'SELF_ASSESSMENT' | 'MANAGER_REVIEW' | 'CALIBRATION' | 'COMPLETED';
type CycleStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED';
type AppraisalStatus = 'PENDING' | 'SELF_SUBMITTED' | 'MANAGER_SUBMITTED' | 'FINALISED';
type GoalStatus   = 'ACTIVE' | 'ACHIEVED' | 'MISSED' | 'CANCELLED';
type GoalCategory = 'PERFORMANCE' | 'DEVELOPMENT' | 'ORGANIZATIONAL';
type PipStatus    = 'ACTIVE' | 'COMPLETED' | 'EXTENDED' | 'TERMINATED';

interface ReviewCycle {
  id: string; name: string; type: CycleType; startDate: string; endDate: string;
  currentPhase: CyclePhase; status: CycleStatus; description?: string;
  _count?: { appraisals: number };
}

interface Appraisal {
  id: string; cycleId: string; employeeId: string; managerId?: string;
  selfScore?: number; managerScore?: number; overallScore?: number;
  selfComments?: string; managerComments?: string; strengths?: string; improvements?: string;
  status: AppraisalStatus;
  cycle?: ReviewCycle;
}

interface Goal {
  id: string; employeeId: string; title: string; description?: string;
  targetDate?: string; progress: number; status: GoalStatus; category: GoalCategory;
  createdAt: string;
}

interface PipRecord {
  id: string; employeeId: string; managerId: string;
  startDate: string; endDate: string; objectives: string;
  progressNotes?: string; status: PipStatus; createdAt: string;
}

interface Summary {
  activeCycles: number; totalAppraisals: number;
  completionRate: number; avgScore: string | null; activePips: number;
}

type Notify = (m: string, tone?: ToastTone) => void;

// ── Helpers ───────────────────────────────────────────────────────────────────
const PHASE_LABELS: Record<CyclePhase, string> = {
  GOAL_SETTING: 'Goal setting', SELF_ASSESSMENT: 'Self-assessment',
  MANAGER_REVIEW: 'Manager review', CALIBRATION: 'Calibration', COMPLETED: 'Completed',
};
const PHASE_ORDER: CyclePhase[] = ['GOAL_SETTING', 'SELF_ASSESSMENT', 'MANAGER_REVIEW', 'CALIBRATION', 'COMPLETED'];

function phaseIndex(p: CyclePhase) { return PHASE_ORDER.indexOf(p); }

function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

const CYCLE_TYPE_LABEL: Record<CycleType, string> = { ANNUAL: 'Annual', MID_YEAR: 'Mid-year', PROBATION: 'Probation', CUSTOM: 'Custom' };

/** Score bands, named for what they mean; four distinct appearances. */
const SCORE_TONE: Record<string, BadgeTone> = {
  exceeds: 'ok',
  meets:   'accent',
  partial: 'warn',
  below:   'danger',
};

function scoreBadge(score?: number) {
  if (!score) return null;
  const band = score >= 4.5 ? 'exceeds' : score >= 3.5 ? 'meets' : score >= 2.5 ? 'partial' : 'below';
  return <Badge tone={SCORE_TONE[band]} className="tabular-nums">{score.toFixed(1)}</Badge>;
}

const STATUS_TONE: Record<AppraisalStatus, BadgeTone> = {
  PENDING:           'neutral',
  SELF_SUBMITTED:    'warn',
  MANAGER_SUBMITTED: 'accent',
  FINALISED:         'ok',
};
const STATUS_LABEL: Record<AppraisalStatus, string> = {
  PENDING: 'Not started', SELF_SUBMITTED: 'Awaiting manager', MANAGER_SUBMITTED: 'Manager reviewed', FINALISED: 'Finalised',
};

const CYCLE_STATUS_TONE: Record<CycleStatus, BadgeTone> = { DRAFT: 'brass', ACTIVE: 'ok', COMPLETED: 'neutral' };
const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = { DRAFT: 'Draft', ACTIVE: 'Active', COMPLETED: 'Completed' };

const GOAL_STATUS_TONE: Record<GoalStatus, BadgeTone> = {
  ACTIVE:    'accent',
  ACHIEVED:  'ok',
  MISSED:    'danger',
  CANCELLED: 'neutral',
};
const GOAL_CATEGORY_LABEL: Record<GoalCategory, string> = { PERFORMANCE: 'Performance', DEVELOPMENT: 'Development', ORGANIZATIONAL: 'Organisational' };

const PIP_TONE: Record<PipStatus, BadgeTone> = {
  ACTIVE:     'warn',
  COMPLETED:  'ok',
  EXTENDED:   'brass',
  TERMINATED: 'danger',
};

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

function Skeleton({ h = 'h-40' }: { h?: string }) {
  return <div className={`${h} rounded-card bg-pill animate-pulse`} aria-busy="true" />;
}

// ── Star rating: a radiogroup, so it works from the keyboard ─────────────────
function StarRating({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [hovered, setHovered] = useState(0);
  const shown = hovered || value;
  return (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={label} onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} of 5`}
          onMouseEnter={() => setHovered(n)}
          onClick={() => onChange(n)}
          className={`flex items-center justify-center w-10 h-10 rounded-control transition-colors hover:bg-pill ${n <= shown ? 'text-accent' : 'text-faint'}`}>
          <Icon name="star" size={22} fill={n <= shown ? 'currentColor' : 'none'} />
        </button>
      ))}
      <span className="ml-2 text-sm font-semibold text-muted tabular-nums">{value ? `${value} of 5` : 'Not rated'}</span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
type AdminTab    = 'overview' | 'cycles' | 'myappraisal' | 'team' | 'goals' | 'pip';
type EmployeeTab = 'myappraisal' | 'goals';

export default function PerformancePage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();

  const role = user?.role?.toUpperCase() ?? 'EMPLOYEE';
  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'].includes(role);
  const isManager    = role === 'MANAGER' || isPrivileged;
  const isEmployee   = !isPrivileged && !isManager;

  const [adminTab, setAdminTab]       = useState<AdminTab>('overview');
  const [employeeTab, setEmployeeTab] = useState<EmployeeTab>('myappraisal');
  // "My Appraisal" nav links to /performance?view=me — show admins/managers their
  // OWN appraisal; the admin "Performance" nav (no param) keeps the mgmt view.
  const [forceMy, setForceMy] = useState(false);
  useEffect(() => { setForceMy(new URLSearchParams(window.location.search).get('view') === 'me'); }, []);

  // Same messages as before; the tone now says whether each one is a success,
  // a missing field or a failure.
  const notify: Notify = useCallback((msg, tone = 'ok') => toast(msg, tone), [toast]);

  if (loading) {
    return <div className="max-w-[1400px] mx-auto"><Skeleton /></div>;
  }

  // ── Personal "My Appraisal" view (employees always; admins via ?view=me) ────
  if (isEmployee || forceMy) {
    return (
      <div className="flex flex-col gap-6 max-w-[1200px] mx-auto pb-24 lg:pb-10">
        <PageHeader
          title="My performance"
          subtitle={user?.name ? `${user.name.split(' ')[0]}, submit your self-assessment and keep your goals up to date.` : 'Submit your self-assessment and keep your goals up to date.'}
        />
        <Tabs
          items={[{ id: 'myappraisal' as const, label: 'My appraisal' }, { id: 'goals' as const, label: 'My goals' }]}
          active={employeeTab}
          onChange={setEmployeeTab}
        />
        {employeeTab === 'myappraisal' && <MyAppraisalTab notify={notify} />}
        {employeeTab === 'goals'       && <GoalsTab notify={notify} />}
      </div>
    );
  }

  // ── Admin / Manager view ───────────────────────────────────────────────────
  const adminTabs: [AdminTab, string][] = [
    ['overview',    'Overview'],
    ['cycles',      'Cycles'],
    ['myappraisal', 'My appraisal'],
    ['team',        'Team reviews'],
    ['goals',       'Goals'],
    ...(isPrivileged ? [['pip', 'Improvement plans'] as [AdminTab, string]] : []),
  ];

  return (
    <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-24 lg:pb-10">
      <PageHeader title="Performance" subtitle="Appraisal cycles, team reviews, goals and performance improvement plans." />

      <Tabs items={adminTabs.map(([id, label]) => ({ id, label }))} active={adminTab} onChange={setAdminTab} />

      {adminTab === 'overview'    && <OverviewTab notify={notify} />}
      {adminTab === 'cycles'      && <CyclesTab notify={notify} />}
      {adminTab === 'myappraisal' && <MyAppraisalTab notify={notify} />}
      {adminTab === 'team'        && <TeamTab notify={notify} />}
      {adminTab === 'goals'       && <GoalsTab notify={notify} />}
      {adminTab === 'pip'         && <PipTab notify={notify} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ─────────────────────────────────────────────────────────────────────────────
function OverviewTab({ notify }: { notify: Notify }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [cycSort, setCycSort] = useState<{ col: 'name' | 'type' | 'period' | 'phase' | 'enrolled'; dir: 'asc' | 'desc' }>({ col: 'period', dir: 'desc' });

  useEffect(() => {
    apiFetch('/performance/summary').then(setSummary).catch(() => {});
    apiFetch('/performance/cycles?status=ACTIVE').then(setCycles).catch(() => {});
  }, []);

  const sortedCycles = [...cycles].sort((a, b) => {
    const d = cycSort.dir === 'asc' ? 1 : -1;
    switch (cycSort.col) {
      case 'name':     return d * a.name.localeCompare(b.name);
      case 'type':     return d * a.type.localeCompare(b.type);
      case 'period':   return d * a.startDate.localeCompare(b.startDate);
      case 'phase':    return d * (phaseIndex(a.currentPhase) - phaseIndex(b.currentPhase));
      case 'enrolled': return d * ((a._count?.appraisals ?? 0) - (b._count?.appraisals ?? 0));
      default: return 0;
    }
  });
  function toggleCycSort(col: typeof cycSort.col) {
    setCycSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  const head = (col: typeof cycSort.col, label: string, alignEnd = false) => (
    <button type="button" onClick={() => toggleCycSort(col)} aria-sort={cycSort.col === col ? (cycSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={`inline-flex items-center gap-1 hover:text-ink ${alignEnd ? 'justify-end w-full' : ''}`}>
      {label}{cycSort.col === col && <Icon name="chevronDown" size={13} strokeWidth={2.25} className={cycSort.dir === 'asc' ? 'rotate-180' : ''} />}
    </button>
  );

  const pctOf = (c: ReviewCycle) => Math.round((phaseIndex(c.currentPhase) / (PHASE_ORDER.length - 1)) * 100);

  const columns: Column<ReviewCycle>[] = [
    { key: 'name', label: head('name', 'Cycle'), width: 'minmax(0, 1.4fr)', render: c => <span className="font-semibold">{c.name}</span> },
    { key: 'type', label: head('type', 'Type'), width: '110px', render: c => CYCLE_TYPE_LABEL[c.type] || c.type },
    { key: 'period', label: head('period', 'Period'), width: '220px', numeric: true, render: c => `${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}` },
    { key: 'phase', label: head('phase', 'Phase'), width: '150px', render: c => <Badge tone="accent">{PHASE_LABELS[c.currentPhase]}</Badge> },
    {
      key: 'progress', label: 'Progress', width: '170px',
      render: c => (
        <div className="flex items-center gap-2.5">
          <div className="flex-1 h-1.5 rounded-full bg-pill overflow-hidden" role="progressbar" aria-valuenow={pctOf(c)} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-accent" style={{ width: `${pctOf(c)}%` }} />
          </div>
          <span className="text-xs text-muted tabular-nums w-9 text-right">{pctOf(c)}%</span>
        </div>
      ),
    },
    { key: 'enrolled', label: head('enrolled', 'Enrolled', true), width: '90px', align: 'right', numeric: true, render: c => c._count?.appraisals ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {summary ? (
          <>
            <Stat label="Active cycles" value={summary.activeCycles} note="In progress" />
            <Stat label="Average score" value={summary.avgScore ? `${summary.avgScore} / 5.0` : '—'} note="Finalised reviews" />
            <Stat label="Completion rate" value={`${summary.completionRate}%`} note="Self-assessments in" />
            <Stat label="Active improvement plans" value={summary.activePips} note="Employees" />
          </>
        ) : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} h="h-[118px]" />)}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-[15.5px] font-bold text-ink">Active appraisal cycles</h2>
        <DataTable
          aria-label="Active appraisal cycles"
          columns={columns}
          rows={sortedCycles}
          rowKey={c => c.id}
          empty={<EmptyState icon="calendar" title="No active cycles" description="Create and activate a cycle on the Cycles tab." className="py-6" />}
          mobileCard={c => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-ink">{c.name}</span>
                <Badge tone="accent">{PHASE_LABELS[c.currentPhase]}</Badge>
              </div>
              <span className="text-xs text-muted tabular-nums">{CYCLE_TYPE_LABEL[c.type] || c.type} · {fmtDate(c.startDate)} – {fmtDate(c.endDate)} · {c._count?.appraisals ?? 0} enrolled</span>
            </div>
          )}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CYCLES TAB (HR/Admin)
// ─────────────────────────────────────────────────────────────────────────────
interface EmployeeLite {
  id: string; fullName: string; employeeCode: string; department?: string; designation?: string;
}

function CyclesTab({ notify }: { notify: Notify }) {
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'ANNUAL' as CycleType, startDate: '', endDate: '', description: '' });
  const [enrollModal, setEnrollModal] = useState<ReviewCycle | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [allEmployees, setAllEmployees] = useState<EmployeeLite[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [enrollSearch, setEnrollSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try { setCycles(await apiFetch('/performance/cycles')); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openEnrollModal(cycle: ReviewCycle) {
    setEnrollModal(cycle);
    setSelectedIds(new Set());
    setEnrollSearch('');
    if (allEmployees.length === 0) {
      setEmployeesLoading(true);
      try {
        const data = await apiFetch('/employees?limit=500&isActive=true');
        setAllEmployees(data.employees ?? []);
      } catch { notify('Could not load employees', 'danger'); }
      finally { setEmployeesLoading(false); }
    }
  }

  async function createCycle() {
    if (!form.name || !form.startDate || !form.endDate) { notify('Fill all required fields', 'warn'); return; }
    setSaving(true);
    try {
      await apiFetch('/performance/cycles', { method: 'POST', body: JSON.stringify(form) });
      notify('Cycle created'); setShowCreate(false); setForm({ name: '', type: 'ANNUAL', startDate: '', endDate: '', description: '' });
      load();
    } catch (e: any) { notify(e.message || 'Failed', 'danger'); }
    finally { setSaving(false); }
  }

  async function activate(id: string) {
    try { await apiFetch(`/performance/cycles/${id}/activate`, { method: 'POST' }); notify('Cycle activated'); load(); }
    catch (e: any) { notify(e.message || 'Failed', 'danger'); }
  }

  async function advancePhase(id: string) {
    try { await apiFetch(`/performance/cycles/${id}/advance-phase`, { method: 'POST' }); notify('Phase advanced'); load(); }
    catch (e: any) { notify(e.message || 'Failed', 'danger'); }
  }

  async function deleteCycle(id: string) {
    if (!confirm('Delete this cycle and all its appraisals?')) return;
    try { await apiFetch(`/performance/cycles/${id}`, { method: 'DELETE' }); notify('Deleted'); load(); }
    catch (e: any) { notify(e.message || 'Failed', 'danger'); }
  }

  async function enrollEmployees() {
    if (!enrollModal) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { notify('Select at least one employee', 'warn'); return; }
    setEnrolling(true);
    try {
      const r = await apiFetch(`/performance/cycles/${enrollModal.id}/enroll`, { method: 'POST', body: JSON.stringify({ employeeIds: ids }) });
      notify(`Enrolled ${r.enrolled}, skipped ${r.skipped}`);
      setEnrollModal(null); setSelectedIds(new Set()); load();
    } catch (e: any) { notify(e.message || 'Failed', 'danger'); }
    finally { setEnrolling(false); }
  }

  const createMissing = !form.name || !form.startDate || !form.endDate;

  // Enrol list, filtered exactly as before
  const filtered = allEmployees.filter(e => {
    const q = enrollSearch.toLowerCase();
    return !q || e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q) || (e.department ?? '').toLowerCase().includes(q);
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{loading ? '' : `${cycles.length} cycle${cycles.length === 1 ? '' : 's'}`}</p>
        <Button icon="plus" onClick={() => setShowCreate(true)}>New appraisal cycle</Button>
      </div>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New appraisal cycle"
        caption="Starts as a draft; activate it when you are ready to enrol people."
        footer={<>
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={createCycle} disabled={saving}>{saving ? 'Creating…' : 'Create cycle'}</Button>
        </>}
      >
        <div className="flex flex-col gap-4">
          <Field label="Cycle name" required>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Annual review 2026" />
          </Field>
          <Field label="Type" required>
            <Select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as CycleType }))}>
              <option value="ANNUAL">Annual</option>
              <option value="MID_YEAR">Mid-year</option>
              <option value="PROBATION">Probation</option>
              <option value="CUSTOM">Custom</option>
            </Select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Start date" required>
              <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <Field label="End date" required>
              <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
            </Field>
          </div>
          <Field label="Description">
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
          </Field>
          {createMissing && <p className="text-xs text-muted">Name, start date and end date are required.</p>}
        </div>
      </Modal>

      <Modal
        open={!!enrollModal}
        onClose={() => setEnrollModal(null)}
        title="Enrol employees"
        caption={enrollModal?.name}
        footer={<>
          <Button variant="secondary" onClick={() => setEnrollModal(null)}>Cancel</Button>
          <Button onClick={enrollEmployees} disabled={enrolling || selectedIds.size === 0} reason={selectedIds.size === 0 && !enrolling ? 'Select at least one person' : undefined}>
            {enrolling ? 'Enrolling…' : selectedIds.size > 0 ? `Enrol ${selectedIds.size}` : 'Enrol'}
          </Button>
        </>}
      >
        <div className="flex flex-col gap-3">
          <SearchInput value={enrollSearch} onChange={e => setEnrollSearch(e.target.value)} placeholder="Search name, code or department…" aria-label="Search employees" />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                if (allFilteredSelected) {
                  setSelectedIds(prev => { const next = new Set(prev); filtered.forEach(e => next.delete(e.id)); return next; });
                } else {
                  setSelectedIds(prev => { const next = new Set(prev); filtered.forEach(e => next.add(e.id)); return next; });
                }
              }}
              className="text-[13px] font-semibold text-accent hover:underline"
            >
              {allFilteredSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span className="text-[13px] text-muted tabular-nums">{selectedIds.size} selected</span>
          </div>
          <div className="max-h-[45vh] overflow-y-auto border border-rule rounded-control divide-y divide-rule">
            {employeesLoading ? (
              <div className="p-6 flex flex-col gap-2">{[1, 2, 3].map(i => <div key={i} className="h-10 bg-pill rounded-control animate-pulse" />)}</div>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted">{enrollSearch ? 'No one matches that search.' : 'No active employees found.'}</p>
            ) : filtered.map(emp => {
              const checked = selectedIds.has(emp.id);
              return (
                <label key={emp.id} className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${checked ? 'bg-tint' : 'hover:bg-page'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        checked ? next.delete(emp.id) : next.add(emp.id);
                        return next;
                      });
                    }}
                    className="w-4 h-4 accent-accent shrink-0"
                  />
                  <span className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-semibold text-ink truncate">{emp.fullName}</span>
                    <span className="text-xs text-muted truncate tabular-nums">{emp.employeeCode}{emp.department ? ` · ${emp.department}` : ''}</span>
                  </span>
                  {emp.designation && <span className="hidden sm:block text-xs text-muted truncate max-w-[140px]">{emp.designation}</span>}
                </label>
              );
            })}
          </div>
        </div>
      </Modal>

      {loading ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h="h-32" />)}</div>
      ) : cycles.length === 0 ? (
        <Card><EmptyState icon="calendar" title="No appraisal cycles yet" description="Create a cycle, activate it, then enrol the people it covers." action={<Button icon="plus" onClick={() => setShowCreate(true)}>New appraisal cycle</Button>} /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {cycles.map(c => (
            <Card key={c.id} className="gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={CYCLE_STATUS_TONE[c.status]}>{CYCLE_STATUS_LABEL[c.status]}</Badge>
                    <span className="text-[13px] text-muted">{CYCLE_TYPE_LABEL[c.type] || c.type}</span>
                    <span className="text-[13px] text-muted tabular-nums">· {c._count?.appraisals ?? 0} enrolled</span>
                  </div>
                  <h3 className="text-[15.5px] font-bold text-ink">{c.name}</h3>
                  {c.description && <p className="text-[13px] text-muted">{c.description}</p>}
                  <p className="text-[13px] text-muted tabular-nums">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {c.status === 'DRAFT' && <Button size="sm" onClick={() => activate(c.id)}>Activate</Button>}
                  {c.status === 'ACTIVE' && c.currentPhase !== 'COMPLETED' && <Button size="sm" onClick={() => advancePhase(c.id)}>Advance phase</Button>}
                  <Button size="sm" variant="secondary" onClick={() => openEnrollModal(c)}>Enrol</Button>
                  <Button size="sm" variant="danger" onClick={() => deleteCycle(c.id)}>Delete</Button>
                </div>
              </div>
              <div className="pt-3 border-t border-rule">
                <Stepper steps={PHASE_ORDER.map((ph, i) => ({
                  label: PHASE_LABELS[ph],
                  state: ph === c.currentPhase ? 'now' : i < phaseIndex(c.currentPhase) ? 'done' : 'todo',
                }))} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MY APPRAISAL TAB — employee's own workflow only, no admin actions
// Used by both employee-only view AND the admin/manager "My Appraisal" tab
// ─────────────────────────────────────────────────────────────────────────────
const STEP_LABELS: Record<AppraisalStatus, string> = {
  PENDING:           'Not started',
  SELF_SUBMITTED:    'Self-assessment submitted',
  MANAGER_SUBMITTED: 'Manager has reviewed',
  FINALISED:         'Appraisal finalised',
};
const STEP_SHORT: Record<AppraisalStatus, string> = {
  PENDING: 'Self-assessment', SELF_SUBMITTED: 'Submitted', MANAGER_SUBMITTED: 'Manager review', FINALISED: 'Finalised',
};

const STEP_ORDER: AppraisalStatus[] = ['PENDING', 'SELF_SUBMITTED', 'MANAGER_SUBMITTED', 'FINALISED'];

function stepIndex(s: AppraisalStatus) { return STEP_ORDER.indexOf(s); }

function ScoreTile({ label, value, note, strong }: { label: string; value?: number; note?: string; strong?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 p-3.5 rounded-control ${strong ? 'bg-tint' : 'bg-pill'}`}>
      <span className="text-[12.5px] font-semibold text-muted">{label}</span>
      <span className={`text-2xl font-extrabold tabular-nums ${value ? 'text-ink' : 'text-faint'}`}>{value?.toFixed(1) ?? '—'}</span>
      <span className="text-xs text-muted">{note ?? 'out of 5.0'}</span>
    </div>
  );
}

function MyAppraisalTab({ notify }: { notify: Notify }) {
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Appraisal | null>(null);
  const [form, setForm] = useState({ selfScore: 0, selfComments: '', strengths: '', improvements: '' });
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setAppraisals(await apiFetch('/performance/appraisals/me')); }
    catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  function select(a: Appraisal) {
    setSelected(a);
    setForm({
      selfScore:    a.selfScore    ?? 0,
      selfComments: a.selfComments ?? '',
      strengths:    a.strengths    ?? '',
      improvements: a.improvements ?? '',
    });
  }

  async function submitSelf() {
    if (!selected || !form.selfScore) { notify('Please select a rating before submitting', 'warn'); return; }
    setSubmitting(true);
    try {
      const updated = await apiFetch(`/performance/appraisals/${selected.id}/self-submit`, {
        method: 'POST', body: JSON.stringify(form),
      });
      notify('Self-assessment submitted successfully');
      await reload();
      setSelected(updated);
    } catch (e: any) { notify(e.message || 'Submission failed', 'danger'); }
    finally { setSubmitting(false); }
  }

  if (loading) return <Skeleton />;

  if (appraisals.length === 0) {
    return (
      <Card>
        <EmptyState icon="file" title="No appraisals yet" description="You have not been enrolled in a review cycle. Your HR admin enrols people when a cycle opens." />
      </Card>
    );
  }

  const list = (
    <div className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-muted px-1">Your review cycles</h2>
      {appraisals.map(a => {
        const done = stepIndex(a.status);
        const isActive = a.status === 'PENDING' || a.status === 'SELF_SUBMITTED';
        const on = selected?.id === a.id;
        return (
          <button key={a.id} type="button" onClick={() => select(a)} aria-current={on ? 'true' : undefined}
            className={`w-full text-left flex flex-col gap-2.5 p-4 bg-paper border rounded-card transition-colors ${on ? 'border-accent shadow-card' : 'border-rule hover:bg-page'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-ink">{a.cycle?.name ?? a.cycleId}</span>
                <span className="text-xs text-muted">{a.cycle?.type ? (CYCLE_TYPE_LABEL[a.cycle.type] || a.cycle.type) : ''}</span>
              </div>
              {isActive && <Badge tone="warn">Your turn</Badge>}
            </div>
            <div className="flex items-center gap-1" aria-hidden="true">
              {STEP_ORDER.map((_, i) => <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= done ? 'bg-accent' : 'bg-pill'}`} />)}
            </div>
            <span className="text-xs text-muted">{STEP_LABELS[a.status]}</span>
          </button>
        );
      })}
    </div>
  );

  const detail = selected && (
    <Card className="gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-muted">{selected.cycle?.type ? (CYCLE_TYPE_LABEL[selected.cycle.type] || selected.cycle.type) : 'Review'}</span>
        <h2 className="text-xl font-extrabold tracking-[-0.01em] text-ink">{selected.cycle?.name}</h2>
        <span className="text-[13px] text-muted tabular-nums">{fmtDate(selected.cycle?.startDate)} – {fmtDate(selected.cycle?.endDate)}</span>
      </div>

      <Stepper steps={STEP_ORDER.map((step, i) => {
        const done = stepIndex(selected.status);
        return { label: STEP_SHORT[step], state: step === selected.status ? 'now' : i < done ? 'done' : 'todo' };
      })} />

      {/* Scores (visible once something has been submitted) */}
      {selected.status !== 'PENDING' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ScoreTile label="Your score" value={selected.selfScore} strong />
          <ScoreTile label="Manager score" value={selected.managerScore} note={selected.managerScore ? undefined : 'Pending review'} />
          <ScoreTile label="Final score" value={selected.overallScore} note={selected.overallScore ? undefined : 'Not yet finalised'} />
        </div>
      )}

      {/* ── Self-assessment form (PENDING or SELF_SUBMITTED = can update) ── */}
      {(selected.status === 'PENDING' || selected.status === 'SELF_SUBMITTED') && (
        <div className="flex flex-col gap-4 pt-5 border-t border-rule max-w-[640px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[15.5px] font-bold text-ink">Self-assessment</h3>
            {selected.status === 'SELF_SUBMITTED' && <Badge tone="warn">Submitted, editable until your manager reviews</Badge>}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-muted">Your overall rating <span className="text-danger" aria-hidden="true">*</span></span>
            <StarRating label="Your overall rating" value={form.selfScore} onChange={v => setForm(f => ({ ...f, selfScore: v }))} />
            <span className="text-xs text-muted">1 needs improvement · 3 meets expectations · 5 exceptional</span>
          </div>

          <Field label="Key achievements and highlights" help="Your main contributions and wins this period.">
            <Textarea value={form.selfComments} onChange={e => setForm(f => ({ ...f, selfComments: e.target.value }))} rows={4} />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Strengths" help="What went really well?">
              <Textarea value={form.strengths} onChange={e => setForm(f => ({ ...f, strengths: e.target.value }))} rows={3} />
            </Field>
            <Field label="Development areas" help="What would you like to improve?">
              <Textarea value={form.improvements} onChange={e => setForm(f => ({ ...f, improvements: e.target.value }))} rows={3} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2 sticky bottom-20 lg:static bg-paper py-2 lg:py-0">
            <Button onClick={submitSelf} disabled={submitting || !form.selfScore} reason={!form.selfScore && !submitting ? 'Choose a rating first' : undefined}>
              {submitting ? 'Submitting…' : selected.status === 'SELF_SUBMITTED' ? 'Update submission' : 'Submit self-assessment'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Read-only view of own submission after manager has reviewed ── */}
      {selected.status !== 'PENDING' && selected.selfComments && (
        <div className="flex flex-col gap-3 pt-5 border-t border-rule">
          <h3 className="text-[15.5px] font-bold text-ink">Your submission</h3>
          <div className="flex flex-col gap-3 p-4 rounded-control bg-page">
            <p className="text-sm text-ink leading-relaxed whitespace-pre-line">{selected.selfComments}</p>
            {selected.strengths && <div className="flex flex-col gap-0.5"><span className="text-[12.5px] font-semibold text-muted">Strengths</span><p className="text-sm text-ink">{selected.strengths}</p></div>}
            {selected.improvements && <div className="flex flex-col gap-0.5"><span className="text-[12.5px] font-semibold text-muted">Development areas</span><p className="text-sm text-ink">{selected.improvements}</p></div>}
          </div>
        </div>
      )}

      {/* ── Manager feedback (only shown once manager has submitted) ── */}
      {selected.managerComments && (
        <div className="flex flex-col gap-3 pt-5 border-t border-rule">
          <h3 className="inline-flex items-center gap-2 text-[15.5px] font-bold text-ink"><Icon name="user" size={17} className="text-accent" />Manager feedback</h3>
          <p className="p-4 rounded-control bg-tint text-sm text-ink leading-relaxed whitespace-pre-line">{selected.managerComments}</p>
        </div>
      )}

      {/* ── Waiting message when self-submitted, no manager review yet ── */}
      {selected.status === 'SELF_SUBMITTED' && !selected.managerScore && (
        <div className="flex items-start gap-3 p-4 rounded-control border border-rule bg-page">
          <Icon name="clock" size={18} className="text-warn mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-ink">Waiting for your manager</span>
            <span className="text-[13px] text-muted">Your self-assessment is in. Your manager will review it next.</span>
          </div>
        </div>
      )}
    </Card>
  );

  return <SplitPane list={list} detail={detail} hasDetail={!!selected} onBack={() => setSelected(null)} backLabel="Your review cycles" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM REVIEWS TAB (manager view)
// ─────────────────────────────────────────────────────────────────────────────
function TeamTab({ notify }: { notify: Notify }) {
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Appraisal | null>(null);
  const [form, setForm] = useState({ managerScore: 0, managerComments: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAppraisals(await apiFetch('/performance/appraisals/team')); }
    catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitManager() {
    if (!selected || !form.managerScore) { notify('Select a score', 'warn'); return; }
    setSubmitting(true);
    try {
      await apiFetch(`/performance/appraisals/${selected.id}/manager-submit`, {
        method: 'POST', body: JSON.stringify(form),
      });
      notify('Manager review submitted'); load();
      setSelected(null);
    } catch (e: any) { notify(e.message || 'Failed', 'danger'); }
    finally { setSubmitting(false); }
  }

  async function finalise(id: string) {
    try { await apiFetch(`/performance/appraisals/${id}/finalise`, { method: 'POST' }); notify('Appraisal finalised'); load(); }
    catch (e: any) { notify(e.message || 'Failed', 'danger'); }
  }

  if (loading) return <Skeleton />;

  const list = appraisals.length === 0 ? (
    <Card><EmptyState icon="users" title="No team appraisals" description="Appraisals for people who report to you appear here once they are enrolled." className="py-8" /></Card>
  ) : (
    <div className="flex flex-col gap-2">
      {appraisals.map(a => {
        const on = selected?.id === a.id;
        return (
          <button key={a.id} type="button" aria-current={on ? 'true' : undefined}
            onClick={() => { setSelected(a); setForm({ managerScore: a.managerScore ?? 0, managerComments: a.managerComments ?? '' }); }}
            className={`w-full text-left flex flex-col gap-2 p-4 bg-paper border rounded-card transition-colors ${on ? 'border-accent shadow-card' : 'border-rule hover:bg-page'}`}>
            <span className="text-xs text-muted tabular-nums">Employee {a.employeeId.slice(0, 8)}…</span>
            <span className="text-sm font-semibold text-ink">{a.cycle?.name ?? a.cycleId}</span>
            <div className="flex items-center justify-between gap-2">
              <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
              {a.selfScore && <span className="inline-flex items-center gap-1.5 text-xs text-muted">Self {scoreBadge(a.selfScore)}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );

  const detail = selected && (
    <Card className="gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-muted tabular-nums">Employee {selected.employeeId}</span>
        <h2 className="text-xl font-extrabold tracking-[-0.01em] text-ink">{selected.cycle?.name}</h2>
        <div><Badge tone={STATUS_TONE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ScoreTile label="Self score" value={selected.selfScore} />
        <ScoreTile label="Manager score" value={selected.managerScore} strong />
        <ScoreTile label="Overall" value={selected.overallScore} />
      </div>

      {selected.selfComments && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[15.5px] font-bold text-ink">Their self-assessment</h3>
          <div className="flex flex-col gap-3 p-4 rounded-control bg-page">
            <p className="text-sm text-ink leading-relaxed whitespace-pre-line">{selected.selfComments}</p>
            {selected.strengths && <div className="flex flex-col gap-0.5"><span className="text-[12.5px] font-semibold text-muted">Strengths</span><p className="text-sm text-ink">{selected.strengths}</p></div>}
            {selected.improvements && <div className="flex flex-col gap-0.5"><span className="text-[12.5px] font-semibold text-muted">Improvements</span><p className="text-sm text-ink">{selected.improvements}</p></div>}
          </div>
        </div>
      )}

      {selected.status === 'SELF_SUBMITTED' && (
        <div className="flex flex-col gap-4 pt-5 border-t border-rule max-w-[640px]">
          <h3 className="text-[15.5px] font-bold text-ink">Your review</h3>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-muted">Manager rating <span className="text-danger" aria-hidden="true">*</span></span>
            <StarRating label="Manager rating" value={form.managerScore} onChange={v => setForm(f => ({ ...f, managerScore: v }))} />
          </div>
          <Field label="Feedback for the employee">
            <Textarea value={form.managerComments} onChange={e => setForm(f => ({ ...f, managerComments: e.target.value }))} rows={4} />
          </Field>
          <div>
            <Button onClick={submitManager} disabled={submitting || !form.managerScore} reason={!form.managerScore && !submitting ? 'Choose a rating first' : undefined}>
              {submitting ? 'Submitting…' : 'Submit manager review'}
            </Button>
          </div>
        </div>
      )}

      {selected.status === 'MANAGER_SUBMITTED' && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-control bg-tint">
          <span className="text-[13px] text-ink">Your review is in. Finalising locks the scores for this cycle.</span>
          <Button onClick={() => finalise(selected.id)}>Finalise appraisal</Button>
        </div>
      )}
    </Card>
  );

  return <SplitPane list={list} detail={detail} hasDetail={!!selected} onBack={() => setSelected(null)} backLabel="Team reviews" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOALS TAB
// ─────────────────────────────────────────────────────────────────────────────
function GoalsTab({ notify }: { notify: Notify }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', targetDate: '', category: 'PERFORMANCE' as GoalCategory });
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [editProgress, setEditProgress] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try { setGoals(await apiFetch('/performance/goals')); }
    catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createGoal() {
    if (!form.title) { notify('Title is required', 'warn'); return; }
    setSaving(true);
    try {
      await apiFetch('/performance/goals', { method: 'POST', body: JSON.stringify(form) });
      notify('Goal created'); setShowCreate(false); setForm({ title: '', description: '', targetDate: '', category: 'PERFORMANCE' }); load();
    } catch (e: any) { notify(e.message || 'Failed', 'danger'); }
    finally { setSaving(false); }
  }

  async function updateProgress(goal: Goal) {
    try {
      await apiFetch(`/performance/goals/${goal.id}`, { method: 'PUT', body: JSON.stringify({ progress: editProgress, status: editProgress === 100 ? 'ACHIEVED' : goal.status }) });
      notify('Progress updated'); setEditGoal(null); load();
    } catch (e: any) { notify(e.message || 'Failed', 'danger'); }
  }

  async function updateStatus(id: string, status: GoalStatus) {
    try { await apiFetch(`/performance/goals/${id}`, { method: 'PUT', body: JSON.stringify({ status }) }); notify(`Marked ${status.toLowerCase()}`); load(); }
    catch (e: any) { notify(e.message || 'Failed', 'danger'); }
  }

  async function deleteGoal(id: string) {
    if (!confirm('Delete this goal?')) return;
    try { await apiFetch(`/performance/goals/${id}`, { method: 'DELETE' }); notify('Deleted'); load(); }
    catch (e: any) { notify(e.message || 'Failed', 'danger'); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{loading ? '' : `${goals.filter(g => g.status === 'ACTIVE').length} active · ${goals.filter(g => g.status === 'ACHIEVED').length} achieved`}</p>
        <Button icon="plus" onClick={() => setShowCreate(true)}>Add goal</Button>
      </div>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New goal"
        footer={<>
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={createGoal} disabled={saving}>{saving ? 'Saving…' : 'Create goal'}</Button>
        </>}
      >
        <div className="flex flex-col gap-4">
          <Field label="Title" required>
            <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Category">
              <Select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as GoalCategory }))}>
                <option value="PERFORMANCE">Performance</option>
                <option value="DEVELOPMENT">Development</option>
                <option value="ORGANIZATIONAL">Organisational</option>
              </Select>
            </Field>
            <Field label="Target date">
              <Input type="date" value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} />
            </Field>
          </div>
        </div>
      </Modal>

      {loading ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} h="h-24" />)}</div>
      ) : goals.length === 0 ? (
        <Card><EmptyState icon="star" title="No goals yet" description="Set a few measurable goals for this period and track progress against them." action={<Button icon="plus" onClick={() => setShowCreate(true)}>Add goal</Button>} /></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {goals.map(g => (
            <Card key={g.id} className="gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={GOAL_STATUS_TONE[g.status]}>{titleCase(g.status)}</Badge>
                    <span className="text-[13px] text-muted">{GOAL_CATEGORY_LABEL[g.category] || g.category}</span>
                    {g.targetDate && <span className="text-[13px] text-muted tabular-nums">· due {fmtDate(g.targetDate)}</span>}
                  </div>
                  <h3 className="text-[15.5px] font-bold text-ink">{g.title}</h3>
                  {g.description && <p className="text-[13px] text-muted">{g.description}</p>}
                </div>
                <div className="flex flex-wrap gap-1.5 shrink-0">
                  {g.status === 'ACTIVE' && (
                    <>
                      <Button size="sm" variant="secondary" icon="check" onClick={() => updateStatus(g.id, 'ACHIEVED')}>Mark achieved</Button>
                      <Button size="sm" variant="ghost" onClick={() => updateStatus(g.id, 'CANCELLED')}>Cancel goal</Button>
                    </>
                  )}
                  <Button size="sm" variant="danger" onClick={() => deleteGoal(g.id)}>Delete</Button>
                </div>
              </div>

              {editGoal?.id === g.id ? (
                <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-rule">
                  <label className="flex items-center gap-3 flex-1 min-w-[200px]">
                    <span className="sr-only">Progress for {g.title}</span>
                    <input type="range" min={0} max={100} value={editProgress} onChange={e => setEditProgress(Number(e.target.value))} className="flex-1 accent-accent" />
                    <span className="text-sm font-semibold text-ink tabular-nums w-11 text-right">{editProgress}%</span>
                  </label>
                  <Button size="sm" onClick={() => updateProgress(g)}>Save</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditGoal(null)}>Cancel</Button>
                  {editProgress === 100 && <span className="w-full text-xs text-muted">Saving at 100% marks the goal achieved.</span>}
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1 max-w-[280px] h-1.5 rounded-full bg-pill overflow-hidden" role="progressbar" aria-valuenow={g.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress for ${g.title}`}>
                    <div className="h-full bg-accent" style={{ width: `${g.progress}%` }} />
                  </div>
                  <span className="text-xs text-muted tabular-nums">{g.progress}%</span>
                  {g.status === 'ACTIVE' && (
                    <button type="button" onClick={() => { setEditGoal(g); setEditProgress(g.progress); }} className="text-[13px] font-semibold text-accent hover:underline">Update progress</button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PIP TAB
// ─────────────────────────────────────────────────────────────────────────────
function PipTab({ notify }: { notify: Notify }) {
  const [pips, setPips] = useState<PipRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ employeeId: '', startDate: '', endDate: '', objectives: '' });
  const [selected, setSelected] = useState<PipRecord | null>(null);
  const [notes, setNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPips(await apiFetch('/performance/pips')); }
    catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createPip() {
    if (!form.employeeId || !form.startDate || !form.endDate || !form.objectives) { notify('All fields are required', 'warn'); return; }
    setSaving(true);
    try {
      await apiFetch('/performance/pips', { method: 'POST', body: JSON.stringify(form) });
      notify('PIP created'); setShowCreate(false); setForm({ employeeId: '', startDate: '', endDate: '', objectives: '' }); load();
    } catch (e: any) { notify(e.message || 'Failed', 'danger'); }
    finally { setSaving(false); }
  }

  async function updatePip(id: string, data: Partial<PipRecord>) {
    setUpdatingStatus(true);
    try {
      const updated = await apiFetch(`/performance/pips/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      notify('PIP updated'); setSelected(updated); load();
    } catch (e: any) { notify(e.message || 'Failed', 'danger'); }
    finally { setUpdatingStatus(false); }
  }

  const list = (
    <div className="flex flex-col gap-2">
      <Button icon="plus" onClick={() => setShowCreate(true)} className="w-full sm:w-auto sm:self-start">New improvement plan</Button>
      {loading ? <Skeleton h="h-32" /> : pips.length === 0 ? (
        <Card><EmptyState icon="list" title="No improvement plans" description="Open one when someone needs a structured plan with measurable objectives." className="py-8" /></Card>
      ) : pips.map(p => {
        const on = selected?.id === p.id;
        return (
          <button key={p.id} type="button" aria-current={on ? 'true' : undefined}
            onClick={() => { setSelected(p); setNotes(p.progressNotes ?? ''); }}
            className={`w-full text-left flex flex-col gap-2 p-4 bg-paper border rounded-card transition-colors ${on ? 'border-accent shadow-card' : 'border-rule hover:bg-page'}`}>
            <span className="text-xs text-muted tabular-nums">Employee {p.employeeId.slice(0, 12)}…</span>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink tabular-nums">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}</span>
              <Badge tone={PIP_TONE[p.status]}>{titleCase(p.status)}</Badge>
            </div>
          </button>
        );
      })}
    </div>
  );

  const detail = selected && (
    <Card className="gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-muted tabular-nums">Employee {selected.employeeId}</span>
          <h2 className="text-xl font-extrabold tracking-[-0.01em] text-ink tabular-nums">{fmtDate(selected.startDate)} – {fmtDate(selected.endDate)}</h2>
        </div>
        <Badge tone={PIP_TONE[selected.status]}>{titleCase(selected.status)}</Badge>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[15.5px] font-bold text-ink">Objectives</h3>
        <p className="p-4 rounded-control bg-page text-sm text-ink leading-relaxed whitespace-pre-line">{selected.objectives}</p>
      </div>

      <div className="flex flex-col gap-3 max-w-[640px]">
        <Field label="Progress notes">
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} />
        </Field>
        <div>
          <Button variant="secondary" onClick={() => updatePip(selected.id, { progressNotes: notes })} disabled={updatingStatus}>Save notes</Button>
        </div>
      </div>

      {selected.status === 'ACTIVE' && (
        <div className="flex flex-col gap-2 pt-5 border-t border-rule">
          <span className="text-[12.5px] font-semibold text-muted">Close or extend the plan</span>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => updatePip(selected.id, { status: 'COMPLETED' })}>Mark completed</Button>
            <Button variant="secondary" onClick={() => updatePip(selected.id, { status: 'EXTENDED' })}>Extend</Button>
            <Button variant="danger" onClick={() => updatePip(selected.id, { status: 'TERMINATED' })}>Terminate</Button>
          </div>
        </div>
      )}
    </Card>
  );

  return (
    <>
      <SplitPane list={list} detail={detail} hasDetail={!!selected} onBack={() => setSelected(null)} backLabel="Improvement plans" />

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New improvement plan"
        caption="Measurable objectives over a fixed period."
        footer={<>
          <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={createPip} disabled={saving}>{saving ? 'Creating…' : 'Create plan'}</Button>
        </>}
      >
        <div className="flex flex-col gap-4">
          <Field label="Employee ID" required>
            <Input value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} placeholder="emp-…" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Start date" required>
              <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <Field label="End date" required>
              <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
            </Field>
          </div>
          <Field label="Objectives" required help="Measurable objectives and what success looks like.">
            <Textarea value={form.objectives} onChange={e => setForm(f => ({ ...f, objectives: e.target.value }))} rows={4} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
