'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import {
  Badge, Button, Card, CardHeader, DataTable, EmptyState, Field, Icon, Input, Modal, PageHeader, Select, SplitPane, Stat, Tabs, Textarea,
} from '@/components/ui';
import { Notice, PageLoading } from '@/components/employee/RecordParts';

// ── Types ─────────────────────────────────────────────────────────────────────
interface KeyPosition {
  id: string;
  jobTitle: string;
  department: string | null;
  description: string | null;
  currentHolderId: string | null;
  isActive: boolean;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  nominees: SuccessorNominee[];
  _currentHolder?: { firstName: string; lastName: string } | null;
}

interface SuccessorNominee {
  id: string;
  positionId: string;
  employeeId: string;
  readiness: 'READY_NOW' | 'ONE_YEAR' | 'TWO_YEARS';
  potentialBand: 1 | 2 | 3;
  notes: string | null;
  nominatedAt: string;
  devPlans: DevPlan[];
  _employee?: { firstName: string; lastName: string; department?: string } | null;
}

interface DevPlan {
  id: string;
  competencyGap: string;
  action: string;
  trainingProgramId: string | null;
  targetDate: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  notes: string | null;
}

interface Dashboard {
  totalPositions: number;
  totalNominees: number;
  byReadiness: { readyNow: number; oneYear: number; twoYears: number };
  byRisk: { high: number; medium: number; low: number };
  coverageRate: number;
  highRiskPositions: { id: string; jobTitle: string; department: string | null; nomineeCount: number }[];
}

interface NineBoxItem {
  nomineeId: string;
  employeeId: string;
  readiness: string;
  box: number;
  label: string;
  performanceBand: number;
  potentialBand: number;
  performanceScore: number | null;
  _employee?: { firstName: string; lastName: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const RISK_TONE: Record<string, 'danger' | 'warn' | 'ok'> = {
  HIGH:   'danger',
  MEDIUM: 'warn',
  LOW:    'ok',
};
const RISK_LABEL: Record<string, string> = { HIGH: 'High risk', MEDIUM: 'Medium risk', LOW: 'Low risk' };

const READINESS_TONE: Record<string, 'ok' | 'accent' | 'neutral'> = {
  READY_NOW: 'ok',
  ONE_YEAR:  'accent',
  TWO_YEARS: 'neutral',
};

const READINESS_LABEL: Record<string, string> = {
  READY_NOW: 'Ready now',
  ONE_YEAR:  'Ready in 1 year',
  TWO_YEARS: 'Ready in 2 years',
};
const READINESS_SHORT: Record<string, string> = { READY_NOW: 'now', ONE_YEAR: '1 yr', TWO_YEARS: '2 yrs' };

const POT_LABEL: Record<number, string> = { 1: 'Low', 2: 'Medium', 3: 'High' };

/** 9-box grounds: the high-potential/high-performance corner is tinted, the underperformer box warns. */
const BOX_GROUND: Record<number, string> = {
  1: 'bg-page',  2: 'bg-tint', 3: 'bg-tint',
  4: 'bg-page',  5: 'bg-paper', 6: 'bg-tint',
  7: 'bg-danger-bg', 8: 'bg-page', 9: 'bg-page',
};

function empName(e?: { firstName: string; lastName: string } | null) {
  return e ? `${e.firstName} ${e.lastName}` : '—';
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });

// ── Add Position Modal ────────────────────────────────────────────────────────
function AddPositionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ jobTitle: '', department: '', description: '', currentHolderId: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await apiFetch('/performance/key-positions', {
        method: 'POST',
        body: JSON.stringify({ ...form, currentHolderId: form.currentHolderId || null }),
      });
      onSaved();
    } catch (ex: any) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add key position"
      caption="A role the business cannot leave empty. You can nominate successors once it exists."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-position-form" disabled={saving}>{saving ? 'Saving…' : 'Create position'}</Button>
        </>
      }
    >
      <form id="add-position-form" onSubmit={submit} className="flex flex-col gap-4">
        {err && <Notice tone="danger">{err}</Notice>}
        <Field label="Job title" required>
          <Input value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} required />
        </Field>
        <Field label="Department">
          <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
        </Field>
        <Field label="Description">
          <Textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </Field>
        <Field label="Current holder" help="Optional — the holder's employee ID">
          <Input value={form.currentHolderId} onChange={e => setForm(f => ({ ...f, currentHolderId: e.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

// ── Nominate Successor Modal ───────────────────────────────────────────────────
function NominateModal({ positionId, onClose, onSaved }: { positionId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ employeeId: '', readiness: 'ONE_YEAR', potentialBand: '2', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await apiFetch(`/performance/key-positions/${positionId}/nominees`, {
        method: 'POST',
        body: JSON.stringify({ ...form, potentialBand: parseInt(form.potentialBand) }),
      });
      onSaved();
    } catch (ex: any) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Nominate a successor"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="nominate-form" disabled={saving}>{saving ? 'Saving…' : 'Nominate'}</Button>
        </>
      }
    >
      <form id="nominate-form" onSubmit={submit} className="flex flex-col gap-4">
        {err && <Notice tone="danger">{err}</Notice>}
        <Field label="Employee ID" required>
          <Input value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} required />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Readiness" required>
            <Select value={form.readiness} onChange={e => setForm(f => ({ ...f, readiness: e.target.value }))}>
              <option value="READY_NOW">Ready now</option>
              <option value="ONE_YEAR">Ready in 1 year</option>
              <option value="TWO_YEARS">Ready in 2 years</option>
            </Select>
          </Field>
          <Field label="Potential" required>
            <Select value={form.potentialBand} onChange={e => setForm(f => ({ ...f, potentialBand: e.target.value }))}>
              <option value="3">High (3)</option>
              <option value="2">Medium (2)</option>
              <option value="1">Low (1)</option>
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

// ── Dev Plan Modal ────────────────────────────────────────────────────────────
function DevPlanModal({ nomineeId, onClose, onSaved }: { nomineeId: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ competencyGap: '', action: '', trainingProgramId: '', targetDate: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await apiFetch(`/performance/nominees/${nomineeId}/dev-plans`, {
        method: 'POST',
        body: JSON.stringify({ ...form, trainingProgramId: form.trainingProgramId || null, targetDate: form.targetDate || null }),
      });
      onSaved();
    } catch (ex: any) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a development plan"
      caption="What the successor needs to close the gap, and by when."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="dev-plan-form" disabled={saving}>{saving ? 'Saving…' : 'Add plan'}</Button>
        </>
      }
    >
      <form id="dev-plan-form" onSubmit={submit} className="flex flex-col gap-4">
        {err && <Notice tone="danger">{err}</Notice>}
        <Field label="Competency gap" required>
          <Input placeholder="e.g. Strategic planning" value={form.competencyGap} onChange={e => setForm(f => ({ ...f, competencyGap: e.target.value }))} required />
        </Field>
        <Field label="Development action" required>
          <Input placeholder="e.g. Executive leadership programme" value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))} required />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Training programme ID" help="Optional">
            <Input value={form.trainingProgramId} onChange={e => setForm(f => ({ ...f, trainingProgramId: e.target.value }))} />
          </Field>
          <Field label="Target date">
            <Input type="date" value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}

