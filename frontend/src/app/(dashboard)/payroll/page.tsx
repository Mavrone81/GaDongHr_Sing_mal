'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { EmployeePayslipsView } from './EmployeePayslipsView';
import { fmtSGD, fmtPeriod } from './format';
import { Seal, Notice } from '@/components/official';
import { apiFetch, apiFetchRaw } from '@/lib/api';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  const [payslipSort, setPayslipSort] = useState<{ col: 'name' | 'gross' | 'net'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });
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
    acct: '', companyName: 'GADONGHR PTE LTD', valueDate: todayIso(),
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
  const [runSort, setRunSort] = useState<{ col: 'period' | 'status' | 'type'; dir: 'asc' | 'desc' }>({ col: 'period', dir: 'desc' });
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

  // ── DRC quota alert state ──────────────────────────────────────────────────
  const [drcResults, setDrcResults] = useState<any[]>([]);
  const [drcLoaded, setDrcLoaded] = useState(false);

  // ── CPF Statutory Protocol Queue ──────────────────────────────────────────
  const [cpfSubmissions, setCpfSubmissions] = useState<any[]>([]);
  const [cpfActionRun, setCpfActionRun] = useState<{ runId: string; period: string; submissionStatus: string | null } | null>(null);
  const [cpfDownloading, setCpfDownloading] = useState(false);

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

  async function loadCpfSubmissions() {
    try {
      const data = await apiFetch('/payroll/iras-submissions?kind=CPF_E_SUBMIT');
      setCpfSubmissions(data.submissions ?? []);
    } catch (e: any) {
      console.error('[Payroll] loadCpfSubmissions failed:', (e as Error).message);
    }
  }

  useEffect(() => {
    loadRuns();
    loadCpfSubmissions();
    apiFetch('/payroll/drc-status').then((d: any) => {
      setDrcResults(d.results ?? []);
      setDrcLoaded(true);
    }).catch(() => setDrcLoaded(true));
  }, []);
  useEffect(() => { if (isRunModalOpen && selectedPeriod) loadPeriodConfig(selectedPeriod); }, [isRunModalOpen, selectedPeriod]);

  const sortedRuns = useMemo(() => {
    const d = runSort.dir === 'asc' ? 1 : -1;
    return [...runs].sort((a, b) => {
      switch (runSort.col) {
        case 'period': return d * a.period.localeCompare(b.period);
        case 'status': return d * a.status.localeCompare(b.status);
        case 'type':   return d * a.runType.localeCompare(b.runType);
        default: return 0;
      }
    });
  }, [runs, runSort]);
  function toggleRunSort(col: typeof runSort.col) {
    setRunSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function RunSortIcon({ col }: { col: typeof runSort.col }) {
    return <span className="text-[8px] ml-1">{runSort.col === col ? (runSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

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

  const [reviewSort, setReviewSort] = useState<{ col: 'name' | 'gross' | 'selfCpf' | 'firmCpf' | 'net'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const base = reviewPayslips.filter(ps => !q || (empNameMap.get(ps.employeeId) ?? ps.employeeId).toLowerCase().includes(q));
    const d = reviewSort.dir === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      switch (reviewSort.col) {
        case 'name':    return d * (empNameMap.get(a.employeeId) ?? a.employeeId).localeCompare(empNameMap.get(b.employeeId) ?? b.employeeId);
        case 'gross':   return d * ((a.grossPay ?? 0) - (b.grossPay ?? 0));
        case 'selfCpf': return d * ((a.employeeCpf ?? 0) - (b.employeeCpf ?? 0));
        case 'firmCpf': return d * ((a.employerCpf ?? 0) - (b.employerCpf ?? 0));
        case 'net':     return d * ((a.netPay ?? 0) - (b.netPay ?? 0));
        default: return 0;
      }
    });
  }, [reviewPayslips, searchQuery, empNameMap, reviewSort]);

  function toggleReviewSort(col: typeof reviewSort.col) {
    setReviewSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function ReviewSortIcon({ col }: { col: typeof reviewSort.col }) {
    return <span className="text-[8px] ml-1">{reviewSort.col === col ? (reviewSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

  const sortedPayslipRows = useMemo(() => {
    const d = payslipSort.dir === 'asc' ? 1 : -1;
    return [...payslipRows].sort((a, b) => {
      switch (payslipSort.col) {
        case 'name':  return d * (empNameMap.get(a.employeeId) ?? a.employeeId).localeCompare(empNameMap.get(b.employeeId) ?? b.employeeId);
        case 'gross': return d * ((a.grossPay ?? 0) - (b.grossPay ?? 0));
        case 'net':   return d * ((a.netPay ?? 0) - (b.netPay ?? 0));
        default: return 0;
      }
    });
  }, [payslipRows, payslipSort, empNameMap]);
  function togglePayslipSort(col: typeof payslipSort.col) {
    setPayslipSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }
  function PayslipSortIcon({ col }: { col: typeof payslipSort.col }) {
    return <span className="text-[8px] ml-1">{payslipSort.col === col ? (payslipSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

  const downloadPayslipPdf = async (employeeId: string, period: string, name: string) => {
    setDlProgress(`Downloading ${name}…`);
    try {
      const res = await apiFetchRaw(`/payroll/payslips/${employeeId}/${period}`);
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

  // PAY-007: download CPF e-Submit flat file for a finalised run. The backend
  // auto-creates / refreshes a DRAFT IrasSubmission row as a side-effect — the
  // toast points the user to /payroll/iras-submissions where they record the
  // CPF Board reference number once they've uploaded the file via CPF EZPay.
  const downloadCpfFile = async (runId: string, period: string, onSuccess?: () => void) => {
    try {
      setCpfDownloading(true);
      const res = await apiFetchRaw(`/payroll/cpf-file/${runId}`);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers.get('Content-Disposition') ?? '';
      a.download = cd.split('filename=')[1]?.replace(/"/g, '') ?? `cpf-esubmit-${period}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      handleActionToast(`CPF e-Submit file downloaded — track upload at IRAS Submissions`);
      loadCpfSubmissions();
      onSuccess?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'CPF download failed';
      handleActionToast(msg);
    } finally {
      setCpfDownloading(false);
    }
  };

  const downloadGiro = async () => {
    if (!giroRunId) return;
    const run = runs.find(r => r.id === giroRunId);
    setGiroDownloading(true);
    try {
      const params = new URLSearchParams({ bank: giroBank, ...Object.fromEntries(Object.entries(giroFields).filter(([, v]) => v)) });
      const res = await apiFetchRaw(`/payroll/bank-giro/${giroRunId}?${params}`);
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

  // ── DRC banner helpers ─────────────────────────────────────────────────────
  const drcAlerts = drcResults.filter(r => r.status === 'EXCEEDED' || r.status === 'WARNING');

  return (
    <div className="flex flex-col gap-10 max-w-[1600px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Dependency Ratio Ceiling — MOM work-pass quota */}
      {drcLoaded && drcAlerts.length > 0 && (
        <Notice
          heading={drcAlerts.some(r => r.status === 'EXCEEDED')
            ? 'Dependency Ratio Ceiling exceeded'
            : 'Approaching the Dependency Ratio Ceiling'}
          seal={<Seal cite="EFMA · work-pass quota by sector" />}
        >
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {drcAlerts.map(r => (
                <span
                  key={`${r.sector}-${r.passType}`}
                  // EXCEEDED is filled, WARNING outlined: the state that needs
                  // action today should be the heavier one on the page. The old
                  // screen distinguished these by red vs amber alone.
                  className={`flex items-center gap-2 px-3 py-1.5 border text-[10px] font-black ${
                    r.status === 'EXCEEDED'
                      ? 'bg-ink text-paper border-ink'
                      : 'bg-paper text-ink border-highlight'
                  }`}
                >
                  <span>{r.status === 'EXCEEDED' ? 'Exceeded' : 'Warning'}</span>
                  <span className="opacity-60">·</span>
                  <span>{r.sector} — {r.passType.replace('_', ' ')}</span>
                  <span className="opacity-60">·</span>
                  <span className="tabular-nums">{r.currentRatioPct}% of {r.maxRatioPct}% ceiling</span>
                  {r.status === 'WARNING' && (
                    <span className="text-[9px] tabular-nums">({r.usagePct.toFixed(0)}% used)</span>
                  )}
                </span>
              ))}
            </div>
            <p className="text-[10px] font-bold">
              Review foreign worker headcount at Settings → Statutory Rates.
            </p>
          </div>
        </Notice>
      )}

      {/* Period Conflict — Supplemental Run Confirmation Modal */}
      {periodConflictRuns.length > 0 && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-shadow backdrop- animate-in fade-in duration-300 p-4">
          <div className="bg-paper w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-rule animate-in slide-in-from-bottom-10">

            {/* Header */}
            <div className="bg-page border-b border-highlight px-8 py-6 flex justify-between items-center shrink-0">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-ink text-base">⚠</span>
                  <h3 className="text-base font-black text-ink tracking-tighter uppercase">Supplemental Run — {fmtPeriod(selectedPeriod)}</h3>
                </div>
                <p className="text-[9px] font-black text-ink uppercase tracking-widest">
                  {periodConflictRuns.length} existing run{periodConflictRuns.length !== 1 ? 's' : ''} found · Review differences before proceeding
                </p>
              </div>
              <button onClick={() => { setPeriodConflictRuns([]); setConflictPayslips([]); }} className="w-10 h-10 flex items-center justify-center bg-paper border border-highlight text-ink hover:bg-page transition-all font-black">&times;</button>
            </div>

            {/* Existing Runs Summary */}
            <div className="px-8 py-4 border-b border-rule shrink-0">
              <p className="label-form mb-3">Existing Runs for This Period</p>
              <div className="flex flex-wrap gap-3">
                {periodConflictRuns.map(r => (
                  <div key={r.id} className="flex items-center gap-2 px-4 py-2 bg-page border border-rule">
                    <span className="text-[10px] font-black text-ink uppercase">{r.runType}</span>
                    <span className={`text-[8px] font-black px-2 py-0.5  uppercase tracking-widest border ${
                      r.status === 'FINALISED' ? 'bg-page text-accent border-accent' :
                      r.status === 'APPROVED' ? 'bg-page text-accent border-accent' :
                      'bg-page text-ink border-highlight'
                    }`}>{fmtRunStatus(r.status)}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 px-4 py-2 bg-page border border-accent">
                  <span className="text-[10px] font-black text-accent uppercase">+ New: {selectedRunType}</span>
                  <span className="text-[8px] font-black px-2 py-0.5 bg-page text-accent uppercase">Draft</span>
                </div>
              </div>
            </div>

            {/* Per-employee payslip comparison */}
            <div className="flex-1 overflow-y-auto px-8 py-4">
              <div className="flex items-start gap-2 mb-3">
                <p className="label-form">
                  Existing Payslips — Computed Values at Time of Run
                </p>
                <span className="shrink-0 text-[8px] font-black px-2 py-0.5 bg-page text-ink uppercase tracking-widest">Stale salaries possible</span>
              </div>
              <p className="text-[9px] font-bold text-muted mb-3 normal-case">
                The new supplemental run will re-fetch each employee&apos;s <strong>current salary</strong> from their profile — salary changes made since the prior run will be picked up automatically.
              </p>
              {conflictLoading ? (
                <div className="flex items-center gap-3 py-8">
                  <div className="w-4 h-4 border-2 border-rule border-t-accent animate-spin" />
                  <span className="eyebrow-tight">Loading employee payslip data…</span>
                </div>
              ) : conflictPayslips.length === 0 ? (
                <p className="text-[10px] font-black text-muted uppercase tracking-widest py-6">No computed payslips yet for this period — new run will be the first.</p>
              ) : (
                <div className="overflow-hidden border border-rule">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-page label-form">
                      <tr>
                        <th className="px-5 py-3">Employee</th>
                        {periodConflictRuns.map(r => (
                          <th key={r.id} className="px-5 py-3 text-right">{r.runType} Net <span className="font-normal text-muted">(historical)</span></th>
                        ))}
                        <th className="px-5 py-3 text-right text-accent">Historical Total Net</th>
                        <th className="px-5 py-3 text-right text-ink">Supplemental Note</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule">
                      {conflictPayslips.map((emp: any) => {
                        const totalNet = emp.runs.reduce((s: number, r: any) => s + (r.netPay ?? 0), 0);
                        const hasZero = emp.runs.some((r: any) => (r.netPay ?? 0) === 0);
                        const currentOw = conflictSalaryMap[emp.employeeId] ?? null;
                        const salaryMissing = hasZero && currentOw === 0;
                        return (
                          <tr key={emp.employeeId} className={`hover:bg-page transition-colors ${salaryMissing ? 'bg-page' : ''}`}>
                            <td className="px-5 py-3 font-black text-ink">{emp.name}</td>
                            {periodConflictRuns.map(r => {
                              const ps = emp.runs.find((x: any) => x.runId === r.id);
                              return (
                                <td key={r.id} className={`px-5 py-3 text-right font-bold ${(ps?.netPay ?? 0) === 0 ? 'text-ink' : 'text-muted'}`}>
                                  {ps ? `SGD ${fmtSGD(ps.netPay ?? 0)}` : '—'}
                                </td>
                              );
                            })}
                            <td className="px-5 py-3 text-right font-black text-accent">SGD {fmtSGD(totalNet)}</td>
                            <td className="px-5 py-3 text-right text-[9px] font-black">
                              {hasZero ? (
                                salaryMissing
                                  ? <span className="text-ink">⛔ No salary in profile — update employee record first</span>
                                  : <span className="text-accent">✓ Profile salary SGD {fmtSGD(currentOw ?? 0)} — will pro-rate by start date</span>
                              ) : (
                                <span className="text-muted italic">Will add delta only</span>
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
            <div className="shrink-0 border-t border-rule">
              {conflictingRun && (
                <div className="px-8 py-4 bg-page border-b border-ink">
                  <p className="text-[9px] font-black text-ink uppercase tracking-widest leading-relaxed">
                    ⛔ A <strong>{conflictingRun.runType}</strong> run for {fmtPeriod(selectedPeriod)} is already DISBURSED.
                    You cannot create another {selectedRunType} run until the existing one is voided.
                    Use &quot;Void &amp; Replace&quot; to delete the old run and create a corrected one — or choose a different run type.
                  </p>
                </div>
              )}
              {blockedEmps.length > 0 && (
                <div className="px-8 py-4 bg-page border-b border-ink">
                  <p className="text-[9px] font-black text-ink uppercase tracking-widest leading-relaxed">
                    ⛔ {blockedEmps.length} employee{blockedEmps.length !== 1 ? 's have' : ' has'} no salary configured:{' '}
                    <strong>{blockedEmps.map((e: any) => e.name).join(', ')}</strong>.
                    Go to their employee profile and set a Basic Salary before running payroll.
                  </p>
                </div>
              )}
              <div className="px-8 py-4 bg-page border-b border-highlight">
                <p className="text-[9px] font-black text-ink uppercase tracking-widest leading-relaxed">
                  A new <strong className="text-ink">{selectedRunType}</strong> run will compute additional pay items. Upon finalization, all runs for <strong>{fmtPeriod(selectedPeriod)}</strong> will be automatically consolidated — employees will see only one payslip per month.
                </p>
              </div>
              <div className="px-8 py-5 flex justify-end gap-4 bg-page">
                <button onClick={() => { setPeriodConflictRuns([]); setConflictPayslips([]); setConflictSalaryMap({}); }} className="px-6 py-3 bg-paper border border-rule text-muted text-[10px] font-black uppercase tracking-widest hover:bg-page transition-all">Cancel</button>
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
                    className="px-8 py-3 bg-ink text-paper text-[10px] font-black uppercase tracking-widest hover:bg-ink transition-all disabled:opacity-60 flex items-center gap-2"
                  >
                    {isProcessing ? (
                      <><div className="w-3 h-3 border-2 border-white/30 border-t-white animate-spin" /> Processing…</>
                    ) : (
                      <>⚡ Void & Replace — {selectedRunType}</>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={actuallyCreateRun}
                    disabled={isProcessing}
                    className="px-8 py-3 bg-highlight text-paper text-[10px] font-black uppercase tracking-widest hover:bg-highlight transition-all disabled:opacity-60 flex items-center gap-2"
                  >
                    {isProcessing ? (
                      <><div className="w-3 h-3 border-2 border-white/30 border-t-white animate-spin" /> Creating…</>
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
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-8 bg-paper p-10 border border-rule relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
           <div className="w-32 h-32 bg-accent"></div>
        </div>
        <div className="flex flex-col gap-2 relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-accent"></div>
            <span className="text-[10px] font-black text-accent uppercase tracking-[0.4em]">Financial Settlement Layer</span>
          </div>
          <h1 className="text-4xl font-black text-ink tracking-tighter">Payroll <span className="text-accent">Nexus</span></h1>
          <p className="text-sm font-bold text-muted mt-2 uppercase tracking-widest leading-relaxed max-w-xl">
            Salary disbursement, CPF/SDL statutory tracking, and automated GIRO bank generations.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6 relative z-10">
           <div className="hidden lg:flex flex-col items-end justify-center px-6 border-r border-rule">
              <span className="label-form">Active Engine</span>
              <span className="text-[10px] font-black text-accent uppercase mt-1">SG-CPF-STABLE-2026</span>
           </div>
           <a
             href="/payroll/iras-submissions"
             className="px-6 py-5 bg-paper border border-rule text-ink text-[10px] font-black uppercase tracking-[0.2em] hover:border-accent hover:text-accent transition-all flex items-center gap-2"
             title="CPF e-Submit, IR8A, Appendix 8A/8B, IR21 submission tracking"
           >
              <span>◉</span> IRAS & CPF Submissions
           </a>
           <button
             onClick={() => setIsRunModalOpen(true)}
             className="px-10 py-5 bg-accent text-paper text-[10px] font-black uppercase tracking-[0.2em] hover:bg-accent transition-all active:scale-95 flex items-center gap-3"
           >
              <span>⚡</span> Initiate Calculation Engine
           </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-paper p-8 border border-rule group hover:border-accent transition-all">
          <p className="eyebrow-tight mb-4">Pending Disbursement</p>
          <div className="flex items-end gap-3">
            <h3 className="text-4xl font-black text-ink tracking-tighter">$245,600.00</h3>
            <span className="text-[10px] font-black text-accent bg-page px-2 py-0.5 uppercase mb-1.5">Live</span>
          </div>
          <div className="mt-8 flex items-center gap-4 pt-6 border-t border-rule">
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black text-muted uppercase">Net Pay</span>
              <span className="text-xs font-black text-ink">$201,400</span>
            </div>
            <div className="h-4 w-[1px] bg-page"></div>
            <div className="flex flex-col gap-1">
              <span className="text-[9px] font-black text-muted uppercase">Total CPF</span>
              <span className="text-xs font-black text-accent">$44,200</span>
            </div>
          </div>
        </div>
        <div className="bg-paper p-8 border border-rule relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-accent"></div>
          <p className="eyebrow-tight mb-4">YTD Disbursed</p>
          <h3 className="text-4xl font-black text-accent tracking-tighter">$1.2M</h3>
          <p className="text-[9px] font-black text-accent uppercase mt-8 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-accent"></span>
            ↑ 4.2% vs Prev Yr
          </p>
        </div>
        <div className="bg-shadow p-8 border border-shadow">
          <p className="text-[10px] font-black text-accent uppercase tracking-widest mb-6">Statutory Protocol Queue</p>
          <div className="flex flex-col gap-3">
            {(() => {
              // Finalised MONTHLY runs that are pending CPF action (no submission or still DRAFT)
              const finalisedRuns = runs.filter(r => r.status === 'FINALISED' && r.runType === 'MONTHLY');
              const cpfItems = finalisedRuns.map(r => {
                const sub = cpfSubmissions.find(s => s.runId === r.id || s.period === r.period);
                const subStatus = sub?.status ?? null;
                const needsAction = !sub || subStatus === 'DRAFT';
                return { run: r, sub, subStatus, needsAction };
              }).filter(x => x.needsAction).slice(0, 3);

              if (cpfItems.length === 0) return (
                <div className="flex items-center justify-between p-4 bg-shadow border border-shadow">
                  <span className="text-[10px] font-black text-muted uppercase tracking-tight italic">No pending CPF submissions</span>
                  <span className="text-accent text-xs">✓</span>
                </div>
              );

              return cpfItems.map(({ run, subStatus }) => (
                <button key={run.id}
                  onClick={() => setCpfActionRun({ runId: run.id, period: run.period, submissionStatus: subStatus })}
                  className="flex items-center justify-between p-4 bg-shadow border border-shadow hover:border-highlight transition-all group">
                  <span className="text-[10px] font-black text-muted uppercase tracking-tight">
                    CPF Submissions ({fmtPeriod(run.period)})
                  </span>
                  <span className="text-[9px] font-black px-2 py-0.5 bg-highlight text-ink">
                    {subStatus === 'DRAFT' ? 'Upload Pending' : 'Action Needed'}
                  </span>
                </button>
              ));
            })()}
            <button className="flex items-center justify-between p-4 bg-shadow border border-shadow opacity-50 grayscale">
               <span className="text-[10px] font-black text-muted uppercase tracking-tight italic">Bank GIRO (Draft Saved)</span>
               <span className="text-ink">→</span>
            </button>
          </div>
        </div>
      </div>

      {/* Run History */}
      <section className="bg-paper border border-rule overflow-hidden">
        <div className="p-8 border-b border-rule bg-page flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4">
             <div className="w-2 h-8 bg-accent"></div>
             <h3 className="text-lg font-black text-ink uppercase tracking-widest">Historical Run Archive</h3>
          </div>
          <div className="flex gap-4">
            <button className="px-6 py-3 bg-paper border border-rule text-[10px] font-black text-muted uppercase tracking-widest hover:bg-page transition-all">Refine Archive</button>
            <button className="px-6 py-3 bg-paper border border-rule text-[10px] font-black text-accent uppercase tracking-widest hover:bg-page transition-all">Consolidated Export (CSV)</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="text-[10px] text-muted font-black uppercase tracking-[0.2em] border-b border-rule">
              <tr>
                {([
                  { col: 'period', label: 'Accounting Period', cls: 'px-8 py-8' },
                  { col: 'status', label: 'Status Registry',   cls: 'px-8 py-8' },
                  { col: 'type',   label: 'Population',        cls: 'px-8 py-8' },
                ] as const).map(h => (
                  <th key={h.col} className={h.cls}>
                    <button onClick={() => toggleRunSort(h.col)} className="flex items-center hover:text-ink transition-colors">
                      {h.label}<RunSortIcon col={h.col} />
                    </button>
                  </th>
                ))}
                <th className="px-8 py-8 text-right">Net Liquidity</th>
                <th className="px-8 py-8 text-right">Statutory (CPF)</th>
                <th className="px-8 py-8 text-center">Governance Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {runsLoading ? (
                [1,2,3].map(i => (
                  <tr key={i}><td colSpan={6} className="px-8 py-5"><div className="h-8 bg-page animate-pulse" /></td></tr>
                ))
              ) : runs.length === 0 ? (
                <tr><td colSpan={6} className="px-8 py-16 text-center">
                  <span className="text-sm font-black text-muted uppercase tracking-widest">No payroll runs yet</span>
                </td></tr>
              ) : sortedRuns.map((run) => (
                <tr key={run.id} className="group hover:bg-page transition-all duration-300">
                  <td className="px-8 py-6">
                     <span className="text-sm font-black text-ink uppercase tracking-tighter group-hover:text-accent transition-colors">{fmtPeriod(run.period)}</span>
                  </td>
                  <td className="px-8 py-6">
                    <span className={`text-[9px] font-black px-4 py-1.5  uppercase tracking-widest border  ${
                      run.status === 'PENDING_APPROVAL' || run.status === 'DRAFT' ? 'bg-page text-ink border-highlight' :
                      run.status === 'APPROVED' ? 'bg-page text-accent border-accent' :
                      run.status === 'REJECTED' ? 'bg-page text-ink border-ink' :
                      'bg-page text-accent border-accent'
                    }`}>
                      {fmtRunStatus(run.status)}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                     <span className="eyebrow-tight">{run.runType}</span>
                  </td>
                  <td className="px-8 py-6 text-right">
                     <span className="text-sm font-black text-muted tracking-tighter italic">—</span>
                  </td>
                  <td className="px-8 py-6 text-right">
                     <span className="eyebrow-tight italic">—</span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex justify-center items-center">
                      {(run.status === 'PENDING_APPROVAL' || run.status === 'APPROVED' || run.status === 'DRAFT') ? (
                        <button
                          onClick={() => setReviewRunData(run)}
                          className="px-8 py-3 bg-accent text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent transition-all active:scale-95"
                        >
                           Review Protocol
                        </button>
                      ) : run.status === 'REJECTED' ? (
                        <span className="text-[9px] font-black text-muted uppercase tracking-widest italic opacity-50">Locked for Archive</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button onClick={() => { const ref = generateGiroRef(run.period); setGiroRunId(run.id); setGiroBank('uob'); setGiroFields({ acct: '', companyName: 'GADONGHR PTE LTD', valueDate: new Date().toISOString().slice(0,10), ref, batchNo: '001', payDesc: `SALARY ${run.period}` }); }} className="px-4 py-2 bg-shadow text-paper text-[9px] font-black uppercase tracking-widest hover:bg-shadow transition-all">GIRO</button>
                          <button
                            onClick={() => downloadCpfFile(run.id, run.period)}
                            title="Download CPF e-Submit flat file (creates a tracked DRAFT submission)"
                            className="px-4 py-2 bg-accent text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent transition-all"
                          >
                            CPF File
                          </button>
                          <button onClick={() => { setPayslipRunId(run.id); setPayslipRows([]); }} className="px-4 py-2 bg-paper border border-rule label-form hover:text-accent hover:border-accent transition-all">Payslips</button>
                          {runs.filter(r => r.period === run.period && r.id !== run.id && r.status === 'FINALISED').length > 0 && (
                            <button onClick={async () => {
                              try {
                                await apiFetch(`/payroll/runs/${run.id}/consolidate`, { method: 'POST' });
                                handleActionToast(`Payslips consolidated for ${fmtPeriod(run.period)}.`);
                                await loadRuns();
                              } catch (e: any) { handleActionToast(e.message || 'Consolidation failed'); }
                            }} className="px-4 py-2 bg-page border border-highlight text-[9px] font-black text-ink uppercase tracking-widest hover:bg-highlight hover:text-paper hover:border-highlight transition-all">Merge</button>
                          )}
                          <button onClick={() => { setConfirmCancelRun(false); setReviewRunData(run); }} className="px-4 py-2 bg-paper border border-ink text-[9px] font-black text-ink uppercase tracking-widest hover:bg-page hover:text-ink hover:border-ink transition-all">Void</button>
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

      {/* CPF Statutory Action Modal */}
      {cpfActionRun && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-shadow backdrop- p-8 animate-in fade-in duration-200">
          <div className="bg-paper w-full max-w-md border border-rule animate-in slide-in-from-bottom-4 duration-200">
            {/* Header */}
            <div className="p-8 border-b border-rule flex justify-between items-start">
              <div>
                <p className="text-[9px] font-black text-accent uppercase tracking-widest mb-1">Statutory Protocol</p>
                <h3 className="text-xl font-black text-ink tracking-tighter uppercase">CPF e-Submit</h3>
                <p className="text-[10px] font-black text-muted uppercase mt-1">{fmtPeriod(cpfActionRun.period)}</p>
              </div>
              <button onClick={() => setCpfActionRun(null)} className="w-9 h-9 flex items-center justify-center bg-page text-muted hover:text-ink hover:bg-page transition-all font-black text-sm">&times;</button>
            </div>

            {/* Status pill */}
            <div className="px-8 pt-6">
              <div className={`inline-flex items-center gap-2 px-3 py-1.5  text-[9px] font-black uppercase tracking-widest ${
                cpfActionRun.submissionStatus === 'DRAFT'
                  ? 'bg-page text-ink border border-highlight'
                  : 'bg-page text-muted border border-rule'
              }`}>
                <span className={`w-1.5 h-1.5  ${cpfActionRun.submissionStatus === 'DRAFT' ? 'bg-highlight' : 'bg-muted'}`}></span>
                {cpfActionRun.submissionStatus === 'DRAFT' ? 'File generated — awaiting upload to CPF EZPay' : 'No file generated yet'}
              </div>
            </div>

            {/* Actions */}
            <div className="p-8 flex flex-col gap-4">
              {/* Download */}
              <button
                disabled={cpfDownloading}
                onClick={() => downloadCpfFile(cpfActionRun.runId, cpfActionRun.period, () => {
                  setCpfActionRun(prev => prev ? { ...prev, submissionStatus: 'DRAFT' } : null);
                })}
                className="w-full flex items-center gap-4 p-5 bg-accent hover:bg-accent disabled:opacity-60 text-paper transition-all active:scale-[0.98]"
              >
                <div className="w-10 h-10 bg-paper flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-[11px] font-black uppercase tracking-widest">{cpfDownloading ? 'Generating…' : 'Download CPF e-Submit File'}</p>
                  <p className="text-[9px] font-black text-paper mt-0.5">Upload via CPF EZPay portal after download</p>
                </div>
              </button>

              {/* FTP Upload — future */}
              <div className="w-full flex items-center gap-4 p-5 bg-page border border-rule opacity-60 cursor-not-allowed select-none">
                <div className="w-10 h-10 bg-rule flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-[11px] font-black text-muted uppercase tracking-widest">FTP Direct Upload</p>
                  <p className="text-[9px] font-black text-muted mt-0.5">Coming soon — configure SFTP credentials in Settings</p>
                </div>
                <span className="ml-auto text-[8px] font-black bg-rule text-muted px-2 py-0.5 uppercase tracking-widest">Soon</span>
              </div>

              {/* Track on submissions page */}
              <a href="/payroll/iras-submissions"
                onClick={() => setCpfActionRun(null)}
                className="w-full flex items-center justify-center gap-2 p-4 border border-rule text-[10px] font-black text-muted hover:text-accent hover:border-accent transition-all uppercase tracking-widest">
                View IRAS Submissions Ledger →
              </a>
            </div>
          </div>
        </div>
      )}

      {/* GIRO Generation Modal */}
      {giroRunId && (() => {
        const run = runs.find(r => r.id === giroRunId);
        const inputCls = 'w-full bg-page border border-rule px-4 py-3 text-[11px] font-black text-ink outline-none focus:border-accent focus:bg-paper transition-all placeholder:text-muted placeholder:font-bold';
        const labelCls = 'text-[9px] font-black text-muted uppercase tracking-widest';
        const banks = [
          { id: 'uob' as const, label: 'UOB', sub: 'UOB Infinity · 615-char', dot: 'bg-accent' },
          { id: 'ocbc' as const, label: 'OCBC', sub: 'GIRO/FAST · 1000-char', dot: 'bg-ink' },
          { id: 'dbs' as const, label: 'DBS', sub: 'IDEAL · 200-char', dot: 'bg-shadow' },
        ];
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-shadow backdrop- animate-in fade-in duration-300">
            <div className="bg-paper w-full max-w-lg overflow-hidden border border-rule animate-in slide-in-from-bottom-10 max-h-[90vh] flex flex-col">

              {/* Header */}
              <div className="bg-page border-b border-rule px-8 py-6 flex justify-between items-center shrink-0">
                <div>
                  <h3 className="text-xl font-black text-ink tracking-tighter uppercase">Generate GIRO File</h3>
                  <p className="label-form mt-1">
                    {run ? `Period: ${fmtPeriod(run.period)}` : ''} · Fill in your company&apos;s bank details
                  </p>
                </div>
                <button onClick={() => setGiroRunId(null)} className="w-10 h-10 flex items-center justify-center bg-paper border border-rule text-muted hover:bg-page hover:text-ink hover:border-ink transition-all font-black">&times;</button>
              </div>

              <div className="overflow-y-auto flex-1 p-8 flex flex-col gap-6">

                {/* Bank selector */}
                <div className="flex flex-col gap-2">
                  <p className={labelCls}>Company&apos;s Bank</p>
                  <div className="grid grid-cols-3 gap-2">
                    {banks.map(b => (
                      <button key={b.id} onClick={() => setGiroBank(b.id)}
                        className={`flex flex-col items-center gap-1.5 py-4 px-3  border-2 transition-all ${giroBank === b.id ? 'border-accent bg-page' : 'border-rule bg-page hover:border-rule'}`}
                      >
                        <div className={`w-2.5 h-2.5  ${b.dot}`} />
                        <span className={`text-[11px] font-black uppercase ${giroBank === b.id ? 'text-accent' : 'text-ink'}`}>{b.label}</span>
                        <span className="text-[8px] font-bold text-muted uppercase tracking-wide text-center leading-tight">{b.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Company Account Number */}
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}>
                    {giroBank === 'uob' ? 'UOB Account No (10-digit)' : giroBank === 'ocbc' ? 'OCBC Account No (no dashes)' : 'DBS Account No'}
                    <span className="text-ink ml-1">*</span>
                  </label>
                  <input
                    type="text"
                    value={giroFields.acct}
                    onChange={e => gf('acct', e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder={giroBank === 'uob' ? '1234567890' : giroBank === 'ocbc' ? '501234567001' : '0729123456789'}
                    maxLength={giroBank === 'uob' ? 10 : 34}
                    className={inputCls}
                  />
                  <p className="text-[8px] font-bold text-muted uppercase tracking-widest">
                    {giroBank === 'uob' ? 'Your 10-digit UOB account number (debit source)' : giroBank === 'ocbc' ? 'Your OCBC Current Account number, digits only' : 'Your DBS IDEAL account number'}
                  </p>
                </div>

                {/* Company Name — UOB only */}
                {giroBank === 'uob' && (
                  <div className="flex flex-col gap-1.5">
                    <label className={labelCls}>Account / Company Name <span className="text-ink">*</span></label>
                    <input type="text" value={giroFields.companyName} onChange={e => gf('companyName', e.target.value.toUpperCase())} placeholder="ACME PTE LTD" maxLength={35} className={inputCls} />
                    <p className="text-[8px] font-bold text-muted uppercase tracking-widest">Printed on UOB account statement · max 35 chars</p>
                  </div>
                )}

                {/* Value Date */}
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}>Value Date <span className="text-ink">*</span></label>
                  <input type="date" value={giroFields.valueDate} onChange={e => gf('valueDate', e.target.value)} className={inputCls} />
                  <p className="text-[8px] font-bold text-muted uppercase tracking-widest">Date funds are credited to employees&apos; accounts</p>
                </div>

                {/* Payment Description */}
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}>Payment Description</label>
                  <input type="text" value={giroFields.payDesc} onChange={e => gf('payDesc', e.target.value.toUpperCase())} placeholder={`SALARY ${run?.period ?? ''}`} maxLength={35} className={inputCls} />
                  <p className="text-[8px] font-bold text-muted uppercase tracking-widest">Shown on employee&apos;s bank statement · max 35 chars</p>
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
                        className="flex items-center gap-1.5 text-[8px] font-black text-accent uppercase tracking-widest hover:text-accent transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Regenerate
                      </button>
                    </div>
                    <input type="text" value={giroFields.ref} onChange={e => gf('ref', e.target.value.toUpperCase())} placeholder={`PAYROLL${run?.period?.replace('-','') ?? ''}`} maxLength={16} className={inputCls} />
                    <p className="text-[8px] font-bold text-muted uppercase tracking-widest">Auto-generated unique per period · editable · max 16 chars</p>
                  </div>
                  {giroBank === 'ocbc' && (
                    <div className="flex flex-col gap-1.5">
                      <label className={labelCls}>Batch Number</label>
                      <input type="text" value={giroFields.batchNo} onChange={e => gf('batchNo', e.target.value.replace(/[^0-9]/g, '').padStart(0,'').slice(0,3))} placeholder="001" maxLength={3} className={inputCls} />
                      <p className="text-[8px] font-bold text-muted uppercase tracking-widest">3-digit batch identifier</p>
                    </div>
                  )}
                </div>

                {/* Info banner */}
                <div className="bg-page border border-highlight px-5 py-4">
                  <p className="text-[9px] font-black text-ink uppercase tracking-widest">
                    {giroBank === 'dbs' ? 'DBS format is based on IDEAL payroll spec — verify against your DBS IDEAL format document before uploading' : `${giroBank.toUpperCase()} format generated to spec — upload via ${giroBank === 'uob' ? 'UOB Infinity' : 'OCBC Velocity'}`}
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-rule px-8 py-5 shrink-0 flex items-center justify-between gap-4 bg-page">
                <button onClick={() => setGiroRunId(null)} className="px-6 py-3 eyebrow-tight hover:text-ink transition-colors">Cancel</button>
                <button
                  onClick={downloadGiro}
                  disabled={giroDownloading || !giroFields.acct}
                  className="flex items-center gap-3 px-8 py-3 bg-shadow text-paper text-[10px] font-black uppercase tracking-widest hover:bg-shadow transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {giroDownloading ? (
                    <><div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white animate-spin" /><span>Generating…</span></>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-shadow backdrop- animate-in fade-in duration-300">
          <div className="bg-paper w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden border border-rule animate-in slide-in-from-bottom-10">
            <div className="bg-page border-b border-rule p-10 flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-2xl font-black text-ink tracking-tighter uppercase">Initiate Engine</h3>
                <p className="eyebrow-tight mt-2">Fiscal Cycle Alignment v2.4</p>
              </div>
              <button onClick={() => setIsRunModalOpen(false)} className="w-10 h-10 flex items-center justify-center bg-paper border border-rule text-muted hover:bg-page hover:text-ink hover:border-ink transition-all font-black">&times;</button>
            </div>
            <div className="p-10 flex flex-col gap-8 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-3">
                <label className="eyebrow-tight">Accounting Period (YYYY-MM)</label>
                <input type="month" value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)} className="w-full bg-page border border-rule px-6 py-4 text-sm font-black text-ink outline-none focus:border-accent transition-all" />
              </div>
              <div className="flex flex-col gap-3">
                <label className="eyebrow-tight">Run Type</label>
                <select value={selectedRunType} onChange={e => setSelectedRunType(e.target.value)} className="w-full bg-page border border-rule px-6 py-4 text-sm font-black text-ink outline-none focus:border-accent appearance-none cursor-pointer">
                  <option value="MONTHLY">Monthly Payroll</option>
                  <option value="ADHOC">Ad-hoc / Supplemental</option>
                  <option value="BONUS">Bonus</option>
                  <option value="COMMISSION">Commission</option>
                  <option value="FINAL_PAY">Final Pay</option>
                </select>
              </div>
              <div className="flex flex-col gap-3">
                <label className="eyebrow-tight">Workforce Partition</label>
                <select value={processingGroup} onChange={e => setProcessingGroup(e.target.value)} className="w-full bg-page border border-rule px-6 py-4 text-sm font-black text-ink outline-none focus:border-accent appearance-none cursor-pointer">
                  <option value="all">Global Workforce (All Sectors)</option>
                  <option value="full_time">Personnel: Full-Time</option>
                  <option value="contractors">Personnel: Contractors</option>
                  <option value="management">Personnel: Executive</option>
                </select>
              </div>
              {/* ── Period Working-Day Config (MOM EA s.20) ─────────────────── */}
              <div className="pt-4 border-t border-rule flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="eyebrow-tight">Working Days — {fmtPeriod(selectedPeriod)}</p>
                    <p className="text-[8px] font-bold text-muted uppercase tracking-wide mt-0.5">Pro-ration basis for new joiners &amp; leavers</p>
                    <span className="inline-block mt-1"><Seal cite="EA s.20 · incomplete month" /></span>
                  </div>
                  {periodCfg && (
                    <span className={`text-[8px] font-black px-2 py-0.5  uppercase tracking-widest ${periodCfg.isOverridden ? 'bg-page text-ink border border-highlight' : 'bg-page text-accent border border-accent'}`}>
                      {periodCfg.isOverridden ? 'Overridden' : 'Auto (MOM)'}
                    </span>
                  )}
                </div>

                {periodCfgLoading ? (
                  <div className="h-16 bg-page animate-pulse" />
                ) : periodCfg ? (
                  <div className="bg-page p-4 flex flex-col gap-3">
                    {/* Work week selector */}
                    <div className="flex gap-2">
                      {(['FIVE_DAY', 'SIX_DAY'] as const).map(t => (
                        <button key={t} onClick={() => setPeriodCfgWorkDayType(t)}
                          className={`flex-1 py-2 px-3  text-[9px] font-black uppercase tracking-widest border transition-all ${periodCfgWorkDayType === t ? 'bg-accent text-paper border-accent' : 'bg-paper text-muted border-rule hover:border-rule'}`}>
                          {t === 'FIVE_DAY' ? '5-Day (Mon–Fri)' : '6-Day (Mon–Sat)'}
                        </button>
                      ))}
                    </div>

                    {/* Recommended vs override */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <p className="text-[8px] font-black text-muted uppercase tracking-widest mb-1">MOM Recommended</p>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-black text-accent">{periodCfg.recommendedWorkingDays}</span>
                          <span className="text-[9px] font-black text-muted uppercase">days</span>
                        </div>
                        {periodCfg.publicHolidays.length > 0 && (
                          <p className="text-[8px] font-bold text-muted mt-1">
                            {periodCfg.publicHolidays.length} public holiday{periodCfg.publicHolidays.length !== 1 ? 's' : ''} deducted
                            {' ('}{periodCfg.publicHolidays.map(h => h.name).join(', ')}{')'}
                          </p>
                        )}
                      </div>
                      <div className="w-px h-10 bg-rule" />
                      <div className="flex-1">
                        <p className="text-[8px] font-black text-muted uppercase tracking-widest mb-1">Override (optional)</p>
                        <input
                          type="number" min="1" max="31"
                          value={periodCfgOverride}
                          onChange={e => setPeriodCfgOverride(e.target.value)}
                          placeholder={String(periodCfg.recommendedWorkingDays)}
                          className="w-full bg-paper border border-rule px-3 py-2 text-sm font-black text-ink outline-none focus:border-accent transition-all placeholder:text-muted"
                        />
                      </div>
                    </div>

                    <button onClick={savePeriodConfig} disabled={periodCfgSaving}
                      className="self-end px-5 py-2 bg-shadow text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent transition-all disabled:opacity-50">
                      {periodCfgSaving ? 'Saving…' : 'Save Config'}
                    </button>
                  </div>
                ) : (
                  <div className="bg-page p-4 label-form text-center">
                    Could not load period config
                  </div>
                )}
              </div>

              <div className="space-y-4 pt-4 border-t border-rule">
                <label className="flex items-center gap-4 cursor-pointer group">
                  <div className="relative">
                    <input type="checkbox" defaultChecked className="peer opacity-0 absolute inset-0 w-6 h-6 cursor-pointer" />
                    <div className="w-6 h-6 bg-page border border-rule peer-checked:bg-accent peer-checked:border-accent transition-all flex items-center justify-center">
                       <svg className="w-3 h-3 text-paper" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black text-ink uppercase group-hover:text-accent transition-colors">Apply Central Provident Fund (CPF)</span>
                    <span className="text-[9px] font-bold text-muted uppercase mt-0.5 tracking-tight">Age-Band Compliance v2026.01</span>
                  </div>
                </label>
                <label className="flex items-center gap-4 cursor-pointer group">
                  <div className="relative">
                    <input type="checkbox" defaultChecked className="peer opacity-0 absolute inset-0 w-6 h-6 cursor-pointer" />
                    <div className="w-6 h-6 bg-page border border-rule peer-checked:bg-accent peer-checked:border-accent transition-all flex items-center justify-center">
                       <svg className="w-3 h-3 text-paper" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" d="M5 13l4 4L19 7"></path></svg>
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black text-ink uppercase group-hover:text-accent transition-colors">Apply Skills Development Levy (SDL)</span>
                    <span className="text-[9px] font-bold text-muted uppercase mt-0.5 tracking-tight">Cap Protection: SGD 11.25</span>
                    {/* The cap above is a statutory figure, not a house setting —
                        0.25% of the first 4,500 of monthly remuneration. */}
                    <span className="mt-1"><Seal cite="SDL Act · 0.25%, cap 4,500" /></span>
                  </div>
                </label>
              </div>
            </div>
            <div className="bg-page border-t border-rule p-10 flex justify-end gap-5 shrink-0">
               <button onClick={() => setIsRunModalOpen(false)} className="px-8 py-4 bg-paper border border-rule text-muted font-black text-[10px] uppercase tracking-widest hover:bg-page transition-all">Abort</button>
               <button onClick={handleExecute} disabled={isProcessing} className={`px-10 py-4 bg-accent text-paper font-black text-[10px] uppercase tracking-[0.2em]  transition-all   flex items-center gap-3 active:scale-95 ${isProcessing ? 'opacity-70 pointer-events-none' : 'hover:bg-accent'}`}>
                {isProcessing ? (<><svg className="animate-spin h-4 w-4 text-paper" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Simulating Compute…</>) : (<><span>⚡</span>Execute Nexus Pipeline</>)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Run Modal */}
      {reviewRunData && (
        <div className={`fixed inset-0 z-[110] flex items-center justify-center bg-shadow backdrop- animate-in fade-in duration-300 ${reviewFullscreen ? 'p-0' : 'p-8'}`}>
          <div className={`bg-paper w-full border border-rule flex flex-col animate-in slide-in-from-top-10 overflow-hidden transition-all duration-300 ${reviewFullscreen ? 'h-full max-w-none' : 'max-w-4xl max-h-[90vh]'}`}>
            <div className="bg-shadow border-b border-shadow p-10 flex justify-between items-center shrink-0">
              <div className="flex gap-6 items-center">
                 <div className="w-14 h-14 bg-accent flex items-center justify-center text-2xl font-black text-paper">R</div>
                 <div>
                    <h3 className="text-3xl font-black text-paper tracking-tighter uppercase whitespace-nowrap">Review Protocol</h3>
                    <p className="text-[10px] font-black text-accent uppercase tracking-[0.3em] mt-2">Fiscal Deployment: {fmtPeriod(reviewRunData.period)}</p>
                 </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setReviewFullscreen(f => !f)} className="w-12 h-12 flex items-center justify-center bg-shadow border border-shadow text-muted hover:text-paper transition-all" title={reviewFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                  {reviewFullscreen ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0h5m-5 0v5M15 9l5-5m0 0h-5m5 0v5M9 15l-5 5m0 0h5m-5 0v-5M15 15l5 5m0 0h-5m5 0v-5" /></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5" /></svg>
                  )}
                </button>
                <button onClick={() => { setReviewRunData(null); setReviewFullscreen(false); }} className="w-12 h-12 flex items-center justify-center bg-shadow border border-shadow text-muted hover:text-paper transition-all text-2xl">&times;</button>
              </div>
            </div>
            <div className="p-10 overflow-y-auto space-y-12">
              <div className="grid grid-cols-3 gap-8">
                <div className="bg-page p-8 border border-accent"><p className="text-[9px] font-black text-accent uppercase tracking-widest mb-3">Run Type</p><h4 className="text-3xl font-black text-ink tracking-tighter">{reviewRunData.runType}</h4></div>
                <div className="bg-page p-8 border border-accent"><p className="text-[9px] font-black text-accent uppercase tracking-widest mb-3">Status</p><h4 className="text-2xl font-black text-ink tracking-tighter">{fmtRunStatus(reviewRunData.status)}</h4></div>
                <div className="bg-page p-8 border border-rule"><p className="label-form mb-3">Initiated</p><h4 className="text-sm font-black text-ink tracking-tighter">{new Date(reviewRunData.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</h4></div>
              </div>

              {/* Variance warning — shown when other finalised runs exist for same period */}
              {varianceLoading && (
                <div className="bg-page border border-highlight px-6 py-4 flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-highlight border-t-highlight animate-spin" />
                  <span className="text-[9px] font-black text-ink uppercase tracking-widest">Checking for period conflicts…</span>
                </div>
              )}
              {!varianceLoading && variance?.hasConflicts && (
                <div className="bg-page border border-highlight overflow-hidden">
                  <div className="px-8 py-5 border-b border-highlight flex items-center gap-3">
                    <span className="text-ink text-lg">&#9888;</span>
                    <div>
                      <p className="text-[10px] font-black text-ink uppercase tracking-widest">
                        Period Conflict — {variance.otherRunCount} other run{variance.otherRunCount !== 1 ? 's' : ''} for {fmtPeriod(variance.period)} already finalised
                      </p>
                      <p className="text-[9px] font-bold text-ink uppercase tracking-widest mt-0.5">
                        Upon finalization, these will be consolidated into one payslip per employee.
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-page text-[9px] font-black text-ink uppercase tracking-widest">
                        <tr>
                          <th className="px-6 py-3">Employee</th>
                          <th className="px-6 py-3 text-right">Existing Net</th>
                          <th className="px-6 py-3 text-right">This Run Adds</th>
                          <th className="px-6 py-3 text-right">Combined Net</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rule">
                        {variance.rows.filter((r: any) => r.hasExisting).map((r: any, i: number) => (
                          <tr key={i} className="hover:bg-page">
                            <td className="px-6 py-3 font-black text-ink uppercase">{empNameMap.get(r.employeeId) ?? r.employeeId.slice(0, 8)}</td>
                            <td className="px-6 py-3 text-right font-bold text-muted">SGD {fmtSGD(r.existingNet)}</td>
                            <td className="px-6 py-3 text-right font-black text-ink">+ SGD {fmtSGD(r.delta)}</td>
                            <td className="px-6 py-3 text-right font-black text-accent">SGD {fmtSGD(r.combinedNet)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="space-y-8 pb-10">
                <div className="flex justify-between items-center border-b border-rule pb-4">
                   <h4 className="text-[11px] font-black text-ink uppercase tracking-[0.2em] flex items-center gap-4"><div className="w-8 h-1 bg-accent"></div>Resource Verification Matrix</h4>
                   <input type="text" placeholder="Search focal point…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="bg-page border border-rule px-5 py-2.5 text-[10px] font-black text-ink outline-none focus:border-accent w-64" />
                </div>
                <div className="overflow-hidden border border-rule">
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-page border-b border-rule font-black text-muted uppercase tracking-widest sticky top-0 z-10 backdrop-">
                        <tr>
                          {([
                            { col: 'name',    label: 'Entity',         cls: 'px-8 py-5',            align: 'start' },
                            { col: 'gross',   label: 'Gross Exposure', cls: 'px-8 py-5 text-right', align: 'end' },
                            { col: 'selfCpf', label: 'Self CPF',       cls: 'px-8 py-5 text-right', align: 'end' },
                            { col: 'firmCpf', label: 'Firm CPF',       cls: 'px-8 py-5 text-right', align: 'end' },
                            { col: 'net',     label: 'Liquid Net',     cls: 'px-8 py-5 text-right', align: 'end' },
                          ] as const).map(h => (
                            <th key={h.col} className={h.cls}>
                              <button onClick={() => toggleReviewSort(h.col)} className={`flex items-center hover:text-ink transition-colors ${h.align === 'end' ? 'ml-auto justify-end' : ''}`}>
                                {h.label}<ReviewSortIcon col={h.col} />
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rule">
                        {filteredEmployees.length === 0 && reviewPayslips.length === 0 ? (
                          <tr><td colSpan={5} className="px-8 py-10 text-center text-[10px] font-black text-muted uppercase tracking-widest">
                            {reviewRunData?.status === 'DRAFT' ? 'Compute payroll first to see employee breakdown' : 'No payslips found for this run'}
                          </td></tr>
                        ) : filteredEmployees.map((ps, i) => {
                          const name = empNameMap.get(ps.employeeId) ?? ps.employeeId;
                          const empCodes = runPaycodes[ps.employeeId] || [];
                          const canEdit = reviewRunData?.status === 'PENDING_APPROVAL';
                          const isAddingHere = addingPaycodeFor === ps.employeeId;
                          return (
                            <React.Fragment key={i}>
                              <tr className="hover:bg-page transition-all">
                                <td className="px-8 py-4">
                                  <div className="flex flex-col gap-1">
                                    <span className="font-black text-ink uppercase tracking-tight">{name}</span>
                                    <span className="text-[10px] font-bold text-muted uppercase">{ps.employeeId.slice(0, 8)}</span>
                                    {canEdit && <button onClick={() => { setAddingPaycodeFor(isAddingHere ? null : ps.employeeId); setNewPcAmount(''); setNewPcDesc(''); if (payComponents.length > 0 && !newPcComponentId) setNewPcComponentId(payComponents[0].id); }} className="text-[9px] font-black text-accent uppercase tracking-widest hover:text-accent text-left mt-1">+ Add Paycode</button>}
                                  </div>
                                </td>
                                <td className="px-8 py-4 text-right text-ink">SGD {fmtSGD(ps.grossPay)}</td>
                                <td className="px-8 py-4 text-right text-ink italic">-SGD {fmtSGD(ps.employeeCpf)}</td>
                                <td className="px-8 py-4 text-right text-muted">SGD {fmtSGD(ps.employerCpf)}</td>
                                <td className="px-8 py-4 text-right font-black text-accent tracking-tight">SGD {fmtSGD(ps.netPay)}</td>
                              </tr>
                              {(empCodes.length > 0 || isAddingHere) && (
                                <tr className="bg-page">
                                  <td colSpan={5} className="px-8 pb-4 pt-1">
                                    <div className="flex flex-col gap-2">
                                      {empCodes.map((pc: any) => (
                                        <div key={pc.id} className="flex items-center justify-between bg-paper border border-rule px-4 py-2">
                                          <span className="text-[10px] font-black text-ink uppercase tracking-wide">{pc.description}</span>
                                          <div className="flex items-center gap-3">
                                            <span className={`text-[10px] font-black ${pc.amount >= 0 ? 'text-accent' : 'text-ink'}`}>{pc.amount >= 0 ? '+' : ''}SGD {fmtSGD(Math.abs(pc.amount))}</span>
                                            <span className="text-[9px] text-muted uppercase">{pc.wageType}</span>
                                            {canEdit && <button onClick={async () => { await apiFetch(`/payroll/runs/${reviewRunData.id}/paycodes/${pc.id}`, { method: 'DELETE' }); setRunPaycodes(p => { const n = { ...p }; n[ps.employeeId] = (n[ps.employeeId] || []).filter((x: any) => x.id !== pc.id); return n; }); setPaycodesDirty(true); }} className="text-ink hover:text-ink text-xs font-black">×</button>}
                                          </div>
                                        </div>
                                      ))}
                                      {isAddingHere && (
                                        <div className="flex items-center gap-3 bg-paper border border-accent px-4 py-3 mt-1">
                                          <select value={newPcComponentId} onChange={e => setNewPcComponentId(e.target.value)} className="bg-page border border-rule px-3 py-1.5 text-[10px] font-black text-ink outline-none focus:border-accent flex-1">
                                            {payComponents.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                          </select>
                                          <input type="number" placeholder="Amount (neg = deduction)" value={newPcAmount} onChange={e => setNewPcAmount(e.target.value)} className="bg-page border border-rule px-3 py-1.5 text-[10px] font-black text-ink outline-none focus:border-accent w-44" />
                                          <button onClick={async () => {
                                            if (!newPcAmount) return;
                                            const comp = payComponents.find((c: any) => c.id === newPcComponentId);
                                            const item = await apiFetch(`/payroll/runs/${reviewRunData.id}/paycodes`, { method: 'POST', body: JSON.stringify({ employeeId: ps.employeeId, componentId: newPcComponentId, description: newPcDesc || comp?.name, amount: parseFloat(newPcAmount) }) });
                                            setRunPaycodes(p => { const n = { ...p }; n[ps.employeeId] = [...(n[ps.employeeId] || []), item]; return n; });
                                            setAddingPaycodeFor(null); setNewPcAmount(''); setNewPcDesc(''); setPaycodesDirty(true);
                                          }} className="px-4 py-1.5 bg-accent text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent transition-all whitespace-nowrap">Add</button>
                                          <button onClick={() => setAddingPaycodeFor(null)} className="text-muted hover:text-ink text-xs font-black">×</button>
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
            <div className="bg-page border-t border-rule p-10 flex justify-between items-center">
               <div className="flex gap-3">
                 <button onClick={() => { setReviewRunData(null); setConfirmCancelRun(false); setReviewFullscreen(false); }} className="px-10 py-5 bg-paper border border-rule text-muted text-[10px] font-black uppercase tracking-widest hover:bg-page transition-all">Close</button>
                 {!confirmCancelRun ? (
                   <button onClick={() => {
                     if (reviewRunData?.status === 'FINALISED') { setConfirmCancelRun(true); } else {
                       const id = reviewRunData.id; const period = reviewRunData.period;
                       setReviewRunData(null);
                       apiFetch(`/payroll/runs/${id}/cancel`, { method: 'POST' })
                         .then(() => { handleActionToast(`Payroll run for ${period} cancelled.`); loadRuns(); })
                         .catch((e: any) => handleActionToast(e.message || 'Failed to cancel run'));
                     }
                   }} className="px-10 py-5 bg-paper border border-ink text-ink text-[10px] font-black uppercase tracking-widest hover:bg-page transition-all">
                     Cancel Run
                   </button>
                 ) : (
                   <div className="flex items-center gap-3 bg-page border border-ink px-5 py-3">
                     <span className="text-[9px] font-black text-ink uppercase tracking-widest">This will void all published payslips. Confirm?</span>
                     <button onClick={async () => {
                       const id = reviewRunData.id; const period = reviewRunData.period;
                       setConfirmCancelRun(false); setReviewRunData(null);
                       try {
                         await apiFetch(`/payroll/runs/${id}/cancel`, { method: 'POST' });
                         handleActionToast(`Payroll run for ${period} voided.`); loadRuns();
                       } catch (e: any) { handleActionToast(e.message || 'Failed to void run'); }
                     }} className="px-5 py-2 bg-ink text-paper text-[9px] font-black uppercase tracking-widest hover:bg-ink transition-all">Void</button>
                     <button onClick={() => setConfirmCancelRun(false)} className="px-5 py-2 bg-paper border border-rule text-muted text-[9px] font-black uppercase tracking-widest hover:bg-page transition-all">Back</button>
                   </div>
                 )}
               </div>
               <div className="flex gap-4 items-center">
                 {reviewRunData?.status === 'DRAFT' && (
                   <div className="text-[9px] font-black text-ink uppercase tracking-widest bg-page border border-highlight px-4 py-2">
                     Step 1 of 3 · Compute payroll to proceed
                   </div>
                 )}
                 {reviewRunData?.status === 'PENDING_APPROVAL' && paycodesDirty && (
                   <div className="text-[9px] font-black text-ink uppercase tracking-widest bg-page border border-highlight px-4 py-2">
                     ⚠ Paycodes changed · Recompute to apply
                   </div>
                 )}
                 {reviewRunData?.status === 'PENDING_APPROVAL' && !paycodesDirty && (
                   <div className="text-[9px] font-black text-accent uppercase tracking-widest bg-page border border-accent px-4 py-2">
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
                       const attWarnR = result?.warnings?.attendanceNotApproved;
                       const notes: string[] = [];
                       if (removedIds.length > 0) notes.push(`${removedIds.length} employee(s) unchanged — skipped`);
                       if (zeroIds.length > 0) notes.push(`${zeroIds.length} have $0 ordinary wages — check salary`);
                       if (attWarnR) {
                         const who = attWarnR.lockedBy ? `locked by ${attWarnR.lockedBy} but not yet approved` : 'not yet locked or approved';
                         notes.push(`Attendance period ${attWarnR.period} was ${who} (${attWarnR.periodStatus}) — attendance auto-feed skipped`);
                       }
                       handleActionToast(notes.length > 0
                         ? `Recomputed. NOTE: ${notes.join('; ')}.`
                         : 'Recomputed with updated paycodes.');
                     } catch (e: any) { handleActionToast(e.message || 'Recompute failed'); }
                   }} className="px-10 py-5 bg-highlight text-paper text-[10px] font-black uppercase tracking-widest hover:bg-highlight active:scale-95 transition-all">
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
                         const attWarn = result?.warnings?.attendanceNotApproved;
                         const notes: string[] = [];
                         if (removedIds.length > 0) notes.push(`${removedIds.length} employee(s) unchanged from prior payslip — skipped from this run`);
                         if (zeroIds.length > 0) notes.push(`${zeroIds.length} have $0 ordinary wages — check salary before authorising`);
                         if (attWarn) {
                           const who = attWarn.lockedBy ? `locked by ${attWarn.lockedBy} but not yet approved` : 'not yet locked or approved';
                           notes.push(`Attendance period ${attWarn.period} was ${who} (status: ${attWarn.periodStatus}) — attendance auto-feed skipped, verify OT/absences manually`);
                         }
                         handleActionToast(notes.length > 0
                           ? `Computed. NOTE: ${notes.join('; ')}.`
                           : 'Payroll computed. Pending authorisation.');
                       }
                       loadRuns();
                     } catch (e: any) { handleActionToast(e.message || 'Action failed'); }
                   }} className="px-12 py-5 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent active:scale-95 transition-all">
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
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-shadow backdrop- p-8 animate-in fade-in duration-300">
           <div className="bg-paper w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-rule animate-in slide-in-from-bottom-5">
              <div className="p-10 border-b border-rule flex justify-between items-center shrink-0">
                 <div>
                   <h3 className="text-2xl font-black text-ink tracking-tighter uppercase leading-none">Payslips</h3>
                   <p className="eyebrow-tight mt-3">{payslipRunPeriod ? fmtPeriod(payslipRunPeriod) : 'Loading…'} · {payslipRows.length} records</p>
                 </div>
                 <button onClick={() => setPayslipRunId(null)} className="w-10 h-10 flex items-center justify-center bg-paper border border-rule text-muted hover:text-ink transition-all font-black">&times;</button>
              </div>
              <div className="flex-1 overflow-y-auto">
                 {payslipLoading ? (
                   <div className="py-16 flex items-center justify-center gap-3">
                     <div className="w-6 h-6 border-2 border-accent border-t-accent animate-spin" />
                     <span className="eyebrow-tight">Loading payslips…</span>
                   </div>
                 ) : payslipRows.length === 0 ? (
                   <div className="py-16 text-center">
                     <p className="text-sm font-black text-muted uppercase tracking-widest">No payslips for this run</p>
                     <p className="text-[10px] font-bold text-muted mt-2">Run must be finalised for payslips to be visible</p>
                   </div>
                 ) : (
                 <table className="w-full text-left text-sm border-collapse">
                    <thead className="bg-page eyebrow-tight sticky top-0 z-10 backdrop-">
                       <tr>
                         {([
                           { col: 'name',  label: 'Employee', cls: 'px-10 py-5',            align: 'start' },
                           { col: 'gross', label: 'Gross',    cls: 'px-10 py-5 text-right', align: 'end' },
                           { col: 'net',   label: 'Net Pay',  cls: 'px-10 py-5 text-right', align: 'end' },
                         ] as const).map(h => (
                           <th key={h.col} className={h.cls}>
                             <button onClick={() => togglePayslipSort(h.col)} className={`flex items-center hover:text-ink transition-colors ${h.align === 'end' ? 'ml-auto justify-end' : ''}`}>
                               {h.label}<PayslipSortIcon col={h.col} />
                             </button>
                           </th>
                         ))}
                         <th className="px-10 py-5 text-center">PDF</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-rule">
                       {sortedPayslipRows.map((ps, i) => {
                         const name = empNameMap.get(ps.employeeId) ?? `Employee ${ps.employeeId.slice(0, 8)}`;
                         return (
                           <tr key={i} className="hover:bg-page transition-all group">
                              <td className="px-10 py-4 text-xs font-black text-ink group-hover:text-accent uppercase tracking-tight">{name}</td>
                              <td className="px-10 py-4 text-xs font-bold text-muted text-right">SGD {fmtSGD(ps.grossPay)}</td>
                              <td className="px-10 py-4 text-xs font-black text-accent text-right">SGD {fmtSGD(ps.netPay)}</td>
                              <td className="px-10 py-4 text-center">
                                <button
                                  onClick={() => downloadPayslipPdf(ps.employeeId, ps.period, name)}
                                  disabled={!ps.isPublished}
                                  className="px-4 py-1.5 bg-page text-accent text-[9px] font-black uppercase hover:bg-accent hover:text-paper transition-all disabled:opacity-40 disabled:pointer-events-none"
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
              <div className="p-8 bg-page border-t border-rule flex justify-between items-center shrink-0">
                 <p className="label-form">{payslipRows.filter(p => p.isPublished).length} published · {payslipRows.filter(p => !p.isPublished).length} pending</p>
                 <button
                   onClick={async () => {
                     const published = payslipRows.filter(p => p.isPublished);
                     for (const ps of published) {
                       const name = empNameMap.get(ps.employeeId) ?? ps.employeeId;
                       await downloadPayslipPdf(ps.employeeId, ps.period, name);
                     }
                   }}
                   disabled={payslipRows.filter(p => p.isPublished).length === 0}
                   className="px-6 py-3 bg-shadow text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent transition-all disabled:opacity-40 disabled:pointer-events-none"
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
           <div className="bg-accent border border-accent p-6 flex items-center gap-6 overflow-hidden relative group">
              <div className="absolute top-0 left-0 w-1 h-full bg-accent"></div>
              <div className="w-14 h-14 bg-accent flex items-center justify-center text-2xl group-hover:scale-110 transition-transform duration-500">⚡</div>
              <div className="flex flex-col">
                 <h4 className="text-sm font-black text-paper uppercase tracking-widest">Pipeline Synchronized</h4>
                 <p className="text-[10px] font-bold text-accent uppercase mt-1">Payroll run initiated for {fmtPeriod(selectedPeriod)}.</p>
              </div>
           </div>
        </div>
      )}
      {(actionToast || dlProgress) && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-10 duration-500">
           <div className="bg-shadow border border-shadow px-8 py-5 flex items-center gap-6">
              {/* Only the in-progress state pulses; a finished toast holding a
                  live animation reads as still working. */}
              <div className={`w-2 h-2 bg-accent ${dlProgress ? 'animate-pulse' : ''}`}></div>
              <span className="text-[10px] font-black text-paper uppercase tracking-[0.2em]">{dlProgress ?? actionToast}</span>
           </div>
        </div>
      )}

      {/* Employee detail drawer */}
      {selectedEmployee && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-shadow backdrop- animate-in fade-in duration-500">
          <div className="bg-paper w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden border border-rule animate-in zoom-in-95 duration-500">
            <div className="bg-shadow px-10 py-8 flex justify-between items-start text-paper relative shrink-0">
              <div className="flex flex-col gap-1 relative z-10">
                <h3 className="text-3xl font-black tracking-tighter uppercase whitespace-nowrap">{selectedEmployee.name}</h3>
                <p className="text-[10px] font-black text-accent uppercase tracking-[0.3em] mt-2">{selectedEmployee.role} · {selectedEmployee.department}</p>
              </div>
              <button onClick={() => setSelectedEmployee(null)} className="w-10 h-10 flex items-center justify-center bg-shadow border border-shadow text-muted hover:text-paper transition-all text-2xl font-black">&times;</button>
            </div>
            <div className="p-10 space-y-6 flex-1 overflow-y-auto">
              <div className="space-y-3">
                <div className="flex justify-between items-center bg-page px-6 py-4 border border-rule"><span className="text-[10px] font-black text-muted uppercase tracking-widest">Contractual Base</span><span className="text-sm font-black text-ink">${selectedEmployee.base.toFixed(2)}</span></div>
                <div className="flex justify-between items-center bg-page px-6 py-4 border border-rule"><span className="text-[10px] font-black text-muted uppercase tracking-widest">Allowance</span><span className="text-sm font-black text-ink">${selectedEmployee.allowance.toFixed(2)}</span></div>
                <div className="flex justify-between items-center pt-4 px-6"><span className="text-[11px] font-black text-ink uppercase tracking-widest">Gross Pay</span><span className="text-2xl font-black text-ink tracking-tighter">${selectedEmployee.gross.toFixed(2)}</span></div>
              </div>
              <div className="space-y-3 bg-page p-6 border border-rule">
                {/* Statutory block — every figure below is set by statute, not
                    by the employer, so each carries the rule that produced it. */}
                <div className="flex items-center justify-between px-4 pb-2 border-b border-rule">
                  <span className="text-[10px] font-black text-muted uppercase tracking-widest">Statutory</span>
                  <Seal cite="CPF Act s.7 · Jan 2026 table" />
                </div>
                <div className="flex justify-between items-center px-4"><span className="text-xs font-bold text-ink uppercase">Employee CPF (20%)</span><span className="text-sm font-black text-ink italic">-${selectedEmployee.empCpf.toFixed(2)}</span></div>
                <div className="flex justify-between items-center px-4"><span className="text-xs font-bold text-muted uppercase">Employer CPF (17%)</span><span className="text-xs font-black text-muted">${selectedEmployee.emprCpf.toFixed(2)}</span></div>
                <div className="flex justify-between items-center px-4"><span className="text-xs font-bold text-muted uppercase">SDL</span><span className="flex items-center gap-2"><Seal cite="SDL Act · 0.25%, cap 4,500" /><span className="text-xs font-black text-muted tabular-nums">${selectedEmployee.sdl.toFixed(2)}</span></span></div>
              </div>
            </div>
            <div className="bg-accent px-10 py-10 flex justify-between items-center shrink-0">
              <span className="text-[10px] font-black text-paper uppercase tracking-[0.3em] italic">Net Pay</span>
              <span className="text-5xl font-black text-paper tracking-tighter italic">${selectedEmployee.net.toFixed(2)}</span>
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
        <div className="w-10 h-10 border-4 border-accent border-t-accent animate-spin" />
      </div>
    );
  }

  const role = user?.role?.toUpperCase() ?? '';
  const isPrivileged = role === 'SUPER_ADMIN' || role === 'HR_ADMIN' || role === 'PAYROLL_OFFICER' || role === 'HR_MANAGER' || role === 'FINANCE_ADMIN';

  if (!isPrivileged) return <EmployeePayslipsView />;
  return <AdminPayrollDashboard />;
}
