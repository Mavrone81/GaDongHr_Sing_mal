'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { apiFetchRaw } from '@/lib/api';
import { Seal } from '@/components/official';
import {
  PageHeader, Stat, DataTable, Card, CardHeader, Button, Badge, EmptyState, Field, Input, Select, Textarea, Modal, Icon,
  Stepper, Avatar, useToast,
  type Column, type BadgeTone, type ToastTone,
} from '@/components/ui';

interface ClearanceItem {
  id: string;
  itemName: string;
  description?: string;
  isDone: boolean;
  completedAt?: string;
  notes?: string;
}

interface OffboardingCase {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  reason: string;
  lastWorkingDate: string;
  noticeGivenDate: string;
  isForeignEmployee: boolean;
  ir21Status?: string;
  status: string;
  createdAt: string;
  clearanceItems: ClearanceItem[];
  exitInterviewDate?: string;
  exitSatisfaction?: number;
  exitFeedback?: string;
  finalPayData?: any;
  finalPayRunId?: string;
}

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string;
  designation: string;
  isActive: boolean;
}

interface AssetItem {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  assignedAt: string;
  assignmentId: string;
}

const REASON_LABELS: Record<string, string> = {
  RESIGNATION: 'Resignation',
  TERMINATION: 'Termination',
  RETIREMENT: 'Retirement',
  REDUNDANCY: 'Redundancy',
  CONTRACT_END: 'Contract end',
};

/**
 * Offboarding is a pipeline, so each stage gets its own appearance: grey at the
 * start, brass-orange while clearance runs, accent once cleared, brass when
 * money is computed but not paid, green when closed. "Money still owed" and
 * "finished" must never look the same on a list of leavers.
 */
const STATUS_TONE: Record<string, BadgeTone> = {
  INITIATED:        'neutral',
  IN_PROGRESS:      'warn',
  CLEARANCE_DONE:   'accent',
  PAYROLL_COMPUTED: 'brass',
  COMPLETED:        'ok',
};

const STATUS_LABEL: Record<string, string> = {
  INITIATED:        'Initiated',
  IN_PROGRESS:      'In progress',
  CLEARANCE_DONE:   'Clearance done',
  PAYROLL_COMPUTED: 'Final pay computed',
  COMPLETED:        'Completed',
};

function calcProgress(items: ClearanceItem[]) {
  if (!items.length) return 0;
  return Math.round((items.filter(i => i.isDone).length / items.length) * 100);
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });

function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  // The width is the signal; the number beside it says the same thing in words.
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div className="flex-1 h-1.5 rounded-full bg-pill overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-accent" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-muted tabular-nums w-9 text-right">{value}%</span>
    </div>
  );
}

