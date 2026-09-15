'use client';

/**
 * Payroll — admin dashboard (Payroll / HR Admin).
 *
 * The run register plus the compute → approve → finalise → disburse workflow:
 * initiate a run, review the per-employee breakdown and paycodes, authorise,
 * then generate the GIRO bank file and CPF e-Submit file. The statutory figures
 * (CPF, SDL, EA s.20 pro-ration basis) carry their Seal citations — every number
 * here is one an employer may have to defend to the CPF Board or IRAS.
 *
 * Rebuilt to the "Clean workspace" kit (2026-09). Presentation only — all state,
 * data loading and the GIRO / CPF / compute paths live in usePayrollAdmin and are
 * unchanged; this file is markup. See that hook for the logic.
 */

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { EmployeePayslipsView } from './EmployeePayslipsView';
import { fmtSGD, fmtPeriod } from './format';
import { Seal, Notice } from '@/components/official';
import { PageHeader, Card, CardHeader, Stat, DataTable, Button, Field, Input, Select, Modal, EmptyState, Icon } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePayrollAdmin, generateGiroRef, type PayrollRun } from './usePayrollAdmin';

// ─── Display helpers ─────────────────────────────────────────────────────────

function fmtRunStatus(s: string): string {
  const map: Record<string, string> = {
    DRAFT: 'Draft',
    PENDING_APPROVAL: 'Pending approval',
    APPROVED: 'Approved',
    FINALISED: 'Disbursed',
    REJECTED: 'Rejected',
  };
  return map[s] ?? s;
}

const sgd = (n: number) => `S$${fmtSGD(n)}`;

/**
 * Run status by weight and fill, not hue — the palette has no error red or
 * success green to spend (seal red is reserved). The states that need action
 * are heaviest; settled ones recede. The word is always present.
 */
const RUN_STATUS_TONE: Record<string, string> = {
  DRAFT:            'bg-pill text-muted',
  PENDING_APPROVAL: 'bg-paper text-ink border border-ink',
  APPROVED:         'bg-tint text-accent',
  FINALISED:        'bg-accent text-on-accent',
  REJECTED:         'bg-ink text-paper',
};