// ── Position Detail Panel ──────────────────────────────────────────────────────
function PositionDetail({ position, onClose, onRefresh }: { position: KeyPosition; onClose: () => void; onRefresh: () => void }) {
  const [detail, setDetail] = useState<KeyPosition | null>(null);
  const [nominateOpen, setNominateOpen] = useState(false);
  const [devPlanNomineeId, setDevPlanNomineeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/performance/key-positions/${position.id}`);
      setDetail(data);
    } finally { setLoading(false); }
  }, [position.id]);

  useEffect(() => { load(); }, [load]);

  async function removeNominee(id: string) {
    if (!confirm('Remove this nominee?')) return;
    await apiFetch(`/performance/nominees/${id}`, { method: 'DELETE' });
    load(); onRefresh();
  }

  async function updateDevStatus(planId: string, status: string) {
    await apiFetch(`/performance/dev-plans/${planId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    load();
  }

  const pos = detail ?? position;

  return (
    <Card padding="p-0">
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 border-b border-rule">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-lg font-bold text-ink">{pos.jobTitle}</h2>
            <Badge tone={RISK_TONE[pos.riskLevel]}>{RISK_LABEL[pos.riskLevel]}</Badge>
          </div>
          {pos.department && <p className="mt-0.5 text-sm text-muted">{pos.department}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close position" className="hidden xl:flex -mr-2 w-9 h-9 items-center justify-center rounded-control text-muted hover:bg-page hover:text-ink">
          <Icon name="x" size={18} />
        </button>
      </div>

      <div className="flex flex-col gap-5 p-5">
        {pos.description && <p className="text-sm text-ink">{pos.description}</p>}

        {pos._currentHolder && (
          <div className="flex items-center justify-between gap-3 rounded-control bg-page px-4 py-3 text-[13.5px]">
            <span className="text-muted">Current holder</span>
            <span className="font-semibold text-ink">{empName(pos._currentHolder)}</span>
          </div>
        )}

        <div>
          <CardHeader
            title={<>Successor pool <span className="text-muted font-semibold tabular-nums">{pos.nominees.length}</span></>}
            action={<Button size="sm" icon="plus" onClick={() => setNominateOpen(true)}>Nominate</Button>}
          />

          {loading ? (
            <p className="text-sm text-muted">Loading successors…</p>
          ) : pos.nominees.length === 0 ? (
            <Notice tone="warn" title="No successors yet">Nobody is nominated, so this position is at high succession risk.</Notice>
          ) : (
            <div className="flex flex-col gap-3">
              {pos.nominees.map(n => (
                <div key={n.id} className="rounded-control border border-rule p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{empName(n._employee)}</p>
                      <p className="text-xs text-muted tabular-nums">{n.employeeId}{n._employee?.department ? ` · ${n._employee.department}` : ''}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={READINESS_TONE[n.readiness]}>{READINESS_LABEL[n.readiness]}</Badge>
                      <Badge tone="neutral">{POT_LABEL[n.potentialBand]} potential</Badge>
                      <Button size="sm" variant="danger" onClick={() => removeNominee(n.id)} aria-label={`Remove ${empName(n._employee)} from the pool`}>Remove</Button>
                    </div>
                  </div>
                  {n.notes && <p className="mt-2 text-[13px] text-muted">{n.notes}</p>}

                  <div className="mt-3 border-t border-rule pt-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[13px] font-semibold text-ink">Development plans</p>
                      <Button size="sm" variant="ghost" icon="plus" onClick={() => setDevPlanNomineeId(n.id)}>Add plan</Button>
                    </div>
                    {(n.devPlans || []).length === 0 ? (
                      <p className="text-[13px] text-muted">No development plans yet.</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {n.devPlans.map(dp => (
                          <div key={dp.id} className="flex flex-col gap-2 rounded-control bg-page p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 flex-1">
                              <p className="text-[13.5px] font-semibold text-ink">{dp.competencyGap}</p>
                              <p className="text-[13px] text-muted">{dp.action}</p>
                              {dp.targetDate && <p className="text-xs text-muted tabular-nums">Due {fmtDate(dp.targetDate)}</p>}
                            </div>
                            <label className="flex items-center gap-2 text-xs text-muted sm:w-44 shrink-0">
                              <span className="sr-only">Plan status</span>
                              <Select value={dp.status} onChange={e => updateDevStatus(dp.id, e.target.value)} className="h-9">
                                <option value="PENDING">Pending</option>
                                <option value="IN_PROGRESS">In progress</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="CANCELLED">Cancelled</option>
                              </Select>
                            </label>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {nominateOpen && (
        <NominateModal positionId={position.id} onClose={() => setNominateOpen(false)}
          onSaved={() => { setNominateOpen(false); load(); onRefresh(); }} />
      )}
      {devPlanNomineeId && (
        <DevPlanModal nomineeId={devPlanNomineeId} onClose={() => setDevPlanNomineeId(null)}
          onSaved={() => { setDevPlanNomineeId(null); load(); }} />
      )}
    </Card>
  );
}

// ── 9-Box Grid View ───────────────────────────────────────────────────────────
function NineBoxView() {
  const [data, setData] = useState<{ grid: NineBoxItem[]; byBox: Record<number, NineBoxItem[]>; unplaced: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/performance/nine-box').then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoading label="Loading the 9-box grid…" />;
  if (!data) return null;

  const BOX_META: Record<number, { row: number; col: number; label: string }> = {
    1: { row: 0, col: 0, label: 'Potential gem' },
    2: { row: 0, col: 1, label: 'Rising star' },
    3: { row: 0, col: 2, label: 'Star' },
    4: { row: 1, col: 0, label: 'Dilemma' },
    5: { row: 1, col: 1, label: 'Core employee' },
    6: { row: 1, col: 2, label: 'High performer' },
    7: { row: 2, col: 0, label: 'Underperformer' },
    8: { row: 2, col: 1, label: 'Solid contributor' },
    9: { row: 2, col: 2, label: 'Expert' },
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="9-box grid" caption="Successors placed by potential (rows) and performance (columns). Readiness is shown after each name." />
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="grid grid-cols-[112px_repeat(3,minmax(0,1fr))] gap-2 mb-2">
              <span />
              {['Low performance', 'Medium performance', 'High performance'].map(h => (
                <div key={h} className="text-xs font-semibold text-muted text-center">{h}</div>
              ))}
            </div>
            {['High potential', 'Medium potential', 'Low potential'].map((rowLabel, rIdx) => (
              <div key={rIdx} className="grid grid-cols-[112px_repeat(3,minmax(0,1fr))] gap-2 mb-2">
                <div className="flex items-center text-xs font-semibold text-muted">{rowLabel}</div>
                {[1, 2, 3].map(cIdx => {
                  const boxNum = rIdx * 3 + cIdx;
                  const items = data.byBox[boxNum] || [];
                  return (
                    <div key={boxNum} className={`min-h-[96px] rounded-control border border-rule p-3 ${BOX_GROUND[boxNum]}`}>
                      <p className="mb-1.5 flex items-center justify-between text-xs font-semibold text-ink">
                        {BOX_META[boxNum].label}
                        <span className="text-muted tabular-nums">{items.length}</span>
                      </p>
                      {items.length === 0 ? (
                        <p className="text-xs text-muted">No one here</p>
                      ) : (
                        items.map(item => (
                          <div key={item.nomineeId} className="flex items-baseline justify-between gap-2 text-[13px] text-ink">
                            <span className="truncate">{empName(item._employee) || item.employeeId}</span>
                            <span className="shrink-0 text-xs text-muted">{READINESS_SHORT[item.readiness] ?? ''}</span>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>

      {data.unplaced.length > 0 && (
        <Notice tone="warn" title={`${data.unplaced.length} not placed — no finalised appraisal`}>
          <ul className="mt-1 flex flex-col gap-0.5">
            {data.unplaced.map((u: any) => (
              <li key={u.nomineeId}>{empName(u._employee) || u.employeeId}: {u.reason}</li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}

// ── Risk Report View ──────────────────────────────────────────────────────────
function RiskReportView() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/performance/succession/risk-report').then(setReport).finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoading label="Loading the risk report…" />;
  if (!report) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="High risk" value={report.summary.high} note="No ready successor" />
        <Stat label="Medium risk" value={report.summary.medium} />
        <Stat label="Low risk" value={report.summary.low} />
      </div>

      <DataTable
        aria-label="Succession risk by position"
        rows={report.rows as any[]}
        rowKey={(row: any) => row.positionId}
        columns={[
          { key: 'pos', label: 'Position', width: 'minmax(0, 1.6fr)', render: (row: any) => <span className="font-semibold">{row.jobTitle}</span> },
          { key: 'dept', label: 'Department', render: (row: any) => <span className="text-muted">{row.department || '—'}</span> },
          { key: 'risk', label: 'Risk', width: '120px', render: (row: any) => <Badge tone={RISK_TONE[row.riskLevel]}>{RISK_LABEL[row.riskLevel] ?? row.riskLevel}</Badge> },
          { key: 'n', label: 'Nominees', width: '90px', align: 'right', numeric: true, render: (row: any) => row.totalNominees },
          { key: 'now', label: 'Ready now', width: '90px', align: 'right', numeric: true, render: (row: any) => row.readyCounts.READY_NOW || 0 },
          { key: 'y1', label: '1 year', width: '80px', align: 'right', numeric: true, render: (row: any) => row.readyCounts.ONE_YEAR || 0 },
          { key: 'y2', label: '2 years', width: '80px', align: 'right', numeric: true, render: (row: any) => row.readyCounts.TWO_YEARS || 0 },
        ]}
        mobileCard={(row: any) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold text-ink">{row.jobTitle}</span>
              <Badge tone={RISK_TONE[row.riskLevel]}>{RISK_LABEL[row.riskLevel] ?? row.riskLevel}</Badge>
            </div>
            <span className="text-xs text-muted tabular-nums">
              {row.department || 'No department'} · {row.totalNominees} nominees · {row.readyCounts.READY_NOW || 0} ready now
            </span>
          </div>
        )}
        empty={<EmptyState icon="shield" title="No key positions to report on" description="Add key positions to see their succession risk here." />}
      />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SuccessionPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'positions' | 'nine-box' | 'risk-report'>('positions');
  const [positions, setPositions] = useState<KeyPosition[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<KeyPosition | null>(null);
  const [riskFilter, setRiskFilter] = useState('');

  const isHR = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'].includes(user?.role || '');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [posData, dashData] = await Promise.all([
        apiFetch('/performance/key-positions'),
        apiFetch('/performance/succession/dashboard'),
      ]);
      setPositions(posData);
      setDashboard(dashData);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filtered = riskFilter ? positions.filter(p => p.riskLevel === riskFilter) : positions;

  const positionList = loading ? (
    <PageLoading label="Loading key positions…" />
  ) : filtered.length === 0 ? (
    <Card padding="p-0">
      <EmptyState
        icon="shield"
        title={riskFilter ? `No ${RISK_LABEL[riskFilter].toLowerCase()} positions` : 'No key positions yet'}
        description={riskFilter ? 'Try another risk level.' : isHR ? 'Add the roles the business cannot leave empty, then nominate successors for each.' : 'HR has not defined any key positions yet.'}
        action={!riskFilter && isHR ? <Button icon="plus" onClick={() => setAddOpen(true)}>Add key position</Button> : undefined}
      />
    </Card>
  ) : (
    <div className={`grid gap-3 ${selectedPosition ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
      {filtered.map(pos => {
        const readyNow = pos.nominees.filter(n => n.readiness === 'READY_NOW').length;
        const selected = selectedPosition?.id === pos.id;
        return (
          <button
            key={pos.id}
            type="button"
            onClick={() => setSelectedPosition(pos)}
            aria-current={selected ? 'true' : undefined}
            className={`flex flex-col gap-3 rounded-card border bg-paper p-4 text-left shadow-card transition-colors hover:border-accent ${selected ? 'border-accent ring-2 ring-accent/20' : 'border-rule'}`}
          >
            <div className="flex w-full items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-ink">{pos.jobTitle}</p>
                {pos.department && <p className="text-[13px] text-muted">{pos.department}</p>}
              </div>
              <Badge tone={RISK_TONE[pos.riskLevel]}>{RISK_LABEL[pos.riskLevel]}</Badge>
            </div>
            <div className="flex items-center gap-3 text-[13px] text-muted tabular-nums">
              <span>{pos.nominees.length} nominee{pos.nominees.length !== 1 ? 's' : ''}</span>
              {readyNow > 0 && <span className="font-semibold text-ok">{readyNow} ready now</span>}
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Succession planning"
        subtitle="Key positions, successor pools and the 9-box grid"
        actions={isHR ? <Button icon="plus" onClick={() => setAddOpen(true)}>Add key position</Button> : undefined}
      />

      {dashboard && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Key positions" value={dashboard.totalPositions} />
          <Stat label="Successors nominated" value={dashboard.totalNominees} />
          <Stat label="Ready now" value={dashboard.byReadiness.readyNow} />
          <Stat
            label="Coverage"
            value={`${dashboard.coverageRate}%`}
            note={<span className={dashboard.coverageRate >= 70 ? 'text-ok' : 'text-warn'}>{dashboard.coverageRate >= 70 ? 'On target (70%)' : 'Below the 70% target'}</span>}
          />
        </div>
      )}

      {dashboard && dashboard.byRisk.high > 0 && (
        <Notice tone="danger" title={`${dashboard.byRisk.high} position${dashboard.byRisk.high > 1 ? 's' : ''} at high succession risk`}>
          {dashboard.highRiskPositions.slice(0, 3).map(p => p.jobTitle).join(', ')}
          {dashboard.highRiskPositions.length > 3 ? ` and ${dashboard.highRiskPositions.length - 3} more` : ''}
        </Notice>
      )}

      <Tabs<'positions' | 'nine-box' | 'risk-report'>
        items={[
          { id: 'positions', label: 'Key positions', count: positions.length },
          { id: 'nine-box', label: '9-box grid' },
          { id: 'risk-report', label: 'Risk report' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'positions' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by risk">
            {['', 'HIGH', 'MEDIUM', 'LOW'].map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRiskFilter(r)}
                aria-pressed={riskFilter === r}
                className={`h-8 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
                  riskFilter === r ? 'border-accent bg-tint text-accent' : 'border-rule bg-paper text-muted hover:text-ink'
                }`}
              >
                {r ? RISK_LABEL[r] : 'All'}
              </button>
            ))}
          </div>

          {selectedPosition ? (
            <SplitPane
              list={positionList}
              hasDetail
              onBack={() => setSelectedPosition(null)}
              backLabel="All key positions"
              detail={<PositionDetail key={selectedPosition.id} position={selectedPosition} onClose={() => setSelectedPosition(null)} onRefresh={loadAll} />}
            />
          ) : positionList}
        </div>
      )}

      {tab === 'nine-box' && <NineBoxView />}
      {tab === 'risk-report' && <RiskReportView />}

      {addOpen && (
        <AddPositionModal onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); loadAll(); }} />
      )}
    </div>
  );
}
