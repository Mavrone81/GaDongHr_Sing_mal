'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { Seal } from '@/components/official';
import { PageHeader, Card, CardHeader, Tabs, DataTable, Badge, Button, Field, Input, Select, Textarea, EmptyState, Modal, useToast, Icon, type Column } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────
interface LeaveType { id: string; code: string; name: string; }
interface LeaveBalance {
  type: string; label: string; total: number; used: number; balance: number;
}
interface LeaveRequest {
  id: string; type: string; from: string; to: string; days: number; reason: string;
  status: 'Pending' | 'Approved' | 'Rejected'; appliedOn: string;
}

/**
 * The instrument behind each leave type, where one exists.
 *
 * Hue told the reader nothing the label beside it did not already say. What a
 * reader of a leave balance actually needs to know is whether the number is a
 * floor they cannot go below or a house policy they can — so the citation
 * replaces the colour.
 *
 * Day counts appear ONLY where the statute fixes them plainly (annual, sick).
 * For the family-leave types the governing Act is named without a day count:
 * those entitlements vary with qualifying conditions, and a wrong figure on a
 * compliance screen is worse than no figure. COMP has no statutory entitlement
 * in Singapore at all, so it carries no seal.
 */
const LEAVE_CITATIONS: Record<string, string> = {
  AL: 'EA s.43 · floor 7 in year 1',
  SL: 'EA s.89 · floor 14 outpatient',
  CL: 'CDCA · childcare leave',
  ML: 'EA s.76 · maternity leave',
  PL: 'CDCA · paternity leave',
};

function workingDays(from: string, to: string): number {
  if (!from || !to) return 0;
  let count = 0;
  const cur = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cur <= end) { if (cur.getDay() !== 0 && cur.getDay() !== 6) count++; cur.setDate(cur.getDate() + 1); }
  return count;
}

