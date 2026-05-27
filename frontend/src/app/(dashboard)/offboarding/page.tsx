'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

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
  CONTRACT_END: 'Contract End',
};

const STATUS_COLOR: Record<string, string> = {
  INITIATED:        'bg-slate-50 text-slate-600 border-slate-200',
  IN_PROGRESS:      'bg-amber-50 text-amber-600 border-amber-100',
  CLEARANCE_DONE:   'bg-indigo-50 text-indigo-600 border-indigo-100',
  PAYROLL_COMPUTED: 'bg-blue-50 text-blue-600 border-blue-100',
  COMPLETED:        'bg-emerald-50 text-emerald-600 border-emerald-100',
};

const STATUS_LABEL: Record<string, string> = {
  INITIATED:        'Initiated',
  IN_PROGRESS:      'In Progress',
  CLEARANCE_DONE:   'Clearance Done',
  PAYROLL_COMPUTED: 'Payroll Computed',
  COMPLETED:        'Completed',
};

function calcProgress(items: ClearanceItem[]) {
  if (!items.length) return 0;
  return Math.round((items.filter(i => i.isDone).length / items.length) * 100);
}

// ── Initiate Modal ─────────────────────────────────────────────────────────────
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
    apiFetch('/api/employees?isActive=true&limit=500')
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
      const res = await apiFetch('/api/offboarding/initiate', {
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 backdrop-blur-md p-6 animate-in fade-in duration-300">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100 animate-in slide-in-from-bottom-8">
        <div className="bg-slate-900 p-8 flex justify-between items-center">
          <div>
            <h3 className="text-xl font-black text-white tracking-tighter uppercase">Initiate Offboarding</h3>
            <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mt-1">Workforce Separation</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-2xl text-slate-400 hover:text-white transition-all font-black text-xl flex items-center justify-center">×</button>
        </div>
        <div className="p-8 space-y-5 max-h-[65vh] overflow-y-auto">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-600">{error}</div>}

          <div>
            <label className="label-form block mb-2">Employee *</label>
            {loading ? (
              <div className="h-10 bg-slate-100 rounded-xl animate-pulse" />
            ) : (
              <select
                value={form.employeeId}
                onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500"
              >
                <option value="">-- Select Employee --</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.fullName} ({e.employeeCode}) — {e.department}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="label-form block mb-2">Separation Reason *</label>
            <select
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500"
            >
              {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-form block mb-2">Last Working Date *</label>
              <input type="date" value={form.lastWorkingDate} onChange={e => setForm(f => ({ ...f, lastWorkingDate: e.target.value }))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="label-form block mb-2">Notice Given Date</label>
              <input type="date" value={form.noticeGivenDate} onChange={e => setForm(f => ({ ...f, noticeGivenDate: e.target.value }))}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500" />
            </div>
          </div>

          <div>
            <label className="label-form block mb-2">Notice Period (Days)</label>
            <input type="number" min={0} value={form.noticePeriodDays} onChange={e => setForm(f => ({ ...f, noticePeriodDays: parseInt(e.target.value) || 0 }))}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500" />
          </div>

          <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-100 rounded-xl">
            <input type="checkbox" id="isForeign" checked={form.isForeignEmployee} onChange={e => setForm(f => ({ ...f, isForeignEmployee: e.target.checked }))}
              className="w-4 h-4 accent-amber-500" />
            <label htmlFor="isForeign" className="text-[9px] font-black text-amber-700 uppercase tracking-widest cursor-pointer">
              Foreign Employee (IR21 Required)
            </label>
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-between gap-4">
          <button onClick={onClose} className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest rounded-2xl hover:bg-slate-100 transition-all">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting}
            className="px-8 py-3 bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-red-700 shadow-xl shadow-red-500/20 transition-all disabled:opacity-50">
            {submitting ? 'Initiating...' : 'Initiate Offboarding'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Manage Modal ──────────────────────────────────────────────────────────────
function ManageModal({ caseId, onClose, onUpdate }: { caseId: string; onClose: () => void; onUpdate: () => void }) {
  const [offCase, setOffCase] = useState<OffboardingCase | null>(null);
  const [empAssets, setEmpAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'checklist' | 'assets' | 'exit' | 'finalpay'>('checklist');
  const [completingItem, setCompletingItem] = useState<string | null>(null);
  const [returningAsset, setReturningAsset] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [exitForm, setExitForm] = useState({ exitInterviewDate: '', exitSatisfaction: 0, exitFeedback: '' });
  const [exitSubmitting, setExitSubmitting] = useState(false);
  const [exitSaved, setExitSaved] = useState(false);
  const [noticeServed, setNoticeServed] = useState(true);
  const [finalPayData, setFinalPayData] = useState<any | null>(null);
  const [computingFinalPay, setComputingFinalPay] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/offboarding/${caseId}`);
      const data = await res.json();
      setOffCase(data);
      setExitForm({
        exitInterviewDate: data.exitInterviewDate ? data.exitInterviewDate.slice(0, 10) : '',
        exitSatisfaction: data.exitSatisfaction || 0,
        exitFeedback: data.exitFeedback || '',
      });
      if (data.finalPayData) setFinalPayData(data.finalPayData);
      // Load employee assets
      const aRes = await apiFetch(`/api/assets/employee/${data.employeeId}`);
      const assets = await aRes.json();
      setEmpAssets(Array.isArray(assets) ? assets : []);
    } catch {}
    finally { setLoading(false); }
  }, [caseId]);

  useEffect(() => { load(); }, [load]);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000); }

  async function markItemDone(itemId: string) {
    setCompletingItem(itemId);
    try {
      const res = await apiFetch(`/api/offboarding/${caseId}/checklist/${itemId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: '' }) });
      if (res.ok) { showToast('Item marked as complete'); await load(); onUpdate(); }
    } catch {}
    finally { setCompletingItem(null); }
  }

  async function saveExitInterview() {
    setExitSubmitting(true); setExitSaved(false);
    try {
      const res = await apiFetch(`/api/offboarding/${caseId}/exit-interview`, {
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
      const res = await apiFetch(`/api/offboarding/${caseId}/compute-final-pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noticeServed }),
      });
      const data = await res.json();
      if (res.ok) { setFinalPayData(data.finalPayData ?? data); showToast('Final pay computed'); await load(); onUpdate(); }
      else showToast(data.error || 'Computation failed');
    } catch { showToast('Network error'); }
    finally { setComputingFinalPay(false); }
  }

  async function createFinalPayRun() {
    setCreatingRun(true);
    try {
      const res = await apiFetch(`/api/offboarding/${caseId}/create-final-pay-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) { showToast('Final pay run created'); await load(); onUpdate(); }
      else showToast(data.error || 'Failed to create run');
    } catch { showToast('Network error'); }
    finally { setCreatingRun(false); }
  }

  async function returnAsset(assetId: string, assetName: string) {
    setReturningAsset(assetId);
    try {
      const res = await apiFetch(`/api/assets/${assetId}/return`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'Returned during offboarding' }) });
      if (res.ok) { showToast(`${assetName} returned`); await load(); onUpdate(); }
      else { const d = await res.json(); showToast(d.error || 'Failed to return asset'); }
    } catch { showToast('Network error'); }
    finally { setReturningAsset(null); }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 backdrop-blur-md p-6">
        <div className="bg-white rounded-[2.5rem] p-16 text-xs font-black text-slate-400 uppercase tracking-widest">Loading…</div>
      </div>
    );
  }

  if (!offCase) return null;

  const progress = calcProgress(offCase.clearanceItems);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 backdrop-blur-md p-6 animate-in fade-in duration-300">
      {toast && (
        <div className="fixed top-6 right-6 z-[200] px-6 py-3 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl shadow-2xl animate-in slide-in-from-top-4">
          {toast}
        </div>
      )}
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-xl overflow-hidden border border-slate-100 animate-in slide-in-from-bottom-8 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 p-8 flex justify-between items-start shrink-0">
          <div>
            <h3 className="text-xl font-black text-white tracking-tighter uppercase">{offCase.employeeName || offCase.employeeId}</h3>
            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mt-1">
              {REASON_LABELS[offCase.reason] || offCase.reason} · Last Day: {new Date(offCase.lastWorkingDate).toLocaleDateString('en-SG')}
            </p>
            <p className="label-form mt-1">{offCase.department}</p>
            {/* Progress bar */}
            <div className="flex items-center gap-3 mt-4">
              <div className="w-40 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${progress}%` }} />
              </div>
              <span className="text-[9px] font-black text-slate-400">{progress}% complete</span>
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 bg-slate-800 border border-slate-700 rounded-2xl text-slate-400 hover:text-white transition-all font-black text-xl flex items-center justify-center shrink-0">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 shrink-0 overflow-x-auto">
          {(['checklist', 'assets', 'exit', 'finalpay'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-4 text-[9px] font-black uppercase tracking-widest transition-colors whitespace-nowrap px-3 ${tab === t ? 'text-red-600 border-b-2 border-red-500' : 'text-slate-400 hover:text-slate-600'}`}>
              {t === 'checklist'
                ? `Clearance (${offCase.clearanceItems.filter(i => i.isDone).length}/${offCase.clearanceItems.length})`
                : t === 'assets'
                  ? `Assets (${empAssets.length})`
                  : t === 'exit'
                    ? `Exit Interview${offCase.exitSatisfaction ? ` ★${offCase.exitSatisfaction}` : ''}`
                    : `Final Pay${offCase.finalPayRunId ? ' ✓' : ''}`}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6">
          {tab === 'checklist' && (
            <div className="space-y-2">
              {offCase.clearanceItems.map(item => (
                <div key={item.id} className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${item.isDone ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${item.isDone ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                    {item.isDone && <span className="text-white text-xs font-black">✓</span>}
                  </div>
                  <span className={`text-[10px] font-black uppercase tracking-wide flex-1 ${item.isDone ? 'text-emerald-700' : 'text-slate-600'}`}>{item.itemName}</span>
                  {!item.isDone && (
                    <button
                      onClick={() => markItemDone(item.id)}
                      disabled={completingItem === item.id}
                      className="px-3 py-1.5 bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-emerald-700 transition-all disabled:opacity-50 shrink-0"
                    >
                      {completingItem === item.id ? '...' : 'Done'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'assets' && (
            <div className="space-y-3">
              {empAssets.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="text-3xl mb-3">📦</div>
                  <p className="eyebrow-tight">No assets currently assigned</p>
                </div>
              ) : (
                <>
                  <p className="label-form mb-3">
                    {empAssets.length} asset{empAssets.length !== 1 ? 's' : ''} must be returned before offboarding is complete
                  </p>
                  {empAssets.map(a => (
                    <div key={a.id} className="flex items-center gap-4 p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-lg shrink-0">📱</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-black text-slate-900 uppercase tracking-tight truncate">{a.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{a.assetCode} · {a.category}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">
                          Assigned: {new Date(a.assignedAt).toLocaleDateString('en-SG')}
                        </p>
                      </div>
                      <button
                        onClick={() => returnAsset(a.id, a.name)}
                        disabled={returningAsset === a.id}
                        className="px-4 py-2 bg-red-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-red-700 transition-all disabled:opacity-50 shrink-0"
                      >
                        {returningAsset === a.id ? 'Returning...' : 'Return'}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {tab === 'finalpay' && (
            <div className="space-y-5">
              {/* Notice toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                <div>
                  <p className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Notice Period Served?</p>
                  <p className="text-[9px] font-bold text-slate-400 mt-0.5">If not served, notice pay in lieu will be added</p>
                </div>
                <button
                  onClick={() => setNoticeServed(s => !s)}
                  className={`w-12 h-6 rounded-full border-2 transition-all relative ${noticeServed ? 'bg-emerald-500 border-emerald-500' : 'bg-slate-200 border-slate-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${noticeServed ? 'left-6' : 'left-0.5'}`} />
                </button>
              </div>

              {/* Compute button */}
              <button
                onClick={computeFinalPay}
                disabled={computingFinalPay}
                className="w-full py-3 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {computingFinalPay ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Computing…</> : 'Compute Final Pay'}
              </button>

              {/* Breakdown table */}
              {finalPayData && (() => {
                const fp = finalPayData;
                const fmtS = (v: number | null | undefined) => v == null ? '—' : `$${Number(v).toFixed(2)}`;
                const fmtD = (v: number | null | undefined) => v == null ? '—' : `${Number(v).toFixed(1)} days`;
                const rows = [
                  { label: 'Salary for days worked', days: fp.daysWorked, amount: fp.salaryForDaysWorked },
                  { label: 'Notice pay in lieu', days: fp.noticePeriodDays > 0 && !noticeServed ? fp.noticePeriodDays : null, amount: fp.noticePay },
                  { label: 'Leave encashment (unused AL)', days: fp.unusedAL, amount: fp.leaveEncashment },
                  { label: 'Excess leave deduction', days: fp.excessAL > 0 ? fp.excessAL : null, amount: fp.excessAL > 0 ? -(fp.excessLeaveDeduction ?? 0) : null },
                  { label: 'Outstanding claims', days: null, amount: fp.outstandingClaims },
                ];
                return (
                  <div className="border border-slate-200 rounded-2xl overflow-hidden">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-50 border-b border-slate-200 label-form">
                        <tr>
                          <th className="px-4 py-3">Component</th>
                          <th className="px-4 py-3 text-right">Days</th>
                          <th className="px-4 py-3 text-right">SGD</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((r, i) => r.amount != null && r.amount !== 0 ? (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-bold text-slate-700">{r.label}</td>
                            <td className="px-4 py-3 text-right font-mono text-slate-500">{r.days != null ? fmtD(r.days) : '—'}</td>
                            <td className={`px-4 py-3 text-right font-mono font-black ${(r.amount ?? 0) < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmtS(r.amount)}</td>
                          </tr>
                        ) : null)}
                      </tbody>
                      <tfoot className="bg-slate-900">
                        <tr>
                          <td className="px-4 py-3 text-[10px] font-black text-white uppercase tracking-widest" colSpan={2}>Gross Final Pay</td>
                          <td className="px-4 py-3 text-right font-mono font-black text-emerald-400">{fmtS(fp.grossFinalPay)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })()}

              {/* Create run */}
              {finalPayData && !offCase.finalPayRunId && (
                <button
                  onClick={createFinalPayRun}
                  disabled={creatingRun}
                  className="w-full py-3 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-emerald-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  {creatingRun ? 'Creating…' : 'Create Final Pay Run'}
                </button>
              )}

              {offCase.finalPayRunId && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center">
                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">Final Pay Run Created</p>
                  <Link href="/payroll" className="mt-2 inline-block text-[10px] font-black text-indigo-600 hover:underline uppercase tracking-widest">View in Payroll →</Link>
                </div>
              )}
            </div>
          )}

          {tab === 'exit' && (
            <div className="space-y-5">
              <div>
                <label className="label-form block mb-2">Interview Date</label>
                <input
                  type="date"
                  value={exitForm.exitInterviewDate}
                  onChange={e => setExitForm(f => ({ ...f, exitInterviewDate: e.target.value }))}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="label-form block mb-2">Satisfaction Rating (1–5)</label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setExitForm(f => ({ ...f, exitSatisfaction: n }))}
                      className={`w-10 h-10 rounded-xl text-base font-black border transition-all ${exitForm.exitSatisfaction >= n ? 'bg-amber-400 border-amber-400 text-white' : 'bg-slate-50 border-slate-200 text-slate-300 hover:border-amber-300'}`}
                    >
                      ★
                    </button>
                  ))}
                  {exitForm.exitSatisfaction > 0 && (
                    <span className="ml-2 text-xs font-black text-amber-600">{exitForm.exitSatisfaction}/5</span>
                  )}
                  {exitForm.exitSatisfaction > 0 && (
                    <button onClick={() => setExitForm(f => ({ ...f, exitSatisfaction: 0 }))} className="ml-1 text-[9px] font-black text-slate-400 hover:text-red-500 uppercase">clear</button>
                  )}
                </div>
              </div>
              <div>
                <label className="label-form block mb-2">Exit Feedback / Notes</label>
                <textarea
                  rows={4}
                  value={exitForm.exitFeedback}
                  onChange={e => setExitForm(f => ({ ...f, exitFeedback: e.target.value }))}
                  placeholder="Key themes, improvement suggestions, reason for leaving..."
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
              <button
                onClick={saveExitInterview}
                disabled={exitSubmitting}
                className={`w-full py-3 text-[10px] font-black uppercase tracking-widest rounded-2xl transition-all disabled:opacity-50 ${exitSaved ? 'bg-emerald-600 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-500/20'}`}
              >
                {exitSaved ? 'Saved ✓' : exitSubmitting ? 'Saving...' : 'Save Exit Interview'}
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-between gap-4 shrink-0">
          <button onClick={onClose} className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest rounded-2xl hover:bg-slate-100 transition-all">Close</button>
          <Link href="/payroll" className="px-8 py-3 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 transition-all">
            Final Pay →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function OffboardingPage() {
  const [cases, setCases] = useState<OffboardingCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInitiate, setShowInitiate] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseSort, setCaseSort] = useState<{ col: 'name' | 'type' | 'lastDay' | 'progress' | 'status'; dir: 'asc' | 'desc' }>({ col: 'lastDay', dir: 'asc' });

  const loadCases = useCallback(async () => {
    try {
      const res = await apiFetch('/api/offboarding');
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
  function CaseSortIcon({ col }: { col: typeof caseSort.col }) {
    return <span className="text-[8px] ml-1">{caseSort.col === col ? (caseSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

  return (
    <div className="flex flex-col gap-8 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-36 h-36 bg-red-500/5 rounded-full blur-3xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-red-500 rounded-full" />
            <span className="text-[10px] font-black text-red-600 uppercase tracking-[0.4em]">Workforce Separation Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Offboarding <span className="text-red-500">Management</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest max-w-xl">
            Final pay computation, IR21 tax clearance, asset return, IT access revocation, and exit interview governance.
          </p>
        </div>
        <div className="flex flex-wrap gap-4 relative z-10">
          <button
            onClick={() => setShowInitiate(true)}
            className="px-8 py-4 bg-red-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-red-700 shadow-xl shadow-red-500/20 transition-all active:scale-95"
          >
            + Initiate Offboarding
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Active Cases',     value: activeCases.length.toString(),  color: 'text-amber-600',   bg: 'bg-amber-50 border-amber-100' },
          { label: 'Completed (MTD)',  value: completedMTD.toString(),        color: 'text-emerald-600', bg: 'bg-white border-slate-100' },
          { label: 'IR21 Filing Due',  value: ir21Due.toString(),             color: 'text-red-600',     bg: 'bg-red-50 border-red-100' },
          { label: 'Assets Pending',   value: assetsPending.toString(),       color: 'text-indigo-600',  bg: 'bg-indigo-50 border-indigo-100' },
        ].map((k) => (
          <div key={k.label} className={`p-8 rounded-[2rem] border shadow-2xl shadow-indigo-500/5 ${k.bg}`}>
            <p className="label-form mb-4">{k.label}</p>
            <h3 className={`text-3xl font-black tracking-tighter ${k.color}`}>{k.value}</h3>
          </div>
        ))}
      </div>

      {/* Cases Table */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex items-center gap-4">
          <div className="w-2 h-8 bg-red-500 rounded-full" />
          <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Separation Cases</h3>
          <span className="ml-auto label-form">{cases.length} total</span>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-16 text-center text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse">Loading cases…</div>
          ) : cases.length === 0 ? (
            <div className="p-16 text-center">
              <p className="eyebrow-tight">No offboarding cases yet</p>
              <button onClick={() => setShowInitiate(true)} className="mt-4 px-6 py-2 bg-red-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-red-700 transition-all">
                Initiate First Case
              </button>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-50">
                <tr>
                  {([
                    { col: 'name',     label: 'Employee',        cls: 'px-8 py-6' },
                    { col: 'type',     label: 'Separation Type', cls: 'px-8 py-6' },
                    { col: 'lastDay',  label: 'Last Day',        cls: 'px-8 py-6' },
                    { col: 'progress', label: 'Progress',        cls: 'px-8 py-6' },
                    { col: 'status',   label: 'Status',          cls: 'px-8 py-6' },
                    { col: null,       label: 'Actions',         cls: 'px-8 py-6 text-right' },
                  ] as const).map(h => (
                    <th key={h.label} className={h.cls}>
                      {h.col ? (
                        <button onClick={() => toggleCaseSort(h.col!)} className="flex items-center hover:text-slate-600 transition-colors">
                          {h.label}<CaseSortIcon col={h.col} />
                        </button>
                      ) : h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sortedCases.map((c) => {
                  const progress = calcProgress(c.clearanceItems);
                  const initials = (c.employeeName || c.employeeId).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                  return (
                    <tr key={c.id} className="group hover:bg-slate-50/50 transition-all">
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-[10px] font-black text-indigo-400 shrink-0">
                            {initials}
                          </div>
                          <div>
                            <p className="text-xs font-black text-slate-900 uppercase tracking-tight group-hover:text-red-600 transition-colors">{c.employeeName || 'Unknown'}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{c.department}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{REASON_LABELS[c.reason] || c.reason}</span>
                      </td>
                      <td className="px-8 py-5">
                        <span className="text-[10px] font-black text-slate-400 uppercase">
                          {new Date(c.lastWorkingDate).toLocaleDateString('en-SG')}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className="w-32 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${progress === 100 ? 'bg-emerald-500' : 'bg-indigo-600'}`} style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-[10px] font-black text-slate-500">{progress}%</span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <span className={`text-[9px] font-black px-3 py-1.5 rounded-full border uppercase tracking-widest ${STATUS_COLOR[c.status] || 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                          {STATUS_LABEL[c.status] || c.status}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button
                          onClick={() => setSelectedCaseId(c.id)}
                          className="px-5 py-2 bg-white border border-slate-200 rounded-xl text-[9px] font-black text-slate-500 uppercase tracking-widest hover:border-red-500 hover:text-red-600 transition-all"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Modals */}
      {showInitiate && (
        <InitiateModal
          onClose={() => setShowInitiate(false)}
          onSuccess={() => { setShowInitiate(false); loadCases(); }}
        />
      )}

      {selectedCaseId && (
        <ManageModal
          caseId={selectedCaseId}
          onClose={() => setSelectedCaseId(null)}
          onUpdate={loadCases}
        />
      )}
    </div>
  );
}
