'use client';

import { useState, useEffect } from 'react';
import { apiFetch, apiFetchRaw } from '@/lib/api';

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

function Toast({ msg, type, onClose }: { msg: string; type: 'ok' | 'err'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-6 duration-300">
      <div className={`px-8 py-4   flex items-center gap-3 ${type === 'ok' ? 'bg-shadow border border-shadow' : 'bg-ink border border-ink'}`}>
        <div className={`w-2 h-2  ${type === 'ok' ? 'bg-accent' : 'bg-ink'}`} />
        <span className="text-[11px] font-black text-paper uppercase tracking-widest">{msg}</span>
        <button onClick={onClose} className="ml-4 text-paper/50 hover:text-paper text-xs">✕</button>
      </div>
    </div>
  );
}

// ── Run selector modal (for payroll-linked reports) ───────────────────────────
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
      <div className="w-full max-w-md bg-paper flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
          <div>
            <h2 className="text-base font-black text-ink tracking-tighter">{title}</h2>
            <p className="eyebrow-tight mt-0.5">Select a payroll run</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all">✕</button>
        </div>
        <div className="p-6 flex flex-col gap-2 max-h-80 overflow-y-auto">
          {loading ? (
            [1,2,3].map(i => <div key={i} className="h-12 bg-page animate-pulse" />)
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted font-bold text-center py-8">No payroll runs found</p>
          ) : runs.map(r => (
            <button key={r.id} onClick={() => onSelect(r.id, r.period)}
              className="flex items-center justify-between px-5 py-3.5 bg-page border border-rule hover:border-accent hover:bg-page transition-all text-left">
              <div>
                <span className="text-sm font-black text-ink">{r.period}</span>
                <span className="ml-3 label-form">{r.runType}</span>
              </div>
              <span className={`text-[9px] font-black px-2.5 py-1  uppercase tracking-widest border ${
                r.status === 'FINALISED' ? 'bg-page text-accent border-accent' :
                r.status === 'APPROVED' ? 'bg-page text-accent border-accent' :
                'bg-page text-ink border-highlight'
              }`}>{r.status}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
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

  const fmt = (v: number | null | undefined) => v == null ? '—' : `$${Number(v).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const byDept: Record<string, any[]> = data?.rows?.reduce((acc: Record<string, any[]>, r: any) => {
    if (!acc[r.department]) acc[r.department] = [];
    acc[r.department].push(r);
    return acc;
  }, {}) ?? {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
      <div className="w-full max-w-5xl bg-paper flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between px-8 py-5 border-b border-rule flex-shrink-0">
          <div>
            <h2 className="text-base font-black text-ink tracking-tighter">Leave Liability Report</h2>
            <p className="eyebrow-tight mt-0.5">Accrued leave liability for finance accrual reporting</p>
          </div>
          <div className="flex items-center gap-3">
            {data && <button onClick={handleCsv} className="px-5 py-2 bg-accent text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent transition-all">Download CSV</button>}
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all">✕</button>
          </div>
        </div>
        <div className="flex items-center gap-4 px-8 py-4 border-b border-rule bg-page flex-shrink-0">
          <label className="text-[10px] font-black text-muted uppercase tracking-widest">Year</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={2020} max={2030}
            className="w-28 px-3 py-2 bg-paper border border-rule text-sm font-bold text-ink outline-none focus:border-accent" />
          <button onClick={generate} disabled={loading}
            className="px-6 py-2 bg-accent text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent disabled:opacity-50 transition-all flex items-center gap-2">
            {loading ? <><span className="w-3 h-3 border-2 border-paper/30 border-t-paper animate-spin rounded-full" />Generating…</> : 'Generate'}
          </button>
        </div>
        {data && (
          <div className="flex flex-wrap gap-3 px-8 py-4 border-b border-rule flex-shrink-0">
            {[
              { label: 'Total Liability', value: fmt(data.totalLiability), color: 'text-accent' },
              { label: 'Headcount', value: String(data.headcount), color: 'text-ink' },
              { label: 'Year', value: String(data.year), color: 'text-accent' },
              { label: 'Generated', value: new Date(data.generatedAt).toLocaleDateString('en-SG'), color: 'text-muted' },
            ].map(s => (
              <div key={s.label} className="px-4 py-2 bg-paper border border-rule text-center">
                <p className="text-[8px] font-black text-muted uppercase tracking-widest">{s.label}</p>
                <p className={`text-xs font-black ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>
        )}
        <div className="overflow-auto flex-1">
          {!data ? (
            <div className="flex items-center justify-center h-40 text-muted text-sm font-bold">{loading ? 'Loading…' : 'Select year and click Generate'}</div>
          ) : data.rows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted text-sm font-bold">No data for {year}</div>
          ) : (
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="sticky top-0 bg-page border-b border-rule label-form">
                <tr>{['Employee', 'Leave Type', 'Entitled', 'C/F', 'Used', 'Pending', 'Unused', 'Daily Rate', 'Liability'].map(h => <th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {Object.entries(byDept).map(([dept, rows]: [string, any[]]) => (
                  <>
                    <tr key={`hdr-${dept}`} className="bg-page">
                      <td colSpan={9} className="px-4 py-2 font-black text-ink text-[10px] uppercase tracking-widest">{dept}</td>
                    </tr>
                    {rows.map((r: any, i: number) => (
                      <tr key={`${r.employeeId}-${r.leaveCode}-${i}`} className="hover:bg-page transition-colors">
                        <td className="px-4 py-3"><p className="font-black text-ink whitespace-nowrap">{r.fullName}</p><p className="text-[9px] text-muted font-bold">{r.employeeCode}</p></td>
                        <td className="px-4 py-3 font-bold text-ink whitespace-nowrap">{r.leaveType}</td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{r.entitledDays}</td>
                        <td className="px-4 py-3 text-right font-mono text-muted">{r.carryForward ?? 0}</td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{r.usedDays}</td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{r.pendingDays ?? 0}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-ink">{r.unusedDays}</td>
                        <td className="px-4 py-3 text-right font-mono text-muted">{fmt(r.dailyRate)}</td>
                        <td className="px-4 py-3 text-right font-mono font-black text-accent">{fmt(r.liability)}</td>
                      </tr>
                    ))}
                    <tr key={`sub-${dept}`} className="bg-page">
                      <td colSpan={8} className="px-4 py-2 text-right text-[9px] font-black text-muted uppercase tracking-widest">Dept Total</td>
                      <td className="px-4 py-2 text-right font-mono font-black text-accent">{fmt(data.byDepartment[dept])}</td>
                    </tr>
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
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

  const fmt = (v: number | null | undefined) => v == null ? '—' : `$${Number(v).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
      <div className="w-full max-w-5xl bg-paper flex flex-col overflow-hidden max-h-[90vh]">
        <div className="flex items-center justify-between px-8 py-5 border-b border-rule flex-shrink-0">
          <div>
            <h2 className="text-base font-black text-ink tracking-tighter">IR8A Annual Filing — {year}</h2>
            <p className="eyebrow-tight mt-0.5">IRAS AIS submission data · deadline 1 March {year + 1}</p>
          </div>
          <div className="flex items-center gap-3">
            {data && data.length > 0 && (
              <button onClick={downloadFlatFile}
                className="px-5 py-2 bg-shadow text-paper text-[9px] font-black uppercase tracking-widest hover:bg-shadow transition-all">
                Download Flat File
              </button>
            )}
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all">✕</button>
          </div>
        </div>
        <div className="flex items-center gap-4 px-8 py-4 border-b border-rule bg-page flex-shrink-0">
          <label className="text-[10px] font-black text-muted uppercase tracking-widest">Year of Assessment</label>
          <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} min={2020} max={2030}
            className="w-28 px-3 py-2 bg-paper border border-rule text-sm font-bold text-ink outline-none focus:border-accent" />
          <button onClick={generate} disabled={loading}
            className="px-6 py-2 bg-accent text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent disabled:opacity-50 transition-all flex items-center gap-2">
            {loading ? <><span className="w-3 h-3 border-2 border-paper/30 border-t-paper animate-spin rounded-full" />Generating…</> : 'Generate'}
          </button>
          <span className="ml-auto text-[9px] font-black text-ink uppercase tracking-widest bg-page border border-highlight px-3 py-1.5 ">
            IRAS Deadline: 1 Mar {year + 1}
          </span>
        </div>
        <div className="overflow-auto flex-1">
          {!data ? (
            <div className="flex items-center justify-center h-40 text-muted text-sm font-bold">{loading ? 'Loading…' : 'Select year and click Generate'}</div>
          ) : data.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted text-sm font-bold">No finalised payslips for {year}</div>
          ) : (
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="sticky top-0 bg-page border-b border-rule label-form">
                <tr>{['Employee', 'NRIC', 'Employment Income', 'Emp CPF', 'Emplr CPF', 'AW Income', 'Other Taxable'].map(h => <th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {data.map((emp: any, i: number) => (
                  <tr key={emp.employeeId ?? i} className="hover:bg-page transition-colors">
                    <td className="px-4 py-3"><p className="font-black text-ink whitespace-nowrap">{emp.fullName}</p><p className="text-[9px] text-muted font-bold">{emp.employeeId}</p></td>
                    <td className="px-4 py-3 font-mono text-ink tracking-wider">{emp.nric ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-ink">{fmt(emp.employmentIncome)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent">{fmt(emp.employeeCpf)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent">{fmt(emp.employerCpf)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent">{emp.awIncome > 0 ? fmt(emp.awIncome) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted">{emp.otherTaxableIncome > 0 ? fmt(emp.otherTaxableIncome) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
      <div className="w-full max-w-6xl bg-paper flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-rule flex-shrink-0">
          <div>
            <h2 className="text-base font-black text-ink tracking-tighter">Payroll Breakdown — {period}</h2>
            <p className="eyebrow-tight mt-0.5">All payroll calculations per employee (Singapore MOM/CPF/EA)</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleCsv} disabled={loading || rows.length === 0}
              className="px-5 py-2 bg-accent text-paper text-[9px] font-black uppercase tracking-widest hover:bg-accent disabled:opacity-50 transition-all">
              Download CSV
            </button>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all">✕</button>
          </div>
        </div>

        {/* Summary pills */}
        {!loading && rows.length > 0 && (() => {
          const tot = rows.reduce((a, r) => ({
            gross: a.gross + r.grossPay,
            net: a.net + r.netPay,
            empCpf: a.empCpf + r.employeeCpf,
            emplrCpf: a.emplrCpf + r.employerCpf,
            sdl: a.sdl + r.sdl,
          }), { gross: 0, net: 0, empCpf: 0, emplrCpf: 0, sdl: 0 });
          return (
            <div className="flex flex-wrap gap-3 px-8 py-4 border-b border-rule bg-page flex-shrink-0">
              {[
                { label: 'Total Gross', value: fmt(tot.gross), color: 'text-ink' },
                { label: 'Total Net', value: fmt(tot.net), color: 'text-accent' },
                { label: 'Employee CPF', value: fmt(tot.empCpf), color: 'text-accent' },
                { label: 'Employer CPF', value: fmt(tot.emplrCpf), color: 'text-accent' },
                { label: 'SDL', value: fmt(tot.sdl), color: 'text-ink' },
                { label: 'Employees', value: String(rows.length), color: 'text-ink' },
              ].map(s => (
                <div key={s.label} className="px-4 py-2 bg-paper border border-rule text-center">
                  <p className="text-[8px] font-black text-muted uppercase tracking-widest">{s.label}</p>
                  <p className={`text-xs font-black ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Table */}
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-muted text-sm font-bold">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted text-sm font-bold">No payslips found for this run</div>
          ) : (
            <table className="w-full text-left border-collapse text-[11px]">
              <thead className="sticky top-0 bg-page border-b border-rule label-form">
                <tr>
                  {['Code', 'Employee', 'Basic Salary (OW)', 'Gross Pay', 'Emp CPF', 'Emplr CPF', 'SDL', 'FWL', 'NPL Days', 'NPL Deduct', 'Govt Days', 'Govt Amt', 'Net Pay', 'YTD Gross', 'YTD Emp CPF'].map(h => (
                    <th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-page transition-colors">
                    <td className="px-4 py-3 font-black text-muted whitespace-nowrap">{r.employeeCode}</td>
                    <td className="px-4 py-3 font-bold text-ink whitespace-nowrap">{r.employeeName}</td>
                    <td className="px-4 py-3 text-right font-mono text-ink">{fmt(r.basicSalary)}</td>
                    <td className="px-4 py-3 text-right font-mono text-ink font-bold">{fmt(r.grossPay)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent">{fmt(r.employeeCpf)}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent">{fmt(r.employerCpf)}</td>
                    <td className="px-4 py-3 text-right font-mono text-ink">{fmt(r.sdl)}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted">{r.fwl > 0 ? fmt(r.fwl) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-ink">{r.nplDays > 0 ? r.nplDays : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-ink">{r.nplDeduction > 0 ? fmt(r.nplDeduction) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent">{r.govtPaidDays > 0 ? r.govtPaidDays : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono text-accent">{r.govtPaidAmount > 0 ? fmt(r.govtPaidAmount) : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono font-black text-accent">{fmt(r.netPay)}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted">{fmt(r.ytdGross)}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted">{fmt(r.ytdEmployeeCpf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Report definitions ────────────────────────────────────────────────────────
type ReportKey = 'cpf' | 'iras' | 'giro' | 'leave' | 'workforce' | 'attrition' | 'mom' | 'sdl' | 'variance' | 'payroll-breakdown' | 'custom';

interface ReportDef {
  key: ReportKey;
  name: string;
  category: string;
  icon: string;
  freq: string;
  badge: string;
  needsRunSelector?: boolean;
  runSelectorTitle?: string;
}

const REPORTS: ReportDef[] = [
  { key: 'cpf',               name: 'CPF / SDL / FWL Statutory Report',          category: 'Statutory',  icon: '◆', freq: 'Monthly',    badge: 'MOM Required',  needsRunSelector: true, runSelectorTitle: 'Select Payroll Run — CPF e-Submit' },
  { key: 'iras',              name: 'IRAS AIS / IR8A Annual Filing',              category: 'Statutory',  icon: '◆', freq: 'Annual',     badge: 'IRAS Required' },
  { key: 'giro',              name: 'Bank GIRO Reconciliation',                   category: 'Financial',  icon: '◫', freq: 'Monthly',    badge: '',              needsRunSelector: true, runSelectorTitle: 'Select Payroll Run — Bank GIRO' },
  { key: 'payroll-breakdown', name: 'Payroll Calculation Breakdown',              category: 'Financial',  icon: '◫', freq: 'Per Run',    badge: 'Full Detail',   needsRunSelector: true, runSelectorTitle: 'Select Payroll Run — Breakdown Report' },
  { key: 'leave',             name: 'Leave Liability Report',                     category: 'Workforce',  icon: '◌', freq: 'Monthly',    badge: '' },
  { key: 'workforce',         name: 'Executive Workforce Dashboard',              category: 'Analytics',  icon: '▣', freq: 'Real-time',  badge: 'SA Only' },
  { key: 'attrition',         name: 'Attrition & Workforce Analytics',            category: 'Analytics',  icon: '▣', freq: 'Quarterly',  badge: '' },
  { key: 'mom',               name: 'MOM Headcount Report',                       category: 'Statutory',  icon: '◆', freq: 'Annual',     badge: 'MOM Required' },
  { key: 'sdl',               name: 'Training & SDL Analytics',                   category: 'Training',   icon: '◑', freq: 'Monthly',    badge: '' },
  { key: 'variance',          name: 'Payroll Variance Report',                    category: 'Financial',  icon: '◫', freq: 'Per Run',    badge: '' },
  { key: 'custom',            name: 'Custom Report Builder',                      category: 'Analytics',  icon: '▤', freq: 'On-demand',  badge: 'Premium' },
];

const CATEGORY_COLORS: Record<string, string> = {
  Statutory: 'bg-page text-ink border-ink',
  Financial:  'bg-page text-accent border-accent',
  Workforce:  'bg-page text-accent border-accent',
  Analytics:  'bg-page text-accent border-accent',
  Training:   'bg-page text-ink border-highlight',
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

  if (loading || !data) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-shadow backdrop-">
        <div className="bg-paper p-12 flex flex-col items-center gap-4 ">
          <div className="w-8 h-8 border-4 border-accent border-t-accent animate-spin rounded-full" />
          <p className="text-sm font-black text-muted uppercase tracking-widest">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  const { kpis, trend, byDepartment, byEmploymentType, byCitizenship } = data;

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
  // Six chart series from the token set. A bar chart cannot use the fill/outline
  // trick the status chips use, so the ramp mixes each token toward the paper
  // ground to get distinguishable steps. SVG `fill` takes CSS variables, so
  // these follow the theme (including dark mode) rather than freezing a hex.
  const csColors: Record<string, string> = {
    SC:      'var(--accent)',
    PR:      'var(--highlight)',
    EP:      'var(--ink)',
    S_PASS:  'color-mix(in srgb, var(--accent) 55%, var(--paper))',
    WP:      'color-mix(in srgb, var(--ink) 45%, var(--paper))',
    OTHER:   'var(--muted)',
  };

  // ── OT helpers ─────────────────────────────────────────────────────────────
  const otEntries = otData ? Object.entries(otData.totals).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  const maxOt     = Math.max(...otEntries.map(e => e[1]), 1);
  // Current month OT = last index in each dept array
  const otCurrentMonth = otData
    ? Object.fromEntries(Object.entries(otData.byDepartment).map(([d, arr]) => [d, arr[arr.length - 1] ?? 0]))
    : {};

  // ── Training helpers ───────────────────────────────────────────────────────
  const catEntries = trainData
    ? [...(trainData.byCategory || [])].sort((a, b) => b._count.id - a._count.id).slice(0, 6)
    : [];
  const maxCat = Math.max(...catEntries.map(c => c._count.id), 1);

  const kpiCards = [
    { label: 'Total Headcount',     value: kpis.totalHeadcount,        sub: `${kpis.activeHeadcount} active`,           color: 'text-ink' },
    { label: 'Hires MTD',           value: kpis.hiresMtd,              sub: 'this month',                               color: 'text-accent' },
    { label: 'Terminations MTD',    value: kpis.termsMtd,              sub: 'this month',                               color: 'text-ink' },
    { label: '12m Attrition Rate',  value: `${kpis.attritionRate12m}%`, sub: `${kpis.terminations12m} exits in 12m`,   color: 'text-accent' },
  ];

  const refreshLabel = secAgo < 60 ? 'just now' : secAgo < 3600 ? `${Math.floor(secAgo / 60)}m ago` : `${Math.floor(secAgo / 3600)}h ago`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop- print:p-0 print:bg-transparent print:inset-auto print:relative">
      <div className="w-full max-w-5xl bg-paper flex flex-col overflow-hidden max-h-[92vh] print: print:rounded-none print:max-h-none">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-rule flex-shrink-0 print:border-rule">
          <div>
            <h2 className="text-base font-black text-ink tracking-tighter">Executive Workforce Dashboard</h2>
            <p className="text-[9px] font-black text-muted uppercase tracking-[0.3em] mt-0.5">
              Auto-refresh every 5 min · {lastRefreshed ? `Updated ${refreshLabel}` : 'Loading…'}
              {refreshing && <span className="ml-2 inline-block w-2.5 h-2.5 border-2 border-rule border-t-rule animate-spin align-middle rounded-full" />}
            </p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button onClick={() => loadAll(true)} disabled={refreshing}
              className="px-4 py-2 bg-page text-ink text-[9px] font-black uppercase tracking-widest hover:bg-rule disabled:opacity-50 transition-all">
              ↺ Refresh
            </button>
            <button onClick={() => window.print()} className="px-5 py-2 bg-shadow text-paper text-[9px] font-black uppercase tracking-widest hover:bg-shadow transition-all">Print / PDF</button>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all">✕</button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-8 flex flex-col gap-8">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {kpiCards.map(k => (
              <div key={k.label} className="bg-page p-5 border border-rule flex flex-col gap-1">
                <span className="text-[9px] font-black text-muted uppercase tracking-widest">{k.label}</span>
                <span className={`text-3xl font-black tracking-tighter ${k.color}`}>{k.value}</span>
                <span className="text-[10px] text-muted font-bold">{k.sub}</span>
              </div>
            ))}
          </div>

          {/* 12-month Hires vs Terminations trend */}
          <div className="bg-paper border border-rule p-6">
            <h3 className="text-[10px] font-black text-muted uppercase tracking-widest mb-4">12-Month Hires vs Terminations</h3>
            <svg viewBox={`0 0 ${chartW} ${chartH + 30}`} width="100%" className="overflow-visible">
              {[0, 0.25, 0.5, 0.75, 1].map(f => (
                <line key={f} x1={30} y1={chartH * (1 - f)} x2={chartW} y2={chartH * (1 - f)} stroke="#f1f5f9" strokeWidth="1" />
              ))}
              {trend.map((m, i) => {
                const x = 30 + i * barGroupW + barPad;
                const hH = Math.round((m.hires / maxTrend) * chartH);
                const tH = Math.round((m.terminations / maxTrend) * chartH);
                return (
                  <g key={m.label}>
                    <rect x={x}           y={chartH - hH} width={barW} height={hH} rx="2" fill="#10b981" opacity={0.85} />
                    <rect x={x + barW + 1} y={chartH - tH} width={barW} height={tH} rx="2" fill="#ef4444" opacity={0.85} />
                    <text x={x + barW} y={chartH + 16} textAnchor="middle" fontSize="8" fill="var(--muted)" fontWeight="700">{m.label}</text>
                  </g>
                );
              })}
            </svg>
            <div className="flex gap-5 mt-1">
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-accent block" /><span className="text-[9px] font-black text-muted uppercase tracking-widest">Hires</span></div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-ink block" /><span className="text-[9px] font-black text-muted uppercase tracking-widest">Terminations</span></div>
            </div>
          </div>

          {/* Headcount breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-paper border border-rule p-6 flex flex-col gap-3">
              <h3 className="text-[10px] font-black text-muted uppercase tracking-widest">By Department</h3>
              {deptEntries.map(([dept, count]) => (
                <div key={dept} className="flex flex-col gap-1">
                  <div className="flex justify-between">
                    <span className="text-[10px] font-black text-ink truncate max-w-[80%]">{dept}</span>
                    <span className="text-[10px] font-black text-ink">{count}</span>
                  </div>
                  <div className="h-1.5 bg-page overflow-hidden">
                    <div className="h-full bg-accent transition-all" style={{ width: `${(count / maxDept) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-paper border border-rule p-6 flex flex-col gap-3">
              <h3 className="text-[10px] font-black text-muted uppercase tracking-widest">Employment Type</h3>
              {etEntries.map(([type, count]) => {
                const total = etEntries.reduce((s, e) => s + e[1], 0) || 1;
                const pct   = Math.round((count / total) * 100);
                return (
                  <div key={type} className="flex flex-col gap-1">
                    <div className="flex justify-between">
                      <span className="text-[10px] font-black text-ink">{type.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] font-black text-muted">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-page overflow-hidden">
                      <div className="h-full bg-accent " style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="bg-paper border border-rule p-6 flex flex-col gap-3">
              <h3 className="text-[10px] font-black text-muted uppercase tracking-widest">Citizenship / Pass</h3>
              {csEntries.map(([key, count]) => {
                const pct   = Math.round((count / totalCiti) * 100);
                const color = csColors[key] || 'var(--muted)';
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <div className="flex justify-between">
                      <span className="text-[10px] font-black text-ink">{key.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] font-black text-muted">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-page overflow-hidden">
                      <div className="h-full " style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* OT by department + Training completion */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* OT by department */}
            <div className="bg-paper border border-rule p-6 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-black text-muted uppercase tracking-widest">OT Hours by Department</h3>
                {otData && <span className="text-[8px] font-black text-muted uppercase tracking-widest">6-month total · this month highlighted</span>}
              </div>
              {!otData ? (
                <p className="text-[10px] text-muted font-bold py-4 text-center">No OT data available</p>
              ) : otEntries.length === 0 ? (
                <p className="text-[10px] text-muted font-bold py-4 text-center">No OT recorded in this period</p>
              ) : otEntries.map(([dept, total]) => {
                const thisMo = otCurrentMonth[dept] ?? 0;
                const pct    = Math.round((total / maxOt) * 100);
                const moPct  = total > 0 ? Math.round((thisMo / total) * 100) : 0;
                return (
                  <div key={dept} className="flex flex-col gap-1">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[10px] font-black text-ink truncate max-w-[60%]">{dept}</span>
                      <span className="text-[10px] font-black text-muted">
                        <span className="text-ink">{thisMo}h</span>
                        <span className="text-muted mx-1">/</span>
                        {total}h total
                      </span>
                    </div>
                    <div className="h-2 bg-page overflow-hidden">
                      <div className="h-full bg-page relative" style={{ width: `${pct}%` }}>
                        <div className="h-full bg-highlight absolute left-0 top-0" style={{ width: `${moPct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Training completion */}
            <div className="bg-paper border border-rule p-6 flex flex-col gap-4">
              <h3 className="text-[10px] font-black text-muted uppercase tracking-widest">Training Completion</h3>
              {!trainData ? (
                <p className="text-[10px] text-muted font-bold py-4 text-center">No training data available</p>
              ) : (
                <>
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col items-center">
                      <span className={`text-4xl font-black tracking-tighter ${trainData.completionRate >= 80 ? 'text-accent' : trainData.completionRate >= 50 ? 'text-ink' : 'text-ink'}`}>
                        {trainData.completionRate}%
                      </span>
                      <span className="text-[9px] font-black text-muted uppercase tracking-widest mt-0.5">Completion Rate</span>
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                      {[
                        { label: 'Completed',   value: trainData.completed,        color: 'bg-accent' },
                        { label: 'In Progress', value: trainData.inProgress,       color: 'bg-highlight' },
                        { label: 'Total',       value: trainData.totalEnrollments, color: 'bg-rule' },
                      ].map(s => (
                        <div key={s.label} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2  ${s.color}`} />
                            <span className="text-[9px] font-black text-muted uppercase tracking-widest">{s.label}</span>
                          </div>
                          <span className="text-[10px] font-black text-ink">{s.value}</span>
                        </div>
                      ))}
                      {trainData.mandatory > 0 && (
                        <div className="mt-1 px-2 py-1 bg-page border border-ink ">
                          <span className="text-[8px] font-black text-ink uppercase tracking-widest">{trainData.mandatory} mandatory programme{trainData.mandatory !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {catEntries.length > 0 && (
                    <div className="flex flex-col gap-2 pt-2 border-t border-rule">
                      <span className="text-[9px] font-black text-muted uppercase tracking-widest">Programmes by Category</span>
                      {catEntries.map(c => {
                        const pct = Math.round((c._count.id / maxCat) * 100);
                        return (
                          <div key={c.category} className="flex flex-col gap-0.5">
                            <div className="flex justify-between">
                              <span className="text-[9px] font-black text-ink">{c.category}</span>
                              <span className="text-[9px] font-black text-muted">{c._count.id}</span>
                            </div>
                            <div className="h-1 bg-page overflow-hidden">
                              <div className="h-full bg-accent " style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
      <div className="w-full max-w-lg bg-paper flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-b border-rule">
          <div>
            <h2 className="text-base font-black text-ink tracking-tighter">Custom Report Builder</h2>
            <p className="eyebrow-tight mt-0.5">Pick dataset and fields → download CSV</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page transition-all">✕</button>
        </div>
        <div className="p-8 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest">Dataset</label>
            <select value={dataset} onChange={e => { setDataset(e.target.value); setFields([]); }}
              className="w-full px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent">
              <option value="employees">Employees</option>
              <option value="leave">Leave Applications</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest">Fields to Include</label>
            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
              {DATASETS[dataset].map(f => (
                <label key={f} className={`flex items-center gap-2 px-3 py-2.5  cursor-pointer border transition-all ${fields.includes(f) ? 'bg-page border-accent text-accent' : 'bg-page border-rule text-ink hover:border-rule'}`}>
                  <input type="checkbox" checked={fields.includes(f)} onChange={() => toggle(f)} className="w-3.5 h-3.5 accent-accent" />
                  <span className="text-[10px] font-black uppercase tracking-widest">{f}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-8 py-5 border-t border-rule bg-page">
          <button onClick={onClose} className="flex-1 py-3 text-[10px] font-black text-muted border border-rule hover:bg-page uppercase tracking-widest">Cancel</button>
          <button onClick={handleRun} disabled={running || fields.length === 0}
            className="flex-1 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent disabled:opacity-50 uppercase tracking-widest transition-all">
            {running ? 'Generating…' : `Download CSV (${fields.length} fields)`}
          </button>
        </div>
      </div>
    </div>
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
  employees: 'Employees', payrollRuns: 'Payroll Runs',
  leaveApplications: 'Leave Applications', attendance: 'Attendance', claims: 'Claims',
};
const FILTER_OPS_META = [
  { op: 'eq', label: '=' }, { op: 'ne', label: '≠' },
  { op: 'gt', label: '>' }, { op: 'lt', label: '<' },
  { op: 'gte', label: '≥' }, { op: 'lte', label: '≤' },
  { op: 'contains', label: 'contains' }, { op: 'in', label: 'in (csv)' },
];
const AGG_OPS_META = [
  { op: 'count', label: 'Count' }, { op: 'sum', label: 'Sum' },
  { op: 'avg', label: 'Avg' }, { op: 'min', label: 'Min' }, { op: 'max', label: 'Max' },
];
function nanoid6() { return Math.random().toString(36).slice(2, 8); }

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
      <div className="w-full max-w-3xl bg-paper flex flex-col overflow-hidden max-h-[92vh]">
        <div className="flex items-center justify-between px-8 py-5 border-b border-rule">
          <div>
            <h2 className="text-base font-black text-ink tracking-tighter">New Saved Report</h2>
            <div className="flex items-center gap-2 mt-1.5">
              {([1, 2, 3] as const).map(s => (
                <div key={s} className={`h-1.5 w-12  transition-all ${s <= step ? 'bg-accent' : 'bg-rule'}`} />
              ))}
              <span className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">Step {step} of 3</span>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-6">
          {step === 1 && (
            <>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Report Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Active Headcount by Department"
                  className="px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Category</label>
                  <select value={category} onChange={e => setCategory(e.target.value)}
                    className="px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent">
                    {['WORKFORCE', 'FINANCIAL', 'LEAVE', 'TRAINING', 'COMPLIANCE', 'CUSTOM'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Description</label>
                  <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional"
                    className="px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent" />
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Data Source</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(DS_LABELS).map(([ds, lbl]) => (
                    <button key={ds} onClick={() => { setDataSource(ds); setSelectedFields([]); setGroupBy(''); }}
                      className={`px-4 py-3  border-2 text-left transition-all ${dataSource === ds ? 'border-accent bg-page' : 'border-rule bg-page hover:border-rule'}`}>
                      <p className={`text-[10px] font-black uppercase tracking-wide ${dataSource === ds ? 'text-accent' : 'text-ink'}`}>{lbl}</p>
                      <p className="text-[8px] text-muted mt-0.5 font-bold uppercase">{(catalog[ds] || []).length || '—'} fields</p>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex gap-3">
                {(['fields', 'grouped'] as ReportMode[]).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 py-3  border-2 font-black text-[10px] uppercase tracking-widest transition-all ${mode === m ? 'border-accent bg-page text-accent' : 'border-rule text-muted hover:border-rule'}`}>
                    {m === 'fields' ? 'Field List (rows)' : 'Grouped Summary'}
                  </button>
                ))}
              </div>

              {mode === 'fields' && (
                <>
                  <p className="text-[10px] font-bold text-muted -mt-2">Select the columns to include. No aggregation applied.</p>
                  <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                    {fields.map(f => (
                      <label key={f.key} className={`flex items-center gap-2.5 px-3 py-2.5  cursor-pointer border transition-all ${selectedFields.includes(f.key) ? 'bg-page border-accent text-accent' : 'bg-page border-rule text-ink hover:border-rule'}`}>
                        <input type="checkbox" checked={selectedFields.includes(f.key)} onChange={() => toggleField(f.key)} className="w-3.5 h-3.5 accent-accent" />
                        <div className="min-w-0">
                          <span className="text-[10px] font-black uppercase tracking-widest block truncate">{f.label}</span>
                          <span className="text-[8px] font-bold text-muted uppercase">{f.type}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {mode === 'grouped' && (
                <>
                  <p className="text-[10px] font-bold text-muted -mt-2">Group by a single field and compute aggregations per group.</p>
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-black text-muted uppercase tracking-widest">Group By</label>
                    <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
                      className="px-4 py-3 bg-page border border-rule text-sm font-bold text-ink outline-none focus:border-accent">
                      <option value="">— pick a field —</option>
                      {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-muted uppercase tracking-widest">Aggregations</label>
                      <button onClick={() => setAggregations(p => [...p, { id: nanoid6(), field: '', op: 'count', as: '' }])}
                        className="text-[9px] font-black text-accent hover:text-accent uppercase tracking-widest">+ Add</button>
                    </div>
                    {aggregations.map((agg, i) => (
                      <div key={agg.id} className="flex gap-2 items-center">
                        <select value={agg.op} onChange={e => setAggregations(p => p.map((a, j) => j === i ? { ...a, op: e.target.value } : a))}
                          className="w-20 px-2 py-2 bg-page border border-rule text-[10px] font-black text-ink outline-none focus:border-accent">
                          {AGG_OPS_META.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                        </select>
                        <select value={agg.field} onChange={e => setAggregations(p => p.map((a, j) => j === i ? { ...a, field: e.target.value } : a))}
                          disabled={agg.op === 'count'}
                          className="flex-1 px-2 py-2 bg-page border border-rule text-[10px] font-black text-ink outline-none focus:border-accent disabled:opacity-50">
                          <option value="">{agg.op === 'count' ? '(all rows)' : '— numeric field —'}</option>
                          {fields.filter(f => f.type === 'number').map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                        </select>
                        <span className="text-[9px] font-black text-muted">AS</span>
                        <input value={agg.as} onChange={e => setAggregations(p => p.map((a, j) => j === i ? { ...a, as: e.target.value } : a))}
                          placeholder="alias"
                          className="w-20 px-2 py-2 bg-page border border-rule text-[10px] font-bold text-ink outline-none focus:border-accent" />
                        {aggregations.length > 1 && (
                          <button onClick={() => setAggregations(p => p.filter((_, j) => j !== i))} className="text-ink hover:text-ink text-xs font-black">✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Filters (optional)</label>
                  <button onClick={() => setFilters(p => [...p, { id: nanoid6(), field: fields[0]?.key || '', op: 'eq', value: '' }])}
                    className="text-[9px] font-black text-accent hover:text-accent uppercase tracking-widest">+ Add Filter</button>
                </div>
                {filters.length === 0 && <p className="text-[10px] text-muted font-bold">No filters — returns all rows.</p>}
                {filters.map((f, i) => (
                  <div key={f.id} className="flex gap-2 items-center">
                    <select value={f.field} onChange={e => setFilters(p => p.map((r, j) => j === i ? { ...r, field: e.target.value } : r))}
                      className="flex-1 px-2 py-2 bg-page border border-rule text-[10px] font-black text-ink outline-none focus:border-accent">
                      {fields.map(fd => <option key={fd.key} value={fd.key}>{fd.label}</option>)}
                    </select>
                    <select value={f.op} onChange={e => setFilters(p => p.map((r, j) => j === i ? { ...r, op: e.target.value } : r))}
                      className="w-24 px-2 py-2 bg-page border border-rule text-[10px] font-black text-ink outline-none focus:border-accent">
                      {FILTER_OPS_META.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
                    </select>
                    <input value={f.value} onChange={e => setFilters(p => p.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                      placeholder={f.op === 'in' ? 'val1,val2' : 'value'}
                      className="flex-1 px-2 py-2 bg-page border border-rule text-[10px] font-bold text-ink outline-none focus:border-accent" />
                    <button onClick={() => setFilters(p => p.filter((_, j) => j !== i))} className="text-ink hover:text-ink text-xs font-black">✕</button>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black text-muted uppercase tracking-widest">Sort Order (optional)</label>
                  <button onClick={() => setSortBy(p => [...p, { id: nanoid6(), field: fields[0]?.key || '', dir: 'asc' }])}
                    className="text-[9px] font-black text-accent hover:text-accent uppercase tracking-widest">+ Add Sort</button>
                </div>
                {sortBy.map((s, i) => (
                  <div key={s.id} className="flex gap-2 items-center">
                    <select value={s.field} onChange={e => setSortBy(p => p.map((r, j) => j === i ? { ...r, field: e.target.value } : r))}
                      className="flex-1 px-2 py-2 bg-page border border-rule text-[10px] font-black text-ink outline-none focus:border-accent">
                      {fields.map(fd => <option key={fd.key} value={fd.key}>{fd.label}</option>)}
                    </select>
                    <button onClick={() => setSortBy(p => p.map((r, j) => j === i ? { ...r, dir: r.dir === 'asc' ? 'desc' : 'asc' } : r))}
                      className={`px-3 py-2  border text-[9px] font-black uppercase tracking-widest transition-all ${s.dir === 'asc' ? 'bg-page border-accent text-accent' : 'bg-page border-accent text-accent'}`}>
                      {s.dir === 'asc' ? '↑ ASC' : '↓ DESC'}
                    </button>
                    <button onClick={() => setSortBy(p => p.filter((_, j) => j !== i))} className="text-ink hover:text-ink text-xs font-black">✕</button>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-muted uppercase tracking-widest">Definition Preview</label>
                <pre className="p-4 bg-shadow text-accent text-[9px] font-mono overflow-auto max-h-40 leading-relaxed">
                  {JSON.stringify(buildDefinition(), null, 2)}
                </pre>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3 px-8 py-5 border-t border-rule bg-page flex-shrink-0">
          <button onClick={onClose} className="px-6 py-3 text-[10px] font-black text-muted border border-rule hover:bg-page uppercase tracking-widest">Cancel</button>
          {step > 1 && (
            <button onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}
              className="px-6 py-3 text-[10px] font-black text-ink border border-rule hover:bg-page uppercase tracking-widest">← Back</button>
          )}
          <div className="flex-1" />
          {step < 3 ? (
            <button onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)} disabled={step === 1 ? !canNext1 : !canNext2}
              className="px-8 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent disabled:opacity-40 uppercase tracking-widest transition-all">
              Next →
            </button>
          ) : (
            <button onClick={save} disabled={saving}
              className="px-8 py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent disabled:opacity-50 uppercase tracking-widest transition-all">
              {saving ? 'Saving…' : 'Save Report'}
            </button>
          )}
        </div>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-shadow backdrop-">
      <div className="w-full max-w-lg bg-paper flex flex-col overflow-hidden max-h-[85vh]">
        <div className="flex items-center justify-between px-8 py-5 border-b border-rule">
          <div>
            <h2 className="text-base font-black text-ink tracking-tighter">Scheduled Delivery</h2>
            <p className="eyebrow-tight mt-0.5">{templateName}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center text-muted hover:text-ink hover:bg-page">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest">Active Schedules</label>
            {loading ? <div className="h-10 bg-page animate-pulse" />
              : schedules.length === 0 ? <p className="text-[10px] font-bold text-muted">No schedules yet.</p>
              : schedules.map(s => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 bg-page border border-rule ">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[8px] font-black px-2 py-0.5  border uppercase tracking-widest ${s.isActive ? 'bg-page text-accent border-accent' : 'bg-page text-muted border-rule'}`}>{s.isActive ? 'Active' : 'Paused'}</span>
                      <span className="text-[10px] font-black text-ink">{s.frequency}</span>
                      <span className="text-[9px] font-black px-2 py-0.5 bg-page text-accent border border-accent uppercase">{s.format}</span>
                    </div>
                    <span className="text-[9px] text-muted font-bold truncate max-w-xs">{s.recipients}</span>
                  </div>
                  <button onClick={() => remove(s.id)} disabled={deleting === s.id}
                    className="text-[9px] font-black text-ink hover:text-ink disabled:opacity-50 uppercase tracking-widest ml-4">
                    {deleting === s.id ? '…' : 'Delete'}
                  </button>
                </div>
              ))}
          </div>
          <div className="border-t border-rule pt-4 flex flex-col gap-3">
            <label className="text-[10px] font-black text-muted uppercase tracking-widest">Create New Schedule</label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Frequency</label>
                <select value={freq} onChange={e => setFreq(e.target.value)}
                  className="px-3 py-2.5 bg-page border border-rule text-[10px] font-black text-ink outline-none focus:border-accent">
                  {['DAILY', 'WEEKLY', 'MONTHLY'].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-black text-muted uppercase tracking-widest">Format</label>
                <select value={format} onChange={e => setFormat(e.target.value)}
                  className="px-3 py-2.5 bg-page border border-rule text-[10px] font-black text-ink outline-none focus:border-accent">
                  {['CSV', 'XLSX', 'PDF'].map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] font-black text-muted uppercase tracking-widest">Recipients (comma-separated)</label>
              <input value={recipients} onChange={e => setRecipients(e.target.value)}
                placeholder="hr@company.com, finance@company.com"
                className="px-3 py-2.5 bg-page border border-rule text-[10px] font-bold text-ink outline-none focus:border-accent" />
            </div>
            <button onClick={create} disabled={creating || !recipients.trim()}
              className="py-3 text-[10px] font-black text-paper bg-accent hover:bg-accent disabled:opacity-50 uppercase tracking-widest transition-all">
              {creating ? 'Creating…' : 'Create Schedule'}
            </button>
          </div>
        </div>
      </div>
    </div>
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

  return (
    <section className="bg-paper border border-rule overflow-hidden">
      <div className="p-8 border-b border-rule flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-2 h-8 bg-accent " />
          <div>
            <h3 className="text-lg font-black text-ink uppercase tracking-widest">Saved Reports</h3>
            <p className="eyebrow-tight mt-1">User-defined templates · run, export, schedule</p>
          </div>
        </div>
        <button onClick={() => setEditorOpen(true)}
          className="px-6 py-2.5 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all active:scale-95">
          + New Report
        </button>
      </div>
      <div className="overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-[10px] font-black text-muted uppercase tracking-widest">Loading…</div>
        ) : templates.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-bold text-muted">No saved reports yet. Click <span className="text-accent">+ New Report</span> to create one.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="text-[10px] font-black text-muted uppercase tracking-[0.2em] border-b border-rule">
              <tr>
                <th className="px-8 py-5">Name</th>
                <th className="px-8 py-5">Data Source</th>
                <th className="px-8 py-5">Category</th>
                <th className="px-8 py-5">Updated</th>
                <th className="px-8 py-5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {templates.map(t => (
                <tr key={t.id} className="hover:bg-page transition-all">
                  <td className="px-8 py-5">
                    <div className="flex flex-col">
                      <span className="text-xs font-black text-ink uppercase tracking-tight">{t.name}</span>
                      {t.description && <span className="text-[10px] text-muted mt-0.5">{t.description}</span>}
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-muted uppercase tracking-widest">{t.definition?.dataSource || '—'}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[9px] font-black px-3 py-1.5 border bg-page text-accent border-accent uppercase tracking-widest">{t.category || 'Custom'}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="eyebrow-tight">{new Date(t.updatedAt).toLocaleDateString('en-SG')}</span>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex gap-1.5 justify-center flex-wrap">
                      <button onClick={() => run(t)} disabled={busy === `run-${t.id}`}
                        className="px-3 py-1.5 bg-paper border border-rule text-[9px] font-black text-ink hover:border-accent hover:text-accent uppercase tracking-widest disabled:opacity-50">
                        {busy === `run-${t.id}` ? '…' : 'Run'}
                      </button>
                      <button onClick={() => exportFormat(t, 'csv')} disabled={busy === `csv-${t.id}`}
                        className="px-3 py-1.5 bg-paper border border-rule text-[9px] font-black text-ink hover:border-accent hover:text-accent uppercase tracking-widest disabled:opacity-50">
                        {busy === `csv-${t.id}` ? '…' : 'CSV'}
                      </button>
                      <button onClick={() => exportFormat(t, 'xlsx')} disabled={busy === `xlsx-${t.id}`}
                        className="px-3 py-1.5 bg-paper border border-rule text-[9px] font-black text-ink hover:border-accent hover:text-accent uppercase tracking-widest disabled:opacity-50">
                        {busy === `xlsx-${t.id}` ? '…' : 'XLSX'}
                      </button>
                      <button onClick={() => exportFormat(t, 'pdf')} disabled={busy === `pdf-${t.id}`}
                        className="px-3 py-1.5 bg-paper border border-rule text-[9px] font-black text-ink hover:border-ink hover:text-ink uppercase tracking-widest disabled:opacity-50">
                        {busy === `pdf-${t.id}` ? '…' : 'PDF'}
                      </button>
                      <button onClick={() => setScheduleModal({ id: t.id, name: t.name })}
                        className="px-3 py-1.5 bg-paper border border-rule text-[9px] font-black text-ink hover:border-highlight hover:text-ink uppercase tracking-widest">
                        Sched
                      </button>
                      <button onClick={() => remove(t)} disabled={busy === `del-${t.id}`}
                        className="px-3 py-1.5 bg-paper border border-rule text-[9px] font-black text-ink hover:border-ink hover:bg-page uppercase tracking-widest disabled:opacity-50">
                        {busy === `del-${t.id}` ? '…' : 'Del'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
  const [running, setRunning] = useState<ReportKey | null>(null);
  const [lastRun, setLastRun] = useState<Record<string, string>>({});
  const [rptSort, setRptSort] = useState<{ col: 'name' | 'category' | 'freq'; dir: 'asc' | 'desc' }>({ col: 'category', dir: 'asc' });
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [runSelector, setRunSelector] = useState<{ key: ReportKey; title: string } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [leaveLiabilityOpen, setLeaveLiabilityOpen] = useState(false);
  const [ir8aOpen, setIr8aOpen] = useState(false);
  const [breakdownModal, setBreakdownModal] = useState<{ runId: string; period: string } | null>(null);
  const [workforceDashOpen, setWorkforceDashOpen] = useState(false);

  const showToast = (msg: string, type: 'ok' | 'err') => setToast({ msg, type });

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
  function RptSortIcon({ col }: { col: typeof rptSort.col }) {
    return <span className="text-[8px] ml-1">{rptSort.col === col ? (rptSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>;
  }

  return (
    <div className="flex flex-col gap-10 max-w-[1400px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-6 bg-paper p-10 border border-rule relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-accent " />
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 bg-accent " />
            <span className="text-[10px] font-black text-accent uppercase tracking-[0.4em]">Compliance Intelligence Layer</span>
          </div>
          <h1 className="text-4xl font-black text-ink tracking-tighter">Reports <span className="text-accent">&amp; Analytics</span></h1>
          <p className="text-sm font-bold text-muted mt-2 uppercase tracking-widest max-w-xl">
            Statutory filings, workforce analytics, and custom report generation for MOM, IRAS, and CPF Board compliance.
          </p>
        </div>
        <div className="flex flex-wrap gap-4 relative z-10">
          <button onClick={() => setCustomOpen(true)}
            className="px-8 py-4 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all active:scale-95">
            + Custom Report
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Reports Available', value: String(REPORTS.length), status: 'text-ink', bg: 'bg-paper border-rule' },
          { label: 'Statutory Reports', value: String(REPORTS.filter(r => r.category === 'Statutory').length), status: 'text-ink', bg: 'bg-page border-ink' },
          { label: 'Financial Reports', value: String(REPORTS.filter(r => r.category === 'Financial').length), status: 'text-accent', bg: 'bg-page border-accent' },
          { label: 'Runs This Session', value: String(Object.keys(lastRun).length), status: 'text-accent', bg: 'bg-page border-accent' },
        ].map(s => (
          <div key={s.label} className={`p-8  border   ${s.bg}`}>
            <p className="label-form mb-4">{s.label}</p>
            <h3 className={`text-3xl font-black tracking-tighter ${s.status}`}>{s.value}</h3>
          </div>
        ))}
      </div>

      {/* Reports Matrix */}
      <section className="bg-paper border border-rule overflow-hidden">
        <div className="p-8 border-b border-rule flex items-center gap-4">
          <div className="w-2 h-8 bg-accent " />
          <h3 className="text-lg font-black text-ink uppercase tracking-widest">Report Registry</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="text-[10px] font-black text-muted uppercase tracking-[0.2em] border-b border-rule">
              <tr>
                {([
                  { col: 'name',     label: 'Report Name' },
                  { col: 'category', label: 'Category' },
                  { col: 'freq',     label: 'Frequency' },
                ] as const).map(h => (
                  <th key={h.col} className="px-8 py-7">
                    <button onClick={() => toggleRptSort(h.col)} className="flex items-center hover:text-ink transition-colors">
                      {h.label}<RptSortIcon col={h.col} />
                    </button>
                  </th>
                ))}
                <th className="px-8 py-7">Last Generated</th>
                <th className="px-8 py-7 text-center">Generate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {sortedReports.map(r => (
                <tr key={r.key} className="group hover:bg-page transition-all duration-300">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <span className="text-lg text-muted group-hover:text-accent transition-colors">{r.icon}</span>
                      <div className="flex flex-col">
                        <span className="text-xs font-black text-ink uppercase tracking-tight group-hover:text-accent transition-colors">{r.name}</span>
                        {r.badge && (
                          <span className="mt-1 inline-block text-[8px] font-black px-2 py-0.5 bg-page text-accent border border-accent uppercase tracking-widest w-fit">{r.badge}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className={`text-[9px] font-black px-3 py-1.5  border uppercase tracking-widest ${CATEGORY_COLORS[r.category]}`}>{r.category}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-[10px] font-black text-muted uppercase tracking-widest">{r.freq}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className="eyebrow-tight">
                      {lastRun[r.key] ?? '—'}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-center">
                    <button
                      onClick={() => handleRun(r)}
                      disabled={running === r.key}
                      className="px-6 py-2 bg-paper border border-rule text-[9px] font-black text-muted uppercase tracking-widest hover:border-accent hover:text-accent hover:bg-page transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
                    >
                      {running === r.key ? (
                        <>
                          <span className="w-3 h-3 border-2 border-rule border-t-rule animate-spin rounded-full" />
                          Generating…
                        </>
                      ) : 'Run Now'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