function statusTone(s: LeaveRequest['status']): 'ok' | 'danger' | 'warn' {
  if (s === 'Approved') return 'ok';
  if (s === 'Rejected') return 'danger';
  return 'warn';
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Apply Modal ──────────────────────────────────────────────────────────────
interface ApplyModalProps {
  onClose: () => void;
  onCreated: (app: LeaveRequest) => void;
  leaveTypes: LeaveType[];
  balances: LeaveBalance[];
}

/**
 * Built to the "Mobile — apply leave" artboard: pick the type from balance
 * tiles, dates, a working-days line that shows the balance after, a note, and
 * one submit action that stays reachable on a phone. Validation, the FormData
 * shape and the endpoint are unchanged.
 */
function ApplyLeaveModal({ onClose, onCreated, leaveTypes, balances }: ApplyModalProps) {
  const [form, setForm] = useState({ typeId: leaveTypes[0]?.id ?? '', from: '', to: '', reason: '' });
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const days = workingDays(form.from, form.to);
  const selectedType = leaveTypes.find(t => t.id === form.typeId);
  const selectedBalance = balances.find(b => b.type === selectedType?.code);

  useEffect(() => {
    if (!form.typeId && leaveTypes.length > 0) set('typeId', leaveTypes[0].id);
  }, [leaveTypes]);

  const handleSubmit = async () => {
    if (!form.from || !form.to || !form.reason.trim() || !form.typeId) return;
    setSubmitting(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('leaveTypeId', form.typeId);
      fd.append('startDate', form.from);
      fd.append('endDate', form.to);
      fd.append('reason', form.reason);
      if (file) fd.append('attachment', file);
      const app = await apiFetch('/leave/applications', { method: 'POST', body: fd });
      onCreated({
        id: app.id,
        type: selectedType?.name ?? form.typeId,
        from: app.startDate.slice(0, 10),
        to: app.endDate.slice(0, 10),
        days: app.totalDays,
        reason: app.reason,
        status: app.status === 'PENDING' ? 'Pending' : app.status === 'APPROVED' ? 'Approved' : 'Rejected',
        appliedOn: app.createdAt.slice(0, 10),
      });
      onClose();
    } catch (e: any) {
      setError(e.message ?? 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const incomplete = !form.from || !form.to || !form.reason.trim() || !form.typeId;
  const todayIso = new Date().toISOString().slice(0, 10);
  const balanceAfter = selectedBalance ? selectedBalance.balance - days : null;

  return (
    <Modal open
      title="Apply for leave"
      caption="Your approver is notified as soon as you submit."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="arrowRight"
            onClick={handleSubmit}
            disabled={incomplete || submitting}
            reason={submitting ? undefined : incomplete ? 'Choose dates and give a reason' : undefined}
          >
            {submitting ? 'Submitting…' : 'Submit request'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-muted">Leave type</span>
          {leaveTypes.length === 0 ? (
            <p className="text-sm text-muted">No leave types are set up for you yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Leave type">
              {leaveTypes.map(t => {
                const b = balances.find(x => x.type === t.code);
                const on = t.id === form.typeId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set('typeId', t.id)}
                    className={`flex flex-col gap-0.5 p-3 text-left rounded-control border transition-colors ${on ? 'border-accent bg-tint' : 'border-rule bg-paper hover:bg-pill'}`}
                  >
                    <span className="text-xs text-muted truncate">{t.name}</span>
                    {b ? (
                      <span className={`text-lg font-extrabold tabular-nums ${on ? 'text-accent' : 'text-ink'}`}>
                        {b.balance} <span className="text-xs font-semibold text-muted">days</span>
                      </span>
                    ) : (
                      <span className="text-sm font-semibold text-faint">—</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="From" required>
            <Input type="date" value={form.from} min={todayIso} onChange={e => set('from', e.target.value)} />
          </Field>
          <Field label="To" required>
            <Input type="date" value={form.to} min={form.from || todayIso} onChange={e => set('to', e.target.value)} />
          </Field>
        </div>

        {days > 0 && (
          <div className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-control bg-pill text-sm">
            <span className="text-muted">Working days</span>
            <span className="font-bold text-ink tabular-nums">
              {days}
              {balanceAfter != null && (
                <span className={`font-semibold ${balanceAfter < 0 ? 'text-danger' : 'text-muted'}`}> · balance after {balanceAfter}</span>
              )}
            </span>
          </div>
        )}

        <Field label="Reason" required help="A short note for your approver.">
          <Textarea
            value={form.reason}
            onChange={e => set('reason', e.target.value)}
            rows={3}
            placeholder="e.g. Family trip"
            className="resize-none"
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-muted">Supporting document <span className="font-normal">· optional, PDF or image up to 10 MB</span></span>
          {file ? (
            <div className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-control border border-accent bg-tint">
              <div className="flex items-center gap-3 min-w-0">
                <Icon name="paperclip" size={18} className="text-accent" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{file.name}</p>
                  <p className="text-xs text-muted">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setFile(null)}>Remove</Button>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2.5 px-4 py-5 rounded-control border border-dashed border-rule bg-pill text-sm font-semibold text-muted cursor-pointer hover:border-accent hover:text-ink transition-colors">
              <Icon name="upload" size={18} />
              Attach a file
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 10 * 1024 * 1024) { setError('File exceeds 10 MB limit'); return; }
                  setError(null);
                  setFile(f);
                }}
              />
            </label>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-control bg-danger-bg text-sm text-danger">
            <Icon name="alert" size={16} className="mt-0.5" />{error}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Employee Leave View ──────────────────────────────────────────────────────
function EmployeeLeaveView() {
  const { user } = useAuth();
  const [showApply, setShowApply] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [history, setHistory] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'balance' | 'history'>('balance');
  const [balSort, setBalSort] = useState<{ col: 'label' | 'total' | 'used' | 'balance' | 'pct'; dir: 'asc' | 'desc' }>({ col: 'label', dir: 'asc' });

  useEffect(() => {
    async function load() {
      try {
        const [types, appsRes] = await Promise.allSettled([
          apiFetch('/leave/types'),
          user?.employeeId
            ? apiFetch(`/leave/applications?employeeId=${user.employeeId}&limit=100`)
            : apiFetch('/leave/applications?limit=100'),
        ]);

        if (types.status === 'fulfilled') {
          const activeTypes = (types.value as LeaveType[]).filter((t: any) => t.isActive);
          setLeaveTypes(activeTypes.slice(0, 8));
        }

        if (appsRes.status === 'fulfilled') {
          const apps = appsRes.value.applications ?? [];
          setHistory(apps.map((a: any) => ({
            id: a.id,
            type: a.leaveType?.name ?? a.leaveTypeId,
            from: a.startDate.slice(0, 10),
            to: a.endDate.slice(0, 10),
            days: a.totalDays,
            reason: a.reason ?? '',
            status: a.status === 'PENDING' ? 'Pending' : a.status === 'APPROVED' ? 'Approved' : 'Rejected',
            appliedOn: a.createdAt.slice(0, 10),
          })));
        }

        // Fetch balances if employeeId is known
        if (user?.employeeId) {
          try {
            const bals = await apiFetch(`/leave/balances/${user.employeeId}`);
            if (Array.isArray(bals) && bals.length > 0) {
              setBalances(bals.map((b: any) => {
                const total = b.entitledDays + (b.carryForward ?? 0);
                const used = b.usedDays ?? 0;
                const balance = total - used - (b.pendingDays ?? 0);
                return { type: b.leaveType?.code ?? b.leaveTypeId, label: b.leaveType?.name ?? '', total, used, balance };
              }));
            }
          } catch { /* balances not available */ }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.employeeId]);

  const pendingCount = history.filter(h => h.status === 'Pending').length;

  const sortedBalances = [...balances].sort((a, b) => {
    const d = balSort.dir === 'asc' ? 1 : -1;
    switch (balSort.col) {
      case 'label':   return d * a.label.localeCompare(b.label);
      case 'total':   return d * (a.total - b.total);
      case 'used':    return d * (a.used - b.used);
      case 'balance': return d * (a.balance - b.balance);
      case 'pct':     return d * ((a.balance / (a.total || 1)) - (b.balance / (b.total || 1)));
      default: return 0;
    }
  });
  function toggleBalSort(col: typeof balSort.col) {
    setBalSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  /** A sortable column header: the label plus a chevron that shows direction. */
  function SortHead({ col, children }: { col: typeof balSort.col; children: ReactNode }) {
    const on = balSort.col === col;
    return (
      <button type="button" onClick={() => toggleBalSort(col)} className={`inline-flex items-center gap-1 hover:text-ink ${on ? 'text-ink' : ''}`} aria-sort={on ? (balSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        {children}
        <Icon name="chevronDown" size={13} className={`transition-transform ${on ? (balSort.dir === 'asc' ? 'rotate-180' : '') : 'opacity-40'}`} />
      </button>
    );
  }

  const handleCreated = (req: LeaveRequest) => {
    setHistory(prev => [req, ...prev]);
    toast(`Leave request submitted for ${req.days} working day${req.days !== 1 ? 's' : ''}`, 'ok');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-t-accent border-accent animate-spin rounded-full" />
      </div>
    );
  }

  const balanceColumns: Column<LeaveBalance>[] = [
    {
      key: 'label', label: <SortHead col="label">Leave type</SortHead>, width: 'minmax(0, 1.6fr)',
      render: (b) => (
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="font-semibold truncate">{b.label}</span>
          {LEAVE_CITATIONS[b.type] && <span><Seal cite={LEAVE_CITATIONS[b.type]} /></span>}
        </span>
      ),
    },
    { key: 'total', label: <SortHead col="total">Entitlement</SortHead>, width: '120px', align: 'right', numeric: true, render: (b) => `${b.total}d` },
    { key: 'used', label: <SortHead col="used">Used</SortHead>, width: '100px', align: 'right', numeric: true, render: (b) => `${b.used}d` },
    { key: 'balance', label: <SortHead col="balance">Balance</SortHead>, width: '110px', align: 'right', numeric: true, render: (b) => <span className="font-bold">{b.balance}d</span> },
    {
      key: 'pct', label: <SortHead col="pct">Used so far</SortHead>, width: '180px',
      render: (b) => {
        const pct = Math.min(100, Math.round((b.used / (b.total || 1)) * 100));
        return (
          <span className="flex items-center gap-2.5">
            <span className="flex-1 h-1.5 rounded-full bg-pill overflow-hidden"><span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></span>
            <span className="text-xs text-muted tabular-nums w-9 text-right">{pct}%</span>
          </span>
        );
      },
    },
  ];

  const historyColumns: Column<LeaveRequest>[] = [
    { key: 'status', label: 'Status', width: '110px', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: 'type', label: 'Type', width: 'minmax(0, 1fr)', render: (r) => <span className="font-semibold">{r.type}</span> },
    { key: 'dates', label: 'Dates', width: 'minmax(0, 1.3fr)', numeric: true, render: (r) => `${fmtDate(r.from)} – ${fmtDate(r.to)}` },
    { key: 'days', label: 'Days', width: '70px', align: 'right', numeric: true, render: (r) => r.days },
    { key: 'reason', label: 'Reason', width: 'minmax(0, 1.4fr)', render: (r) => <span className={r.reason ? 'text-ink' : 'text-faint'}>{r.reason || '—'}</span> },
    { key: 'applied', label: 'Applied', width: '120px', numeric: true, render: (r) => fmtDate(r.appliedOn) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My leave"
        subtitle={pendingCount > 0 ? `${pendingCount} request${pendingCount === 1 ? '' : 's'} waiting for approval` : 'Balances, applications and history'}
        actions={
          <>
            {pendingCount > 0 && <Badge tone="warn">{pendingCount} pending</Badge>}
            <Button variant="primary" icon="plus" onClick={() => setShowApply(true)}>Apply for leave</Button>
          </>
        }
      />

      {balances.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {balances.map(b => {
            const pct = Math.min(100, Math.round((b.used / (b.total || 1)) * 100));
            return (
              <Card key={b.type} padding="px-[18px] py-4">
                <div className="text-[12.5px] font-semibold text-muted truncate">{b.label}</div>
                <div className="flex items-baseline gap-1.5 my-1.5">
                  <span className="text-[28px] font-extrabold tracking-[-0.02em] leading-none text-ink tabular-nums">{b.balance}</span>
                  <span className="text-xs font-semibold text-muted tabular-nums">/ {b.total} days</span>
                </div>
                {/* Consumption, not remainder: the bar fills as the entitlement is
                    spent, so a nearly-full bar reads as "nearly out" at a glance. */}
                <div className="h-1.5 rounded-full bg-pill overflow-hidden">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-muted mt-2 tabular-nums">{b.used} of {b.total} used</p>
                {LEAVE_CITATIONS[b.type] && <span className="mt-2"><Seal cite={LEAVE_CITATIONS[b.type]} /></span>}
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Tabs
          items={[{ id: 'balance', label: 'Balances', count: balances.length }, { id: 'history', label: 'My applications', count: history.length }]}
          active={activeTab}
          onChange={setActiveTab}
        />

        {activeTab === 'balance' && (
          <DataTable
            columns={balanceColumns}
            rows={sortedBalances}
            rowKey={(b) => b.type}
            rowHeight={60}
            aria-label="Leave balances"
            mobileCard={(b) => {
              const pct = Math.min(100, Math.round((b.used / (b.total || 1)) * 100));
              return (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-ink truncate">{b.label}</span>
                    <span className="text-sm font-bold text-ink tabular-nums shrink-0">{b.balance}d <span className="font-normal text-muted">of {b.total}</span></span>
                  </div>
                  <span className="block h-1.5 rounded-full bg-pill overflow-hidden"><span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></span>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted tabular-nums">{b.used}d used · {pct}%</span>
                    {LEAVE_CITATIONS[b.type] && <Seal cite={LEAVE_CITATIONS[b.type]} />}
                  </div>
                </div>
              );
            }}
            empty={<EmptyState icon="calendar" title="No leave entitlements yet" description="Your entitlements appear here once HR sets them up for your employment." />}
          />
        )}

        {activeTab === 'history' && (
          <DataTable
            columns={historyColumns}
            rows={history}
            rowKey={(r) => r.id}
            aria-label="My leave applications"
            mobileCard={(r) => (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink truncate">{r.type}</span>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </div>
                <p className="text-xs text-muted tabular-nums">{fmtDate(r.from)} – {fmtDate(r.to)} · {r.days} day{r.days === 1 ? '' : 's'}</p>
                {r.reason && <p className="text-xs text-muted truncate">{r.reason}</p>}
              </div>
            )}
            footer={history.length > 0 ? <><span>{history.length} application{history.length === 1 ? '' : 's'}</span><span>Newest first</span></> : undefined}
            empty={
              <EmptyState
                icon="calendar"
                title="No leave applications yet"
                description="Requests you submit show up here with their status."
                action={<Button variant="primary" icon="plus" onClick={() => setShowApply(true)}>Apply for leave</Button>}
              />
            }
          />
        )}
      </div>

      {showApply && <ApplyLeaveModal onClose={() => setShowApply(false)} onCreated={handleCreated} leaveTypes={leaveTypes} balances={balances} />}

    </div>
  );
}

// ─── Types for HR analytics ───────────────────────────────────────────────────
interface MCFlagged {
  employeeId: string;
  occurrences: number;
  totalSickDays: number;
  mondayCount: number;
  fridayCount: number;
  monFriRatio: number;
  patternType: 'MONDAY_PATTERN' | 'FRIDAY_PATTERN' | 'MONDAY_FRIDAY_PATTERN';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  employee: { name: string; department: string; designation: string } | null;
}
interface TrendEmployee {
  employeeId: string;
  name: string;
  department: string;
  totalDays: number;
  occurrences: number;
  monthlyBreakdown: Record<string, number>;
}
interface TrendDept {
  department: string;
  totalDays: number;
  occurrences: number;
  employeeCount: number;
}

function severityTone(s: MCFlagged['severity']): 'danger' | 'warn' | 'neutral' {
  if (s === 'HIGH') return 'danger';
  if (s === 'MEDIUM') return 'warn';
  return 'neutral';
}
const PATTERN_LABEL: Record<string, string> = {
  MONDAY_PATTERN:        'Monday',
  FRIDAY_PATTERN:        'Friday',
  MONDAY_FRIDAY_PATTERN: 'Mon + Fri',
};

// ─── HR Analytics: MC Patterns + Sick Leave Trends ────────────────────────────
function HRLeaveAnalytics() {
  const [tab, setTab] = useState<'patterns' | 'trends'>('patterns');
  const [months, setMonths] = useState(12);
  const [flagged, setFlagged] = useState<MCFlagged[]>([]);
  const [byEmployee, setByEmployee] = useState<TrendEmployee[]>([]);
  const [byDept, setByDept] = useState<TrendDept[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [pRes, tRes] = await Promise.allSettled([
        apiFetch(`/leave/mc-patterns?months=${months}`),
        apiFetch(`/leave/sick-leave-trends?months=${months}`),
      ]);
      if (pRes.status === 'fulfilled') setFlagged(pRes.value.flagged ?? []);
      if (tRes.status === 'fulfilled') {
        setByEmployee(tRes.value.byEmployee ?? []);
        setByDept(tRes.value.byDepartment ?? []);
      }
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [months]);

  const maxDeptDays = byDept[0]?.totalDays || 1;

  const patternColumns: Column<MCFlagged>[] = [
    {
      key: 'employee', label: 'Employee', width: 'minmax(0, 1.6fr)',
      render: (f) => (
        <span className="flex flex-col min-w-0">
          <span className="font-semibold truncate">{f.employee?.name ?? f.employeeId}</span>
          <span className="text-xs text-muted truncate">{f.employee?.department ?? ''}{f.employee?.designation ? ` · ${f.employee.designation}` : ''}</span>
        </span>
      ),
    },
    { key: 'pattern', label: 'Pattern', width: '110px', render: (f) => <Badge tone="neutral">{PATTERN_LABEL[f.patternType] ?? f.patternType}</Badge> },
    { key: 'severity', label: 'Severity', width: '100px', render: (f) => <Badge tone={severityTone(f.severity)}>{f.severity === 'HIGH' ? 'High' : f.severity === 'MEDIUM' ? 'Medium' : 'Low'}</Badge> },
    { key: 'occ', label: 'Occurrences', width: '110px', align: 'right', numeric: true, render: (f) => f.occurrences },
    { key: 'mon', label: 'Mon', width: '64px', align: 'right', numeric: true, render: (f) => f.mondayCount },
    { key: 'fri', label: 'Fri', width: '64px', align: 'right', numeric: true, render: (f) => f.fridayCount },
    { key: 'days', label: 'Sick days', width: '90px', align: 'right', numeric: true, render: (f) => `${f.totalSickDays}d` },
    {
      key: 'ratio', label: 'Mon/Fri ratio', width: '170px',
      render: (f) => (
        /* The threshold carries a WORD, not just a colour: the old three-way
           traffic light collapsed to one tone once mapped onto the tokens and
           the warning vanished silently. */
        <span className="flex items-center gap-2.5">
          <span className="text-sm font-bold tabular-nums w-11">{(f.monFriRatio * 100).toFixed(0)}%</span>
          {f.monFriRatio >= 0.75 ? <Badge tone="danger">High</Badge> : f.monFriRatio >= 0.5 ? <Badge tone="warn">Elevated</Badge> : null}
        </span>
      ),
    },
  ];

  const trendColumns: Column<TrendEmployee & { rank: number }>[] = [
    { key: 'rank', label: '#', width: '44px', numeric: true, render: (e) => <span className="text-muted">{e.rank}</span> },
    {
      key: 'employee', label: 'Employee', width: 'minmax(0, 1.5fr)',
      render: (e) => <span className="flex flex-col min-w-0"><span className="font-semibold truncate">{e.name}</span><span className="text-xs text-muted">{e.employeeId.slice(0, 8)}</span></span>,
    },
    { key: 'dept', label: 'Department', width: 'minmax(0, 1fr)', render: (e) => <Badge tone="neutral">{e.department}</Badge> },
    { key: 'apps', label: 'Applications', width: '110px', align: 'right', numeric: true, render: (e) => e.occurrences },
    { key: 'days', label: 'Sick days', width: '90px', align: 'right', numeric: true, render: (e) => <span className="font-bold">{e.totalDays}</span> },
    {
      key: 'trend', label: 'Last 6 months', width: '170px',
      render: (e) => {
        const ms = Object.entries(e.monthlyBreakdown).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
        const maxM = Math.max(...ms.map(([, v]) => v), 1);
        return (
          <span className="flex items-end gap-1 h-7" aria-label={ms.map(([mo, v]) => `${mo}: ${v} days`).join(', ')}>
            {ms.map(([mo, v]) => (
              <span key={mo} title={`${mo}: ${v}d`} className="w-4 rounded-t-[3px] bg-accent" style={{ height: `${Math.max((v / maxM) * 26, 3)}px` }} />
            ))}
          </span>
        );
      },
    },
  ];

  return (
    <Card padding="p-0" className="overflow-hidden">
      <div className="flex flex-col gap-4 px-5 pt-5 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <CardHeader title="Sick leave analytics" caption={lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString('en-SG')} · a pattern is a Mon/Fri sick-leave ratio of 50% or more over the last ${months} months` : 'Medical-certificate patterns and sick-leave trends across the company'} className="mb-0" />
          <div className="flex items-center gap-2.5 shrink-0">
            <Select value={months} onChange={e => setMonths(Number(e.target.value))} className="w-40 h-10" aria-label="Period">
              {[3, 6, 12, 24].map(m => <option key={m} value={m}>Last {m} months</option>)}
            </Select>
            <Button variant="secondary" icon="refresh" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Button>
          </div>
        </div>
        <Tabs
          items={[{ id: 'patterns', label: 'MC pattern alerts', count: flagged.length || undefined }, { id: 'trends', label: 'Sick leave trends' }]}
          active={tab}
          onChange={setTab}
        />
      </div>

      <div className="p-5 sm:p-6">
        {tab === 'patterns' && (
          <DataTable
            columns={patternColumns}
            rows={flagged}
            rowKey={(f) => f.employeeId}
            rowHeight={56}
            aria-label="MC pattern alerts"
            mobileCard={(f) => (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink truncate">{f.employee?.name ?? f.employeeId}</span>
                  <Badge tone={severityTone(f.severity)}>{f.severity === 'HIGH' ? 'High' : f.severity === 'MEDIUM' ? 'Medium' : 'Low'}</Badge>
                </div>
                <p className="text-xs text-muted truncate">{f.employee?.department ?? ''} · {PATTERN_LABEL[f.patternType] ?? f.patternType} pattern</p>
                <p className="text-xs text-muted tabular-nums">{f.occurrences} occurrences · {f.totalSickDays}d · Mon {f.mondayCount} / Fri {f.fridayCount} · {(f.monFriRatio * 100).toFixed(0)}%</p>
              </div>
            )}
            empty={
              <EmptyState
                icon="check"
                title={loading ? 'Checking…' : 'No suspicious patterns'}
                description={`Nobody meets the threshold: 3 or more sick-leave occurrences with at least half falling on a Monday or Friday, over the last ${months} months.`}
              />
            }
          />
        )}

        {tab === 'trends' && (
          <div className="flex flex-col gap-6">
            <div>
              <CardHeader title="By department" caption="Total sick days in the period" />
              {byDept.length === 0 && !loading && <p className="text-sm text-muted py-4">No sick leave recorded in this period.</p>}
              <div className="flex flex-col gap-2.5">
                {byDept.map(d => (
                  <div key={d.department} className="flex items-center gap-3">
                    <div className="w-36 shrink-0 text-right min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{d.department}</p>
                      <p className="text-xs text-muted">{d.employeeCount} employee{d.employeeCount !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="flex-1 h-6 rounded-[4px] bg-pill overflow-hidden">
                      <div className="h-full rounded-[4px] bg-accent transition-all" style={{ width: `${Math.max((d.totalDays / maxDeptDays) * 100, 2)}%` }} />
                    </div>
                    <div className="w-24 shrink-0 text-sm tabular-nums">
                      <span className="font-bold text-ink">{d.totalDays}d</span>
                      <span className="text-muted"> · {d.occurrences}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <CardHeader title="Most sick days" caption="Top employees in the period" />
              <DataTable
                columns={trendColumns}
                rows={byEmployee.map((e, i) => ({ ...e, rank: i + 1 }))}
                rowKey={(e) => e.employeeId}
                rowHeight={56}
                aria-label="Most sick days"
                mobileCard={(e) => (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted tabular-nums w-5 shrink-0">{e.rank}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{e.name}</p>
                      <p className="text-xs text-muted truncate">{e.department} · {e.occurrences} application{e.occurrences === 1 ? '' : 's'}</p>
                    </div>
                    <span className="text-sm font-bold text-ink tabular-nums shrink-0">{e.totalDays}d</span>
                  </div>
                )}
                empty={<EmptyState icon="users" title="No data for this period" description="Sick leave taken in the selected period appears here by employee." />}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────
const HR_ROLES = new Set(['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER']);

export default function LeavePage() {
  const { user } = useAuth();
  const role = (user?.role ?? '').toUpperCase();
  // "My Leave" always shows the user's own balances, applications & history —
  // admins are employees too. HR/admin roles additionally get the sick-leave
  // analytics appended below (the management view also lives under /leave/registry).
  return (
    <div className="flex flex-col gap-8">
      <EmployeeLeaveView />
      {HR_ROLES.has(role) && <HRLeaveAnalytics />}
    </div>
  );
}
