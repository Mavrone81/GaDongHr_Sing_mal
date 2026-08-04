'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { TONES } from '@/lib/statusTone';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

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
const RISK_COLOR: Record<string, string> = {
  HIGH:   'bg-ink text-ink border border-ink',
  MEDIUM: 'bg-highlight text-highlight border border-highlight',
  LOW:    'bg-accent text-accent border border-accent',
};

const READINESS_COLOR: Record<string, string> = {
  READY_NOW: 'bg-accent text-accent border border-accent',
  ONE_YEAR:  'bg-highlight text-highlight border border-highlight',
  TWO_YEARS: 'bg-muted text-muted border border-rule',
};

const READINESS_LABEL: Record<string, string> = {
  READY_NOW: 'Ready Now',
  ONE_YEAR:  '1 Year',
  TWO_YEARS: '2 Years',
};

const DEV_STATUS_COLOR: Record<string, string> = {
  PENDING: TONES.pending,
  IN_PROGRESS: TONES.active,
  COMPLETED: TONES.done,
  CANCELLED: TONES.inert,
};

const POT_LABEL: Record<number, string> = { 1: 'Low', 2: 'Med', 3: 'High' };
const BOX_COLOR: Record<number, string> = {
  1: 'bg-accent',   2: 'bg-accent',  3: 'bg-accent',
  4: 'bg-highlight',  5: 'bg-muted',   6: 'bg-accent',
  7: 'bg-ink',    8: 'bg-highlight',  9: 'bg-accent',
};

function empName(e?: { firstName: string; lastName: string } | null) {
  return e ? `${e.firstName} ${e.lastName}` : '—';
}