// ── Initiate offboarding ──────────────────────────────────────────────────────
function InitiateModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    employeeId: '',
    reason: 'RESIGNATION',
    lastWorkingDate: '',
    noticeGivenDate: new Date().toISOString().slice(0, 10),
    noticePeriodDays: 30,
    isForeignEmployee: false,
  });

  useEffect(() => {
    apiFetchRaw('/employees?isActive=true&limit=500')
      .then(r => r.json())
      .then(d => setEmployees(d.employees || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectedEmp = employees.find(e => e.id === form.employeeId);

  async function handleSubmit() {
    if (!form.employeeId || !form.lastWorkingDate) { setError('Please select an employee and last working date.'); return; }
    setSubmitting(true); setError('');
    try {
      const res = await apiFetchRaw('/offboarding/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: form.employeeId,
          employeeName: selectedEmp?.fullName || '',
          department: selectedEmp?.department || '',
          reason: form.reason,
          lastWorkingDate: form.lastWorkingDate,
          noticeGivenDate: form.noticeGivenDate,
          noticePeriodDays: form.noticePeriodDays,
          isForeignEmployee: form.isForeignEmployee,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to initiate offboarding');
        return;
      }
      onSuccess();
    } catch { setError('Network error'); }
    finally { setSubmitting(false); }
  }

  const missing = !!error && error.startsWith('Please select');

  return (
    <Modal
      open
      title="Start offboarding"
      caption="Opens a case with the standard clearance checklist."
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={submitting}>{submitting ? 'Starting…' : 'Start offboarding'}</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
      {error && !missing && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Field label="Employee" required error={missing && !form.employeeId ? 'Select an employee' : undefined}>
        {loading ? <div className="h-[42px] rounded-control bg-pill animate-pulse" /> : (
          <Select value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))} invalid={missing && !form.employeeId}>
            <option value="">Select employee</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.fullName} ({e.employeeCode}) · {e.department}</option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Reason for leaving" required>
        <Select value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}>
          {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Last working day" required error={missing && !form.lastWorkingDate ? 'Pick the last working day' : undefined}>
          <Input type="date" value={form.lastWorkingDate} onChange={e => setForm(f => ({ ...f, lastWorkingDate: e.target.value }))} invalid={missing && !form.lastWorkingDate} />
        </Field>
        <Field label="Notice given on">
          <Input type="date" value={form.noticeGivenDate} onChange={e => setForm(f => ({ ...f, noticeGivenDate: e.target.value }))} />
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <Field label="Notice period (days)">
          <Input type="number" min={0} value={form.noticePeriodDays} onChange={e => setForm(f => ({ ...f, noticePeriodDays: parseInt(e.target.value) || 0 }))} className="tabular-nums" />
        </Field>
        {/* s.10 sets notice by length of service and requires it to be the
            same in either direction. A figure entered below the floor is a
            wrongful-dismissal claim, so the rule sits beside the input. */}
        <span className="flex items-center gap-2 text-xs text-muted">
          <Seal cite="EA s.10 · by length of service" />
          Must be the same whichever side gives notice.
        </span>
      </div>

      <label className="flex items-start gap-3 p-3.5 rounded-control border border-rule bg-page cursor-pointer">
        <input type="checkbox" checked={form.isForeignEmployee} onChange={e => setForm(f => ({ ...f, isForeignEmployee: e.target.checked }))}
          className="mt-0.5 w-4 h-4 accent-accent shrink-0" />
        <span className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-ink">Foreign employee, IR21 required</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Seal cite="ITA s.68(6) · 1 month before cessation" />
            File tax clearance and withhold monies due.
          </span>
        </span>
      </label>
      </div>
    </Modal>
  );
}

// ── Case process: clearance → assets → exit interview → final pay ────────────
type Step = 'checklist' | 'assets' | 'exit' | 'finalpay';

function CaseProcess({ caseId, onClose, onUpdate }: { caseId: string; onClose: () => void; onUpdate: () => void }) {
  const [offCase, setOffCase] = useState<OffboardingCase | null>(null);
  const [empAssets, setEmpAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Step>('checklist');
  const [completingItem, setCompletingItem] = useState<string | null>(null);
  const [returningAsset, setReturningAsset] = useState<string | null>(null);
  const { toast } = useToast();
  const [exitForm, setExitForm] = useState({ exitInterviewDate: '', exitSatisfaction: 0, exitFeedback: '' });
  const [exitSubmitting, setExitSubmitting] = useState(false);
  const [exitSaved, setExitSaved] = useState(false);
  const [noticeServed, setNoticeServed] = useState(true);
  const [finalPayData, setFinalPayData] = useState<any | null>(null);
  const [computingFinalPay, setComputingFinalPay] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetchRaw(`/offboarding/${caseId}`);
      const data = await res.json();
      setOffCase(data);
      setExitForm({
        exitInterviewDate: data.exitInterviewDate ? data.exitInterviewDate.slice(0, 10) : '',
        exitSatisfaction: data.exitSatisfaction || 0,
        exitFeedback: data.exitFeedback || '',
      });
      if (data.finalPayData) setFinalPayData(data.finalPayData);
      // Load employee assets
      const aRes = await apiFetchRaw(`/assets/employee/${data.employeeId}`);
      const assets = await aRes.json();
      setEmpAssets(Array.isArray(assets) ? assets : []);
    } catch {}
    finally { setLoading(false); }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  // Same messages as before; the tone now says whether it worked.
  function showToast(msg: string, tone: ToastTone = 'ok') { toast(msg, tone); }

  async function markItemDone(itemId: string) {
    setCompletingItem(itemId);
    try {
      const res = await apiFetchRaw(`/offboarding/${caseId}/checklist/${itemId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: '' }) });
      if (res.ok) { showToast('Item marked as complete'); await load(); onUpdate(); }
    } catch {}
    finally { setCompletingItem(null); }
  }

  async function saveExitInterview() {
    setExitSubmitting(true); setExitSaved(false);
    try {
      const res = await apiFetchRaw(`/offboarding/${caseId}/exit-interview`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exitInterviewDate: exitForm.exitInterviewDate || null,
          exitSatisfaction: exitForm.exitSatisfaction || null,
          exitFeedback: exitForm.exitFeedback || null,
        }),
      });
      if (res.ok) { setExitSaved(true); showToast('Exit interview saved'); await load(); onUpdate(); }
    } catch {}
    finally { setExitSubmitting(false); }
  }

  async function computeFinalPay() {
    setComputingFinalPay(true);
    try {
      const res = await apiFetchRaw(`/offboarding/${caseId}/compute-final-pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noticeServed }),
      });
      const data = await res.json();
      if (res.ok) { setFinalPayData(data.finalPayData ?? data); showToast('Final pay computed'); await load(); onUpdate(); }
      else showToast(data.error || 'Computation failed', 'danger');
    } catch { showToast('Network error', 'danger'); }
    finally { setComputingFinalPay(false); }
  }

  async function createFinalPayRun() {
    setCreatingRun(true);
    try {
      const res = await apiFetchRaw(`/offboarding/${caseId}/create-final-pay-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) { showToast('Final pay run created'); await load(); onUpdate(); }
      else showToast(data.error || 'Failed to create run', 'danger');
    } catch { showToast('Network error', 'danger'); }
    finally { setCreatingRun(false); }
  }

  async function returnAsset(assetId: string, assetName: string) {
    setReturningAsset(assetId);
    try {
      const res = await apiFetchRaw(`/assets/${assetId}/return`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'Returned during offboarding' }) });
      if (res.ok) { showToast(`${assetName} returned`); await load(); onUpdate(); }
      else { const d = await res.json(); showToast(d.error || 'Failed to return asset', 'danger'); }
    } catch { showToast('Network error', 'danger'); }
    finally { setReturningAsset(null); }
  }

  const back = (
    <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline self-start">
      <Icon name="chevronRight" size={15} strokeWidth={2} className="rotate-180" />All cases
    </button>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        {back}
        <div className="h-16 rounded-card bg-pill animate-pulse" />
        <div className="h-14 rounded-card bg-pill animate-pulse" />
        <div className="h-64 rounded-card bg-pill animate-pulse" />
      </div>
    );
  }

  if (!offCase) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <Card><EmptyState icon="alert" title="This case could not be loaded" description="It may have been removed, or the connection dropped. Go back and open it again." /></Card>
      </div>
    );
  }

  const progress = calcProgress(offCase.clearanceItems);
  const doneItems = offCase.clearanceItems.filter(i => i.isDone).length;
  const name = offCase.employeeName || offCase.employeeId;

  const steps: { id: Step; label: string; done: boolean; detail: string }[] = [
    { id: 'checklist', label: 'Clearance', done: offCase.clearanceItems.length > 0 && doneItems === offCase.clearanceItems.length, detail: `${doneItems} of ${offCase.clearanceItems.length}` },
    { id: 'assets', label: 'Assets', done: empAssets.length === 0, detail: empAssets.length === 0 ? 'None held' : `${empAssets.length} to return` },
    { id: 'exit', label: 'Exit interview', done: !!(offCase.exitInterviewDate || offCase.exitSatisfaction), detail: offCase.exitSatisfaction ? `Rated ${offCase.exitSatisfaction} of 5` : 'Not recorded' },
    { id: 'finalpay', label: 'Final pay', done: !!offCase.finalPayRunId, detail: offCase.finalPayRunId ? 'Run created' : finalPayData ? 'Computed' : 'Not computed' },
  ];
  const stepIdx = steps.findIndex(s => s.id === tab);

  return (
    <div className="flex flex-col gap-6">
      {back}

      {/* Identity band */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar name={name} size={56} tone="soft" />
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink truncate">{name}</h1>
              <Badge tone={STATUS_TONE[offCase.status] || 'neutral'}>{STATUS_LABEL[offCase.status] || offCase.status}</Badge>
            </div>
            <p className="text-sm text-muted">
              {REASON_LABELS[offCase.reason] || offCase.reason} · last day <span className="tabular-nums">{fmtDate(offCase.lastWorkingDate)}</span>{offCase.department ? ` · ${offCase.department}` : ''}
            </p>
          </div>
        </div>
        <Link href="/payroll" className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-control border border-rule bg-paper text-sm font-semibold text-ink hover:bg-pill whitespace-nowrap self-start sm:self-auto">
          Open payroll
        </Link>
      </div>

      {/* Steps are not sequential — HR often jumps straight to final pay — so each is selectable. */}
      <Card padding="px-[18px] py-3.5">
        <Stepper
          steps={steps.map(s => ({ label: s.label, detail: s.detail, state: s.id === tab ? 'now' : s.done ? 'done' : 'todo' }))}
          onSelect={i => setTab(steps[i].id)}
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
        {/* Current step */}
        <Card>
          {tab === 'checklist' && (
            <>
              <CardHeader title="Clearance checklist" caption={`${doneItems} of ${offCase.clearanceItems.length} done. Tick each item as the owning team confirms it.`} />
              {offCase.clearanceItems.length === 0 ? (
                <EmptyState icon="list" title="No clearance items" description="This case was opened without a checklist." className="py-8" />
              ) : (
                <ul className="flex flex-col divide-y divide-rule -mx-1">
                  {offCase.clearanceItems.map(item => (
                    <li key={item.id} className="flex items-center gap-3 px-1 py-3">
                      <span className={`flex items-center justify-center w-6 h-6 rounded-full border-2 shrink-0 ${item.isDone ? 'bg-accent border-accent text-on-accent' : 'border-rule'}`}>
                        {item.isDone && <Icon name="check" size={13} strokeWidth={3} />}
                      </span>
                      <span className="flex flex-col flex-1 min-w-0">
                        <span className={`text-sm ${item.isDone ? 'text-muted' : 'font-semibold text-ink'}`}>{item.itemName}</span>
                        {item.isDone && item.completedAt && <span className="text-xs text-muted tabular-nums">Done {fmtDate(item.completedAt)}</span>}
                      </span>
                      {item.isDone
                        ? <Badge tone="ok">Done</Badge>
                        : <Button size="sm" variant="secondary" onClick={() => markItemDone(item.id)} disabled={completingItem === item.id}>{completingItem === item.id ? 'Saving…' : 'Mark done'}</Button>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'assets' && (
            <>
              <CardHeader title="Company assets" caption={empAssets.length > 0 ? `${empAssets.length} asset${empAssets.length !== 1 ? 's' : ''} must be returned before offboarding is complete.` : undefined} />
              {empAssets.length === 0 ? (
                <EmptyState icon="briefcase" title="No assets assigned" description="Nothing to collect from this employee." className="py-8" />
              ) : (
                <ul className="flex flex-col divide-y divide-rule -mx-1">
                  {empAssets.map(a => (
                    <li key={a.id} className="flex items-center gap-3 px-1 py-3">
                      <span className="flex items-center justify-center w-10 h-10 rounded-control bg-pill text-muted shrink-0"><Icon name="briefcase" size={18} /></span>
                      <span className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-semibold text-ink truncate">{a.name}</span>
                        <span className="text-xs text-muted truncate tabular-nums">{a.assetCode} · {a.category} · since {fmtDate(a.assignedAt)}</span>
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => returnAsset(a.id, a.name)} disabled={returningAsset === a.id}>
                        {returningAsset === a.id ? 'Returning…' : 'Mark returned'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'exit' && (
            <>
              <CardHeader title="Exit interview" caption="Recorded for trends; the employee does not see it." />
              <div className="flex flex-col gap-4 max-w-[640px]">
                <Field label="Interview date">
                  <Input type="date" value={exitForm.exitInterviewDate} onChange={e => setExitForm(f => ({ ...f, exitInterviewDate: e.target.value }))} />
                </Field>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[12.5px] font-semibold text-muted" id="sat-label">Overall satisfaction</span>
                  <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-labelledby="sat-label">
                    {[1, 2, 3, 4, 5].map(n => {
                      const on = exitForm.exitSatisfaction >= n;
                      return (
                        <button key={n} type="button" role="radio" aria-checked={exitForm.exitSatisfaction === n} aria-label={`${n} of 5`}
                          onClick={() => setExitForm(f => ({ ...f, exitSatisfaction: n }))}
                          className={`flex items-center justify-center w-10 h-10 rounded-control border transition-colors ${on ? 'border-accent bg-tint text-accent' : 'border-rule bg-paper text-faint hover:text-muted'}`}>
                          <Icon name="star" size={18} fill={on ? 'currentColor' : 'none'} />
                        </button>
                      );
                    })}
                    {exitForm.exitSatisfaction > 0 && <>
                      <span className="ml-2 text-sm font-semibold text-ink tabular-nums">{exitForm.exitSatisfaction} of 5</span>
                      <Button size="sm" variant="ghost" onClick={() => setExitForm(f => ({ ...f, exitSatisfaction: 0 }))}>Clear</Button>
                    </>}
                  </div>
                </div>
                <Field label="Feedback and notes" help="Themes, suggestions, the real reason for leaving.">
                  <Textarea rows={4} value={exitForm.exitFeedback} onChange={e => setExitForm(f => ({ ...f, exitFeedback: e.target.value }))} />
                </Field>
                <div className="flex items-center gap-3">
                  <Button onClick={saveExitInterview} disabled={exitSubmitting} icon={exitSaved ? 'check' : undefined}>
                    {exitSaved ? 'Saved' : exitSubmitting ? 'Saving…' : 'Save exit interview'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {tab === 'finalpay' && (
            <>
              <CardHeader title="Final pay" caption="Compute, check the breakdown, then create the final pay run." />
              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between gap-4 p-3.5 rounded-control border border-rule bg-page">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-ink" id="notice-served">Notice period served</span>
                    <span className="text-xs text-muted">If not, notice pay in lieu is added.</span>
                  </div>
                  <button type="button" role="switch" aria-checked={noticeServed} aria-labelledby="notice-served" onClick={() => setNoticeServed(s => !s)}
                    className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${noticeServed ? 'bg-accent' : 'bg-rule'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-paper shadow-card transition-all ${noticeServed ? 'left-[22px]' : 'left-0.5'}`} />
                    <span className="sr-only">{noticeServed ? 'Yes' : 'No'}</span>
                  </button>
                </div>

                <div>
                  <Button variant={finalPayData ? 'secondary' : 'primary'} onClick={computeFinalPay} disabled={computingFinalPay}>
                    {computingFinalPay ? 'Computing…' : finalPayData ? 'Recompute final pay' : 'Compute final pay'}
                  </Button>
                </div>

                {finalPayData && (() => {
                  const fp = finalPayData;
                  // Deductions read from the minus sign, not from colour — the
                  // same convention as the payslip. Sign goes OUTSIDE the currency
                  // symbol; `$-1234.00` is not how a negative amount is written.
                  const fmtS = (v: number | null | undefined) => {
                    if (v == null) return '—';
                    const n = Number(v);
                    return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
                  };
                  const fmtD = (v: number | null | undefined) => v == null ? '—' : `${Number(v).toFixed(1)} days`;
                  const rows = [
                    { label: 'Salary for days worked', days: fp.daysWorked, amount: fp.salaryForDaysWorked },
                    { label: 'Notice pay in lieu', days: fp.noticePeriodDays > 0 && !noticeServed ? fp.noticePeriodDays : null, amount: fp.noticePay },
                    { label: 'Leave encashment (unused AL)', days: fp.unusedAL, amount: fp.leaveEncashment },
                    { label: 'Excess leave deduction', days: fp.excessAL > 0 ? fp.excessAL : null, amount: fp.excessAL > 0 ? -(fp.excessLeaveDeduction ?? 0) : null },
                    { label: 'Outstanding claims', days: null, amount: fp.outstandingClaims },
                  ];
                  return (
                    <div className="border border-rule rounded-card overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-pill border-b border-rule">
                          <tr>
                            <th className="px-4 h-[42px] text-xs font-bold text-muted">Component</th>
                            <th className="px-4 h-[42px] text-xs font-bold text-muted text-right">Days</th>
                            <th className="px-4 h-[42px] text-xs font-bold text-muted text-right">SGD</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-rule">
                          {rows.map((r, i) => r.amount != null && r.amount !== 0 ? (
                            <tr key={i}>
                              <td className="px-4 py-3 text-ink">{r.label}</td>
                              <td className="px-4 py-3 text-right text-muted tabular-nums">{r.days != null ? fmtD(r.days) : '—'}</td>
                              <td className="px-4 py-3 text-right font-semibold text-ink tabular-nums">{fmtS(r.amount)}</td>
                            </tr>
                          ) : null)}
                        </tbody>
                        <tfoot className="border-t border-rule bg-page">
                          <tr>
                            <td className="px-4 py-3 font-bold text-ink" colSpan={2}>Gross final pay</td>
                            <td className="px-4 py-3 text-right font-extrabold text-ink tabular-nums">{fmtS(fp.grossFinalPay)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  );
                })()}

                {finalPayData && !offCase.finalPayRunId && (
                  <div className="flex flex-col gap-2 p-4 rounded-control bg-tint">
                    <span className="text-sm font-bold text-ink">Ready to confirm</span>
                    <span className="text-[13px] text-ink">Creating the run hands this amount to payroll for approval. Recompute first if anything above looks wrong.</span>
                    <div><Button onClick={createFinalPayRun} disabled={creatingRun}>{creatingRun ? 'Creating…' : 'Create final pay run'}</Button></div>
                  </div>
                )}
                {!finalPayData && <p className="text-[13px] text-muted">The final pay run can be created once final pay is computed.</p>}

                {offCase.finalPayRunId && (
                  <div className="flex items-center justify-between gap-3 p-4 rounded-control bg-tint">
                    <span className="flex items-center gap-2 text-sm font-bold text-ok"><Icon name="check" size={16} strokeWidth={2.5} />Final pay run created</span>
                    <Link href="/payroll" className="text-[13px] font-semibold text-accent hover:underline whitespace-nowrap">View in payroll</Link>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Step navigation */}
          <div className="flex items-center justify-between gap-3 mt-5 pt-4 border-t border-rule">
            <Button variant="secondary" size="sm" onClick={() => setTab(steps[stepIdx - 1].id)} disabled={stepIdx === 0} className={stepIdx === 0 ? 'invisible' : ''}>Previous</Button>
            {stepIdx < steps.length - 1 && <Button variant="secondary" size="sm" onClick={() => setTab(steps[stepIdx + 1].id)}>Next: {steps[stepIdx + 1].label.toLowerCase()}</Button>}
          </div>
        </Card>

        {/* Side: summary */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Clearance progress" />
            <ProgressBar value={progress} />
          </Card>
          <Card>
            <CardHeader title="Case" />
            <dl className="flex flex-col text-sm">
              {[
                ['Reason', REASON_LABELS[offCase.reason] || offCase.reason],
                ['Notice given', offCase.noticeGivenDate ? fmtDate(offCase.noticeGivenDate) : 'Not recorded'],
                ['Last working day', fmtDate(offCase.lastWorkingDate)],
                ['Opened', fmtDate(offCase.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5 border-t border-rule first:border-t-0">
                  <dt className="text-muted">{k}</dt>
                  <dd className="font-semibold text-ink text-right tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {offCase.isForeignEmployee && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-control border border-rule bg-paper">
              <span className="text-warn mt-0.5"><Icon name="alert" size={18} /></span>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-bold text-ink">IR21 {offCase.ir21Status && offCase.ir21Status !== 'PENDING' ? offCase.ir21Status.toLowerCase().replace(/_/g, ' ') : 'due'}</span>
                <span className="text-[13px] text-ink">Foreign employee. File tax clearance at least a month before the last day and withhold monies due.</span>
                <Seal cite="ITA s.68(6) · 1 month before cessation" />
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OffboardingPage() {
  const [cases, setCases] = useState<OffboardingCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInitiate, setShowInitiate] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseSort, setCaseSort] = useState<{ col: 'name' | 'type' | 'lastDay' | 'progress' | 'status'; dir: 'asc' | 'desc' }>({ col: 'lastDay', dir: 'asc' });

  const loadCases = useCallback(async () => {
    try {
      const res = await apiFetchRaw('/offboarding');
      const data = await res.json();
      setCases(Array.isArray(data) ? data : []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadCases(); }, [loadCases]);

  const activeCases = cases.filter(c => c.status !== 'COMPLETED');
  const completedMTD = cases.filter(c => {
    if (c.status !== 'COMPLETED') return false;
    const d = new Date(c.lastWorkingDate);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const ir21Due = cases.filter(c => c.isForeignEmployee && (!c.ir21Status || c.ir21Status === 'PENDING')).length;
  const assetsPending = cases.filter(c => c.status !== 'COMPLETED').reduce((sum, c) => sum + (c.clearanceItems?.filter(i => !i.isDone && i.itemName.toLowerCase().includes('equipment')).length || 0), 0);

  const sortedCases = [...cases].sort((a, b) => {
    const d = caseSort.dir === 'asc' ? 1 : -1;
    switch (caseSort.col) {
      case 'name':     return d * (a.employeeName || '').localeCompare(b.employeeName || '');
      case 'type':     return d * (a.reason || '').localeCompare(b.reason || '');
      case 'lastDay':  return d * (new Date(a.lastWorkingDate).getTime() - new Date(b.lastWorkingDate).getTime());
      case 'progress': return d * (calcProgress(a.clearanceItems) - calcProgress(b.clearanceItems));
      case 'status':   return d * (a.status || '').localeCompare(b.status || '');
      default: return 0;
    }
  });
  function toggleCaseSort(col: typeof caseSort.col) {
    setCaseSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  const sortHead = (col: typeof caseSort.col, label: string) => (
    <button type="button" onClick={() => toggleCaseSort(col)}
      aria-sort={caseSort.col === col ? (caseSort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className="inline-flex items-center gap-1 hover:text-ink">
      {label}
      {caseSort.col === col && <Icon name="chevronDown" size={13} strokeWidth={2.25} className={caseSort.dir === 'asc' ? 'rotate-180' : ''} />}
    </button>
  );

  if (selectedCaseId) {
    return (
      <div className="max-w-[1400px] mx-auto pb-24 lg:pb-10">
        <CaseProcess caseId={selectedCaseId} onClose={() => setSelectedCaseId(null)} onUpdate={loadCases} />
      </div>
    );
  }

  const columns: Column<OffboardingCase>[] = [
    {
      key: 'name', label: sortHead('name', 'Employee'), width: 'minmax(0, 1.6fr)',
      render: c => (
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={c.employeeName || c.employeeId} size={30} tone="soft" />
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-ink truncate">{c.employeeName || 'Unknown'}</span>
            <span className="text-xs text-muted truncate">{c.department}</span>
          </div>
        </div>
      ),
    },
    { key: 'type', label: sortHead('type', 'Reason'), render: c => REASON_LABELS[c.reason] || c.reason },
    { key: 'lastDay', label: sortHead('lastDay', 'Last day'), width: '120px', numeric: true, render: c => fmtDate(c.lastWorkingDate) },
    { key: 'progress', label: sortHead('progress', 'Clearance'), width: '160px', render: c => <ProgressBar value={calcProgress(c.clearanceItems)} /> },
    { key: 'status', label: sortHead('status', 'Status'), width: '150px', render: c => <Badge tone={STATUS_TONE[c.status] || 'neutral'}>{STATUS_LABEL[c.status] || c.status}</Badge> },
    // The row itself opens the case (a row-click table carries no buttons); the chevron says so.
    { key: 'go', label: '', width: '24px', align: 'right', render: () => <Icon name="chevronRight" size={16} className="text-faint" /> },
  ];

  const empty = (
    <EmptyState
      icon="user" title="No offboarding cases"
      description="When someone resigns or leaves, open a case to run clearance, assets, the exit interview and final pay."
      action={<Button icon="plus" onClick={() => setShowInitiate(true)}>Start offboarding</Button>}
      className="py-6"
    />
  );

  return (
    <div className="flex flex-col gap-6 max-w-[1400px] mx-auto pb-24 lg:pb-10">
      <PageHeader
        title="Offboarding"
        subtitle={loading ? 'Loading cases…' : `${activeCases.length} in progress · ${completedMTD} completed this month`}
        actions={<Button icon="plus" onClick={() => setShowInitiate(true)}>Start offboarding</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="In progress" value={loading ? '—' : activeCases.length} />
        <Stat label="Completed this month" value={loading ? '—' : completedMTD} />
        <Stat label="IR21 filings due" value={loading ? '—' : ir21Due} note={ir21Due > 0 ? 'Foreign employees leaving' : undefined} />
        <Stat label="Equipment to collect" value={loading ? '—' : assetsPending} note="Open clearance items" />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-[52px] bg-pill rounded-card animate-pulse" />)}
        </div>
      ) : (
        <DataTable
          aria-label="Offboarding cases"
          columns={columns}
          rows={sortedCases}
          rowKey={c => c.id}
          onRowClick={c => setSelectedCaseId(c.id)}
          empty={empty}
          mobileCard={c => (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={c.employeeName || c.employeeId} size={32} tone="soft" />
                  <div className="flex flex-col min-w-0">
                    <span className="font-semibold text-ink truncate">{c.employeeName || 'Unknown'}</span>
                    <span className="text-xs text-muted truncate">{REASON_LABELS[c.reason] || c.reason} · last day <span className="tabular-nums">{fmtDate(c.lastWorkingDate)}</span></span>
                  </div>
                </div>
                <Badge tone={STATUS_TONE[c.status] || 'neutral'}>{STATUS_LABEL[c.status] || c.status}</Badge>
              </div>
              <ProgressBar value={calcProgress(c.clearanceItems)} />
            </div>
          )}
          footer={cases.length > 0 ? <span className="tabular-nums">{cases.length} case{cases.length === 1 ? '' : 's'}</span> : undefined}
        />
      )}

      {showInitiate && (
        <InitiateModal
          onClose={() => setShowInitiate(false)}
          onSuccess={() => { setShowInitiate(false); loadCases(); }}
        />
      )}
    </div>
  );
}
