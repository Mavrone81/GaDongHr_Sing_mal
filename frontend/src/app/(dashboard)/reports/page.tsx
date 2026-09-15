'use client';

import { Fragment, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch, apiFetchRaw } from '@/lib/api';
import {
  PageHeader, Card, CardHeader, Badge, Button, Stat, Tabs, Modal, Field, Input, Select, Stepper,
  DataTable, EmptyState, Icon, useToast,
} from '@/components/ui';
import type { BadgeTone, Column, IconName } from '@/components/ui';

// ── CSV utility ───────────────────────────────────────────────────────────────
function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/** Money as the old modals showed it: "$1,234.00", or an em dash for no value. */
const money = (v: number | null | undefined) => v == null ? '—' : `$${Number(v).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** WORKFORCE → "Workforce"; FULL_TIME → "Full time". */
const sentence = (raw: string) => {
  const s = String(raw || '').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Shared table styling for the report previews inside dialogs (wide, numeric).
const TH = 'px-3 py-2.5 text-xs font-bold text-muted whitespace-nowrap bg-pill';
const TD = 'px-3 py-2.5 text-[13px] text-ink whitespace-nowrap';
const TD_NUM = `${TD} text-right tabular-nums`;

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="w-7 h-7 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label={label} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3.5 py-2.5 rounded-control bg-page border border-rule min-w-[120px]">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-bold text-ink tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

// ── Run selector modal (for payroll-linked reports) ───────────────────────────
/** Payroll run states the selector shows: finalised is settled, approved is on its way, anything else is still open. */
const RUN_STATUS_TONE: Record<string, BadgeTone> = {
  FINALISED: 'ok',
  APPROVED:  'accent',
};

function RunSelectorModal({ title, onSelect, onClose }: { title: string; onSelect: (runId: string, period: string) => void; onClose: () => void }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch('/payroll/runs?limit=20')
      .then(d => setRuns(d.runs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return (
    <Modal open onClose={onClose} title={title} caption="Choose the payroll run to report on.">
      <div className="flex flex-col gap-2">
        {loading ? (
          [1,2,3].map(i => <div key={i} className="h-14 rounded-control bg-pill animate-pulse" />)
        ) : runs.length === 0 ? (
          <EmptyState icon="wallet" title="No payroll runs yet" description="Run payroll first; its runs will appear here." className="py-8" />
        ) : runs.map(r => (
          <button key={r.id} type="button" onClick={() => onSelect(r.id, r.period)}
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-control border border-rule bg-paper hover:border-accent hover:bg-page transition-colors text-left">
            <span className="min-w-0">
              <span className="text-sm font-semibold text-ink tabular-nums">{r.period}</span>
              <span className="ml-2.5 text-[13px] text-muted">{sentence(r.runType || '')}</span>
            </span>
            <Badge tone={RUN_STATUS_TONE[r.status] ?? 'warn'}>{sentence(r.status || '')}</Badge>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ── Report runners ────────────────────────────────────────────────────────────
async function runWorkforceReport() {
  const data = await apiFetch('/employees?limit=500');
  const emps = data.employees ?? data ?? [];
  downloadCsv(`workforce-headcount-${new Date().toISOString().slice(0,10)}.csv`,
    ['Employee Code', 'Full Name', 'Department', 'Designation', 'Employment Type', 'Nationality', 'Start Date', 'Status'],
    emps.map((e: any) => [e.employeeCode, e.fullName, e.department, e.designation, e.employmentType, e.nationality, e.startDate?.slice(0,10), e.isActive ? 'Active' : 'Inactive'])
  );
}

async function runAttritionReport() {
  const data = await apiFetch('/employees?limit=500');
  const emps = data.employees ?? data ?? [];
  const now = new Date();
  const rows = emps.map((e: any) => {
    const start = new Date(e.startDate);
    const tenure = ((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
    return [e.employeeCode, e.fullName, e.department, e.employmentType, e.startDate?.slice(0,10), e.endDate?.slice(0,10) ?? '—', `${tenure} yrs`, e.isActive ? 'Active' : 'Terminated'];
  });
  downloadCsv(`attrition-analytics-${new Date().toISOString().slice(0,10)}.csv`,
    ['Employee Code', 'Full Name', 'Department', 'Employment Type', 'Start Date', 'End Date', 'Tenure', 'Status'],
    rows
  );
}

async function runMomReport() {
  const data = await apiFetch('/employees?limit=500');
  const emps = data.employees ?? data ?? [];
  downloadCsv(`mom-headcount-${new Date().toISOString().slice(0,10)}.csv`,
    ['Employee Code', 'Full Name', 'Nationality', 'Citizenship Status', 'Pass Type', 'Department', 'Employment Type', 'Gender', 'Start Date'],
    emps.map((e: any) => [e.employeeCode, e.fullName, e.nationality, e.citizenshipStatus ?? '—', e.passType ?? '—', e.department, e.employmentType, e.gender ?? '—', e.startDate?.slice(0,10)])
  );
}

async function runLeaveLiabilityReport() { /* replaced by LeaveLiabilityModal */ }

async function runPayrollVarianceReport() {
  const data = await apiFetch('/payroll/runs?limit=2&status=FINALISED');
  const runs = data.runs ?? [];
  if (runs.length < 2) throw new Error('Need at least 2 finalised payroll runs to compare');
  const [r1, r2] = await Promise.all([
    apiFetch(`/payroll/runs/${runs[0].id}/payslips`),
    apiFetch(`/payroll/runs/${runs[1].id}/payslips`),
  ]);
  const ps1Map: Record<string, any> = {};
  for (const p of (r1.payslips ?? r1 ?? [])) ps1Map[p.employeeId] = p;
  const rows: any[][] = [];
  for (const p of (r2.payslips ?? r2 ?? [])) {
    const prev = ps1Map[p.employeeId];
    const diff = prev ? (Number(p.netPay ?? 0) - Number(prev.netPay ?? 0)).toFixed(2) : '—';
    rows.push([p.employeeId, runs[1].period, p.grossPay ?? '—', p.netPay ?? '—', runs[0].period, prev?.netPay ?? '—', diff]);
  }
  downloadCsv(`payroll-variance-${runs[1].period}-vs-${runs[0].period}.csv`,
    ['Employee ID', 'Current Period', 'Gross Pay', 'Net Pay', 'Prior Period', 'Prior Net Pay', 'Variance'],
    rows
  );
}

// IR8A now handled by Ir8aModal

async function runCpfReportDirect() {
  const data = await apiFetch('/payroll/runs?limit=1&status=FINALISED');
  const runs = data.runs ?? [];
  if (runs.length === 0) throw new Error('No finalised payroll runs found');
  const runId = runs[0].id;
  const res = await apiFetchRaw(`/payroll/cpf-file/${runId}`);
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'CPF file generation failed'); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `cpf-esubmit-${runs[0].period}.txt`; a.click();
  URL.revokeObjectURL(url);
}

async function runBankGiroForRun(runId: string, period: string) {
  const res = await apiFetchRaw(`/payroll/bank-giro/${runId}?bank=uob`);
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Bank GIRO generation failed'); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `bank-giro-${period}.txt`; a.click();
  URL.revokeObjectURL(url);
}

async function runCpfForRun(runId: string, period: string) {
  const res = await apiFetchRaw(`/payroll/cpf-file/${runId}`);
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'CPF file failed'); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `cpf-esubmit-${period}.txt`; a.click();
  URL.revokeObjectURL(url);
}

async function fetchPayrollBreakdownData(runId: string) {
  const [psData, empData] = await Promise.all([
    apiFetch(`/payroll/runs/${runId}/payslips`),
    apiFetch('/employees?limit=500'),
  ]);
  const payslips: any[] = psData.payslips ?? psData ?? [];
  const employees: any[] = empData.employees ?? empData ?? [];
  const empMap: Record<string, any> = {};
  for (const e of employees) empMap[e.id] = e;
  return payslips.map(ps => ({ ...ps, employeeName: empMap[ps.employeeId]?.fullName ?? ps.employeeId, employeeCode: empMap[ps.employeeId]?.employeeCode ?? '—' }));
}

async function runSdlReport() {
  const data = await apiFetch('/payroll/runs?limit=10&status=FINALISED');
  const runs = data.runs ?? [];
  if (runs.length === 0) throw new Error('No finalised payroll runs found');
  const rows: any[][] = [];
  for (const r of runs.slice(0, 3)) {
    try {
      const ps = await apiFetch(`/payroll/runs/${r.id}/payslips`);
      for (const p of (ps.payslips ?? ps ?? [])) {
        rows.push([r.period, p.employeeId, p.grossPay ?? '—', p.sdl ?? '—', p.fwl ?? '—']);
      }
    } catch {}
  }
  downloadCsv(`sdl-analytics-${new Date().toISOString().slice(0,10)}.csv`,
    ['Period', 'Employee ID', 'Gross Pay', 'SDL', 'FWL'],
    rows
  );
}

// ── Leave Liability Modal ─────────────────────────────────────────────────────
function LeaveLiabilityModal({ onClose, onToast }: { onClose: () => void; onToast: (m: string, t: 'ok'|'err') => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/reports/leave-liability?year=${year}`);
      setData(d);
    } catch (e: any) {
      onToast(e.message || 'Failed to generate leave liability report', 'err');
    } finally { setLoading(false); }
  };

  const handleCsv = () => {
    if (!data) return;
    downloadCsv(`leave-liability-${year}.csv`,
      ['Employee Code', 'Full Name', 'Department', 'Leave Type', 'Leave Code', 'Entitled Days', 'Carry Forward', 'Used Days', 'Pending Days', 'Unused Days', 'Daily Rate (SGD)', 'Liability (SGD)'],
      data.rows.map((r: any) => [r.employeeCode, r.fullName, r.department, r.leaveType, r.leaveCode, r.entitledDays, r.carryForward, r.usedDays, r.pendingDays, r.unusedDays, r.dailyRate, r.liability])
    );
    onToast('Leave liability CSV downloaded', 'ok');
  };

  const fmt = money;
  const byDept: Record<string, any[]> = data?.rows?.reduce((acc: Record<string, any[]>, r: any) => {
    if (!acc[r.department]) acc[r.department] = [];
    acc[r.department].push(r);
    return acc;
  }, {}) ?? {};

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Leave liability"
      caption="Accrued, unused leave valued at each person’s daily rate, for finance accruals."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button icon="download" onClick={handleCsv} disabled={!data} reason={!data ? 'Generate the report first' : undefined}>Download CSV</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Year" className="w-32">
            <Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={2020} max={2030} />
          </Field>
          <Button variant="secondary" onClick={generate} disabled={loading}>{loading ? 'Generating…' : 'Generate'}</Button>
        </div>

        {data && (
          <div className="flex flex-wrap gap-2.5">
            <MiniStat label="Total liability" value={fmt(data.totalLiability)} />
            <MiniStat label="Headcount" value={String(data.headcount)} />
            <MiniStat label="Year" value={String(data.year)} />
            <MiniStat label="Generated" value={new Date(data.generatedAt).toLocaleDateString('en-SG')} />
          </div>
        )}

        {!data ? (
          loading ? <Spinner label="Generating leave liability" /> : (
            <p className="py-10 text-center text-sm text-muted">Choose a year and select Generate.</p>
          )
        ) : data.rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No leave data for {year}.</p>
        ) : (
          <div className="overflow-x-auto rounded-control border border-rule">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0">
                <tr>{['Employee', 'Leave type', 'Entitled', 'Carried forward', 'Used', 'Pending', 'Unused', 'Daily rate', 'Liability'].map((h, i) => (
                  <th key={h} className={`${TH} ${i >= 2 ? 'text-right' : ''}`}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {Object.entries(byDept).map(([dept, rows]: [string, any[]]) => (
                  <Fragment key={dept}>
                    <tr className="bg-page border-t border-rule">
                      <td colSpan={9} className="px-3 py-2 text-[13px] font-bold text-ink">{dept}</td>
                    </tr>
                    {rows.map((r: any, i: number) => (
                      <tr key={`${r.employeeId}-${r.leaveCode}-${i}`} className="border-t border-rule hover:bg-page">
                        <td className={TD}><p className="font-semibold">{r.fullName}</p><p className="text-xs text-muted">{r.employeeCode}</p></td>
                        <td className={TD}>{r.leaveType}</td>
                        <td className={TD_NUM}>{r.entitledDays}</td>
                        <td className={`${TD_NUM} text-muted`}>{r.carryForward ?? 0}</td>
                        <td className={TD_NUM}>{r.usedDays}</td>
                        <td className={TD_NUM}>{r.pendingDays ?? 0}</td>
                        <td className={`${TD_NUM} font-semibold`}>{r.unusedDays}</td>
                        <td className={`${TD_NUM} text-muted`}>{fmt(r.dailyRate)}</td>
                        <td className={`${TD_NUM} font-bold`}>{fmt(r.liability)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-rule bg-page">
                      <td colSpan={8} className="px-3 py-2 text-right text-xs font-semibold text-muted">Department total</td>
                      <td className={`${TD_NUM} font-bold`}>{fmt(data.byDepartment[dept])}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── IR8A Modal ────────────────────────────────────────────────────────────────
function Ir8aModal({ onClose, onToast }: { onClose: () => void; onToast: (m: string, t: 'ok'|'err') => void }) {
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/reports/ir8a-data/${year}`);
      setData(d.employees ?? d ?? []);
    } catch (e: any) {
      onToast(e.message || 'Failed to generate IR8A data', 'err');
    } finally { setLoading(false); }
  };

  const downloadFlatFile = async () => {
    const res = await apiFetchRaw(`/reports/ir8a-file/${year}`);
    if (!res.ok) { const e = await res.json().catch(() => ({})); onToast((e as any).error || 'Flat file generation failed', 'err'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `IR8A-${year}.txt`; a.click();
    URL.revokeObjectURL(url);
    onToast('IR8A flat file downloaded', 'ok');
  };

  const fmt = money;
  const hasRows = !!data && data.length > 0;

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`IR8A annual filing — ${year}`}
      caption={`IRAS AIS submission data. The deadline is 1 March ${year + 1}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button icon="download" onClick={downloadFlatFile} disabled={!hasRows} reason={!hasRows ? 'Generate a year with data first' : undefined}>Download flat file</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Year of assessment" className="w-40">
            <Input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={2020} max={2030} />
          </Field>
          <Button variant="secondary" onClick={generate} disabled={loading}>{loading ? 'Generating…' : 'Generate'}</Button>
          <Badge tone="warn" className="mb-2.5 sm:ml-auto">IRAS deadline 1 Mar {year + 1}</Badge>
        </div>

        {!data ? (
          loading ? <Spinner label="Generating IR8A data" /> : (
            <p className="py-10 text-center text-sm text-muted">Choose a year and select Generate.</p>
          )
        ) : data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No finalised payslips for {year}.</p>
        ) : (
          <div className="overflow-x-auto rounded-control border border-rule">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0">
                <tr>{['Employee', 'NRIC', 'Employment income', 'Employee CPF', 'Employer CPF', 'AW income', 'Other taxable'].map((h, i) => (
                  <th key={h} className={`${TH} ${i >= 2 ? 'text-right' : ''}`}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {data.map((emp: any, i: number) => (
                  <tr key={emp.employeeId ?? i} className="border-t border-rule hover:bg-page">
                    <td className={TD}><p className="font-semibold">{emp.fullName}</p><p className="text-xs text-muted">{emp.employeeId}</p></td>
                    <td className={`${TD} font-mono text-[13px]`}>{emp.nric ?? '—'}</td>
                    <td className={`${TD_NUM} font-semibold`}>{fmt(emp.employmentIncome)}</td>
                    <td className={TD_NUM}>{fmt(emp.employeeCpf)}</td>
                    <td className={TD_NUM}>{fmt(emp.employerCpf)}</td>
                    <td className={TD_NUM}>{emp.awIncome > 0 ? fmt(emp.awIncome) : '—'}</td>
                    <td className={`${TD_NUM} text-muted`}>{emp.otherTaxableIncome > 0 ? fmt(emp.otherTaxableIncome) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Payroll Breakdown Modal ───────────────────────────────────────────────────
function PayrollBreakdownModal({ runId, period, onClose, onToast }: { runId: string; period: string; onClose: () => void; onToast: (m: string, t: 'ok'|'err') => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPayrollBreakdownData(runId)
      .then(setRows)
      .catch(e => onToast(e.message || 'Failed to load breakdown', 'err'))
      .finally(() => setLoading(false));
  }, [runId]);

  const fmt = (v: number | null | undefined) => v == null ? '—' : `$${Number(v).toFixed(2)}`;

  const handleCsv = () => {
    downloadCsv(`payroll-breakdown-${period}.csv`,
      ['Employee Code', 'Full Name', 'Basic Salary (OW)', 'Gross Pay', 'Employee CPF', 'Employer CPF', 'SDL', 'FWL', 'NPL Days', 'NPL Deduction', 'Govt-Paid Days', 'Govt-Paid Amount', 'Net Pay', 'YTD Gross', 'YTD Employee CPF'],
      rows.map(r => [r.employeeCode, r.employeeName, r.basicSalary, r.grossPay, r.employeeCpf, r.employerCpf, r.sdl, r.fwl, r.nplDays, r.nplDeduction, r.govtPaidDays, r.govtPaidAmount, r.netPay, r.ytdGross, r.ytdEmployeeCpf])
    );
    onToast('Payroll breakdown CSV downloaded', 'ok');
  };

  const noRows = loading || rows.length === 0;

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Payroll breakdown — ${period}`}
      caption="Every payroll calculation for each employee in this run (MOM, CPF and EA rules)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button icon="download" onClick={handleCsv} disabled={noRows} reason={!loading && rows.length === 0 ? 'No payslips in this run' : undefined}>Download CSV</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!loading && rows.length > 0 && (() => {
          const tot = rows.reduce((a, r) => ({
            gross: a.gross + r.grossPay,
            net: a.net + r.netPay,
            empCpf: a.empCpf + r.employeeCpf,
            emplrCpf: a.emplrCpf + r.employerCpf,
            sdl: a.sdl + r.sdl,
          }), { gross: 0, net: 0, empCpf: 0, emplrCpf: 0, sdl: 0 });
          return (
            <div className="flex flex-wrap gap-2.5">
              <MiniStat label="Total gross" value={fmt(tot.gross)} />
              <MiniStat label="Total net" value={fmt(tot.net)} />
              <MiniStat label="Employee CPF" value={fmt(tot.empCpf)} />
              <MiniStat label="Employer CPF" value={fmt(tot.emplrCpf)} />
              <MiniStat label="SDL" value={fmt(tot.sdl)} />
              <MiniStat label="Employees" value={String(rows.length)} />
            </div>
          );
        })()}

        {loading ? (
          <Spinner label="Loading payroll breakdown" />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No payslips found for this run.</p>
        ) : (
          <div className="overflow-x-auto rounded-control border border-rule">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0">
                <tr>
                  {['Code', 'Employee', 'Basic salary (OW)', 'Gross pay', 'Employee CPF', 'Employer CPF', 'SDL', 'FWL', 'NPL days', 'NPL deduction', 'Govt-paid days', 'Govt-paid amount', 'Net pay', 'YTD gross', 'YTD employee CPF'].map((h, i) => (
                    <th key={h} className={`${TH} ${i >= 2 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-rule hover:bg-page">
                    <td className={`${TD} text-muted`}>{r.employeeCode}</td>
                    <td className={`${TD} font-semibold`}>{r.employeeName}</td>
                    <td className={TD_NUM}>{fmt(r.basicSalary)}</td>
                    <td className={`${TD_NUM} font-semibold`}>{fmt(r.grossPay)}</td>
                    <td className={TD_NUM}>{fmt(r.employeeCpf)}</td>
                    <td className={TD_NUM}>{fmt(r.employerCpf)}</td>
                    <td className={TD_NUM}>{fmt(r.sdl)}</td>
                    <td className={`${TD_NUM} text-muted`}>{r.fwl > 0 ? fmt(r.fwl) : '—'}</td>
                    <td className={TD_NUM}>{r.nplDays > 0 ? r.nplDays : '—'}</td>
                    <td className={TD_NUM}>{r.nplDeduction > 0 ? fmt(r.nplDeduction) : '—'}</td>
                    <td className={TD_NUM}>{r.govtPaidDays > 0 ? r.govtPaidDays : '—'}</td>
                    <td className={TD_NUM}>{r.govtPaidAmount > 0 ? fmt(r.govtPaidAmount) : '—'}</td>
                    <td className={`${TD_NUM} font-bold`}>{fmt(r.netPay)}</td>
                    <td className={`${TD_NUM} text-muted`}>{fmt(r.ytdGross)}</td>
                    <td className={`${TD_NUM} text-muted`}>{fmt(r.ytdEmployeeCpf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Report definitions ────────────────────────────────────────────────────────
type ReportKey = 'cpf' | 'iras' | 'giro' | 'leave' | 'workforce' | 'attrition' | 'mom' | 'sdl' | 'variance' | 'payroll-breakdown' | 'custom';

interface ReportDef {
  key: ReportKey;
  name: string;
  category: string;
  icon: IconName;
  freq: string;
  badge: string;
  needsRunSelector?: boolean;
  runSelectorTitle?: string;
}

const REPORTS: ReportDef[] = [
  { key: 'cpf',               name: 'CPF / SDL / FWL statutory report',          category: 'Statutory',  icon: 'shield', freq: 'Monthly',    badge: 'MOM required',  needsRunSelector: true, runSelectorTitle: 'Select payroll run — CPF e-Submit' },
  { key: 'iras',              name: 'IRAS AIS / IR8A annual filing',              category: 'Statutory',  icon: 'shield', freq: 'Annual',     badge: 'IRAS required' },
  { key: 'giro',              name: 'Bank GIRO reconciliation',                   category: 'Financial',  icon: 'wallet', freq: 'Monthly',    badge: '',              needsRunSelector: true, runSelectorTitle: 'Select payroll run — Bank GIRO' },
  { key: 'payroll-breakdown', name: 'Payroll calculation breakdown',              category: 'Financial',  icon: 'wallet', freq: 'Per run',    badge: 'Full detail',   needsRunSelector: true, runSelectorTitle: 'Select payroll run — breakdown report' },
  { key: 'leave',             name: 'Leave liability report',                     category: 'Workforce',  icon: 'calendar', freq: 'Monthly',  badge: '' },
  { key: 'workforce',         name: 'Executive workforce dashboard',              category: 'Analytics',  icon: 'chart',  freq: 'Real-time',  badge: 'SA only' },
  { key: 'attrition',         name: 'Attrition and workforce analytics',          category: 'Analytics',  icon: 'chart',  freq: 'Quarterly',  badge: '' },
  { key: 'mom',               name: 'MOM headcount report',                       category: 'Statutory',  icon: 'shield', freq: 'Annual',     badge: 'MOM required' },
  { key: 'sdl',               name: 'Training and SDL analytics',                 category: 'Training',   icon: 'book',   freq: 'Monthly',    badge: '' },
  { key: 'variance',          name: 'Payroll variance report',                    category: 'Financial',  icon: 'wallet', freq: 'Per run',    badge: '' },
  { key: 'custom',            name: 'Custom report builder',                      category: 'Analytics',  icon: 'grid',   freq: 'On demand',  badge: 'Premium' },
];

const CATEGORIES = ['Statutory', 'Financial', 'Workforce', 'Analytics', 'Training'];

/**
 * The small tag on a report card. Regulatory requirements get the warn tone
 * (they carry a deadline), the plan-gated one gets brass (the plan/trial
 * colour), and the rest are plain labels.
 */
const REPORT_BADGE_TONE: Record<string, BadgeTone> = {
  'MOM required':  'warn',
  'IRAS required': 'warn',
  'Full detail':   'neutral',
  'SA only':       'neutral',
  'Premium':       'brass',
};

// ── RPT-001 Executive Workforce Dashboard Modal ───────────────────────────────
interface WFDashData {
  generatedAt: string;
  kpis: { totalHeadcount: number; activeHeadcount: number; hiresMtd: number; termsMtd: number; attritionRate12m: number; terminations12m: number };
  trend: { label: string; hires: number; terminations: number }[];
  byDepartment: Record<string, number>;
  byEmploymentType: Record<string, number>;
  byCitizenship: Record<string, number>;
}
interface OTData {
  months: string[];
  byDepartment: Record<string, number[]>;
  totals: Record<string, number>;
}
interface TrainingData {
  completionRate: number;
  completed: number;
  inProgress: number;
  totalEnrollments: number;
  mandatory: number;
  byCategory: { category: string; _count: { id: number } }[];
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function BarRow({ label, value, pct, color }: { label: string; value: string; pct: number; color?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between gap-3 text-[13px]">
        <span className="font-semibold text-ink truncate">{label}</span>
        <span className="text-muted tabular-nums shrink-0">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-pill overflow-hidden" aria-hidden="true">
        <div className={`h-full rounded-full ${color ? '' : 'bg-accent'}`} style={{ width: `${pct}%`, ...(color ? { backgroundColor: color } : {}) }} />
      </div>
    </div>
  );
}

/**
 * Not the kit Modal on purpose: this dialog has a Print / PDF action, and the
 * kit Modal has no print mode. Visually it matches the kit Modal; it is
 * role="dialog", aria-modal, and Escape closes it.
 *
 * Printing needs two things the old overlay did not have, and it never printed
 * the dashboard (verified: the PDF was the Reports page behind it, then a blank
 * page). The dialog is portalled to <body> so it can be the ONLY thing printed,
 * and PRINT_CSS hides every other child of <body> and lifts the app's full-
 * height / overflow-hidden shell so the dashboard flows across pages.
 */
const PRINT_CSS = `@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not([data-print-root]) { display: none !important; }
}`;

function WorkforceDashboardModal({ onClose, onToast }: { onClose: () => void; onToast: (m: string, t: 'ok'|'err') => void }) {
  const [data, setData]         = useState<WFDashData | null>(null);
  const [otData, setOtData]     = useState<OTData | null>(null);
  const [trainData, setTrainData] = useState<TrainingData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [secAgo, setSecAgo]     = useState(0);

  const loadAll = async (isBackground = false) => {
    if (isBackground) setRefreshing(true); else setLoading(true);
    try {
      const [wf, ot, tr] = await Promise.allSettled([
        apiFetch('/reports/workforce-dashboard'),
        apiFetch('/reports/ot-by-department?months=6'),
        apiFetch('/reports/training-summary'),
      ]);
      if (wf.status === 'fulfilled') setData(wf.value);
      else onToast((wf.reason as Error).message || 'Failed to load workforce dashboard', 'err');
      if (ot.status === 'fulfilled') setOtData(ot.value);
      if (tr.status === 'fulfilled') setTrainData(tr.value);
      setLastRefreshed(new Date());
      setSecAgo(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadAll();
    const autoRefresh = setInterval(() => loadAll(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(autoRefresh);
  }, []);

  useEffect(() => {
    if (!lastRefreshed) return;
    const tick = setInterval(() => setSecAgo(Math.round((Date.now() - lastRefreshed.getTime()) / 1000)), 15000);
    return () => clearInterval(tick);
  }, [lastRefreshed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/40">
        <div className="flex flex-col items-center gap-3 px-10 py-8 bg-paper border border-rule rounded-card shadow-card">
          <div className="w-8 h-8 border-2 border-rule border-t-accent animate-spin rounded-full" role="status" aria-label="Loading dashboard" />
          <p className="text-sm text-muted">Loading the dashboard…</p>
        </div>
      </div>
    );
  }

  // A failed or empty /reports/workforce-dashboard used to leave this spinning
  // forever (fetch failed → data null) or crash the whole /reports route on
  // `trend.map` (payload {}). Either way, say so and offer a retry instead.
  if (!data || !data.kpis || !Array.isArray(data.trend)) {
    return (
      <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-ink/40 sm:p-4" onMouseDown={onClose}>
        <div role="alertdialog" aria-modal="true" aria-labelledby="wf-dash-error" onMouseDown={e => e.stopPropagation()}
          className="w-full sm:max-w-md bg-paper border border-rule rounded-t-card sm:rounded-card shadow-card p-6 flex flex-col items-center text-center gap-3">
          <span className="flex items-center justify-center w-11 h-11 rounded-full bg-danger-bg text-danger" aria-hidden="true"><Icon name="alert" size={22} /></span>
          <h2 id="wf-dash-error" className="text-[17px] font-bold text-ink">The workforce dashboard could not be loaded</h2>
          <p className="text-[13px] text-muted">The report service returned no data. Try again, or run one of the other reports.</p>
          <div className="flex gap-2.5 mt-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={() => loadAll()}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }

  const kpis = data.kpis;
  const trend = data.trend;
  const byDepartment = data.byDepartment ?? {};
  const byEmploymentType = data.byEmploymentType ?? {};
  const byCitizenship = data.byCitizenship ?? {};

  // ── SVG bar chart helpers ──────────────────────────────────────────────────
  const chartW = 560; const chartH = 160; const barPad = 4;
  const maxTrend = Math.max(...trend.map(m => Math.max(m.hires, m.terminations)), 1);
  const barGroupW = (chartW - 40) / trend.length;
  const barW = Math.max(4, (barGroupW - barPad * 2) / 2);

  // ── Headcount breakdown helpers ────────────────────────────────────────────
  const deptEntries  = Object.entries(byDepartment).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxDept      = Math.max(...deptEntries.map(e => e[1]), 1);
  const etEntries    = Object.entries(byEmploymentType).sort((a, b) => b[1] - a[1]);
  const csEntries    = Object.entries(byCitizenship).filter(e => e[1] > 0);
  const totalCiti    = csEntries.reduce((s, e) => s + e[1], 0) || 1;
  // Six chart series from the token set. SVG/inline `background` takes CSS
  // variables, so these follow the theme rather than freezing a hex.
  const csColors: Record<string, string> = {
    SC:      'var(--accent)',
    PR:      'var(--highlight)',
    EP:      'var(--ink)',
    S_PASS:  'color-mix(in srgb, var(--accent) 55%, var(--paper))',
    WP:      'color-mix(in srgb, var(--ink) 45%, var(--paper))',
    OTHER:   'var(--muted)',
  };
  // Hires vs terminations: accent vs a mid ink. The legend below uses the same
  // two values; the bars previously used raw emerald/red hexes that matched
  // neither the legend nor the token set.
  const HIRES = 'var(--accent)';
  const TERMS = 'color-mix(in srgb, var(--ink) 55%, var(--paper))';

  // ── OT helpers ─────────────────────────────────────────────────────────────
  const otEntries = otData ? Object.entries(otData.totals ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  const maxOt     = Math.max(...otEntries.map(e => e[1]), 1);
  // Current month OT = last index in each dept array
  const otCurrentMonth = otData
    ? Object.fromEntries(Object.entries(otData.byDepartment ?? {}).map(([d, arr]) => [d, arr[arr.length - 1] ?? 0]))
    : {};

  // ── Training helpers ───────────────────────────────────────────────────────
  const catEntries = trainData
    ? [...(trainData.byCategory || [])].sort((a, b) => b._count.id - a._count.id).slice(0, 6)
    : [];
  const maxCat = Math.max(...catEntries.map(c => c._count.id), 1);

  const kpiCards = [
    { label: 'Total headcount',      value: kpis.totalHeadcount,         sub: `${kpis.activeHeadcount} active` },
    { label: 'Hires this month',     value: kpis.hiresMtd,               sub: 'month to date' },
    { label: 'Leavers this month',   value: kpis.termsMtd,               sub: 'month to date' },
    { label: 'Attrition, 12 months', value: `${kpis.attritionRate12m}%`, sub: `${kpis.terminations12m} exits in 12 months` },
  ];

  const refreshLabel = secAgo < 60 ? 'just now' : secAgo < 3600 ? `${Math.floor(secAgo / 60)}m ago` : `${Math.floor(secAgo / 3600)}h ago`;

  return createPortal(
    <div data-print-root className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-ink/40 sm:p-4 print:p-0 print:bg-transparent print:inset-auto print:static print:block" onMouseDown={onClose}>
      <style>{PRINT_CSS}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wf-dash-title"
        onMouseDown={e => e.stopPropagation()}
        className="w-full sm:max-w-5xl max-h-[92vh] flex flex-col bg-paper border border-rule rounded-t-card sm:rounded-card shadow-card overflow-hidden print:max-w-none print:max-h-none print:overflow-visible print:border-0 print:shadow-none print:rounded-none"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between px-5 pt-5 pb-4 border-b border-rule">
          <div className="min-w-0">
            <h2 id="wf-dash-title" className="text-[17px] font-bold text-ink leading-tight">Executive workforce dashboard</h2>
            <p className="mt-1 text-[13px] text-muted flex items-center gap-2">
              Refreshes every 5 minutes · {lastRefreshed ? `updated ${refreshLabel}` : 'loading…'}
              {refreshing && <span className="inline-block w-3 h-3 border-2 border-rule border-t-accent animate-spin rounded-full" aria-label="Refreshing" />}
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <Button size="sm" variant="secondary" onClick={() => loadAll(true)} disabled={refreshing}>Refresh</Button>
            <Button size="sm" variant="secondary" icon="download" onClick={() => window.print()}>Print or save as PDF</Button>
            <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 flex items-center justify-center rounded-control text-muted hover:bg-page hover:text-ink">
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-5 print:overflow-visible">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpiCards.map(k => <Stat key={k.label} label={k.label} value={k.value} note={k.sub} />)}
          </div>

          <Card className="break-inside-avoid">
            <CardHeader title="Hires and leavers, last 12 months" />
            <svg viewBox={`0 0 ${chartW} ${chartH + 30}`} width="100%" className="overflow-visible" role="img" aria-label="Monthly hires and leavers over the last 12 months">
              {[0, 0.25, 0.5, 0.75, 1].map(f => (
                <line key={f} x1={30} y1={chartH * (1 - f)} x2={chartW} y2={chartH * (1 - f)} stroke="var(--rule)" strokeWidth="1" />
              ))}
              {trend.map((m, i) => {
                const x = 30 + i * barGroupW + barPad;
                const hH = Math.round((m.hires / maxTrend) * chartH);
                const tH = Math.round((m.terminations / maxTrend) * chartH);
                return (
                  <g key={m.label}>
                    <rect x={x}            y={chartH - hH} width={barW} height={hH} rx="2" fill={HIRES}><title>{`${m.label}: ${m.hires} hires`}</title></rect>
                    <rect x={x + barW + 1} y={chartH - tH} width={barW} height={tH} rx="2" fill={TERMS}><title>{`${m.label}: ${m.terminations} leavers`}</title></rect>
                    <text x={x + barW} y={chartH + 18} textAnchor="middle" fontSize="11" fill="var(--muted)" fontWeight="600">{m.label}</text>
                  </g>
                );
              })}
            </svg>
            <div className="flex gap-5 mt-2 text-[13px] text-muted">
              <span className="inline-flex items-center gap-2"><span className="w-3 h-3" style={{ backgroundColor: HIRES }} aria-hidden="true" />Hires</span>
              <span className="inline-flex items-center gap-2"><span className="w-3 h-3" style={{ backgroundColor: TERMS }} aria-hidden="true" />Leavers</span>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="break-inside-avoid">
              <CardHeader title="By department" />
              <div className="flex flex-col gap-3">
                {deptEntries.map(([dept, count]) => (
                  <BarRow key={dept} label={dept} value={String(count)} pct={(count / maxDept) * 100} />
                ))}
              </div>
            </Card>
            <Card className="break-inside-avoid">
              <CardHeader title="Employment type" />
              <div className="flex flex-col gap-3">
                {etEntries.map(([type, count]) => {
                  const total = etEntries.reduce((s, e) => s + e[1], 0) || 1;
                  const pct   = Math.round((count / total) * 100);
                  return <BarRow key={type} label={sentence(type)} value={`${count} (${pct}%)`} pct={pct} />;
                })}
              </div>
            </Card>
            <Card className="break-inside-avoid">
              <CardHeader title="Citizenship and pass" />
              <div className="flex flex-col gap-3">
                {csEntries.map(([key, count]) => {
                  const pct = Math.round((count / totalCiti) * 100);
                  return <BarRow key={key} label={key.replace(/_/g, ' ')} value={`${count} (${pct}%)`} pct={pct} color={csColors[key] || 'var(--muted)'} />;
                })}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="break-inside-avoid">
              <CardHeader title="Overtime hours by department" caption={otData ? 'This month, out of the 6-month total' : undefined} />
              {!otData ? (
                <p className="text-[13px] text-muted py-4">No overtime data available.</p>
              ) : otEntries.length === 0 ? (
                <p className="text-[13px] text-muted py-4">No overtime recorded in this period.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {otEntries.map(([dept, total]) => {
                    const thisMo = otCurrentMonth[dept] ?? 0;
                    const pct    = Math.round((total / maxOt) * 100);
                    const moPct  = total > 0 ? Math.round((thisMo / total) * 100) : 0;
                    return (
                      <div key={dept} className="flex flex-col gap-1">
                        <div className="flex justify-between gap-3 text-[13px]">
                          <span className="font-semibold text-ink truncate">{dept}</span>
                          <span className="text-muted tabular-nums shrink-0"><span className="font-semibold text-ink">{thisMo}h</span> of {total}h</span>
                        </div>
                        <div className="h-2 rounded-full bg-pill overflow-hidden" aria-hidden="true">
                          <div className="h-full rounded-full relative" style={{ width: `${pct}%`, backgroundColor: 'color-mix(in srgb, var(--accent) 30%, var(--paper))' }}>
                            <div className="h-full rounded-full bg-accent absolute left-0 top-0" style={{ width: `${moPct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card className="break-inside-avoid">
              <CardHeader title="Training completion" />
              {!trainData ? (
                <p className="text-[13px] text-muted py-4">No training data available.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-6">
                    <div>
                      <p className="text-[36px] font-extrabold leading-none text-ink tabular-nums">{trainData.completionRate != null ? `${trainData.completionRate}%` : '—'}</p>
                      <p className="text-[13px] text-muted mt-1">completed</p>
                    </div>
                    <dl className="flex flex-col gap-1.5 flex-1 text-[13px]">
                      {[
                        { label: 'Completed',   value: trainData.completed },
                        { label: 'In progress', value: trainData.inProgress },
                        { label: 'Enrolments',  value: trainData.totalEnrollments },
                      ].map(s => (
                        <div key={s.label} className="flex items-center justify-between">
                          <dt className="text-muted">{s.label}</dt>
                          <dd className="font-semibold text-ink tabular-nums">{s.value}</dd>
                        </div>
                      ))}
                      {trainData.mandatory > 0 && (
                        <div className="mt-1"><Badge tone="warn">{trainData.mandatory} mandatory programme{trainData.mandatory !== 1 ? 's' : ''}</Badge></div>
                      )}
                    </dl>
                  </div>
                  {catEntries.length > 0 && (
                    <div className="flex flex-col gap-3 pt-3 border-t border-rule">
                      <p className="text-[12.5px] font-semibold text-muted">Programmes by category</p>
                      {catEntries.map(c => (
                        <BarRow key={c.category} label={c.category} value={String(c._count.id)} pct={Math.round((c._count.id / maxCat) * 100)} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Custom report builder modal ───────────────────────────────────────────────
function CustomReportModal({ onClose, onToast }: { onClose: () => void; onToast: (m: string, t: 'ok'|'err') => void }) {
  const [dataset, setDataset] = useState('employees');
  const [fields, setFields] = useState<string[]>(['fullName', 'department', 'designation', 'employmentType', 'startDate']);
  const [running, setRunning] = useState(false);

  const DATASETS: Record<string, string[]> = {
    employees: ['employeeCode', 'fullName', 'department', 'designation', 'employmentType', 'nationality', 'gender', 'startDate', 'endDate', 'workEmail', 'isActive', 'costCentre', 'reportingManager'],
    leave:     ['employeeName', 'leaveType', 'startDate', 'endDate', 'totalDays', 'status', 'reason'],
  };

  const toggle = (f: string) => setFields(p => p.includes(f) ? p.filter(x => x !== f) : [...p, f]);

  const handleRun = async () => {
    if (fields.length === 0) return onToast('Select at least one field', 'err');
    setRunning(true);
    try {
      let rows: any[][] = [];
      if (dataset === 'employees') {
        const data = await apiFetch('/employees?limit=500');
        const emps = data.employees ?? data ?? [];
        rows = emps.map((e: any) => fields.map(f => e[f] ?? ''));
      } else {
        const data = await apiFetch('/leave/applications?limit=500');
        const apps = data.applications ?? [];
        rows = apps.map((a: any) => fields.map(f => {
          if (f === 'employeeName') return a.employee?.fullName ?? a.employeeId;
          if (f === 'leaveType') return a.leaveType?.name ?? a.leaveTypeId;
          return a[f] ?? '';
        }));
      }
      downloadCsv(`custom-report-${dataset}-${new Date().toISOString().slice(0,10)}.csv`, fields, rows);
      onToast('Custom report downloaded', 'ok');
      onClose();
    } catch (e: any) { onToast(e.message, 'err'); }
    finally { setRunning(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Quick custom report"
      caption="Pick a dataset and the fields you want, then download a CSV."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button icon="download" onClick={handleRun} disabled={running || fields.length === 0} reason={!running && fields.length === 0 ? 'Pick at least one field' : undefined}>
            {running ? 'Generating…' : `Download CSV (${fields.length} field${fields.length === 1 ? '' : 's'})`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Dataset">
          <Select value={dataset} onChange={e => { setDataset(e.target.value); setFields([]); }}>
            <option value="employees">Employees</option>
            <option value="leave">Leave applications</option>
          </Select>
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12.5px] font-semibold text-muted mb-1.5">Fields to include</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
            {DATASETS[dataset].map(f => {
              const on = fields.includes(f);
              return (
                <label key={f} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-control border cursor-pointer transition-colors ${on ? 'border-accent bg-tint' : 'border-rule bg-paper hover:border-accent'}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(f)} className="w-4 h-4 accent-accent" />
                  <span className="text-[13px] font-medium text-ink font-mono">{f}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}

// ── RPT-003 Phase 2 — Report Builder Wizard + Schedule Modal ──────────────────
type ReportMode = 'fields' | 'grouped';
type FilterRow  = { id: string; field: string; op: string; value: string };
type AggRow     = { id: string; field: string; op: string; as: string };
type SortRow    = { id: string; field: string; dir: 'asc' | 'desc' };
interface CatalogField { key: string; label: string; type: string }
interface Catalog { [ds: string]: CatalogField[] }

const DS_LABELS: Record<string, string> = {
  employees: 'Employees', payrollRuns: 'Payroll runs',
  leaveApplications: 'Leave applications', attendance: 'Attendance', claims: 'Claims',
};
const FILTER_OPS_META = [
  { op: 'eq', label: '=' }, { op: 'ne', label: '≠' },
  { op: 'gt', label: '>' }, { op: 'lt', label: '<' },
  { op: 'gte', label: '≥' }, { op: 'lte', label: '≤' },
  { op: 'contains', label: 'contains' }, { op: 'in', label: 'in (csv)' },
];
const AGG_OPS_META = [
  { op: 'count', label: 'Count' }, { op: 'sum', label: 'Sum' },
  { op: 'avg', label: 'Average' }, { op: 'min', label: 'Minimum' }, { op: 'max', label: 'Maximum' },
];
function nanoid6() { return Math.random().toString(36).slice(2, 8); }

function RemoveRowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="w-9 h-9 shrink-0 flex items-center justify-center rounded-control text-muted hover:bg-pill hover:text-danger">
      <Icon name="x" size={16} />
    </button>
  );
}

function ReportBuilderWizard({ onClose, onSaved, onToast }: {
  onClose: () => void; onSaved: () => void; onToast: (msg: string, type: 'ok' | 'err') => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [catalog, setCatalog] = useState<Catalog>({});
  const [saving, setSaving] = useState(false);
  // Step 1
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('WORKFORCE');
  const [dataSource, setDataSource] = useState('employees');
  // Step 2
  const [mode, setMode] = useState<ReportMode>('fields');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState('');
  const [aggregations, setAggregations] = useState<AggRow[]>([{ id: nanoid6(), field: '', op: 'count', as: 'count' }]);
  // Step 3
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [sortBy, setSortBy] = useState<SortRow[]>([]);

  useEffect(() => {
    apiFetch('/reports/data-sources')
      .then(d => setCatalog(d.fieldCatalog || {}))
      .catch(() => {});
  }, []);

  const fields = catalog[dataSource] || [];
  const toggleField = (key: string) =>
    setSelectedFields(p => p.includes(key) ? p.filter(k => k !== key) : [...p, key]);

  function buildDefinition() {
    const def: any = { dataSource };
    if (filters.length > 0) {
      def.filters = filters.map(f => {
        let val: any = f.value;
        if (f.op === 'in') val = f.value.split(',').map(v => v.trim());
        else if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (val !== '' && !isNaN(Number(val))) val = Number(val);
        return { field: f.field, op: f.op, value: val };
      });
    }
    if (mode === 'fields') {
      if (selectedFields.length > 0) {
        def.fields = selectedFields.map(k => ({ key: k, label: fields.find(f => f.key === k)?.label || k }));
      }
    } else {
      if (groupBy) def.groupBy = groupBy;
      const aggs = aggregations.filter(a => a.as.trim());
      if (aggs.length > 0) {
        def.aggregations = aggs.map(a => ({
          op: a.op, as: a.as.trim(),
          ...(a.op !== 'count' && a.field ? { field: a.field } : {}),
        }));
      }
    }
    if (sortBy.length > 0) def.sortBy = sortBy.map(s => ({ field: s.field, dir: s.dir }));
    return def;
  }

  async function save() {
    if (!name.trim()) { onToast('Name is required', 'err'); return; }
    setSaving(true);
    try {
      await apiFetch('/reports/templates', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description, category, definition: buildDefinition() }),
      });
      onToast('Report saved', 'ok');
      onSaved();
    } catch (e: any) {
      onToast(e.message || 'Save failed', 'err');
    } finally { setSaving(false); }
  }

  const canNext1 = name.trim().length > 0;
  const canNext2 = mode === 'fields' ? selectedFields.length > 0
    : groupBy !== '' && aggregations.some(a => a.as.trim());

  const nextReason = step === 1
    ? (!canNext1 ? 'Name the report first' : undefined)
    : (!canNext2 ? (mode === 'fields' ? 'Pick at least one field' : 'Pick a group-by field and name an aggregation') : undefined);

  const stepState = (s: 1 | 2 | 3) => (s < step ? 'done' : s === step ? 'now' : 'todo') as 'done' | 'now' | 'todo';

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="New saved report"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {step > 1 && (
            <Button variant="secondary" onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}>Back</Button>
          )}
          {step < 3 ? (
            <Button onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)} disabled={step === 1 ? !canNext1 : !canNext2} reason={nextReason}>
              Next
            </Button>
          ) : (
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save report'}</Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Stepper steps={[
          { label: 'Basics', state: stepState(1) },
          { label: 'Columns', state: stepState(2) },
          { label: 'Filters and order', state: stepState(3) },
        ]} />

        {step === 1 && (
          <>
            <Field label="Report name" required>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Active headcount by department" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Category">
                <Select value={category} onChange={e => setCategory(e.target.value)}>
                  {['WORKFORCE', 'FINANCIAL', 'LEAVE', 'TRAINING', 'COMPLIANCE', 'CUSTOM'].map(c => (
                    <option key={c} value={c}>{sentence(c)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Description" help="Optional.">
                <Input value={description} onChange={e => setDescription(e.target.value)} />
              </Field>
            </div>
            <fieldset>
              <legend className="text-[12.5px] font-semibold text-muted mb-2">Data source</legend>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {Object.entries(DS_LABELS).map(([ds, lbl]) => {
                  const on = dataSource === ds;
                  return (
                    <button key={ds} type="button" aria-pressed={on} onClick={() => { setDataSource(ds); setSelectedFields([]); setGroupBy(''); }}
                      className={`px-3.5 py-3 rounded-control border text-left transition-colors ${on ? 'border-accent bg-tint' : 'border-rule bg-paper hover:border-accent'}`}>
                      <p className={`text-sm font-semibold ${on ? 'text-accent' : 'text-ink'}`}>{lbl}</p>
                      <p className="text-xs text-muted mt-0.5 tabular-nums">{(catalog[ds] || []).length || '—'} fields</p>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </>
        )}

        {step === 2 && (
          <>
            <div role="radiogroup" aria-label="Report shape" className="grid grid-cols-2 gap-2.5">
              {(['fields', 'grouped'] as ReportMode[]).map(m => {
                const on = mode === m;
                return (
                  <button key={m} type="button" role="radio" aria-checked={on} onClick={() => setMode(m)}
                    className={`px-3.5 py-3 rounded-control border text-left transition-colors ${on ? 'border-accent bg-tint' : 'border-rule bg-paper hover:border-accent'}`}>
                    <p className={`text-sm font-semibold ${on ? 'text-accent' : 'text-ink'}`}>{m === 'fields' ? 'List of rows' : 'Grouped summary'}</p>
                    <p className="text-xs text-muted mt-0.5">{m === 'fields' ? 'One row per record, the columns you pick.' : 'One row per group, with counts or totals.'}</p>
                  </button>
                );
              })}
            </div>

            {mode === 'fields' && (
              <fieldset>
                <legend className="text-[12.5px] font-semibold text-muted mb-2">Columns to include</legend>
                {fields.length === 0 ? (
                  <p className="text-[13px] text-muted">No fields available for this data source.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                    {fields.map(f => {
                      const on = selectedFields.includes(f.key);
                      return (
                        <label key={f.key} className={`flex items-center gap-2.5 px-3 py-2.5 rounded-control border cursor-pointer transition-colors ${on ? 'border-accent bg-tint' : 'border-rule bg-paper hover:border-accent'}`}>
                          <input type="checkbox" checked={on} onChange={() => toggleField(f.key)} className="w-4 h-4 accent-accent" />
                          <span className="min-w-0">
                            <span className="text-[13px] font-semibold text-ink block truncate">{f.label}</span>
                            <span className="text-xs text-muted">{f.type}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>
            )}

            {mode === 'grouped' && (
              <>
                <Field label="Group by">
                  <Select value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                    <option value="">Pick a field</option>
                    {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </Select>
                </Field>
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[12.5px] font-semibold text-muted">Aggregations</p>
                    <Button size="sm" variant="ghost" icon="plus" onClick={() => setAggregations(p => [...p, { id: nanoid6(), field: '', op: 'count', as: '' }])}>Add</Button>
                  </div>
                  {aggregations.map((agg, i) => (
                    <div key={agg.id} className="grid grid-cols-[110px_minmax(0,1fr)_auto] sm:grid-cols-[120px_minmax(0,1fr)_auto_120px_auto] gap-2 items-center">
                      <Select aria-label="Aggregation" value={agg.op} onChange={e => setAggregations(p => p.map((a, j) => j === i ? { ...a, op: e.target.value } : a))}>
                        {AGG_OPS_META.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                      </Select>
                      <Select aria-label="Field" value={agg.field} onChange={e => setAggregations(p => p.map((a, j) => j === i ? { ...a, field: e.target.value } : a))}
                        disabled={agg.op === 'count'}>
                        <option value="">{agg.op === 'count' ? 'All rows' : 'A number field'}</option>
                        {fields.filter(f => f.type === 'number').map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </Select>
                      <span className="hidden sm:inline text-[13px] text-muted">as</span>
                      <Input aria-label="Column name" value={agg.as} onChange={e => setAggregations(p => p.map((a, j) => j === i ? { ...a, as: e.target.value } : a))}
                        placeholder="Column name" className="col-span-2 sm:col-span-1" />
                      {aggregations.length > 1 ? (
                        <RemoveRowButton label="Remove aggregation" onClick={() => setAggregations(p => p.filter((_, j) => j !== i))} />
                      ) : <span className="w-9" />}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[12.5px] font-semibold text-muted">Filters <span className="font-normal">(optional)</span></p>
                <Button size="sm" variant="ghost" icon="plus" onClick={() => setFilters(p => [...p, { id: nanoid6(), field: fields[0]?.key || '', op: 'eq', value: '' }])}>Add filter</Button>
              </div>
              {filters.length === 0 && <p className="text-[13px] text-muted">No filters, so every row is included.</p>}
              {filters.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[minmax(0,1fr)_110px_auto] sm:grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)_auto] gap-2 items-center">
                  <Select aria-label="Filter field" value={f.field} onChange={e => setFilters(p => p.map((r, j) => j === i ? { ...r, field: e.target.value } : r))}>
                    {fields.map(fd => <option key={fd.key} value={fd.key}>{fd.label}</option>)}
                  </Select>
                  <Select aria-label="Operator" value={f.op} onChange={e => setFilters(p => p.map((r, j) => j === i ? { ...r, op: e.target.value } : r))}>
                    {FILTER_OPS_META.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                  </Select>
                  <Input aria-label="Value" value={f.value} onChange={e => setFilters(p => p.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                    placeholder={f.op === 'in' ? 'value1, value2' : 'Value'} className="col-span-2 sm:col-span-1 order-last sm:order-none" />
                  <RemoveRowButton label="Remove filter" onClick={() => setFilters(p => p.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[12.5px] font-semibold text-muted">Sort order <span className="font-normal">(optional)</span></p>
                <Button size="sm" variant="ghost" icon="plus" onClick={() => setSortBy(p => [...p, { id: nanoid6(), field: fields[0]?.key || '', dir: 'asc' }])}>Add sort</Button>
              </div>
              {sortBy.map((s, i) => (
                <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 items-center">
                  <Select aria-label="Sort field" value={s.field} onChange={e => setSortBy(p => p.map((r, j) => j === i ? { ...r, field: e.target.value } : r))}>
                    {fields.map(fd => <option key={fd.key} value={fd.key}>{fd.label}</option>)}
                  </Select>
                  <Button variant="secondary" onClick={() => setSortBy(p => p.map((r, j) => j === i ? { ...r, dir: r.dir === 'asc' ? 'desc' : 'asc' } : r))}
                    aria-label={`Sort ${s.dir === 'asc' ? 'ascending' : 'descending'} — select to switch`}>
                    <Icon name="chevronDown" size={15} className={s.dir === 'asc' ? 'rotate-180' : ''} />
                    {s.dir === 'asc' ? 'Ascending' : 'Descending'}
                  </Button>
                  <RemoveRowButton label="Remove sort" onClick={() => setSortBy(p => p.filter((_, j) => j !== i))} />
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-[12.5px] font-semibold text-muted">Definition preview</p>
              <pre className="px-4 py-3 rounded-control bg-page border border-rule text-ink text-xs font-mono overflow-auto max-h-44 leading-relaxed">
                {JSON.stringify(buildDefinition(), null, 2)}
              </pre>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ScheduleModal({ templateId, templateName, onClose, onToast }: {
  templateId: string; templateName: string;
  onClose: () => void; onToast: (msg: string, type: 'ok' | 'err') => void;
}) {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [freq, setFreq] = useState('WEEKLY');
  const [format, setFormat] = useState('CSV');
  const [recipients, setRecipients] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/reports/schedules?templateId=${templateId}`);
      setSchedules(Array.isArray(data) ? data : []);
    } catch { setSchedules([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!recipients.trim()) { onToast('Enter at least one recipient email', 'err'); return; }
    setCreating(true);
    try {
      await apiFetch('/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          templateId, frequency: freq, format,
          recipients: recipients.split(',').map(r => r.trim()).filter(Boolean),
        }),
      });
      onToast('Schedule created', 'ok');
      setRecipients('');
      refresh();
    } catch (e: any) { onToast(e.message || 'Create failed', 'err'); }
    finally { setCreating(false); }
  };

  const remove = async (schedId: string) => {
    setDeleting(schedId);
    try {
      await apiFetch(`/reports/schedules/${schedId}`, { method: 'DELETE' });
      onToast('Schedule deleted', 'ok');
      refresh();
    } catch (e: any) { onToast(e.message || 'Delete failed', 'err'); }
    finally { setDeleting(null); }
  };

  return (
    <Modal open onClose={onClose} title="Scheduled delivery" caption={templateName}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] font-semibold text-muted">Schedules</p>
          {loading ? <div className="h-14 rounded-control bg-pill animate-pulse" />
            : schedules.length === 0 ? <p className="text-[13px] text-muted">No schedules yet. Add one below.</p>
            : schedules.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-control border border-rule bg-page">
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={s.isActive ? 'ok' : 'neutral'}>{s.isActive ? 'Active' : 'Paused'}</Badge>
                    <span className="text-[13px] font-semibold text-ink">{sentence(s.frequency || '')}</span>
                    <Badge tone="neutral">{s.format}</Badge>
                  </div>
                  <span className="text-xs text-muted truncate max-w-xs">{s.recipients}</span>
                </div>
                <Button size="sm" variant="danger" onClick={() => remove(s.id)} disabled={deleting === s.id}>
                  {deleting === s.id ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            ))}
        </div>
        <div className="flex flex-col gap-3 pt-4 border-t border-rule">
          <p className="text-[15px] font-bold text-ink">Add a schedule</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Frequency">
              <Select value={freq} onChange={e => setFreq(e.target.value)}>
                {['DAILY', 'WEEKLY', 'MONTHLY'].map(f => <option key={f} value={f}>{sentence(f)}</option>)}
              </Select>
            </Field>
            <Field label="Format">
              <Select value={format} onChange={e => setFormat(e.target.value)}>
                {['CSV', 'XLSX', 'PDF'].map(f => <option key={f} value={f}>{f}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Recipients" help="Email addresses, separated by commas.">
            <Input value={recipients} onChange={e => setRecipients(e.target.value)} placeholder="hr@company.com, finance@company.com" />
          </Field>
          <div className="flex justify-end">
            <Button icon="mail" onClick={create} disabled={creating || !recipients.trim()} reason={!creating && !recipients.trim() ? 'Add a recipient email' : undefined}>
              {creating ? 'Creating…' : 'Create schedule'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── RPT-003 Phase 1 — Saved Reports ───────────────────────────────────────────
type SavedTemplate = {
  id: string; name: string; description?: string | null; category?: string | null;
  definition: any; ownerId: string; isShared: boolean;
  createdAt: string; updatedAt: string;
};

function SavedReportsSection({ onToast }: { onToast: (msg: string, type: 'ok' | 'err') => void }) {
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [scheduleModal, setScheduleModal] = useState<{ id: string; name: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const data = await apiFetch('/reports/templates');
      setTemplates(Array.isArray(data) ? data : []);
    } catch (e: any) {
      onToast(e.message || 'Failed to load saved reports', 'err');
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function run(t: SavedTemplate) {
    setBusy(`run-${t.id}`);
    try {
      const data = await apiFetch(`/reports/templates/${t.id}/run`, { method: 'POST' });
      onToast(`Ran "${t.name}" — ${data.rows?.length ?? 0} rows`, 'ok');
    } catch (e: any) {
      onToast(e.message || 'Run failed', 'err');
    } finally { setBusy(null); }
  }

  async function exportFormat(t: SavedTemplate, fmt: 'csv' | 'xlsx' | 'pdf') {
    setBusy(`${fmt}-${t.id}`);
    try {
      const res = await apiFetchRaw(`/reports/templates/${t.id}/export.${fmt}`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${t.name.replace(/[^\w.-]+/g, '_')}.${fmt}`; a.click();
      URL.revokeObjectURL(url);
      onToast(`Downloaded ${fmt.toUpperCase()}`, 'ok');
    } catch (e: any) {
      onToast(e.message || 'Export failed', 'err');
    } finally { setBusy(null); }
  }

  async function remove(t: SavedTemplate) {
    if (!confirm(`Delete report "${t.name}"?`)) return;
    setBusy(`del-${t.id}`);
    try {
      await apiFetch(`/reports/templates/${t.id}`, { method: 'DELETE' });
      onToast('Report deleted', 'ok');
      refresh();
    } catch (e: any) {
      onToast(e.message || 'Delete failed', 'err');
    } finally { setBusy(null); }
  }

  const actions = (t: SavedTemplate) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="secondary" onClick={() => run(t)} disabled={busy === `run-${t.id}`}>{busy === `run-${t.id}` ? 'Running…' : 'Run'}</Button>
      {(['csv', 'xlsx', 'pdf'] as const).map(fmt => (
        <Button key={fmt} size="sm" variant="ghost" onClick={() => exportFormat(t, fmt)} disabled={busy === `${fmt}-${t.id}`} aria-label={`Download ${t.name} as ${fmt.toUpperCase()}`}>
          {busy === `${fmt}-${t.id}` ? '…' : fmt.toUpperCase()}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={() => setScheduleModal({ id: t.id, name: t.name })}>Schedule</Button>
      <Button size="sm" variant="danger" onClick={() => remove(t)} disabled={busy === `del-${t.id}`}>{busy === `del-${t.id}` ? 'Deleting…' : 'Delete'}</Button>
    </div>
  );

  const columns: Column<SavedTemplate>[] = [
    {
      key: 'name', label: 'Report', width: 'minmax(0, 1.6fr)',
      render: t => (
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-ink truncate">{t.name}</span>
          {t.description && <span className="text-xs text-muted truncate">{t.description}</span>}
        </div>
      ),
    },
    { key: 'source', label: 'Data source', width: '140px', render: t => <span className="text-muted">{DS_LABELS[t.definition?.dataSource] ?? t.definition?.dataSource ?? '—'}</span> },
    { key: 'category', label: 'Category', width: '120px', render: t => <Badge tone="neutral">{t.category ? sentence(t.category) : 'Custom'}</Badge> },
    { key: 'updated', label: 'Updated', width: '100px', numeric: true, render: t => new Date(t.updatedAt).toLocaleDateString('en-SG') },
    { key: 'actions', label: <span className="sr-only">Actions</span>, width: '400px', render: actions },
  ];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="saved-reports-h">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="saved-reports-h" className="text-[18px] font-bold text-ink">Saved reports</h2>
          <p className="text-[13px] text-muted mt-0.5">Reports you have built. Run them, export them, or have them emailed on a schedule.</p>
        </div>
        <Button variant="secondary" icon="plus" onClick={() => setEditorOpen(true)}>New saved report</Button>
      </div>

      {loading ? (
        <Card padding="p-0"><Spinner label="Loading saved reports" /></Card>
      ) : (
        <DataTable
          aria-label="Saved reports"
          columns={columns}
          rows={templates}
          rowKey={t => t.id}
          rowHeight={60}
          mobileCard={t => (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-ink">{t.name}</span>
                <Badge tone="neutral">{t.category ? sentence(t.category) : 'Custom'}</Badge>
              </div>
              <p className="text-[13px] text-muted">{DS_LABELS[t.definition?.dataSource] ?? t.definition?.dataSource ?? '—'} · updated {new Date(t.updatedAt).toLocaleDateString('en-SG')}</p>
              {actions(t)}
            </div>
          )}
          empty={
            <EmptyState
              icon="file"
              title="No saved reports yet"
              description="Build a report once and run it whenever you need it, or schedule it."
              action={<Button variant="secondary" icon="plus" onClick={() => setEditorOpen(true)}>New saved report</Button>}
            />
          }
        />
      )}

      {editorOpen && (
        <ReportBuilderWizard
          onClose={() => setEditorOpen(false)}
          onSaved={() => { setEditorOpen(false); refresh(); }}
          onToast={onToast}
        />
      )}
      {scheduleModal && (
        <ScheduleModal
          templateId={scheduleModal.id}
          templateName={scheduleModal.name}
          onClose={() => setScheduleModal(null)}
          onToast={onToast}
        />
      )}
    </section>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const { toast } = useToast();
  const [running, setRunning] = useState<ReportKey | null>(null);
  const [lastRun, setLastRun] = useState<Record<string, string>>({});
  const [rptSort, setRptSort] = useState<{ col: 'name' | 'category' | 'freq'; dir: 'asc' | 'desc' }>({ col: 'category', dir: 'asc' });
  const [catFilter, setCatFilter] = useState<string>('all');
  const [runSelector, setRunSelector] = useState<{ key: ReportKey; title: string } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [leaveLiabilityOpen, setLeaveLiabilityOpen] = useState(false);
  const [ir8aOpen, setIr8aOpen] = useState(false);
  const [breakdownModal, setBreakdownModal] = useState<{ runId: string; period: string } | null>(null);
  const [workforceDashOpen, setWorkforceDashOpen] = useState(false);

  // Same messages as before; they now go through the shared toast (root layout).
  const showToast = (msg: string, type: 'ok' | 'err') => toast(msg, type === 'ok' ? 'ok' : 'danger');

  const execute = async (key: ReportKey, runId?: string, period?: string) => {
    if (key === 'payroll-breakdown') {
      setBreakdownModal({ runId: runId!, period: period! });
      setLastRun(p => ({ ...p, [key]: new Date().toLocaleDateString('en-SG') }));
      return;
    }
    setRunning(key);
    try {
      switch (key) {
        case 'cpf':       await runCpfForRun(runId!, period!); break;
        case 'iras':      setIr8aOpen(true); setRunning(null); return;
        case 'giro':      await runBankGiroForRun(runId!, period!); break;
        case 'leave':     setLeaveLiabilityOpen(true); setRunning(null); return;
        case 'workforce': setWorkforceDashOpen(true); setRunning(null); return;
        case 'attrition': setWorkforceDashOpen(true); setRunning(null); return;
        case 'mom':       await runMomReport(); break;
        case 'sdl':       await runSdlReport(); break;
        case 'variance':  await runPayrollVarianceReport(); break;
        case 'custom':    setCustomOpen(true); setRunning(null); return;
      }
      setLastRun(p => ({ ...p, [key]: new Date().toLocaleDateString('en-SG') }));
      showToast('Report generated — check your downloads', 'ok');
    } catch (e: any) {
      showToast(e.message || 'Report generation failed', 'err');
    } finally {
      setRunning(null);
    }
  };

  const handleRun = (r: ReportDef) => {
    if (r.key === 'custom') { setCustomOpen(true); return; }
    if (r.needsRunSelector) { setRunSelector({ key: r.key, title: r.runSelectorTitle! }); return; }
    execute(r.key);
  };

  const sortedReports = [...REPORTS].sort((a, b) => {
    const d = rptSort.dir === 'asc' ? 1 : -1;
    switch (rptSort.col) {
      case 'name':     return d * a.name.localeCompare(b.name);
      case 'category': return d * a.category.localeCompare(b.category);
      case 'freq':     return d * a.freq.localeCompare(b.freq);
      default: return 0;
    }
  });
  function toggleRptSort(col: typeof rptSort.col) {
    setRptSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  }

  const visibleReports = catFilter === 'all' ? sortedReports : sortedReports.filter(r => r.category === catFilter);

  return (
    <div className="flex flex-col gap-6 pb-10">
      <PageHeader
        title="Reports"
        subtitle="Statutory filings for MOM, IRAS and the CPF Board, workforce analytics, and reports you build yourself."
        actions={<Button icon="plus" onClick={() => setCustomOpen(true)}>Quick custom report</Button>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Reports available" value={REPORTS.length} />
        <Stat label="Statutory" value={REPORTS.filter(r => r.category === 'Statutory').length} note="MOM, IRAS and CPF filings" />
        <Stat label="Financial" value={REPORTS.filter(r => r.category === 'Financial').length} />
        <Stat label="Run this session" value={Object.keys(lastRun).length} />
      </div>

      {/* Report catalogue */}
      <section className="flex flex-col gap-3" aria-labelledby="catalogue-h">
        <h2 id="catalogue-h" className="text-[18px] font-bold text-ink">Report catalogue</h2>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <Tabs
            items={[
              { id: 'all', label: 'All', count: REPORTS.length },
              ...CATEGORIES.map(c => ({ id: c, label: c, count: REPORTS.filter(r => r.category === c).length })),
            ]}
            active={catFilter}
            onChange={setCatFilter}
            className="lg:flex-1"
          />
          <div className="flex items-center gap-2">
            <Select aria-label="Sort reports by" value={rptSort.col} onChange={e => toggleRptSort(e.target.value as typeof rptSort.col)} className="w-44">
              <option value="category">Sort by category</option>
              <option value="name">Sort by name</option>
              <option value="freq">Sort by frequency</option>
            </Select>
            <Button variant="secondary" onClick={() => toggleRptSort(rptSort.col)} aria-label={`Order: ${rptSort.dir === 'asc' ? 'A to Z' : 'Z to A'} — select to reverse`}>
              <Icon name="chevronDown" size={15} className={rptSort.dir === 'asc' ? 'rotate-180' : ''} />
              {rptSort.dir === 'asc' ? 'A–Z' : 'Z–A'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleReports.map(r => (
            <Card key={r.key} padding="p-5" className="gap-4">
              <div className="flex items-start gap-3.5">
                <span className="flex items-center justify-center w-10 h-10 rounded-control bg-tint text-accent shrink-0" aria-hidden="true">
                  <Icon name={r.icon} size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[15px] font-bold text-ink leading-snug">{r.name}</h3>
                  <p className="text-[13px] text-muted mt-0.5">{r.category} · {r.freq}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 mt-auto pt-3 border-t border-rule">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  {r.badge && <Badge tone={REPORT_BADGE_TONE[r.badge] ?? 'neutral'}>{r.badge}</Badge>}
                  <span className="text-xs text-muted tabular-nums">{lastRun[r.key] ? `Last run ${lastRun[r.key]}` : 'Not run this session'}</span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => handleRun(r)} disabled={running === r.key}>
                  {running === r.key ? (
                    <>
                      <span className="w-3 h-3 border-2 border-rule border-t-accent animate-spin rounded-full" aria-hidden="true" />
                      Generating…
                    </>
                  ) : 'Run'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* RPT-003 Phase 1 — Saved Reports */}
      <SavedReportsSection onToast={showToast} />

      {/* Run Selector Modal */}
      {runSelector && (
        <RunSelectorModal
          title={runSelector.title}
          onSelect={(runId, period) => { setRunSelector(null); execute(runSelector.key, runId, period); }}
          onClose={() => setRunSelector(null)}
        />
      )}

      {/* Custom Report Modal */}
      {customOpen && (
        <CustomReportModal
          onClose={() => setCustomOpen(false)}
          onToast={showToast}
        />
      )}

      {/* Leave Liability Modal */}
      {leaveLiabilityOpen && (
        <LeaveLiabilityModal
          onClose={() => setLeaveLiabilityOpen(false)}
          onToast={showToast}
        />
      )}

      {/* IR8A Modal */}
      {ir8aOpen && (
        <Ir8aModal
          onClose={() => setIr8aOpen(false)}
          onToast={showToast}
        />
      )}

      {/* Payroll Breakdown Modal */}
      {breakdownModal && (
        <PayrollBreakdownModal
          runId={breakdownModal.runId}
          period={breakdownModal.period}
          onClose={() => setBreakdownModal(null)}
          onToast={showToast}
        />
      )}

      {/* Workforce Dashboard Modal */}
      {workforceDashOpen && (
        <WorkforceDashboardModal
          onClose={() => setWorkforceDashOpen(false)}
          onToast={showToast}
        />
      )}
    </div>
  );
}