function Chip({ label, cls }: { label: string; cls: string }) {
  return <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs whitespace-nowrap ${cls}`}>{label}</span>;
}

const secondaryLink = 'inline-flex items-center gap-2 h-10 px-4 rounded-control border border-rule bg-paper text-ink text-sm font-semibold whitespace-nowrap transition-colors hover:bg-pill';

// ─── Admin payroll dashboard (Payroll/HR Admin only) ──────────────────────────
// All state, data-loading and side-effecting handlers live in usePayrollAdmin;
// this component is presentation only.

function AdminPayrollDashboard() {
  const {
    isRunModalOpen, setIsRunModalOpen,
    isProcessing,
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
    periodConflictRuns, setPeriodConflictRuns,
    conflictPayslips, setConflictPayslips,
    conflictLoading,
    conflictSalaryMap, setConflictSalaryMap,
    variance,
    varianceLoading,
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
    sortedRuns,
    filteredEmployees,
    sortedPayslipRows,
    drcAlerts,
    toggleRunSort,
    toggleReviewSort,
    togglePayslipSort,
    savePeriodConfig,
    downloadPayslipPdf,
    downloadCpfFile,
    downloadGiro,
    openGiroModal,
    consolidateTarget,
    consolidateRuns,
    consolidateTotal,
    consolidateLoading,
    consolidateBusy,
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
  } = usePayrollAdmin();

  // Sort indicator: a chevron on the active column, flipped for ascending.
  const sortCaret = (active: boolean, dir: 'asc' | 'desc') =>
    active ? <Icon name="chevronDown" size={13} className={dir === 'asc' ? 'rotate-180' : ''} /> : null;

  // Honest KPIs derived from real run state (the old screen showed hardcoded
  // placeholder money figures that were never wired to any data).
  const pendingCount = runs.filter(r => r.status === 'PENDING_APPROVAL' || r.status === 'DRAFT').length;
  const finalisedMonthly = runs.filter(r => r.status === 'FINALISED' && r.runType === 'MONTHLY');
  const cpfQueue = finalisedMonthly.map(r => {
    const sub = cpfSubmissions.find(s => s.runId === r.id || s.period === r.period);
    const subStatus = sub?.status ?? null;
    const needsAction = !sub || subStatus === 'DRAFT';
    return { run: r, subStatus, needsAction };
  }).filter(x => x.needsAction);

  const runColumns: Column<PayrollRun>[] = [
    {
      key: 'period', label: (
        <button onClick={() => toggleRunSort('period')} className="inline-flex items-center gap-1 hover:text-ink">
          Period {sortCaret(runSort.col === 'period', runSort.dir)}
        </button>
      ), width: 'minmax(0, 1.3fr)', render: (run) => <span className="font-semibold text-ink">{fmtPeriod(run.period)}</span>,
    },
    {
      key: 'type', label: (
        <button onClick={() => toggleRunSort('type')} className="inline-flex items-center gap-1 hover:text-ink">
          Type {sortCaret(runSort.col === 'type', runSort.dir)}
        </button>
      ), width: 'minmax(0, 1fr)', render: (run) => <span className="text-ink">{run.runType}</span>,
    },
    {
      key: 'status', label: (
        <button onClick={() => toggleRunSort('status')} className="inline-flex items-center gap-1 hover:text-ink">
          Status {sortCaret(runSort.col === 'status', runSort.dir)}
        </button>
      ), width: '150px', render: (run) => <Chip label={fmtRunStatus(run.status)} cls={RUN_STATUS_TONE[run.status] ?? 'bg-pill text-muted'} />,
    },
    {
      key: 'actions', label: '', width: 'minmax(360px, 1.8fr)', align: 'right', render: (run) => {
        if (run.status === 'PENDING_APPROVAL' || run.status === 'APPROVED' || run.status === 'DRAFT') {
          return <Button variant="secondary" size="sm" onClick={() => setReviewRunData(run)}>Review</Button>;
        }
        if (run.status === 'REJECTED') {
          return <span className="text-[13px] text-muted">Locked for archive</span>;
        }
        // FINALISED (Disbursed). Label-only buttons on one line — icons crowded
        // the five actions into two rows at 1440.
        const canMerge = runs.filter(r => r.period === run.period && r.id !== run.id && r.status === 'FINALISED').length > 0;
        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => openGiroModal(run)}>GIRO</Button>
            <Button variant="ghost" size="sm" onClick={() => downloadCpfFile(run.id, run.period)}>CPF file</Button>
            <Button variant="ghost" size="sm" onClick={() => { setPayslipRunId(run.id); setPayslipRows([]); }}>Payslips</Button>
            {canMerge && <Button variant="ghost" size="sm" onClick={() => openConsolidate(run)}>Merge</Button>}
            <Button variant="danger" size="sm" onClick={() => { setConfirmCancelRun(false); setReviewRunData(run); }}>Void</Button>
          </div>
        );
      },
    },
  ];

  const inputCls = 'w-full h-[42px] px-3 rounded-control border border-rule bg-paper text-sm text-ink placeholder:text-muted outline-none transition-colors focus:border-accent';

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6">

      {/* Dependency Ratio Ceiling — MOM work-pass quota */}
      {drcLoaded && drcAlerts.length > 0 && (
        <Notice
          heading={drcAlerts.some(r => r.status === 'EXCEEDED')
            ? 'Dependency Ratio Ceiling exceeded'
            : 'Approaching the Dependency Ratio Ceiling'}
          seal={<Seal cite="EFMA · work-pass quota by sector" />}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {drcAlerts.map(r => (
                <span key={`${r.sector}-${r.passType}`} className="inline-flex items-center gap-2 text-sm text-ink">
                  {/* Exceeded is filled, warning outlined: the state that needs action
                      today is the heavier one. The old screen split these by red vs amber. */}
                  <Chip
                    label={r.status === 'EXCEEDED' ? 'Exceeded' : 'Warning'}
                    cls={r.status === 'EXCEEDED' ? 'bg-ink text-paper' : 'bg-paper text-ink border border-highlight'}
                  />
                  <span>{r.sector} — {r.passType.replace('_', ' ')}</span>
                  <span className="text-muted" aria-hidden>·</span>
                  <span className="tabular-nums">{r.currentRatioPct}% of {r.maxRatioPct}% ceiling</span>
                  {r.status === 'WARNING' && <span className="text-muted tabular-nums">({r.usagePct.toFixed(0)}% used)</span>}
                </span>
              ))}
            </div>
            <p className="text-[13px] text-muted">Review foreign-worker headcount at Settings → Statutory rates.</p>
          </div>
        </Notice>
      )}

      <PageHeader
        title="Payroll"
        subtitle="Run payroll, review the per-employee breakdown, authorise, then generate the GIRO and CPF e-Submit files."
        actions={
          <>
            <Link href="/payroll/iras-submissions" className={secondaryLink}>
              <Icon name="file" size={16} /> IRAS &amp; CPF submissions
            </Link>
            <Button icon="plus" onClick={() => setIsRunModalOpen(true)}>New payroll run</Button>
          </>
        }
      />

      {/* KPIs — real counts, not fabricated money */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Payroll runs" value={<span className="tabular-nums">{runs.length}</span>} note="Most recent 20" />
        <Stat label="Pending approval" value={<span className="tabular-nums">{pendingCount}</span>} note="Draft or awaiting authorisation" />
        <Stat label="Awaiting CPF submission" value={<span className="tabular-nums">{cpfQueue.length}</span>} note="Finalised runs not yet filed" />
      </div>

      {/* Statutory queue — finalised MONTHLY runs pending CPF e-Submit */}
      <Card>
        <CardHeader title="CPF submission queue" caption="Finalised monthly runs that still need a CPF e-Submit file generated or uploaded." />
        <div className="flex flex-col divide-y divide-rule">
          {cpfQueue.length === 0 ? (
            <p className="text-sm text-muted py-2">No pending CPF submissions.</p>
          ) : cpfQueue.slice(0, 5).map(({ run, subStatus }) => (
            <button
              key={run.id}
              onClick={() => setCpfActionRun({ runId: run.id, period: run.period, submissionStatus: subStatus })}
              className="flex items-center justify-between gap-3 py-3 text-left hover:text-accent"
            >
              <span className="text-sm text-ink">CPF submission — {fmtPeriod(run.period)}</span>
              <span className="inline-flex items-center gap-2">
                <Chip label={subStatus === 'DRAFT' ? 'Upload pending' : 'Action needed'} cls="bg-paper text-ink border border-highlight" />
                <Icon name="chevronRight" size={16} className="text-muted" />
              </span>
            </button>
          ))}
        </div>
      </Card>

      {/* Run history */}
      <div className="flex flex-col gap-3">
        <h2 className="text-[15.5px] font-bold text-ink">Payroll runs</h2>
        {runsLoading ? (
          <div className="py-16 text-center text-sm text-muted">Loading…</div>
        ) : (
          <DataTable<PayrollRun>
            aria-label="Payroll runs"
            columns={runColumns}
            rows={sortedRuns}
            rowKey={(run) => run.id}
            empty="No payroll runs yet. Start one with “New payroll run”."
            rowHeight={64}
            mobileCard={(run) => (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{fmtPeriod(run.period)}</span>
                  <Chip label={fmtRunStatus(run.status)} cls={RUN_STATUS_TONE[run.status] ?? 'bg-pill text-muted'} />
                </div>
                <span className="text-[13px] text-muted">{run.runType}</span>
                <div className="flex flex-wrap gap-1.5">
                  {(run.status === 'PENDING_APPROVAL' || run.status === 'APPROVED' || run.status === 'DRAFT') ? (
                    <Button variant="secondary" size="sm" onClick={() => setReviewRunData(run)}>Review</Button>
                  ) : run.status === 'REJECTED' ? (
                    <span className="text-[13px] text-muted">Locked for archive</span>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" icon="wallet" onClick={() => openGiroModal(run)}>GIRO</Button>
                      <Button variant="ghost" size="sm" icon="download" onClick={() => downloadCpfFile(run.id, run.period)}>CPF file</Button>
                      <Button variant="ghost" size="sm" icon="receipt" onClick={() => { setPayslipRunId(run.id); setPayslipRows([]); }}>Payslips</Button>
                      {runs.filter(r => r.period === run.period && r.id !== run.id && r.status === 'FINALISED').length > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => openConsolidate(run)}>Merge</Button>
                      )}
                      <Button variant="danger" size="sm" onClick={() => { setConfirmCancelRun(false); setReviewRunData(run); }}>Void</Button>
                    </>
                  )}
                </div>
              </div>
            )}
          />
        )}
      </div>

      {/* ── Initiation modal ─────────────────────────────────────────────── */}
      {isRunModalOpen && (
        <Modal
          open
          onClose={() => setIsRunModalOpen(false)}
          title="New payroll run"
          caption="Choose the period and run type, confirm the working-day basis, then compute."
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsRunModalOpen(false)}>Cancel</Button>
              <Button icon="check" disabled={isProcessing} onClick={handleExecute}>
                {isProcessing ? 'Checking…' : 'Compute payroll'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Field label="Accounting period (YYYY-MM)">
              <Input type="month" value={selectedPeriod} onChange={e => setSelectedPeriod(e.target.value)} />
            </Field>
            <Field label="Run type">
              <Select value={selectedRunType} onChange={e => setSelectedRunType(e.target.value)}>
                <option value="MONTHLY">Monthly payroll</option>
                <option value="ADHOC">Ad-hoc / supplemental</option>
                <option value="BONUS">Bonus</option>
                <option value="COMMISSION">Commission</option>
                <option value="FINAL_PAY">Final pay</option>
              </Select>
            </Field>
            <Field label="Workforce">
              <Select value={processingGroup} onChange={e => setProcessingGroup(e.target.value)}>
                <option value="all">All employees</option>
                <option value="full_time">Full-time</option>
                <option value="contractors">Contractors</option>
                <option value="management">Executive</option>
              </Select>
            </Field>

            {/* Period working-day config (MOM EA s.20) */}
            <div className="flex flex-col gap-3 pt-4 border-t border-rule">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[15.5px] font-bold text-ink">Working days — {fmtPeriod(selectedPeriod)}</span>
                  <span className="text-[13px] text-muted">Pro-ration basis for new joiners and leavers.</span>
                  <span className="mt-0.5"><Seal cite="EA s.20 · incomplete month" /></span>
                </div>
                {periodCfg && (
                  <Chip
                    label={periodCfg.isOverridden ? 'Overridden' : 'Auto (MOM)'}
                    cls={periodCfg.isOverridden ? 'bg-paper text-ink border border-highlight' : 'bg-tint text-accent'}
                  />
                )}
              </div>

              {periodCfgLoading ? (
                <div className="h-16 bg-page rounded-control" />
              ) : periodCfg ? (
                <div className="flex flex-col gap-3 bg-page rounded-control p-4">
                  <div className="flex gap-2">
                    {(['FIVE_DAY', 'SIX_DAY'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setPeriodCfgWorkDayType(t)}
                        className={`flex-1 h-9 px-3 rounded-control text-[13px] font-semibold border transition-colors ${periodCfgWorkDayType === t ? 'bg-accent text-on-accent border-accent' : 'bg-paper text-muted border-rule hover:bg-pill'}`}
                      >
                        {t === 'FIVE_DAY' ? '5-day (Mon–Fri)' : '6-day (Mon–Sat)'}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-end gap-4">
                    <div className="flex-1">
                      <p className="text-[12.5px] font-semibold text-muted mb-1">MOM recommended</p>
                      <p className="flex items-baseline gap-1">
                        <span className="text-2xl font-extrabold text-ink tabular-nums">{periodCfg.recommendedWorkingDays}</span>
                        <span className="text-[13px] text-muted">days</span>
                      </p>
                      {(periodCfg.publicHolidays?.length ?? 0) > 0 && (
                        <p className="text-[12.5px] text-muted mt-1">
                          {periodCfg.publicHolidays.length} public holiday{periodCfg.publicHolidays.length !== 1 ? 's' : ''} deducted
                          {' ('}{periodCfg.publicHolidays.map(h => h.name).join(', ')}{')'}
                        </p>
                      )}
                    </div>
                    <Field label="Override" className="w-28">
                      <Input
                        type="number" min="1" max="31"
                        value={periodCfgOverride}
                        onChange={e => setPeriodCfgOverride(e.target.value)}
                        placeholder={String(periodCfg.recommendedWorkingDays)}
                      />
                    </Field>
                  </div>
                  <Button variant="secondary" size="sm" className="self-end" disabled={periodCfgSaving} onClick={savePeriodConfig}>
                    {periodCfgSaving ? 'Saving…' : 'Save config'}
                  </Button>
                </div>
              ) : (
                <div className="bg-page rounded-control p-4 text-sm text-muted text-center">Could not load period config.</div>
              )}
            </div>

            {/* Statutory toggles */}
            <div className="flex flex-col gap-3 pt-4 border-t border-rule">
              <label className="flex items-start gap-3">
                <input type="checkbox" defaultChecked className="mt-0.5 w-4 h-4 accent-accent" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-ink">Apply Central Provident Fund (CPF)</span>
                  <span className="text-[13px] text-muted">Age-band contribution rates, Jan 2026 table.</span>
                  <span className="mt-0.5"><Seal cite="CPF Act s.7 · Jan 2026 table" /></span>
                </span>
              </label>
              <label className="flex items-start gap-3">
                <input type="checkbox" defaultChecked className="mt-0.5 w-4 h-4 accent-accent" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-ink">Apply Skills Development Levy (SDL)</span>
                  {/* The cap is a statutory figure, not a house setting —
                      0.25% of the first 4,500 of monthly remuneration, cap S$11.25. */}
                  <span className="text-[13px] text-muted">0.25% of wages, capped at S$11.25/employee.</span>
                  <span className="mt-0.5"><Seal cite="SDL Act · 0.25%, cap 4,500" /></span>
                </span>
              </label>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Period conflict — supplemental run confirmation ──────────────── */}
      {periodConflictRuns.length > 0 && (() => {
        const blockedEmps = conflictPayslips.filter((emp: any) => {
          const hasZero = emp.runs.some((r: any) => (r.netPay ?? 0) === 0);
          const currentOw = conflictSalaryMap[emp.employeeId];
          return hasZero && currentOw !== undefined && currentOw === 0;
        });
        const conflictingRun = periodConflictRuns.find(r => r.runType === selectedRunType && r.status === 'FINALISED');
        return (
          <Modal
            open
            size="lg"
            onClose={() => { setPeriodConflictRuns([]); setConflictPayslips([]); setConflictSalaryMap({}); }}
            title={`Supplemental run — ${fmtPeriod(selectedPeriod)}`}
            caption={`${periodConflictRuns.length} existing run${periodConflictRuns.length !== 1 ? 's' : ''} found for this period. Review before proceeding.`}
            footer={
              <>
                <Button variant="secondary" onClick={() => { setPeriodConflictRuns([]); setConflictPayslips([]); setConflictSalaryMap({}); }}>Cancel</Button>
                {conflictingRun ? (
                  <Button variant="danger" disabled={isProcessing} onClick={() => voidAndReplace(conflictingRun)}>
                    {isProcessing ? 'Processing…' : `Void & replace — ${selectedRunType}`}
                  </Button>
                ) : (
                  <Button disabled={isProcessing} onClick={actuallyCreateRun}>
                    {isProcessing ? 'Creating…' : 'Create supplemental run'}
                  </Button>
                )}
              </>
            }
          >
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-[12.5px] font-semibold text-muted mb-2">Existing runs for this period</p>
                <div className="flex flex-wrap gap-2">
                  {periodConflictRuns.map(r => (
                    <span key={r.id} className="inline-flex items-center gap-2 rounded-control border border-rule bg-page px-3 h-8 text-[13px]">
                      <span className="font-semibold text-ink">{r.runType}</span>
                      <Chip label={fmtRunStatus(r.status)} cls={RUN_STATUS_TONE[r.status] ?? 'bg-pill text-muted'} />
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-2 rounded-control border border-accent bg-tint px-3 h-8 text-[13px]">
                    <span className="font-semibold text-accent">New: {selectedRunType}</span>
                    <Chip label="Draft" cls="bg-pill text-muted" />
                  </span>
                </div>
              </div>

              <p className="text-[13px] text-muted">
                The supplemental run re-fetches each employee&apos;s current salary from their profile — salary changes since the prior run are picked up automatically.
              </p>

              {conflictLoading ? (
                <div className="py-8 text-center text-sm text-muted">Loading employee payslip data…</div>
              ) : conflictPayslips.length === 0 ? (
                <p className="text-sm text-muted py-4">No computed payslips yet for this period — the new run will be the first.</p>
              ) : (
                <div className="border border-rule rounded-card overflow-hidden">
                  <div className="overflow-x-auto">
                    <div className="min-w-[560px]">
                      <div className="grid gap-3 px-4 h-[42px] items-center bg-pill border-b border-rule text-xs font-bold text-muted"
                        style={{ gridTemplateColumns: `minmax(0,1.4fr) repeat(${periodConflictRuns.length}, minmax(0,1fr)) minmax(0,1fr) minmax(0,1.4fr)` }}>
                        <div>Employee</div>
                        {periodConflictRuns.map(r => <div key={r.id} className="text-right">{r.runType} net</div>)}
                        <div className="text-right">Total net</div>
                        <div className="text-right">Supplemental note</div>
                      </div>
                      {conflictPayslips.map((emp: any) => {
                        const totalNet = emp.runs.reduce((s: number, r: any) => s + (r.netPay ?? 0), 0);
                        const hasZero = emp.runs.some((r: any) => (r.netPay ?? 0) === 0);
                        const currentOw = conflictSalaryMap[emp.employeeId] ?? null;
                        const salaryMissing = hasZero && currentOw === 0;
                        return (
                          <div key={emp.employeeId} className="grid gap-3 px-4 py-3 items-center border-b border-rule text-[13px]"
                            style={{ gridTemplateColumns: `minmax(0,1.4fr) repeat(${periodConflictRuns.length}, minmax(0,1fr)) minmax(0,1fr) minmax(0,1.4fr)` }}>
                            <div className="font-semibold text-ink truncate">{emp.name}</div>
                            {periodConflictRuns.map(r => {
                              const ps = emp.runs.find((x: any) => x.runId === r.id);
                              return <div key={r.id} className="text-right tabular-nums text-muted">{ps ? sgd(ps.netPay ?? 0) : '—'}</div>;
                            })}
                            <div className="text-right tabular-nums font-semibold text-ink">{sgd(totalNet)}</div>
                            <div className="text-right text-muted">
                              {hasZero
                                ? (salaryMissing
                                    ? <span className="text-ink">No salary in profile — update the employee record first</span>
                                    : <span className="text-accent tabular-nums">Profile salary {sgd(currentOw ?? 0)} — pro-rated by start date</span>)
                                : <span>Adds delta only</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {conflictingRun && (
                <Notice heading={`A ${conflictingRun.runType} run for ${fmtPeriod(selectedPeriod)} is already disbursed`}>
                  <p className="text-sm text-ink">
                    You cannot create another {selectedRunType} run until the existing one is voided. Use “Void &amp; replace” to delete the old run and create a corrected one, or choose a different run type.
                  </p>
                </Notice>
              )}
              {blockedEmps.length > 0 && (
                <Notice heading={`${blockedEmps.length} employee${blockedEmps.length !== 1 ? 's have' : ' has'} no salary configured`}>
                  <p className="text-sm text-ink">
                    <span className="font-semibold">{blockedEmps.map((e: any) => e.name).join(', ')}</span>. Set a basic salary on each employee profile before running payroll.
                  </p>
                </Notice>
              )}
              <p className="text-[13px] text-muted">
                On finalisation, all runs for <span className="font-semibold text-ink">{fmtPeriod(selectedPeriod)}</span> are consolidated — employees see one payslip per month.
              </p>
            </div>
          </Modal>
        );
      })()}

      {/* ── Review run modal ─────────────────────────────────────────────── */}
      {reviewRunData && (
        <Modal
          open
          size="lg"
          onClose={() => { setReviewRunData(null); setConfirmCancelRun(false); }}
          title="Review payroll run"
          caption={`${reviewRunData.runType} · ${fmtPeriod(reviewRunData.period)}`}
          footer={
            <div className="flex flex-1 flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => { setReviewRunData(null); setConfirmCancelRun(false); }}>Close</Button>
                {!confirmCancelRun ? (
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (reviewRunData?.status === 'FINALISED') { setConfirmCancelRun(true); }
                      else { cancelRun(reviewRunData.id, reviewRunData.period); }
                    }}
                  >
                    Cancel run
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="text-[13px] text-ink">Void all published payslips?</span>
                    <Button variant="danger" size="sm" onClick={() => voidRun(reviewRunData.id, reviewRunData.period)}>Void</Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirmCancelRun(false)}>Back</Button>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {reviewRunData?.status === 'PENDING_APPROVAL' && paycodesDirty && (
                  <Button variant="secondary" onClick={() => recomputeRun(reviewRunData.id)}>Recompute</Button>
                )}
                {reviewRunData?.status !== 'FINALISED' && !(reviewRunData?.status === 'PENDING_APPROVAL' && paycodesDirty) && (
                  <Button onClick={() => advanceRun(reviewRunData.id, reviewRunData.status)}>
                    {reviewRunData?.status === 'APPROVED' ? 'Finalise & publish' : reviewRunData?.status === 'PENDING_APPROVAL' ? 'Authorise disbursement' : 'Compute payroll'}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-3">
              <Card padding="px-4 py-3">
                <div className="text-[12.5px] font-semibold text-muted">Run type</div>
                <div className="text-lg font-bold text-ink mt-0.5">{reviewRunData.runType}</div>
              </Card>
              <Card padding="px-4 py-3">
                <div className="text-[12.5px] font-semibold text-muted">Status</div>
                <div className="mt-1.5"><Chip label={fmtRunStatus(reviewRunData.status)} cls={RUN_STATUS_TONE[reviewRunData.status] ?? 'bg-pill text-muted'} /></div>
              </Card>
              <Card padding="px-4 py-3">
                <div className="text-[12.5px] font-semibold text-muted">Initiated</div>
                <div className="text-sm font-bold text-ink mt-0.5 tabular-nums">{new Date(reviewRunData.createdAt).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </Card>
            </div>

            {/* Step hint */}
            {reviewRunData?.status === 'DRAFT' && (
              <p className="text-[13px] text-muted">Step 1 of 3 · Compute payroll to see the per-employee breakdown.</p>
            )}
            {reviewRunData?.status === 'PENDING_APPROVAL' && paycodesDirty && (
              <p className="text-[13px] text-ink">Paycodes changed — recompute to apply before authorising.</p>
            )}
            {reviewRunData?.status === 'PENDING_APPROVAL' && !paycodesDirty && (
              <p className="text-[13px] text-accent">Step 2 of 3 · Awaiting authorisation.</p>
            )}

            {/* Variance — other finalised runs for the same period */}
            {varianceLoading && <p className="text-[13px] text-muted">Checking for period conflicts…</p>}
            {!varianceLoading && variance?.hasConflicts && (
              <div className="border border-rule rounded-card overflow-hidden">
                <div className="px-4 py-3 bg-page border-b border-rule">
                  <p className="text-sm font-semibold text-ink">
                    Period conflict — {variance.otherRunCount} other run{variance.otherRunCount !== 1 ? 's' : ''} for {fmtPeriod(variance.period)} already finalised
                  </p>
                  <p className="text-[13px] text-muted">On finalisation these are consolidated into one payslip per employee.</p>
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[520px]">
                    <div className="grid gap-3 px-4 h-[42px] items-center bg-pill border-b border-rule text-xs font-bold text-muted" style={{ gridTemplateColumns: 'minmax(0,1.4fr) repeat(3, minmax(0,1fr))' }}>
                      <div>Employee</div><div className="text-right">Existing net</div><div className="text-right">This run adds</div><div className="text-right">Combined net</div>
                    </div>
                    {variance.rows.filter((r: any) => r.hasExisting).map((r: any, i: number) => (
                      <div key={i} className="grid gap-3 px-4 py-2.5 items-center border-b border-rule text-[13px]" style={{ gridTemplateColumns: 'minmax(0,1.4fr) repeat(3, minmax(0,1fr))' }}>
                        <div className="font-semibold text-ink truncate">{empNameMap.get(r.employeeId) ?? r.employeeId.slice(0, 8)}</div>
                        <div className="text-right tabular-nums text-muted">{sgd(r.existingNet)}</div>
                        <div className="text-right tabular-nums text-ink">+ {sgd(r.delta)}</div>
                        <div className="text-right tabular-nums font-semibold text-accent">{sgd(r.combinedNet)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Employee breakdown matrix */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h3 className="text-[15.5px] font-bold text-ink">Employee breakdown</h3>
                <div className="sm:w-64">
                  <Input type="text" placeholder="Search employee…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
              </div>
              <div className="border border-rule rounded-card overflow-hidden">
                <div className="max-h-80 overflow-y-auto">
                  <div className="overflow-x-auto">
                    <div className="min-w-[640px]">
                      <div className="grid gap-3 px-4 h-[42px] items-center bg-pill border-b border-rule text-xs font-bold text-muted sticky top-0 z-10" style={{ gridTemplateColumns: 'minmax(0,1.6fr) repeat(4, minmax(0,1fr))' }}>
                        {([
                          { col: 'name', label: 'Employee', align: '' },
                          { col: 'gross', label: 'Gross', align: 'justify-end' },
                          { col: 'selfCpf', label: 'Self CPF', align: 'justify-end' },
                          { col: 'firmCpf', label: 'Firm CPF', align: 'justify-end' },
                          { col: 'net', label: 'Net', align: 'justify-end' },
                        ] as const).map(h => (
                          <button key={h.col} onClick={() => toggleReviewSort(h.col)} className={`inline-flex items-center gap-1 hover:text-ink ${h.align}`}>
                            {h.label} {sortCaret(reviewSort.col === h.col, reviewSort.dir)}
                          </button>
                        ))}
                      </div>
                      {filteredEmployees.length === 0 && reviewPayslips.length === 0 ? (
                        <p className="px-4 py-8 text-center text-sm text-muted">
                          {reviewRunData?.status === 'DRAFT' ? 'Compute payroll first to see the employee breakdown.' : 'No payslips found for this run.'}
                        </p>
                      ) : filteredEmployees.map((ps, i) => {
                        const name = empNameMap.get(ps.employeeId) ?? ps.employeeId;
                        const empCodes = runPaycodes[ps.employeeId] || [];
                        const canEdit = reviewRunData?.status === 'PENDING_APPROVAL';
                        const isAddingHere = addingPaycodeFor === ps.employeeId;
                        return (
                          <div key={i} className="border-b border-rule">
                            <div className="grid gap-3 px-4 py-3 items-center text-[13px]" style={{ gridTemplateColumns: 'minmax(0,1.6fr) repeat(4, minmax(0,1fr))' }}>
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <span className="font-semibold text-ink truncate">{name}</span>
                                <span className="text-[12.5px] text-muted tabular-nums">{ps.employeeId.slice(0, 8)}</span>
                                {canEdit && (
                                  <button
                                    onClick={() => { setAddingPaycodeFor(isAddingHere ? null : ps.employeeId); setNewPcAmount(''); setNewPcDesc(''); if (payComponents.length > 0 && !newPcComponentId) setNewPcComponentId(payComponents[0].id); }}
                                    className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent hover:opacity-80 self-start mt-0.5"
                                  >
                                    <Icon name="plus" size={13} /> Add paycode
                                  </button>
                                )}
                              </div>
                              <div className="text-right tabular-nums text-ink">{sgd(ps.grossPay)}</div>
                              <div className="text-right tabular-nums text-ink">-{sgd(ps.employeeCpf)}</div>
                              <div className="text-right tabular-nums text-muted">{sgd(ps.employerCpf)}</div>
                              <div className="text-right tabular-nums font-semibold text-accent">{sgd(ps.netPay)}</div>
                            </div>
                            {(empCodes.length > 0 || isAddingHere) && (
                              <div className="px-4 pb-3 flex flex-col gap-2">
                                {empCodes.map((pc: any) => (
                                  <div key={pc.id} className="flex items-center justify-between gap-3 bg-page rounded-control px-3 py-2">
                                    <span className="text-[13px] font-semibold text-ink truncate">{pc.description}</span>
                                    <span className="flex items-center gap-3 shrink-0">
                                      <span className={`text-[13px] font-semibold tabular-nums ${pc.amount >= 0 ? 'text-accent' : 'text-ink'}`}>{pc.amount >= 0 ? '+' : '-'}{sgd(Math.abs(pc.amount))}</span>
                                      <span className="text-[12.5px] text-muted">{pc.wageType}</span>
                                      {canEdit && (
                                        <button onClick={() => deletePaycode(ps.employeeId, pc.id)} aria-label="Remove paycode" className="text-muted hover:text-ink">
                                          <Icon name="x" size={15} />
                                        </button>
                                      )}
                                    </span>
                                  </div>
                                ))}
                                {isAddingHere && (
                                  <div className="flex flex-wrap items-center gap-2 bg-page rounded-control px-3 py-2.5">
                                    <select value={newPcComponentId} onChange={e => setNewPcComponentId(e.target.value)} className={`${inputCls} flex-1 min-w-[160px]`}>
                                      {payComponents.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <input type="number" placeholder="Amount (neg = deduction)" value={newPcAmount} onChange={e => setNewPcAmount(e.target.value)} className={`${inputCls} w-48`} />
                                    <Button size="sm" onClick={() => addPaycode(ps)}>Add</Button>
                                    <Button variant="secondary" size="sm" onClick={() => setAddingPaycodeFor(null)}>Cancel</Button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* ── CPF e-Submit action modal ────────────────────────────────────── */}
      {cpfActionRun && (
        <Modal
          open
          onClose={() => setCpfActionRun(null)}
          title="CPF e-Submit"
          caption={fmtPeriod(cpfActionRun.period)}
        >
          <div className="flex flex-col gap-4">
            <Chip
              label={cpfActionRun.submissionStatus === 'DRAFT' ? 'File generated — awaiting upload to CPF EZPay' : 'No file generated yet'}
              cls={cpfActionRun.submissionStatus === 'DRAFT' ? 'bg-paper text-ink border border-highlight' : 'bg-pill text-muted'}
            />
            <button
              disabled={cpfDownloading}
              onClick={() => downloadCpfFile(cpfActionRun.runId, cpfActionRun.period, () => {
                setCpfActionRun(prev => prev ? { ...prev, submissionStatus: 'DRAFT' } : null);
              })}
              className="flex items-center gap-3 rounded-control bg-accent text-on-accent px-4 py-3 text-left transition-opacity hover:opacity-95 disabled:opacity-50"
            >
              <Icon name="download" size={18} />
              <span className="flex flex-col">
                <span className="text-sm font-semibold">{cpfDownloading ? 'Generating…' : 'Download CPF e-Submit file'}</span>
                <span className="text-[13px] opacity-90">Upload via the CPF EZPay portal after download.</span>
              </span>
            </button>
            <div className="flex items-center gap-3 rounded-control border border-rule bg-page px-4 py-3 opacity-70">
              <Icon name="upload" size={18} className="text-muted" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-muted">FTP direct upload</span>
                <span className="text-[13px] text-muted">Coming soon — configure SFTP credentials in Settings.</span>
              </span>
              <Chip label="Soon" cls="bg-pill text-muted" />
            </div>
            <Link href="/payroll/iras-submissions" onClick={() => setCpfActionRun(null)} className="inline-flex items-center justify-center gap-2 h-10 rounded-control border border-rule text-sm font-semibold text-ink hover:bg-pill">
              View IRAS submissions ledger <Icon name="arrowRight" size={16} />
            </Link>
          </div>
        </Modal>
      )}

      {/* ── GIRO generation modal ────────────────────────────────────────── */}
      {giroRunId && (() => {
        const run = runs.find(r => r.id === giroRunId);
        const banks = [
          { id: 'uob' as const, label: 'UOB', sub: 'Infinity · 615-char' },
          { id: 'ocbc' as const, label: 'OCBC', sub: 'GIRO/FAST · 1000-char' },
          { id: 'dbs' as const, label: 'DBS', sub: 'IDEAL · 200-char' },
        ];
        return (
          <Modal
            open
            onClose={() => setGiroRunId(null)}
            title="Generate GIRO file"
            caption={`${run ? fmtPeriod(run.period) : ''} · your company's bank details`}
            footer={
              <>
                <Button variant="secondary" onClick={() => setGiroRunId(null)}>Cancel</Button>
                <Button icon="download" disabled={giroDownloading || !giroFields.acct} onClick={downloadGiro}>
                  {giroDownloading ? 'Generating…' : `Generate ${giroBank.toUpperCase()} file`}
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12.5px] font-semibold text-muted">Company&apos;s bank</span>
                <div className="grid grid-cols-3 gap-2">
                  {banks.map(b => (
                    <button
                      key={b.id}
                      onClick={() => setGiroBank(b.id)}
                      className={`flex flex-col items-center gap-1 py-3 px-2 rounded-control border-2 transition-colors ${giroBank === b.id ? 'border-accent bg-tint' : 'border-rule bg-paper hover:bg-pill'}`}
                    >
                      <span className={`text-sm font-bold ${giroBank === b.id ? 'text-accent' : 'text-ink'}`}>{b.label}</span>
                      <span className="text-[12.5px] text-muted text-center leading-tight">{b.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Field
                label={giroBank === 'uob' ? 'UOB account no (10-digit)' : giroBank === 'ocbc' ? 'OCBC account no (no dashes)' : 'DBS account no'}
                required
                help={giroBank === 'uob' ? 'Your 10-digit UOB account (debit source).' : giroBank === 'ocbc' ? 'Your OCBC current account, digits only.' : 'Your DBS IDEAL account number.'}
              >
                <Input
                  type="text"
                  value={giroFields.acct}
                  onChange={e => gf('acct', e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder={giroBank === 'uob' ? '1234567890' : giroBank === 'ocbc' ? '501234567001' : '0729123456789'}
                  maxLength={giroBank === 'uob' ? 10 : 34}
                />
              </Field>

              {giroBank === 'uob' && (
                <Field label="Account / company name" required help="Printed on the UOB statement · max 35 chars.">
                  <Input type="text" value={giroFields.companyName} onChange={e => gf('companyName', e.target.value.toUpperCase())} placeholder="ACME PTE LTD" maxLength={35} />
                </Field>
              )}

              <Field label="Value date" required help="Date funds are credited to employees.">
                <Input type="date" value={giroFields.valueDate} onChange={e => gf('valueDate', e.target.value)} />
              </Field>

              <Field label="Payment description" help="Shown on the employee's bank statement · max 35 chars.">
                <Input type="text" value={giroFields.payDesc} onChange={e => gf('payDesc', e.target.value.toUpperCase())} placeholder={`SALARY ${run?.period ?? ''}`} maxLength={35} />
              </Field>

              <div className={`grid gap-3 ${giroBank === 'ocbc' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <Field
                  label={
                    <span className="flex items-center justify-between gap-2">
                      <span>{giroBank === 'uob' ? 'Bulk customer reference' : 'Your reference no'}</span>
                      <button type="button" onClick={() => gf('ref', generateGiroRef(run?.period ?? ''))} className="text-[12.5px] font-semibold text-accent hover:opacity-80">Regenerate</button>
                    </span>
                  }
                  help="Auto-generated, unique per period · editable · max 16 chars."
                >
                  <Input type="text" value={giroFields.ref} onChange={e => gf('ref', e.target.value.toUpperCase())} placeholder={`PAYROLL${run?.period?.replace('-', '') ?? ''}`} maxLength={16} />
                </Field>
                {giroBank === 'ocbc' && (
                  <Field label="Batch number" help="3-digit batch identifier.">
                    <Input type="text" value={giroFields.batchNo} onChange={e => gf('batchNo', e.target.value.replace(/[^0-9]/g, '').padStart(0, '').slice(0, 3))} placeholder="001" maxLength={3} />
                  </Field>
                )}
              </div>

              <p className="text-[13px] text-muted rounded-control bg-page px-4 py-3">
                {giroBank === 'dbs'
                  ? 'DBS format follows the IDEAL payroll spec — verify against your DBS IDEAL format document before uploading.'
                  : `${giroBank.toUpperCase()} format generated to spec — upload via ${giroBank === 'uob' ? 'UOB Infinity' : 'OCBC Velocity'}.`}
              </p>
            </div>
          </Modal>
        );
      })()}

      {/* ── Payslip overlay ──────────────────────────────────────────────── */}
      {payslipRunId && (
        <Modal
          open
          size="lg"
          onClose={() => setPayslipRunId(null)}
          title="Payslips"
          caption={`${payslipRunPeriod ? fmtPeriod(payslipRunPeriod) : 'Loading…'} · ${payslipRows.length} records`}
          footer={
            <div className="flex flex-1 items-center justify-between gap-3">
              <span className="text-[13px] text-muted tabular-nums">
                {payslipRows.filter(p => p.isPublished).length} published · {payslipRows.filter(p => !p.isPublished).length} pending
              </span>
              <Button icon="download" disabled={payslipRows.filter(p => p.isPublished).length === 0} onClick={bulkDownloadPayslips}>Download all PDFs</Button>
            </div>
          }
        >
          {payslipLoading ? (
            <div className="py-16 text-center text-sm text-muted">Loading payslips…</div>
          ) : payslipRows.length === 0 ? (
            <EmptyState icon="receipt" title="No payslips for this run" description="The run must be finalised for payslips to be visible." />
          ) : (
            <div className="border border-rule rounded-card overflow-hidden">
              <div className="overflow-x-auto">
                <div className="min-w-[520px]">
                  <div className="grid gap-3 px-4 h-[42px] items-center bg-pill border-b border-rule text-xs font-bold text-muted" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) 120px' }}>
                    {([
                      { col: 'name', label: 'Employee', align: '' },
                      { col: 'gross', label: 'Gross', align: 'justify-end' },
                      { col: 'net', label: 'Net pay', align: 'justify-end' },
                    ] as const).map(h => (
                      <button key={h.col} onClick={() => togglePayslipSort(h.col)} className={`inline-flex items-center gap-1 hover:text-ink ${h.align}`}>
                        {h.label} {sortCaret(payslipSort.col === h.col, payslipSort.dir)}
                      </button>
                    ))}
                    <div className="text-right">PDF</div>
                  </div>
                  {sortedPayslipRows.map((ps, i) => {
                    const name = empNameMap.get(ps.employeeId) ?? `Employee ${ps.employeeId.slice(0, 8)}`;
                    return (
                      <div key={i} className="grid gap-3 px-4 py-2.5 items-center border-b border-rule text-[13px]" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) 120px' }}>
                        <span className="font-semibold text-ink truncate">{name}</span>
                        <span className="text-right tabular-nums text-muted">{sgd(ps.grossPay)}</span>
                        <span className="text-right tabular-nums font-semibold text-accent">{sgd(ps.netPay)}</span>
                        <span className="text-right">
                          <Button variant="ghost" size="sm" disabled={!ps.isPublished} onClick={() => downloadPayslipPdf(ps.employeeId, ps.period, name)}>
                            {ps.isPublished ? 'Download' : 'Not published'}
                          </Button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── Consolidate (Merge) confirmation ─────────────────────────────── */}
      {consolidateTarget && (
        <Modal
          open
          onClose={cancelConsolidate}
          title="Consolidate payroll runs"
          caption={fmtPeriod(consolidateTarget.period)}
          footer={
            <>
              <Button variant="secondary" onClick={cancelConsolidate}>Cancel</Button>
              <Button disabled={consolidateBusy} onClick={confirmConsolidate}>
                {consolidateBusy ? 'Consolidating…' : 'Consolidate runs'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              These {consolidateRuns.length} runs for <span className="font-semibold text-ink">{fmtPeriod(consolidateTarget.period)}</span> will be merged into one payslip per employee. This cannot be undone.
            </p>
            <div className="border border-rule rounded-card overflow-hidden">
              {consolidateRuns.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-rule last:border-0 text-sm">
                  <span className="font-semibold text-ink">{r.runType}</span>
                  <Chip label={fmtRunStatus(r.status)} cls={RUN_STATUS_TONE[r.status] ?? 'bg-pill text-muted'} />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-control bg-page px-4 py-3">
              <span className="text-[13px] text-muted">Combined net across these runs</span>
              <span className="text-sm font-semibold text-ink tabular-nums">{consolidateLoading ? 'Calculating…' : sgd(consolidateTotal ?? 0)}</span>
            </div>
          </div>
        </Modal>
      )}

      {/* Action / download toast */}
      {(actionToast || dlProgress) && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] max-w-[92vw]">
          <div className="flex items-center gap-3 rounded-card border border-rule bg-ink text-paper px-5 py-3 shadow-card">
            {dlProgress && <Icon name="download" size={16} />}
            <span className="text-sm">{dlProgress ?? actionToast}</span>
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
    return <div className="py-16 text-center text-sm text-muted">Loading…</div>;
  }

  const role = user?.role?.toUpperCase() ?? '';
  const isPrivileged = role === 'SUPER_ADMIN' || role === 'HR_ADMIN' || role === 'PAYROLL_OFFICER' || role === 'HR_MANAGER' || role === 'FINANCE_ADMIN';

  if (!isPrivileged) return <EmployeePayslipsView />;
  return <AdminPayrollDashboard />;
}