// ── Add Position Modal ────────────────────────────────────────────────────────
function AddPositionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ jobTitle: '', department: '', description: '', currentHolderId: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await apiFetch('/api/performance/key-positions', {
        method: 'POST',
        body: JSON.stringify({ ...form, currentHolderId: form.currentHolderId || null }),
      });
      onSaved();
    } catch (ex: any) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-shadow">
      <div className="bg-shadow border border-rule p-6 w-full max-w-md ">
        <h2 className="text-lg font-semibold text-paper mb-4">Add Key Position</h2>
        <form onSubmit={submit} className="space-y-3">
          {err && <p className="text-ink text-sm">{err}</p>}
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Job Title *</label>
            <input className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2"
              value={form.jobTitle} onChange={e => setForm(f => ({ ...f, jobTitle: e.target.value }))} required />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Department</label>
            <input className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2"
              value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Description</label>
            <textarea className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2 h-20 resize-none"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Current Holder Employee ID</label>
            <input className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2"
              placeholder="Optional"
              value={form.currentHolderId} onChange={e => setForm(f => ({ ...f, currentHolderId: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-paper">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-accent hover:bg-accent text-paper text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Create Position'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
      await apiFetch(`/api/performance/key-positions/${positionId}/nominees`, {
        method: 'POST',
        body: JSON.stringify({ ...form, potentialBand: parseInt(form.potentialBand) }),
      });
      onSaved();
    } catch (ex: any) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-shadow">
      <div className="bg-shadow border border-rule p-6 w-full max-w-md ">
        <h2 className="text-lg font-semibold text-paper mb-4">Nominate Successor</h2>
        <form onSubmit={submit} className="space-y-3">
          {err && <p className="text-ink text-sm">{err}</p>}
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Employee ID *</label>
            <input className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2"
              value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} required />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Readiness *</label>
            <select className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2"
              value={form.readiness} onChange={e => setForm(f => ({ ...f, readiness: e.target.value }))}>
              <option value="READY_NOW">Ready Now</option>
              <option value="ONE_YEAR">1 Year</option>
              <option value="TWO_YEARS">2 Years</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Potential Band *</label>
            <select className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2"
              value={form.potentialBand} onChange={e => setForm(f => ({ ...f, potentialBand: e.target.value }))}>
              <option value="3">High (3)</option>
              <option value="2">Medium (2)</option>
              <option value="1">Low (1)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Notes</label>
            <textarea className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2 h-16 resize-none"
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-paper">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-accent hover:bg-accent text-paper text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Nominate'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
      await apiFetch(`/api/performance/nominees/${nomineeId}/dev-plans`, {
        method: 'POST',
        body: JSON.stringify({ ...form, trainingProgramId: form.trainingProgramId || null, targetDate: form.targetDate || null }),
      });
      onSaved();
    } catch (ex: any) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-shadow">
      <div className="bg-shadow border border-rule p-6 w-full max-w-md ">
        <h2 className="text-lg font-semibold text-paper mb-4">Add Development Plan</h2>
        <form onSubmit={submit} className="space-y-3">
          {err && <p className="text-ink text-sm">{err}</p>}
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Competency Gap *</label>
            <input className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2"
              placeholder="e.g. Strategic planning skills"
              value={form.competencyGap} onChange={e => setForm(f => ({ ...f, competencyGap: e.target.value }))} required />
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Development Action *</label>
            <input className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2"
              placeholder="e.g. Enroll in Executive Leadership Program"
              value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Training Program ID</label>
              <input className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2"
                placeholder="Optional"
                value={form.trainingProgramId} onChange={e => setForm(f => ({ ...f, trainingProgramId: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted uppercase tracking-wide">Target Date</label>
              <input type="date" className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2"
                value={form.targetDate} onChange={e => setForm(f => ({ ...f, targetDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted uppercase tracking-wide">Notes</label>
            <textarea className="w-full mt-1 bg-muted border border-rule text-paper text-sm px-3 py-2 h-16 resize-none"
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-paper">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-accent hover:bg-accent text-paper text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Add Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
      const data = await apiFetch(`/api/performance/key-positions/${position.id}`);
      setDetail(data);
    } finally { setLoading(false); }
  }, [position.id]);

  useEffect(() => { load(); }, [load]);

  async function removeNominee(id: string) {
    if (!confirm('Remove this nominee?')) return;
    await apiFetch(`/api/performance/nominees/${id}`, { method: 'DELETE' });
    load(); onRefresh();
  }

  async function updateDevStatus(planId: string, status: string) {
    await apiFetch(`/api/performance/dev-plans/${planId}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    load();
  }

  const pos = detail ?? position;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-shadow" onClick={onClose} />
      <div className="w-full max-w-2xl bg-shadow border-l border-shadow overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-shadow border-b border-shadow px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-semibold text-paper">{pos.jobTitle}</h2>
            {pos.department && <p className="text-sm text-muted">{pos.department}</p>}
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium px-2 py-1  ${RISK_COLOR[pos.riskLevel]}`}>
              {pos.riskLevel} RISK
            </span>
            <button onClick={onClose} className="text-muted hover:text-paper text-xl leading-none">×</button>
          </div>
        </div>

        <div className="p-6 space-y-6 flex-1">
          {/* Description */}
          {pos.description && (
            <p className="text-sm text-muted">{pos.description}</p>
          )}

          {/* Current Holder */}
          {pos._currentHolder && (
            <div className="bg-shadow border border-rule p-3">
              <p className="text-xs text-muted uppercase tracking-wide mb-1">Current Holder</p>
              <p className="text-sm text-paper">{empName(pos._currentHolder)}</p>
            </div>
          )}

          {/* Nominees */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-paper uppercase tracking-wide">
                Successor Pool ({pos.nominees.length})
              </h3>
              <button onClick={() => setNominateOpen(true)}
                className="text-xs bg-accent hover:bg-accent text-paper px-3 py-1 ">
                + Nominate
              </button>
            </div>

            {loading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : pos.nominees.length === 0 ? (
              <p className="text-sm text-muted italic">No nominees yet — high succession risk.</p>
            ) : (
              <div className="space-y-3">
                {pos.nominees.map(n => (
                  <div key={n.id} className="bg-shadow border border-shadow p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-paper">{empName(n._employee)}</p>
                        <p className="text-xs text-muted">{n.employeeId}</p>
                        {n._employee?.department && <p className="text-xs text-muted">{n._employee.department}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium px-2 py-0.5  ${READINESS_COLOR[n.readiness]}`}>
                          {READINESS_LABEL[n.readiness]}
                        </span>
                        <span className="text-xs bg-muted text-muted px-2 py-0.5 ">
                          Pot: {POT_LABEL[n.potentialBand]}
                        </span>
                        <button onClick={() => removeNominee(n.id)} className="text-ink hover:text-ink text-xs ml-1">✕</button>
                      </div>
                    </div>
                    {n.notes && <p className="text-xs text-muted mt-2 italic">{n.notes}</p>}

                    {/* Dev Plans */}
                    <div className="mt-3 border-t border-shadow pt-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs text-muted uppercase tracking-wide">Development Plans</p>
                        <button onClick={() => setDevPlanNomineeId(n.id)}
                          className="text-xs text-accent hover:text-accent">+ Add</button>
                      </div>
                      {(n.devPlans || []).length === 0 ? (
                        <p className="text-xs text-muted italic">No development plans.</p>
                      ) : (
                        <div className="space-y-2">
                          {n.devPlans.map(dp => (
                            <div key={dp.id} className="bg-shadow border border-rule p-2 flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-paper truncate">{dp.competencyGap}</p>
                                <p className="text-xs text-muted truncate">{dp.action}</p>
                                {dp.targetDate && (
                                  <p className="text-xs text-muted">Due: {new Date(dp.targetDate).toLocaleDateString()}</p>
                                )}
                              </div>
                              <select
                                value={dp.status}
                                onChange={e => updateDevStatus(dp.id, e.target.value)}
                                className="text-xs bg-muted border border-rule text-paper px-1 py-0.5 shrink-0">
                                <option value="PENDING">Pending</option>
                                <option value="IN_PROGRESS">In Progress</option>
                                <option value="COMPLETED">Completed</option>
                                <option value="CANCELLED">Cancelled</option>
                              </select>
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

        {/* Modals */}
        {nominateOpen && (
          <NominateModal positionId={position.id} onClose={() => setNominateOpen(false)}
            onSaved={() => { setNominateOpen(false); load(); onRefresh(); }} />
        )}
        {devPlanNomineeId && (
          <DevPlanModal nomineeId={devPlanNomineeId} onClose={() => setDevPlanNomineeId(null)}
            onSaved={() => { setDevPlanNomineeId(null); load(); }} />
        )}
      </div>
    </div>
  );
}

// ── 9-Box Grid View ───────────────────────────────────────────────────────────
function NineBoxView() {
  const [data, setData] = useState<{ grid: NineBoxItem[]; byBox: Record<number, NineBoxItem[]>; unplaced: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/performance/nine-box').then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted text-sm p-4">Loading 9-box…</p>;
  if (!data) return null;

  const BOX_META: Record<number, { row: number; col: number; label: string }> = {
    1: { row: 0, col: 0, label: 'Potential Gem' },
    2: { row: 0, col: 1, label: 'Rising Star' },
    3: { row: 0, col: 2, label: 'Star' },
    4: { row: 1, col: 0, label: 'Dilemma' },
    5: { row: 1, col: 1, label: 'Core Employee' },
    6: { row: 1, col: 2, label: 'High Performer' },
    7: { row: 2, col: 0, label: 'Underperformer' },
    8: { row: 2, col: 1, label: 'Solid Contributor' },
    9: { row: 2, col: 2, label: 'Expert' },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-accent inline-block" /> READY_NOW</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-highlight inline-block" /> 1 YEAR</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-muted inline-block" /> 2 YEARS</span>
      </div>

      {/* Y-axis label */}
      <div className="flex gap-2">
        <div className="flex flex-col items-center justify-center w-6 shrink-0">
          <span className="text-xs text-muted -rotate-90 whitespace-nowrap">Potential ↑</span>
        </div>
        <div className="flex-1">
          {/* Column headers */}
          <div className="grid grid-cols-3 gap-2 mb-2 pl-0">
            {['Low Perf', 'Med Perf', 'High Perf'].map(h => (
              <div key={h} className="text-xs text-muted text-center">{h}</div>
            ))}
          </div>
          {/* Row labels + grid */}
          {['High Pot', 'Med Pot', 'Low Pot'].map((rowLabel, rIdx) => (
            <div key={rIdx} className="flex gap-2 mb-2 items-stretch">
              <div className="w-14 shrink-0 flex items-center">
                <span className="text-xs text-muted">{rowLabel}</span>
              </div>
              {[1, 2, 3].map(cIdx => {
                const boxNum = rIdx * 3 + cIdx;
                const items = data.byBox[boxNum] || [];
                return (
                  <div key={boxNum} className={`flex-1 min-h-[80px]  p-2 ${BOX_COLOR[boxNum]} border border-shadow`}>
                    <p className="text-xs font-medium text-muted mb-1">{BOX_META[boxNum].label}</p>
                    {items.length === 0 ? (
                      <p className="text-xs text-ink italic">—</p>
                    ) : (
                      items.map(item => (
                        <div key={item.nomineeId} className="text-xs text-paper flex items-center gap-1 mb-0.5">
                          <span className={`w-1.5 h-1.5  shrink-0 ${
                            item.readiness === 'READY_NOW' ? 'bg-accent' :
                            item.readiness === 'ONE_YEAR'  ? 'bg-highlight'   : 'bg-muted'
                          }`} />
                          <span className="truncate">{empName(item._employee) || item.employeeId}</span>
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

      {data.unplaced.length > 0 && (
        <div className="bg-highlight border border-highlight p-3">
          <p className="text-xs font-medium text-highlight mb-1">Unplaced ({data.unplaced.length}) — no finalised appraisal</p>
          {data.unplaced.map((u: any) => (
            <p key={u.nomineeId} className="text-xs text-muted">{empName(u._employee) || u.employeeId}: {u.reason}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Risk Report View ──────────────────────────────────────────────────────────
function RiskReportView() {
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/performance/succession/risk-report').then(setReport).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted text-sm p-4">Loading risk report…</p>;
  if (!report) return null;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'High Risk', value: report.summary.high, color: 'text-ink' },
          { label: 'Medium Risk', value: report.summary.medium, color: 'text-ink' },
          { label: 'Low Risk', value: report.summary.low, color: 'text-accent' },
        ].map(s => (
          <div key={s.label} className="bg-shadow border border-shadow p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted uppercase border-b border-shadow">
              <th className="text-left py-2 pr-4">Position</th>
              <th className="text-left py-2 pr-4">Dept</th>
              <th className="text-center py-2 pr-4">Risk</th>
              <th className="text-center py-2 pr-4">Nominees</th>
              <th className="text-center py-2 pr-4">Ready Now</th>
              <th className="text-center py-2 pr-4">1 Year</th>
              <th className="text-center py-2">2 Years</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row: any) => (
              <tr key={row.positionId} className="border-b border-shadow hover:bg-shadow">
                <td className="py-2 pr-4 text-paper font-medium">{row.jobTitle}</td>
                <td className="py-2 pr-4 text-muted">{row.department || '—'}</td>
                <td className="py-2 pr-4 text-center">
                  <span className={`text-xs font-medium px-2 py-0.5  ${RISK_COLOR[row.riskLevel]}`}>
                    {row.riskLevel}
                  </span>
                </td>
                <td className="py-2 pr-4 text-center text-muted">{row.totalNominees}</td>
                <td className="py-2 pr-4 text-center text-accent">{row.readyCounts.READY_NOW || 0}</td>
                <td className="py-2 pr-4 text-center text-ink">{row.readyCounts.ONE_YEAR || 0}</td>
                <td className="py-2 text-center text-muted">{row.readyCounts.TWO_YEARS || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
        apiFetch('/api/performance/key-positions'),
        apiFetch('/api/performance/succession/dashboard'),
      ]);
      setPositions(posData);
      setDashboard(dashData);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filtered = riskFilter ? positions.filter(p => p.riskLevel === riskFilter) : positions;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-paper">Succession Planning</h1>
          <p className="text-sm text-muted mt-1">Key position identification, talent pool management, and 9-box grid</p>
        </div>
        {isHR && (
          <button onClick={() => setAddOpen(true)}
            className="px-4 py-2 bg-accent hover:bg-accent text-paper text-sm font-medium ">
            + Add Key Position
          </button>
        )}
      </div>

      {/* Dashboard KPI Cards */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Key Positions', value: dashboard.totalPositions, color: 'text-paper' },
            { label: 'Total Nominees', value: dashboard.totalNominees, color: 'text-accent' },
            { label: 'Ready Now', value: dashboard.byReadiness.readyNow, color: 'text-accent' },
            { label: 'Coverage Rate', value: `${dashboard.coverageRate}%`, color: dashboard.coverageRate >= 70 ? 'text-accent' : 'text-ink' },
          ].map(kpi => (
            <div key={kpi.label} className="bg-shadow border border-shadow p-4">
              <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
              <p className="text-xs text-muted mt-1">{kpi.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* High-Risk Alert */}
      {dashboard && dashboard.byRisk.high > 0 && (
        <div className="bg-ink border border-ink p-3 flex items-start gap-2">
          <span className="text-ink mt-0.5">⚠</span>
          <div>
            <p className="text-sm font-medium text-ink">
              {dashboard.byRisk.high} position{dashboard.byRisk.high > 1 ? 's' : ''} at HIGH succession risk
            </p>
            <p className="text-xs text-ink mt-0.5">
              {dashboard.highRiskPositions.slice(0, 3).map(p => p.jobTitle).join(', ')}
              {dashboard.highRiskPositions.length > 3 ? ` +${dashboard.highRiskPositions.length - 3} more` : ''}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-shadow border border-shadow p-1 w-fit">
        {(['positions', 'nine-box', 'risk-report'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 text-sm  font-medium transition-colors ${
              tab === t ? 'bg-accent text-paper' : 'text-muted hover:text-paper'
            }`}>
            {t === 'positions' ? 'Key Positions' : t === 'nine-box' ? '9-Box Grid' : 'Risk Report'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'positions' && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex gap-2">
            {['', 'HIGH', 'MEDIUM', 'LOW'].map(r => (
              <button key={r} onClick={() => setRiskFilter(r)}
                className={`text-xs px-3 py-1  border transition-colors ${
                  riskFilter === r ? 'bg-muted border-rule text-paper' : 'border-shadow text-muted hover:border-rule'
                }`}>
                {r || 'All'}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-muted text-sm">Loading positions…</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted">
              <p className="text-4xl mb-3">◈</p>
              <p className="text-sm">No key positions defined yet.</p>
              {isHR && <p className="text-xs mt-1">Click "Add Key Position" to get started.</p>}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(pos => (
                <button key={pos.id} onClick={() => setSelectedPosition(pos)}
                  className="bg-shadow border border-shadow hover:border-rule p-4 text-left transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-paper truncate">{pos.jobTitle}</p>
                      {pos.department && <p className="text-xs text-muted">{pos.department}</p>}
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5  shrink-0 ${RISK_COLOR[pos.riskLevel]}`}>
                      {pos.riskLevel}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-xs text-muted">
                    <span>{pos.nominees.length} nominee{pos.nominees.length !== 1 ? 's' : ''}</span>
                    {pos.nominees.filter(n => n.readiness === 'READY_NOW').length > 0 && (
                      <span className="text-accent">
                        {pos.nominees.filter(n => n.readiness === 'READY_NOW').length} ready now
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'nine-box' && <NineBoxView />}
      {tab === 'risk-report' && <RiskReportView />}

      {/* Modals */}
      {addOpen && (
        <AddPositionModal onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); loadAll(); }} />
      )}
      {selectedPosition && (
        <PositionDetail position={selectedPosition} onClose={() => setSelectedPosition(null)} onRefresh={loadAll} />
      )}
    </div>
  );
}
