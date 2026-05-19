'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch, getAccessToken } from '@/lib/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtSGD(n: number) {
  return n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPeriod(period: string) {
  const [y, m] = period.split('-');
  const d = new Date(parseInt(y), parseInt(m) - 1);
  return d.toLocaleString('en-SG', { month: 'long', year: 'numeric' });
}

function resolveApiBase() {
  const h = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return process.env.NEXT_PUBLIC_API_URL ?? `http://${h}:4000/api`;
}

function fmtRunStatus(s: string): string {
  const map: Record<string, string> = {
    DRAFT: 'Draft',
    PENDING_APPROVAL: 'Pending Approval',
    APPROVED: 'Approved',
    FINALISED: 'Disbursed',
    REJECTED: 'Rejected',
  };
  return map[s] ?? s;
}

// ─── GIRO reference helpers ──────────────────────────────────────────────────

function generateGiroRef(period: string): string {
  if (typeof window === 'undefined') return `P${period.replace('-', '')}000000`;
  const key = `giro_refs_${period}`;
  const used: string[] = JSON.parse(localStorage.getItem(key) || '[]');
  let ref = '';
  let tries = 0;
  do {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    ref = `P${period.replace('-', '')}${rand}`;
    tries++;
  } while (used.includes(ref) && tries < 100);
  return ref;
}

function markGiroRefUsed(period: string, ref: string) {
  if (typeof window === 'undefined' || !ref) return;
  const key = `giro_refs_${period}`;
  const used: string[] = JSON.parse(localStorage.getItem(key) || '[]');
  if (!used.includes(ref)) { used.push(ref); localStorage.setItem(key, JSON.stringify(used)); }
}

// ─── Employee self-service payslip view ──────────────────────────────────────

interface Payslip {
  id: string;
  period: string;
  basicSalary: number;
  grossPay: number;
  netPay: number;
  employeeCpf: number;
  ytdGross: number | null;
  ytdEmployeeCpf: number | null;
}

export function EmployeePayslipsView() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [dlToast, setDlToast] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiFetch('/payroll/payslips/me');
        setPayslips(data.payslips ?? []);
      } catch (e: any) {
        setError(e.message || 'Failed to load payslips');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const years = useMemo(() => {
    const s = new Set(payslips.map(p => p.period.slice(0, 4)));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [payslips]);

  const filtered = useMemo(() => {
    if (selectedYear === 'all') return payslips;
    return payslips.filter(p => p.period.startsWith(selectedYear));
  }, [payslips, selectedYear]);

  const ytdStats = useMemo(() => {
    const list = selectedYear === 'all' ? payslips : filtered;
    return {
      gross: list.reduce((s, p) => s + p.grossPay, 0),
      net: list.reduce((s, p) => s + p.netPay, 0),
      cpf: list.reduce((s, p) => s + p.employeeCpf, 0),
    };
  }, [filtered, payslips, selectedYear]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(p => p.id)));
    }
  };

  const downloadPdf = async (period: string, label?: string) => {
    setDownloading(period);
    try {
      const res = await fetch(`${resolveApiBase()}/payroll/payslips/me/${period}`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip-${period}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setDlToast(`Downloaded: ${label || period}`);
      setTimeout(() => setDlToast(null), 2500);
    } catch {
      setDlToast('Download failed — payslip may not be available yet');
      setTimeout(() => setDlToast(null), 3000);
    } finally {
      setDownloading(null);
    }
  };

  const bulkDownload = async () => {
    const targets = filtered.filter(p => selected.size === 0 || selected.has(p.id));
    if (!targets.length) return;
    setBulkDownloading(true);
    for (let i = 0; i < targets.length; i++) {
      await downloadPdf(targets[i].period);
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, 400));
    }
    setBulkDownloading(false);
    setDlToast(`Downloaded ${targets.length} payslip${targets.length > 1 ? 's' : ''}`);
    setTimeout(() => setDlToast(null), 3000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest animate-pulse">Loading payslips…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 max-w-[1200px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/3 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-2 h-2 bg-indigo-600 rounded-full" />
              <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.4em]">Employee Self-Service</span>
            </div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tighter">My <span className="text-indigo-600">Payslips</span></h1>
            <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest">
              Your personal salary statements and CPF contribution history
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="px-6 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Records</p>
              <p className="text-2xl font-black text-slate-900 mt-1">{payslips.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
            {selectedYear === 'all' ? 'All-Time' : selectedYear} Gross Pay
          </p>
          <p className="text-3xl font-black text-slate-900 tracking-tighter">SGD {fmtSGD(ytdStats.gross)}</p>
        </div>
        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
            {selectedYear === 'all' ? 'All-Time' : selectedYear} Net Pay
          </p>
          <p className="text-3xl font-black text-indigo-600 tracking-tighter">SGD {fmtSGD(ytdStats.net)}</p>
        </div>
        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
            {selectedYear === 'all' ? 'All-Time' : selectedYear} Employee CPF
          </p>
          <p className="text-3xl font-black text-slate-900 tracking-tighter">SGD {fmtSGD(ytdStats.cpf)}</p>
        </div>
      </div>

      {/* Payslip Table */}
      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">

        {/* Table header with year tabs + bulk download */}
        <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setSelectedYear('all')}
              className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                selectedYear === 'all' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-white border border-slate-200 text-slate-500 hover:text-indigo-600'
              }`}
            >
              All Years
            </button>
            {years.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  selectedYear === y ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-white border border-slate-200 text-slate-500 hover:text-indigo-600'
                }`}
              >
                {y}
              </button>
            ))}
          </div>

          {filtered.length > 0 && (
            <button
              onClick={bulkDownload}
              disabled={bulkDownloading}
              className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-indigo-600 transition-all shadow-xl disabled:opacity-60 disabled:pointer-events-none"
            >
              {bulkDownloading ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Downloading…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Download {selected.size > 0 ? `${selected.size} Selected` : 'All'}
                </>
              )}
            </button>
          )}
        </div>

        {error ? (
          <div className="p-16 flex flex-col items-center gap-4">
            <div className="w-16 h-16 bg-red-50 rounded-3xl flex items-center justify-center text-2xl">⚠</div>
            <p className="text-sm font-black text-slate-500 uppercase tracking-widest">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-20 flex flex-col items-center gap-6">
            <div className="w-20 h-20 bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl flex items-center justify-center text-3xl">◆</div>
            <div className="text-center">
              <p className="text-sm font-black text-slate-400 uppercase tracking-widest">No payslips available</p>
              <p className="text-[10px] font-bold text-slate-300 uppercase mt-2 tracking-widest">Published payslips will appear here once payroll is processed</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] border-b border-slate-100 bg-slate-50/30">
                <tr>
                  <th className="px-6 py-5 w-10">
                    <button
                      onClick={toggleAll}
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                        selected.size === filtered.length && filtered.length > 0
                          ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 hover:border-indigo-400'
                      }`}
                    >
                      {selected.size === filtered.length && filtered.length > 0 && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      )}
                    </button>
                  </th>
                  <th className="px-6 py-5">Pay Period</th>
                  <th className="px-6 py-5 text-right">Basic Salary</th>
                  <th className="px-6 py-5 text-right">Gross Pay</th>
                  <th className="px-6 py-5 text-right">CPF (Employee)</th>
                  <th className="px-6 py-5 text-right">Net Pay</th>
                  <th className="px-6 py-5 text-center">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map(ps => (
                  <tr key={ps.id} className={`group transition-all ${selected.has(ps.id) ? 'bg-indigo-50/50' : 'hover:bg-slate-50/50'}`}>
                    <td className="px-6 py-5">
                      <button
                        onClick={() => toggleSelect(ps.id)}
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                          selected.has(ps.id) ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 hover:border-indigo-400'
                        }`}
                      >
                        {selected.has(ps.id) && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm font-black text-slate-900 uppercase tracking-tight group-hover:text-indigo-600 transition-colors">
                          {fmtPeriod(ps.period)}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{ps.period}</span>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <span className="text-sm font-bold text-slate-600">SGD {fmtSGD(ps.basicSalary)}</span>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <span className="text-sm font-bold text-slate-700">SGD {fmtSGD(ps.grossPay)}</span>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <span className="text-sm font-bold text-red-500 italic">- SGD {fmtSGD(ps.employeeCpf)}</span>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <span className="text-sm font-black text-indigo-600 tracking-tighter">SGD {fmtSGD(ps.netPay)}</span>
                    </td>
                    <td className="px-6 py-5 text-center">
                      <button
                        onClick={() => downloadPdf(ps.period, fmtPeriod(ps.period))}
                        disabled={downloading === ps.period}
                        className="inline-flex items-center gap-1.5 px-5 py-2 bg-indigo-50 text-indigo-600 text-[9px] font-black uppercase rounded-xl hover:bg-indigo-600 hover:text-white transition-all disabled:opacity-50 disabled:pointer-events-none"
                      >
                        {downloading === ps.period ? (
                          <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        ) : (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        )}
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="px-8 py-5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {filtered.length} payslip{filtered.length !== 1 ? 's' : ''} {selectedYear !== 'all' ? `in ${selectedYear}` : 'total'}
              {selected.size > 0 && ` · ${selected.size} selected`}
            </p>
            <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest italic">
              Only published payslips are shown
            </p>
          </div>
        )}
      </div>

      {/* Download toast */}
      {dlToast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-10 duration-500">
          <div className="bg-slate-900 border border-slate-800 px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-4">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-black text-slate-100 uppercase tracking-[0.2em]">{dlToast}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Admin payroll dashboard (unchanged, Payroll/HR Admin only) ───────────────

function AdminPayrollDashboard() {
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);

  const [reviewRunData, setReviewRunData] = useState<any | null>(null);
  const [payslipRunId, setPayslipRunId] = useState<string | null>(null);
  const [payslipRunPeriod, setPayslipRunPeriod] = useState<string>('');
  const [payslipRows, setPayslipRows] = useState<any[]>([]);
  const [payslipLoading, setPayslipLoading] = useState(false);
  const [reviewPayslips, setReviewPayslips] = useState<any[]>([]);
  const [empNameMap, setEmpNameMap] = useState<Map<string, string>>(new Map());
  const [dlProgress, setDlProgress] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [giroRunId, setGiroRunId] = useState<string | null>(null);
  const [giroDownloading, setGiroDownloading] = useState(false);
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const [giroBank, setGiroBank] = useState<'uob' | 'ocbc' | 'dbs'>('uob');
  const [giroFields, setGiroFields] = useState({
    acct: '', companyName: 'VORKHIVE PTE LTD', valueDate: todayIso(),
    ref: '', batchNo: '001', payDesc: '',
  });
  const gf = (k: keyof typeof giroFields, v: string) => setGiroFields(f => ({ ...f, [k]: v }));

  interface PayrollRun {
    id: string;
    period: string;
    runType: string;
    status: string;
    initiatedBy: string;
    approvedBy: string | null;
    createdAt: string;
    finalisedAt: string | null;
  }

  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState('2026-04');
  const [processingGroup, setProcessingGroup] = useState('all');
  const [selectedRunType, setSelectedRunType] = useState('MONTHLY');
  const [confirmCancelRun, setConfirmCancelRun] = useState(false);
  const [payComponents, setPayComponents] = useState<any[]>([]);
  const [runPaycodes, setRunPaycodes] = useState<{ [empId: string]: any[] }>({});
  const [addingPaycodeFor, setAddingPaycodeFor] = useState<string | null>(null);
  const [newPcComponentId, setNewPcComponentId] = useState('');
  const [newPcAmount, setNewPcAmount] = useState('');
  const [newPcDesc, setNewPcDesc] = useState('');
  const [paycodesDirty, setPaycodesDirty] = useState(false);
  const [reviewFullscreen, setReviewFullscreen] = useState(false);
  const [periodConflictRuns, setPeriodConflictRuns] = useState<PayrollRun[]>([]);
  const [conflictPayslips, setConflictPayslips] = useState<any[]>([]); // existing payslips for the conflict period
  const [conflictLoading, setConflictLoading] = useState(false);
  const [conflictSalaryMap, setConflictSalaryMap] = useState<Record<string, number>>({}); // employeeId → current ow
  const [variance, setVariance] = useState<any>(null);
  const [varianceLoading, setVarianceLoading] = useState(false);

  // ── Period working-day config ──────────────────────────────────────────────
  const [periodCfg, setPeriodCfg] = useState<{
    workDayType: string;
    workingDays: number;
    recommendedWorkingDays: number;
    isOverridden: boolean;
    publicHolidays: { id: string; date: string; name: string }[];
  } | null>(null);
  const [periodCfgLoading, setPeriodCfgLoading] = useState(false);
  const [periodCfgWorkDayType, setPeriodCfgWorkDayType] = useState<'FIVE_DAY' | 'SIX_DAY'>('FIVE_DAY');
  const [periodCfgOverride, setPeriodCfgOverride] = useState<string>('');
  const [periodCfgSaving, setPeriodCfgSaving] = useState(false);

  async function loadPeriodConfig(period: string) {
    setPeriodCfgLoading(true);
    try {
      const data = await apiFetch(`/payroll/period-config/${period}`);
      setPeriodCfg(data);
      setPeriodCfgWorkDayType(data.workDayType);
      setPeriodCfgOverride(data.isOverridden ? String(data.workingDays) : '');
    } catch {
      setPeriodCfg(null);
    } finally {
      setPeriodCfgLoading(false);
    }
  }

  async function savePeriodConfig() {
    setPeriodCfgSaving(true);
    try {
      const body: any = { workDayType: periodCfgWorkDayType };
      if (periodCfgOverride.trim()) body.workingDays = parseInt(periodCfgOverride);
      else body.workingDays = null;
      await apiFetch(`/payroll/period-config/${selectedPeriod}`, { method: 'PUT', body: JSON.stringify(body) });
      await loadPeriodConfig(selectedPeriod);
      handleActionToast('Period config saved');
    } catch (e: any) {
      handleActionToast(e.message || 'Failed to save period config');
    } finally {
      setPeriodCfgSaving(false);
    }
  }

  async function loadRuns() {
    try {
      setRunsLoading(true);
      const data = await apiFetch('/payroll/runs?limit=20');
      setRuns(data.runs ?? []);
    } catch (e: any) {
      console.error('[Payroll] loadRuns failed:', e.message);
    } finally {
      setRunsLoading(false);
    }
  }

  useEffect(() => { loadRuns(); }, []);
  useEffect(() => { if (isRunModalOpen && selectedPeriod) loadPeriodConfig(selectedPeriod); }, [isRunModalOpen, selectedPeriod]);

  const fetchPayslipsForRun = async (runId: string) => {
    try {
      const [psData, empData] = await Promise.allSettled([
        apiFetch(`/payroll/runs/${runId}/payslips`),
        apiFetch('/employees?limit=500&isActive=true'),
      ]);
      const nameMap = new Map<string, string>();
      if (empData.status === 'fulfilled') {
        for (const e of (empData.value.employees ?? [])) nameMap.set(e.id, e.fullName);
      }
      setEmpNameMap(nameMap);
      if (psData.status === 'fulfilled') return { payslips: psData.value.payslips ?? [], period: psData.value.period ?? '' };
    } catch {}
    return { payslips: [], period: '' };
  };

  useEffect(() => {
    if (!payslipRunId) return;
    setPayslipLoading(true);
    fetchPayslipsForRun(payslipRunId).then(({ payslips, period }) => {
      setPayslipRows(payslips);
      setPayslipRunPeriod(period);
    }).finally(() => setPayslipLoading(false));
  }, [payslipRunId]);

  useEffect(() => {
    if (!reviewRunData) { setReviewPayslips([]); setRunPaycodes({}); setAddingPaycodeFor(null); setPaycodesDirty(false); setVariance(null); return; }
    fetchPayslipsForRun(reviewRunData.id).then(({ payslips }) => setReviewPayslips(payslips));
    // Fetch variance for this run
    setVarianceLoading(true);
    apiFetch(`/payroll/runs/${reviewRunData.id}/variance`)
      .then((v: any) => setVariance(v))
      .catch(() => setVariance(null))
      .finally(() => setVarianceLoading(false));
    if (reviewRunData.status !== 'DRAFT') {
      apiFetch(`/payroll/runs/${reviewRunData.id}/paycodes`).then((items: any[]) => {
        const grouped: { [k: string]: any[] } = {};
        for (const item of items) { if (!grouped[item.employeeId]) grouped[item.employeeId] = []; grouped[item.employeeId].push(item); }
        setRunPaycodes(grouped);
      }).catch(() => {});
      if (payComponents.length === 0) {
        apiFetch('/payroll/components').then((comps: any[]) => {
          setPayComponents(comps);
          if (comps.length > 0) setNewPcComponentId(comps[0].id);
        }).catch(() => {});
      }
    }
  }, [reviewRunData?.id]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return reviewPayslips.filter(ps => !q || (empNameMap.get(ps.employeeId) ?? ps.employeeId).toLowerCase().includes(q));
  }, [reviewPayslips, searchQuery, empNameMap]);

  const downloadPayslipPdf = async (employeeId: string, period: string, name: string) => {
    setDlProgress(`Downloading ${name}…`);
    try {
      const res = await fetch(`${resolveApiBase()}/payroll/payslips/${employeeId}/${period}`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      if (!res.ok) throw new Error('PDF not available');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `payslip-${name.replace(/ /g, '_')}-${period}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      handleActionToast(e.message || 'Download failed');
    } finally {
      setDlProgress(null);
    }
  };

  const handleActionToast = (message: string) => {
    setActionToast(message);
    setTimeout(() => setActionToast(null), 3000);
  };

  const downloadGiro = async () => {
    if (!giroRunId) return;
    const run = runs.find(r => r.id === giroRunId);
    setGiroDownloading(true);
    try {
      const params = new URLSearchParams({ bank: giroBank, ...Object.fromEntries(Object.entries(giroFields).filter(([, v]) => v)) });
      const res = await fetch(`${resolveApiBase()}/payroll/bank-giro/${giroRunId}?${params}`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? `HTTP ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers.get('Content-Disposition') ?? '';
      a.download = cd.split('filename=')[1]?.replace(/"/g, '') ?? `giro-${giroBank}-${run?.period ?? ''}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      markGiroRefUsed(run?.period ?? '', giroFields.ref);
      handleActionToast(`${giroBank.toUpperCase()} GIRO file downloaded`);
      setGiroRunId(null);
    } catch (e: any) {
      handleActionToast(e.message || 'GIRO download failed');
    } finally {
      setGiroDownloading(false);
    }
  };

  const actuallyCreateRun = async () => {
    setIsProcessing(true);
    setPeriodConflictRuns([]);
    setConflictPayslips([]);
    setConflictSalaryMap({});
    try {
      const newRun = await apiFetch('/payroll/runs', { method: 'POST', body: JSON.stringify({ period: selectedPeriod, runType: selectedRunType }) });
      setIsRunModalOpen(false);
      await loadRuns();
      // Immediately open Review Protocol so the user can compute → approve → finalise
      if (newRun?.id) setReviewRunData(newRun);
    } catch (e: any) {
      const msg = e.message || 'Failed to initiate payroll run';
      // Re-show the conflict dialog with the error so it's not missed as a brief toast
      if (msg.includes('already exists')) {
        handleActionToast(`⛔ ${msg}`);
      } else {
        handleActionToast(msg);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecute = async () => {
    setIsProcessing(true);
    try {
      const data = await apiFetch(`/payroll/runs?period=${selectedPeriod}&limit=10`);
      if (data.runs?.length > 0) {
        setPeriodConflictRuns(data.runs);
        setIsRunModalOpen(false);
        setIsProcessing(false);
        // Load existing payslips + current salary data for the conflict preview
        setConflictLoading(true);
        setConflictPayslips([]);
        setConflictSalaryMap({});
        try {
          const [empData, payrollDataResult, ...runPayslipResults] = await Promise.allSettled([
            apiFetch('/employees?limit=500&isActive=true'),
            apiFetch('/employees/payroll-data'),
            ...data.runs.map((r: PayrollRun) => apiFetch(`/payroll/runs/${r.id}/payslips`)),
          ]);
          const nameMap: Record<string, string> = {};
          if (empData.status === 'fulfilled') {
            for (const e of (empData.value.employees ?? [])) nameMap[e.id] = e.fullName;
          }
          // Build salary map from payroll-data (current profile OW)
          if (payrollDataResult.status === 'fulfilled') {
            const sm: Record<string, number> = {};
            for (const e of (payrollDataResult.value ?? [])) sm[e.employeeId] = e.ow ?? 0;
            setConflictSalaryMap(sm);
          }
          // Merge all payslips across runs, keyed by employeeId
          const byEmp: Record<string, any> = {};
          for (let i = 0; i < runPayslipResults.length; i++) {
            const r = runPayslipResults[i];
            if (r.status !== 'fulfilled') continue;
            const run = data.runs[i];
            for (const ps of (r.value.payslips ?? [])) {
              const key = ps.employeeId;
              if (!byEmp[key]) byEmp[key] = { employeeId: key, name: nameMap[key] ?? key, runs: [] };
              byEmp[key].runs.push({ runId: run.id, runType: run.runType, status: run.status, ...ps });
            }
          }
          setConflictPayslips(Object.values(byEmp));
        } catch {}
        setConflictLoading(false);
        return;
      }
      await actuallyCreateRun();
    } catch (e: any) {
      handleActionToast(e.message || 'Failed to initiate payroll run');
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col gap-10 max-w-[1600px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Period Conflict — Supplemental Run Confirmation Modal */}
      {periodConflictRuns.length > 0 && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 backdrop-blur-md animate-in fade-in duration-300 p-4">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-100 animate-in slide-in-from-bottom-10">

            {/* Header */}
            <div className="bg-amber-50 border-b border-amber-200 px-8 py-6 flex justify-between items-center shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-amber-600 text-base">⚠</span>
                  <h3 className="text-base font-black text-amber-900 tracking-tighter uppercase">Supplemental Run — {fmtPeriod(selectedPeriod)}</h3>
                </div>
                <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest">
                  {periodConflictRuns.length} existing run{periodConflictRuns.length !== 1 ? 's' : ''} found · Review differences before proceeding
                </p>
              </div>
              <button onClick={() => { setPeriodConflictRuns([]); setConflictPayslips([]); }} className="w-10 h-10 flex items-center justify-center bg-white border border-amber-200 rounded-2xl text-amber-600 hover:bg-amber-100 transition-all font-black">&times;</button>
            </div>

            {/* Existing Runs Summary */}
            <div className="px-8 py-4 border-b border-slate-100 shrink-0">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Existing Runs for This Period</p>
              <div className="flex flex-wrap gap-3">
                {periodConflictRuns.map(r => (
                  <div key={r.id} className="flex items-center gap-2 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                    <span className="text-[10px] font-black text-slate-700 uppercase">{r.runType}</span>
                    <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest border ${
                      r.status === 'FINALISED' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                      r.status === 'APPROVED' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' :
                      'bg-amber-50 text-amber-600 border-amber-100'
                    }`}>{fmtRunStatus(r.status)}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <span className="text-[10px] font-black text-indigo-700 uppercase">+ New: {selectedRunType}</span>
                  <span className="text-[8px] font-black px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-full uppercase">Draft</span>
                </div>
              </div>
            </div>

            {/* Per-employee payslip comparison */}
            <div className="flex-1 overflow-y-auto px-8 py-4">
              <div className="flex items-start gap-2 mb-3">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Existing Payslips — Computed Values at Time of Run
                </p>
                <span className="shrink-0 text-[8px] font-black px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full uppercase tracking-widest">Stale salaries possible</span>
              </div>
              <p className="text-[9px] font-bold text-slate-400 mb-3 normal-case">
                The new supplemental run will re-fetch each employee&apos;s <strong>current salary</strong> from their profile — salary changes made since the prior run will be picked up automatically.
              </p>
              {conflictLoading ? (
                <div className="flex items-center gap-3 py-8">
                  <div className="w-4 h-4 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading employee payslip data…</span>
                </div>
              ) : conflictPayslips.length === 0 ? (
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest py-6">No computed payslips yet for this period — new run will be the first.</p>
              ) : (
                <div className="overflow-hidden border border-slate-100 rounded-2xl">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      <tr>
                        <th className="px-5 py-3">Employee</th>
                        {periodConflictRuns.map(r => (
                          <th key={r.id} className="px-5 py-3 text-right">{r.runType} Net <span className="font-normal text-slate-300">(historical)</span></th>
                        ))}
                        <th className="px-5 py-3 text-right text-indigo-600">Historical Total Net</th>
                        <th className="px-5 py-3 text-right text-amber-600">Supplemental Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {conflictPayslips.map((emp: any) => {
                        const totalNet = emp.runs.reduce((s: number, r: any) => s + (r.netPay ?? 0), 0);
                        const hasZero = emp.runs.some((r: any) => (r.netPay ?? 0) === 0);
                        const currentOw = conflictSalaryMap[emp.employeeId] ?? null;
                        const salaryMissing = hasZero && currentOw === 0;
                        return (
                          <tr key={emp.employeeId} className={`hover:bg-slate-50/50 transition-colors ${salaryMissing ? 'bg-red-50/50' : ''}`}>
                            <td className="px-5 py-3 font-black text-slate-800">{emp.name}</td>
                            {periodConflictRuns.map(r => {
                              const ps = emp.runs.find((x: any) => x.runId === r.id);
                              return (
                                <td key={r.id} className={`px-5 py-3 text-right font-bold ${(ps?.netPay ?? 0) === 0 ? 'text-red-400' : 'text-slate-500'}`}>
                                  {ps ? `SGD ${fmtSGD(ps.netPay ?? 0)}` : '—'}
                                </td>
                              );
                            })}
                            <td className="px-5 py-3 text-right font-black text-indigo-700">SGD {fmtSGD(totalNet)}</td>
                            <td className="px-5 py-3 text-right text-[9px] font-black">
                              {hasZero ? (
                                salaryMissing
                                  ? <span className="text-red-600">⛔ No salary in profile — update employee record first</span>
                                  : <span className="text-emerald-600">✓ Profile salary SGD {fmtSGD(currentOw ?? 0)} — will pro-rate by start date</span>
                              ) : (
                                <span className="text-slate-400 italic">Will add delta only</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Info banner + actions */}
            {(() => {
              const blockedEmps = conflictPayslips.filter((emp: any) => {
                const hasZero = emp.runs.some((r: any) => (r.netPay ?? 0) === 0);
                // Only block if salary data loaded AND confirmed to be $0
                const currentOw = conflictSalaryMap[emp.employeeId];
                return hasZero && currentOw !== undefined && currentOw === 0;
              });
              const conflictingRun = periodConflictRuns.find(
                r => r.runType === selectedRunType && r.status === 'FINALISED'
              );
              return (
            <div className="shrink-0 border-t border-slate-100">
              {conflictingRun && (
                <div className="px-8 py-4 bg-red-50 border-b border-red-200">
                  <p className="text-[9px] font-black text-red-700 uppercase tracking-widest leading-relaxed">
                    ⛔ A <strong>{conflictingRun.runType}</strong> run for {fmtPeriod(selectedPeriod)} is already DISBURSED.
                    You cannot create another {selectedRunType} run until the existing one is voided.
                    Use "Void &amp; Replace" to delete the old run and create a corrected one — or choose a different run type.
                  </p>
                </div>
              )}
              {blockedEmps.length > 0 && (
                <div className="px-8 py-4 bg-red-50 border-b border-red-200">
                  <p className="text-[9px] font-black text-red-700 uppercase tracking-widest leading-relaxed">
                    ⛔ {blockedEmps.length} employee{blockedEmps.length !== 1 ? 's have' : ' has'} no salary configured:{' '}
                    <strong>{blockedEmps.map((e: any) => e.name).join(', ')}</strong>.
                    Go to their employee profile and set a Basic Salary before running payroll.
                  </p>
                </div>
              )}
              <div className="px-8 py-4 bg-amber-50/50 border-b border-amber-100">
                <p className="text-[9px] font-black text-amber-800 uppercase tracking-widest leading-relaxed">
                  A new <strong className="text-amber-900">{selectedRunType}</strong> run will compute additional pay items. Upon finalization, all runs for <strong>{fmtPeriod(selectedPeriod)}</strong> will be automatically consolidated — employees will see only one payslip per month.
                </p>
              </div>
              <div className="px-8 py-5 flex justify-end gap-4 bg-slate-50/50">
                <button onClick={() => { setPeriodConflictRuns([]); setConflictPayslips([]); setConflictSalaryMap({}); }} className="px-6 py-3 bg-white border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-100 transition-all">Cancel</button>
                {conflictingRun ? (
                  <button
                    onClick={async () => {
                      setIsProcessing(true);
                      try {
                        await apiFetch(`/payroll/runs/${conflictingRun.id}/cancel`, { method: 'POST' });
                        await actuallyCreateRun();
                      } catch (e: any) {
                        handleActionToast(e.message || 'Void & Replace failed');
                        setIsProcessing(false);
                      }
                    }}
                    disabled={isProcessing}
                    className="px-8 py-3 bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-700 transition-all shadow-lg shadow-red-500/20 disabled:opacity-60 flex items-center gap-2"
                  >
                    {isProcessing ? (
                      <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing…</>
                    ) : (
                      <>⚡ Void & Replace — {selectedRunType}</>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={actuallyCreateRun}
                    disabled={isProcessing}
                    className="px-8 py-3 bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-amber-600 transition-all shadow-lg shadow-amber-500/20 disabled:opacity-60 flex items-center gap-2"
                  >
                    {isProcessing ? (
                      <><div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating…</>
                    ) : (
                      <>⚡ Confirm — Create Supplemental Run</>
                    )}
                  </button>
                )}
              </div>
            </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8 bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
           <div className="w-32 h-32 bg-indigo-600 rounded-full blur-3xl"></div>
        </div>
        <div className="flex flex-col gap-2 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-indigo-600 rounded-full"></div>
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.4em]">Financial Settlement Layer</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tighter">Payroll <span className="text-indigo-600">Nexus</span></h1>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest leading-relaxed max-w-xl">
            Sovereign salary disbursement, CPF/SDL statutory tracking, and automated GIRO bank generations.
          </p>
        </div>
        <div className="flex items-center gap-6 relative z-10">
           <div className="hidden lg:flex flex-col items-end justify-center px-6 border-r border-slate-100">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Active Engine</span>
              <span className="text-[10px] font-black text-indigo-600 uppercase mt-1">SG-CPF-STABLE-2026</span>
           </div>
           <button
             onClick={() => setIsRunModalOpen(true)}
             className="px-10 py-5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-indigo-700 shadow-2xl shadow-indigo-500/20 transition-all active:scale-95 flex items-center gap-3"
           >
              <span>⚡</span> Initiate Calculation Engine
           </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 group hover:border-indigo-600/20 transition-all">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Pending Disbursement</p>
          <div className="flex items-end gap-3">
            <h3 className="text-4xl font-black text-slate-900 tracking-tighter">$245,600.00</h3>
            <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded uppercase mb-1.5">Live</span>
          </div>
          <div className="mt-8 flex items-center gap-4 pt-6 border-t border-slate-50">
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black text-slate-400 uppercase">Net Pay</span>
              <span className="text-xs font-black text-slate-900">$201,400</span>
            </div>
            <div className="h-4 w-[1px] bg-slate-100"></div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black text-slate-400 uppercase">Total CPF</span>
              <span className="text-xs font-black text-indigo-600">$44,200</span>
            </div>
          </div>
        </div>
        <div className="bg-white p-8 rounded-[2rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-bl-full"></div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Metric: YTD Disbursed</p>
          <h3 className="text-4xl font-black text-indigo-600 tracking-tighter">$1.2M</h3>
          <p className="text-[9px] font-black text-emerald-600 uppercase mt-8 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
            Performance: ↑ 4.2% vs Prev Yr
          </p>
        </div>
        <div className="bg-slate-950 p-8 rounded-[2rem] border border-slate-800 shadow-2xl shadow-slate-900/10">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-6">Statutory Protocol Queue</p>
          <div className="flex flex-col gap-3">
            <button className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl hover:border-indigo-600 transition-all group">
               <span className="text-[10px] font-black text-slate-300 uppercase tracking-tight">CPF Submissions (Mar 2026)</span>
               <span className="text-[9px] font-black px-2 py-0.5 bg-amber-500 text-slate-950 rounded">Action Needed</span>
            </button>
            <button className="flex items-center justify-between p-4 bg-slate-900/50 border border-slate-800 rounded-2xl opacity-50 grayscale">
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight italic">Bank GIRO (Draft Saved)</span>
               <span className="text-slate-700">→</span>
            </button>
          </div>
        </div>
      </div>

      {/* Run History */}
      <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-2xl shadow-indigo-500/5 overflow-hidden">
        <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4">
             <div className="w-2 h-8 bg-indigo-600 rounded-full"></div>
             <h3 className="text-lg font-black text-slate-900 uppercase tracking-widest">Historical Run Archive</h3>
          </div>
          <div className="flex gap-4">
            <button className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-slate-500 uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all">Refine Archive</button>
            <button className="px-6 py-3 bg-white border border-slate-200 text-[10px] font-black text-indigo-600 uppercase tracking-widest rounded-xl hover:bg-indigo-50 transition-all">Consolidated Export (CSV)</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] border-b border-slate-100">
              <tr>
                <th className="px-8 py-8">Accounting Period</th>
                <th className="px-8 py-8">Status Registry</th>
                <th className="px-8 py-8">Population</th>
                <th className="px-8 py-8 text-right">Net Liquidity</th>
                <th className="px-8 py-8 text-right">Statutory (CPF)</th>
                <th className="px-8 py-8 text-center">Governance Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {runsLoading ? (
                [1,2,3].map(i => (
                  <tr key={i}><td colSpan={6} className="px-8 py-5"><div className="h-8 bg-slate-50 rounded-xl animate-pulse" /></td></tr>
                ))
              ) : runs.length === 0 ? (
                <tr><td colSpan={6} className="px-8 py-16 text-center">
                  <span className="text-sm font-black text-slate-300 uppercase tracking-widest">No payroll runs yet</span>
                </td></tr>
              ) : runs.map((run) => (
                <tr key={run.id} className="group hover:bg-slate-50/50 transition-all duration-300">
                  <td className="px-8 py-6">
                     <span className="text-sm font-black text-slate-900 uppercase tracking-tighter group-hover:text-indigo-600 transition-colors">{fmtPeriod(run.period)}</span>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest border shadow-sm ${
                      run.status === 'PENDING_APPROVAL' || run.status === 'DRAFT' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                      run.status === 'APPROVED' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' :
                      run.status === 'REJECTED' ? 'bg-red-50 text-red-600 border-red-100' :
                      'bg-emerald-50 text-emerald-600 border-emerald-100'
                    }`}>
                      {fmtRunStatus(run.status)}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                     <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{run.runType}</span>
                  </td>
                  <td className="px-8 py-6 text-right">
                     <span className="text-sm font-black text-slate-400 tracking-tighter italic">—</span>
                  </td>
                  <td className="px-8 py-6 text-right">
                     <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">—</span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex justify-center items-center">
                      {(run.status === 'PENDING_APPROVAL' || run.status === 'APPROVED' || run.status === 'DRAFT') ? (
                        <button
                          onClick={() => setReviewRunData(run)}
                          className="px-8 py-3 bg-indigo-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-700 shadow-xl shadow-indigo-500/10 transition-all active:scale-95"
                        >
                           Review Protocol
                        </button>
                      ) : run.status === 'REJECTED' ? (
                        <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest italic opacity-50">Locked for Archive</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button onClick={() => { const ref = generateGiroRef(run.period); setGiroRunId(run.id); setGiroBank('uob'); setGiroFields({ acct: '', companyName: 'VORKHIVE PTE LTD', valueDate: new Date().toISOString().slice(0,10), ref, batchNo: '001', payDesc: `SALARY ${run.period}` }); }} className="px-4 py-2 bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-slate-800 transition-all">GIRO</button>
                          <button onClick={() => handleActionToast('Opening CPF E-Submit Portal…')} className="px-4 py-2 bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-emerald-700 transition-all">FTP</button>
                          <button onClick={() => { setPayslipRunId(run.id); setPayslipRows([]); }} className="px-4 py-2 bg-white border border-slate-200 text-[9px] font-black text-slate-400 uppercase tracking-widest rounded-lg hover:text-indigo-600 hover:border-indigo-600 transition-all">Payslips</button>
                          {runs.filter(r => r.period === run.period && r.id !== run.id && r.status === 'FINALISED').length > 0 && (
                            <button onClick={async () => {
                              try {
                                await apiFetch(`/payroll/runs/${run.id}/consolidate`, { method: 'POST' });
                                handleActionToast(`Payslips consolidated for ${fmtPeriod(run.period)}.`);
                                await loadRuns();
                              } catch (e: any) { handleActionToast(e.message || 'Consolidation failed'); }
                            }} className="px-4 py-2 bg-amber-50 border border-amber-300 text-[9px] font-black text-amber-700 uppercase tracking-widest rounded-lg hover:bg-amber-500 hover:text-white hover:border-amber-500 transition-all">Merge</button>
                          )}
                          <button onClick={() => { setConfirmCancelRun(false); setReviewRunData(run); }} className="px-4 py-2 bg-white border border-red-200 text-[9px] font-black text-red-400 uppercase tracking-widest rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-400 transition-all">Void</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* GIRO Generation Modal */}
      {giroRunId && (() => {
        const run = runs.find(r => r.id === giroRunId);
        const inputCls = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-[11px] font-black text-slate-900 outline-none focus:border-indigo-600 focus:bg-white transition-all placeholder:text-slate-300 placeholder:font-bold';
        const labelCls = 'text-[9px] font-black text-slate-500 uppercase tracking-widest';
        const banks = [
          { id: 'uob' as const, label: 'UOB', sub: 'UOB Infinity · 615-char', dot: 'bg-blue-500' },
          { id: 'ocbc' as const, label: 'OCBC', sub: 'GIRO/FAST · 1000-char', dot: 'bg-red-500' },
          { id: 'dbs' as const, label: 'DBS', sub: 'IDEAL · 200-char', dot: 'bg-slate-800' },
        ];
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100 animate-in slide-in-from-bottom-10 max-h-[90vh] flex flex-col">

              {/* Header */}
              <div className="bg-slate-50 border-b border-slate-100 px-8 py-6 flex justify-between items-center shrink-0">
                <div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tighter uppercase">Generate GIRO File</h3>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">
                    {run ? `Period: ${fmtPeriod(run.period)}` : ''} · Fill in your company&apos;s bank details
                  </p>
                </div>
                <button onClick={() => setGiroRunId(null)} className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-2xl text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all font-black">&times;</button>
              </div>

              <div className="overflow-y-auto flex-1 p-8 flex flex-col gap-6">

                {/* Bank selector */}
                <div className="flex flex-col gap-2">
                  <p className={labelCls}>Company&apos;s Bank</p>
                  <div className="grid grid-cols-3 gap-2">
                    {banks.map(b => (
                      <button key={b.id} onClick={() => setGiroBank(b.id)}
                        className={`flex flex-col items-center gap-1.5 py-4 px-3 rounded-2xl border-2 transition-all ${giroBank === b.id ? 'border-indigo-600 bg-indigo-50' : 'border-slate-100 bg-slate-50 hover:border-slate-200'}`}
                      >
                        <div className={`w-2.5 h-2.5 rounded-full ${b.dot}`} />
                        <span className={`text-[11px] font-black uppercase ${giroBank === b.id ? 'text-indigo-600' : 'text-slate-700'}`}>{b.label}</span>
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wide text-center leading-tight">{b.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Company Account Number */}
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}>
                    {giroBank === 'uob' ? 'UOB Account No (10-digit)' : giroBank === 'ocbc' ? 'OCBC Account No (no dashes)' : 'DBS Account No'}
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="text"
                    value={giroFields.acct}
                    onChange={e => gf('acct', e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder={giroBank === 'uob' ? '1234567890' : giroBank === 'ocbc' ? '501234567001' : '0729123456789'}
                    maxLength={giroBank === 'uob' ? 10 : 34}
                    className={inputCls}
                  />
                  <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">
                    {giroBank === 'uob' ? 'Your 10-digit UOB account number (debit source)' : giroBank === 'ocbc' ? 'Your OCBC Current Account number, digits only' : 'Your DBS IDEAL account number'}
                  </p>
                </div>

                {/* Company Name — UOB only */}
                {giroBank === 'uob' && (
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls}>Account / Company Name <span className="text-red-500">*</span></label>
                    <input type="text" value={giroFields.companyName} onChange={e => gf('companyName', e.target.value.toUpperCase())} placeholder="ACME PTE LTD" maxLength={35} className={inputCls} />
                    <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Printed on UOB account statement · max 35 chars</p>
                  </div>
                )}

                {/* Value Date */}
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}>Value Date <span className="text-red-500">*</span></label>
                  <input type="date" value={giroFields.valueDate} onChange={e => gf('valueDate', e.target.value)} className={inputCls} />
                  <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Date funds are credited to employees&apos; accounts</p>
                </div>

                {/* Payment Description */}
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}>Payment Description</label>
                  <input type="text" value={giroFields.payDesc} onChange={e => gf('payDesc', e.target.value.toUpperCase())} placeholder={`SALARY ${run?.period ?? ''}`} maxLength={35} className={inputCls} />
                  <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Shown on employee&apos;s bank statement · max 35 chars</p>
                </div>

                {/* Reference / Batch */}
                <div className={`grid gap-4 ${giroBank === 'ocbc' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <label className={labelCls}>{giroBank === 'uob' ? 'Bulk Customer Reference' : 'Your Reference No'}</label>
                      <button
                        type="button"
                        onClick={() => gf('ref', generateGiroRef(run?.period ?? ''))}
                        title="Generate new unique reference"
                        className="flex items-center gap-1.5 text-[8px] font-black text-indigo-500 uppercase tracking-widest hover:text-indigo-700 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Regenerate
                      </button>
                    </div>
                    <input type="text" value={giroFields.ref} onChange={e => gf('ref', e.target.value.toUpperCase())} placeholder={`PAYROLL${run?.period?.replace('-','') ?? ''}`} maxLength={16} className={inputCls} />
                    <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Auto-generated unique per period · editable · max 16 chars</p>
                  </div>
                  {giroBank === 'ocbc' && (
                    <div className="flex flex-col gap-1.5">
                      <label className={labelCls}>Batch Number</label>
                      <input type="text" value={giroFields.batchNo} onChange={e => gf('batchNo', e.target.value.replace(/[^0-9]/g, '').padStart(0,'').slice(0,3))} placeholder="001" maxLength={3} className={inputCls} />
                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">3-digit batch identifier</p>
                    </div>
                  )}
                </div>

                {/* Info banner */}
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
                  <p className="text-[9px] font-black text-amber-700 uppercase tracking-widest">
                    {giroBank === 'dbs' ? 'DBS format is based on IDEAL payroll spec — verify against your DBS IDEAL format document before uploading' : `${giroBank.toUpperCase()} format generated to spec — upload via ${giroBank === 'uob' ? 'UOB Infinity' : 'OCBC Velocity'}`}
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-slate-100 px-8 py-5 shrink-0 flex items-center justify-between gap-4 bg-slate-50/50">
                <button onClick={() => setGiroRunId(null)} className="px-6 py-3 rounded-xl text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors">Cancel</button>
                <button
                  onClick={downloadGiro}
                  disabled={giroDownloading || !giroFields.acct}
                  className="flex items-center gap-3 px-8 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-slate-900/20"
                >
                  {giroDownloading ? (
                    <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Generating…</span></>
                  ) : (
                    <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg><span>Generate {giroBank.toUpperCase()} File</span></>
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Initiation Modal */}
      {isRunModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-xl overflow-hidden border border-slate-100 animate-in slide-in-from-bottom-10">
            <div className="bg-slate-50 border-b border-slate-100 p-10 flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-black text-slate-900 tracking-tighter uppercase">Initiate Engine</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Fiscal Cycle Alignment v2.4</p>
              </div>
              <button onClick={() => setIsRunModalOpen(false)} className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-2xl text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all font-black">&times;</button>
            </div>
            <div className="p-10 flex flex-col gap-8">
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Accounting Period (YYYY-MM)</label>
                <input type="month" value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-black text-slate-900 outline-none focus:border-indigo-600 transition-all" />
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Run Type</label>
                <select value={selectedRunType} onChange={e => setSelectedRunType(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-black text-slate-900 outline-none focus:border-indigo-600 appearance-none cursor-pointer">
                  <option value="MONTHLY">Monthly Payroll</option>
                  <option value="ADHOC">Ad-hoc / Supplemental</option>
                  <option value="BONUS">Bonus</option>
                  <option value="COMMISSION">Commission</option>
                  <option value="FINAL_PAY">Final Pay</option>
                </select>
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Workforce Partition</label>
                <select value={processingGroup} onChange={e => setProcessingGroup(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-black text-slate-900 outline-none focus:border-indigo-600 appearance-none cursor-pointer">
                  <option value="all">Global Workforce (All Sectors)</option>
                  <option value="full_time">Personnel: Full-Time</option>
                  <option value="contractors">Personnel: Contractors</option>
                  <option value="management">Personnel: Executive</option>
                </select>
              </div>
              {/* ── Period Working-Day Config (MOM EA s.20) ─────────────────── */}
              <div className="pt-4 border-t border-slate-50 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Working Days — {fmtPeriod(selectedPeriod)}</p>
                    <p className="text-[8px] font-bold text-slate-300 uppercase tracking-wide mt-0.5">MOM EA s.20 · Pro-ration basis for new joiners &amp; leavers</p>
                  </div>
                  {periodCfg && (
                    <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${periodCfg.isOverridden ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
                      {periodCfg.isOverridden ? 'Overridden' : 'Auto (MOM)'}
                    </span>
                  )}
                </div>

                {periodCfgLoading ? (
                  <div className="h-16 bg-slate-50 rounded-2xl animate-pulse" />
                ) : periodCfg ? (
                  <div className="bg-slate-50 rounded-2xl p-4 flex flex-col gap-3">
                    {/* Work week selector */}
                    <div className="flex gap-2">
                      {(['FIVE_DAY', 'SIX_DAY'] as const).map(t => (
                        <button key={t} onClick={() => setPeriodCfgWorkDayType(t)}
                          className={`flex-1 py-2 px-3 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${periodCfgWorkDayType === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'}`}>
                          {t === 'FIVE_DAY' ? '5-Day (Mon–Fri)' : '6-Day (Mon–Sat)'}
                        </button>
                      ))}
                    </div>

                    {/* Recommended vs override */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">MOM Recommended</p>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-black text-indigo-600">{periodCfg.recommendedWorkingDays}</span>
                          <span className="text-[9px] font-black text-slate-400 uppercase">days</span>
                        </div>
                        {periodCfg.publicHolidays.length > 0 && (
                          <p className="text-[8px] font-bold text-slate-400 mt-1">
                            {periodCfg.publicHolidays.length} public holiday{periodCfg.publicHolidays.length !== 1 ? 's' : ''} deducted
                            {' ('}{periodCfg.publicHolidays.map(h => h.name).join(', ')}{')'}
                          </p>
                        )}
                      </div>
                      <div className="w-px h-10 bg-slate-200" />
                      <div className="flex-1">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Override (optional)</p>
                        <input
                          type="number" min="1" max="31"
                          value={periodCfgOverride}
                          onChange={e => setPeriodCfgOverride(e.target.value)}
                          placeholder={String(periodCfg.recommendedWorkingDays)}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-black text-slate-900 outline-none focus:border-indigo-600 transition-all placeholder:text-slate-300"
                        />
                      </div>
                    </div>

                    <button onClick={savePeriodConfig} disabled={periodCfgSaving}
                      className="self-end px-5 py-2 bg-slate-900 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-600 transition-all disabled:opacity-50">
                      {periodCfgSaving ? 'Saving…' : 'Save Config'}
                    </button>
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-2xl p-4 text-[9px] font-black text-slate-400 uppercase tracking-widest text-center">
                    Could not load period config
                  </div>
                )}
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-50">
                <label className="flex items-center gap-4 cursor-pointer group">
                  <div className="relative">
                    <input type="checkbox" defaultChecked className="peer opacity-0 absolute inset-0 w-6 h-6 cursor-pointer" />
                    <div className="w-6 h-6 bg-slate-100 border border-slate-200 rounded-lg peer-checked:bg-indigo-600 peer-checked:border-indigo-600 transition-all flex items-center justify-center">
                       <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black text-slate-900 uppercase group-hover:text-indigo-600 transition-colors">Apply Central Provident Fund (CPF)</span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase mt-0.5 tracking-tight">Age-Band Compliance v2026.01</span>
                  </div>
                </label>
                <label className="flex items-center gap-4 cursor-pointer group">
                  <div className="relative">
                    <input type="checkbox" defaultChecked className="peer opacity-0 absolute inset-0 w-6 h-6 cursor-pointer" />
                    <div className="w-6 h-6 bg-slate-100 border border-slate-200 rounded-lg peer-checked:bg-indigo-600 peer-checked:border-indigo-600 transition-all flex items-center justify-center">
                       <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black text-slate-900 uppercase group-hover:text-indigo-600 transition-colors">Apply Skills Development Levy (SDL)</span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase mt-0.5 tracking-tight">Cap Protection: SGD 11.25</span>
                  </div>
                </label>
              </div>
            </div>
            <div className="bg-slate-50 border-t border-slate-100 p-10 flex justify-end gap-5">
               <button onClick={() => setIsRunModalOpen(false)} className="px-8 py-4 bg-white border border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-slate-100 transition-all">Abort</button>
               <button onClick={handleExecute} disabled={isProcessing} className={`px-10 py-4 bg-indigo-600 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl transition-all shadow-2xl shadow-indigo-500/20 flex items-center gap-3 active:scale-95 ${isProcessing ? 'opacity-70 pointer-events-none' : 'hover:bg-indigo-700'}`}>
                {isProcessing ? (<><svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Simulating Compute…</>) : (<><span>⚡</span>Execute Nexus Pipeline</>)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Run Modal */}
      {reviewRunData && (
        <div className={`fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 backdrop-blur-xl animate-in fade-in duration-300 ${reviewFullscreen ? 'p-0' : 'p-8'}`}>
          <div className={`bg-white shadow-2xl w-full border border-slate-100 flex flex-col animate-in slide-in-from-top-10 overflow-hidden transition-all duration-300 ${reviewFullscreen ? 'h-full rounded-none max-w-none' : 'rounded-[3rem] max-w-4xl max-h-[90vh]'}`}>
            <div className="bg-slate-900 border-b border-slate-800 p-10 flex justify-between items-center shrink-0">
              <div className="flex gap-6 items-center">
                 <div className="w-14 h-14 bg-indigo-600 rounded-3xl flex items-center justify-center text-2xl font-black text-white shadow-2xl shadow-indigo-500/20 shadow-inner">R</div>
                 <div>
                    <h3 className="text-3xl font-black text-white tracking-tighter uppercase whitespace-nowrap">Review Protocol</h3>
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mt-2">Fiscal Deployment: {fmtPeriod(reviewRunData.period)}</p>
                 </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setReviewFullscreen(f => !f)} className="w-12 h-12 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-2xl text-slate-400 hover:text-white transition-all" title={reviewFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                  {reviewFullscreen ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0h5m-5 0v5M15 9l5-5m0 0h-5m5 0v5M9 15l-5 5m0 0h5m-5 0v-5M15 15l5 5m0 0h-5m5 0v-5" /></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5" /></svg>
                  )}
                </button>
                <button onClick={() => { setReviewRunData(null); setReviewFullscreen(false); }} className="w-12 h-12 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-2xl text-slate-400 hover:text-white transition-all text-2xl">&times;</button>
              </div>
            </div>
            <div className="p-10 overflow-y-auto space-y-12">
              <div className="grid grid-cols-3 gap-8">
                <div className="bg-indigo-50/50 p-8 rounded-[2rem] border border-indigo-100/50"><p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-3">Run Type</p><h4 className="text-3xl font-black text-slate-900 tracking-tighter">{reviewRunData.runType}</h4></div>
                <div className="bg-emerald-50/50 p-8 rounded-[2rem] border border-emerald-100/50"><p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-3">Status</p><h4 className="text-2xl font-black text-slate-900 tracking-tighter">{fmtRunStatus(reviewRunData.status)}</h4></div>
                <div className="bg-slate-50/50 p-8 rounded-[2rem] border border-slate-100"><p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">Initiated</p><h4 className="text-sm font-black text-slate-700 tracking-tighter">{new Date(reviewRunData.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</h4></div>
              </div>

              {/* Variance warning — shown when other finalised runs exist for same period */}
              {varianceLoading && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4 flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-amber-400/30 border-t-amber-500 rounded-full animate-spin" />
                  <span className="text-[9px] font-black text-amber-700 uppercase tracking-widest">Checking for period conflicts…</span>
                </div>
              )}
              {!varianceLoading && variance?.hasConflicts && (
                <div className="bg-amber-50 border border-amber-300 rounded-[2rem] overflow-hidden">
                  <div className="px-8 py-5 border-b border-amber-200 flex items-center gap-3">
                    <span className="text-amber-600 text-lg">&#9888;</span>
                    <div>
                      <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest">
                        Period Conflict — {variance.otherRunCount} other run{variance.otherRunCount !== 1 ? 's' : ''} for {fmtPeriod(variance.period)} already finalised
                      </p>
                      <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest mt-0.5">
                        Upon finalization, these will be consolidated into one payslip per employee.
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-amber-100/50 text-[9px] font-black text-amber-700 uppercase tracking-widest">
                        <tr>
                          <th className="px-6 py-3">Employee</th>
                          <th className="px-6 py-3 text-right">Existing Net</th>
                          <th className="px-6 py-3 text-right">This Run Adds</th>
                          <th className="px-6 py-3 text-right">Combined Net</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100">
                        {variance.rows.filter((r: any) => r.hasExisting).map((r: any, i: number) => (
                          <tr key={i} className="hover:bg-amber-50/50">
                            <td className="px-6 py-3 font-black text-slate-700 uppercase">{empNameMap.get(r.employeeId) ?? r.employeeId.slice(0, 8)}</td>
                            <td className="px-6 py-3 text-right font-bold text-slate-500">SGD {fmtSGD(r.existingNet)}</td>
                            <td className="px-6 py-3 text-right font-black text-amber-700">+ SGD {fmtSGD(r.delta)}</td>
                            <td className="px-6 py-3 text-right font-black text-indigo-700">SGD {fmtSGD(r.combinedNet)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="space-y-8 pb-10">
                <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                   <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-[0.2em] flex items-center gap-4"><div className="w-8 h-1 bg-emerald-500 rounded-full"></div>Resource Verification Matrix</h4>
                   <input type="text" placeholder="Search focal point…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="bg-slate-50 border border-slate-100 rounded-xl px-5 py-2.5 text-[10px] font-black text-slate-900 outline-none focus:border-indigo-600 w-64" />
                </div>
                <div className="overflow-hidden border border-slate-100 rounded-[2rem] shadow-2xl shadow-indigo-500/5">
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50/50 border-b border-slate-100 font-black text-slate-400 uppercase tracking-widest sticky top-0 z-10 backdrop-blur-md">
                        <tr><th className="px-8 py-5">Entity</th><th className="px-8 py-5 text-right">Gross Exposure</th><th className="px-8 py-5 text-right">Self CPF</th><th className="px-8 py-5 text-right">Firm CPF</th><th className="px-8 py-5 text-right">Liquid Net</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredEmployees.length === 0 && reviewPayslips.length === 0 ? (
                          <tr><td colSpan={5} className="px-8 py-10 text-center text-[10px] font-black text-slate-300 uppercase tracking-widest">
                            {reviewRunData?.status === 'DRAFT' ? 'Compute payroll first to see employee breakdown' : 'No payslips found for this run'}
                          </td></tr>
                        ) : filteredEmployees.map((ps, i) => {
                          const name = empNameMap.get(ps.employeeId) ?? ps.employeeId;
                          const empCodes = runPaycodes[ps.employeeId] || [];
                          const canEdit = reviewRunData?.status === 'PENDING_APPROVAL';
                          const isAddingHere = addingPaycodeFor === ps.employeeId;
                          return (
                            <React.Fragment key={i}>
                              <tr className="hover:bg-slate-50 transition-all">
                                <td className="px-8 py-4">
                                  <div className="flex flex-col gap-1">
                                    <span className="font-black text-slate-900 uppercase tracking-tight">{name}</span>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">{ps.employeeId.slice(0, 8)}</span>
                                    {canEdit && <button onClick={() => { setAddingPaycodeFor(isAddingHere ? null : ps.employeeId); setNewPcAmount(''); setNewPcDesc(''); if (payComponents.length > 0 && !newPcComponentId) setNewPcComponentId(payComponents[0].id); }} className="text-[9px] font-black text-indigo-500 uppercase tracking-widest hover:text-indigo-700 text-left mt-1">+ Add Paycode</button>}
                                  </div>
                                </td>
                                <td className="px-8 py-4 text-right text-slate-600">SGD {fmtSGD(ps.grossPay)}</td>
                                <td className="px-8 py-4 text-right text-red-500 italic">-SGD {fmtSGD(ps.employeeCpf)}</td>
                                <td className="px-8 py-4 text-right text-slate-400">SGD {fmtSGD(ps.employerCpf)}</td>
                                <td className="px-8 py-4 text-right font-black text-indigo-600 tracking-tight">SGD {fmtSGD(ps.netPay)}</td>
                              </tr>
                              {(empCodes.length > 0 || isAddingHere) && (
                                <tr className="bg-indigo-50/30">
                                  <td colSpan={5} className="px-8 pb-4 pt-1">
                                    <div className="flex flex-col gap-2">
                                      {empCodes.map((pc: any) => (
                                        <div key={pc.id} className="flex items-center justify-between bg-white border border-slate-100 rounded-xl px-4 py-2">
                                          <span className="text-[10px] font-black text-slate-600 uppercase tracking-wide">{pc.description}</span>
                                          <div className="flex items-center gap-3">
                                            <span className={`text-[10px] font-black ${pc.amount >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{pc.amount >= 0 ? '+' : ''}SGD {fmtSGD(Math.abs(pc.amount))}</span>
                                            <span className="text-[9px] text-slate-300 uppercase">{pc.wageType}</span>
                                            {canEdit && <button onClick={async () => { await apiFetch(`/payroll/runs/${reviewRunData.id}/paycodes/${pc.id}`, { method: 'DELETE' }); setRunPaycodes(p => { const n = { ...p }; n[ps.employeeId] = (n[ps.employeeId] || []).filter((x: any) => x.id !== pc.id); return n; }); setPaycodesDirty(true); }} className="text-red-400 hover:text-red-600 text-xs font-black">×</button>}
                                          </div>
                                        </div>
                                      ))}
                                      {isAddingHere && (
                                        <div className="flex items-center gap-3 bg-white border border-indigo-200 rounded-xl px-4 py-3 mt-1">
                                          <select value={newPcComponentId} onChange={e => setNewPcComponentId(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-black text-slate-900 outline-none focus:border-indigo-500 flex-1">
                                            {payComponents.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                          </select>
                                          <input type="number" placeholder="Amount (neg = deduction)" value={newPcAmount} onChange={e => setNewPcAmount(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-black text-slate-900 outline-none focus:border-indigo-500 w-44" />
                                          <button onClick={async () => {
                                            if (!newPcAmount) return;
                                            const comp = payComponents.find((c: any) => c.id === newPcComponentId);
                                            const item = await apiFetch(`/payroll/runs/${reviewRunData.id}/paycodes`, { method: 'POST', body: JSON.stringify({ employeeId: ps.employeeId, componentId: newPcComponentId, description: newPcDesc || comp?.name, amount: parseFloat(newPcAmount) }) });
                                            setRunPaycodes(p => { const n = { ...p }; n[ps.employeeId] = [...(n[ps.employeeId] || []), item]; return n; });
                                            setAddingPaycodeFor(null); setNewPcAmount(''); setNewPcDesc(''); setPaycodesDirty(true);
                                          }} className="px-4 py-1.5 bg-indigo-600 text-white text-[9px] font-black uppercase tracking-widest rounded-lg hover:bg-indigo-700 transition-all whitespace-nowrap">Add</button>
                                          <button onClick={() => setAddingPaycodeFor(null)} className="text-slate-400 hover:text-slate-600 text-xs font-black">×</button>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-slate-50 border-t border-slate-100 p-10 flex justify-between items-center rounded-b-[3rem]">
               <div className="flex gap-3">
                 <button onClick={() => { setReviewRunData(null); setConfirmCancelRun(false); setReviewFullscreen(false); }} className="px-10 py-5 bg-white border border-slate-200 text-slate-500 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-slate-100 transition-all">Close</button>
                 {!confirmCancelRun ? (
                   <button onClick={() => {
                     if (reviewRunData?.status === 'FINALISED') { setConfirmCancelRun(true); } else {
                       const id = reviewRunData.id; const period = reviewRunData.period;
                       setReviewRunData(null);
                       apiFetch(`/payroll/runs/${id}/cancel`, { method: 'POST' })
                         .then(() => { handleActionToast(`Payroll run for ${period} cancelled.`); loadRuns(); })
                         .catch((e: any) => handleActionToast(e.message || 'Failed to cancel run'));
                     }
                   }} className="px-10 py-5 bg-white border border-red-200 text-red-500 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-red-50 transition-all">
                     Cancel Run
                   </button>
                 ) : (
                   <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-5 py-3">
                     <span className="text-[9px] font-black text-red-600 uppercase tracking-widest">This will void all published payslips. Confirm?</span>
                     <button onClick={async () => {
                       const id = reviewRunData.id; const period = reviewRunData.period;
                       setConfirmCancelRun(false); setReviewRunData(null);
                       try {
                         await apiFetch(`/payroll/runs/${id}/cancel`, { method: 'POST' });
                         handleActionToast(`Payroll run for ${period} voided.`); loadRuns();
                       } catch (e: any) { handleActionToast(e.message || 'Failed to void run'); }
                     }} className="px-5 py-2 bg-red-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-red-700 transition-all">Void</button>
                     <button onClick={() => setConfirmCancelRun(false)} className="px-5 py-2 bg-white border border-slate-200 text-slate-500 text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-100 transition-all">Back</button>
                   </div>
                 )}
               </div>
               <div className="flex gap-4 items-center">
                 {reviewRunData?.status === 'DRAFT' && (
                   <div className="text-[9px] font-black text-amber-600 uppercase tracking-widest bg-amber-50 border border-amber-100 px-4 py-2 rounded-xl">
                     Step 1 of 3 · Compute payroll to proceed
                   </div>
                 )}
                 {reviewRunData?.status === 'PENDING_APPROVAL' && paycodesDirty && (
                   <div className="text-[9px] font-black text-amber-600 uppercase tracking-widest bg-amber-50 border border-amber-200 px-4 py-2 rounded-xl">
                     ⚠ Paycodes changed · Recompute to apply
                   </div>
                 )}
                 {reviewRunData?.status === 'PENDING_APPROVAL' && !paycodesDirty && (
                   <div className="text-[9px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-xl">
                     Step 2 of 3 · Awaiting authorisation
                   </div>
                 )}
                 {reviewRunData?.status === 'PENDING_APPROVAL' && paycodesDirty && (
                   <button onClick={async () => {
                     const id = reviewRunData.id;
                     try {
                       const result = await apiFetch(`/payroll/runs/${id}/compute`, { method: 'POST', body: JSON.stringify({}) });
                       const { payslips } = await fetchPayslipsForRun(id);
                       setReviewPayslips(payslips);
                       setPaycodesDirty(false);
                       const zeroIds: string[] = result?.warnings?.zeroOrdinaryWages ?? [];
                       const removedIds: string[] = result?.autoRemovedIds ?? [];
                       const notes: string[] = [];
                       if (removedIds.length > 0) notes.push(`${removedIds.length} employee(s) unchanged — skipped`);
                       if (zeroIds.length > 0) notes.push(`${zeroIds.length} have $0 ordinary wages — check salary`);
                       handleActionToast(notes.length > 0
                         ? `Recomputed. NOTE: ${notes.join('; ')}.`
                         : 'Recomputed with updated paycodes.');
                     } catch (e: any) { handleActionToast(e.message || 'Recompute failed'); }
                   }} className="px-10 py-5 bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-amber-600 shadow-xl shadow-amber-500/20 active:scale-95 transition-all">
                     Recompute
                   </button>
                 )}
                 {reviewRunData?.status !== 'FINALISED' && !(reviewRunData?.status === 'PENDING_APPROVAL' && paycodesDirty) && (
                   <button onClick={async () => {
                     const id = reviewRunData.id;
                     const status = reviewRunData.status;
                     setReviewRunData(null);
                     try {
                       if (status === 'APPROVED') {
                         await apiFetch(`/payroll/runs/${id}/finalise`, { method: 'POST' });
                         handleActionToast('Payroll finalised. Payslips published.');
                       } else if (status === 'PENDING_APPROVAL') {
                         await apiFetch(`/payroll/runs/${id}/approve`, { method: 'POST' });
                         handleActionToast('Payroll approved. Ready to finalise.');
                       } else if (status === 'DRAFT') {
                         const result = await apiFetch(`/payroll/runs/${id}/compute`, { method: 'POST', body: JSON.stringify({}) });
                         const zeroIds: string[] = result?.warnings?.zeroOrdinaryWages ?? [];
                         const removedIds: string[] = result?.autoRemovedIds ?? [];
                         const notes: string[] = [];
                         if (removedIds.length > 0) notes.push(`${removedIds.length} employee(s) unchanged from prior payslip — skipped from this run`);
                         if (zeroIds.length > 0) notes.push(`${zeroIds.length} have $0 ordinary wages — check salary before authorising`);
                         handleActionToast(notes.length > 0
                           ? `Computed. NOTE: ${notes.join('; ')}.`
                           : 'Payroll computed. Pending authorisation.');
                       }
                       loadRuns();
                     } catch (e: any) { handleActionToast(e.message || 'Action failed'); }
                   }} className="px-12 py-5 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-indigo-700 shadow-2xl shadow-indigo-500/20 active:scale-95 transition-all">
                     {reviewRunData?.status === 'APPROVED' ? 'Finalise & Publish' : reviewRunData?.status === 'PENDING_APPROVAL' ? 'Authorize Disbursement' : 'Compute Payroll'}
                   </button>
                 )}
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Payslip overlay */}
      {payslipRunId && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 backdrop-blur-md p-8 animate-in fade-in duration-300">
           <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-100 animate-in slide-in-from-bottom-5">
              <div className="p-10 border-b border-slate-100 flex justify-between items-center">
                 <div>
                   <h3 className="text-2xl font-black text-slate-900 tracking-tighter uppercase leading-none">Payslips</h3>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-3">{payslipRunPeriod ? fmtPeriod(payslipRunPeriod) : 'Loading…'} · {payslipRows.length} records</p>
                 </div>
                 <button onClick={() => setPayslipRunId(null)} className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-red-500 transition-all font-black">&times;</button>
              </div>
              <div className="max-h-[50vh] overflow-y-auto">
                 {payslipLoading ? (
                   <div className="py-16 flex items-center justify-center gap-3">
                     <div className="w-6 h-6 border-2 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
                     <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading payslips…</span>
                   </div>
                 ) : payslipRows.length === 0 ? (
                   <div className="py-16 text-center">
                     <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No payslips for this run</p>
                     <p className="text-[10px] font-bold text-slate-400 mt-2">Run must be finalised for payslips to be visible</p>
                   </div>
                 ) : (
                 <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-widest sticky top-0 z-10 backdrop-blur-md">
                       <tr><th className="px-10 py-5">Employee</th><th className="px-10 py-5 text-right">Gross</th><th className="px-10 py-5 text-right">Net Pay</th><th className="px-10 py-5 text-center">PDF</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                       {payslipRows.map((ps, i) => {
                         const name = empNameMap.get(ps.employeeId) ?? `Employee ${ps.employeeId.slice(0, 8)}`;
                         return (
                           <tr key={i} className="hover:bg-slate-50 transition-all group">
                              <td className="px-10 py-4 text-xs font-black text-slate-900 group-hover:text-indigo-600 uppercase tracking-tight">{name}</td>
                              <td className="px-10 py-4 text-xs font-bold text-slate-500 text-right">SGD {fmtSGD(ps.grossPay)}</td>
                              <td className="px-10 py-4 text-xs font-black text-indigo-600 text-right">SGD {fmtSGD(ps.netPay)}</td>
                              <td className="px-10 py-4 text-center">
                                <button
                                  onClick={() => downloadPayslipPdf(ps.employeeId, ps.period, name)}
                                  disabled={!ps.isPublished}
                                  className="px-4 py-1.5 bg-indigo-50 text-indigo-600 text-[9px] font-black uppercase rounded-lg hover:bg-indigo-600 hover:text-white transition-all disabled:opacity-40 disabled:pointer-events-none"
                                >
                                  {ps.isPublished ? 'Download' : 'Not published'}
                                </button>
                              </td>
                           </tr>
                         );
                       })}
                    </tbody>
                 </table>
                 )}
              </div>
              <div className="p-8 bg-slate-50/50 border-t border-slate-100 flex justify-between items-center">
                 <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{payslipRows.filter(p => p.isPublished).length} published · {payslipRows.filter(p => !p.isPublished).length} pending</p>
                 <button
                   onClick={async () => {
                     const published = payslipRows.filter(p => p.isPublished);
                     for (const ps of published) {
                       const name = empNameMap.get(ps.employeeId) ?? ps.employeeId;
                       await downloadPayslipPdf(ps.employeeId, ps.period, name);
                     }
                   }}
                   disabled={payslipRows.filter(p => p.isPublished).length === 0}
                   className="px-6 py-3 bg-slate-950 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-600 transition-all shadow-xl shadow-slate-950/10 disabled:opacity-40 disabled:pointer-events-none"
                 >
                   Download All PDFs
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Success toasts */}
      {showSuccessToast && (
        <div className="fixed bottom-10 right-10 z-[200] max-w-md animate-in slide-in-from-right-10 duration-500">
           <div className="bg-emerald-950 border border-emerald-500/30 p-6 rounded-[2rem] shadow-2xl flex items-center gap-6 overflow-hidden relative group">
              <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
              <div className="w-14 h-14 bg-emerald-500/20 rounded-2xl flex items-center justify-center text-2xl group-hover:scale-110 transition-transform duration-500">⚡</div>
              <div className="flex flex-col">
                 <h4 className="text-sm font-black text-white uppercase tracking-widest">Pipeline Synchronized</h4>
                 <p className="text-[10px] font-bold text-emerald-400/70 uppercase mt-1">Payroll run initiated for {fmtPeriod(selectedPeriod)}.</p>
              </div>
           </div>
        </div>
      )}
      {(actionToast || dlProgress) && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-10 duration-500">
           <div className="bg-slate-900 border border-slate-800 px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-6">
              <div className={`w-2 h-2 rounded-full ${dlProgress ? 'bg-emerald-500 animate-pulse' : 'bg-indigo-500 animate-pulse'}`}></div>
              <span className="text-[10px] font-black text-slate-100 uppercase tracking-[0.2em]">{dlProgress ?? actionToast}</span>
           </div>
        </div>
      )}

      {/* Employee detail drawer */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/80 backdrop-blur-xl animate-in fade-in duration-500">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-xl overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-500">
            <div className="bg-slate-900 px-10 py-8 flex justify-between items-start text-white relative">
              <div className="flex flex-col gap-1 relative z-10">
                <h3 className="text-3xl font-black tracking-tighter uppercase whitespace-nowrap">{selectedEmployee.name}</h3>
                <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] mt-2">{selectedEmployee.role} · {selectedEmployee.department}</p>
              </div>
              <button onClick={() => setSelectedEmployee(null)} className="w-10 h-10 flex items-center justify-center bg-slate-800 border border-slate-700 rounded-2xl text-slate-400 hover:text-white transition-all text-2xl font-black">&times;</button>
            </div>
            <div className="p-10 space-y-6">
              <div className="space-y-3">
                <div className="flex justify-between items-center bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100"><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Contractual Base</span><span className="text-sm font-black text-slate-900">${selectedEmployee.base.toFixed(2)}</span></div>
                <div className="flex justify-between items-center bg-slate-50 px-6 py-4 rounded-2xl border border-slate-100"><span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Allowance</span><span className="text-sm font-black text-slate-900">${selectedEmployee.allowance.toFixed(2)}</span></div>
                <div className="flex justify-between items-center pt-4 px-6"><span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Gross Pay</span><span className="text-2xl font-black text-slate-900 tracking-tighter">${selectedEmployee.gross.toFixed(2)}</span></div>
              </div>
              <div className="space-y-3 bg-slate-50/50 p-6 rounded-[2rem] border border-slate-100">
                <div className="flex justify-between items-center px-4"><span className="text-xs font-bold text-slate-600 uppercase">Employee CPF (20%)</span><span className="text-sm font-black text-red-600 italic">-${selectedEmployee.empCpf.toFixed(2)}</span></div>
                <div className="flex justify-between items-center px-4"><span className="text-xs font-bold text-slate-400 uppercase">Employer CPF (17%)</span><span className="text-xs font-black text-slate-500">${selectedEmployee.emprCpf.toFixed(2)}</span></div>
                <div className="flex justify-between items-center px-4"><span className="text-xs font-bold text-slate-400 uppercase">SDL</span><span className="text-xs font-black text-slate-500">${selectedEmployee.sdl.toFixed(2)}</span></div>
              </div>
            </div>
            <div className="bg-indigo-600 px-10 py-10 flex justify-between items-center">
              <span className="text-[10px] font-black text-indigo-100 uppercase tracking-[0.3em] italic">Net Liquidity Transfer</span>
              <span className="text-5xl font-black text-white tracking-tighter italic">${selectedEmployee.net.toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Route entry point ────────────────────────────────────────────────────────

export default function PayrollPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  const role = user?.role?.toUpperCase() ?? '';
  const isPrivileged = role === 'SUPER_ADMIN' || role === 'HR_ADMIN' || role === 'PAYROLL_OFFICER' || role === 'HR_MANAGER' || role === 'FINANCE_ADMIN';

  if (!isPrivileged) return <EmployeePayslipsView />;
  return <AdminPayrollDashboard />;
}
