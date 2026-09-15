'use client';

import { useState, useEffect, useMemo } from 'react';
import { apiFetch, apiFetchRaw } from '@/lib/api';
import { fmtPeriod } from './format';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PayrollRun {
  id: string;
  period: string;
  runType: string;
  status: string;
  initiatedBy: string;
  approvedBy: string | null;
  createdAt: string;
  finalisedAt: string | null;
}

// ─── GIRO reference helpers ──────────────────────────────────────────────────

const todayIso = () => new Date().toISOString().slice(0, 10);

export function generateGiroRef(period: string): string {
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

export function markGiroRefUsed(period: string, ref: string) {
  if (typeof window === 'undefined' || !ref) return;
  const key = `giro_refs_${period}`;
  const used: string[] = JSON.parse(localStorage.getItem(key) || '[]');
  if (!used.includes(ref)) { used.push(ref); localStorage.setItem(key, JSON.stringify(used)); }
}

/**
 * All state, data-loading, and side-effecting handlers for the admin payroll
 * dashboard. Extracted verbatim from the screen so the presentation layer can be
 * restyled without touching the GIRO / CPF e-Submit / statutory paths — every
 * handler body below is moved character-for-character from the prior inline code.
 */
export function usePayrollAdmin() {
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
  const [giroBank, setGiroBank] = useState<'uob' | 'ocbc' | 'dbs'>('uob');
  const [giroFields, setGiroFields] = useState({
    acct: '', companyName: 'GADONGHR PTE LTD', valueDate: todayIso(),
    ref: '', batchNo: '001', payDesc: '',
  });
  const gf = (k: keyof typeof giroFields, v: string) => setGiroFields(f => ({ ...f, [k]: v }));

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

  // ── Consolidate (Merge) confirmation ────────────────────────────────────────
  const [consolidateTarget, setConsolidateTarget] = useState<PayrollRun | null>(null);
  const [consolidateRuns, setConsolidateRuns] = useState<PayrollRun[]>([]);
  const [consolidateTotal, setConsolidateTotal] = useState<number | null>(null);
  const [consolidateLoading, setConsolidateLoading] = useState(false);
  const [consolidateBusy, setConsolidateBusy] = useState(false);

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

  // Open the GIRO modal for a run, seeding a fresh unique reference + defaults.
  const openGiroModal = (run: PayrollRun) => {
    const ref = generateGiroRef(run.period);
    setGiroRunId(run.id);
    setGiroBank('uob');
    setGiroFields({ acct: '', companyName: 'GADONGHR PTE LTD', valueDate: new Date().toISOString().slice(0, 10), ref, batchNo: '001', payDesc: `SALARY ${run.period}` });
  };

  // Merge supplemental runs into one consolidated payslip per employee.
  // Consolidation is irreversible and touches money, so it now goes through a
  // confirmation that names the runs being merged and their combined net total.
  // openConsolidate gathers the finalised runs for the period and fetches their
  // net totals for the dialog; confirmConsolidate fires the same POST as before.
  const openConsolidate = (run: PayrollRun) => {
    const merged = [run, ...runs.filter(r => r.period === run.period && r.id !== run.id && r.status === 'FINALISED')];
    setConsolidateTarget(run);
    setConsolidateRuns(merged);
    setConsolidateTotal(null);
    setConsolidateLoading(true);
    Promise.all(merged.map(r =>
      apiFetch(`/payroll/runs/${r.id}/payslips`)
        .then((d: any) => (d.payslips ?? []).reduce((s: number, ps: any) => s + (ps.netPay ?? 0), 0))
        .catch(() => 0),
    ))
      .then(totals => setConsolidateTotal(totals.reduce((a, b) => a + b, 0)))
      .finally(() => setConsolidateLoading(false));
  };

  const cancelConsolidate = () => {
    setConsolidateTarget(null);
    setConsolidateRuns([]);
    setConsolidateTotal(null);
  };

  const confirmConsolidate = async () => {
    if (!consolidateTarget) return;
    const run = consolidateTarget;
    setConsolidateBusy(true);
    try {
      await apiFetch(`/payroll/runs/${run.id}/consolidate`, { method: 'POST' });
      handleActionToast(`Payslips consolidated for ${fmtPeriod(run.period)}.`);
      setConsolidateTarget(null);
      setConsolidateRuns([]);
      setConsolidateTotal(null);
      await loadRuns();
    } catch (e: any) { handleActionToast(e.message || 'Consolidation failed'); }
    finally { setConsolidateBusy(false); }
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
      handleActionToast(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  // Void an already-finalised same-type run, then create the replacement.
  const voidAndReplace = async (conflictingRun: PayrollRun) => {
    setIsProcessing(true);
    try {
      await apiFetch(`/payroll/runs/${conflictingRun.id}/cancel`, { method: 'POST' });
      await actuallyCreateRun();
    } catch (e: any) {
      handleActionToast(e.message || 'Void & Replace failed');
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

  // ── Review-modal lifecycle actions (compute → approve → finalise, cancel) ───
  const cancelRun = async (id: string, period: string) => {
    setReviewRunData(null);
    apiFetch(`/payroll/runs/${id}/cancel`, { method: 'POST' })
      .then(() => { handleActionToast(`Payroll run for ${period} cancelled.`); loadRuns(); })
      .catch((e: any) => handleActionToast(e.message || 'Failed to cancel run'));
  };

  const voidRun = async (id: string, period: string) => {
    setConfirmCancelRun(false); setReviewRunData(null);
    try {
      await apiFetch(`/payroll/runs/${id}/cancel`, { method: 'POST' });
      handleActionToast(`Payroll run for ${period} voided.`); loadRuns();
    } catch (e: any) { handleActionToast(e.message || 'Failed to void run'); }
  };

  const recomputeRun = async (id: string) => {
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
  };

  const advanceRun = async (id: string, status: string) => {
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
  };

  const addPaycode = async (ps: any) => {
    if (!newPcAmount) return;
    const comp = payComponents.find((c: any) => c.id === newPcComponentId);
    const item = await apiFetch(`/payroll/runs/${reviewRunData.id}/paycodes`, { method: 'POST', body: JSON.stringify({ employeeId: ps.employeeId, componentId: newPcComponentId, description: newPcDesc || comp?.name, amount: parseFloat(newPcAmount) }) });
    setRunPaycodes(p => { const n = { ...p }; n[ps.employeeId] = [...(n[ps.employeeId] || []), item]; return n; });
    setAddingPaycodeFor(null); setNewPcAmount(''); setNewPcDesc(''); setPaycodesDirty(true);
  };

  const deletePaycode = async (employeeId: string, pcId: string) => {
    await apiFetch(`/payroll/runs/${reviewRunData.id}/paycodes/${pcId}`, { method: 'DELETE' });
    setRunPaycodes(p => { const n = { ...p }; n[employeeId] = (n[employeeId] || []).filter((x: any) => x.id !== pcId); return n; });
    setPaycodesDirty(true);
  };

  const bulkDownloadPayslips = async () => {
    const published = payslipRows.filter(p => p.isPublished);
    for (const ps of published) {
      const name = empNameMap.get(ps.employeeId) ?? ps.employeeId;
      await downloadPayslipPdf(ps.employeeId, ps.period, name);
    }
  };

  // ── DRC banner helpers ─────────────────────────────────────────────────────
  const drcAlerts = drcResults.filter(r => r.status === 'EXCEEDED' || r.status === 'WARNING');

  return {
    // primitive state + setters
    isRunModalOpen, setIsRunModalOpen,
    isProcessing,
    showSuccessToast,
    reviewRunData, setReviewRunData,
    payslipRunId, setPayslipRunId,
    payslipRunPeriod,
    payslipRows, setPayslipRows,
    payslipLoading,
    payslipSort,
    reviewPayslips,
    empNameMap,
    dlProgress,
    actionToast,
    selectedEmployee, setSelectedEmployee,
    searchQuery, setSearchQuery,
    giroRunId, setGiroRunId,
    giroDownloading,
    giroBank, setGiroBank,
    giroFields, gf,
    runs,
    runsLoading,
    runSort,
    selectedPeriod, setSelectedPeriod,
    processingGroup, setProcessingGroup,
    selectedRunType, setSelectedRunType,
    confirmCancelRun, setConfirmCancelRun,
    payComponents,
    runPaycodes,
    addingPaycodeFor, setAddingPaycodeFor,
    newPcComponentId, setNewPcComponentId,
    newPcAmount, setNewPcAmount,
    newPcDesc, setNewPcDesc,
    paycodesDirty,
    reviewFullscreen, setReviewFullscreen,
    periodConflictRuns, setPeriodConflictRuns,
    conflictPayslips, setConflictPayslips,
    conflictLoading,
    conflictSalaryMap, setConflictSalaryMap,
    variance,
    varianceLoading,
    consolidateTarget,
    consolidateRuns,
    consolidateTotal,
    consolidateLoading,
    consolidateBusy,
    drcResults,
    drcLoaded,
    cpfSubmissions,
    cpfActionRun, setCpfActionRun,
    cpfDownloading,
    periodCfg,
    periodCfgLoading,
    periodCfgWorkDayType, setPeriodCfgWorkDayType,
    periodCfgOverride, setPeriodCfgOverride,
    periodCfgSaving,
    reviewSort,
    // derived
    sortedRuns,
    filteredEmployees,
    sortedPayslipRows,
    drcAlerts,
    // sort togglers
    toggleRunSort,
    toggleReviewSort,
    togglePayslipSort,
    // data + actions
    loadRuns,
    loadCpfSubmissions,
    loadPeriodConfig,
    savePeriodConfig,
    fetchPayslipsForRun,
    downloadPayslipPdf,
    handleActionToast,
    downloadCpfFile,
    downloadGiro,
    openGiroModal,
    openConsolidate,
    cancelConsolidate,
    confirmConsolidate,
    actuallyCreateRun,
    voidAndReplace,
    handleExecute,
    cancelRun,
    voidRun,
    recomputeRun,
    advanceRun,
    addPaycode,
    deletePaycode,
    bulkDownloadPayslips,
  };
}
